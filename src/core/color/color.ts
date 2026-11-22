/** Colour maths: hex parsing, OKLab/OKLCH conversion, and WCAG contrast. */

export interface Rgb255 {
  r: number;
  g: number;
  b: number;
}
export interface Oklch {
  l: number;
  c: number;
  /** Hue in degrees, 0-360. */
  h: number;
}

export function parseHex(hex: string): Rgb255 {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Invalid colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }: Rgb255): string {
  const c = (v: number) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function isHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

const toLinear = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return s * 255;
};

export function rgbToOklab({ r, g, b }: Rgb255): [number, number, number] {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function hexToOklch(hex: string): Oklch {
  const [l, a, b] = rgbToOklab(parseHex(hex));
  const c = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l, c, h: c < 1e-4 ? 0 : h };
}

/** Convert to sRGB hex, reducing chroma until the colour fits the gamut. */
export function oklchToHex({ l, c, h }: Oklch): string {
  const rad = (h * Math.PI) / 180;
  let chroma = Math.max(0, c);
  const L = Math.min(1, Math.max(0, l));
  for (let i = 0; i < 24; i++) {
    const [r, g, b] = oklabToLinear(L, chroma * Math.cos(rad), chroma * Math.sin(rad));
    const inGamut = [r, g, b].every((v) => v >= -0.0005 && v <= 1.0005);
    if (inGamut || chroma < 0.002) {
      return toHex({ r: fromLinear(Math.min(1, Math.max(0, r))), g: fromLinear(Math.min(1, Math.max(0, g))), b: fromLinear(Math.min(1, Math.max(0, b))) });
    }
    chroma *= 0.9;
  }
  const [r, g, b] = oklabToLinear(L, 0, 0);
  return toHex({ r: fromLinear(r), g: fromLinear(g), b: fromLinear(b) });
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2 contrast ratio, 1-21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Perceptual distance in OKLab. Around 0.02 is a just-noticeable difference. */
export function colorDistance(a: string, b: string): number {
  const [l1, a1, b1] = rgbToOklab(parseHex(a));
  const [l2, a2, b2] = rgbToOklab(parseHex(b));
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * Darken a colour, keeping its hue, until it reaches the target contrast
 * against `against`. Returns the input when it already qualifies.
 */
export function darkenToContrast(hex: string, against: string, target: number): string {
  if (contrastRatio(hex, against) >= target) return hex.toLowerCase();
  const base = hexToOklch(hex);
  for (let l = base.l; l >= 0; l -= 0.01) {
    const candidate = oklchToHex({ l, c: Math.min(base.c, 0.16), h: base.h });
    if (contrastRatio(candidate, against) >= target) return candidate;
  }
  return '#000000';
}

export function withLightness(hex: string, l: number, chromaScale = 1): string {
  const base = hexToOklch(hex);
  return oklchToHex({ l, c: base.c * chromaScale, h: base.h });
}

/** Mix two colours in OKLab. `t` = 0 gives `a`, 1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const [l1, a1, b1] = rgbToOklab(parseHex(a));
  const [l2, a2, b2] = rgbToOklab(parseHex(b));
  const [r, g, bl] = oklabToLinear(l1 + (l2 - l1) * t, a1 + (a2 - a1) * t, b1 + (b2 - b1) * t);
  return toHex({ r: fromLinear(Math.min(1, Math.max(0, r))), g: fromLinear(Math.min(1, Math.max(0, g))), b: fromLinear(Math.min(1, Math.max(0, bl))) });
}

/** Black or white, whichever reads better on the given background. */
export function readableOn(background: string, dark = '#111111', light = '#ffffff'): string {
  return contrastRatio(dark, background) >= contrastRatio(light, background) ? dark : light;
}
