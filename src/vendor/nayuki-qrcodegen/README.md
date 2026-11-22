# Vendored: Project Nayuki QR Code generator (TypeScript)

- Upstream: https://github.com/nayuki/QR-Code-generator — `typescript-javascript/qrcodegen.ts`
- Pinned revision: `9a217d443937f60cc56c1458c39a211d7f2d3af5` (2026-11-03)
- Upstream file SHA-256: `239c01a99206650266402e8fe5dd34739e7d4e7190df215412fa0d3e2365afa2`
- License: MIT (see `LICENSE`; the full notice is also kept at the top of `qrcodegen.ts`)

The upstream file is copied verbatim. One line is appended at the end
(`export { qrcodegen };`) so the namespace can be imported as an ES module.
Upstream publishes no npm package, which is why the file is vendored.

Only the public API is used, through `src/core/qr/encoder.ts`:
`QrCode.encodeSegments`, `QrCode#getModule`, `version`, `size`, `mask`,
`errorCorrectionLevel`, `QrSegment.makeSegments / makeBytes / makeEci`.
The private `isFunction` grid is **not** read; the function-module map is
computed independently in `src/core/qr/structure.ts` and tested against the
encoder's observable output.

To update: replace the file with the new upstream revision, re-append the
export line, and update the revision and hash above.
