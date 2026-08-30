# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security reports.

Use [GitHub's private vulnerability reporting](https://github.com/episki/desktop/security/advisories/new),
which keeps the report private until a fix ships. If you cannot use that, email
**hello@episki.com** with `SECURITY` in the subject.

Please include what you need to demonstrate the issue: affected version, OS,
reproduction steps, and impact. We will acknowledge receipt within 3 business
days and keep you updated as we investigate.

## Scope

This repository is the Electron desktop shell for the episki platform. It loads
the web application and adds native integration: window management, deep links,
notifications, and auto-updates.

In scope:

- The main process, preload bridge, and IPC surface in `src/`
- Navigation and permission policy (`src/security.ts`)
- The update pipeline (`src/updater.ts`, `electron-builder.yml`)
- Deep link handling (`episki://`)
- Build and release workflows in `.github/workflows/`

Out of scope for this repository — report these against the platform itself:

- Vulnerabilities in the web application served at `app.episki.com`
- Authentication and authorisation logic, which lives server-side

## Known limitations

These are tracked and disclosed deliberately rather than treated as reports:

- **Builds are not yet code-signed.** On macOS this means auto-updates download
  but do not install, and the OS does not register the app with Notification
  Center. Signing configuration is scaffolded in `electron-builder.yml`.
- **Windows builds are unsigned**, so installers show a SmartScreen prompt.

## Supported versions

Only the latest released version receives security fixes. The app auto-updates,
so keeping it running on the current release is the supported configuration.

Electron itself is kept within its supported window — upstream patches only the
three most recent majors, so falling behind means running an unpatched Chromium.
Dependabot tracks this weekly.
