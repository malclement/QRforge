/**
 * One design, fully resolved: payload -> symbol -> canonical SVG, plus the data
 * a verification run and its report need. Pure; shared by the editor, the
 * worker protocol, tests and scripts.
 */
import type { LogoAsset } from './brand/assets.ts';
import { toLogoImage } from './brand/assets.ts';
import type { Content } from './project/schema.ts';
import { ENCODER_ID, encodeQr, type QrSymbol } from './qr/encoder.ts';
import type { DesignRecipe } from './recipe/schema.ts';
import type { FontRegistry } from './render/fonts.ts';
import { alignedWidth, pngGeometry, renderDesign, RENDERER_VERSION, type RenderResult } from './render/render.ts';
import { sha256Hex } from './util/bytes.ts';
import type { QrDecoder } from './verify/decoders.ts';
import type { CheckOutput, FingerprintInput } from './verify/pipeline.ts';
import { SVG_CHECK_WIDTHS, STRESS_PROFILE } from './verify/profile.ts';
import { REPORT_VERSION, type ValidationReport } from './verify/report.ts';

export interface DesignInput {
  content: Content;
  recipe: DesignRecipe;
  logo: LogoAsset | null;
  fonts: FontRegistry;
  /** Requested PNG width. */
  pngWidth: number;
  /** Snap the PNG width to a whole number of pixels per module. */
  align?: boolean;
}

export interface BuiltDesign {
  input: DesignInput;
  symbol: QrSymbol;
  render: RenderResult;
  /** The canonical artwork: previewed and exported as-is. */
  svg: string;
  png: { width: number; height: number; modulePx: number; aligned: boolean };
  fingerprintInput: FingerprintInput;
}

/** True when the recipe actually draws the logo somewhere. */
export function recipeUsesLogo(recipe: DesignRecipe): boolean {
  return recipe.logo.placement !== 'none' || (recipe.preset === 'pattern' && recipe.frame.decoration === 'logo-tile');
}

/** Throws QrEncodeError when the content cannot be encoded. */
export function buildDesign(input: DesignInput): BuiltDesign {
  const { content, recipe, fonts, pngWidth } = input;
  const symbol = encodeQr(content.text, { ecc: recipe.ecc, minVersion: content.minVersion, mask: content.mask, eci: content.eci });
  const logo = input.logo && recipeUsesLogo(recipe) ? input.logo : null;
  const render = renderDesign({ symbol, recipe, logo: logo ? toLogoImage(logo) : null, fonts });
  const width = input.align ? alignedWidth(render, pngWidth) : pngWidth;
  return {
    input,
    symbol,
    render,
    svg: render.svg,
    png: pngGeometry(render, width),
    fingerprintInput: {
      content: { text: content.text, eci: content.eci, minVersion: content.minVersion, mask: content.mask },
      recipe,
      assetHashes: logo ? [logo.hash] : [],
      encoder: ENCODER_ID,
      rendererVersion: RENDERER_VERSION,
      pngWidth: width,
      profile: { id: STRESS_PROFILE.id, version: STRESS_PROFILE.version },
    },
  };
}

export interface ReportParts {
  fingerprint: string;
  design: BuiltDesign;
  pngBytes: Uint8Array;
  checks: CheckOutput;
  decoders: Pick<QrDecoder, 'id' | 'name' | 'version' | 'settings'>[];
  /** Description of how the SVG was rasterized for checking. */
  rasterizer: string;
  svgRasterSizes: { width: number; height: number }[];
  durationMs: number;
  createdAt: string;
}

export async function assembleReport(parts: ReportParts): Promise<ValidationReport> {
  const { design, checks } = parts;
  const svgBytes = new TextEncoder().encode(design.svg);
  const stress = checks.stress;
  return {
    format: 'qrstudio.validation-report',
    version: REPORT_VERSION,
    fingerprint: parts.fingerprint,
    createdAt: parts.createdAt,
    durationMs: Math.round(parts.durationMs),
    payload: { byteLength: design.symbol.payloadBytes.length, sha256: await sha256Hex(design.symbol.payloadBytes) },
    symbol: {
      encoder: ENCODER_ID,
      rendererVersion: RENDERER_VERSION,
      version: design.symbol.version,
      ecc: design.symbol.ecc,
      mask: design.symbol.mask,
      modules: design.symbol.size,
    },
    decoders: parts.decoders.map((d) => ({ id: d.id, name: d.name, version: d.version, settings: d.settings })),
    artifacts: {
      png: { sha256: await sha256Hex(parts.pngBytes), byteLength: parts.pngBytes.length, width: design.png.width, height: design.png.height, modulePx: Math.round(design.png.modulePx * 1000) / 1000 },
      svg: {
        sha256: await sha256Hex(svgBytes),
        byteLength: svgBytes.length,
        rasterizations: parts.svgRasterSizes.map((s) => ({ ...s, background: '#ffffff' })),
        rasterizer: parts.rasterizer,
      },
    },
    baseline: { passed: checks.baseline.length > 0 && checks.baseline.every((c) => c.outcome === 'pass'), checks: checks.baseline },
    stress: stress
      ? {
          profile: { id: STRESS_PROFILE.id, version: STRESS_PROFILE.version },
          workingSize: stress.workingSize,
          passed: stress.checks.filter((c) => c.outcome === 'pass').length,
          total: stress.checks.length,
          checks: stress.checks,
        }
      : null,
    experimentalOverride: false,
  };
}

/** Pixel sizes at which the exported SVG is rasterized for its baseline checks. */
export function svgCheckSizes(design: BuiltDesign): { width: number; height: number }[] {
  return SVG_CHECK_WIDTHS.map((width) => ({ width, height: Math.max(1, Math.round((width * design.render.height) / design.render.width)) }));
}
