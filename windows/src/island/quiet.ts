// Pop-ups that can wait: an agent finishing, asking in the terminal, or two
// agents touching one file. They stay quiet during the user's quiet hours
// ("22:00-07:00", may wrap past midnight) and come at most once every 20 s,
// so five agents finishing together make one pop, not five. Approvals and
// errors never go through here: an agent is waiting on those.
// No DOM: tested in node.

const GAP_MS = 20_000;

/** Minutes after midnight for "HH:MM", or null. */
function minutes(s: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** "22:00-07:00" → its start and end in minutes; "" or nonsense → null (off). */
export function parseQuiet(spec: string): { start: number; end: number } | null {
  const [a, b, extra] = (spec ?? "").split("-");
  if (extra !== undefined || b === undefined) return null;
  const start = minutes(a);
  const end = minutes(b);
  return start == null || end == null || start === end ? null : { start, end };
}

export function inQuietHours(spec: string, now: Date): boolean {
  const q = parseQuiet(spec);
  if (!q) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  return q.start < q.end ? t >= q.start && t < q.end : t >= q.start || t < q.end;
}

export class Nudger {
  private last = -Infinity;

  /** May a pop-up show now? Counts it when it may. */
  allow(spec: string, now: Date): boolean {
    if (inQuietHours(spec, now)) return false;
    const t = now.getTime();
    if (t - this.last < GAP_MS) return false;
    this.last = t;
    return true;
  }
}
