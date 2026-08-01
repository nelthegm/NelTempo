# Slice 0.2.1 — Condition Timing (Grabbed / Restrained / Confused)

## Branding

| Field | Value |
| --- | --- |
| Display name | **NelTempo** (formerly Dynamic Initiative) |
| Module ID | `nel-dynamic-initiative` (unchanged) |
| Socket | `module.nel-dynamic-initiative` |
| State flag | `flags.nel-dynamic-initiative.state` |
| Version | 0.2.1 |

Install paths, ZIP name (`dynamic-initiative.zip`), and flag namespaces are unchanged from prior releases. Only user-facing title and documentation use the NelTempo name.

## Goals

1. **Grabbed / Restrained delay block** — Voluntary **Delay to Rearguard** is rejected while a Vanguard combatant has Grabbed or Restrained (structured PF2e condition slugs).
2. **Confused priority gate** — Confused combatants in the open phase roster must resolve (End Turn) before non-Confused combatants may End Turn. Multiple Confused combatants resolve in deterministic roster order.
3. **GM overrides** — Explicit, auditable GM controls to bypass or resolve timing restrictions without removing PF2e conditions or replaying lifecycle boundaries.

Timing rules apply only while lifecycle status is **Open** and only when **Enforce Condition Timing** is enabled (default on).

## PF2e 8.3.0 APIs inspected

Sources reviewed at PF2e **8.3.0** (`github.com/foundryvtt/pf2e`):

| API | Role |
| --- | --- |
| `ActorPF2e.hasCondition(...slugs)` | Delegates to `this.conditions.hasType(s)` |
| `ActorPF2e.getCondition(slug)` | Filters conditions by key/slug; prefers active |
| `ActorConditions.hasType(slug)` | Structured type check on embedded condition items |
| `ActorPF2e.itemTypes.condition` | Iterable condition Item documents |

Tracked slugs (structured only): `grabbed`, `restrained`, `confused`.

Conditions in PF2e 8.x are embedded Item documents of type `"condition"`. NelTempo never reads condition names, descriptions, HTML, or chat text.

## Condition adapter

Implementation: `scripts/pf2e-condition-adapter.js`.

Detection preference order:

1. `actor.hasCondition(slug)`
2. `actor.conditions.hasType(slug)`
3. `actor.getCondition(slug)` with active check
4. `itemTypes.condition` slug match (structured fields only)

**Fail-open:** When the system is unsupported, the actor is missing, no condition API exists, or an API throws without confirming any tracked condition, the adapter returns `ok: false` with all condition flags `false`. NelTempo does not invent restrictions from failed reads.

**No description parsing:** The adapter does not inspect `description`, `innerHTML`, `textContent`, or display names. Unit tests assert this invariant on source.

**Item hook:** `isTrackedConditionItem(item)` returns true only for `type === "condition"` with a tracked slug — used to trigger live reconciliation when condition items change on roster actors.

## Timing state model

Timing lives under `lifecycle.timing` (schema 3, normalized with lifecycle). It is scoped to the current `phaseInstanceId`; mismatched instances are reset on normalize.

```js
lifecycle.timing = {
  phaseInstanceId,
  revision,
  priorityGate: {
    active: boolean,
    condition: "confused",
    unresolvedCombatantIds: [combatantId, ...],
    completedCombatantIds: [combatantId, ...],
  },
  combatants: {
    [combatantId]: {
      grabbed, restrained, confused,
      delayBlocked, delayBlockReason,  // null | "confused" | "restrained" | "grabbed"
      priorityRequired, priorityResolved,
      detectedAt, lastCheckedAt,
      gmOverride: {
        type, grantedBy, grantedAt, consumed, consumedAt
      } | null
    }
  },
  audit: [{ event, at, combatantId?, phase?, ... }]  // capped at 40 entries
}
```

Pure serializable data only — no actor names, token names, or document references in persisted timing.

### Pure helpers vs Foundry service

