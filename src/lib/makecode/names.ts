export interface ClassName {
  /** Original user-facing label, used in `block="..."` dropdown text. */
  label: string;
  /** Sanitized TypeScript identifier, used as the `fixedInstance` const name. */
  variable: string;
  /** Stable 1-based id used on the wire. */
  id: number;
}

function stripAccents(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

function toVariable(label: string): string {
  const asciiish = stripAccents(label).replace(/[^a-zA-Z0-9 _]/g, ' ');
  const parts = asciiish
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((p, i) => {
      const low = p.toLowerCase();
      return i === 0
        ? low.charAt(0).toUpperCase() + low.slice(1)
        : low.charAt(0).toUpperCase() + low.slice(1);
    });
  const joined = parts.join('');
  const safe = joined.replace(/[^A-Za-z0-9_]/g, '');
  return /^[0-9]/.test(safe) ? `_${safe}` : safe || 'Class';
}

/** Turn user labels into `{ label, variable, id }`, deduplicating variable collisions. */
export function classNamesFromLabels(labels: string[]): ClassName[] {
  const out: ClassName[] = [];
  const seen = new Set<string>();
  labels.forEach((raw, i) => {
    const label = (raw ?? '').replace(/"/g, "'").trim() || `Class${i + 1}`;
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
