# Jigsaw Explorer Piece Tally

A Chrome or Edge extension that shows how many connections each player makes in a
[Jigsaw Explorer](https://www.jigsawexplorer.com/) multiplayer game. Only one player
needs to install it.

## Install

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose the `extension` folder.
4. Open or refresh your puzzle page. The **Piece tally** panel appears in the top right.

## How scores work

- A player earns one point for every piece edge they connect.
- Merging two big groups earns one point for each pair of pieces touching along
  the join. Dropping a piece into a hole earns up to 4 points.
- Moving a group earns nothing.
- A puzzle with R rows and C columns has `R×(C−1) + C×(R−1)` edges, so a 10×10
  puzzle has 180. The final scores add up to that number.
- **Not attributed** counts edges connected while the extension wasn't watching,
  such as before you joined or during a refresh. The game doesn't record who made
  those, so they aren't credited to anyone.
- Scores are saved per game in your browser, so a refresh keeps them.

The extension only reads game data. It never sends anything to the game or anywhere else.

## Tests

```bash
node --test test/tally.test.js
```
