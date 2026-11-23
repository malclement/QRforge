# Security policy

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository. Include the affected
file or feature, steps to reproduce, and the impact you expect.

You should get a reply within a week. Only the latest commit on `main` is
supported; there are no maintained release branches.

## In scope

- The optional bridge (`bridge/`): the loopback binding, Host, Origin and
  session-token checks, the request schema, and how the Claude Code CLI is
  spawned (argument array, allowlisted environment, no permission bypass).
- Logo intake: the SVG allowlist and sanitizer, raster re-encoding, and anything
  that lets an uploaded or imported asset run script or load a remote resource.
- Project file, recipe and suggestion import: schema bypasses or unbounded input.
- Export integrity: a way to download bytes other than the ones that were
  verified.
- Any network request made by the app outside the bridge.

## Out of scope

- A QR code that verifies in the app but does not scan on a particular device,
  print or material. That is a normal issue; see
  [CONTRIBUTING.md](CONTRIBUTING.md).
- Hosting the bridge for other people. It is designed for one person on their
  own computer and is not hardened for anything else.
- Vulnerabilities in dependencies with no demonstrated effect on this project;
  report those upstream.
