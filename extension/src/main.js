// Connects the game to the tally and keeps the panel up to date.
(function () {
  'use strict';

  const { Tally, totalEdgesInGrid, installHooks, createOverlay } = globalThis.__jigsawTally;

  const TICK_MS = 1000;
  const RECONCILE_EVERY_TICKS = 5;
  const SAVE_DELAY_MS = 1000;
  const GIVE_UP_AFTER_TICKS = 60; // Pages on this site that aren't the puzzle player.
  const STORAGE_PREFIX = 'jigsawTally:game:';
  const SAVE_VERSION = 2; // Version 1 saves counted joins, not edges.

  let tally = new Tally();
  let sessionId = null;
  let overlay = null;
  let saveTimer = null;
  let ticks = 0;
  const knownNames = new Map(); // actorNr -> name, so leavers keep their name.
  const pending = []; // Updates that arrived before the puzzle's grid was known.

  const modules = () => (window.jigexGlobals && window.jigexGlobals.modules) || {};

  // The game's getters can throw before it has connected.
  function attempt(fn, fallback) {
    try {
      const value = fn();
      return value === undefined ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  const inGame = () => attempt(() => !!modules().multiplayer.joinedToGameVar.val, false);

  function currentGameId() {
    const fromModule = attempt(() => modules().multiplayer.gameId, null);
    const value = typeof fromModule === 'function' ? attempt(() => fromModule(), null) : fromModule;
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    const fromPuzzle = attempt(() => modules().player.Puzzle.curr.multiplayerGameId, null);
    if (fromPuzzle) return String(fromPuzzle);
    return new URLSearchParams(location.search).get('gid');
  }

  function nameForActor(actorNr) {
    const name = attempt(() => modules().photon.getPlayerNameFromId(actorNr), null);
    if (name) {
      knownNames.set(actorNr, name);
      return name;
    }
    return knownNames.get(actorNr) || `Player ${actorNr}`;
  }

  // Null until the puzzle has been cut into pieces.
  function currentGrid() {
    const pieces = attempt(() => modules().player.Puzzle.curr.pieces, null);
    const rows = attempt(() => pieces.numRows, 0);
    const cols = attempt(() => pieces.numCols, 0);
    return rows > 0 && cols > 0 ? { rows, cols } : null;
  }

  const storageKey = (id) => STORAGE_PREFIX + id;

  function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!sessionId) return;
    try {
      const data = { version: SAVE_VERSION, ...tally.serialize() };
      localStorage.setItem(storageKey(sessionId), JSON.stringify(data));
    } catch (error) {
      // Without storage the scores just won't survive a refresh.
    }
  }

  function scheduleSave() {
    if (!saveTimer) saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }

  function load(id) {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(id)));
      return saved && saved.version === SAVE_VERSION ? saved : null;
    } catch (error) {
      return null;
    }
  }

  // Scores belong to one game, so swap them when the game changes. A refresh
  // lands here too and picks the saved scores back up.
  function syncSession() {
    const id = currentGameId();
    if (!id || id === sessionId) return;
    const saved = load(id);
    if (saved || sessionId) tally = new Tally(saved);
    sessionId = id;
  }

  function roomProperties() {
    return attempt(() => modules().multiplayer.gameInfo, null);
  }

  // Scoring an edge needs the grid, so updates wait here until the puzzle exists.
  function drainPending() {
    const grid = currentGrid();
    if (!grid) return;
    while (pending.length) {
      const { props, nameFor } = pending.shift();
      if (tally.ingest(props, nameFor, grid)) scheduleSave();
    }
  }

  // Anything in the room state we haven't seen happened without us, for example
  // before we joined or during a refresh. Queued updates go first, so their
  // edges keep their authors.
  function reconcile() {
    const grid = currentGrid();
    if (!grid) return;
    drainPending();
    if (tally.ingest(roomProperties(), null, grid)) scheduleSave();
  }

  function record(props, nameFor) {
    syncSession();
    pending.push({ props, nameFor });
    drainPending();
    refresh();
  }

  const hookHandlers = {
    onRemote: (props) => record(props, nameForActor),
    onLocal: (props) => record(props, nameForActor),
    onSnapshot: (props) => record(props, null),
    onError: (error) => console.warn('[Piece tally]', error),
  };

  function reset() {
    tally = new Tally();
    reconcile();
    save();
    refresh();
  }

  function refresh() {
    if (!overlay) return;
    if (!inGame()) {
      overlay.render({ status: 'Waiting for a multiplayer game…', rows: [], untracked: 0 });
      return;
    }
    const photon = modules().photon;
    const present = attempt(() => photon.getPlayerNames(), []);
    const me = attempt(() => photon.getPlayerNameFromId(photon.getMyPlayerId()), null);
    const grid = currentGrid();
    const made = tally.totalEdges;
    overlay.render({
      status: grid ? `${made} of ${totalEdgesInGrid(grid)} edges connected` : `${made} edges connected`,
      rows: tally.rows(present),
      untracked: tally.untracked,
      me,
    });
  }

  const interval = setInterval(() => {
    ticks++;
    if (!window.jigexGlobals) {
      if (ticks >= GIVE_UP_AFTER_TICKS) clearInterval(interval);
      return;
    }
    if (!overlay && document.documentElement) overlay = createOverlay({ onReset: reset });
    installHooks(modules().photon, hookHandlers);
    if (inGame()) {
      syncSession();
      drainPending();
      if (ticks % RECONCILE_EVERY_TICKS === 0) reconcile();
    }
    refresh();
  }, TICK_MS);

  window.addEventListener('pagehide', save);
})();
