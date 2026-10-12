export const STYLE_ID = 'gjs-pm-style';

/** Puzzle-piece icon (Material "extension"). */
export const ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="display:block" aria-hidden="true"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"/></svg>';

/**
 * Styles of the modal content. Colours are translucent white over the
 * GrapesJS modal background (works with the default dark theme and with
 * themes that only change `--gjs-*` colours).
 */
export const CSS = `
.gjs-pm{min-width:0;font-size:13px}
.gjs-pm-tabs{display:flex;gap:4px;border-bottom:1px solid rgba(255,255,255,.15);margin-bottom:12px}
.gjs-pm-tab{padding:8px 14px;cursor:pointer;opacity:.65;border:0;border-bottom:2px solid transparent;background:none;color:inherit;font:inherit}
.gjs-pm-tab:hover,.gjs-pm-tab:focus-visible{opacity:1}
.gjs-pm-tab[aria-selected="true"]{opacity:1;border-bottom-color:currentColor}
.gjs-pm-pane{max-height:60vh;overflow:auto}
.gjs-pm-banner{display:flex;align-items:center;gap:10px;justify-content:space-between;padding:8px 12px;margin-bottom:10px;border-radius:3px;background:rgba(255,190,0,.18)}
.gjs-pm-banner[hidden]{display:none}
.gjs-pm-row{display:flex;align-items:center;gap:12px;padding:10px 4px;border-bottom:1px solid rgba(255,255,255,.1)}
.gjs-pm-info{flex:1;min-width:0}
.gjs-pm-name{font-weight:600;word-break:break-word}
.gjs-pm-desc{opacity:.7;font-size:12px;margin-top:2px;word-break:break-word}
.gjs-pm-err{color:#ff7b7b;font-size:12px;margin-top:2px;word-break:break-word}
.gjs-pm-warn{color:#ffc65c;font-size:12px;margin-top:2px}
.gjs-pm-badge{display:inline-block;margin-inline-start:8px;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:400;background:rgba(255,255,255,.15)}
.gjs-pm-badge.err{background:rgba(255,80,80,.35)}
.gjs-pm-badge.warn{background:rgba(255,190,0,.3)}
.gjs-pm-btn{padding:5px 10px;border-radius:3px;border:1px solid rgba(255,255,255,.3);background:transparent;color:inherit;cursor:pointer;font:inherit}
.gjs-pm-btn:hover{background:rgba(255,255,255,.12)}
.gjs-pm-switch{position:relative;width:38px;height:20px;flex:none}
.gjs-pm-switch input{opacity:0;width:100%;height:100%;margin:0;position:absolute;cursor:pointer;z-index:1}
.gjs-pm-switch span{position:absolute;inset:0;border-radius:10px;background:rgba(255,255,255,.25);transition:.15s}
.gjs-pm-switch span:before{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.15s}
.gjs-pm-switch input:checked+span{background:#4caf50}
.gjs-pm-switch input:checked+span:before{transform:translateX(18px)}
.gjs-pm-switch input:focus-visible+span{outline:2px solid #4caf50;outline-offset:2px}
.gjs-pm-drop{border:2px dashed rgba(255,255,255,.35);border-radius:6px;padding:48px 20px;text-align:center;cursor:pointer;transition:.15s}
.gjs-pm-drop.over{border-color:#4caf50;background:rgba(76,175,80,.12)}
.gjs-pm-drop small{display:block;opacity:.65;margin-top:6px}
.gjs-pm-log{margin-top:12px}
.gjs-pm-log div{padding:4px 0;word-break:break-word}
.gjs-pm-log .ok{color:#7be08a}
.gjs-pm-log .fail{color:#ff7b7b}
.gjs-pm-hint{opacity:.6;font-size:12px;margin-top:10px}
.gjs-pm-input{width:100%;box-sizing:border-box;padding:5px 8px;border-radius:3px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.2);color:inherit;font:inherit}
textarea.gjs-pm-input{resize:vertical;min-height:30px;font-family:monospace}
.gjs-pm-kv{display:grid;grid-template-columns:minmax(120px,32%) 1fr auto;gap:6px;align-items:start;padding:5px 0}
.gjs-pm-kv .k{font-family:monospace;word-break:break-all;padding-top:6px}
.gjs-pm-kv .acts{display:flex;gap:4px}
.gjs-pm-kv.saved textarea,.gjs-pm-kv.saved input{border-color:#4caf50}
.gjs-pm-add{margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,.15)}
.gjs-pm-chips{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}
.gjs-pm-chip{padding:2px 8px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:none;color:inherit;cursor:pointer;font:inherit;font-size:12px}
.gjs-pm-chip[aria-pressed="true"]{background:rgba(255,255,255,.18)}
.gjs-pm-float{position:fixed;right:12px;bottom:12px;z-index:99999;width:36px;height:36px;padding:8px;border:0;border-radius:50%;background:#d278c9;color:#fff;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4)}
`;

export function injectCss(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  doc.head.appendChild(s);
}
