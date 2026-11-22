import { describe, expect, it } from 'vitest';
import { buildBrief, DesignBriefSchema } from '../src/ai/brief.ts';
import { parsePairingCode } from '../src/ai/bridge-client.ts';
import { handoffDocument, userPrompt } from '../src/ai/prompt.ts';
import { isPlainText, parseSuggestionsText, SuggestionError, suggestionsJsonSchema, suggestionToRecipe, validateSuggestions } from '../src/ai/suggestions.ts';
import { createDefaultDoc } from '../src/core/project/defaults.ts';
import { DesignRecipeSchema } from '../src/core/recipe/schema.ts';
import { bytesEqual, utf8Encode } from '../src/core/util/bytes.ts';
import { design, GOOD_SUGGESTION as GOOD, URL_TEXT } from './fixtures.ts';
import { nodeDecoders, rasterizeSvg } from './helpers.ts';

const envelope = (...suggestions: unknown[]) => ({ suggestionsVersion: 1, suggestions });
const context = { seed: 7, caption: 'Scan me', detail: 'example line', hasLogo: true };

function rejected(raw: unknown): SuggestionError {
  try {
    validateSuggestions(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(SuggestionError);
    return error as SuggestionError;
  }
  throw new Error('expected rejection');
}

describe('design brief', () => {
  const doc = createDefaultDoc();
  doc.content.text = 'https://private.example/secret-campaign?token=abc123';
  doc.brand = { ...doc.brand, name: 'Kelvane', logo: { hash: 'a'.repeat(64), mime: 'image/svg+xml', width: 300, height: 100, name: 'secret-logo-name.svg' }, swatches: [{ hex: '#2F5BFF', weight: 1 }] };
  doc.direction = { ...doc.direction, attributes: ['bold'], brief: 'Nautical, confident' };

  it('carries palette, logo proportions and style words, and nothing else', () => {
    const brief = buildBrief(doc, 3);
    expect(DesignBriefSchema.parse(brief)).toEqual(brief);
    expect(brief.brand.logo).toEqual({ present: true, aspect: 3, kind: 'vector' });
    expect(brief.brand.palette).toEqual(['#2f5bff']);
    expect(brief.styleWords).toEqual(['bold']);
    const everything = JSON.stringify(brief) + userPrompt(brief) + handoffDocument(brief);
    for (const secret of ['private.example', 'secret-campaign', 'token=abc123', 'secret-logo-name', 'a'.repeat(64), 'data:image']) expect(everything).not.toContain(secret);
    expect(Object.keys(brief).sort()).toEqual(['brand', 'briefVersion', 'count', 'instruction', 'styleWords']);
  });

  it('is a strict schema: extra fields such as a payload or an image are rejected', () => {
    const brief = buildBrief(doc, 2);
    expect(DesignBriefSchema.safeParse({ ...brief, payload: 'https://x.example' }).success).toBe(false);
    expect(DesignBriefSchema.safeParse({ ...brief, brand: { ...brief.brand, logoData: 'data:image/png;base64,AAAA' } }).success).toBe(false);
    expect(DesignBriefSchema.safeParse({ ...brief, count: 50 }).success).toBe(false);
    expect(DesignBriefSchema.safeParse({ ...brief, instruction: 'x'.repeat(601) }).success).toBe(false);
  });

  it('produces a self-contained hand-off document with the schema and instructions', () => {
    const text = handoffDocument(buildBrief(doc, 2));
    expect(text).toContain('"additionalProperties": false');
    expect(text).toContain('Nautical, confident');
    expect(text).toMatch(/does not contain the QR code content/);
    expect(text).toContain('precision');
  });
});

describe('suggestion validation', () => {
  it('accepts a well-formed suggestion and turns it into a full, valid recipe', () => {
    const { suggestions } = validateSuggestions(envelope(GOOD));
    const { recipe, adjustments } = suggestionToRecipe(suggestions[0], 0, context);
    expect(DesignRecipeSchema.parse(recipe)).toEqual(recipe);
    expect(recipe.palette.dark).toBe('#0d1326');
    expect(recipe.caption.detail).toBe('example line'); // empty text falls back to the user's own
    expect(adjustments).toEqual([]);
    expect(suggestionToRecipe(suggestions[0], 0, context).recipe.seed).toBe(recipe.seed);
  });

  it('applies the application constraints instead of trusting the suggestion', () => {
    const { suggestions } = validateSuggestions(envelope({ ...GOOD, preset: 'precision', frame: { ...GOOD.frame, decoration: 'beads' } }));
    const { recipe, adjustments } = suggestionToRecipe(suggestions[0], 0, { ...context, hasLogo: false });
    expect(recipe.frame.decoration).toBe('ticks');
    expect(recipe.logo.placement).toBe('none');
    expect(adjustments).toHaveLength(2);
  });

  it('a suggestion goes through the normal renderer and decodes to the untouched payload', async () => {
    const { recipe } = suggestionToRecipe(validateSuggestions(envelope(GOOD)).suggestions[0], 0, context);
    const built = design(recipe);
    const raster = rasterizeSvg(built.svg, 900);
    for (const decoder of nodeDecoders()) {
      const result = await decoder.decode(raster);
      expect(result.decoded && bytesEqual(result.bytes!, utf8Encode(URL_TEXT)), decoder.id).toBe(true);
    }
  });

  const BAD: [string, unknown][] = [
    ['an unknown key', { ...GOOD, matrix: [[1, 0, 1]] }],
    ['a payload override', { ...GOOD, payload: 'https://evil.example' }],
    ['a quiet-zone override', { ...GOOD, modules: { ...GOOD.modules, quietZone: 0 } }],
    ['raw SVG in a text field', { ...GOOD, title: '<svg onload=alert(1)>' }],
    ['HTML in the explanation', { ...GOOD, explanation: 'Nice <img src=x onerror=alert(1)> design' }],
    ['a URL in the caption', { ...GOOD, caption: { ...GOOD.caption, text: 'Visit https://evil.example' } }],
    ['a filesystem path', { ...GOOD, caption: { ...GOOD.caption, detail: 'see /etc/passwd' } }],
    ['a home path', { ...GOOD, explanation: 'read ~/.ssh/id_rsa' }],
    ['a shell substitution', { ...GOOD, title: '$(curl evil)' }],
    ['a template expression', { ...GOOD, title: '{{constructor}}' }],
    ['backticks', { ...GOOD, title: '`rm -rf`' }],
    ['a line break in a caption', { ...GOOD, caption: { ...GOOD.caption, text: 'a\nb' } }],
    ['an unknown preset', { ...GOOD, preset: 'hologram' }],
    ['an out-of-range number', { ...GOOD, logo: { ...GOOD.logo, scale: 1.5 } }],
    ['a negative number', { ...GOOD, frame: { ...GOOD.frame, padding: -0.1 } }],
    ['a CSS colour function', { ...GOOD, palette: { ...GOOD.palette, frame: 'url(https://evil.example/x)' } }],
    ['an overlong title', { ...GOOD, title: 'x'.repeat(61) }],
    ['a number as a string', { ...GOOD, modules: { ...GOOD.modules, gap: '0.2' } }],
  ];
  for (const [name, suggestion] of BAD) {
    it(`rejects ${name}`, () => {
      const error = rejected(envelope(suggestion));
      expect(error.details.length).toBeGreaterThan(0);
    });
  }

  it('bounds the number of suggestions and requires the envelope version', () => {
    rejected(envelope());
    rejected(envelope(GOOD, GOOD, GOOD, GOOD, GOOD));
    rejected({ suggestionsVersion: 2, suggestions: [GOOD] });
    rejected({ suggestionsVersion: 1, suggestions: [GOOD], command: 'whoami' });
    rejected('just text');
    rejected(null);
  });

  it('parses pasted replies: fenced JSON, a bare suggestion, and refuses the rest', () => {
    expect(parseSuggestionsText('Here you go:\n```json\n' + JSON.stringify(envelope(GOOD)) + '\n```\nEnjoy!').suggestions).toHaveLength(1);
    expect(parseSuggestionsText(JSON.stringify(GOOD)).suggestions[0].title).toBe('Harbour seal');
    expect(() => parseSuggestionsText('not json at all')).toThrow(/not valid JSON/);
    expect(() => parseSuggestionsText('x'.repeat(200_001))).toThrow(/too much text/);
    expect(() => parseSuggestionsText('{"__proto__": {"polluted": true}, "preset": "soft"}')).toThrow(SuggestionError);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('plain-text check allows ordinary captions', () => {
    for (const ok of ['Scan to explore', 'Open 24/7', 'Menu & tasting notes', 'kelvane.example', 'Tom’s café — née 1998!', '50% off: today only']) expect(isPlainText(ok), ok).toBe(true);
    for (const bad of ['<b>', 'a`b', 'http://x.example', './run.sh', 'C:\\Windows', '${x}', 'see ../secrets']) expect(isPlainText(bad), bad).toBe(false);
  });

  it('exports a closed JSON Schema with enums and numeric limits', () => {
    const schema = suggestionsJsonSchema() as { additionalProperties: boolean; properties: { suggestions: { maxItems: number; items: { additionalProperties: boolean; properties: Record<string, { enum?: string[]; properties: Record<string, object> }> } } } };
    const item = schema.properties.suggestions.items;
    expect(schema.additionalProperties).toBe(false);
    expect(item.additionalProperties).toBe(false);
    expect(item.properties.preset.enum).toHaveLength(6);
    expect(item.properties.logo.properties.scale).toMatchObject({ minimum: 0, maximum: 1 });
    expect(schema.properties.suggestions.maxItems).toBe(4);
    expect(JSON.stringify(schema).length).toBeLessThan(8000);
  });
});

describe('pairing code', () => {
  it('accepts only a loopback port and a long token', () => {
    const token = 'A'.repeat(43);
    expect(parsePairingCode(`4317:${token}`)).toEqual({ url: 'http://127.0.0.1:4317', token });
    expect(parsePairingCode(token)?.url).toBe('http://127.0.0.1:4317');
    expect(parsePairingCode('80:' + token)).toBeNull();
    expect(parsePairingCode('4317:short')).toBeNull();
    expect(parsePairingCode('evil.example:4317:' + token)).toBeNull();
    expect(parsePairingCode('')).toBeNull();
  });
});
