# Release Process

Slavey is pre-1.0. Releases should still be reproducible, documented, and easy to audit.

## Versioning

Update these files together:

- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

For pre-1.0 releases, breaking changes are allowed but must be called out in `CHANGELOG.md` and GitHub release notes.

## Preflight

Before tagging:

```sh
npm ci
npm run check
npm run test:e2e:run
git status --short --branch
```

Review these files before release:

- `CHANGELOG.md`
- `README.md`
- `SECURITY.md`
- `PRIVACY.md`
- `src-tauri/capabilities/default.json`
- `src-tauri/tauri.conf.json`

## Security Review

Before publishing public binaries:

- run a secret scan on the full git history,
- audit dependency changes,
- confirm diagnostics still redact secrets and raw logs,
- confirm Tauri permissions are still minimal,
- confirm bundled assets are owned by the project or are license-compatible,
- keep signing keys and certificates out of the repository.

## Tagging

Use annotated tags:

```sh
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

## Binary Distribution

Public binary distribution should not be enabled until signing, notarization, and platform-specific installer expectations are documented.

When binary releases are added, document:

- supported operating systems,
- code signing requirements,
- notarization requirements,
- checksum generation,
- update channel behavior,
- rollback policy.
