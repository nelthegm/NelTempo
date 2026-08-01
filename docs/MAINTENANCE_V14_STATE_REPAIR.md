# Maintenance: V14 Combat State Repair

**Release:** 0.1.4 → 0.1.5  
**Scope:** Compatibility maintenance only. No new gameplay features.

## Original problem

During phase changes, Dynamic Initiative emitted repeated Foundry V14 warnings:

> You are specifying a forced deletion or replacement key '-=&lt;combatantId&gt;' using legacy syntax.

Observed stack:

1. `safeCombatUpdate` — `utils.js`
2. `saveState` — `utils.js`
3. `changePhase` — `controller.js`
4. `handleGMRequest` — `controller.js`
5. UI phase-change handler — `ui.js`

## Legacy deletion call sites (baseline 0.1.4)

| Location | Pattern | Purpose |
| --- | --- | --- |
| `scripts/utils.js` → `buildStateUpdate` | `` `${path}.-=${key}`: null `` | Differential delete of nested keys when next state omitted them |
| `scripts/utils.js` → `saveState` | Called `buildStateUpdate` for every persist | Phase change, round clear, undo, rolls, etc. |
| `tests/state-machine.test.mjs` | Asserted `results.-=pc1` style keys | Locked in the legacy approach |

No other production files generated `-=` keys. Callers of `saveState` were indirect producers:

- `controller.js`: start, prompt, submit roll, set DC/skill, change phase, claim, end turn, delay, mark acted, undo, end combat
- `shields.js`: register / clear managed Raise a Shield tracking

## Why differential `-=` existed

Foundry deep-merges object updates. Assigning:

```js
{ results: {} }
```

does **not** remove prior combatant keys under `results`. v0.1.3 introduced `-=` deletion to clear round maps. That fixed gameplay but is legacy in V14.

## Chosen V14 strategy: complete state replacement

Prefer:

```js
{
  "flags.nel-dynamic-initiative.state": _replace(completeNextState)
}
```

### Why this over per-key ForcedDeletion

1. Matches the preferred architecture: one normalized next-state object.
2. Stale combatant keys are omitted, then the whole module state flag is force-replaced.
3. No legacy `"-=key"` paths remain.
4. Does not replace other modules’ flags or the entire `flags` object.
5. Avoids mixing old deletion syntax with new operators.
6. Foundry V14 documents global `_replace(data)` / `ForcedReplacement` for full nested replacement (and `_del` / `ForcedDeletion` for single keys). Complete replacement needs fewer operators and avoids nested `_del` inside `_replace` edge cases.

### Fallback

`applyForceReplace` uses:

1. `globalThis._replace(value)` when present
2. `foundry.data.operators._replace` / `ForcedReplacement` when present
3. Plain value assignment for unit tests / non-Foundry environments

## Migration behavior

- Existing worlds with `schema: 2` continue to load.
- Missing `revision` is treated as `0`; the next successful save writes `revision: 1`.
- No world migration script is required.
- No combatant identity migration (ids unchanged).
- No flag path rename.

## Implementation summary

| Area | Change |
| --- | --- |
| Normalization | `normalizeState` prunes stale combatant keys, strips non-serializable data |
| Persistence | `buildCompleteStateUpdate` + `saveState` atomic replace |
| Concurrency | `runCombatMutation` serializes per-combat writes; re-entrant |
| Revision | Increment on successful save only |
| Undo | `normalizeUndoRestore` against live combatants |
| Debug | Client setting **Dynamic Initiative Debug Logging** (default false) |
| Tests | Assert no `-=` remains; complete replace path; prune/preserve behavior |

## Regression risk

| Risk | Mitigation |
| --- | --- |
| `_replace` unavailable on unexpected core builds | Fallback still writes full object; may deep-merge on ancient cores — V14 is the supported target |
| Double phase click | Request + write queue; changePhase no-ops if already on target |
| Undo restores deleted combatants | Normalize restore against current combatant ids |
| Lost concurrent writes | Per-combat mutation queue with re-read of live state at request start |
| Third-party tracker hooks | Existing render:false + Monk’s guard preserved |

## Known limitations

- Not runtime-tested inside this maintenance automation pass against a live Foundry V14 client.
- Does not implement phase-lifecycle automation or other deferred gameplay slices.
- External module console errors are intentionally not patched.
- If a host Foundry build lacked `_replace` entirely, nested map clearing would depend on merge behavior; supported target is V14 where `_replace` is documented as global.

## Verification checklist (maintenance)

- [x] No runtime `"-=` deletion key generation
- [x] module id unchanged (`nel-dynamic-initiative`)
- [x] Patch version bump only (0.1.4 → 0.1.5)
- [x] Static + mocked tests
- [ ] Live Foundry V14 combat playtest (see `docs/TEST_PLAN.md`)
