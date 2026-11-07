'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Tally, totalEdgesInGrid } = require('../extension/src/tally.js');
const { installHooks } = require('../extension/src/hooks.js');
const { resultsText } = require('../extension/src/overlay.js');

// Models the game's messages: drop() sends sendUpdate(this), joins, then
// sendGroupUpdate for the affected pieces, flushed as one per-key batch.
// Piece ids run left to right, top to bottom, from 1.
class FakeGame {
  constructor(grid) {
    this.grid = grid;
    this.groupOf = new Map();
    this.groups = new Map();
  }

  isAdjacent(a, b) {
    const { cols } = this.grid;
    const [ra, ca] = [Math.floor((a - 1) / cols), (a - 1) % cols];
    const [rb, cb] = [Math.floor((b - 1) / cols), (b - 1) % cols];
    return Math.abs(ra - rb) + Math.abs(ca - cb) === 1;
  }

  // Brute-force count of what the drop connects, to check the tally against.
  edgesBetween(piece, neighbor) {
    const side = (id) => this.groups.get(this.groupOf.get(id)) || [id];
    let edges = 0;
    for (const a of side(piece)) {
      for (const b of side(neighbor)) {
        if (this.isAdjacent(a, b)) edges++;
      }
    }
    return edges;
  }

  drop(playerId, piece, neighbor) {
    const batch = {};
    const pieceGroup = this.groupOf.get(piece);
    const neighborGroup = this.groupOf.get(neighbor);
    const ref = pieceGroup ? pieceGroup : piece;
    batch[`p-${ref}`] = { m: 1, x: '0.1', y: '0.2', a: 0, g: pieceGroup || 0, p: playerId };

    let touched;
    if (pieceGroup && neighborGroup) touched = [...this.groups.get(pieceGroup)];
    else if (pieceGroup) touched = [neighbor];
    else touched = [piece];

    if (pieceGroup && neighborGroup) {
      for (const member of this.groups.get(pieceGroup)) {
        this.groupOf.set(member, neighborGroup);
        this.groups.get(neighborGroup).push(member);
      }
      this.groups.delete(pieceGroup);
    } else if (neighborGroup) {
      this.groupOf.set(piece, neighborGroup);
      this.groups.get(neighborGroup).push(piece);
    } else if (pieceGroup) {
      this.groupOf.set(neighbor, pieceGroup);
      this.groups.get(pieceGroup).push(neighbor);
    } else {
      // new Group(piece, neighbor): the neighbour becomes the reference piece.
      this.groupOf.set(piece, neighbor);
      this.groupOf.set(neighbor, neighbor);
      this.groups.set(neighbor, [neighbor, piece]);
    }

    for (const member of touched) {
      batch[`p-${member}`] = { g: this.groupOf.get(member), p: playerId };
    }
    return batch;
  }

  moveGroup(playerId, piece) {
    const group = this.groupOf.get(piece);
    return { [`p-${group}`]: { m: 1, x: '0.3', y: '0.4', a: 0, g: group, p: playerId } };
  }
}

const NAMES = { 1: 'Anuj', 2: 'Sam', 3: 'Riya' };
const nameFor = (actor) => NAMES[actor];
const GRID = { rows: 4, cols: 4 };
//  1  2  3  4
//  5  6  7  8
//  9 10 11 12
// 13 14 15 16

test('a puzzle has the expected number of edges', () => {
  assert.equal(totalEdgesInGrid({ rows: 10, cols: 10 }), 180);
  assert.equal(totalEdgesInGrid({ rows: 2, cols: 2 }), 4);
  assert.equal(totalEdgesInGrid({ rows: 1, cols: 5 }), 4);
});

test('snapping two loose pieces is one edge', () => {
  const tally = new Tally();
  const game = new FakeGame(GRID);
  tally.ingest(game.drop(1, 1, 2), nameFor, GRID);
  assert.equal(tally.counts.get('Anuj'), 1);
  assert.equal(tally.totalEdges, 1);
});

test('joining two big groups scores every edge along the join', () => {
  const tally = new Tally();
  const game = new FakeGame(GRID);
  // Sam builds the left two columns.
  for (const [a, b] of [[1, 5], [9, 5], [13, 9], [2, 1], [6, 2], [10, 6], [14, 10]]) {
    tally.ingest(game.drop(2, a, b), nameFor, GRID);
  }
  // Riya builds the right two columns.
  for (const [a, b] of [[3, 7], [11, 7], [15, 11], [4, 3], [8, 4], [12, 8], [16, 12]]) {
    tally.ingest(game.drop(3, a, b), nameFor, GRID);
  }
  const samBefore = tally.counts.get('Sam');
  const riyaBefore = tally.counts.get('Riya');

  // Anuj attaches the left half to the right half: 2-3, 6-7, 10-11, 14-15.
  tally.ingest(game.drop(1, 2, 3), nameFor, GRID);

  assert.equal(tally.counts.get('Anuj'), 4);
  assert.equal(tally.counts.get('Sam'), samBefore);
  assert.equal(tally.counts.get('Riya'), riyaBefore);
  assert.equal(tally.totalEdges, totalEdgesInGrid(GRID));
});

