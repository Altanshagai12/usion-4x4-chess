# 4×4 Chess: Last Man Stand

A standalone browser game inspired by the compact last-man-standing chess
variant. In Usions, two players join the same room from separate phones using
the SDK v3 ordered game transport.

## Rules

- On each turn, deploy one reserve piece or move one piece already on the board.
- Pieces use standard chess movement, but there is no check or checkmate.
- Kings can be captured like any other piece.
- Pawns promote to queens on the opposite edge.
- Eliminate every opposing board and reserve piece to win.
- Usions multiplayer applies actions only after the server echo and restores
  the latest checkpoint after reconnecting.

## Development

```bash
npm install
npm run dev
npm test
```
