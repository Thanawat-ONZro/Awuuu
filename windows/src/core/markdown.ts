// The small slice of Markdown the chat shows: **bold**, *italic*, `code`, fenced code,
// lists, quotes and http(s) links. Pure (no DOM) so a streamed, half-written reply can be
// parsed on every piece and the tests run in Node.

export type Inline =
  | { t: "text"; v: string }
  | { t: "b" | "i"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "a"; href: string; c: Inline[] };

export type Block =
  | { t: "p" | "quote" | "h"; c: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "code"; lang: string; v: string };

const TOKEN = /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|\*([^*\s][^*\n]*?)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/;

/** Inline spans of one run of text. Anything unmatched stays plain text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let rest = src;
  for (;;) {
    const m = TOKEN.exec(rest);
    if (!m) break;
    if (m.index > 0) out.push({ t: "text", v: rest.slice(0, m.index) });
    if (m[1] !== undefined) out.push({ t: "code", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "b", c: parseInline(m[2]) });
    else if (m[3] !== undefined) out.push({ t: "i", c: parseInline(m[3]) });
    else out.push({ t: "a", href: m[5], c: parseInline(m[4]) });
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) out.push({ t: "text", v: rest });
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join("\n")) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```(\S*)\s*$/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      // An unclosed fence is a reply still streaming: show what is there.
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) code.push(lines[i]);
      blocks.push({ t: "code", lang: fence[1], v: code.join("\n") });
      continue;
    }
    if (!line.trim()) { flush(); continue; }

    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) { flush(); blocks.push({ t: "h", c: parseInline(heading[1]) }); continue; }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.t === "quote") last.c.push({ t: "text", v: "\n" }, ...parseInline(quote[1]));
      else blocks.push({ t: "quote", c: parseInline(quote[1]) });
      continue;
    }

    const kind = BULLET.test(line) ? "ul" : NUMBERED.test(line) ? "ol" : null;
    if (kind) {
      flush();
      const item = parseInline((kind === "ul" ? BULLET : NUMBERED).exec(line)![1]);
      const last = blocks[blocks.length - 1];
      if (last?.t === kind) last.items.push(item);
      else blocks.push({ t: kind, items: [item] });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}
