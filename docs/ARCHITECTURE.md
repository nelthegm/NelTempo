# Dynamic Initiative Architecture

## Purpose

Dynamic Initiative stores encounter flow state on the Foundry **Combat** document and drives a portrait dock UI. It does not replace PF2e combat resolution; it orchestrates phase order and free-order activation.

## Module identity

| Field | Value |
| --- | --- |
| Module ID | `nel-dynamic-initiative` |
| State flag | `flags.nel-dynamic-initiative.state` |
| Socket | `module.nel-dynamic-initiative` |

## State ownership

All Dynamic Initiative encounter state lives under a single combat flag:

```
combat.flags["nel-dynamic-initiative"].state
```

The module never replaces:

- the entire `flags` object
- another module’s flag namespace
- PF2e combat flags
- unrelated combat fields (except intentional `round` / `turn` updates for native turn sync)

Actor-side memory is limited to optional `flags.nel-dynamic-initiative.lastInitiativeSkill` for skill suggestions.

## State shape

```js
{
  schema: 3,                 // document schema version
  revision: 0,               // increments on successful state writes only
  enabled: true,
  phase: "initiative" | "vanguard" | "enemy" | "rearguard",
  round: 1,
  enemyDC: 10,
  suggestedSkill: "perception" | "last-used" | skillSlug,
  promptId: string | null,
  promptOpen: boolean,
  initialInitiativePending: boolean,
  enemyPhaseSerial: number,
  activeCombatantId: combatantId | null,
  results: { [combatantId]: InitiativeResult },
  acted: { [combatantId]: true },
  delayed: { [combatantId]: true },
  lastSkills: { [combatantId]: skillSlug },
  shields: { [itemUuid]: ShieldEntry },
  lifecycle: PhaseLifecycle | null,  // Vanguard/Enemy/Rearguard only
  history: [{ label, at, state }]  // undo stack; nested states have empty history
}
```

See `docs/SLICE_0_2_0_PHASE_LIFECYCLE.md` for the full lifecycle model, PF2e adapter pathway, and Undo limitations.

Combatant identity is always the Foundry **combatant document id**, never display names.

### InitiativeResult

```js
{
  total: number | null,
  skill: string | null,
  label: string | null,
  phase: "vanguard" | "rearguard",
  round: number,
  at: number,
  forced?: true   // e.g. unconscious auto-rearguard
}
```

## State normalization

`normalizeState(state, { combatantIds, includeHistory })` in `scripts/state.js`:

1. Clones input (does not mutate callers).
2. Builds a new plain object with supported fields only.
3. Drops non-serializable values (functions, class instances, `undefined`, non-finite numbers).
4. When `combatantIds` is provided, removes combatant-keyed entries not in that set from `results`, `acted`, `delayed`, and `lastSkills`.
5. Clears `activeCombatantId` if that combatant is gone.
6. Prunes shield entries tied to missing combatants.
7. Optionally normalizes undo history snapshots the same way.
8. Rejects unsupported top-level junk by omission.

Normalization does **not** invent initiative results for newly added combatants.

## Complete replacement strategy

Foundry document updates deep-merge objects. Prior versions used legacy `"-=key": null` paths to delete stale combatant map keys, which emits V14 compatibility warnings.

v0.1.5 replaces the **entire** module state object atomically:

```js
{
  "flags.nel-dynamic-initiative.state": _replace(completeNormalizedState)
}
```

`_replace` is Foundry V14’s force-replacement operator (`foundry.data.operators.ForcedReplacement` / global `_replace`). Stale combatant keys are omitted from the normalized object and therefore disappear without per-key deletion syntax.

## safeCombatUpdate

`safeCombatUpdate(combat, changes, options)` in `scripts/utils.js`:

- Requires a combat document.
- Calls `combat.update` with `render: false` and an internal option flag.
- Returns a structured result: `{ ok, combatId, revision, reason, error, document? }`.
- Logs one concise diagnostic on failure (short combat id + reason).
- Preserves the existing Monk’s Combat Details tracker-hook guard so an external post-render throw does not abort an already-written database update.

## saveState

`saveState(combat, state, { reason })`:

1. Runs inside `runCombatMutation(combat.id, …)`.
2. Re-resolves the live combat document.
3. Verifies the user is a GM.
4. Normalizes against current combatant ids.
5. Sets `revision = previousRevision + 1` (failed writes do not increment).
6. Builds a complete module-namespace replacement update.
7. Persists via `safeCombatUpdate`.
8. Emits debug events when logging is enabled.
9. Returns `{ ok, combatId, revision, reason, error }`.

Render hooks never call `saveState`.

## Mutation serialization

`runCombatMutation(combatId, task)`:

- Chains tasks per combat id so rapid UI clicks cannot overlap writes.
- Is re-entrant for the same combat (nested `saveState` inside a GM request runs inline — no deadlock).
- Different combat ids use independent queues.

GM request handling (`handleGMRequest`) also enters this queue so each request re-reads combat state after the previous request finishes.

## Revision behavior

| Event | Revision |
| --- | --- |
| Successful state mutation | +1 |
| Render / dock refresh | unchanged |
| Failed write | unchanged |
| Undo | restores gameplay fields, then +1 as a new write |

Missing `revision` on legacy worlds is treated as `0`. Revision does not affect initiative math.

## Phase changes

`changePhase` in `controller.js`:

1. No-ops when target equals current phase (duplicate Next Phase clicks are safe once serialized).
2. May expire managed Raise a Shield effects when leaving Enemy.
3. Rearguard → Initiative uses `beginRoundTransition` (clears round maps, increments round).
4. Other transitions use `setPhase`.
5. Persists via complete state replacement.
6. Posts a public phase chat message.

Phase order is fixed: Initiative → Vanguard → Enemy → Rearguard → Initiative.

## Undo

1. Pop the latest history entry.
2. `normalizeUndoRestore` against **current** combatant ids.
3. Persist with a new revision.
4. Sync combat `round` and optional native turn.
5. On failure, leave current state intact and notify the GM.

Deleted combatants are not restored into the encounter.

## Combatant cleanup

Stale combatant keys are removed by normalization + complete replacement whenever state is saved. Lifecycle cases:

| Case | Behavior |
| --- | --- |
| Combatant removed | Next save drops their result/acted/delayed/skill keys |
| Combatant added | No invented result; they appear awaiting roll/actions |
| Token/actor deleted while combatant remains | Side/portrait helpers degrade safely; state still keys by combatant id |
| Combat ends mid-queue | Cleanup attempts a final save; delete proceeds even if save fails |

## Socket / GM authority

- Players emit request payloads on the module socket.
- Only the **primary active GM** executes `handleGMRequest`.
- Request shape remains `{ type, userId, sentAt, combatId, ... }`.
- Ownership checks use actor ownership for PC actions; GM-only for phase/DC/undo/end.

## Reload behavior

State is on the Combat document. After refresh:

- Dock re-renders from `getFlag`.
- Phase, round, results, and acted maps resume.
- Open prompt modals are reconstructed only when the GM re-prompts or auto-open logic runs for an active prompt.

## File map

| File | Role |
| --- | --- |
| `scripts/main.js` | Settings, hooks, public API |
| `scripts/controller.js` | GM request dispatch, phase/undo/combat lifecycle |
| `scripts/state.js` | Pure state machine + normalization |
| `scripts/utils.js` | Persistence, combat helpers, diagnostics |
| `scripts/ui.js` | Portrait dock and prompts |
| `scripts/initiative.js` | PF2e skill rolls |
| `scripts/shields.js` | Raise a Shield tracking |
| `scripts/constants.js` | Module id, settings keys, request types |
