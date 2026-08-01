# NelTempo 0.3.1 — Test Plan (Portrait Activation)

Companion to `docs/SLICE_0_3_1_PORTRAIT_ACTIVATION.md`.

## Automated

`tests/portrait-activation.test.mjs` plus existing suite (`npm test`):

- Tag `v0.3.0` → `ee509150753834415e0db75ccc893a32296f22e0`
- Version `0.3.1`; module id unchanged
- Client Boolean pan setting default true; no migration
- Exact token/scene identity; duplicate Actor tokens distinct
- Control replace / sole-controlled / permission / off-scene / missing / pan fail / pan disabled
- Activation module has no socket / persist / Undo hooks
- UI uses `activate-portrait` with Activate Token localization

## Runtime (Foundry V14 / PF2e 8.3.0)

Install `dist/dynamic-initiative.zip` in a copied world.

1. No token controlled → click PC portrait → exact token controls; camera pans (setting on)
2. Other token controlled → click portrait → prior released; new token only
3. Multiple controlled → one remains
4. Click already controlled portrait → stays controlled; pans
5. Disable pan setting → token changes without camera move
6. Large/Huge token → centers on token center
7. GM NPC portrait; player owned PC; player unauthorized → permission reject preserves prior
8. Off-scene combatant → no scene switch; prior control kept
9. Deleted token → safe notification
10. End Turn / Delay / placement editor clicks do not also activate
11. Keyboard Enter/Space + focus ring; hover highlight still works
12. Sheets above NelTempo; Confused / Grabbed / Restrained unchanged by activation
13. Pending / Vanguard / Enemy / Rearguard / Ended portraits activate when visible
14. NelClick middle-click then NelTempo portrait → new token controlled
15. Refresh → pan setting persists; no revision/socket from activation-only clicks

Do not mark Foundry runtime acceptance until executed on V14 + PF2e 8.3.0.
