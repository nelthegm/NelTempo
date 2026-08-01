# NelTempo 0.3.0 — Test Plan (GM Initiative Editor)

Companion to `docs/SLICE_0_3_0_GM_INITIATIVE_EDITOR.md`.

## Static / mocked (automated)

Covered primarily by `tests/placement.test.mjs` plus existing lifecycle, timing, persistence, and package tests:

1. Existing tests remain passing after schema 4 / version 0.3.0 bumps
2. Tag `v0.2.2` points at `eba5cbddbd2365779ba06af73f1827e75c92628f`
3. Module version `0.3.0`; id `nel-dynamic-initiative`
4. Initiative-phase set Vanguard / Enemy / Rearguard / Pending
5. Original result totals not fabricated for forced assignments (`total: null`, `forced: true`)
6. Future-phase leave skips end boundary (`endStatus: skipped`, not completed)
7. Current-phase join appends roster without new `phaseInstanceId`
8. Completed turn / past phase / busy lifecycle reject This Round; Next Round remains
9. Queue, replace-with-confirm, cancel, consume-once, prune, Pending next-round
10. Placement records contain no actor/token names
11. Localization keys present; pack includes `placement-editor.js` and slice docs

## Runtime (Foundry V14 / PF2e 8.3.0)

Install `dist/dynamic-initiative.zip` in a **copied** world. Confirm display title **NelTempo**.

Checklist (abbreviated from release AC):

1. During Initiative: set Vanguard / Rearguard / Enemy / Pending; original chat rolls unchanged
2. Open Vanguard: move unacted combatant to Rearguard; no end effects; completion recalculates; later Rearguard start/end once
3. Join current Open phase for a Pending combatant; only that combatant receives start; Confused priority updates if applicable
4. Reject completed combatant rejoin and moves into ended phases; Next Round offered
5. Queue / refresh / replace (confirm) / cancel; Pending and Enemy queues apply exactly once next round
6. Grabbed / Restrained / Confused remain; Allow Delay Once not consumed by editor
7. Double-submit and dual-GM stale revision: one mutation; state-changed message
8. Undo pre-phase correction restores placement; undo after start join shows state-only warning
9. Hidden enemy as player: no editor / no hidden placement details
10. Sheet layering (0.2.2), Delay, End Turn, persistent damage, Raise Shield/Parry unchanged
11. End combat; start another; no queue leak

Do not mark Foundry runtime acceptance until the checklist is executed in V14 + PF2e 8.3.0.
