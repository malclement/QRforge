/**
 * Content serialization and validation.
 *
 * The payload is the exact string the user typed. Nothing here rewrites it:
 * problems are reported as issues, and a fix is only ever applied when the
 * caller invokes `applyPayloadFix` on an explicit user action.
 */
import { utf8Encode } from '../util/bytes.ts';

export type PayloadIssueCode =
  | 'empty'
  | 'malformed-unicode'
  | 'outer-whitespace'
  | 'missing-scheme'
  | 'control-characters'
  | 'carriage-returns';

export interface PayloadIssue {
  code: PayloadIssueCode;
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** Label of the explicit, optional corrective action, when one exists. */
  fixLabel?: string;
}

export interface PayloadAnalysis {
  text: string;
  /** The exact bytes that are encoded and that decoders must return. */
  bytes: Uint8Array;
  kind: 'empty' | 'url' | 'text';
  codePoints: number;
  lines: number;
  issues: PayloadIssue[];
  /** True when the payload can be encoded as-is (no error-level issue). */
  encodable: boolean;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BARE_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i;
// Control characters (category Cc) other than TAB, LF and CR.
const CONTROL = /(?![\t\n\r])\p{Cc}/u;
const CONTROL_GLOBAL = /(?![\t\n\r])\p{Cc}/gu;

function isWellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function analyzePayload(text: string): PayloadAnalysis {
  const issues: PayloadIssue[] = [];
  const wellFormed = isWellFormed(text);

  if (text.length === 0) {
    issues.push({ code: 'empty', severity: 'error', message: 'Enter a URL or some text to encode.' });
  }
  if (!wellFormed) {
    issues.push({
      code: 'malformed-unicode',
      severity: 'error',
      message:
        'The text contains an unpaired surrogate, which has no UTF-8 encoding. Remove the broken character; it is not replaced automatically.',
    });
  }
  if (text.length > 0 && text.trim().length !== text.length) {
    issues.push({
      code: 'outer-whitespace',
      severity: 'warning',
      message: 'The content starts or ends with whitespace. It is encoded exactly as typed.',
      fixLabel: 'Trim whitespace',
    });
  }
  if (CONTROL.test(text)) {
    issues.push({
      code: 'control-characters',
      severity: 'warning',
      message: 'The content contains invisible control characters. They are encoded as-is.',
      fixLabel: 'Remove control characters',
    });
  }
  if (text.includes('\r')) {
    issues.push({
      code: 'carriage-returns',
      severity: 'info',
      message: 'Line breaks include carriage returns (CR). They are kept unchanged.',
    });
  }

  const trimmed = text.trim();
  const singleToken = trimmed.length > 0 && !/\s/.test(trimmed);
  let kind: PayloadAnalysis['kind'] = text.length === 0 ? 'empty' : 'text';
  if (singleToken && /^https?:\/\/\S+$/i.test(trimmed)) kind = 'url';
  if (singleToken && !SCHEME.test(trimmed) && BARE_DOMAIN.test(trimmed)) {
    issues.push({
      code: 'missing-scheme',
      severity: 'info',
      message: 'This looks like a web address without a scheme. Many scanners will treat it as plain text.',
      fixLabel: 'Add https://',
    });
  }

  return {
    text,
    bytes: wellFormed ? utf8Encode(text) : new Uint8Array(0),
    kind,
    codePoints: Array.from(text).length,
    lines: text.length === 0 ? 0 : text.split('\n').length,
    issues,
    encodable: !issues.some((i) => i.severity === 'error'),
  };
}

/** Apply one explicit correction. Returns the text unchanged for codes without a fix. */
export function applyPayloadFix(text: string, code: PayloadIssueCode): string {
  switch (code) {
    case 'outer-whitespace':
      return text.trim();
    case 'missing-scheme':
      return `https://${text.trim()}`;
    case 'control-characters':
      return text.replace(CONTROL_GLOBAL, '');
    default:
      return text;
  }
}
