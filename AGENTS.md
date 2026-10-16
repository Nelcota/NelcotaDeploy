# Repository instructions

## English only

All repository content and GitHub activity must be in English. This includes documentation and filenames, source comments, UI and CLI text, examples, branding, workflow and step names, labels, commit subjects and bodies, PR titles and descriptions, issues, and release notes. A Portuguese conversation does not authorize Portuguese project content. Check this requirement before committing or publishing. Preserve proper names, external identifiers, and immutable signatures/hashes exactly.

The only exception is the panel's interface translation catalog (`web/i18n/pt_br.go`), which holds Brazilian Portuguese translations of English interface strings for the in-app language switcher. English remains the source language: code, identifiers, comments, tests, documentation, commits, and every other file stay in English.

## Project boundaries

Keep authorization and business rules in `internal/service`. Generate `internal/gen/` and `internal/store/dbgen/` from their Protobuf and SQL sources. Keep credentials, databases, backups, and local release artifacts out of Git. Distinguish implementation and local verification from VPS acceptance.

Run checks appropriate to each change. Use a clean checkout for full-module checks when ignored local evidence directories contain Go files. Integration tests require real Docker and Caddy; missing infrastructure is not a passing result.