| Module | Role |
| --- | --- |
| `scripts/timing.js` | Pure eligibility, gate math, overrides, badges; unit-testable |
| `scripts/timing-service.js` | Live reconciliation via adapter; hooks into controller lifecycle |

## Delay restrictions

Voluntary **Delay to Rearguard** (Vanguard, lifecycle Open):

| Condition | Block reason | Player message key |
| --- | --- | --- |
| Grabbed | `delay-blocked-grabbed` | `NDI.Timing.CannotDelayGrabbed` |
| Restrained | `delay-blocked-restrained` | `NDI.Timing.CannotDelayRestrained` |
| Confused | `delay-blocked-confused` | `NDI.Timing.CannotDelayConfused` |

**Combined conditions:** Display and block reason use fixed priority — **Confused > Restrained > Grabbed**. All three block Delay when present.

**Mid-phase changes:** Conditions are re-read before Delay decisions and on roster actor item updates. Adding Grabbed/Restrained/Confused mid-phase blocks future Delay. Removing a condition restores Delay eligibility.

**After End Turn:** Condition flags may update on an ended combatant, but they do not re-insert into the Confused priority gate or reopen timing requirements.

**GM Move to Rearguard:** GM-only path bypasses delay blocks (grants and immediately consumes `move-rearguard` override). Does not remove PF2e conditions.

## Confused priority gate

When one or more unresolved Confused combatants remain in the open roster:

1. Only the **first** unresolved Confused combatant (by order below) may End Turn among Confused actors.
2. Non-Confused combatants cannot End Turn while the gate is active (`waiting-for-confused`).
3. Other unresolved Confused combatants receive `waiting-for-priority-combatant`.

**Deterministic order:**

1. Existing lifecycle roster order (initiative total desc, then combatant id `localeCompare`)
2. Combatant id is the final tie-breaker (roster is already id-stable)

Gate recomputes on: phase open reconciliation, condition upsert, End Turn, Reopen, GM resolve/skip priority, combatant removal from roster.

**Mid-phase Confused add:** Inserts into gate if turn not ended. **Mid-phase Confused remove:** Removes from gate; may deactivate gate entirely.

**Resolve:** Successful End Turn on a Confused combatant marks `priorityResolved` and advances the gate. Gate clears when no unresolved Confused remain.

## Reopen rules

| Actor | Confused history | Result |
| --- | --- | --- |
| Player | Was Confused or completed Confused priority | Reopen rejected (`confused-reopen-rejected`) |
| GM | Same | Requires **Reopen Confused Turn** override (confirmed) |
| Any | Never Confused / no priority history | Normal Reopen Turn rules (0.2.0) |

GM reopen via override reactivates Confused priority if the combatant is still Confused (`onTurnReopenedTiming` clears `priorityResolved`).

Players cannot reopen a turn that participated in Confused priority resolution, even if Confused was later removed.

## GM overrides

All overrides require lifecycle **Open** and primary-GM persistence. Overrides are stored on `lifecycle.timing.combatants[id].gmOverride`.

| Control | Override type | Behavior |
| --- | --- | --- |
| **Allow Delay Once** | `allow-delay-once` | Permits one voluntary Delay despite block; consumed on successful Delay. Confirm dialog for Restrained/Confused. |
| **Move to Rearguard** | `move-rearguard` | GM moves combatant to Rearguard despite block; override granted and consumed in one transaction. |
| **Resolve Priority** | (marks `priorityResolved`) | GM marks Confused timing resolved without End Turn; does not remove Confused condition. Confirm required. |
| **Skip Priority** | `skip-priority` | Exempts combatant from gate for remainder of phase; unconsumed until phase ends. Confirm required. |
| **Reopen Confused Turn** | `reopen-confused` | GM reopen path for Confused-resolved turns; confirm required. |
| **Resume Current Once** | `resume-current-once` | Allows a non-priority combatant to End Turn once despite active gate; consumed on that End Turn. |
| **Clear Override** | — | Removes unconsumed override on combatant. |

