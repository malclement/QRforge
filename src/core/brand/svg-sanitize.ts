/**
 * SVG logo intake: a narrow static subset, enforced twice.
 *
 * 1. An explicit allowlist pass that REJECTS the file, with reasons, when it
 *    finds scripts, event handlers, foreignObject, external references,
 *    animation, embedded images, live text, or anything outside the subset.
 *    Nothing is silently "fixed" at this stage, so a user is told why a file
 *    was refused.
 * 2. DOMPurify, as defence in depth, on whatever passed.
 *
 * The result is only ever used as an `<image>` data URL. It is never inserted
 * into the live document.
 */
import createDOMPurify from 'dompurify';
import { ASSET_LIMITS, AssetError } from './assets.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'metadata', 'symbol', 'use',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'marker', 'style',
  'filter', 'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix', 'feComposite', 'feFlood', 'feMerge', 'feMergeNode', 'feDropShadow', 'feComponentTransfer', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA',
]);

const REJECTION_REASONS: Record<string, string> = {
  script: 'contains a script',
  foreignObject: 'contains foreignObject (embedded HTML)',
  image: 'embeds or links another image',
  feImage: 'references an image from a filter',
  a: 'contains a hyperlink',
  text: 'contains live text (convert text to outlines)',
  tspan: 'contains live text (convert text to outlines)',
  textPath: 'contains live text (convert text to outlines)',
  animate: 'contains animation',
  animateMotion: 'contains animation',
  animateTransform: 'contains animation',
  set: 'contains animation',
  iframe: 'contains an embedded frame',
  object: 'contains an embedded object',
  embed: 'contains an embedded object',
  audio: 'contains media',
  video: 'contains media',
};

// `url(...)` may only point at a fragment of the same file.
const URL_FUNCTION = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

function unsafeCss(css: string): string | null {
  if (/@import/i.test(css)) return 'uses @import';
  if (/expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(css)) return 'contains active CSS';
  if (/@font-face/i.test(css)) return 'declares a web font';
  for (const match of css.matchAll(URL_FUNCTION)) {
    if (!match[2].trim().startsWith('#')) return 'references an external resource from CSS';
  }
  return null;
}

export interface SanitizedSvg {
  svg: string;
  width: number;
  height: number;
}

function parseLength(value: string | null): number | null {
  if (!value) return null;
  const m = /^\s*([0-9]*\.?[0-9]+)(px)?\s*$/.exec(value);
  return m ? Number(m[1]) : null;
}

/**
 * Validate and sanitize SVG text. `win` supplies DOMParser/XMLSerializer and is
 * the window DOMPurify binds to (the browser window, or a jsdom window in tests).
 */
export function sanitizeSvg(text: string, win: Window & typeof globalThis): SanitizedSvg {
  if (text.length > ASSET_LIMITS.maxSvgBytes) {
    throw new AssetError('too-large', `SVG logos are limited to ${ASSET_LIMITS.maxSvgBytes / 1024} KB.`);
  }
  const problems = new Set<string>();
  if (/<!ENTITY/i.test(text)) problems.add('declares XML entities');

  const doc = new win.DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.getElementsByTagName('parsererror').length > 0 || !root || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) {
    throw new AssetError('invalid-svg', 'This file is not a well-formed SVG document.');
  }

  const elements = [root, ...Array.from(root.getElementsByTagName('*'))];
  if (elements.length > ASSET_LIMITS.maxSvgElements) {
    throw new AssetError('too-large', `The SVG has ${elements.length} elements; the limit is ${ASSET_LIMITS.maxSvgElements}.`);
  }
  for (const el of elements) {
    const name = el.localName;
    if (el.namespaceURI !== SVG_NS) {
      // Editor metadata in foreign namespaces is inert and removed later; anything else is refused.
      if (!el.closest('metadata')) problems.add(`contains a non-SVG element <${el.nodeName}>`);
      continue;
    }
    if (REJECTION_REASONS[name]) problems.add(REJECTION_REASONS[name]);
    else if (!ALLOWED_ELEMENTS.has(name)) problems.add(`uses an unsupported element <${name}>`);

    if (name === 'style') {
      const issue = unsafeCss(el.textContent ?? '');
      if (issue) problems.add(`style block ${issue}`);
    }
    for (const attr of Array.from(el.attributes)) {
      const attrName = attr.localName.toLowerCase();
      const value = attr.value;
      if (attrName.startsWith('on')) problems.add(`has an event handler (${attr.name})`);
      if (attrName === 'href' && !value.trim().startsWith('#')) problems.add('references an external resource');
      if (attrName === 'src') problems.add('references an external resource');
      if (/javascript:|data:text\/html/i.test(value)) problems.add('contains a script URL');
      if (attrName === 'style') {
        const issue = unsafeCss(value);
        if (issue) problems.add(`inline style ${issue}`);
      } else {
        for (const match of value.matchAll(URL_FUNCTION)) {
          if (!match[2].trim().startsWith('#')) problems.add('references an external resource');
        }
      }
    }
  }
  if (problems.size > 0) {
    throw new AssetError('unsafe-svg', 'This SVG was rejected because it is outside the supported static subset.', [...problems]);
  }

  // Intrinsic size: explicit width/height in px, else the viewBox.
  const viewBox = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const hasViewBox = viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0;
  const width = parseLength(root.getAttribute('width')) ?? (hasViewBox ? viewBox[2] : null);
  const height = parseLength(root.getAttribute('height')) ?? (hasViewBox ? viewBox[3] : null);
  if (!width || !height || width <= 0 || height <= 0) {
    throw new AssetError('invalid-svg', 'The SVG needs a viewBox, or a width and height in pixels, so its proportions are known.');
  }

  const hadStyle = root.getElementsByTagName('style').length > 0;
  const purify = createDOMPurify(win);
  const body = purify.sanitize(new win.XMLSerializer().serializeToString(root), {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['use', 'style'],
    FORBID_TAGS: ['image', 'a', 'foreignObject', 'script', 'text', 'tspan', 'textPath', 'animate', 'animateMotion', 'animateTransform', 'set'],
    RETURN_DOM: true,
  }) as unknown as Element;
  const clean = body.querySelector('svg');
  if (!clean) throw new AssetError('invalid-svg', 'Nothing drawable was left after sanitizing this SVG.');
  if (hadStyle && clean.getElementsByTagName('style').length === 0) {
    throw new AssetError('unsafe-svg', 'This SVG relies on a style block that could not be kept safely. Export it with presentation attributes instead.');
  }
  clean.querySelectorAll('metadata').forEach((node) => node.remove());
  if (!hasViewBox) clean.setAttribute('viewBox', `0 0 ${width} ${height}`);
  clean.setAttribute('xmlns', SVG_NS);
  const svg = new win.XMLSerializer().serializeToString(clean);
  return { svg, width, height };
}
