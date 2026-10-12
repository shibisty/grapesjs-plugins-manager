export type Child = Node | string | number | null | undefined | false | Child[];

type Handler = (ev: Event) => void;

/**
 * Tiny element factory. Text always goes through text nodes — labels,
 * plugin names, localStorage keys and values are never parsed as HTML.
 *
 *   h('button', { class: 'x', onClick: fn, title: 'Hi' }, 'Text')
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Record<string, unknown> | null,
  ...kids: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.entries(props || {}).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k === 'class') el.className = String(v);
    else if (k === 'style') el.style.cssText = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as Handler);
    else if (k === 'checked' || k === 'value' || k === 'disabled' || k === 'readOnly') {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else el.setAttribute(k, v === true ? '' : String(v));
  });
  append(el, kids);
  return el;
}

export function append(el: Element, kids: Child[]): void {
  kids.forEach((c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  });
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Parses a static, trusted SVG string (the icon) into a node. */
export function svg(markup: string): Element {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  return tpl.content.firstElementChild as Element;
}
