/** The comparison strip: every variation rendered for real, with its own verification state. */
import { X } from 'lucide-react';
import type { BuiltDesign } from '../core/design.ts';
import { PRESET_META } from '../core/recipe/preset-meta.ts';
import type { DesignRecipe } from '../core/recipe/schema.ts';
import { statusLabel } from '../core/verify/report.ts';
import { removeVariation, selectVariation } from '../state/actions.ts';
import { useDoc } from '../state/store.ts';
import { useEngine, useSvgUrl } from './engine.tsx';
import { cx } from './kit.tsx';
import { StatusIcon } from './status.tsx';

const DOT: Record<string, string> = {
  pending: 'bg-ink-3/20 text-ink-3',
  verifying: 'bg-accent-soft text-accent',
  'needs-changes': 'bg-bad-soft text-bad',
  'baseline-verified': 'bg-ok-soft text-ok',
  'stress-passed': 'bg-ok-soft text-ok',
  error: 'bg-bad-soft text-bad',
};

function Thumb({ recipe, design, index, selected, removable }: { recipe: DesignRecipe; design: BuiltDesign | null; index: number; selected: boolean; removable: boolean }) {
  const { statusOf } = useEngine();
  const url = useSvgUrl(design?.svg ?? null);
  const status = statusOf(design);
  return (
    <li className="relative shrink-0">
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Variation ${index + 1}: ${recipe.title}. ${statusLabel(status)}.`}
        data-testid={`variation-${index}`}
        onClick={() => selectVariation(index)}
        className={cx(
          'group flex w-[104px] flex-col items-stretch rounded-lg p-1.5 text-left transition-colors',
          selected ? 'bg-panel shadow-sm ring-2 ring-ink' : 'ring-1 ring-transparent hover:bg-panel hover:ring-line',
        )}
      >
        <span className="transparency flex h-[84px] items-center justify-center overflow-hidden rounded-md bg-wash">
          {url ? <img src={url} alt="" className="max-h-[80px] max-w-[88px]" draggable={false} /> : <span className="px-1 text-center text-[11px] text-ink-3">Add content to preview</span>}
        </span>
        <span className="mt-1.5 flex items-center justify-between gap-1">
          <span className="truncate text-xs font-medium text-ink" title={recipe.title}>
            {recipe.title || PRESET_META[recipe.preset].name}
          </span>
          <span className={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded-full', DOT[status])} title={statusLabel(status)}>
            <StatusIcon status={status} size={11} />
          </span>
        </span>
      </button>
      {removable ? (
        <button
          type="button"
          aria-label={`Remove variation ${index + 1}`}
          title="Remove this variation"
          onClick={() => removeVariation(index)}
          className="absolute right-0.5 top-0.5 hidden h-5 w-5 items-center justify-center rounded-full bg-panel text-ink-2 shadow ring-1 ring-line hover:text-bad focus-visible:flex group-hover:flex [li:hover>&]:flex"
        >
          <X size={12} aria-hidden />
        </button>
      ) : null}
    </li>
  );
}

export function VariationStrip() {
  const doc = useDoc();
  const { designs } = useEngine();
  return (
    <nav aria-label="Design variations" className="border-t border-line bg-wash">
      <ul className="scroll-thin flex gap-1.5 overflow-x-auto px-3 py-2">
        {doc.variations.map((recipe, index) => (
          <Thumb key={index} recipe={recipe} design={designs[index] ?? null} index={index} selected={index === doc.selected} removable={doc.variations.length > 6 || index >= 6} />
        ))}
      </ul>
    </nav>
  );
}
