# Security policy

[中文](SECURITY.md) | [English](SECURITY.en.md)

## Supported versions

Security fixes target the repository's default branch and the current npm release of `dsh-mpkg-wallpaper`. Older releases are not back-ported unless the fix note says otherwise.

## Reporting a vulnerability

Use GitHub's private vulnerability report:

<https://github.com/XHR666/dsh-mpkg-wallpaper/security/advisories/new>

Do not paste tokens, keys, unpublished exploit steps, or a diagnostics export that contains live addresses into a public issue, discussion, or pull request. Public issues are for ordinary defects that contain none of those:

<https://github.com/XHR666/dsh-mpkg-wallpaper/issues>

Please include:

1. The plugin version, plus the DSH version and the browser engine and version.
2. Reproduction steps. Replace tokens and machine-local paths with placeholders.
3. Actual result and expected result.
4. Whether someone other than you can already read local wallpaper files, settings, or diagnostics.

After a report is confirmed, the fix note on the default branch will describe the impact and the change. This policy does not promise a fixed response time.

## In scope

- Origin checks, directory reads, and cross-site requests on the host routes.
- Wallpaper addresses, scene tokens, settings, or diagnostics exports leaking data that should stay local.
- A bypass of the web-wallpaper iframe origin or message checks.
- A key, token, or machine-local path committed to the repository or the published package.

## Out of scope

- Defects in DeepSeek Harness itself. Report those to [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).
- Other DSH plugins, the official Wallpaper Engine client, and cases where someone deliberately gives a token to an untrusted page.

## How this plugin handles data

Wallpaper parsing, transcoding, and storage stay on the machine. Nothing is uploaded automatically. Web wallpapers run in a sandboxed iframe by default. Custom folders reject path traversal and sensitive directories. Diagnostics and the error log stay local, and an export can be sanitized or full. See [Security and privacy in the README](README.en.md#security-and-privacy).
