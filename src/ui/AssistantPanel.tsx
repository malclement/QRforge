/**
 * Right panel, Assistant tab. Optional. Two ways to get design suggestions from
 * Claude, both ending in the same validator and the same verification:
 * a manual hand-off that always works, and a local bridge to the user's own
 * Claude Code installation.
 */
import { ClipboardCopy, Download, Link2, Sparkles, Unplug } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { buildBrief, MAX_SUGGESTIONS, type DesignBrief } from '../ai/brief.ts';
import { BridgeError, getBridgeStatus, loadConnection, parsePairingCode, requestSuggestions, saveConnection, type BridgeConnection, type BridgeStatus } from '../ai/bridge-client.ts';
import { handoffDocument } from '../ai/prompt.ts';
import { parseSuggestionsText, SuggestionError, suggestionToRecipe, validateSuggestions, type Suggestions } from '../ai/suggestions.ts';
import { LatestJob } from '../core/util/latest.ts';
import { downloadBytes, safeFileName } from '../platform/download.ts';
import { addVariations } from '../state/actions.ts';
import { useDoc, useStudio } from '../state/store.ts';
import { Button, cx, Field, inputClass, Note, Section } from './kit.tsx';

const suggestJob = new LatestJob();

interface Outcome {
  tone: 'ok' | 'bad';
  message: string;
  details: string[];
}

