# NelTempo 0.4.0 — Test Plan

Automated coverage is in `tests/combatant-controls-040.test.mjs` plus the existing state, persistence, lifecycle, timing, placement, authority, and UI suites.

Runtime acceptance should verify on Foundry 14.365 / PF2e 8.4.x:

1. Begin a round with two eligible PCs; both appear in Awaiting Roll before rolling and after reload.
2. Resolve one success and leave one unresolved; reload preserves Vanguard plus Awaiting Roll with an empty Rearguard lane.
3. Resolve failure; the portrait moves directly from Awaiting Roll to Rearguard without duplication.
4. Reset a result to Awaiting Roll, reroll, and verify the reset marker no longer pins the portrait.
5. Right-click as player (no controls) and GM (all context-appropriate controls).
6. Confirm Process Start and End Turn invoke the configured native lifecycle once.
7. Confirm Mark Complete/Skipped/Review produce no PF2e actor, condition, persistent-damage, recovery, or duration processing.
8. Reopen a processed turn and close it; verify no second end-turn mechanics occur.
9. Force a pre-invocation adapter failure and verify Retry appears; force an ambiguous native throw/interrupted record and verify Retry does not appear.
10. Move a combatant between phases and verify no start/end boundary runs until selected explicitly.
11. Inspect Lifecycle and compare claimed/processed/completed fields with the performed action.
