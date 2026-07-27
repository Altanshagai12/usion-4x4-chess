# Usions registration

- [x] Read the canonical Usion app, multiplayer, publishing, and Agent API rules.
- [x] Replace the experimental SDK v3 client with the public SDK contract.
- [x] Verify local play, ordered multiplayer, reconnect, and solo-to-room promotion.
- [x] Build the registry publisher in this repository (`npm run publish:service`),
      pinned to the `state` multiplayer profile so the match stays on the
      platform relay that `syncedState` needs.
- [ ] Deploy the exact tested commit from this standalone repository.
- [ ] Run `npm run publish:service` with `USION_SERVICE_URL` set to the deployed
      origin and a scoped `usion_sk_…` creator token.
- [ ] Verify the published catalog entry and two-client room.

Both open items need credentials this repository does not carry: a deployment
target for the iframe origin and a creator API token. `usionthemobile` stays
untouched — the platform picks the game up from its registry entry alone.
