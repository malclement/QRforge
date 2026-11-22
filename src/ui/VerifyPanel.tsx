/** Right panel, Verify tab: what was measured, what failed and why, and what can be done about it. */
import { Check, RefreshCw, WandSparkles, X } from 'lucide-react';
import { STRESS_PROFILE } from '../core/verify/profile.ts';
import { REPAIR_ACTIONS, type RepairAction } from '../core/verify/repair.ts';
import type { CheckOutcome, ValidationReport } from '../core/verify/report.ts';
import { applyRepair } from '../state/actions.ts';
import { useEngine } from './engine.tsx';
import { Badge, Button, cx, Note, Section } from './kit.tsx';
import { countsText, STATUS_TONE, StatusIcon, statusText } from './status.tsx';

const DECODER_NAMES = { jsqr: 'jsQR', 'zxing-cpp': 'ZXing-C++' } as const;

const OUTCOME_TEXT: Record<CheckOutcome, string> = {
  pass: 'Read the exact payload',
  'no-decode': 'Could not read the symbol',
  mismatch: 'Read a different payload',
  error: 'Decoder error',
};

function Mark({ outcome }: { outcome: CheckOutcome | undefined }) {
  if (!outcome) return <span className="text-ink-3">—</span>;
  return outcome === 'pass' ? (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-ok-soft text-ok" title={OUTCOME_TEXT.pass}>
      <Check size={12} aria-hidden />
      <span className="sr-only">passed</span>
    </span>
  ) : (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-bad-soft text-bad" title={OUTCOME_TEXT[outcome]}>
      <X size={12} aria-hidden />
      <span className="sr-only">failed: {OUTCOME_TEXT[outcome]}</span>
    </span>
  );
}

function targetLabel(target: string): string {
  if (target === 'png') return 'PNG, exact download bytes';
  const match = /^svg@(\d+)$/.exec(target);
  return match ? `SVG, rasterized at ${match[1]} px wide` : target;
}

function ChecksTable({ rows }: { rows: { key: string; label: string; detail?: string; jsqr?: CheckOutcome; zxing?: CheckOutcome; failure?: string }[] }) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="text-left text-xs text-ink-3">
          <th scope="col" className="pb-1 font-normal">
            Condition
          </th>
          <th scope="col" className="w-12 pb-1 text-center font-normal">
            jsQR
          </th>
          <th scope="col" className="w-14 pb-1 text-center font-normal">
            ZXing
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-t border-line-2 align-top">
            <th scope="row" className="py-1.5 pr-2 text-left font-normal">
              <span className="text-ink">{row.label}</span>
              {row.detail ? <span className="block text-xs text-ink-3">{row.detail}</span> : null}
              {row.failure ? <span className="block text-xs text-bad">{row.failure}</span> : null}
            </th>
            <td className="py-1.5 text-center">
              <Mark outcome={row.jsqr} />
            </td>
            <td className="py-1.5 text-center">
              <Mark outcome={row.zxing} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function failureText(outcomes: { decoder: keyof typeof DECODER_NAMES; outcome: CheckOutcome; detail?: string }[]): string | undefined {
  const failed = outcomes.filter((o) => o.outcome !== 'pass');
  if (failed.length === 0) return undefined;
  return failed.map((o) => `${DECODER_NAMES[o.decoder]}: ${OUTCOME_TEXT[o.outcome].toLowerCase()}`).join('; ');
}

function BaselineSection({ report }: { report: ValidationReport }) {
  const targets = [...new Set(report.baseline.checks.map((c) => c.target))];
  const rows = targets.map((target) => {
    const checks = report.baseline.checks.filter((c) => c.target === target);
    return {
      key: target,
      label: targetLabel(target),
      jsqr: checks.find((c) => c.decoder === 'jsqr')?.outcome,
      zxing: checks.find((c) => c.decoder === 'zxing-cpp')?.outcome,
      failure: failureText(checks),
    };
  });
  return (
    <Section title="Baseline" aside={<Badge tone={report.baseline.passed ? 'ok' : 'bad'}>{report.baseline.passed ? 'passed' : 'failed'}</Badge>}>
      <p className="text-xs leading-snug text-ink-3">Both decoders must return the exact payload bytes from the finished artwork, logo and frame included, before a normal export.</p>
      <ChecksTable rows={rows} />
    </Section>
  );
}

