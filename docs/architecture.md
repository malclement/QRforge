# Architecture and decisions

## Plan that was followed

1. Content input, QR encoding, canonical SVG, PNG/SVG export, baseline decoding by two decoders.
2. Logo intake, palette roles, six preset families, variations, the editor.
3. Persistence, undo/redo, stress validation, stale-result prevention, repair.
4. Recipe import/export and the optional Claude Code bridge.
5. Visual refinement, browser tests, documentation, examples.

## Versions

Node 26.8.1 (engines: >= 24), npm 11.19.0. React 19.3, Vite 8.3, TypeScript 6.0.3,
Tailwind 4.3, Zustand 5.1, Zod 4.6, Dexie 4.4, Vitest 5.1, Playwright 1.65.
jsQR 1.4.0, zxing-wasm 3.1.7, DOMPurify 3.4, opentype.js 2.0.0, jpeg-js 0.4.4.
Exact versions are in `package-lock.json`.

TypeScript is 6.0, not 7.0: typescript-eslint 8.73 supports TypeScript below 6.1.

## Decisions

**1. Encoder: Project Nayuki's TypeScript generator, vendored.**
Compared with node-qrcode. Nayuki documents matrix access (`getModule`), exposes
version, ECC level and mask, supports ECI segments, and is one MIT file. node-qrcode
has no ECI support and exposes the function-module grid only through an
undocumented field. Nayuki publishes no npm package, so the file is vendored at
revision `9a217d44` with its licence; the only change is an appended `export`.
Cost: updates are manual.

**2. Function-module map computed independently, tested as a black box.**
`structure.ts` derives the map from the layout rules and never reads the
encoder's private grid. Tests encode many random payloads across masks and ECC
levels and require that structural modules never change while data modules do,
and that data-module counts match the published figures.

**3. Logo sizing is in codewords, not area.**
`codewords.ts` maps each module to its codeword and Reed-Solomon block. A logo
panel may cover at most 60% of the correctable errors of the busiest block and
must not touch any protected module; otherwise it shrinks, shifts by up to three
modules, or moves outside the symbol. A test destroys exactly the correctable
number of codewords in one block (must decode) and one more (must fail) with both
real decoders, which validates the map. The limit is this application's policy;
the decoded artwork decides the outcome.

**4. Text encoding: UTF-8 without ECI by default, ECI 26 optional.**
Numeric and alphanumeric payloads use their compact modes. Scanners most widely
expect raw UTF-8 without a header; the header is an advanced switch. Lone
surrogates and overflow are rejected with a message. `boostEcl` is off so the
chosen level is the level used.

**5. One canonical SVG; captions as outlines; logos as `<image>`.**
The renderer returns one string used for preview, verification and export.
Captions are converted to paths from bundled fonts, so there is no font
dependency and every rasterizer draws the same shapes. Uploaded SVG logos are
embedded as a nested SVG data URL instead of being inlined: styles and ids stay
scoped, nothing uploaded enters the page DOM, and an image context cannot run
scripts or load resources. Cost: some design tools rasterize nested SVG images.

**6. Dark regions are traced as outlines.**
Touching modules become one shape with no seams. Only convex corners of data
modules are shaped, so nothing is added inside a light module.

**7. Rounded finder radii are bounded by measurement.**
jsQR scores finder candidates along their diagonals too, so corner rounding hurts
it quickly. A sweep (six payloads, twelve sizes, three module styles) gave zero
baseline failures up to outer 1.0 / hole 0.5 / eye 0.5 modules and many beyond
(for example 35 of 72 at 1.0 / 1.0 / 1.0). ZXing-C++ was unaffected. Those values
are the hard limit; timing, alignment, format and version modules are always
plain squares.

**8. Two independent decoders, local WASM.**
jsQR (JavaScript port of the ZXing Java pipeline) and ZXing-C++ via zxing-wasm.
Both refuse inverted symbols. zxing-wasm's default loader fetches its WASM from
jsDelivr; the adapter requires a local source and the build bundles the file.
The browser tests fail if any request leaves the machine.

**9. Verification is keyed by a configuration fingerprint.**
SHA-256 over payload and encoding options, the render-relevant recipe, asset
hashes, encoder and renderer versions, PNG width, profile version and SVG check
widths. Reports are stored under that key; status is a lookup for the current
key, so an edit reads as pending immediately. A latest-wins job runner cancels
superseded runs and discards their results.

**10. Stress profile with fixed parameters.**
Pure-TypeScript transforms (including jpeg-js) so the worker and Node tests
compute the same pixels. Downscales are relative; blur and noise are absolute.
Stress cases run on a copy capped at 1536 px to bound time. Baseline always uses
the full-size PNG.

**11. Verification on the main thread and in a worker.**
SVG rasterization needs an image element, so it runs on the main thread. PNG
decoding, transforms and both decoders run in a worker. Variation thumbnails get
baseline-only checks from a second worker.

**12. AI is limited to bounded style recipes.**
The brief has no field for the payload or the logo image. Suggestions are a
strict schema of enums, 0–1 numbers, colours and short plain-text strings.
The bridge uses `--safe-mode` (customizations off, native login kept) with tools
and MCP disabled. `--bare` is not used because it bypasses the subscription
login. The child process gets an allowlisted environment. Per Anthropic's
guidance this is supported for a person running their own unmodified CLI with
their own subscription; it must not be hosted for other users. Verified live once
with `npm run smoke:claude` on Claude Code 2.1.330.

**13. Storage.**
IndexedDB through Dexie: projects, assets by hash, one report per project.
Everything read back is validated again. Imports get a new id and their assets
pass through the upload intake.

## Assumptions

- "Six variations" means one per preset family; a new seed varies choices
  within each family.
- Free-text direction is used only in the AI brief. Presets respond to the four
  style attributes, which are documented parameter shifts.
- A stored report is restored only for an identical fingerprint. Export always
  needs the exact bytes, so it re-verifies when they are not in memory.
- Nothing has been committed to git; that is left to the repository owner.
