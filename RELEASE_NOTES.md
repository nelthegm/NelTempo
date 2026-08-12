# NelTempo 0.4.0 RC2

- Delaying to Rearguard now preserves the current open turn instead of treating the combatant as already finished.
- A delayed combatant resumes the same turn in Rearguard without duplicate PF2e Start Turn processing.
- Delaying does not invoke PF2e End Turn.
- Repaired phase/recovery confirmation paths that could fail on an undefined dialog helper.
- A delayed turn now overrides an earlier same-round GM placement when the
  Rearguard roster is built, including after reload.

Version remains `0.4.0`; the release target is `v0.4.0-rc2`.
