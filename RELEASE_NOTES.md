# NelTempo 0.4.0 RC1

- Delaying to Rearguard now preserves the current open turn instead of treating the combatant as already finished.
- A delayed combatant resumes the same turn in Rearguard without duplicate PF2e Start Turn processing.
- Delaying does not invoke PF2e End Turn.
- Repaired phase/recovery confirmation paths that could fail on an undefined dialog helper.

Version remains `0.4.0`; the release target remains `v0.4.0-rc1`.