test('dropping a piece into a hole scores all of its sides', () => {
  const grid = { rows: 3, cols: 3 };
  const tally = new Tally();
  const game = new FakeGame(grid);
  // Build the ring around piece 5.
  for (const [a, b] of [[1, 2], [3, 2], [6, 3], [9, 6], [8, 9], [7, 8], [4, 7]]) {
    tally.ingest(game.drop(2, a, b), nameFor, grid);
  }
  // Piece 4 also touches piece 1, closing the ring.
  assert.equal(tally.counts.get('Sam'), 8);
  tally.ingest(game.drop(1, 5, 2), nameFor, grid);
  assert.equal(tally.counts.get('Anuj'), 4);
  assert.equal(tally.totalEdges, totalEdgesInGrid(grid));
});

test('moving a finished group earns nothing', () => {
  const tally = new Tally();
  const game = new FakeGame(GRID);
  tally.ingest(game.drop(1, 1, 2), nameFor, GRID);
  tally.ingest(game.moveGroup(2, 1), nameFor, GRID);
  assert.equal(tally.counts.get('Sam'), undefined);
  assert.equal(tally.totalEdges, 1);
});

test('moving a loose piece earns nothing', () => {
  const tally = new Tally();
  const props = { 'p-7': { m: 1, x: '0', y: '0', a: 0, g: 0, p: 1 } };
  assert.equal(tally.ingest(props, nameFor, GRID), 0);
  assert.equal(tally.totalEdges, 0);
});

test('a joined piece scores correctly when the group id is a distant piece', () => {
  // Group ids are the reference piece's id, which needn't touch the new piece.
  const tally = new Tally();
  const game = new FakeGame(GRID);
  tally.ingest(game.drop(1, 1, 2), nameFor, GRID); // Group 2 holds 1 and 2.
  tally.ingest(game.drop(1, 5, 1), nameFor, GRID); // g is 2, but 5 touches only 1.
  assert.equal(tally.counts.get('Anuj'), 2);
});

test('a full random game matches a brute-force count for every player', () => {
  const grid = { rows: 12, cols: 15 };
  const tally = new Tally();
  const game = new FakeGame(grid);
  const expected = { Anuj: 0, Sam: 0, Riya: 0 };
  const pieces = grid.rows * grid.cols;
  const sameGroup = (a, b) => game.groupOf.get(a) && game.groupOf.get(a) === game.groupOf.get(b);
  let seed = 42;
  const random = (limit) => {
    // mulberry32. Math.imul keeps the multiply exact, so every value is reachable.
    seed = (seed + 0x6d2b79f5) | 0;
    let mixed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return (((mixed ^ (mixed >>> 14)) >>> 0) % limit) + 1;
  };
  let merges = 0;
  while (merges < pieces - 1) {
    const a = random(pieces);
    const b = [a - 1, a + 1, a - grid.cols, a + grid.cols][random(4) - 1];
    if (b < 1 || b > pieces || !game.isAdjacent(a, b) || sameGroup(a, b)) continue;
    const player = random(3);
    expected[NAMES[player]] += game.edgesBetween(a, b);
    tally.ingest(game.drop(player, a, b), nameFor, grid);
    merges++;
  }
  assert.deepEqual(Object.fromEntries(tally.counts), expected);
  assert.equal(tally.totalEdges, totalEdgesInGrid(grid));
});

test('replaying the same updates is not counted twice', () => {
  const tally = new Tally();
  const game = new FakeGame(GRID);
  const batch = game.drop(1, 1, 2);
  tally.ingest(batch, nameFor, GRID);
  tally.ingest(batch, nameFor, GRID);
  assert.equal(tally.totalEdges, 1);
});

test('edges from before we arrived are not attributed, and later ones are', () => {
  const tally = new Tally();
  const game = new FakeGame(GRID);
  const room = { ...game.drop(1, 1, 2), ...game.drop(2, 5, 1), edo: true };
  tally.ingest(room, null, GRID);
  assert.equal(tally.untracked, 2);
  assert.equal(tally.counts.size, 0);
  tally.ingest(game.drop(3, 6, 5), nameFor, GRID); // Touches 5 and 2.
  assert.equal(tally.counts.get('Riya'), 2);
  assert.equal(tally.totalEdges, 4);
});

test('a snapshot scores every edge whatever order its records arrive in', () => {
  // Group ids point at distant pieces, so early merges can connect no edges yet.
  const room = {
    'p-1': { g: 16, p: 1 },
    'p-2': { g: 16, p: 1 },
    'p-3': { g: 16, p: 1 },
    'p-4': { g: 16, p: 1 },
  };
  const tally = new Tally();
  tally.ingest(room, null, GRID);
  assert.equal(tally.untracked, 3); // 1-2, 2-3, 3-4. Piece 16 touches none of them.
});

