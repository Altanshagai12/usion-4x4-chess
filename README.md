# 4×4 Chess: Last Man Stand

A standalone browser game inspired by the compact last-man-standing chess
variant. In Usions, two players join the same platform-owned room from separate
phones using the public SDK's ordered game transport.

## Rules

- On each turn, deploy one reserve piece or move one piece already on the board.
- Pieces use standard chess movement, but there is no check or checkmate.
- Kings can be captured like any other piece.
- Pawns promote to queens on the opposite edge.
- Eliminate every opposing board and reserve piece to win.
- Usions multiplayer applies actions only after the server echo and restores
  the latest checkpoint after reconnecting.
- A solo Explore launch stays local until the Usions host Share button promotes
  it into a room. The game does not implement room codes, invites, or matchmaking.

## Usions integration

- `Usion.init` runs before game startup.
- Multiplayer handlers are registered for both solo and multiplayer launches.
- `Usion.game.connect()` and `Usion.game.join(roomId)` use the assigned room.
- `Usion.game.syncedState` sequences moves and checkpoints every action.
- Player seats come from `config.playerIds`; seat one is white and seat two black.

## Development

```bash
npm install
npm run dev
npm test
```
