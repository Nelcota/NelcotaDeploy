# Security policy

## Support status

NelcotaDeploy is under development and has no production-approved release. Fixes are applied to `main`. The v1.0.0–v1.0.2 packages in [staging releases](docs/staging-releases.md) are local update-testing artifacts, not a supported release line.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/Nelcota/NelcotaDeploy/security/advisories/new). Include:

- Affected commit or version and the environment used.
- Reproduction steps and observed impact.
- A minimal example with credentials and real user data removed.
- A suggested fix, if available.

Avoid publishing exploitable details in public issues before assessment and remediation. The project does not offer an SLA or a bug bounty program.

## Operational boundaries

The agent controls the Docker daemon; compromising that access can compromise the host. Keep backup, release-signing, and encryption keys separately. Network policy, isolation, installers, and recovery must be validated in the target environment.

Read the [security boundaries](docs/status.md#security-boundaries), [operations guide](docs/operations.md), and [VPS acceptance guide](docs/vps-testing.md).
