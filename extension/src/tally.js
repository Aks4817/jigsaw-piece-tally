// Counts connected edges from the game's `p-<pieceId>` room properties.
//
// A snap can connect many edges at once: merging two big groups connects every
// pair of touching pieces along their border. So we track which pieces are
// joined, and when an update merges two groups, the player earns one point per
// touching pair between them. Moving a group or re-sending an update merges
// nothing and earns nothing. A finished puzzle has every edge connected exactly
// once, whatever order the pieces went in.
//
// Piece ids run left to right, top to bottom, starting at 1.
(function (root) {
  'use strict';

  const PIECE_KEY = /^p-(\d+)$/;

  function adjacentIds(id, grid) {
    const index = id - 1;
    const column = index % grid.cols;
    const row = Math.floor(index / grid.cols);
    const ids = [];
    if (column > 0) ids.push(id - 1);
    if (column < grid.cols - 1) ids.push(id + 1);
    if (row > 0) ids.push(id - grid.cols);
    if (row < grid.rows - 1) ids.push(id + grid.cols);
    return ids;
  }

  function totalEdgesInGrid(grid) {
    return grid.rows * (grid.cols - 1) + grid.cols * (grid.rows - 1);
  }

  class Tally {
    constructor(saved) {
      this.parent = new Map(saved ? saved.parent : []);
      this.counts = new Map(saved ? saved.counts : []);
      // Edges connected while we weren't watching, so have no reliable author.
      this.untracked = saved ? saved.untracked : 0;
      this.members = new Map();
      for (const id of [...this.parent.keys()]) {
        const groupRoot = this.find(id);
        if (!this.members.has(groupRoot)) this.members.set(groupRoot, []);
        this.members.get(groupRoot).push(id);
      }
    }

    find(id) {
      if (!this.parent.has(id)) {
        this.parent.set(id, id);
        this.members.set(id, [id]);
      }
      let node = id;
      while (this.parent.get(node) !== node) {
        const next = this.parent.get(node);
        this.parent.set(node, this.parent.get(next));
        node = next;
      }
      return node;
    }

    // Merges the groups holding a and b. Returns the edges this connected, or
    // null if they were already one group.
    merge(a, b, grid) {
      const rootA = this.find(a);
      const rootB = this.find(b);
      if (rootA === rootB) return null;
      const [small, large] =
        this.members.get(rootA).length <= this.members.get(rootB).length ? [rootA, rootB] : [rootB, rootA];

      let edges = 0;
      for (const id of this.members.get(small)) {
        for (const neighbor of adjacentIds(id, grid)) {
          if (this.parent.has(neighbor) && this.find(neighbor) === large) edges++;
        }
      }

      this.parent.set(small, large);
      this.members.get(large).push(...this.members.get(small));
      this.members.delete(small);
      return edges;
    }

    // `nameFor(actorNr)` names the player to credit. Pass null to record new
    // edges as untracked. Returns how many groups were merged.
    ingest(props, nameFor, grid) {
      if (!props || typeof props !== 'object') return 0;
      let merges = 0;
      for (const key of Object.keys(props)) {
        const match = PIECE_KEY.exec(key);
        if (!match) continue;
        const record = props[key];
        if (!record || typeof record !== 'object') continue;
        const pieceId = Number(match[1]);
        const groupId = Number(record.g);
        // g is 0 for a piece that isn't in a group yet.
        if (!Number.isInteger(groupId) || groupId <= 0) continue;
        const edges = this.merge(pieceId, groupId, grid);
        if (edges === null) continue;
        merges++;
        if (nameFor) {
          const name = nameFor(record.p);
          this.counts.set(name, (this.counts.get(name) || 0) + edges);
        } else {
          this.untracked += edges;
        }
      }
      return merges;
    }

    get totalEdges() {
      let sum = this.untracked;
      for (const count of this.counts.values()) sum += count;
      return sum;
    }

    // Highest score first. Players in `present` are listed even with no edges.
    rows(present) {
      const names = new Set(this.counts.keys());
      for (const name of present || []) names.add(name);
      return [...names]
        .map((name) => ({ name, count: this.counts.get(name) || 0 }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    }

    serialize() {
      return {
        parent: [...this.parent.entries()],
        counts: [...this.counts.entries()],
        untracked: this.untracked,
      };
    }
  }

  const api = { Tally, totalEdgesInGrid };
  root.__jigsawTally = Object.assign(root.__jigsawTally || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