export function AssistantPanel() {
  const doc = useDoc();
  const projectName = useStudio((s) => s.meta.name);
  const notify = useStudio((s) => s.notify);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pasted, setPasted] = useState('');
  const [connection, setConnection] = useState<BridgeConnection | null>(() => loadConnection());
  const [pairing, setPairing] = useState('');
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [asking, setAsking] = useState(false);
  const [count, setCount] = useState(3);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pasteId = useId();
  const pairId = useId();

  useEffect(
    () => () => {
      abortRef.current?.abort();
      suggestJob.cancel();
    },
    [],
  );

  const brief = (): DesignBrief => buildBrief({ brand: doc.brand, direction: doc.direction }, count);

  /** Shared by both paths: validate, convert, add as variations (which are then verified like any other). */
  const accept = (suggestions: Suggestions, source: string) => {
    const context = { seed: doc.variationSeed, caption: doc.direction.caption, detail: doc.direction.detail, hasLogo: doc.brand.logo !== null };
    const room = 12 - doc.variations.length;
    if (room <= 0) {
      setOutcome({ tone: 'bad', message: 'There are already 12 variations. Remove one, then import again.', details: [] });
      return;
    }
    const converted = suggestions.suggestions.slice(0, room).map((s, i) => suggestionToRecipe(s, i, context));
    addVariations(
      converted.map((c) => c.recipe),
      `Add ${source} suggestions`,
    );
    setOutcome({
      tone: 'ok',
      message: `Added ${converted.length} suggestion${converted.length === 1 ? '' : 's'} to the variation strip. Each one is verified like any other design.`,
      details: converted.flatMap((c) => c.adjustments),
    });
  };

  const importText = (text: string) => {
    try {
      accept(parseSuggestionsText(text), 'imported');
      setPasted('');
    } catch (error) {
      if (error instanceof SuggestionError) setOutcome({ tone: 'bad', message: error.message, details: error.details });
      else setOutcome({ tone: 'bad', message: 'The recipe could not be imported.', details: [] });
    }
  };

  const check = async (target: BridgeConnection) => {
    setChecking(true);
    setBridgeError(null);
    try {
      setStatus(await getBridgeStatus(target));
    } catch (error) {
      setStatus(null);
      setBridgeError(error instanceof BridgeError ? error.message : 'The bridge status could not be read.');
    } finally {
      setChecking(false);
    }
  };

  const pair = () => {
    const parsed = parsePairingCode(pairing);
    if (!parsed) {
      setBridgeError('That does not look like a pairing code. Copy the full code printed by "npm run bridge".');
      return;
    }
    saveConnection(parsed);
    setConnection(parsed);
    setPairing('');
    void check(parsed);
  };

  const disconnect = () => {
    abortRef.current?.abort();
    suggestJob.cancel();
    saveConnection(null);
    setConnection(null);
    setStatus(null);
    setBridgeError(null);
    setAsking(false);
  };

  const ask = async () => {
    if (!connection) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setAsking(true);
    setOutcome(null);
    setBridgeError(null);
    const result = await suggestJob.run(async (job) => {
      job.onCancel(() => controller.abort());
      return validateSuggestions(await requestSuggestions(connection, brief(), controller.signal));
    });
    if (result.status === 'stale') return; // cancelled or superseded: nothing is applied
    setAsking(false);
    if (result.status === 'done') accept(result.value, 'Claude');
    else if (result.error instanceof SuggestionError) setOutcome({ tone: 'bad', message: `Claude's reply was rejected: ${result.error.message}`, details: result.error.details });
    else setBridgeError(result.error instanceof BridgeError ? result.error.message : 'The request failed.');
  };

  const cancel = () => {
    suggestJob.cancel();
    setAsking(false);
  };

  return (
    <div>
      <div className="border-b border-line-2 px-4 py-4">
        <h2 className="text-[13px] font-semibold">Optional: design suggestions from Claude</h2>
        <p className="mt-1 text-[13px] leading-snug text-ink-2">
          Everything else in QR Studio runs on this device. Asking Claude sends a short design brief to Anthropic through your own Claude Code installation. The brief holds your palette, logo proportions and style notes. It never includes the QR
          content or the logo image.
        </p>
      </div>

      <Section title="Manual hand-off">
        <p className="text-xs text-ink-3">Works without any setup: export the brief, give it to Claude Code yourself, and paste the JSON it returns.</p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => downloadBytes(handoffDocument(brief()), `${safeFileName(projectName)}.design-brief.md`, 'text/markdown')}>
            <Download size={14} aria-hidden /> Export design brief
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(handoffDocument(brief()));
                notify('success', 'Design brief copied.');
              } catch {
                notify('error', 'Copying was blocked by the browser. Use Export design brief instead.');
              }
            }}
          >
            <ClipboardCopy size={14} aria-hidden /> Copy
          </Button>
        </div>
        <Field label="Import design recipe" htmlFor={pasteId} hint="Paste the JSON reply. It is validated against the recipe schema before anything is drawn.">
          <textarea id={pasteId} rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} spellCheck={false} placeholder='{ "suggestionsVersion": 1, "suggestions": [ … ] }' className={cx(inputClass, 'resize-y py-2 font-mono text-xs')} />
        </Field>
        <div className="flex gap-1.5">
          <Button size="sm" variant="primary" disabled={pasted.trim().length === 0} onClick={() => importText(pasted)}>
            Import design recipe
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json,.txt,.md"
            className="sr-only"
            aria-label="Import a recipe file"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (file.size > 200_000) setOutcome({ tone: 'bad', message: 'That file is too large to be a design recipe.', details: [] });
              else importText(await file.text());
            }}
          />
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
            From a file
          </Button>
        </div>
      </Section>

      <Section title="Local Claude Code bridge">
        {!connection ? (
          <>
            <p className="text-xs leading-snug text-ink-3">
              For one-click suggestions, start the bridge in a terminal with <code className="rounded bg-wash px-1 py-0.5 font-mono">npm run bridge</code>. It listens on this computer only and prints a pairing code.
            </p>
            <Field label="Pairing code" htmlFor={pairId}>
              <div className="flex gap-1.5">
                <input id={pairId} value={pairing} onChange={(e) => setPairing(e.target.value)} spellCheck={false} autoComplete="off" placeholder="4317:…" className={cx(inputClass, 'h-9 font-mono text-xs')} />
                <Button onClick={pair} disabled={pairing.trim().length === 0}>
                  <Link2 size={14} aria-hidden /> Pair
                </Button>
              </div>
            </Field>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] text-ink-2">
                Paired with <span className="font-mono text-xs">{connection.url.replace('http://', '')}</span>
              </p>
              <div className="flex gap-1">
                <Button size="sm" onClick={() => void check(connection)} disabled={checking}>
                  {checking ? 'Checking…' : 'Check connection'}
                </Button>
                <Button size="sm" variant="ghost" onClick={disconnect} aria-label="Disconnect the bridge">
                  <Unplug size={14} aria-hidden />
                </Button>
              </div>
            </div>
            {status ? (
              <Note tone={status.ready ? 'ok' : 'warn'} role="status">
                {status.ready ? (
                  <>
                    Ready. Claude Code {status.cliVersion}, signed in with {status.authMethod}
                    {status.subscription ? ` (${status.subscription})` : ''}
                    {status.model ? `, model ${status.model}` : ''}.
                  </>
                ) : (
                  <>Not available: {status.reason}</>
                )}
              </Note>
            ) : null}
            <div className="flex items-end gap-2">
              <div className="w-24">
                <Field label="Suggestions">
                  <select aria-label="Number of suggestions" value={count} onChange={(e) => setCount(Number(e.target.value))} className={cx(inputClass, 'h-9')}>
                    {Array.from({ length: MAX_SUGGESTIONS }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {i + 1}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {asking ? (
                <Button className="flex-1" onClick={cancel}>
                  Cancel request
                </Button>
              ) : (
                <Button variant="primary" className="flex-1" onClick={() => void ask()} disabled={status !== null && !status.ready}>
                  <Sparkles size={14} aria-hidden /> Ask Claude for designs
                </Button>
              )}
            </div>
            {asking ? (
              <p className="text-xs text-ink-2" role="status">
                Waiting for Claude Code. This usually takes under a minute and uses your subscription's usage.
              </p>
            ) : (
              <p className="text-xs text-ink-3">A request is sent only when you press the button. Nothing is sent while you edit.</p>
            )}
          </>
        )}
        {bridgeError ? (
          <Note tone="bad" role="alert">
            {bridgeError}
          </Note>
        ) : null}
      </Section>

      {outcome ? (
        <div className="px-4 py-3">
          <Note tone={outcome.tone} role={outcome.tone === 'bad' ? 'alert' : 'status'}>
            <p>{outcome.message}</p>
            {outcome.details.length > 0 ? (
              <ul className="mt-1 list-disc pl-4 text-xs">
                {outcome.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : null}
          </Note>
        </div>
      ) : null}
    </div>
  );
}
