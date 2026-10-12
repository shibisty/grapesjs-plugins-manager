import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { setCodeRunner } from '../src/runtime/loader';
import { testRunner } from './helpers/runner';

/*
 * jsdom quirk (same as in grapesjs-context-menu): GrapesJS renders the canvas
 * from the iframe's `onload` handler, and that render makes jsdom dispatch
 * `load` on the same iframe again and again — an endless synchronous loop.
 * A real browser fires it once, so `iframe.onload` handlers run only once.
 */
Object.defineProperty(HTMLIFrameElement.prototype, 'onload', {
  configurable: true,
  get(this: HTMLIFrameElement & { __gjsOnload?: EventListener | null }) {
    return this.__gjsOnload || null;
  },
  set(this: HTMLIFrameElement & { __gjsOnload?: EventListener | null; __gjsOnloadBound?: boolean }, fn: EventListener | null) {
    this.__gjsOnload = fn;
    if (this.__gjsOnloadBound) return;
    this.__gjsOnloadBound = true;
    let done = false;
    this.addEventListener('load', (e) => {
      if (done || !this.__gjsOnload) return;
      done = true;
      this.__gjsOnload.call(this, e);
    });
  },
});

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

// jsdom does not execute <script src="blob:..."> nor import() of blob URLs.
setCodeRunner(testRunner);

afterEach(() => {
  document.body.innerHTML = '';
  document.getElementById('gjs-pm-style')?.remove();
  localStorage.clear();
});
