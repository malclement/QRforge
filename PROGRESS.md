# Progress

Last updated: 2026-11-21. Release 1.0.0 scope is implemented.

## Done

- [x] Content: exact-payload preview, explicit corrections, overflow and malformed-input errors
- [x] QR core: vendored Nayuki encoder behind an adapter, function-module map, codeword/block geometry
- [x] Renderer: canonical SVG, six compositions, four module styles, bounded rounded finders, gradient, captions as outlines
- [x] Logos: PNG/JPEG/WebP re-encoded, SVG allowlist + DOMPurify, palette extraction, role proposal with explanations
- [x] Logo placement: protected-region and codeword-budget checks, shrink/shift/move outside
- [x] Editor: three-column desktop layout, tabbed mobile layout, zoom/fit, light/dark surround, variation strip, shortcuts
- [x] State: undoable operations with coalescing, autosave, named projects, duplicate, delete
- [x] Persistence: IndexedDB, validated reads, quota errors surfaced, portable project files, migration runner
- [x] Verification: two decoders, exact-bytes baseline, versioned stress profile, fingerprints, reports, stale-result rejection
- [x] Repair: one-click actions and a bounded verified search with ranked proposals
- [x] Export: PNG (pixel-aligned by default), SVG, validation report JSON, print-size arithmetic, unverified override
- [x] AI: brief export, recipe import, loopback bridge to the Claude Code CLI
- [x] Examples: five fictional brands, six finished example projects
- [x] Tests: 190 unit/integration (Vitest), 12 browser (Playwright); CI workflow

## Verification performed

- `npm run check`: typecheck, lint, 190 tests pass.
- `npm run test:e2e`: 12 browser tests pass against the production build with all
  non-local requests blocked. The full journey downloads PNG, SVG and report and
  decodes the files outside the app with both decoders.
- `npm run samples`: all six examples pass baseline; 18–19 of 20 stress checks each.
- `npm run smoke:claude`: run once on 2026-11-21 (Claude Code 2.1.330, Max
  subscription). Two schema-valid suggestions returned in 8.4 s.
- Visual review in Chromium at 1440×900 and 390×844: editor, logo upload, each
  preset, verify tab, export dialog, projects dialog, error state, dark surround.

## Not verified

- Physical scans (iOS, Android) and printed proofs: pending. See the checklist in `README.md`.
- Browsers other than Chromium have not been run. The code uses standard APIs
  (OffscreenCanvas in workers, `createImageBitmap`), but Firefox and Safari are untested.
- The CI workflow has not been executed on a runner.
- Nothing is committed to git yet.

## Known limits

- jsQR is the weaker decoder under stress: most designs lose one or two of its
  ten stress checks (commonly noise or perspective). These are reported, not hidden.
- Caption fonts cover Latin and Latin Extended only.
- A tall or wide logo inside a circular panel is small; the rounded panel fits it better.
- The app is one ~1 MB bundle (313 KB gzipped); no code splitting.

## Next steps, in order

1. Run the scan checklist on real phones and a printed proof; record results here.
2. Run the browser tests on Firefox and WebKit (`projects` in `playwright.config.ts`).
3. Choose the logo panel shape from the logo's proportions when generating variations.
4. Roadmap items in `README.md` ("Later").
