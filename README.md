# 4×4 Chess: Last Man Stand

A standalone browser game inspired by the compact last-man-standing chess
variant. In Usions, two players join the same platform-owned room from separate
phones using the public SDK's ordered game transport.

> Not a single line is added to the Usions (`usionthemobile`) repository. This
> game is an independently hosted iframe mini app, and it reaches the platform
> only by registering in the **service registry** — see
> [Register on Usions](#register-on-usions).

## Rules

Each side is dealt a fourteen-piece tray: seven back-rank pieces (rook, knight,
bishop, **queen**, bishop, knight, rook) over seven pawns. There is no king.

- On each turn, either deploy one piece from your tray onto an empty square or
  move a piece already on the board.
- Pieces use standard chess movement. With no king there is no check and no
  checkmate — every piece can simply be taken.
- A pawn may **not** be deployed straight onto its promotion rank; promotion has
  to be walked into. Every other piece can drop on any free square.
- Reaching the far rank promotes a pawn to a Queen Pawn.
- Wipe out every rival piece, on the board and in the tray, to win. A side that
  still holds pieces but has no deploy square and no legal move also loses,
  which keeps a jammed board from deadlocking.
- Usions multiplayer applies actions only after the server echo and restores
  the latest checkpoint after reconnecting.
- A second player always arrives through the platform: `Usion.game.invite()` or
  the host Share button. The game implements no room codes, invites, or
  matchmaking of its own.
- Inside Usions the lobby holds the screen until both seats are connected, and
  the board is live only on your own turn — the two players always play from
  their own devices. Offline hot-seat exists only outside the Usions host.
- Each player views the board from their own side: your army is on the near
  rank with your tray beneath it, so black sees the board rotated 180°.
- Piece glyphs carry the U+FE0E text-presentation selector. Without it iOS
  draws U+265F with the colour emoji font, which ignores `color`, and the white
  army ends up holding black pawns on a phone while the web build looks fine.

## Usions integration

- `Usion.init` runs before game startup.
- Multiplayer handlers are registered for both solo and multiplayer launches.
- `Usion.game.connect()` and `Usion.game.join(roomId)` use the assigned room.
- `Usion.game.syncedState` sequences moves and checkpoints every action.
- Player seats come from `config.playerIds`; seat one is white and seat two black.
- `Usion.game.invite()` opens the platform's own friend picker, and
  `onRoomAssigned` joins the room a solo launch is promoted into.
- Embedding is detected via `window.ReactNativeWebView` **or** an iframe parent.
  The Usions phone app is a React Native WebView where `window.parent ===
  window`, so an iframe-only check would skip SDK setup on every phone.

## Development

```bash
npm install
npm run dev
npm test
```

## Deploy

The game is hosted from this repository, never from `usionthemobile`. Railway
runs it as a Node process: Railpack builds with `npm run build` and serves with
`npm start`, which binds Railway's `$PORT` (`railway.json`).

```bash
railway init --name usion-4x4-chess
railway add --service usion-4x4-chess
railway up -y -c --service usion-4x4-chess
railway domain
```

Redeploy later with `railway up -y -c --service usion-4x4-chess`.

## Production

| | |
| --- | --- |
| URL | https://usion-4x4-chess.soninangilug.chatgpt.site/ |
| Host | OpenAI Sites — project configured in `.openai/hosting.json` |
| Usion service id | `4-4-chess-last-man-stand-891b95f2` (`service_type: game`, published) |
| Transport | `multiplayer.profile: state` — platform WebSocket relay, 2 seats |
| SDK | v2 / protocol 2, matching `https://usions.com/usion-sdk.js` |
| Leaderboard | none — chess produces a winner, not a score |

No change was made to `usionthemobile`. The game appears on the platform purely
through its registry entry.

## Register on Usions

Usions hosts no game code of its own. A game lives in its own repository, is
deployed from there, and appears on the platform once a service registry entry
points at the deployed origin. `scripts/publish-service.js` writes that entry
and nothing else.

1. Deploy this repository and note the public https origin.
2. Mint a scoped creator token in the app: **Service Creator → Agent API Access
   → Create API token**. The raw `usion_sk_…` token is shown once.
3. Publish. Never commit the token or paste it into source files.

```powershell
$env:USION_SERVICE_URL = 'https://<deployed-origin>'
$env:USION_API_TOKEN = '<your usion_sk_ token>'
npm run publish:service
Remove-Item Env:USION_API_TOKEN
```

The script registers the game the first time and updates the same entry on
every later run, so it is safe to re-run after a redeploy. Set
`USION_SERVICE_ID` to target an existing entry directly, and
`USION_SERVICE_IMAGE` to a public https PNG for the catalog image.
`npm run publish:service -- --dry-run` prints the exact payload without a token
and without touching the registry.

### The registry entry

```json
{
  "name": "4×4 Chess: Last Man Stand",
  "service_type": "game",
  "cost": 0,
  "tags": ["game", "multiplayer", "iframe", "strategy", "turn-based", "chess"],
  "is_published": true,
  "multiplayer": { "profile": "state", "maxPlayers": 2 }
}
```

`multiplayer.profile: "state"` is the field that matters. It keeps the match on
the platform relay, which is the transport `Usion.game.syncedState` requires,
and fixes the room at two seats. Registering the same tags without it makes the
registry classify this as a direct-mode game and derive `realtime.ws_url` from
the iframe host — a game server this repository never deploys, so every room
would fail to connect. The publisher re-reads the public catalog after writing
and fails if the stored entry is not a two-seat platform-relay match.

The service carries no leaderboard: last-man-standing chess produces a winner,
not a score, so the platform records loop does not apply.
