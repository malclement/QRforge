/** Small, accessible building blocks shared by the panels. */
import { Slider as RadixSlider, Switch as RadixSwitch, ToggleGroup } from 'radix-ui';
import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { isHex } from '../core/color/color.ts';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-white hover:bg-black disabled:bg-ink-3',
  secondary: 'bg-panel text-ink border border-line hover:border-ink-3 disabled:text-ink-3',
  ghost: 'text-ink-2 hover:bg-line-2 hover:text-ink disabled:text-ink-3',
  danger: 'bg-panel text-bad border border-line hover:border-bad disabled:text-ink-3',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
        BUTTON_STYLES[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-line-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Section({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('border-b border-line-2 px-4 py-4 last:border-b-0', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
        {aside}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function Field({ label, hint, htmlFor, children, aside }: { label: string; hint?: ReactNode; htmlFor?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[13px] text-ink-2">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {hint ? <p className="mt-1 text-xs leading-snug text-ink-3">{hint}</p> : null}
    </div>
  );
}

const INPUT_BASE = 'rounded-md border border-line bg-panel px-2.5 text-sm text-ink placeholder:text-ink-3 hover:border-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';
const INPUT = `w-full ${INPUT_BASE}`;

export function TextField({
  label,
  value,
  onChange,
  hint,
  maxLength,
  placeholder,
  aside,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  maxLength?: number;
  placeholder?: string;
  aside?: ReactNode;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} hint={hint} aside={aside}>
      <input id={id} className={cx(INPUT, 'h-9')} value={value} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <select id={id} className={cx(INPUT, 'h-9 pr-7')} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function SliderField({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  format = (v) => `${Math.round(v * 100)}%`,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (value: number) => string;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  return (
    <div className={disabled ? 'opacity-50' : undefined}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[13px] text-ink-2">{label}</span>
        <output className="text-xs tabular-nums text-ink-3">{format(value)}</output>
      </div>
      <RadixSlider.Root
        className="relative flex h-5 w-full touch-none select-none items-center"
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([v]) => onChange(v)}
      >
        <RadixSlider.Track className="relative h-1 grow rounded-full bg-line">
          <RadixSlider.Range className="absolute h-full rounded-full bg-ink" />
        </RadixSlider.Track>
        <RadixSlider.Thumb aria-label={label} className="block h-4 w-4 rounded-full border-2 border-ink bg-panel shadow-sm hover:bg-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />
      </RadixSlider.Root>
      {hint ? <p className="mt-1 text-xs leading-snug text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-[13px] text-ink-2">{label}</div>
      <ToggleGroup.Root
        type="single"
        aria-label={label}
        value={value}
        onValueChange={(v) => v && onChange(v as T)}
        className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-md bg-line-2 p-0.5"
      >
        {options.map((o) => (
          <ToggleGroup.Item
            key={o.value}
            value={o.value}
            disabled={o.disabled}
            title={o.title}
            className="h-7 rounded-[5px] px-1.5 text-[13px] text-ink-2 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 data-[state=on]:bg-panel data-[state=on]:font-medium data-[state=on]:text-ink data-[state=on]:shadow-sm"
          >
            {o.label}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
    </div>
  );
}

export function SwitchField({ label, checked, onChange, hint, disabled }: { label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={disabled ? 'opacity-50' : undefined}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-[13px] text-ink-2">
          {label}
        </label>
        <RadixSwitch.Root
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
          className="relative h-5 w-9 shrink-0 rounded-full bg-line transition-colors data-[state=checked]:bg-ink"
        >
          <RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-panel shadow transition-transform data-[state=checked]:translate-x-[18px]" />
        </RadixSwitch.Root>
      </div>
      {hint ? <p className="mt-1 text-xs leading-snug text-ink-3">{hint}</p> : null}
    </div>
  );
}

/** Colour swatch + hex text. The text commits only when it is a valid #rrggbb. */
export function ColorField({ label, value, onChange, aside }: { label: string; value: string; onChange: (hex: string) => void; aside?: ReactNode }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  return (
    <div className="flex items-center gap-2">
      <input type="color" aria-label={`${label} colour picker`} value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-7 shrink-0 cursor-pointer rounded-md ring-1 ring-line" />
      <label htmlFor={id} className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
        {label}
      </label>
      {aside}
      <input
        id={id}
        value={shown}
        spellCheck={false}
        maxLength={7}
        aria-invalid={draft !== null && !isHex(draft)}
        onChange={(e) => {
          const next = e.target.value.trim();
          setDraft(next);
          if (isHex(next)) onChange(next.toLowerCase());
        }}
        onBlur={() => setDraft(null)}
        className={cx(INPUT_BASE, 'h-7 w-[5.4rem] shrink-0 px-2 font-mono text-xs aria-[invalid=true]:border-bad')}
      />
    </div>
  );
}

const TONES = {
  neutral: 'bg-line-2 text-ink-2',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  accent: 'bg-accent-soft text-accent-strong',
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', TONES[tone])}>{children}</span>;
}

export function Note({ tone = 'neutral', children, role }: { tone?: Tone; children: ReactNode; role?: 'alert' | 'status' }) {
  return (
    <div role={role} className={cx('rounded-md px-3 py-2 text-[13px] leading-snug', TONES[tone])}>
      {children}
    </div>
  );
}

export const inputClass = INPUT;
