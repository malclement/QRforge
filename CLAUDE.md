# QR Studio

Local-first QR design studio: React + Vite static app, optional Node bridge to
the Claude Code CLI. See `README.md` for usage, `docs/architecture.md` for
decisions, `PROGRESS.md` for state and next steps.

## Commands

```sh
npm run dev          # app on 127.0.0.1:5173 (strict port; the bridge matches this origin)
npm run check        # typecheck + lint + vitest
npm run test:e2e     # playwright against the production build (builds first)
npm run samples      # regenerate public/examples and docs/examples
npm run bridge       # optional Claude Code bridge
node scripts/run.mjs <script.ts>   # run a TS script that imports src/ (via Vite's runner)
```

`npm test` and `npm run test:e2e` make no network or AI calls. `npm run
smoke:claude` makes one real subscription request; run it only on purpose.

## Layout

- `src/core/**` is pure and isomorphic. It must not import React, `src/platform`,
  `src/state` or `src/ui`. Tests and scripts run it in Node.
- `src/platform/**` is the only browser-API code (canvas, worker, IndexedDB).
- `bridge/**` and what it imports (`src/ai/{brief,prompt,suggestions}.ts`,
  `src/core/recipe/*`) are run by Node directly, so they use erasable TypeScript
  only and `.ts` import extensions. `tsconfig.bridge.json` enforces this.
- All imports use explicit `.ts`/`.tsx` extensions.
- `src/vendor/nayuki-qrcodegen/` is vendored at a pinned revision. Use its
  public API only, through `src/core/qr/encoder.ts`.

## Invariants (tests enforce these; do not weaken them)

- The payload is the exact input string as UTF-8. No code path rewrites it;
  corrections are explicit user actions. Repair never touches content.
- The core (symbol + 4-module quiet zone) is an opaque, uniform, light square.
  Compositions draw only outside it. Canvas size and core origin are whole
  module units.
- Structural modules keep their logical values and are drawn as squares. The
  only styling on them is the rounded finder, bounded by `FINDER_RADII`
  (measured against jsQR; see the architecture note before changing it).
- A logo panel never covers a protected module, and stays within
  `LOGO_BLOCK_LOAD_LIMIT` of the worst Reed-Solomon block's correctable errors.
  There is no area-percentage rule.
- One canonical SVG string per design: previewed and exported byte for byte.
  Bump `RENDERER_VERSION` when output for the same inputs changes.
- Verification results are keyed by configuration fingerprint. Status is a
  lookup for the current fingerprint; stale async results are dropped by
  `LatestJob`. Export hands over exactly the verified bytes (hash-checked).
- The stress profile is versioned. Changing a parameter means a new
  `STRESS_PROFILE.version`. Do not relax it to make a design pass.
- Decoders must stay independent (jsQR and ZXing-C++), with inversion disabled.
  ZXing's WASM is bundled; its package default fetches from a CDN.
- Recipes, project files, briefs and AI suggestions are strict Zod schemas
  (unknown keys rejected, bounded strings and numbers). Imported assets go
  through the same intake as uploads. Uploaded SVG is only ever used as an
  `<image>` data URL, never injected into the page.
- The bridge binds to loopback, checks exact Host and Origin plus the session
  token, accepts only a design brief, spawns the CLI with an argument array and
  an allowlisted environment, and never uses `--bare` or permission bypass.

## Gotchas

- Tool input here decodes the U+2028, U+2029 and U+FEFF backslash-u escapes into raw
  characters, which breaks regex literals. Use `\p{Zl}`, `\p{Zp}` or build the
  escape with string concatenation.
- opentype.js 2.0 throws in `font.getPath(text)` for fonts with certain GSUB
  tables. Layout is glyph by glyph in `src/core/render/fonts.ts`.
- jpeg-js returns through `Buffer.from` when bundled; `raster.ts` shims it.
- Radix Tabs unmount inactive panels: do not put start-up side effects in them.
