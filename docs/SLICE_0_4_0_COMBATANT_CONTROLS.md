# NelTempo 0.4.0 — Combatant Controls & Recovery

## Initiative lane authority

`getCombatantInitiativeLane(state, combatantId, side)` is the canonical current-round selector.

- Enemy without an explicit correction → Enemy
- Party with no valid current-round result → Pending / Awaiting Roll
- Successful current-round result → Vanguard
- Failed current-round result → Rearguard
- Current-round GM placement correction → corrected lane

The selector never infers failure from a missing result. Round transition clears current results and placements before consuming deliberate next-round corrections. A Pending reset is removed when a new roll resolves.

## Combatant controls

GM right-click on a portrait opens one dialog with lifecycle, administrative, phase/initiative, and diagnostic actions. Every mutation is still serialized and re-authorized by the primary-GM request dispatcher.

Lifecycle processing and administrative correction are intentionally separate:

- **Process Start Turn** calls the PF2e start adapter once.
- **End Turn** calls the PF2e end adapter once.
- **Mark Complete** settles NelTempo state without PF2e end processing.
- **Mark Skipped** advances without PF2e end processing.
- **Mark Review** executes neither boundary.
- **Phase correction** moves roster/initiative state without automatically starting, ending, or skipping a turn.

## Recovery safety

Each turn records claimed and processed state for both boundaries. Administrative completion is claimed/completed but unprocessed. Reopen adds an explicit workflow state while preserving the original end claim and processed marker. Closing a reopened settled turn performs only NelTempo bookkeeping.

Retry is available only for adapter failures known to happen before native invocation (for example, missing actor or missing native method). Native throws and reload-interrupted Processing are ambiguous and remain Review.

## Lifecycle inspector

The inspector reports current phase/lane/result, round, primary-GM authority, turn state, and claimed/processed/completed/status/reason for each boundary.
