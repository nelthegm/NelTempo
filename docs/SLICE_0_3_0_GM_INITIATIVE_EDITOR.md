# NelTempo 0.3.0 — GM Initiative and Phase Editor

## Purpose

Give GMs a DialogV2 tool to correct combatant phase placement (Vanguard, Enemy, Rearguard, Pending) for the current round when lifecycle-safe, or queue a correction for the next round. Corrections never duplicate start/end boundaries, never invent a new `phaseInstanceId`, and never grant a second turn in the same round.

## Accepted 0.2.2 baseline

- Annotated tag: `v0.2.2`
- Target commit: `eba5cbddbd2365779ba06af73f1827e75c92628f`
- Message: `NelTempo 0.2.2 UI layering runtime accepted`

## Editor access

- GM-only compact pen control on each portrait (`Edit Initiative Placement`, `fa-pen-to-square`)
- Keyboard accessible with `aria-label` / tooltip
- Opens Foundry **DialogV2** (no `prompt()`)
- Hidden from players; unavailable for missing combatants
- Remains available during Starting/Ending for **Next Round** queue management; This Round options are disabled with reasons

## Correction modes

1. **This Round** — immediate assignment/roster update when the safety matrix allows
2. **Next Round** — durable queue entry applied once during round transition

## Current-round safety matrix

| Situation | This Round |
| --- | --- |
| Initiative / no lifecycle | Allow Vanguard, Enemy, Rearguard, Pending |
| Destination is a future phase; combatant not finished | Allow; leave source as skipped (no end boundary); no premature destination start |
| Destination is current Open phase; not finished | Allow join; process missing start once if needed |
| Destination phase already ended | Deny; offer Next Round |
| Combatant completed turn / end boundary | Deny; offer Next Round |
| Lifecycle Preparing/Starting/Ending/Interrupted/Error | Deny This Round |
| Return to Pending after start/act | Deny; offer Next Round |

## Next-round correction queue

Stored under `state.placementCorrections[combatantId]`:

```js
{
  targetPhase,      // vanguard | enemy | rearguard | pending
  effectiveRound,
  status,           // queued | applying | applied | cancelled | failed
  createdBy,        // user id string
  createdAt,
  consumedAt,
  cancelledAt,
  revision
}
```

- One queued correction per combatant
- Replace requires confirmation
- Cancel is GM-only
- Survives reload and phase changes
- Consumed exactly once in `beginRoundTransition` via `consumeQueuedCorrections`
- Stale combatant ids pruned by normalize
- Forced phase assignments do not fabricate dice totals (`forced: true`, `total: null`)
- Queued Pending clears conclusive assignment so normal initiative can resolve

## Original initiative roll preservation

- Original initiative ChatMessages are never edited or deleted
- Die results are not rewritten
- Compact placement records store `originalPhase`, `method` (`gm-current-round` | `gm-next-round` | `gm-pending-reset`), `appliedBy`, `appliedAt`
- Corrected placement is authoritative via `state.placements` → `combatantPhase`

## Placement state model

Schema **4** adds:

- `placements` — current-round GM overrides
- `placementCorrections` — next-round queue
- `placementAudit` — capped audit trail

`combatantPhase` reads placements first (including Pending and Enemy), then delayed/results/side.

## Lifecycle integration

- Pure helpers: `scripts/placement-editor.js`
- Authoritative mutations: `scripts/controller.js` (`placementApply` / queue / cancel)
- Leave open phase: `leaveOpenRoster` (Delay-like skip; no end boundary)
- Join open phase: `appendToOpenRoster` + `runSingleCombatantStart` (no new `phaseInstanceId`, no full Starting transaction)
- Roster construction uses placement phase (GM may put PCs in Enemy without changing disposition)

## Joining current phase

- Adds combatant to open roster
- Invokes native start adapter **once** when missing
- Preserves same-round start via PF2e `roundOfLastTurn` / recorded start status
- Reconciles condition timing and Confused priority
- Failed start enters existing Manual Review / Error recovery

## Leaving current phase

- Allowed only when turn not finished and end boundary not completed
- Marks skipped in source roster; does not run end boundary
- Destination owns eventual start/end when that phase opens

## One-turn-per-round protection

- Completed / end-boundaried combatants cannot rejoin This Round
- Start boundary never replayed for the same combatant in the same round
- End boundary never duplicated via correction
- No second End Turn completion from the editor

## Pending behavior

- No conclusive phase assignment for the relevant round
- Eligible for normal initiative prompts when safe
- Does not erase a completed turn; post-start Pending is Next Round only

## Enemy placement

- Explicit GM adjudication of NelTempo phase only
- Does not change token disposition, ownership, actor type, alliance, or permissions

## Timing / Confused integration

- Conditions are never removed by the editor
- After correction: re-read conditions, recompute Delay eligibility, Confused priority, timing badges
- Does not consume Allow Delay Once
- Correction is not treated as player Delay

## Multi-GM authority

- Requests carry identifiers + operation only
- Authoritative GM reconstructs legality from live documents
- `expectedRevision` rejects stale dialogs
- Mutations serialize through the per-combat queue

## Undo limitations

- Pre-boundary placement corrections enter normal Undo history
- Corrections that invoked native start show **Undo Placement State Only** — actor/HP/condition/chat side effects are not reversed
- Next-round queue reversal is Cancel (no required Undo entry)

## State schema / migration

- Schema 4; missing placement fields default to empty objects
- Idempotent normalize; no rewrite of actors, combatants, or chat
- Uncertain lifecycle remains Manual Review; migration does not auto-apply queues mid-lifecycle

## Diagnostics and privacy

Audit events (ids shortened; no actor/token/user names, no full UUIDs, no private roll details):

- placement-editor-opened (UI), placement-correction-requested/applied/rejected/queued/replaced/cancelled/consumed
- placement-current-phase-joined/left, placement-start-boundary-invoked/preserved
- placement-pending-restored, placement-stale-request-rejected, placement-undo-state-only

## Known limitations

- No raw d20 / initiative total editing
- No player placement editing
- No drag-and-drop ordering
- Does not reopen completed phases
- Does not reverse persistent damage or condition expiration
- Runtime Foundry acceptance requires V14 + PF2e 8.3.0 playtest (see test plan)

## Runtime test requirements

See `docs/SLICE_0_3_0_TEST_PLAN.md`.
