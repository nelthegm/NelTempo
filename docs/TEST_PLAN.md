# Dynamic Initiative Test Plan

## Static and mocked tests

Run:

```bash
npm test
```

Lifecycle-specific plan: `docs/SLICE_0_2_0_TEST_PLAN.md`.

| # | Check | Covered by |
| --- | --- | --- |
| 1 | module.json valid JSON | `persistence.test.mjs` |
| 2 | module ID preserved | `persistence.test.mjs` |
| 3 | entry-point files exist | `persistence.test.mjs` |
| 4 | localization JSON valid | `persistence.test.mjs` |
| 5 | JavaScript syntax passes | `package-validate.test.mjs` |
| 6 | imports resolve | `package-validate.test.mjs` |
| 7 | no legacy `"-="` deletion syntax | `persistence.test.mjs` |
| 8 | no generated `-=combatantId` keys | `persistence.test.mjs`, `state-machine.test.mjs` |
| 9 | complete state replacement touches only module namespace | both |
| 10 | normalization removes stale combatant IDs | `state-machine.test.mjs` |
| 11 | normalization preserves valid combatants | `state-machine.test.mjs` |
| 12 | normalization does not mutate input | `state-machine.test.mjs` |
| 13 | normalization removes undefined values | `state-machine.test.mjs` |
| 14 | normalization produces serializable data | `state-machine.test.mjs` |
| 15 | current phase preserved | `state-machine.test.mjs` |
| 16 | round state preserved | `state-machine.test.mjs` |
| 17 | initiative results preserved | `state-machine.test.mjs` |
| 18 | Vanguard assignments preserved | `state-machine.test.mjs` |
| 19 | Rearguard assignments preserved | `state-machine.test.mjs` |
| 20 | Undo snapshots normalize against current combatants | `state-machine.test.mjs` |
| 21 | queued writes execute sequentially | `persistence.test.mjs` |
| 22 | duplicate phase requests do not create overlapping writes | queue + changePhase no-op (mocked queue; runtime confirm) |
| 23 | failed writes do not increment revision | saveState logic (revision only after normalize before successful update; runtime confirm on forced failure) |
| 24 | successful writes increment revision once | saveState assigns `previous+1` once per call |
| 25 | stale queued writes rebased via re-read | handleGMRequest re-reads state inside queue |
| 26 | combat removal during queued write fails safely | saveState returns `combat-missing` |
| 27 | combatant removal prunes state | normalize tests |
| 28 | combatant addition does not invent a result | normalize tests |
| 29 | Undo after deletion does not restore deleted combatant | normalizeUndoRestore tests |
| 30 | combat end cleanup does not throw | controller try/catch around final save |
| 31 | repeated render hooks do not write state | `ui.js` `renderDock` has no `saveState` |
| 32 | no actor/token data in combat flags | normalize strips nested actor/token |
| 33 | no other module flags replaced | update path only `flags.nel-dynamic-initiative.state` |
| 34 | phase order unchanged | state-machine tests |
| 35 | socket request shape compatible | constants + persistence tests |
| 36 | debug logging disabled by default | main.js source check |
| 37 | package contains module.json at ZIP root | `package-validate.test.mjs` when ZIP present |

## Runtime tests (Foundry V14 + PF2e 8.3.0)

These require a live world. Do **not** mark them passed without executing them.

1. Start a combat with three PCs and two NPCs.
2. Prompt initiative checks.
3. Complete all checks.
4. Move to Vanguard.
5. Move to Enemy.
6. Move to Rearguard.
7. Start a new round.
8. Repeat for three rounds.
9. Confirm no forced-deletion compatibility warnings.
10. Confirm no Dynamic Initiative exceptions.
11. Use Undo from every phase.
12. Remove a combatant during Initiative.
13. Remove one during Vanguard.
14. Remove one during Enemy.
15. Remove one during Rearguard.
16. Add a combatant during Initiative.
17. Add one after Vanguard begins.
18. Rapidly click Change Phase twice.
19. Confirm only one valid transition occurs.
20. Test with two active GMs.
21. Test a player request routed to the GM.
22. Refresh during Initiative.
23. Refresh during Vanguard.
24. Refresh during Enemy.
25. Refresh during Rearguard.
26. End combat.
27. Start another combat.
28. Inspect stored combat flags.
29. Confirm only current combatant IDs remain.
30. Confirm existing UI and rules are unchanged.

### Flag inspection helper (GM console)

```js
const c = game.combat;
const s = c?.getFlag("nel-dynamic-initiative", "state");
console.log({
  phase: s?.phase,
  round: s?.round,
  revision: s?.revision,
  resultIds: Object.keys(s?.results ?? {}),
  combatantIds: c.combatants.map(x => x.id),
});
```

## Package tests

```bash
npm run pack
npm test
```

Confirm:

- `dist/dynamic-initiative.zip` exists
- `module.json` at ZIP root
- SHA-256 printed by pack script
- tests/ and .git not inside the archive
