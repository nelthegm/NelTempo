# NelTempo 0.4.0

- Delaying to Rearguard now preserves the current open turn instead of treating the combatant as already finished.
- A delayed combatant resumes the same turn in Rearguard without duplicate PF2e Start Turn processing.
- Delaying does not invoke PF2e End Turn.
- Repaired phase/recovery confirmation paths that could fail on an undefined dialog helper.
- A delayed turn now overrides an earlier same-round GM placement when the
  Rearguard roster is built, including after reload.

Runtime acceptance passed on Foundry VTT 14.365, PF2e 8.4.0, and Forge VTT. This is the stable `v0.4.0` release.
