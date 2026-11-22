/** Left panel: what to encode, the brand, and the creative direction. */
import { ImagePlus, Trash2, Dices } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { assetDataUrl, AssetError, formatBytes } from '../core/brand/assets.ts';
import { MODULE_CONTRAST_MINIMUM, type BrandRoles } from '../core/brand/palette.ts';
import { contrastRatio } from '../core/color/color.ts';
import { variationsArePristine } from '../core/project/defaults.ts';
import { STYLE_ATTRIBUTES, STYLE_ATTRIBUTE_HINTS } from '../core/recipe/presets.ts';
import { ingestLogo } from '../platform/logo-ingest.ts';
import {
  applyContentFix,
  regenerate,
  removeLogo,
  reproposeRoles,
  setBrandName,
  setBrandRole,
  setContentText,
  setDirection,
  setLogo,
  setSwatch,
  toggleAttribute,
} from '../state/actions.ts';
import { useDoc, useStudio } from '../state/store.ts';
import { useEngine } from './engine.tsx';
import { Badge, Button, ColorField, cx, Field, inputClass, Note, Section, TextField } from './kit.tsx';

function ContentSection() {
  const doc = useDoc();
  const { payload, design, designError } = useEngine();
  const id = useId();
  const text = doc.content.text;
  return (
    <Section title="1. Content">
      <Field label="URL or text" htmlFor={id}>
        <textarea
          id={id}
          value={text}
          onChange={(e) => setContentText(e.target.value)}
          rows={3}
          spellCheck={false}
          placeholder="https://example.com/your-page"
          className={cx(inputClass, 'resize-y py-2 font-mono text-[13px] leading-snug')}
        />
      </Field>

      {payload.issues.map((issue) => (
        <Note key={issue.code} tone={issue.severity === 'error' ? 'bad' : issue.severity === 'warning' ? 'warn' : 'neutral'} role={issue.severity === 'error' ? 'alert' : undefined}>
          <div className="flex items-start justify-between gap-2">
            <span>{issue.message}</span>
            {issue.fixLabel ? (
              <Button size="sm" className="shrink-0" onClick={() => applyContentFix(issue.code)}>
                {issue.fixLabel}
              </Button>
            ) : null}
          </div>
        </Note>
      ))}
      {designError ? (
        <Note tone="bad" role="alert">
          {designError}
        </Note>
      ) : null}

      {text.length > 0 ? (
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[13px] text-ink-2">Exact encoded content</span>
            <span className="text-xs tabular-nums text-ink-3" data-testid="payload-bytes">
              {payload.encodable ? `${payload.bytes.length} bytes` : 'not encodable'}
            </span>
          </div>
          <pre data-testid="payload-preview" className="scroll-thin max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md bg-wash px-2.5 py-2 font-mono text-xs leading-snug text-ink">
            {visibleWhitespace(text)}
          </pre>
          <p className="mt-1 text-xs text-ink-3">
            Encoded byte for byte as UTF-8{design ? ` in ${design.symbol.mode} mode` : ''}. Nothing is shortened or rewritten. Spaces show as · and line breaks as ↵.
          </p>
        </div>
      ) : null}
    </Section>
  );
}

function visibleWhitespace(text: string): string {
  return text.replace(/ /g, '·').replace(/\t/g, '→').replace(/\r/g, '␍').replace(/\n/g, '↵\n');
}

const ROLE_LABELS: Record<keyof BrandRoles, string> = {
  dark: 'Modules',
  light: 'Symbol background',
  accent: 'Accent',
  support: 'Support',
};