Overrides do not modify PF2e Actor/Item documents, replay start/end boundaries, or reverse prior native PF2e effects.

## Lifecycle interaction

Timing enforcement is active **only while lifecycle status is Open**:

| Status | Delay / End Turn timing | Reconciliation |
| --- | --- | --- |
| `starting`, `ending`, `ended`, `interrupted`, `error` | Blocked (`lifecycle-not-open`) | No opportunistic gate rebuild |
| `open` | Full enforcement | Live condition read + gate rebuild |
| `complete` | End Turn timing N/A; badges may still reflect state | Gate may rebuild for UI |

**Phase open:** After start boundary succeeds, `reconcileTimingState` builds initial timing from live PF2e conditions.

**End Turn / Reopen:** `applyEndTurnTiming` / `applyReopenTiming` update gate bookkeeping without native PF2e replay.

**Phase end:** Timing state is tied to `phaseInstanceId`; new phase entry creates fresh timing.

### Reload

On world ready, primary GM runs lifecycle reconciliation then timing reconciliation for open/complete phases. Timing decisions are not reused across mismatched `phaseInstanceId`.

### Undo

Undo restores persisted timing snapshots in module state. Undo does not reverse PF2e condition changes or native start/end effects (same **Undo Phase State Only** warning as 0.2.0 when crossing completed phase-end boundaries).

### Multi-GM

Only `isPrimaryGM()` persists timing mutations, GM overrides, and reconciliation writes. Other GMs see synchronized state via combat flags.

### Privacy

Timing audit and debug diagnostics use shortened combat/combatant ids only. No actor names, condition descriptions, or secrets in persisted audit or debug logs.

### Failure / fail-open

| Failure | Behavior |
| --- | --- |
| Adapter cannot read conditions | No new restriction; prior persisted flags may remain; GM warned once per reconcile batch |
| Setting disabled | All timing blocks cleared; lifecycle and End Turn remain functional |
| API throw with no confirmed conditions | Fail open for that combatant |

## Setting: Enforce Condition Timing

| Field | Value |
| --- | --- |
| Key | `enforceConditionTiming` |
| Scope | World |
| Default | `true` |
| Migration | None — default applies on first read; no world-flag write on upgrade |

When **Off**, delay blocks and Confused priority are not enforced. Lifecycle, End Turn, Reopen, and phase boundaries behave as in 0.2.0.

## Deferred (post–0.2.1)

- GM phase roster editor / manual initiative reassignment
- Grapple duration and source-creature tracking
- Escape action automation
- Confused “must attack nearest” automation and random target selection
- Target selection UI for Confused
- Broader condition configuration (additional slugs, per-condition rules)
- Internal module ID migration (`nel-dynamic-initiative` → future id)
- Nelflow integration

## Known limitations

- Condition detection requires PF2e 6+ structured APIs; older or heavily customized systems fail open.
- NelTempo does not apply, remove, or roll Confused flat checks — only orchestrates turn order within the phase.
- Grabbed/Restrained block **voluntary Delay** only; they do not prevent GM **Move to Rearguard** or narrative repositioning outside NelTempo.
- **Skip Priority** leaves the Confused condition on the actor; the combatant may still act but is exempt from gate ordering.
- **Resolve Priority** does not run PF2e end-of-turn logic or remove Confused.
- Combined Grabbed + Restrained shows Restrained as primary block reason (Confused wins if also present).
- Adapter failures during a phase do not auto-clear previously persisted restriction flags until a successful re-read or GM reconcile.
- Runtime acceptance in Foundry V14 + PF2e 8.3.0 is documented in `docs/SLICE_0_2_1_TEST_PLAN.md`; automated tests do not substitute for live playtest.

## Related documentation

- `docs/SLICE_0_2_0_PHASE_LIFECYCLE.md` — lifecycle boundaries, End Turn, phase roster
- `docs/SLICE_0_2_1_TEST_PLAN.md` — automated and runtime verification
- `docs/ARCHITECTURE.md` — persistence and state ownership
