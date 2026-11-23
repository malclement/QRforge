# Third-party notices

Bundled with the built application:

| Component | Licence | Notes |
| --- | --- | --- |
| QR Code generator (Project Nayuki) | MIT | Vendored in `src/vendor/nayuki-qrcodegen`, with its licence |
| jsQR | Apache-2.0 | Decoder |
| zxing-wasm / ZXing-C++ | MIT / Apache-2.0 | Decoder, WebAssembly |
| jpeg-js | BSD-3-Clause | JPEG round trip in the stress profile |
| opentype.js | MIT | Font parsing for caption outlines |
| DOMPurify | Apache-2.0 or MPL-2.0 | SVG sanitizing |
| React, Zustand, Zod, Dexie, Radix UI, Lucide | MIT / ISC / Apache-2.0 | Application framework |
| Inter, Fraunces, Space Grotesk, DM Mono, Nunito, IBM Plex Sans | SIL Open Font License 1.1 | Font files from the `@fontsource/*` packages |

Each package's full licence text is in its directory under `node_modules`.
`npm run build` collects them into `dist/THIRD_PARTY_LICENSES.md`, so a hosted
build carries its notices.
Captions in exported artwork are outlines generated from the OFL fonts above,
which the licence permits.

The sample brands, logos and example projects in `public/examples` are original
to this project and fictional.
