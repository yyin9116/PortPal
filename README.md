<h1>
  <img src="public/portpal-icon.svg" width="32" alt="" />
  PortPal
</h1>

PortPal is a lightweight desktop utility for developers who need a fast,
glanceable way to discover and manage local ports. It scans active listeners,
shows the owning process and project context, and lets you open, inspect, hide,
or stop local services from a compact tray-first app.

[View releases](https://github.com/yyin9116/PortPal/releases) ·
[Release workflow](.github/workflows/release.yml) ·
[CI workflow](.github/workflows/ci.yml)

## What PortPal Helps With

- Find which process is holding a port before `EADDRINUSE` interrupts your flow.
- Open a detected local service in the browser.
- Jump to the working directory behind a running service when it can be resolved.
- Hide noisy entries from the current list.
- Apply scan rules for include ranges, excluded ports, excluded process names, and allowed process names.
- Switch between Chinese and English UI text.
- Choose system, light, or dark theme.
- Auto-refresh the port list or refresh manually from the tray/app UI.
- Stop a process that owns a port when you explicitly choose to terminate it.

PortPal is built with Tauri, Rust, React, and TypeScript. Native work such as
port scanning, process inspection, folder opening, browser launching, tray
behavior, and process termination stays behind Tauri commands; the React UI
handles presentation, preferences, and user interaction.

## Current Status

PortPal is in early `0.1.x` development. The current release packaging flow
builds draft GitHub Releases for review before public publication.

| Area | Status |
| --- | --- |
| macOS Apple Silicon | Built by the release workflow |
| macOS Intel | Built by the release workflow |
| Windows x64 | Built by the release workflow |
| Code signing | Not configured |
| macOS notarization | Not configured |
| Auto-update | Not configured |
| Store distribution | Not configured |

Because signing and notarization are not configured yet, downloaded builds may
trigger operating-system security warnings. Review the draft release assets
before publishing a release for end users.

## Install

Download builds from the GitHub Releases page when a release is published:

- macOS Apple Silicon: `portpal-<version>-darwin-aarch64.dmg`
- macOS Intel: `portpal-<version>-darwin-x64.dmg`
- Windows x64: `portpal-<version>-windows-x64-setup.exe` or `portpal-<version>-windows-x64.msi`

The release workflow intentionally creates draft releases first. Maintainers
should verify the uploaded assets, release notes, and unsigned-build caveats
before clicking **Publish release** in GitHub.

## Use

1. Launch PortPal.
2. Open it from the menu bar/system tray.
3. Review the active local listeners.
4. Use the action buttons to copy a URL, open a service in the browser, open a
   detected folder, hide an entry, or terminate the owning process.
5. Open settings to adjust scan ranges, excluded ports/processes, allowlisted
   processes, refresh interval, language, and theme.

Terminating a process is a deliberate user action. PortPal does not terminate
processes automatically.

## Privacy And Local Data

PortPal is designed around local desktop inspection. It scans local listening
ports and process metadata on the machine where it runs. The current app does
not configure telemetry, cloud sync, or an auto-update channel.

User preferences are stored in browser-style local storage inside the Tauri
WebView:

- scan settings
- hidden port entries
- refresh interval
- language
- theme mode

Logs and diagnostics should avoid secrets, private file contents, and
unnecessary full paths. Treat process command lines and working directories as
potentially sensitive when sharing screenshots or bug reports.

## Develop

Prerequisites:

- Node.js 24, matching the GitHub Actions workflows
- Rust stable
- Tauri platform prerequisites for your operating system

Install dependencies:

```bash
npm ci
```

Run the Tauri desktop app in development:

```bash
npm run tauri dev
```

Build the frontend:

```bash
npm run build
```

Check the Rust backend:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

## Project Layout

```text
PortPal/
├── src/                     # React UI
│   ├── components/          # Shared UI components
│   └── services/            # Tauri boundary and user preference helpers
├── src-tauri/               # Rust/Tauri desktop backend
│   ├── src/scanner.rs       # Listening-port scanner
│   ├── src/process_info.rs  # Process and project metadata lookup
│   ├── src/process_control.rs
│   └── src/lib.rs           # Tauri commands, tray, window behavior, logging
├── public/                  # Public frontend assets
└── .github/workflows/       # CI and release automation
```

## Verification

Fast CI runs on `main` pushes and pull requests:

- install Node dependencies with `npm ci`
- build the frontend with `npm run build`
- check the Rust backend with `cargo check`

Release packaging is intentionally slower and only runs on explicit release
triggers:

- annotated `v*` tag push
- manual `workflow_dispatch` with a tag

The release workflow validates that:

- the release tag is annotated
- version metadata matches across `package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`
- required bundle icon assets exist
- expected bundle directories contain generated files

## Release Process

Keep these version fields in sync before tagging:

- `package.json`
- `package-lock.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`

Create an annotated release tag with release notes:

```bash
git tag -a v0.1.1 -m "PortPal v0.1.1" -m "Release notes..."
git push origin v0.1.1
```

The workflow uploads macOS and Windows installers to a draft GitHub Release.
Manual rebuilds can be triggered from GitHub Actions with the same annotated
tag; existing generated assets for that version are cleared before rebuild.

## Repository

GitHub: [yyin9116/PortPal](https://github.com/yyin9116/PortPal)
