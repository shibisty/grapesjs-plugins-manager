import type { Editor } from 'grapesjs';
import { COMMAND_ID } from '../options';
import { h, svg } from './dom';
import { ICON } from './styles';

type PanelLike = { id: string; get(prop: string): { get(id: string): unknown; length: number } | undefined };

function panels(editor: Editor): PanelLike[] {
  try {
    const all = editor.Panels.getPanels() as unknown as { models?: PanelLike[]; forEach?: (fn: (p: PanelLike) => void) => void };
    const out: PanelLike[] = [];
    all.forEach?.((p) => out.push(p));
    return out;
  } catch {
    return [];
  }
}

export function hasButton(editor: Editor, buttonId: string): boolean {
  return panels(editor).some((p) => !!p.get('buttons')?.get(buttonId));
}

/**
 * The panel where toolbar buttons really live: themes and presets rename
 * `options` (preset-webpage keeps it, others do not).
 */
export function findPanelId(editor: Editor, preferred: string): string {
  const own = editor.Panels.getPanel(preferred) as unknown as PanelLike | null;
  if (own && (own.get('buttons')?.length || 0) > 0) return preferred;
  const found = panels(editor).find((p) => {
    const b = p.get('buttons');
    return b && (b.get('sw-visibility') || b.get('preview') || b.get('undo') || b.get('fullscreen'));
  });
  return found ? found.id : preferred;
}

/**
 * Adds the toolbar button. Returns false when there is no panel to put it
 * in (custom UI with `panels: { defaults: [] }`): a new empty panel would
 * be unstyled and invisible, the floating button is used instead.
 */
export function mountButton(editor: Editor, buttonId: string, panel: string, title: string): boolean {
  if (hasButton(editor, buttonId)) return true;
  const pn = editor.Panels;
  const pid = findPanelId(editor, panel);
  if (!pn.getPanel(pid)) return false;
  pn.addButton(pid, {
    id: buttonId,
    className: 'gjs-pm-btn-icon',
    label: ICON,
    attributes: { title },
    command: COMMAND_ID,
    togglable: false,
  });
  return true;
}

/** Is our toolbar button actually in the DOM (panels may be hidden or not rendered)? */
export function buttonRendered(editor: Editor): boolean {
  const root = (editor.getContainer?.() as HTMLElement | undefined) || document;
  const el = root.querySelector('.gjs-pm-btn-icon') as HTMLElement | null;
  return !!el && el.isConnected;
}

/** Fallback: a floating round button in the corner of the page. */
export function floatingButton(onClick: () => void, title: string): HTMLButtonElement {
  const b = h('button', { class: 'gjs-pm-float', type: 'button', title, 'aria-label': title });
  b.appendChild(svg(ICON));
  b.addEventListener('click', onClick);
  document.body.appendChild(b);
  return b;
}
