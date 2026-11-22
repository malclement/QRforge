/** Right panel, Design tab: every control edits the selected recipe through an undoable operation. */
import { MODULE_CONTRAST_MINIMUM } from '../core/brand/palette.ts';
import { contrastRatio } from '../core/color/color.ts';
import { compareEccLevels } from '../core/qr/encoder.ts';
import { DECORATION_LABELS, PRESET_META } from '../core/recipe/preset-meta.ts';
import { FONT_IDS, PRESET_IDS, type DesignRecipe, type FontId, type PresetId } from '../core/recipe/schema.ts';
import { FONT_LABELS } from '../core/render/fonts.ts';
import { LOGO_BLOCK_LOAD_LIMIT } from '../core/render/logo-layout.ts';
import { moduleContrast, repairAction } from '../core/verify/repair.ts';
import { changePreset, editRecipe, setEncoding } from '../state/actions.ts';
import { useDoc } from '../state/store.ts';
import { useEngine } from './engine.tsx';
import { Badge, Button, ColorField, cx, Note, Section, Segmented, SelectField, SliderField, SwitchField, TextField } from './kit.tsx';

type Patch<K extends keyof DesignRecipe> = Partial<DesignRecipe[K]>;

function patch<K extends 'modules' | 'palette' | 'logo' | 'frame' | 'caption'>(section: K, label: string, values: Patch<K>, key?: string) {
  editRecipe(label, (r) => ({ ...r, [section]: { ...(r[section] as object), ...values } }), key);
}

