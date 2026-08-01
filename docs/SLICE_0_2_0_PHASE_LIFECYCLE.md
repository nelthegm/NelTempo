# Slice 0.2.0 — Phase Lifecycle and Player End Turn

## Design goals

- Start-of-turn processing runs once when a combat phase begins.
- Players act in any order during Vanguard / Enemy / Rearguard.
- **End Turn** only marks a combatant finished; it does not run PF2e end-of-turn logic.
- End-of-turn processing (including persistent damage) runs once when leaving the phase.
- Every lifecycle boundary is exactly-once across reloads, double-clicks, Undo, and multi-GM.
- Architecture prepares later Grabbed / Restrained / Confused timing rules (not in this slice).

## Phase order (unchanged)

1. Initiative  
2. Vanguard  
3. Enemy  
4. Rearguard  
5. New round / Initiative  

## Phase lifecycle statuses

`preparing` → `starting` → `open` → `complete` → `ending` → `ended`  
Also: `interrupted`, `error` (manual recovery).

Per-combatant boundary statuses: `pending`, `processing`, `completed`, `skipped`, `failed`, `interrupted`.

## Lifecycle state model

Stored under `flags.nel-dynamic-initiative.state.lifecycle` (schema 3):

```js
{
  phaseInstanceId, // unique per phase entry
  round,
  phase,
  status,
  roster: [combatantId, ...], // deterministic snapshot
  forcedAdvance: boolean,
  start: { status, startedAt, completedAt, processedCombatants, failedCombatants },
  end:   { status, startedAt, completedAt, processedCombatants, failedCombatants },
  turns: {
    [combatantId]: {
      ended, endedBy, endedAt, reopenedAt, skipped,
      startStatus, endStatus, startReason, endReason
    }
  }
}
```

Plain serializable data only. No actor/token names or document references.

## phaseInstanceId

- Generated on every entry into Vanguard, Enemy, or Rearguard.
- Not derived only from phase name.
- Undo / re-entry creates a new instance when a new phase is entered.
- Idempotency keys include combat id + phaseInstanceId + combatant id + boundary.

## Phase roster

Snapshotted at phase entry from existing assignment rules:

| Phase | Roster |
| --- | --- |
| Vanguard | Party combatants with Vanguard result (not delayed) |
| Enemy | Enemy-side combatants |
| Rearguard | Party combatants with Rearguard assignment (including delayed) |

**Order:** higher initiative total first, then combatant id (`localeCompare`). Stored on `lifecycle.roster`.

**Excluded:** deleted combatants, combatants with no actor (adapter rejects), combatants not in the snapshot.

**Defeated:** included in roster when still in the encounter; PF2e `onEndTurn` skips condition processing when `actor.isDead`.

**Added mid-phase:** not added to the current roster; no retroactive start.

**Removed mid-phase:** pruned from unfinished tracking; do not block completion.

## Exact PF2e APIs inspected

| Source | Location |
| --- | --- |
| Foundry V14 Combat turn events | `resources/app/client/data/documents/combat.js` — `_manageTurnEvents`, `_onStartTurn`, `_onEndTurn`, `turnEvents` option |
| PF2e 8.3.0 EncounterPF2e | `src/module/encounter/document.ts` — `_onStartTurn`, `_onEndTurn` |
| PF2e 8.3.0 CombatantPF2e | `src/module/encounter/combatant.ts` — `onStartTurn()`, `onEndTurn({ round })` |
| Local older PF2e 6.x build | `startTurn()` / `endTurn({ round })` (adapter fallback) |

## Native start-turn pathway

Normal PF2e: combat turn change → `EncounterPF2e._onStartTurn` → `combatant.onStartTurn()`:

1. Flag `roundOfLastTurn`
2. Rule elements `onUpdateEncounter({ event: "turn-start" })`
3. `actor.recharge({ duration: "round" })`
4. Effect `onEncounterEvent("turn-start")`
5. Hook `pf2e.startTurn`