function BrandSection() {
  const doc = useDoc();
  const { logo } = useEngine();
  const notify = useStudio((s) => s.notify);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const { brand } = doc;
  const logoUrl = useMemo(() => (logo ? assetDataUrl(logo) : null), [logo]);

  const accept = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { asset, palette } = await ingestLogo(file, file.name);
      setLogo(asset, palette);
      notify('success', `Logo added. ${palette.swatches.length} colour${palette.swatches.length === 1 ? '' : 's'} extracted.`);
    } catch (e) {
      if (e instanceof AssetError) setError({ message: e.message, details: e.details });
      else setError({ message: 'The logo could not be read.', details: [] });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const contrast = contrastRatio(brand.roles.dark, brand.roles.light);
  const stale = !variationsArePristine(doc);

  return (
    <Section title="2. Logo and brand">
      <TextField label="Brand name" value={brand.name} maxLength={60} placeholder="Optional" onChange={setBrandName} />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void accept(e.dataTransfer.files[0]);
        }}
        className={cx('rounded-lg border border-dashed p-3 transition-colors', dragging ? 'border-accent bg-accent-soft' : 'border-line bg-wash')}
      >
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" className="sr-only" id="logo-file" onChange={(e) => void accept(e.target.files?.[0])} />
        {logo && logoUrl ? (
          <div className="flex items-center gap-3">
            <div className="transparency flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-panel ring-1 ring-line">
              <img src={logoUrl} alt="Uploaded logo" className="max-h-14 max-w-14 object-contain" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium" title={logo.name}>
                {logo.name}
              </p>
              <p className="text-xs text-ink-3">
                {Math.round(logo.width)} × {Math.round(logo.height)}, {logo.mime === 'image/svg+xml' ? 'vector (sanitized)' : 'PNG (re-encoded)'}, {formatBytes(logo.bytes.length)}
              </p>
              <div className="mt-1.5 flex gap-1.5">
                <Button size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
                  Replace
                </Button>
                <Button size="sm" variant="ghost" onClick={removeLogo} aria-label="Remove logo">
                  <Trash2 size={14} aria-hidden /> Remove
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <ImagePlus size={22} className="text-ink-3" aria-hidden />
            <p className="text-[13px] text-ink-2">Drop a logo here, or</p>
            <Button size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? 'Reading…' : 'Choose a file'}
            </Button>
            <p className="text-xs text-ink-3">PNG, JPEG, WebP or static SVG, up to 5 MB. Processed on this device.</p>
          </div>
        )}
      </div>
      {error ? (
        <Note tone="bad" role="alert">
          <p>{error.message}</p>
          {error.details.length > 0 ? (
            <ul className="mt-1 list-disc pl-4">
              {error.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
        </Note>
      ) : null}

      {brand.swatches.length > 0 ? (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[13px] text-ink-2">Extracted from the logo</span>
            <button type="button" className="text-xs text-accent hover:underline" onClick={reproposeRoles}>
              Propose roles again
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {brand.swatches.map((swatch, i) => (
              <label key={i} className="group relative" title={`${swatch.hex}, ${Math.round(swatch.weight * 100)}% of the logo`}>
                <span className="sr-only">Swatch {i + 1}</span>
                <input type="color" value={swatch.hex} onChange={(e) => setSwatch(i, e.target.value)} className="h-8 w-8 cursor-pointer rounded-md ring-1 ring-line" />
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="text-[13px] text-ink-2">Palette roles</div>
        {(Object.keys(ROLE_LABELS) as (keyof BrandRoles)[]).map((role) => (
          <ColorField key={role} label={ROLE_LABELS[role]} value={brand.roles[role]} onChange={(hex) => setBrandRole(role, hex)} />
        ))}
        <div className="flex items-center gap-2 text-xs text-ink-3">
          <Badge tone={contrast >= 7 ? 'ok' : contrast >= MODULE_CONTRAST_MINIMUM ? 'warn' : 'bad'}>{contrast.toFixed(1)}:1</Badge>
          <span>module contrast against the symbol background</span>
        </div>
      </div>
      {brand.notes.length > 0 ? (
        <details className="rounded-md bg-wash px-3 py-2 text-xs text-ink-2">
          <summary className="cursor-pointer text-[13px] text-ink">How these roles were chosen</summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            {brand.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-ink-3">These are colour measurements from the logo's pixels, not an interpretation of the brand. Adjust any role above.</p>
        </details>
      ) : null}
      {stale ? (
        <Note tone="accent">
          <div className="flex items-center justify-between gap-2">
            <span>Edited designs keep their own colours. Generate again to apply brand changes to all six.</span>
            <Button size="sm" className="shrink-0" onClick={() => regenerate(false)}>
              Generate
            </Button>
          </div>
        </Note>
      ) : null}
    </Section>
  );
}

function DirectionSection() {
  const doc = useDoc();
  const { direction } = doc;
  const id = useId();
  return (
    <Section title="3. Direction">
      <div>
        <div className="mb-1.5 text-[13px] text-ink-2">Style attributes</div>
        <div className="flex flex-wrap gap-1.5">
          {STYLE_ATTRIBUTES.map((attribute) => {
            const on = direction.attributes.includes(attribute);
            return (
              <button
                key={attribute}
                type="button"
                aria-pressed={on}
                title={STYLE_ATTRIBUTE_HINTS[attribute]}
                onClick={() => toggleAttribute(attribute)}
                className={cx(
                  'h-7 rounded-full border px-3 text-[13px] capitalize transition-colors',
                  on ? 'border-ink bg-ink text-white' : 'border-line bg-panel text-ink-2 hover:border-ink-3 hover:text-ink',
                )}
              >
                {attribute}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-ink-3">Each attribute shifts fixed design parameters. No AI is involved.</p>
      </div>
      <TextField label="Caption" value={direction.caption} maxLength={60} placeholder="Scan me" onChange={(caption) => setDirection({ caption }, 'direction-caption')} />
      <TextField label="Detail line" value={direction.detail} maxLength={80} placeholder="Optional, e.g. a short address" onChange={(detail) => setDirection({ detail }, 'direction-detail')} />
      <Field label="Describe the direction" htmlFor={id} hint="Used only in the AI design brief. The built-in presets do not read it.">
        <textarea
          id={id}
          rows={2}
          maxLength={600}
          value={direction.brief}
          onChange={(e) => setDirection({ brief: e.target.value }, 'direction-brief')}
          placeholder="e.g. calm and botanical, lots of white space"
          className={cx(inputClass, 'resize-y py-2 text-[13px] leading-snug')}
        />
      </Field>
      <div className="flex gap-2">
        <Button variant="primary" className="flex-1" onClick={() => regenerate(false)}>
          Generate six variations
        </Button>
        <Button onClick={() => regenerate(true)} title="Generate a different set (new seed)" aria-label="Generate a different set">
          <Dices size={16} aria-hidden />
        </Button>
      </div>
      <p className="text-xs text-ink-3">Generating replaces the current six. Undo brings them back.</p>
    </Section>
  );
}

export function LeftPanel() {
  return (
    <div>
      <ContentSection />
      <BrandSection />
      <DirectionSection />
    </div>
  );
}
