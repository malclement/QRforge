/**
 * The six compositions. Each one arranges a frame, decoration, caption and an
 * optional external logo around the "core": the square symbol plus its
 * four-module quiet zone. Nothing drawn here enters the core.
 *
 * All measurements are in module units. Canvas dimensions and the core origin
 * are whole numbers so that modules can land on pixel boundaries.
 */
import type { Rng } from '../util/rng.ts';
import type { DesignRecipe } from '../recipe/schema.ts';
import { PRESET_META } from '../recipe/preset-meta.ts';
import { arcTextPath, formatNumber as f, layoutText, textPath, type FontRegistry, type TextLayout } from './fonts.ts';
import { chamferRectPath, circlePath, rectPath } from './geometry.ts';

export interface LogoImage {
  /** `data:image/png;base64,…` or `data:image/svg+xml;base64,…`, already validated. */
  dataUrl: string;
  width: number;
  height: number;
  hash: string;
}

export interface ComposeContext {
  /** Core size: symbol modules plus the quiet zone on both sides. */
  core: number;
  recipe: DesignRecipe;
  fonts: FontRegistry;
  logo: LogoImage | null;
  /** True when the logo is drawn outside the symbol by this composition. */
  externalLogo: boolean;
  rng: Rng;
  notes: string[];
}