function CompositionSection({ recipe }: { recipe: DesignRecipe }) {
  const meta = PRESET_META[recipe.preset];
  return (
    <Section title="Composition">
      <div role="radiogroup" aria-label="Preset family" className="grid grid-cols-3 gap-1.5">
        {PRESET_IDS.map((id: PresetId) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={recipe.preset === id}
            title={PRESET_META[id].summary}
            onClick={() => changePreset(id)}
            className={cx(
              'h-8 rounded-md border text-[13px] transition-colors',
              recipe.preset === id ? 'border-ink bg-ink font-medium text-white' : 'border-line bg-panel text-ink-2 hover:border-ink-3 hover:text-ink',
            )}
          >
            {PRESET_META[id].name}
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-3">{meta.summary}</p>
      <SelectField
        label="Decoration"
        value={meta.decorations.includes(recipe.frame.decoration) ? recipe.frame.decoration : 'none'}
        options={meta.decorations.map((d) => ({ value: d, label: DECORATION_LABELS[d] }))}
        onChange={(decoration) => patch('frame', 'Change decoration', { decoration })}
      />
      <SliderField label="Frame padding" value={recipe.frame.padding} onChange={(padding) => patch('frame', 'Change padding', { padding }, 'padding')} />
      <SliderField label={meta.radiusLabel} value={recipe.frame.radius} onChange={(radius) => patch('frame', 'Change corners', { radius }, 'radius')} disabled={recipe.preset === 'emblem'} />
      {recipe.preset === 'pattern' ? <SliderField label="Motif density" value={recipe.frame.density} onChange={(density) => patch('frame', 'Change density', { density }, 'density')} /> : null}
    </Section>
  );
}

function ModulesSection({ recipe }: { recipe: DesignRecipe }) {
  const { modules } = recipe;
  return (
    <Section title="Modules">
      <Segmented
        label="Data module shape"
        value={modules.style}
        options={[
          { value: 'square', label: 'Square' },
          { value: 'rounded', label: 'Rounded' },
          { value: 'dots', label: 'Dots' },
          { value: 'chamfer', label: 'Angular' },
        ]}
        onChange={(style) => patch('modules', 'Change module shape', { style, roundness: style === 'square' ? modules.roundness : Math.max(modules.roundness, 0.5) })}
      />
      <SliderField
        label={modules.style === 'chamfer' ? 'Corner cut' : 'Corner rounding'}
        value={modules.roundness}
        disabled={modules.style === 'square' || modules.style === 'dots'}
        onChange={(roundness) => patch('modules', 'Change rounding', { roundness }, 'roundness')}
      />
      <SliderField
        label="Spacing between modules"
        value={modules.gap}
        onChange={(gap) => patch('modules', 'Change spacing', { gap }, 'gap')}
        hint="Bounded: a module never shrinks below 78% of its cell."
      />
      <Segmented
        label="Finder patterns"
        value={modules.finder}
        options={[
          { value: 'square', label: 'Square' },
          { value: 'rounded', label: 'Eased corners' },
        ]}
        onChange={(finder) => patch('modules', 'Change finder style', { finder })}
      />
      <p className="text-xs text-ink-3">Timing, alignment, format and version modules always stay plain squares. Finder corners can be eased within a limit both decoders accept.</p>
      <SwitchField label="Gradient on modules" checked={modules.gradient} onChange={(gradient) => patch('modules', 'Toggle gradient', { gradient })} hint="Blends between two dark tones. Verified like everything else." />
    </Section>
  );
}

function ColoursSection({ recipe }: { recipe: DesignRecipe }) {
  const { palette, modules } = recipe;
  const contrast = moduleContrast(recipe);
  const surface = PRESET_META[recipe.preset].textOn === 'light' ? palette.light : palette.frame;
  const textContrast = contrastRatio(palette.text, surface);
  const fix = repairAction('increase-contrast');
  const set = (key: keyof DesignRecipe['palette']) => (hex: string) => patch('palette', 'Change colour', { [key]: hex }, `colour-${key}`);
  return (
    <Section title="Colours">
      <ColorField label="Modules" value={palette.dark} onChange={set('dark')} />
      {modules.gradient ? <ColorField label="Gradient end" value={palette.darkAlt} onChange={set('darkAlt')} /> : null}
      <ColorField label="Symbol background" value={palette.light} onChange={set('light')} />
      <div className="flex items-center gap-2 text-xs text-ink-3">
        <Badge tone={contrast >= 7 ? 'ok' : contrast >= MODULE_CONTRAST_MINIMUM ? 'warn' : 'bad'}>{contrast.toFixed(1)}:1</Badge>
        <span>modules against the symbol background</span>
      </div>
      {contrast < MODULE_CONTRAST_MINIMUM ? (
        <Note tone="bad" role="alert">
          <div className="flex items-center justify-between gap-2">
            <span>This contrast is too low for dependable scanning.</span>
            <Button size="sm" className="shrink-0" onClick={() => editRecipe(fix.label, (r) => fix.apply({ recipe: r, pngWidth: 1024 }, { logoPlacement: 'none', canvasWidth: 1 })?.recipe ?? r)}>
              {fix.label}
            </Button>
          </div>
        </Note>
      ) : null}
      <ColorField label="Frame" value={palette.frame} onChange={set('frame')} />
      <ColorField label="Accent and decoration" value={palette.accent} onChange={set('accent')} />
      <ColorField
        label="Caption text"
        value={palette.text}
        onChange={set('text')}
        aside={textContrast < 3 ? <Badge tone="warn">low contrast</Badge> : undefined}
      />
    </Section>
  );
}

function LogoSection({ recipe }: { recipe: DesignRecipe }) {
  const { logo, design } = useEngine();
  const resolved = design?.render.logo;
  const occlusion = resolved?.occlusion;
  if (!logo) {
    return (
      <Section title="Logo">
        <p className="text-[13px] text-ink-3">Add a logo in the left panel to place it in or beside the symbol.</p>
      </Section>
    );
  }
  return (
    <Section title="Logo">
      <Segmented
        label="Placement"
        value={recipe.logo.placement}
        options={[
          { value: 'center', label: 'In the symbol' },
          { value: 'external', label: 'Outside' },
          { value: 'none', label: 'Hidden' },
        ]}
        onChange={(placement) => patch('logo', 'Move logo', { placement })}
      />
      {resolved && resolved.requested === 'center' && resolved.placement === 'external' ? (
        <Note tone="accent">{design?.render.notes[0] ?? 'The logo was placed outside the symbol to protect its structure.'}</Note>
      ) : null}
      <SliderField label="Size" value={recipe.logo.scale} disabled={recipe.logo.placement === 'none'} onChange={(scale) => patch('logo', 'Resize logo', { scale }, 'logo-scale')} />
      {recipe.logo.placement === 'center' ? (
        <Segmented
          label="Panel behind the logo"
          value={recipe.logo.panel}
          options={[
            { value: 'square', label: 'Square' },
            { value: 'rounded', label: 'Rounded' },
            { value: 'circle', label: 'Circle' },
          ]}
          onChange={(panel) => patch('logo', 'Change logo panel', { panel })}
        />
      ) : null}
      {resolved?.placement === 'external' ? (
        <SwitchField label="Light plate behind the logo" checked={recipe.logo.plate} onChange={(plate) => patch('logo', 'Toggle logo plate', { plate })} hint="Keeps the logo legible on dark or saturated frames." />
      ) : null}
      {resolved?.placement === 'center' && resolved.footprint && occlusion ? (
        <p className="text-xs leading-snug text-ink-3">
          Panel {resolved.footprint.w} × {resolved.footprint.h} modules. It covers {occlusion.occludedCodewords} of {occlusion.totalCodewords} codewords; the busiest error-correction block loses{' '}
          {Math.max(...occlusion.blocks.map((b) => b.occluded))} of the {occlusion.correctablePerBlock} it can correct ({Math.round(occlusion.worstBlockLoad * 100)}% of capacity, limit {Math.round(LOGO_BLOCK_LOAD_LIMIT * 100)}%). No protected
          pattern is touched. The decoded artwork, not this estimate, decides the result.
        </p>
      ) : null}
      {design?.render.notes.filter((n) => n.startsWith('Logo')).map((n) => (
        <p key={n} className="text-xs text-ink-3">
          {n}
        </p>
      ))}
    </Section>
  );
}

function CaptionSection({ recipe }: { recipe: DesignRecipe }) {
  const { design } = useEngine();
  const { caption } = recipe;
  const notes = design?.render.notes.filter((n) => n.includes('caption') || n.startsWith('Emblem')) ?? [];
  return (
    <Section title="Caption">
      <TextField label="Caption" value={caption.text} maxLength={60} onChange={(text) => patch('caption', 'Edit caption', { text }, 'caption-text')} />
      <TextField label="Detail line" value={caption.detail} maxLength={80} onChange={(detail) => patch('caption', 'Edit detail line', { detail }, 'caption-detail')} />
      <SelectField label="Typeface" value={caption.font} options={FONT_IDS.map((id: FontId) => ({ value: id, label: FONT_LABELS[id] }))} onChange={(font) => patch('caption', 'Change typeface', { font })} />
      <SliderField label="Size" value={caption.size} onChange={(size) => patch('caption', 'Resize caption', { size }, 'caption-size')} />
      <SliderField label="Letter-spacing" value={caption.tracking} onChange={(tracking) => patch('caption', 'Change letter-spacing', { tracking }, 'caption-tracking')} />
      <SwitchField label="Uppercase" checked={caption.uppercase} onChange={(uppercase) => patch('caption', 'Toggle uppercase', { uppercase })} />
      {notes.map((n) => (
        <Note key={n} tone="warn">
          {n}
        </Note>
      ))}
      <p className="text-xs text-ink-3">Captions are converted to outlines from bundled fonts, so exports need no font files.</p>
    </Section>
  );
}

const ECC_NAMES = { L: 'L — low', M: 'M — medium', Q: 'Q — quartile', H: 'H — high' } as const;

function AdvancedSection({ recipe }: { recipe: DesignRecipe }) {
  const doc = useDoc();
  const { design, payload } = useEngine();
  const options = payload.encodable ? compareEccLevels(doc.content.text, { minVersion: doc.content.minVersion, mask: doc.content.mask, eci: doc.content.eci }) : [];
  const canvas = design?.render.width ?? 0;
  return (
    <Section title="Advanced">
      <div>
        <div className="mb-1 text-[13px] text-ink-2">Error correction</div>
        <div role="radiogroup" aria-label="Error correction level" className="overflow-hidden rounded-md border border-line">
          {(['L', 'M', 'Q', 'H'] as const).map((level) => {
            const option = options.find((o) => o.ecc === level);
            const modulePx = option?.size && canvas && design ? design.png.width / (canvas - design.symbol.size + option.size) : null;
            const selected = recipe.ecc === level;
            return (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!!option && option.version === null}
                onClick={() => editRecipe('Change error correction', (r) => ({ ...r, ecc: level }))}
                className={cx(
                  'flex w-full items-center justify-between gap-2 border-b border-line-2 px-2.5 py-1.5 text-left text-[13px] last:border-b-0 disabled:cursor-not-allowed disabled:opacity-50',
                  selected ? 'bg-ink text-white' : 'bg-panel text-ink-2 hover:bg-wash',
                )}
              >
                <span className="font-medium">{ECC_NAMES[level]}</span>
                <span className={cx('text-xs tabular-nums', selected ? 'text-white/80' : 'text-ink-3')}>
                  {!option ? '' : option.version === null ? 'content does not fit' : `v${option.version}, ${option.size}×${option.size}${modulePx ? `, ~${modulePx.toFixed(1)} px/module` : ''}`}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-xs leading-snug text-ink-3">
          A higher level corrects more damaged codewords but needs a larger, denser symbol. Compare the pixels per module at your export size; a logo in the symbol usually calls for Q or H.
        </p>
      </div>
      <SelectField
        label="Minimum version"
        value={String(doc.content.minVersion)}
        options={Array.from({ length: 40 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? '1 (smallest that fits)' : `${i + 1} (${(i + 1) * 4 + 17}×${(i + 1) * 4 + 17})` }))}
        onChange={(v) => setEncoding({ minVersion: Number(v) })}
      />
      <SelectField
        label="Mask pattern"
        value={String(doc.content.mask)}
        options={[{ value: 'auto', label: 'Automatic (lowest penalty)' }, ...Array.from({ length: 8 }, (_, i) => ({ value: String(i), label: `Pattern ${i}` }))]}
        onChange={(v) => setEncoding({ mask: v === 'auto' ? 'auto' : Number(v) })}
        hint={design ? `In use: pattern ${design.symbol.mask}.` : undefined}
      />
      <SwitchField
        label="Declare UTF-8 with an ECI header"
        checked={doc.content.eci}
        onChange={(eci) => setEncoding({ eci })}
        hint="Off by default: content is UTF-8 without a header, which scanners read most widely. Turn on for readers that require the declaration; a few older ones mishandle it."
      />
    </Section>
  );
}

export function Inspector() {
  const doc = useDoc();
  const recipe = doc.variations[doc.selected];
  return (
    <div>
      <div className="border-b border-line-2 px-4 py-3">
        <TextField label="Variation name" value={recipe.title} maxLength={60} onChange={(title) => editRecipe('Rename variation', (r) => ({ ...r, title }), 'title')} />
        {recipe.explanation ? <p className="mt-2 text-xs leading-snug text-ink-3">{recipe.explanation}</p> : null}
      </div>
      <CompositionSection recipe={recipe} />
      <ModulesSection recipe={recipe} />
      <ColoursSection recipe={recipe} />
      <LogoSection recipe={recipe} />
      <CaptionSection recipe={recipe} />
      <AdvancedSection recipe={recipe} />
    </div>
  );
}
