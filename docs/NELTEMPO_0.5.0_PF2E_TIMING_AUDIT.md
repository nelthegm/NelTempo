# NelTempo 0.5.0 — PF2e 8.4.0 Turn-Timing Audit

## Scope and evidence

This audit preceded the compatibility repair. The locally installed PF2e copy was 6.2.0, so it was not accepted as evidence for the 8.4 target. The authoritative system source was the official `foundryvtt/pf2e` tag `pf2e-8.4.0`, commit `90132e99cb2c7617e4f0131b6010c6ee6f8ec5b1`. Foundry 14.365's installed `resources/app/client/data/documents/combat.js` was inspected for the native turn-event order.

PF2e source areas inspected:

- `src/module/encounter/combatant.ts`
- `src/module/encounter/document.ts`
- `src/module/item/abstract-effect/data.ts`
- `src/module/item/abstract-effect/helpers.ts`
- `src/module/item/effect/data.ts`
- `src/module/item/effect/document.ts`
- `src/module/system/effect-tracker.ts`
- `packs/pf2e/conditions/grabbed.json`
- `packs/pf2e/conditions/restrained.json`
- native Grapple action macro and structured action data

NelTempo areas inspected:

- `scripts/pf2e-lifecycle-adapter.js`
- `scripts/controller.js`
- `scripts/lifecycle.js`
- `scripts/utils.js`
- `scripts/pf2e-condition-adapter.js`
- `scripts/timing-service.js`

Chat text, descriptions, names, HTML, proximity, and message order were never treated as mechanical evidence.

## Native boundary findings

`CombatantPF2e.onStartTurn()` records `roundOfLastTurn`, performs PF2e actor turn-start updates and round recharge, sends `turn-start` encounter events to Effects, and emits `pf2e.startTurn`. `CombatantPF2e.onEndTurn({round})` processes active Conditions for living actors, sends `turn-end` encounter events to Effects, records `roundOfLastTurnEnd`, and emits `pf2e.endTurn`.

NelTempo 0.4.0 invokes those methods directly at its canonical actual Start and End. The methods receive the exact Combatant, Actor, token collection, encounter, and round they require. The existing lifecycle guards prevent duplicate invocation across Delay, Rearguard resume, reload, administrative completion, and conservative retry.

Foundry's normal sequential tracker updates the Combat document first and then runs End Turn, round events, and Start Turn. PF2e's Encounter `_onUpdate` also refreshes its Effect Tracker. NelTempo intentionally suppresses those Foundry turn events and clears `combat.turn` between actual activations.

## Effect-duration findings

PF2e Effect items can contain structured context and timing:

- `system.context.origin.actor`, token, item, spellcasting, and roll options;
- `system.context.target.actor` and token;
- `system.duration.value`, `unit`, `expiry`, and `sustained`;
- `system.start.value` world time and `system.start.initiative`.

Finite Effect expiry accepts `turn-start`, `turn-end`, and `round-end`. `calculateRemainingDuration()` uses `game.time.worldTime`, `game.combat.combatant`, current initiative, start initiative, and the Effect origin/owner. The Effect Tracker removes expired native Effect documents when PF2e automation permits and the client is the Actor's primary updater.

This means direct `onStartTurn`/`onEndTurn` delegation is sufficient for actor mechanics but not sufficient to preserve a uniquely source-linked finite Effect across NelTempo phase/round updates: the normal sequential `combat.turn` context is absent. With no current Combatant, a zero-remaining Effect can be considered expired during unrelated progress. Initiative ordering also cannot represent NelTempo's free activation order reliably.

## Grapple, Grabbed, Restrained, monster Grab, and Escape

PF2e's standard Grabbed and Restrained Condition items are unlimited and contain no unique structured origin relationship. The standard Grapple macro rolls and presents outcomes but does not establish a uniquely sourced finite Effect. Monster Grab timing is described in action data/prose rather than a uniform structured origin record. Therefore no safe source owner can be derived for those standard mechanics.

NelTempo's existing Delay restriction reads live PF2e Condition slugs (`grabbed`, `restrained`) without caching. When PF2e Escape removes a Condition, the next eligibility read sees it as absent; NelTempo does not roll Escape, parse its chat result, or remove the Condition.

## Classification

### PF2E NATIVE PASS — no repair

