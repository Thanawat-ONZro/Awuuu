// Minimal DOM shim for Node environment tests without heavy dependencies

class MockElement {
  tagName: string;
  className = "";
  _textContent = "";
  children: MockElement[] = [];
  childNodes: any[] = [];
  attributes: Record<string, string> = {};
  dataset: Record<string, string> = {};
  value = "";
  style: any = {
    _props: {} as Record<string, string>,
    setProperty(k: string, v: string) {
      this._props[k] = v;
    },
    getPropertyValue(k: string) {
      return this._props[k] || "";
    },
  };
  eventListeners: Record<string, Function[]> = {};

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get textContent(): string {
    if (this._textContent) return this._textContent;
    return this.children.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    this._textContent = v;
    this.children = [];
    this.childNodes = [];
  }

  get innerHTML(): string {
    return this.textContent;
  }
  set innerHTML(v: string) {
    if (v === "") {
      this._textContent = "";
      this.children = [];
      this.childNodes = [];
    } else {
      this._textContent = v;
    }
  }

  get classList() {
    return {
      contains: (c: string) => this.className.split(/\s+/).includes(c),
      add: (c: string) => {
        if (!this.classList.contains(c)) {
          this.className = (this.className + " " + c).trim();
        }
      },
      remove: (c: string) => {
        this.className = this.className
          .split(/\s+/)
          .filter((x) => x !== c)
          .join(" ");
      },
      toggle: (c: string, force?: boolean) => {
        const on = force !== undefined ? force : !this.classList.contains(c);
        if (on) this.classList.add(c);
        else this.classList.remove(c);
        return on;
      },
    };
  }

  setAttribute(k: string, v: string) {
    this.attributes[k] = v;
    if (k === "class") this.className = v;
  }
  getAttribute(k: string) {
    return this.attributes[k] ?? null;
  }

  addEventListener(event: string, fn: Function) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(fn);
  }
  dispatchEvent(event: { type: string; [k: string]: any }) {
    for (const fn of this.eventListeners[event.type] || []) {
      fn(event);
    }
  }

  append(...items: any[]) {
    for (const it of items) {
      if (typeof it === "string") {
        const textNode = { nodeType: 3, textContent: it };
        this.childNodes.push(textNode);
      } else if (it) {
        this.children.push(it);
        this.childNodes.push(it);
      }
    }
  }
  appendChild(child: any) {
    this.append(child);
    return child;
  }
  removeChild(child: any) {
    this.children = this.children.filter((c) => c !== child);
    this.childNodes = this.childNodes.filter((c) => c !== child);
    return child;
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }

  querySelector(selector: string): MockElement | null {
    if (selector.startsWith(".")) {
      const cls = selector.slice(1);
      for (const child of this.children) {
        if (child && child.classList?.contains(cls)) return child;
        const found = child?.querySelector?.(selector);
        if (found) return found;
      }
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const res: MockElement[] = [];
    if (selector.startsWith(".")) {
      const cls = selector.slice(1);
      for (const child of this.children) {
        if (child && child.classList?.contains(cls)) res.push(child);
        if (child?.querySelectorAll) res.push(...child.querySelectorAll(selector));
      }
    }
    return res;
  }
}

if (typeof (globalThis as any).document === "undefined") {
  (globalThis as any).document = {
    createElement(tag: string) {
      return new MockElement(tag);
    },
    createElementNS(_ns: string, tag: string) {
      return new MockElement(tag);
    },
    createTextNode(text: string) {
      return { nodeType: 3, textContent: text };
    },
  };
}

if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
