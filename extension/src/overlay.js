// The leaderboard panel. Lives in a shadow root so the game's CSS can't touch it.
// Player names come from other people's browsers, so they only ever go through
// textContent.
(function (root) {
  'use strict';

  const UI_KEY = 'jigsawTally:ui';
  const RESET_CONFIRM_MS = 3000;

  const CSS = `
    :host { all: initial; }
    [hidden] { display: none !important; }
    .panel {
      position: fixed; z-index: 2147483647; width: 240px;
      font: 13px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #f2f4f7; background: rgba(22, 26, 33, .94);
      border: 1px solid rgba(255, 255, 255, .14); border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, .4); overflow: hidden; user-select: none;
    }
    header {
      display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 12px;
      cursor: move; touch-action: none;
    }
    h1 { flex: 1; margin: 0; font-size: 13px; font-weight: 600; }
    button {
      font: inherit; color: inherit; background: rgba(255, 255, 255, .1);
      border: 0; border-radius: 6px; padding: 3px 8px; cursor: pointer;
    }
    button:hover { background: rgba(255, 255, 255, .2); }
    button:focus-visible { outline: 2px solid #7fb4ff; outline-offset: 1px; }
    .toggle { width: 24px; padding: 3px 0; }
    .body { padding: 0 12px 10px; }
    .panel.collapsed .body { display: none; }
    .status { margin: 0 0 8px; color: #aab2bf; font-size: 12px; }
    ol { list-style: none; margin: 0; padding: 0; max-height: 45vh; overflow-y: auto; }
    li { padding: 4px 0; }
    .line { display: flex; align-items: baseline; gap: 6px; }
    .rank { width: 16px; color: #aab2bf; font-variant-numeric: tabular-nums; }
    .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .you { margin-left: 4px; color: #7fb4ff; font-size: 11px; }
    .count { font-weight: 600; font-variant-numeric: tabular-nums; }
    .bar { height: 3px; margin: 3px 0 0 22px; background: rgba(255, 255, 255, .1); border-radius: 2px; }
    .fill { height: 100%; background: #7fb4ff; border-radius: 2px; }
    .untracked { margin-top: 6px; color: #aab2bf; font-size: 12px; }
    .actions { display: flex; gap: 6px; margin-top: 10px; }
    .actions button { flex: 1; }
  `;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function readUi() {
    try {
      return JSON.parse(localStorage.getItem(UI_KEY)) || {};
    } catch (error) {
      return {};
    }
  }

  function writeUi(ui) {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify(ui));
    } catch (error) {
      // Position and collapsed state just won't be remembered.
    }
  }

  // Plain-text results for pasting into a chat.
  function resultsText(view) {
    const lines = view.rows.map((row, index) => `${index + 1}. ${row.name}: ${row.count}`);
    if (view.untracked) lines.push(`Not attributed: ${view.untracked}`);
    return lines.join('\n');
  }

  function createOverlay({ onReset }) {
    const host = document.createElement('div');
    host.id = 'jigsaw-tally-root';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    const panel = element('section', 'panel');
    const header = element('header');
    const title = element('h1', '', 'Piece tally');
    const toggle = element('button', 'toggle');
    header.append(title, toggle);

    const body = element('div', 'body');
    const status = element('p', 'status');
    const list = element('ol');
    const untracked = element('div', 'untracked');
    const actions = element('div', 'actions');
    const copy = element('button', '', 'Copy');
    const reset = element('button', '', 'Reset');
    actions.append(copy, reset);
    body.append(status, list, untracked, actions);
    panel.append(header, body);
    shadow.appendChild(panel);

    const ui = readUi();
    let lastView = null;
    let lastRendered = '';

    function clampPosition(left, top) {
      const rect = panel.getBoundingClientRect();
      return {
        left: Math.max(0, Math.min(left, window.innerWidth - rect.width)),
        top: Math.max(0, Math.min(top, window.innerHeight - rect.height)),
      };
    }

    function place(left, top) {
      const position = clampPosition(left, top);
      panel.style.left = `${position.left}px`;
      panel.style.top = `${position.top}px`;
      return position;
    }

    function setCollapsed(collapsed) {
      panel.classList.toggle('collapsed', collapsed);
      toggle.textContent = collapsed ? '+' : '–';
      toggle.setAttribute('aria-label', collapsed ? 'Expand tally' : 'Collapse tally');
    }

    toggle.addEventListener('click', () => {
      ui.collapsed = !panel.classList.contains('collapsed');
      setCollapsed(ui.collapsed);
      writeUi(ui);
    });

    // Dragging the header moves the panel.
    header.addEventListener('pointerdown', (event) => {
      if (event.target === toggle) return;
      const rect = panel.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      header.setPointerCapture(event.pointerId);
      const move = (moveEvent) => {
        Object.assign(ui, place(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY));
      };
      const up = () => {
        header.removeEventListener('pointermove', move);
        header.removeEventListener('pointerup', up);
        writeUi(ui);
      };
      header.addEventListener('pointermove', move);
      header.addEventListener('pointerup', up);
    });

    copy.addEventListener('click', async () => {
      if (!lastView) return;
      try {
        await navigator.clipboard.writeText(resultsText(lastView));
        copy.textContent = 'Copied';
      } catch (error) {
        copy.textContent = 'Failed';
      }
      setTimeout(() => {
        copy.textContent = 'Copy';
      }, 1500);
    });

    // Reset wipes scores, so it takes a second click to confirm.
    let resetTimer = null;
    reset.addEventListener('click', () => {
      if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
        reset.textContent = 'Reset';
        onReset();
        return;
      }
      reset.textContent = 'Sure?';
      resetTimer = setTimeout(() => {
        resetTimer = null;
        reset.textContent = 'Reset';
      }, RESET_CONFIRM_MS);
    });

    // Keep clicks and keys on the panel away from the game's own listeners.
    for (const type of [
      'pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup',
      'click', 'dblclick', 'contextmenu', 'touchstart', 'touchmove', 'touchend',
      'wheel', 'keydown', 'keyup',
    ]) {
      host.addEventListener(type, (event) => event.stopPropagation());
    }

    // A fullscreen element only shows its own descendants.
    function attach() {
      (document.fullscreenElement || document.documentElement).appendChild(host);
    }
    document.addEventListener('fullscreenchange', attach);
    attach();

    setCollapsed(!!ui.collapsed);
    place(ui.left !== undefined ? ui.left : window.innerWidth - 256, ui.top !== undefined ? ui.top : 64);
    window.addEventListener('resize', () => {
      const rect = panel.getBoundingClientRect();
      place(rect.left, rect.top);
    });

    function render(view) {
      lastView = view;
      const serialized = JSON.stringify(view);
      if (serialized === lastRendered) return;
      lastRendered = serialized;

      status.textContent = view.status;
      const top = view.rows.reduce((max, row) => Math.max(max, row.count), 0);
      list.replaceChildren(
        ...view.rows.map((row, index) => {
          const item = element('li');
          const line = element('div', 'line');
          const name = element('span', 'name', row.name);
          name.title = row.name;
          if (row.name === view.me) name.append(element('span', 'you', 'you'));
          line.append(
            element('span', 'rank', String(index + 1)),
            name,
            element('span', 'count', String(row.count)),
          );
          const bar = element('div', 'bar');
          const fill = element('div', 'fill');
          fill.style.width = `${top ? (row.count / top) * 100 : 0}%`;
          bar.append(fill);
          item.append(line, bar);
          return item;
        }),
      );
      untracked.textContent = view.untracked ? `Not attributed: ${view.untracked}` : '';
      untracked.hidden = !view.untracked;
      actions.hidden = !view.rows.length;
    }

    return { render, host };
  }

  root.__jigsawTally = Object.assign(root.__jigsawTally || {}, { createOverlay, resultsText });
  if (typeof module !== 'undefined' && module.exports) module.exports = { resultsText };
})(globalThis);
