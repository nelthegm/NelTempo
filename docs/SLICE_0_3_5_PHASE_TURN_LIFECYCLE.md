# NelTempo 0.3.5 — Phase Turn Lifecycle

## Timing model

NelTempo uses group phases (Initiative → Vanguard → Enemy → Rearguard → next round).

**Phase activation is the start-of-turn boundary.**

When Vanguard, Enemy, or Rearguard begins:

1. Eligible combatants in that phase are snapshotted once.
2. Each combatant’s PF2e start-of-turn lifecycle runs once (native adapter).
3. Raise a Shield / Parry managed by NelTempo expire for that combatant at this boundary.
4. Combatants may then act in any order within the phase.

**End Turn is the individual end-of-turn boundary.**

A combatant’s PF2e end-of-turn (persistent damage, recovery checks, frightened reduction, end-duration effects, etc.) runs when:

- that player presses **End Turn**, or
- the GM presses **End Turn** for that combatant, or
- the GM chooses **Process and End Remaining Turns** before advancing.

Changing phases does **not** silently process end-of-turn effects unless the GM explicitly selects Process Remaining or Advance Without Processing.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| Turn Lifecycle Automation | Native PF2e Processing | Off / Reminders Only / Native |
| Phase Lifecycle Summary | GM Only | Off / GM Only / Everyone (visibility-respecting) |
| Guard Incomplete Phase | true | Show advance dialog when turns are incomplete |
| Allow GM Advance Without Processing | true | Show emergency skip option (never default-focused) |
| Manage Raise a Shield / Parry | true | Expire at that creature’s next start-of-turn |

## Phase-advance guard

If any eligible combatant has not completed end-of-turn:

1. **Return to Phase** — no mutations
2. **Process and End Remaining Turns** — sequential native ends for incomplete only
3. **Advance Without Processing** — mark Skipped; do not process later automatically

## State & authority

Durable per-combatant start/end boundary status lives under combat flags (`lifecycle.turns`). Only the elected primary GM mutates actors / claims boundaries. Player End Turn is a request. Socket deduplication and reload interrupt (`processing` → `interrupted` / Review) follow existing NelTempo patterns.

## Public hooks (presentation only)

- `neltempo.phaseLifecycleStarted`
- `neltempo.combatantTurnStarted`
- `neltempo.combatantTurnReady`
- `neltempo.combatantTurnEnding`
- `neltempo.combatantTurnEnded`
- `neltempo.lifecycleReview`

Payloads include combat/round/phase/combatant ids and sanitized actor/token ids when the viewer is authorized. No HP values, private rolls, or socket envelopes.

## Migration from 0.3.4

Active combats keep round/phase. Lifecycle flags are initialized without retroactive Fast Healing, persistent damage, or action refresh. Mid-round upgrades set a GM migration notice.

## Known adapter limitations

- Relies on PF2e `CombatantPF2e.onStartTurn` / `onEndTurn` (capability-detected).
- Does not flip visible `combat.turn` through the roster to trigger system behavior.
- Optional abilities are never auto-activated; Hero Points are never auto-spent.
- If a native call fails mid-mutation, that combatant is marked Review; siblings continue.
- Reopen Turn is blocked after a completed native end boundary (effects are not reversible through NelTempo).
