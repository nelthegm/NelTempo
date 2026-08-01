# Slice 0.2.0 Test Plan

## Automated (mocked / static)

Run: `node tests/state-machine.test.mjs && node tests/persistence.test.mjs && node tests/lifecycle.test.mjs && node tests/package-validate.test.mjs`

Coverage includes:

1. Existing 0.1.5 tests still pass (schema/version bumped).
2. Lifecycle instance creation and unique `phaseInstanceId`.
3. Vanguard / Enemy / Rearguard roster filters and deterministic order.
4. Start boundary once; no replay of completed starts.
5. Start failure preserves completed; retry/skip failed only.
6. Phase opens only after start resolves; End Turn blocked before open.
7. End Turn mark, idempotency, no native end in pure state.
8. Reopen before end; reject after Ending.
9. Phase complete; removed combatants do not block; late joiners not in roster.
10. Force/skip remaining; end boundary once; retry/skip failed ends.
11. Auto-advance setting enum values.
12. Reload interrupt of processing; open restore; ended no replay.
13. Undo-across-end detection.
14. Normalization serializable; no names/documents; V14 `_replace` path.
15. Adapter method resolution + fail-safe without Foundry.
16. No HP/persistent formula/chat parsing in lifecycle paths.
17. Delay / phase order regressions.
18. ZIP root `module.json` when packaged.

## Runtime checklist (Foundry V14 + PF2e 8.3.0)

Perform in a real world (not automated here):

1. Start combat with 3 PCs and 2 NPCs; complete initiative; enter Vanguard.
2. Confirm start-of-turn effects once per Vanguard roster.
3. Players act in any order; End Turn only on owned portraits.
4. End Turn → portrait Ended; Reopen; End again.
5. Phase Complete → Advance → Vanguard end-turn (persistent damage) once; Enemy starts once.
6. Complete Enemy and Rearguard; next round; three full rounds without duplicate persistent damage.
7. Double-click End Turn and Advance Phase (idempotent).
8. Two owners / two GMs: single authoritative processing.
9. Remove unfinished combatant; phase can complete.
10. Add combatant after phase start; not retroactively started.
11. Reload during Open / Starting / Ending.
12. Force Advance; Prompt and Automatic settings.
13. Hidden enemies visibility; defeated combatant; Raise Shield / Parry / Delay.
14. Undo before and after phase end (warning on after).
15. Console: no Dynamic Initiative errors, no `-=` deletion warnings, no name leaks in debug logs.

## Acceptance map

See product acceptance criteria 1–22 in the slice request; automated suite covers pure-state and packaging criteria; runtime list covers native PF2e and multi-client criteria.
