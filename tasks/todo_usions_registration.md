# Usions registration

- [x] Read the canonical Usion app, multiplayer, publishing, and Agent API rules.
- [x] Replace the experimental SDK v3 client with the public SDK contract.
- [x] Verify local play, ordered multiplayer, reconnect, and solo-to-room promotion.
- [x] Build the registry publisher in this repository (`npm run publish:service`),
      pinned to the `state` multiplayer profile so the match stays on the
      platform relay that `syncedState` needs.
- [x] Deploy the tested commit from this standalone repository to Railway
      (`usion-4x4-chess` project/service).
- [x] Register the public iframe through the creator API without changing
      `usionthemobile` — service id `4-4-chess-last-man-stand-891b95f2`.
- [x] Verify the published catalog entry: platform-relay transport
      (`realtime: null`), 2–2 seats, `service_type: game`, published.
- [ ] Play a two-phone match from a chat game invite to confirm the room end to
      end (needs two real Usions accounts).

Redeploy with `railway up -y -c --service usion-4x4-chess`, then re-run
`npm run publish:service` with `USION_SERVICE_URL` and a `usion_sk_…` token if
the catalog entry itself needs updating.
