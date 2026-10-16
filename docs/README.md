# NelcotaDeploy documentation

The backend is implemented and locally tested. The web interface and complete VPS acceptance testing remain outstanding. Start with the [project README](../README.md) for an overview.

## Reading paths

| Goal | Document |
| --- | --- |
| Understand architecture and product goals | [System plan](system-plan.md) |
| Check implemented features and validation | [Backend report](backend-report.md) |
| Identify external acceptance work | [Outstanding work](outstanding-work.md) |
| Build the interface or integrate APIs | [Frontend contract](frontend-contract.md) |
| Test installation and operations on two servers | [VPS acceptance guide](vps-testing.md) |
| Operate backups, restores, updates, and recovery | [Operations guide](backend-operations.md) |
| Understand local laboratory packages | [Staging releases](staging-releases.md) |
| Review decisions and backend milestones | [Decisions](decisions.md) · [Progress](backend-progress.md) |
| Contribute or report a vulnerability | [Contributing](../CONTRIBUTING.md) · [Security](../SECURITY.md) |

## Interpreting these documents

The system plan records goals and future options. The backend report distinguishes implementation, local testing, and acceptance on real infrastructure. Progress checkmarks do not replace operational acceptance.

The October 15, 2026 reports retain the conditions of local validation, including paths and artifacts from that machine. `.local/`, `.tools/`, `bin/`, and `dist/` are not included in the public checkout. Publishing source does not publish those packages or approve production use.

## Visual identity

The editable [vector logo](assets/logo.svg), [README banner](assets/readme-banner.svg), and [sharing image](assets/social-preview.png) are included under the project's MIT license. The SVGs do not require external fonts or scripts.

## Project language

Repository content and GitHub activity must be in English. See [AGENTS.md](../AGENTS.md). Historical cryptographic identifiers and signed artifacts are preserved exactly.
