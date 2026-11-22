/**
 * The design brief: the only thing ever sent to a model.
 *
 * It describes the brand's look in compact terms. It deliberately has no field
 * for the encoded URL or text, and none for the logo image itself: the model
 * chooses a style and does not need either.
 */
import { z } from 'zod';
import { STYLE_ATTRIBUTES } from '../core/recipe/presets.ts';
import { HexColor } from '../core/recipe/schema.ts';

export const BRIEF_VERSION = 1;
export const MAX_SUGGESTIONS = 4;

const singleLine = (max: number) => z.string().max(max).regex(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u);

export const DesignBriefSchema = z.strictObject({
  briefVersion: z.literal(BRIEF_VERSION),
  brand: z.strictObject({
    name: singleLine(60),
    /** Colours extracted from the logo, most prominent first. */
    palette: z.array(HexColor).max(8),
    roles: z.strictObject({ dark: HexColor, light: HexColor, accent: HexColor, support: HexColor }),
    logo: z.strictObject({
      present: z.boolean(),
      /** Width divided by height. */
      aspect: z.number().min(0.05).max(20).nullable(),
      kind: z.enum(['vector', 'raster']).nullable(),
    }),
  }),
  styleWords: z.array(z.enum(STYLE_ATTRIBUTES)).max(STYLE_ATTRIBUTES.length),
  /** The user's own description of the direction they want. Untrusted text. */
  instruction: z.string().max(600),
  count: z.int().min(1).max(MAX_SUGGESTIONS),
});

export type DesignBrief = z.infer<typeof DesignBriefSchema>;

export interface BriefSource {
  brand: {
    name: string;
    swatches: { hex: string }[];
    roles: { dark: string; light: string; accent: string; support: string };
    logo: { mime: string; width: number; height: number } | null;
  };
  direction: { attributes: readonly (typeof STYLE_ATTRIBUTES)[number][]; brief: string };
}

export function buildBrief(source: BriefSource, count = 3): DesignBrief {
  const logo = source.brand.logo;
  return DesignBriefSchema.parse({
    briefVersion: BRIEF_VERSION,
    brand: {
      name: source.brand.name,
      palette: source.brand.swatches.map((s) => s.hex.toLowerCase()),
      roles: source.brand.roles,
      logo: {
        present: logo !== null,
        aspect: logo ? Math.round(Math.min(20, Math.max(0.05, logo.width / logo.height)) * 100) / 100 : null,
        kind: logo ? (logo.mime === 'image/svg+xml' ? 'vector' : 'raster') : null,
      },
    },
    styleWords: [...source.direction.attributes],
    instruction: source.direction.brief,
    count,
  } satisfies DesignBrief);
}