test('reconciling room state finds only edges that were missed', () => {
  const tally = new Tally();
  const game = new FakeGame(GRID);
  const seen = game.drop(1, 1, 2);
  tally.ingest(seen, nameFor, GRID);
  const missed = game.drop(2, 5, 2);
  tally.ingest({ ...seen, ...missed }, null, GRID);
  assert.equal(tally.counts.get('Anuj'), 1);
  assert.equal(tally.untracked, 1);
});

test('malformed and unrelated properties are ignored', () => {
  const tally = new Tally();
  const props = {
    edo: true,
    'p-abc': { g: 1, p: 1 },
    'p-1': null,
    'p-2': 'nope',
    'p-3': { g: 'x', p: 1 },
    'p-4': { g: -1, p: 1 },
    'p-5': { g: 5, p: 1 },
  };
  assert.equal(tally.ingest(props, nameFor, GRID), 0);
  assert.equal(tally.ingest(null, nameFor, GRID), 0);
});

test('a name like __proto__ is an ordinary player', () => {
  const tally = new Tally();
  tally.ingest({ 'p-1': { g: 2, p: 1 } }, () => '__proto__', GRID);
  assert.deepEqual(tally.rows([]), [{ name: '__proto__', count: 1 }]);
});

test('scores and groups survive saving and loading', () => {
  const tally = new Tally();
  const game = new FakeGame(GRID);
  tally.ingest(game.drop(1, 1, 2), nameFor, GRID);
  tally.ingest(game.drop(1, 5, 1), nameFor, GRID);
  const restored = new Tally(JSON.parse(JSON.stringify(tally.serialize())));
  assert.equal(restored.counts.get('Anuj'), 2);
  assert.equal(restored.ingest(game.moveGroup(2, 1), nameFor, GRID), 0);
  // Piece 6 touches 2 and 5, so scoring it needs the restored group's members.
  restored.ingest(game.drop(2, 6, 5), nameFor, GRID);
  assert.equal(restored.counts.get('Sam'), 2);
});

test('rows are ranked and include players with no edges', () => {
  const tally = new Tally();
  tally.ingest({ 'p-1': { g: 2, p: 1 } }, nameFor, GRID);
  tally.ingest({ 'p-3': { g: 4, p: 2 } }, nameFor, GRID);
  tally.ingest({ 'p-8': { g: 4, p: 2 } }, nameFor, GRID);
  assert.deepEqual(tally.rows(['Riya', 'Sam']), [
    { name: 'Sam', count: 2 },
    { name: 'Anuj', count: 1 },
    { name: 'Riya', count: 0 },
  ]);
});

function fakePhoton() {
  const calls = [];
  return {
    calls,
    onPropertyChange(props, immediate) {
      calls.push(['in', props, immediate]);
      return 'in-result';
    },
    changeProperties(props) {
      calls.push(['out', props]);
      return 'out-result';
    },
  };
}

test('hooks wait until the game has assigned its handler', () => {
  const photon = fakePhoton();
  photon.onPropertyChange = null;
  assert.equal(installHooks(photon, {}), false);
  assert.equal(installHooks(null, {}), false);
});

test('hooks route each direction and still call the game', () => {
  const photon = fakePhoton();
  const seen = [];
  const handlers = {
    onRemote: (props) => seen.push(['remote', props]),
    onLocal: (props) => seen.push(['local', props]),
    onSnapshot: (props) => seen.push(['snapshot', props]),
  };
  assert.equal(installHooks(photon, handlers), true);

  assert.equal(photon.onPropertyChange({ a: 1 }), 'in-result');
  assert.equal(photon.onPropertyChange({ b: 2 }, true), 'in-result');
  assert.equal(photon.changeProperties({ c: 3 }), 'out-result');

  assert.deepEqual(seen, [
    ['remote', { a: 1 }],
    ['snapshot', { b: 2 }],
    ['local', { c: 3 }],
  ]);
  assert.deepEqual(photon.calls, [
    ['in', { a: 1 }, undefined],
    ['in', { b: 2 }, true],
    ['out', { c: 3 }],
  ]);
});

test('hooks install only once', () => {
  const photon = fakePhoton();
  let count = 0;
  const handlers = { onRemote: () => count++ };
  installHooks(photon, handlers);
  installHooks(photon, handlers);
  photon.onPropertyChange({});
  assert.equal(count, 1);
});

test('an error in our code never reaches the game', () => {
  const photon = fakePhoton();
  const errors = [];
  const boom = () => {
    throw new Error('boom');
  };
  installHooks(photon, {
    onRemote: boom,
    onLocal: boom,
    onSnapshot: boom,
    onError: (error) => errors.push(error.message),
  });
  assert.equal(photon.onPropertyChange({}), 'in-result');
  assert.equal(photon.changeProperties({}), 'out-result');
  assert.deepEqual(errors, ['boom', 'boom']);
});

test('copied results list everyone in order', () => {
  const text = resultsText({
    rows: [{ name: 'Sam', count: 2 }, { name: 'Anuj', count: 1 }],
    untracked: 4,
  });
  assert.equal(text, '1. Sam: 2\n2. Anuj: 1\nNot attributed: 4');
});
