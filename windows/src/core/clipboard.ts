import type { ClipboardEntry } from "./bridge";
export type ClipboardKind = "text" | "links" | "images" | "code" | "colors";
export function clipboardKind(entry: Pick<ClipboardEntry, "kind" | "text">): ClipboardKind {
  if (entry.kind === "image") return "images";
  const text = entry.text?.trim() ?? "";
  if (/^https?:\/\/\S+$/i.test(text)) return "links";
  if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(text) || /^(?:rgb|hsl)a?\([\d\s.,%/]+\)$/i.test(text)) return "colors";
  if (/^(?:const |let |function |import |export |class |def |fn |SELECT |<\w|\{\s*"|\[\s*\{)/m.test(text)) return "code";
  return "text";
}
export function matchingClipboard(entries: ClipboardEntry[], kind: ClipboardKind | "all", query: string): ClipboardEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter(e => (kind === "all" || clipboardKind(e) === kind) && (!needle || (e.text ?? "").toLocaleLowerCase().includes(needle)));
}
