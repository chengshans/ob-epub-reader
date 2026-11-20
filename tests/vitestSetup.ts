import { setupI18n } from "./setupI18n";

await setupI18n("zh");

// happy-dom 不带 Obsidian 的 HTMLElement 扩展（createEl/createDiv/appendText/
// empty/addClass/removeClass/setText），源码大量使用这些 API。
// 这里按 Obsidian 官方语义补齐，让 Modal 类源码可直接在测试中运行。
type CreateElOpts = { cls?: string; text?: string; href?: string };

function applyOpts(el: HTMLElement, opts?: string | CreateElOpts): HTMLElement {
  if (typeof opts === "string") {
    el.addClass(opts);
  } else if (opts) {
    if (opts.cls) el.addClass(opts.cls);
    if (opts.text !== undefined) el.setText(opts.text);
    if (opts.href) (el as HTMLAnchorElement).href = opts.href;
  }
  return el;
}

declare global {
  interface HTMLElement {
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      opts?: string | CreateElOpts
    ): HTMLElementTagNameMap[K];
    createDiv(opts?: string | CreateElOpts): HTMLDivElement;
    createSpan(opts?: string | CreateElOpts): HTMLSpanElement;
    appendText(text: string): void;
    setText(text: string): void;
    empty(): void;
    addClass(...classes: string[]): void;
    removeClass(...classes: string[]): void;
  }
}

if (typeof (HTMLElement.prototype as any).createEl !== "function") {
  const proto = HTMLElement.prototype as any;
  proto.createEl = function (tag: string, opts?: string | CreateElOpts) {
    const el = this.ownerDocument.createElement(tag);
    this.appendChild(el);
    return applyOpts(el, opts);
  };
  proto.createDiv = function (opts?: string | CreateElOpts) {
    return this.createEl("div", opts) as HTMLDivElement;
  };
  proto.createSpan = function (opts?: string | CreateElOpts) {
    return this.createEl("span", opts) as HTMLSpanElement;
  };
  proto.appendText = function (text: string) {
    this.appendChild(this.ownerDocument.createTextNode(text));
  };
  proto.setText = function (text: string) {
    this.textContent = text;
  };
  proto.empty = function () {
    this.textContent = "";
  };
  proto.addClass = function (...classes: string[]) {
    for (const c of classes) {
      for (const part of c.split(/\s+/).filter(Boolean)) this.classList.add(part);
    }
  };
  proto.removeClass = function (...classes: string[]) {
    for (const c of classes) {
      for (const part of c.split(/\s+/).filter(Boolean)) this.classList.remove(part);
    }
  };
}

if (typeof (HTMLElement.prototype as any).setCssProps !== "function") {
  (HTMLElement.prototype as any).setCssProps = function (props: Record<string, string>) {
    for (const [k, v] of Object.entries(props)) {
      this.style.setProperty(k, v);
    }
  };
}
