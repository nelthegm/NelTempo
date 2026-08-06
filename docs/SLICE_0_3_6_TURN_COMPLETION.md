# NelTempo 0.3.6 — Turn Completion Unification

## Root cause (0.3.5 regression)

Two independent completion authorities disagreed:

1. **UI / header** counted legacy `turn.ended` (and the GM portrait checkmark called `markTurnEnded` without claiming `endStatus`).
2. **Advance Phase** required `endStatus` complete/skipped via `phaseAdvanceReady`.

Result: `Phase Complete · Ended 2/2` while Advance reported unfinished turns. Additionally, `Guard Incomplete Phase = false` was ignored by the authoritative `transitionToPhase` path, which always warn-and-returned when incomplete.

## Canonical selector

`getCombatantLifecycleStatus(lifecycle, combatantId)` is the single source of truth.

- Ordinary complete: `endStatus === completed`
- Resolved for advancement: completed **or** skipped
- Review: failed/interrupted end/start, or legacy `ended` with pending `endStatus`
- Header `Ended X/Y` and `phaseAdvanceReady` use the same progress helper

## Guard Incomplete Phase

- **false:** SET_PHASE skips pending ends immediately (no native `onEndTurn`), never dialog, never warn-only trap
- **true:** incomplete → GM dialog (Return / Process Remaining / Advance Without Processing); Advance Without Processing always available to GM

Read live via `shouldGuardIncompletePhase()` → `game.settings.get("nel-dynamic-initiative", "guardIncompletePhase") === true`.
