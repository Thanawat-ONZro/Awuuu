// A small Markdown reader for chat replies: **bold**, *italic*, `code`,
// [links](https://…), headings, lists, quotes and fenced code blocks.
//
// Two halves on purpose:
//   parseMarkdown → plain data, no DOM (tested in node)
//   renderMarkdown → DOM nodes built with createElement/textContent only.
// Nothing from the model ever reaches innerHTML, and only http(s) links open.

export type Inline =
  | { t: "text"; v: string }
  | { t: "bold"; c: Inline[] }
  | { t: "italic"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: number; c: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "quote"; c: Inline[] }
  | { t: "code"; lang: string; v: string };

/** A link the island may open: web links only. */
export function safeUrl(href: string): string | null {
  try {
    const u = new URL(href.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

// ── Inline ───────────────────────────────────────────────────────────────────

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    // `code`: nothing inside is parsed.
    if (rest[0] === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // **bold** or __bold__
    const bold = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (bold) {
      flush();
      out.push({ t: "bold", c: parseInline(bold[2]) });
      i += bold[0].length;
      continue;
    }
    // *italic* or _italic_ (not inside a word for _)
    const italic = /^(\*|_)(?=\S)([^*_]*?\S)\1(?![\w])/.exec(rest);
    if (italic && !(italic[1] === "_" && /\w$/.test(buf))) {
      flush();
      out.push({ t: "italic", c: parseInline(italic[2]) });
      i += italic[0].length;
      continue;
    }
    // [label](url)
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      const href = safeUrl(link[2]);
      flush();
      if (href) out.push({ t: "link", href, c: parseInline(link[1]) });
      else out.push(...parseInline(link[1])); // unsafe link: keep the words, drop the target
      i += link[0].length;
      continue;
    }
    // A bare web address.
    const bare = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/.exec(rest);
    if (bare && !/\w$/.test(buf)) {
      const href = safeUrl(bare[0]);
      if (href) {
        flush();
        out.push({ t: "link", href, c: [{ t: "text", v: bare[0] }] });
        i += bare[0].length;
        continue;
      }
    }
    buf += src[i];
    i++;
  }
  flush();
  return out;
}

// ── Blocks ───────────────────────────────────────────────────────────────────

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const endPara = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join("\n")) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      endPara();
      const body: string[] = [];
      i++;
      // An unclosed fence (a reply still streaming) runs to the end.
      while (i < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[i])) body.push(lines[i++]);
      blocks.push({ t: "code", lang: fence[2], v: body.join("\n") });
      continue;
    }

    if (!line.trim()) {
      endPara();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      endPara();
      blocks.push({ t: "h", level: heading[1].length, c: parseInline(heading[2]) });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/;
    const number = /^\s*\d+[.)]\s+(.*)$/;
    const kind = bullet.test(line) ? "ul" : number.test(line) ? "ol" : null;
    if (kind) {
      endPara();
      const re = kind === "ul" ? bullet : number;
      const items: Inline[][] = [];
      while (i < lines.length && re.test(lines[i])) {
        items.push(parseInline(re.exec(lines[i])![1]));
        i++;
      }
      i--;
      blocks.push({ t: kind, items });
      continue;
    }

    if (/^\s*>/.test(line)) {
      endPara();
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      i--;
      blocks.push({ t: "quote", c: parseInline(body.join("\n")) });
      continue;
    }

    para.push(line);
  }
  endPara();
  return blocks;
}

// ── DOM ──────────────────────────────────────────────────────────────────────

export interface RenderOptions {
  openUrl: (url: string) => void;
  copy: (text: string) => void;
}

function inlineNodes(items: Inline[], opts: RenderOptions): Node[] {
  return items.map((it) => {
    switch (it.t) {
      case "text":
        return document.createTextNode(it.v);
      case "code": {
        const el = document.createElement("code");
        el.textContent = it.v;
        return el;
      }
      case "bold":
      case "italic": {
        const el = document.createElement(it.t === "bold" ? "strong" : "em");
        el.append(...inlineNodes(it.c, opts));
        return el;
      }
      case "link": {
        const a = document.createElement("a");
        a.href = it.href;
        a.title = it.href;
        a.append(...inlineNodes(it.c, opts));
        a.addEventListener("click", (e) => {
          e.preventDefault();
          opts.openUrl(it.href);
        });
        return a;
      }
    }
  });
}

/** The reply as DOM nodes, for a `.reply.md` container. */
export function renderMarkdown(src: string, opts: RenderOptions): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const b of parseMarkdown(src)) {
    switch (b.t) {
      case "p": {
        const p = document.createElement("p");
        p.append(...inlineNodes(b.c, opts));
        frag.append(p);
        break;
      }
      case "h": {
        // Headings stay small in a chat bubble: h4–h6 only.
        const el = document.createElement(`h${Math.min(6, b.level + 3)}`);
        el.append(...inlineNodes(b.c, opts));
        frag.append(el);
        break;
      }
      case "ul":
      case "ol": {
        const list = document.createElement(b.t);
        for (const item of b.items) {
          const li = document.createElement("li");
          li.append(...inlineNodes(item, opts));
          list.append(li);
        }
        frag.append(list);
        break;
      }
      case "quote": {
        const q = document.createElement("blockquote");
        q.append(...inlineNodes(b.c, opts));
        frag.append(q);
        break;
      }
      case "code": {
        const wrap = document.createElement("div");
        wrap.className = "md-code";
        const btn = document.createElement("button");
        btn.className = "md-copy";
        btn.type = "button";
        btn.textContent = "Copy";
        btn.addEventListener("click", () => {
          opts.copy(b.v);
          btn.textContent = "Copied";
          setTimeout(() => (btn.textContent = "Copy"), 1200);
        });
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = b.v;
        pre.append(code);
        wrap.append(btn, pre);
        frag.append(wrap);
        break;
      }
    }
  }
  return frag;
}
