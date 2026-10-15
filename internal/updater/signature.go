// Package updater stages and applies releases authenticated by the installation's
// root-owned Minisign public key. It never runs commands supplied by a request.
package updater

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"strings"

	"golang.org/x/crypto/blake2b"
)

// VerifyMinisign accepts the current prehashed ED format, including its signed
// trusted comment. Legacy Ed signatures are deliberately rejected.
func VerifyMinisign(message, signature []byte, public string) error {
	key, e := base64.StdEncoding.DecodeString(strings.TrimSpace(public))
	if e != nil || len(key) != 42 || string(key[:2]) != "Ed" {
		return errors.New("invalid release public key")
	}
	lines := strings.Split(strings.TrimSuffix(string(signature), "\n"), "\n")
	if len(lines) != 4 || !strings.HasPrefix(lines[0], "untrusted comment: ") || !strings.HasPrefix(lines[2], "trusted comment: ") {
		return errors.New("invalid release signature")
	}
	sig, e := base64.StdEncoding.DecodeString(lines[1])
	if e != nil || len(sig) != 74 || string(sig[:2]) != "ED" || !bytes.Equal(sig[2:10], key[2:10]) {
		return errors.New("invalid release signature")
	}
	global, e := base64.StdEncoding.DecodeString(lines[3])
	if e != nil || len(global) != 64 {
		return errors.New("invalid release signature")
	}
	digest := blake2b.Sum512(message)
	pub := ed25519.PublicKey(key[10:])
	if !ed25519.Verify(pub, digest[:], sig[10:]) || !ed25519.Verify(pub, append(bytes.Clone(sig[10:]), []byte(strings.TrimPrefix(lines[2], "trusted comment: "))...), global) {
		return errors.New("release signature verification failed")
	}
	return nil
}
