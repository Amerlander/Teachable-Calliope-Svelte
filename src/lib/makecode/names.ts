export interface ClassName {
  /** Original user-facing label, used in `block="..."` dropdown text. */
  label: string;
  /** Sanitized TypeScript identifier, used as the `fixedInstance` const name. */
  variable: string;
  /** Stable 1-based id used on the wire. */
  id: number;
}

function stripAccents(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '');
}

function toVariable(label: string): string {
  const asciiish = stripAccents(label).replace(/[^a-zA-Z0-9 _]/g, ' ');
  const parts = asciiish
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((p) => {
      const low = p.toLowerCase();
      return low.charAt(0).toUpperCase() + low.slice(1);
    });
  const joined = parts.join('');
  const safe = joined.replace(/[^A-Za-z0-9_]/g, '');
  return /^[0-9]/.test(safe) ? `_${safe}` : safe || 'Class';
}

/**
 * Sanitize a user label for use inside a MakeCode JSDoc attribute like
 * `block="..."`. MakeCode's comment parser reads each attribute value as a
 * JSON string, so any raw backslash or control character the user typed will
 * crash the TS worker with `Bad escaped character in JSON at position ...`.
 * Drop control chars, flatten backslashes/quotes, collapse whitespace.
 */
function sanitizeLabel(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      out += ' ';
      continue;
    }
    const ch = raw[i];
    out += ch === '\\' || ch === '"' ? "'" : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Turn user labels into `{ label, variable, id }`, deduplicating variable collisions. */
export function classNamesFromLabels(labels: string[]): ClassName[] {
  const out: ClassName[] = [];
  const seen = new Set<string>();
  labels.forEach((raw, i) => {
    const label = sanitizeLabel(raw ?? '') || `Class${i + 1}`;
    let variable = toVariable(label);
    let suffix = 2;
    const base = variable;
    while (seen.has(variable)) {
      variable = `${base}${suffix++}`;
    }
    seen.add(variable);
    out.push({ label, variable, id: i + 1 });
  });
  return out;
}
