# Contributing

Bug reports, scan results from real devices and pull requests are welcome.

## Setup

Node 24 or newer and npm 11.

```sh
npm ci
npm run dev                          # http://127.0.0.1:5173
npx playwright install chromium      # once, for the browser tests
```

## Before opening a pull request

```sh
npm run check        # typecheck, lint, unit and integration tests
npm run test:e2e     # browser tests against the production build
```

Both must pass. Neither makes a network or AI call, and new tests must not
either. `npm run smoke:claude` sends one real request through your own Claude
Code login; it is never needed for a contribution.

## Ground rules

- The invariants listed in [CLAUDE.md](CLAUDE.md) are enforced by tests. A
  change that needs one of them weakened should start as an issue, not a pull
  request. The reasons behind them are in
  [docs/architecture.md](docs/architecture.md).
- Do not relax the stress profile or the finder-radius bounds to make a design
  pass. Changing a stress parameter means a new `STRESS_PROFILE.version`.
- Bump `RENDERER_VERSION` when the SVG output for the same inputs changes.
- `src/vendor/nayuki-qrcodegen/` is vendored at a pinned revision. Do not edit
  it; use it through `src/core/qr/encoder.ts`.
- Sample brands and logos must be original and fictional.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/),
  for example `fix(render): keep the quiet zone opaque`.

## Reporting scan failures

A code that verifies in the app but fails on a real phone or print is useful
data. Open an issue with the exported validation report (JSON), the device and
camera app, and the size and material if printed. Remove the payload from the
report first if it is private.

## Security

Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your contribution is licensed under the terms in
[LICENSE](LICENSE).
