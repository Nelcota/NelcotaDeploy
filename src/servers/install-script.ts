import { RAILPACK_VERSION } from "@/docker";

import { InvalidInstallInputError } from "./server.errors";

/** Where builds run on servers the install script prepared. */
export const REMOTE_WORKSPACE_DIR = "/var/lib/nelcota/workspaces";
/** Where the worker writes the routes the server's proxy reads. */
export const REMOTE_ROUTES_DIR = "/var/lib/nelcota/routes";
/** SHA-256 of the Railpack release archives, from the release's checksums.txt. */
const RAILPACK_SHA256 = {
  x86_64: "248a8f60f36854aabed6124113631078a802de3461660855fc4de9c26065c1fb",
  arm64: "732ece14eb4f4676a43ebba19431f954edf7b130acb76159ef0f2ff86ac42ac9",
} as const;
const RAILPACK_RELEASE_URL = `https://github.com/railwayapp/railpack/releases/download/v${RAILPACK_VERSION}`;
/** Heredoc delimiter; the script never contains it. */
const DELIMITER = "NELCOTA_INSTALL";
const PUBLIC_KEY_PATTERN = /^ssh-ed25519 [A-Za-z0-9+/=]+( [A-Za-z0-9@._-]+)?$/;
const USERNAME_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/;

// POSIX sh, run as root, safe to run again. It installs Docker, git and Railpack (checking
// the archive against its published checksum), creates the account
// the panel logs in with, lets that account open the SSH channels and tunnels the panel uses
// (after validating the new sshd configuration) and only then authorizes the panel's key.
const SCRIPT = `set -eu
PUBLIC_KEY="$1"
USER_NAME="$2"
fetch() { if command -v curl >/dev/null 2>&1; then curl -fsSL "$1"; else wget -qO- "$1"; fi; }
if command -v docker >/dev/null 2>&1; then :; else fetch https://get.docker.com | sh; fi
if command -v git >/dev/null 2>&1; then :
elif command -v apt-get >/dev/null 2>&1; then apt-get update -qq && apt-get install -y -qq git
elif command -v dnf >/dev/null 2>&1; then dnf install -y -q git
elif command -v yum >/dev/null 2>&1; then yum install -y -q git
fi
case "$(uname -m)" in
  x86_64|amd64) RAILPACK_ARCH=x86_64; RAILPACK_SUM=${RAILPACK_SHA256.x86_64} ;;
  aarch64|arm64) RAILPACK_ARCH=arm64; RAILPACK_SUM=${RAILPACK_SHA256.arm64} ;;
  *) RAILPACK_ARCH="" ;;
esac
RAILPACK_MARKER=/usr/local/lib/nelcota-railpack-version
if [ -z "$RAILPACK_ARCH" ]; then
  echo "Railpack is unavailable for this architecture. Projects without a Dockerfile cannot build here." >&2
elif [ "$(cat "$RAILPACK_MARKER" 2>/dev/null)" != "${RAILPACK_VERSION}" ]; then
  RAILPACK_TMP=$(mktemp -d)
  fetch "${RAILPACK_RELEASE_URL}/railpack-v${RAILPACK_VERSION}-$RAILPACK_ARCH-unknown-linux-musl.tar.gz" > "$RAILPACK_TMP/railpack.tar.gz"
  echo "$RAILPACK_SUM  $RAILPACK_TMP/railpack.tar.gz" | sha256sum -c - >/dev/null
  tar -xzf "$RAILPACK_TMP/railpack.tar.gz" -C "$RAILPACK_TMP" railpack
  install -m 755 "$RAILPACK_TMP/railpack" /usr/local/bin/railpack
  mkdir -p /usr/local/lib && printf '%s\\n' "${RAILPACK_VERSION}" > "$RAILPACK_MARKER"
  rm -rf "$RAILPACK_TMP"
fi
# A "*" password cannot be used to log in but, unlike a locked "!" one, still allows SSH keys.
if id "$USER_NAME" >/dev/null 2>&1; then :; else useradd --create-home --shell /bin/sh --password '*' "$USER_NAME"; fi
usermod -aG docker "$USER_NAME"
HOME_DIR=$(getent passwd "$USER_NAME" | cut -d: -f6)
install -d -m 750 -o "$USER_NAME" -g "$USER_NAME" /var/lib/nelcota ${REMOTE_WORKSPACE_DIR} ${REMOTE_ROUTES_DIR}
CONFIG=/etc/ssh/sshd_config
if grep -qx "Match User $USER_NAME" "$CONFIG"; then :; else
  cp "$CONFIG" "$CONFIG.nelcota-backup"
  printf '\\n# Added by Nelcota Deploy\\nMatch User %s\\n    AllowTcpForwarding local\\n    MaxSessions 200\\n' "$USER_NAME" >> "$CONFIG"
  if sshd -t; then :; else
    cp "$CONFIG.nelcota-backup" "$CONFIG"
    echo "The SSH configuration was invalid and has been restored." >&2
    exit 1
  fi
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || service ssh reload 2>/dev/null || service sshd reload
fi
# The key goes in last: the panel retries every few seconds and keeps its connection open,
# so it must not log in before the SSH settings above are live.
install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "$HOME_DIR/.ssh"
KEYS="$HOME_DIR/.ssh/authorized_keys"
touch "$KEYS"
grep -qxF "$PUBLIC_KEY" "$KEYS" || printf '%s\\n' "$PUBLIC_KEY" >> "$KEYS"
chown "$USER_NAME:$USER_NAME" "$KEYS"
chmod 600 "$KEYS"
echo "Server ready. The panel will connect automatically in a few seconds."
echo "Server fingerprint (verify it in the panel):"
ssh-keygen -l -E sha256 -f /etc/ssh/ssh_host_ed25519_key.pub`;

/**
 * Builds the command an admin pastes, once, in a root shell of a new server.
 *
 * @remarks
 * The script travels inside the command as a quoted heredoc, so nothing is downloaded from
 * the panel and the whole script can be read before running it. It works from a root shell
 * or through sudo.
 *
 * @param publicKey - The panel's public key line.
 * @param username - Account the panel logs in with.
 * @returns The command text.
 * @throws {InvalidInstallInputError} When the key or username is malformed.
 */
export function buildInstallCommand(publicKey: string, username: string): string {
  if (PUBLIC_KEY_PATTERN.test(publicKey) === false) {
    throw new InvalidInstallInputError("public key");
  }
  if (USERNAME_PATTERN.test(username) === false) {
    throw new InvalidInstallInputError("username");
  }
  const args = `'${publicKey}' '${username}'`;
  return [
    `if [ "$(id -u)" = 0 ]; then sh -s -- ${args}; else sudo sh -s -- ${args}; fi <<'${DELIMITER}'`,
    SCRIPT,
    DELIMITER,
  ].join("\n");
}