export interface Composition {
  width: number;
  height: number;
  core: { x: number; y: number };
  /** Outline of the artwork. Everything outside it is transparent. */
  canvasPath: string;
  defs: string[];
  /** Drawn on the frame, clipped to the canvas, before the core. */
  under: string[];
  /** Drawn after the symbol: captions and the external logo. */
  over: string[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const CAP = 0.72; // approximate cap height, used for vertical rhythm before fonts are measured

function path(d: string, fill: string, extra = ''): string {
  return d ? `<path d="${d}" fill="${fill}"${extra}/>` : '';
}
function stroke(d: string, color: string, width: number, extra = ''): string {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f(width)}"${extra}/>`;
}
function image(logo: LogoImage, x: number, y: number, w: number, h: number, extra = ''): string {
  return `<image href="${logo.dataUrl}" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" preserveAspectRatio="xMidYMid meet"${extra}/>`;
}

/** An external logo, optionally on a light plate so it stays legible on a dark or saturated frame. */
function externalLogo(ctx: ComposeContext, x: number, y: number, w: number, h: number): string {
  const logo = ctx.logo as LogoImage;
  if (!ctx.recipe.logo.plate) return image(logo, x, y, w, h);
  const pad = Math.max(0.45, Math.min(w, h) * 0.14);
  const plate = path(rectPath(x, y, w, h, Math.min(w, h) * 0.22), ctx.recipe.palette.light);
  return plate + image(logo, x + pad, y + pad, w - pad * 2, h - pad * 2);
}

function styled(ctx: ComposeContext, text: string): string {
  return ctx.recipe.caption.uppercase ? text.toUpperCase() : text;
}

/** Lay out a line, shrinking it to fit `maxWidth`. Records glyphs the font lacks. */
function fit(ctx: ComposeContext, text: string, size: number, maxWidth: number, trackingScale = 1): TextLayout {
  const face = ctx.fonts[ctx.recipe.caption.font];
  const tracking = ctx.recipe.caption.tracking * 0.22 * trackingScale;
  let layout = layoutText(face, styled(ctx, text), size, tracking);
  if (layout.width > maxWidth && layout.width > 0) layout = layoutText(face, styled(ctx, text), (size * maxWidth) / layout.width, tracking);
  if (layout.missing.length > 0) {
    const note = `The caption font has no glyph for: ${layout.missing.join(' ')} (skipped).`;
    if (!ctx.notes.includes(note)) ctx.notes.push(note);
  }
  return layout;
}

function capHeight(ctx: ComposeContext): number {
  return ctx.fonts[ctx.recipe.caption.font].capHeight;
}

interface Sizes {
  caption: string;
  detail: string;
  hasText: boolean;
  has: boolean;
  cs: number;
  ds: number;
  textBlock: number;
}

function sizes(ctx: ComposeContext, base: number, range: number): Sizes {
  const { caption } = ctx.recipe;
  const cs = ctx.core * (base + range * caption.size);
  const ds = Math.max(1.05, cs * 0.6);
  const hasCaption = caption.text.trim().length > 0;
  const hasDetail = caption.detail.trim().length > 0;
  const textBlock = (hasCaption ? cs * CAP : 0) + (hasCaption && hasDetail ? cs * 0.55 : 0) + (hasDetail ? ds * CAP : 0);
  return {
    caption: caption.text.trim(),
    detail: caption.detail.trim(),
    hasText: hasCaption || hasDetail,
    has: hasCaption || hasDetail || ctx.externalLogo,
    cs,
    ds,
    textBlock,
  };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Logo on one side, caption and detail stacked on the other, centred vertically. */
function lockupRow(ctx: ComposeContext, box: Box, s: Sizes, logoH: number, logoSide: 'left' | 'right', color: string): string[] {
  const out: string[] = [];
  let x0 = box.x;
  let x1 = box.x + box.w;
  if (ctx.externalLogo && ctx.logo) {
    const aspect = ctx.logo.width / ctx.logo.height;
    let h = Math.min(logoH, box.h);
    let w = h * aspect;
    const maxW = box.w * (s.hasText ? 0.42 : 1);
    if (w > maxW) {
      w = maxW;
      h = w / aspect;
    }
    const lx = logoSide === 'left' ? box.x : box.x + box.w - w;
    out.push(externalLogo(ctx, lx, box.y + (box.h - h) / 2, w, h));
    if (logoSide === 'left') x0 = lx + w + 1.4;
    else x1 = lx - 1.4;
  }
  const maxWidth = Math.max(1, x1 - x0);
  const cap = capHeight(ctx);
  const captionLayout = s.caption ? fit(ctx, s.caption, s.cs, maxWidth) : null;
  const detailLayout = s.detail ? fit(ctx, s.detail, s.ds, maxWidth, 1.4) : null;
  const ch = captionLayout ? captionLayout.size * cap : 0;
  const dh = detailLayout ? detailLayout.size * cap : 0;
  const gap = captionLayout && detailLayout ? s.cs * 0.5 : 0;
  let y = box.y + (box.h - (ch + gap + dh)) / 2;
  if (captionLayout) {
    y += ch;
    out.push(path(textPath(captionLayout, x0, y), color));
    y += gap;
  }
  if (detailLayout) {
    y += dh;
    out.push(path(textPath(detailLayout, x0, y), color, ' fill-opacity="0.72"'));
  }
  return out;
}

/** Logo above caption above detail, all centred. */
function lockupStack(ctx: ComposeContext, box: Box, s: Sizes, logoH: number, color: string): string[] {
  const out: string[] = [];
  const cap = capHeight(ctx);
  const captionLayout = s.caption ? fit(ctx, s.caption, s.cs, box.w) : null;
  const detailLayout = s.detail ? fit(ctx, s.detail, s.ds, box.w, 1.4) : null;
  let lw = 0;
  let lh = 0;
  if (ctx.externalLogo && ctx.logo) {
    const aspect = ctx.logo.width / ctx.logo.height;
    lh = logoH;
    lw = lh * aspect;
    if (lw > box.w * 0.72) {
      lw = box.w * 0.72;
      lh = lw / aspect;
    }
  }
  const ch = captionLayout ? captionLayout.size * cap : 0;
  const dh = detailLayout ? detailLayout.size * cap : 0;
  const gapLogo = lh && (ch || dh) ? 1.3 : 0;
  const gapText = ch && dh ? s.cs * 0.5 : 0;
  let y = box.y + (box.h - (lh + gapLogo + ch + gapText + dh)) / 2;
  const mid = box.x + box.w / 2;
  if (lh && ctx.logo) {
    out.push(externalLogo(ctx, mid - lw / 2, y, lw, lh));
    y += lh + gapLogo;
  }
  if (captionLayout) {
    y += ch;
    out.push(path(textPath(captionLayout, mid - captionLayout.width / 2, y), color));
    y += gapText;
  }
  if (detailLayout) {
    y += dh;
    out.push(path(textPath(detailLayout, mid - detailLayout.width / 2, y), color, ' fill-opacity="0.72"'));
  }
  return out;
}

function decoration(ctx: ComposeContext): string {
  const { preset, frame } = ctx.recipe;
  return PRESET_META[preset].decorations.includes(frame.decoration) ? frame.decoration : 'none';
}

// ---------------------------------------------------------------- Precision

function precision(ctx: ComposeContext): Composition {
  const { recipe, core: C } = ctx;
  const { palette, frame, logo } = recipe;
  const p = 2 + Math.round(frame.padding * 3);
  const s = sizes(ctx, 0.05, 0.035);
  const logoH = C * lerp(0.09, 0.17, logo.scale);
  const bandH = s.has ? Math.ceil(Math.max(ctx.externalLogo ? logoH : 0, s.textBlock) + 1.6) : 0;
  const W = C + 2 * p;
  const H = p + C + (s.has ? 1 + bandH : 0) + p;
  const under: string[] = [];
  const deco = decoration(ctx);
  if (deco === 'ticks') {
    const o = 0.9;
    const L = 2.4;
    const x0 = p - o, y0 = p - o, x1 = p + C + o, y1 = p + C + o;
    const d =
      `M${f(x0)} ${f(y0 + L)}V${f(y0)}H${f(x0 + L)}M${f(x1 - L)} ${f(y0)}H${f(x1)}V${f(y0 + L)}` +
      `M${f(x1)} ${f(y1 - L)}V${f(y1)}H${f(x1 - L)}M${f(x0 + L)} ${f(y1)}H${f(x0)}V${f(y1 - L)}`;
    under.push(stroke(d, palette.accent, 0.24, ' stroke-linecap="square"'));
  } else if (deco === 'hairline') {
    under.push(stroke(rectPath(p - 0.9, p - 0.9, C + 1.8, C + 1.8), palette.accent, 0.16));
  }
  const over: string[] = [];
  if (s.has) {
    over.push(stroke(`M${f(p)} ${f(p + C + 0.55)}H${f(p + C)}`, palette.text, 0.1, ' stroke-opacity="0.35"'));
    over.push(...lockupRow(ctx, { x: p, y: p + C + 1, w: C, h: bandH }, s, logoH, 'right', palette.text));
  }
  return { width: W, height: H, core: { x: p, y: p }, canvasPath: rectPath(0, 0, W, H, frame.radius * 3), defs: [], under, over };
}

// --------------------------------------------------------------------- Soft

function soft(ctx: ComposeContext): Composition {
  const { recipe, core: C, rng } = ctx;
  const { palette, frame, logo } = recipe;
  const p = 4 + Math.round(frame.padding * 3);
  const m = 2;
  const s = sizes(ctx, 0.06, 0.04);
  const logoH = C * lerp(0.12, 0.24, logo.scale);
  const bandH = s.has ? Math.ceil((ctx.externalLogo ? logoH + (s.hasText ? 1.3 : 0) : 0) + s.textBlock + 1.2) : 0;
  const W = C + 2 * p;
  const H = s.has ? p + C + m + 1 + bandH + p - 1 : W;
  const under: string[] = [];
  const deco = decoration(ctx);
  if (deco === 'blobs') {
    const spots: [number, number, number, number][] = [
      [lerp(0.02, 0.16, rng()), lerp(0.02, 0.18, rng()), lerp(0.24, 0.34, rng()), 0.3],
      [lerp(0.86, 1, rng()), lerp(0.22, 0.42, rng()), lerp(0.18, 0.28, rng()), 0.2],
      [lerp(0.12, 0.34, rng()), lerp(0.9, 1.02, rng()), lerp(0.2, 0.32, rng()), 0.24],
    ];
    for (const [fx, fy, fr, opacity] of spots) under.push(path(circlePath(fx * W, fy * H, fr * W), palette.accent, ` fill-opacity="${opacity}"`));
  } else if (deco === 'halo') {
    for (const [offset, opacity] of [[1.2, 0.55], [2.4, 0.28]] as const) {
      const r = lerp(2, 6, frame.radius) + offset;
      under.push(stroke(rectPath(p - m - offset, p - m - offset, C + 2 * (m + offset), C + 2 * (m + offset), r), palette.accent, 0.3, ` stroke-opacity="${opacity}"`));
    }
  }
  // The panel extends two modules past the quiet zone, so its rounded corners never cut into it.
  under.push(path(rectPath(p - m, p - m, C + 2 * m, C + 2 * m, lerp(2, 6, frame.radius)), palette.light));
  const over = s.has ? lockupStack(ctx, { x: p - m, y: p + C + m + 1, w: C + 2 * m, h: bandH }, s, logoH, palette.text) : [];
  return { width: W, height: H, core: { x: p, y: p }, canvasPath: rectPath(0, 0, W, H, lerp(2.5, 0.2 * W, frame.radius)), defs: [], under, over };
}

// ---------------------------------------------------------------- Editorial

function editorial(ctx: ComposeContext): Composition {
  const { recipe, core: C } = ctx;
  const { palette, frame, logo, caption } = recipe;
  const p = 5 + Math.round(frame.padding * 3);
  const heading = caption.text.trim();
  const detail = caption.detail.trim();
  const hs = C * (0.105 + 0.06 * caption.size);
  const headH = heading ? Math.ceil(hs * 0.95 + 1.5) : 0;
  const ds = Math.max(1.15, C * 0.045);
  const logoH = C * lerp(0.1, 0.19, logo.scale);
  const hasFoot = detail.length > 0 || ctx.externalLogo;
  const footH = hasFoot ? Math.ceil(Math.max(ctx.externalLogo ? logoH : 0, ds * CAP) + 1.6) : 0;
  const W = C + 2 * p;
  const coreY = p + (headH ? headH + 1 : 0);
  const H = coreY + C + (hasFoot ? 1 + footH : 0) + p;
  const under: string[] = [];
  const over: string[] = [];
  const deco = decoration(ctx);
  if (deco === 'bar') under.push(path(rectPath(0, 0, W, 1.4), palette.accent));
  if (deco === 'rules') {
    if (headH) over.push(stroke(`M${f(p)} ${f(coreY - 0.6)}H${f(p + C)}`, palette.text, 0.12));
    if (hasFoot) over.push(stroke(`M${f(p)} ${f(coreY + C + 0.6)}H${f(p + C)}`, palette.text, 0.12));
  }
  if (heading) {
    const layout = fit(ctx, heading, hs, C, 0.4);
    const baseline = p + (headH - layout.size * capHeight(ctx)) / 2 + layout.size * capHeight(ctx);
    over.push(path(textPath(layout, p, baseline), palette.text));
  }
  if (hasFoot) {
    const footer: Sizes = { caption: '', detail, hasText: detail.length > 0, has: true, cs: ds, ds, textBlock: ds * CAP };
    over.push(...lockupRow(ctx, { x: p, y: coreY + C + 1, w: C, h: footH }, footer, logoH, 'right', palette.text));
  }
  return { width: W, height: H, core: { x: p, y: coreY }, canvasPath: rectPath(0, 0, W, H, frame.radius * 2), defs: [], under, over };
}

// ---------------------------------------------------------------- Technical

function technical(ctx: ComposeContext): Composition {
  const { recipe, core: C, rng } = ctx;
  const { palette, frame, logo } = recipe;
  const p = 5 + Math.round(frame.padding * 2);
  const s = sizes(ctx, 0.045, 0.03);
  const logoH = C * lerp(0.09, 0.16, logo.scale);
  const bandH = s.has ? Math.ceil(Math.max(ctx.externalLogo ? logoH : 0, s.textBlock) + 1.4) : 0;
  const W = C + 2 * p;
  const H = p + C + (s.has ? 1 + bandH : 0) + p;
  const under: string[] = [];
  const deco = decoration(ctx);
  const x0 = p, y0 = p, x1 = p + C, y1 = p + C;
  if (deco === 'grid') {
    let d = '';
    for (let x = 1; x < W; x += 2) d += `M${f(x)} 0V${f(H)}`;
    for (let y = 1; y < H; y += 2) d += `M0 ${f(y)}H${f(W)}`;
    under.push(stroke(d, palette.accent, 0.07, ' stroke-opacity="0.3"'));
  }
  if (deco === 'ruler') {
    let d = '';
    for (let i = 0; i <= C; i++) {
      const len = i % 4 === 0 ? 1.1 : 0.5;
      d += `M${f(x0 + i)} ${f(y0 - 0.9)}v${f(-len)}M${f(x0 + i)} ${f(y1 + 0.9)}v${f(len)}`;
      d += `M${f(x0 - 0.9)} ${f(y0 + i)}h${f(-len)}M${f(x1 + 0.9)} ${f(y0 + i)}h${f(len)}`;
    }
    under.push(stroke(d, palette.accent, 0.13));
  }
  if (deco === 'brackets' || deco === 'grid') {
    const o = 1.3;
    const L = Math.min(6, C * 0.16);
    const d =
      `M${f(x0 - o)} ${f(y0 - o + L)}V${f(y0 - o)}H${f(x0 - o + L)}M${f(x1 + o - L)} ${f(y0 - o)}H${f(x1 + o)}V${f(y0 - o + L)}` +
      `M${f(x1 + o)} ${f(y1 + o - L)}V${f(y1 + o)}H${f(x1 + o - L)}M${f(x0 - o + L)} ${f(y1 + o)}H${f(x0 - o)}V${f(y1 + o - L)}`;
    under.push(stroke(d, palette.accent, deco === 'grid' ? 0.26 : 0.5, ' stroke-linecap="square"'));
  }
  if (deco !== 'none') {
    // Small registration squares; the seed decides which corners carry one.
    const inset = Math.max(1.6, frame.radius * 4 + 0.9);
    const corners: [number, number][] = [[inset, inset], [W - inset, inset], [W - inset, H - inset], [inset, H - inset]];
    const skip = Math.floor(rng() * 4);
    let d = '';
    corners.forEach(([cx, cy], i) => {
      if (i !== skip) d += rectPath(cx - 0.35, cy - 0.35, 0.7, 0.7);
    });
    under.push(path(d, palette.accent));
  }
  const over = s.has ? lockupRow(ctx, { x: p, y: p + C + 1, w: C, h: bandH }, s, logoH, 'right', palette.text) : [];
  return { width: W, height: H, core: { x: p, y: p }, canvasPath: chamferRectPath(0, 0, W, H, frame.radius * 4), defs: [], under, over };
}

// ------------------------------------------------------------------- Emblem

function emblem(ctx: ComposeContext): Composition {
  const { recipe, core: C } = ctx;
  const { palette, frame, logo, caption } = recipe;
  const ring = 4 + Math.round(frame.padding * 3);
  const cornerRadius = C / Math.SQRT2;
  const W = 2 * Math.ceil(cornerRadius + ring) + 1; // odd, like the core, so the core origin is a whole number
  const R = W / 2;
  const cx = R;
  const cy = R;
  const deco = decoration(ctx);
  const under: string[] = [];
  let canvasPath = circlePath(cx, cy, R);
  let edge = 1;
  if (deco === 'double-ring') {
    under.push(stroke(circlePath(cx, cy, R - 0.95), palette.accent, 0.5));
    under.push(stroke(circlePath(cx, cy, R - 1.95), palette.accent, 0.16));
    edge = 2.5;
  } else if (deco === 'beads') {
    const beadRadius = R - 1.3;
    const count = Math.round((2 * Math.PI * beadRadius) / 2.4);
    let d = '';
    for (let i = 0; i < count; i++) {
      const a = (i / count) * 2 * Math.PI;
      d += circlePath(cx + beadRadius * Math.sin(a), cy - beadRadius * Math.cos(a), 0.42);
    }
    under.push(path(d, palette.accent));
    edge = 2.3;
  } else if (deco === 'scallop') {
    const base = R - 1;
    const count = Math.round((2 * Math.PI * base) / 3);
    const bump = (Math.PI * base) / count;
    canvasPath = circlePath(cx, cy, base);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * 2 * Math.PI;
      canvasPath += circlePath(cx + base * Math.sin(a), cy - base * Math.cos(a), Math.min(bump, 1));
    }
    under.push(stroke(circlePath(cx, cy, base - 0.9), palette.accent, 0.16));
    edge = 2.4;
  }

  const over: string[] = [];
  const inner = cornerRadius + 0.8;
  const outer = R - edge;
  const thickness = outer - inner;
  const cap = capHeight(ctx);
  const maxSize = Math.max(0.8, (thickness * 0.82) / cap);
  const heading = caption.text.trim();
  const detail = caption.detail.trim();
  if (heading) {
    const size = Math.min(maxSize, C * (0.07 + 0.05 * caption.size));
    const baseline = inner + (thickness - size * cap) / 2;
    const layout = fit(ctx, heading, size, baseline * ((100 * Math.PI) / 180));
    over.push(path(arcTextPath(layout, cx, cy, inner + (thickness - layout.size * cap) / 2, 'top'), palette.text));
  }
  if (ctx.externalLogo && ctx.logo) {
    // Largest box of the logo's proportions that fits in the segment below the core.
    const aspect = ctx.logo.width / ctx.logo.height;
    const top = cy + C / 2 + 1;
    const limit = outer - 0.3;
    let lo = 0;
    let hi = limit;
    for (let i = 0; i < 30; i++) {
      const h = (lo + hi) / 2;
      const ok = ((h * aspect) / 2) ** 2 + (top + h - cy) ** 2 <= limit * limit;
      if (ok) lo = h;
      else hi = h;
    }
    const h = lo * lerp(0.7, 1, logo.scale);
    const w = h * aspect;
    if (h > 0.5) over.push(externalLogo(ctx, cx - w / 2, top + (lo - h) / 2, w, h));
    if (detail) ctx.notes.push('Emblem shows the logo on the lower ring, in place of the detail line.');
  } else if (detail) {
    const size = Math.min(maxSize, Math.max(1.05, C * (0.05 + 0.03 * caption.size)));
    const layout = fit(ctx, detail, size, outer * ((100 * Math.PI) / 180), 1.4);
    over.push(path(arcTextPath(layout, cx, cy, outer - (thickness - layout.size * cap) / 2, 'bottom'), palette.text, ' fill-opacity="0.8"'));
  }
  const origin = (W - C) / 2;
  return { width: W, height: W, core: { x: origin, y: origin }, canvasPath, defs: [], under, over };
}

// ------------------------------------------------------------------ Pattern

function pattern(ctx: ComposeContext): Composition {
  const { recipe, core: C, rng } = ctx;
  const { palette, frame, logo } = recipe;
  const p = 6 + Math.round(frame.padding * 3);
  const m = 1.5;
  const s = sizes(ctx, 0.055, 0.035);
  const logoH = C * lerp(0.1, 0.18, logo.scale);
  const labelH = s.has ? Math.ceil(Math.max(ctx.externalLogo ? logoH : 0, s.textBlock) + 2) : 0;
  const W = C + 2 * p;
  const H = s.has ? 2 * p + C + 1 + labelH : W;
  const defs: string[] = [];
  const under: string[] = [];
  let deco = decoration(ctx);
  if (deco === 'logo-tile' && !ctx.logo) {
    deco = 'dots';
    ctx.notes.push('Logo tiles need a logo, so dots are shown until one is added.');
  }
  const t = lerp(4.6, 2.6, frame.density);
  const turn = [0, 45, -30, 30][Math.floor(rng() * 4)];
  const shift = `translate(${f(rng() * t)} ${f(rng() * t)})`;
  let tile = '';
  let tileSize = t;
  let rotation = turn;
  if (deco === 'dots') {
    tile = `<circle cx="${f(t / 4)}" cy="${f(t / 4)}" r="${f(t * 0.13)}" fill="${palette.accent}"/><circle cx="${f((3 * t) / 4)}" cy="${f((3 * t) / 4)}" r="${f(t * 0.13)}" fill="${palette.accent}"/>`;
  } else if (deco === 'diagonal') {
    tile = `<rect width="${f(t * 0.36)}" height="${f(t)}" fill="${palette.accent}"/>`;
    rotation = turn === 0 ? 45 : turn;
  } else if (deco === 'plus') {
    const a = t * 0.24;
    const w = t * 0.085;
    const c = t / 2;
    tile = `<path d="${rectPath(c - a, c - w, 2 * a, 2 * w)}${rectPath(c - w, c - a, 2 * w, 2 * a)}" fill="${palette.accent}"/>`;
  } else if (deco === 'waves') {
    tile = `<path d="M0 ${f(t / 2)}Q${f(t / 4)} ${f(t * 0.12)} ${f(t / 2)} ${f(t / 2)}T${f(t)} ${f(t / 2)}" fill="none" stroke="${palette.accent}" stroke-width="${f(t * 0.11)}"/>`;
    rotation = turn === 45 ? 0 : turn;
  } else if (deco === 'logo-tile' && ctx.logo) {
    tileSize = lerp(9, 5.6, frame.density);
    const box = tileSize * 0.6;
    tile = image(ctx.logo, (tileSize - box) / 2, (tileSize - box) / 2, box, box, ' opacity="0.4"');
    rotation = -12;
  }
  if (tile) {
    defs.push(
      `<pattern id="qs-motif" width="${f(tileSize)}" height="${f(tileSize)}" patternUnits="userSpaceOnUse" patternTransform="rotate(${rotation}) ${shift}">${tile}</pattern>`,
    );
    under.push(`<rect width="${W}" height="${H}" fill="url(#qs-motif)"/>`);
  }
  const panelRadius = lerp(0.6, 4.5, frame.radius);
  under.push(path(rectPath(p - m, p - m, C + 2 * m, C + 2 * m, panelRadius), palette.light));
  const over: string[] = [];
  if (s.has) {
    const label = { x: p - m, y: p + C + 3, w: C + 2 * m, h: labelH };
    over.push(path(rectPath(label.x, label.y, label.w, label.h, Math.min(panelRadius, labelH / 2)), palette.light));
    over.push(...lockupRow(ctx, { x: label.x + 1.6, y: label.y, w: label.w - 3.2, h: label.h }, s, logoH, 'left', palette.text));
  }
  return { width: W, height: H, core: { x: p, y: p }, canvasPath: rectPath(0, 0, W, H, frame.radius * 5), defs, under, over };
}

const COMPOSERS = { precision, soft, editorial, technical, emblem, pattern };

export function compose(ctx: ComposeContext): Composition {
  return COMPOSERS[ctx.recipe.preset](ctx);
}