**Dynamic Initiative:** `scripts/pf2e-lifecycle-adapter.js` → `processStartTurn` calls `onStartTurn` (or `startTurn`) directly for each roster combatant at phase start. Does **not** flip `combat.turn` per combatant.

## Native end-turn pathway

Normal PF2e: turn change → `EncounterPF2e._onEndTurn` → `combatant.onEndTurn({ round })`:

1. Active conditions `onEndTurn({ token })` (includes **persistent damage** rolls and recovery)
2. Effect `onEncounterEvent("turn-end")`
3. Flag `roundOfLastTurnEnd`
4. Hook `pf2e.endTurn`

**Dynamic Initiative:** `processEndTurn` at formal phase leave only.

## Persistent-damage handling

- Handled exclusively by PF2e condition `onEndTurn` inside native `combatant.onEndTurn`.
- Module does not roll formulas, flat checks, chat parsing, or HP writes.
- Occurs at phase-end boundary for each valid roster combatant still present.

## Start-boundary transaction

1. Validate transition; complete previous end boundary if needed.  
2. Snapshot roster; create lifecycle (`preparing`).  
3. Persist `starting`; process each roster combatant once.  
4. On failure: leave `error`, preserve completed, notify GM once.  
5. On success: status `open`.  
6. End Turn disabled until `open`.

## End Turn behavior

- Visible to combatant owners and GMs on carousel portraits when status is `open`.
- Sets `ended`, `endedBy`, `endedAt`; syncs `acted`.
- Idempotent; no phase change; no `combat.turn` lifecycle; no native end processing.
- After all finished → status `complete`.

## Reopen Turn

- Allowed only while status is `open` and the turn was ended (not during `ending`/`ended`).
- Clears ended flags; does not replay start processing or reverse PF2e actions.

## Phase completion

- UI: `Ended X / Y`, remaining count, **Phase Complete**.
- GM: **End Remaining Turns**, **Advance Phase**, **Force Advance** (DialogV2).
- Setting **Advance Completed Phases Automatically**: `off` (default) | `prompt` | `automatic`.

## End-boundary transaction

1. Lock End/Reopen; status `ending`.  
2. Native end-turn once per valid roster combatant (deterministic order).  
3. Status `ended`; enter next phase (new instance / initiative round).

## Failure and recovery

- **Retry Failed Start / End** — only pending/failed/interrupted combatants.  
- **Skip Failed Start / End** — explicit GM; records skipped; does not pretend native success.  
- Failed mid-run does not re-run completed combatants.

## Reload behavior

| Mid-state | Behavior |
| --- | --- |
| Preparing / Starting / Ending with `processing` | Interrupt uncertain entries; GM recovery |
| Open | Restore ended states; no start replay |
| Ended | No end replay |

Authoritative GM runs `reconcileLifecycleOnReady` on world ready.

## Multi-GM authority

Only `isPrimaryGM()` (Foundry `activeGM` or lowest id) runs lifecycle boundaries, auto-advance, and recovery. Players route End/Reopen via socket; GM revalidates ownership.

## combat.turn compatibility

- Claim may set native turn with **`turnEvents: false`** for markers only.
- Lifecycle never depends on turn index changes.
- Native tracker remains suppressed while Dynamic Initiative is active.

## Undo limitations

- Undo during Open restores state only; does not replay native starts.
- Undo across a completed phase-end shows **Undo Phase State Only** warning (DialogV2): actor/PF2e side effects are not reversed.

## Deferred (Slice 0.2.1+)

- Grabbed / Restrained barred from Rearguard  
- Grapple duration / source-creature tracking  
- Confused acts first / cannot Delay  
- GM initiative reassignment editor  

## Known limitations

- Local dev may have older PF2e than 8.3.0; adapter supports both method names.
- Reaction recharge for *other* combatants that Foundry fires inside `EncounterPF2e._onStartTurn` is not re-simulated when calling combatant methods directly; same-round recharge uses combatant `onStartTurn` / `actor.recharge({ duration: "round" })`.
- Delayed Vanguard combatants skip Vanguard end boundary and receive Rearguard start only if PF2e same-round start has not already run (`roundOfLastTurn` guard).