| Case | Evidence and outcome |
| --- | --- |
| Action/reaction refresh, MAP reset, Fast Healing, regeneration, Effect encounter events | Native `CombatantPF2e.onStartTurn()` is invoked once at NelTempo's actual Start. |
| Persistent damage, recovery, frightened/Condition End processing | Native `CombatantPF2e.onEndTurn({round})` is invoked once at actual End. |
| Delay and Rearguard resume | Existing actual-turn snapshot retains completed Start and pending End; no native replay. |
| Reactions | No NelTempo request or lifecycle reducer observes ordinary PF2e reaction activity. |
| Ready/readied activation | Ready occurs inside the real turn; the later reaction has no NelTempo lifecycle entry point. |
| Grabbed/Restrained Delay restriction | Live structured Condition slug reads; no cached relationship required. |
| Escape | PF2e owns resolution/removal; live slug reads immediately reflect the native document state. |
| Round-end finite Effects | PF2e 8.4.0 has no system-specific round lifecycle override; round/world-time Effect tracking remains native. NelTempo already updates the encounter round exactly once. |
| Administrative moves/Complete/Skipped/Review/Reopen | Existing reducers do not invoke the native adapter. |

### NELTEMPO COMPATIBILITY GAP — repair justified

| Case | Proven mismatch | Repair |
| --- | --- | --- |
| Finite `effect` with unique structured origin and `turn-start`/`turn-end` expiry | PF2e duration evaluation requires sequential current-Combatant/initiative context that NelTempo intentionally does not maintain; unrelated phase/round updates can expose zero-remaining Effects early. | Protect only the proven native Effect document, retain its original duration, and schedule one reconciliation against the same NelTempo source Start/End identity. |
| Escape/native removal of a managed finite Effect | A durable compatibility record could otherwise become stale. | Observe native Item deletion and prune only NelTempo metadata; never adjudicate Escape. |
| Reload or uncertain mutation | A Processing record cannot prove whether native deletion completed. | Convert it to Review and do not replay. |
| Combatant removal/defeat/combat end | The future source boundary may no longer be provable. | Restore the original native duration where the Effect is still protected; prune or Review metadata without deleting the Actor Effect. |

The repair is not a replacement condition engine. It recognizes only PF2e `effect` documents with exact structured origin, owner/target, a finite nonnegative integer number of rounds, and turn expiry, and only when one source and one target Combatant are uniquely provable during the source's open actual turn. It stores document identity and exactly-once boundary state, not formulas, descriptions, rolls, or condition rules.

### UNPROVEN / DEFERRED — no automation

| Case | Why unproven |
| --- | --- |
| Standard Grapple/Grabbed/Restrained | Unlimited Condition data does not encode a unique source. |
| Standard monster Grab | No uniform structured finite source relationship was proven. |
| Target-start/target-end anchor independent of origin | PF2e context can identify a target, but PF2e 8.4.0 does not encode a separate target-bound expiry anchor. The generic schema reserves the vocabulary; automatic detection never creates these relationships. |
| Multiple Combatants representing one Actor | Source/target is ambiguous; remain native and show Review only. |
| Missing/migrated origin context | No safe relationship; remain native. |
| “Source defeated means condition ends” | No generic structured PF2e rule proves this; the Actor Effect is preserved. |
| Foundry Region turn/round events | Not shown to be required by PF2e 8.4 mechanics audited here; no fake turns or extra round calls are added. |

## Compatibility record and authority

The schema-9 record contains combat/generation, exact source and target Combatant IDs, native Effect document identity, original duration, required source boundary, due round, status, and processed boundary identity. Automatic relationships are limited to `source-start` and `source-end`.

Qualifying Effects are temporarily protected from context-free world-time removal. At the matching legitimate boundary, NelTempo removes that exact native Effect document once; it does not reproduce the Effect's rule elements or Condition behavior. Ambiguity fails open/native. All detection, protection, reconciliation, and expiry mutation uses the existing primary-GM authority and serialized Combat mutation queue.

## Conclusion

PF2e remains authoritative for what Start/End mechanics do. NelTempo owns only the real-turn boundary and the minimal compatibility bookkeeping required when PF2e's sequential tracker context cannot express that boundary. Reactions and readied actions never become NelTempo turns.