function StressSection({ report }: { report: ValidationReport }) {
  if (!report.stress) {
    return (
      <Section title="Stress profile">
        <p className="text-[13px] text-ink-3">Not run for this design yet. It runs automatically when the design is selected.</p>
      </Section>
    );
  }
  const stress = report.stress;
  const ids = [...new Set(stress.checks.map((c) => c.caseId))];
  const rows = ids.map((id) => {
    const checks = stress.checks.filter((c) => c.caseId === id);
    return {
      key: id,
      label: checks[0].label,
      detail: checks[0].condition,
      jsqr: checks.find((c) => c.decoder === 'jsqr')?.outcome,
      zxing: checks.find((c) => c.decoder === 'zxing-cpp')?.outcome,
    };
  });
  return (
    <Section
      title="Stress profile"
      aside={
        <Badge tone={stress.passed === stress.total ? 'ok' : 'warn'}>
          {stress.passed} of {stress.total} passed
        </Badge>
      }
    >
      <p className="text-xs leading-snug text-ink-3">
        Profile {stress.profile.id} v{stress.profile.version}: fixed transformations applied to the PNG at {stress.workingSize.width} × {stress.workingSize.height} px. Failures here do not block export.
      </p>
      <ChecksTable rows={rows} />
    </Section>
  );
}

function ActionsSection() {
  const { design, repair, findRepairs, cancelRepairs, status } = useEngine();
  if (!design) return null;
  const state = { recipe: design.input.recipe, pngWidth: design.input.pngWidth };
  const context = { logoPlacement: design.render.logo.placement, canvasWidth: design.render.width };
  const run = (action: RepairAction) => {
    const next = action.apply(state, context);
    if (next) applyRepair(next.recipe, next.pngWidth, action.label);
  };
  return (
    <Section title="Improve readability">
      <div className="grid grid-cols-2 gap-1.5">
        {REPAIR_ACTIONS.map((action) => {
          const applicable = action.apply(state, context) !== null;
          return (
            <Button key={action.id} size="sm" disabled={!applicable} title={applicable ? action.description : `${action.description} Nothing to change here.`} onClick={() => run(action)} className="justify-start">
              {action.label}
            </Button>
          );
        })}
      </div>
      <p className="text-xs text-ink-3">Each action is one undoable step. None of them touches the encoded content.</p>

      <div className="rounded-lg bg-wash p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[13px] font-medium">Search for a fix</p>
            <p className="text-xs text-ink-3">Tries up to 10 fixed combinations and verifies each one.</p>
          </div>
          {repair.status === 'running' ? (
            <Button size="sm" onClick={cancelRepairs}>
              Cancel
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={findRepairs} disabled={status === 'verifying' || status === 'pending'}>
              <WandSparkles size={14} aria-hidden /> Find fixes
            </Button>
          )}
        </div>
        {repair.status === 'running' && repair.progress ? (
          <p className="mt-2 text-xs text-ink-2" role="status">
            Verified {repair.progress.done} of {repair.progress.total} alternatives…
          </p>
        ) : null}
        {repair.message ? (
          <p className="mt-2 text-xs text-ink-2" role="status">
            {repair.message}
          </p>
        ) : null}
        {repair.proposals.length > 0 ? (
          <ol className="mt-2 space-y-2">
            {repair.proposals.map(({ candidate, report }, index) => (
              <li key={candidate.id} className="rounded-md bg-panel p-2.5 ring-1 ring-line" data-testid={`repair-proposal-${index}`}>
                <p className="text-[13px] font-medium">{candidate.labels.join(' + ')}</p>
                <p className="mt-0.5 text-xs text-ink-3">
                  Measured: baseline {report.baseline.passed ? 'passed' : 'failed'}
                  {report.stress ? `, ${report.stress.passed} of ${report.stress.total} stress checks passed` : ''}
                  {candidate.state.pngWidth !== state.pngWidth ? `. Exports at ${candidate.state.pngWidth} px wide` : ''}.
                </p>
                <Button size="sm" className="mt-2" onClick={() => applyRepair(candidate.state.recipe, candidate.state.pngWidth, `Apply fix: ${candidate.labels.join(' + ')}`)}>
                  Apply this fix
                </Button>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </Section>
  );
}

function DetailsSection({ report }: { report: ValidationReport }) {
  const rows: [string, string][] = [
    ['Symbol', `Version ${report.symbol.version}, ${report.symbol.modules} × ${report.symbol.modules} modules, ECC ${report.symbol.ecc}, mask ${report.symbol.mask}`],
    ['Payload', `${report.payload.byteLength} bytes, SHA-256 ${report.payload.sha256.slice(0, 16)}…`],
    ['PNG', `${report.artifacts.png.width} × ${report.artifacts.png.height} px, ${report.artifacts.png.modulePx} px per module, SHA-256 ${report.artifacts.png.sha256.slice(0, 16)}…`],
    ['SVG', `${report.artifacts.svg.byteLength.toLocaleString('en-US')} bytes, SHA-256 ${report.artifacts.svg.sha256.slice(0, 16)}…`],
    ['SVG rasterizer', report.artifacts.svg.rasterizer],
    ['Encoder', report.symbol.encoder],
    ['Renderer', report.symbol.rendererVersion],
    ...report.decoders.map((d) => [d.name, d.version] as [string, string]),
    ['Configuration', `${report.fingerprint.slice(0, 16)}…`],
    ['Measured', `${new Date(report.createdAt).toLocaleString()} in ${(report.durationMs / 1000).toFixed(1)} s`],
  ];
  return (
    <details className="border-b border-line-2 px-4 py-3">
      <summary className="cursor-pointer text-[13px] font-semibold">Decoder and artifact details</summary>
      <dl className="mt-2 space-y-1.5 text-xs">
        {rows.map(([term, value]) => (
          <div key={term} className="grid grid-cols-[6.5rem_1fr] gap-2">
            <dt className="text-ink-3">{term}</dt>
            <dd className="break-words text-ink-2">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function VerifyPanel() {
  const { design, status, report, progress, verifyError, verifyNow } = useEngine();
  const counts = countsText(report);
  return (
    <div>
      <div className="border-b border-line-2 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={cx('inline-flex items-center gap-1.5 text-base font-semibold', { ok: 'text-ok', warn: 'text-ink', bad: 'text-bad', neutral: 'text-ink-2', accent: 'text-accent-strong' }[STATUS_TONE[status]])} data-testid="verify-status" data-status={status}>
              <StatusIcon status={status} size={18} />
              {design ? statusText(status, report) : 'Nothing to verify yet'}
            </div>
            <p className="mt-1 text-[13px] text-ink-2" role="status" aria-live="polite">
              {!design
                ? 'Enter content to create a design.'
                : status === 'verifying'
                  ? progress
                    ? `Running check ${progress.done} of ${progress.total}…`
                    : 'Rendering the export and starting the decoders…'
                  : status === 'pending'
                    ? 'The design changed. Results for the earlier version no longer apply.'
                    : status === 'error'
                      ? verifyError
                      : counts}
            </p>
          </div>
          <Button size="sm" className="shrink-0 whitespace-nowrap" onClick={verifyNow} disabled={!design || status === 'verifying'} title="Run the full profile again">
            <RefreshCw size={14} aria-hidden /> Verify again
          </Button>
        </div>
        {status === 'needs-changes' ? (
          <div className="mt-3">
            <Note tone="bad" role="alert">
              At least one decoder could not read the exact payload from the finished artwork. Use the actions below, then export.
            </Note>
          </div>
        ) : null}
      </div>

      {report ? (
        <>
          <BaselineSection report={report} />
          <StressSection report={report} />
        </>
      ) : null}
      <ActionsSection />
      {report ? <DetailsSection report={report} /> : null}

      <div className="px-4 py-3 text-xs leading-snug text-ink-3">
        These are software checks with two decoders under {STRESS_PROFILE.cases.length} fixed, simulated conditions. They are not a prediction for any particular phone, printer or lighting. Test a printed proof before a large run.
      </div>
    </div>
  );
}
