# Slice 0.2.1 Test Plan — Condition Timing

Verification for NelTempo 0.2.1 (module id `nel-dynamic-initiative`). Automated checks use mocked/static environments; runtime items require Foundry V14 + PF2e 8.3.0 and must be executed manually — do not mark passed without live execution.

## Automated (mocked / static)

Run:

```bash
npm test
```

Primary file: `tests/timing.test.mjs` (plus existing 0.1.5 / 0.2.0 suites).

### AE — acceptance criteria (automated)

| # | Criterion | Covered by |
| --- | --- | --- |
| AE-1 | `module.json` title NelTempo, id `nel-dynamic-initiative`, version 0.2.1 | `timing.test.mjs` branding |
| AE-2 | Socket and flag namespaces unchanged | `timing.test.mjs`, `persistence.test.mjs` |
| AE-3 | `SETTINGS.ENFORCE_CONDITION_TIMING` registered key | `timing.test.mjs` |
| AE-4 | Localization title and timing keys present | `timing.test.mjs` locale loop |
| AE-5 | Adapter detects `grabbed` via `hasCondition` | mocked actor |
| AE-6 | Adapter detects `restrained` | mocked actor |
| AE-7 | Adapter detects `confused` | mocked actor |
| AE-8 | Does not match actor name or non-condition item names | `noParse` test |
| AE-9 | Unsupported / missing API fails open (`ok: false`, flags false) | fail-open test |
| AE-10 | `toSerializableResult` has no name fields | serial test |
| AE-11 | `isTrackedConditionItem` true only for condition type + tracked slug | item tests |
| AE-12 | `detectConditionSlug` structured path | slug detect test |
| AE-13 | Combined flags: Confused > Restrained > Grabbed block reason | priority tests |
| AE-14 | Timing created with lifecycle; matches `phaseInstanceId` | lifecycle attach |
| AE-15 | Per-combatant delay flags set from conditions | upsert tests |
| AE-16 | Confused priority gate active with correct first actor | gate tests |
| AE-17 | Grabbed blocks Delay (`delay-blocked-grabbed`) | eligibility |
| AE-18 | Restrained blocks Delay | eligibility |
| AE-19 | Confused blocks Delay | eligibility |
| AE-20 | Condition removal restores Delay | upsert + eligibility |
| AE-21 | Mid-phase Grabbed add blocks Delay | upsert |
| AE-22 | Post–End Turn condition add does not reopen priority | `ended: true` upsert |
| AE-23 | Multiple Confused: roster order determines priority | `confusedB` / `confusedA` |
| AE-24 | Priority order deterministic across repeated builds | deepEqual repeat |
| AE-25 | First Confused may End Turn; second may not | end eligibility |
| AE-26 | Non-Confused blocked while gate active | `waiting-for-confused` |
| AE-27 | End first Confused advances gate to second | `onTurnEndedTiming` |
| AE-28 | Duplicate End Turn does not double-advance | markTurnEnded idempotency |
| AE-29 | Resolve all Confused clears gate | gate inactive |
| AE-30 | Confused removal mid-phase deactivates gate | upsert + recompute |
| AE-31 | Confused add mid-phase inserts into gate | `n1` test |
| AE-32 | Confused add after End Turn excluded from gate | `c1` ended test |
| AE-33 | Timing changes do not alter `phaseInstanceId` | instance stability |
| AE-34 | Player reopen Confused turn rejected | `confused-reopen-rejected` |
| AE-35 | GM reopen requires override flag | `requiresOverride` |
| AE-36 | GM reopen restores gate when still Confused | `onTurnReopenedTiming` |
| AE-37 | Allow Delay Once permits then consumes override | grant + consume |
| AE-38 | Consumed override cannot be reused | second consume fails |
| AE-39 | Unconsumed override survives normalize | normalizeLifecycle |
| AE-40 | Clear override removes grant | clearTimingOverride |
| AE-41 | Resume Current Once permits End Turn through gate | grant + eligibility |
| AE-42 | Lifecycle not Open blocks Delay and End Turn | starting/ending tests |
| AE-43 | `enforce: false` bypasses all timing checks | enforce-off tests |
| AE-44 | normalizeTiming prunes stale combatants | prune test |
| AE-45 | Wrong `phaseInstanceId` resets timing combatants | reset test |
| AE-46 | Timing persists through `normalizeState` serializable | JSON round-trip |
| AE-47 | Delay state path unchanged when allowed | `delayToRearguard` |
| AE-48 | Badges: must-act-first, waiting-confused, delay-blocked | `timingBadgeFor` |
| AE-49 | Audit entries omit actor names | audit sanitize |
| AE-50 | Timing request constants defined | REQUESTS assertions |
| AE-51 | Adapter source excludes description parsing | source regex test |
| AE-52 | Timing module does not monkey-patch prototypes | source check |
| AE-53 | 0.2.0 lifecycle tests still pass | `lifecycle.test.mjs` |
| AE-54 | 0.1.5 persistence tests still pass | `persistence.test.mjs` |
| AE-55 | Package validates; ZIP root `module.json` when packed | `package-validate.test.mjs` |

## Runtime (Foundry V14 + PF2e 8.3.0)

Perform in a copied world. Enable **Enforce Condition Timing** (default on). Complete base 0.2.0 checklist (`PLAYTEST_CHECKLIST.md`) first, then timing items below.

### AF — acceptance criteria (runtime, summarized 1–70)

**Setup and branding (AF 1–5)**

1. Module appears as **NelTempo** in Manage Modules; id remains `nel-dynamic-initiative`.
2. Portrait dock and 0.2.0 lifecycle controls work unchanged.
3. World setting **Enforce Condition Timing** visible; default On.
4. Toggle setting Off — Delay and End Turn unrestricted; toggle back On.
5. Debug logging shows timing events without actor names.

**Grabbed delay block (AF 6–12)**

6. Apply Grabbed to Vanguard PC (PF2e condition item); badge shows delay blocked.
7. **Delay to Rearguard** rejected with Grabbed message.
8. Remove Grabbed; Delay succeeds.
9. Apply Grabbed mid-phase after another PC acted; Delay blocked.
10. Grabbed PC End Turn still works.
11. Grabbed at phase open persists through reload while Open.
12. Grabbed on ended combatant does not reopen turn requirements.

**Restrained delay block (AF 13–18)**

13. Apply Restrained; Delay blocked with Restrained message.
14. Both Grabbed and Restrained — Restrained shown as primary block (no Confused).
15. GM **Allow Delay Once** — confirm if prompted — Delay succeeds once.
16. Second Delay attempt blocked after override consumed.
17. GM **Move to Rearguard** bypasses Restrained block.
18. Restrained removed mid-phase restores Delay.

**Confused priority (AF 19–32)**

19. Single Confused Vanguard PC — **Must Act First** badge.
20. Confused PC can End Turn; gate clears.
21. Two Confused PCs — first in roster order must act first.
22. Second Confused cannot End Turn until first ends.
23. Non-Confused PC cannot End Turn while gate active.
24. After first Confused ends, second becomes priority.
25. After both end, non-Confused may End Turn.
26. Apply Confused mid-phase — inserted into gate.
27. Remove Confused mid-phase — gate updates / clears.
28. Confused applied after End Turn — not added to gate.
29. Confused in Enemy phase (if in roster) — same gate rules.
30. Confused + Grabbed — Confused block reason for Delay; gate still applies.
31. Reload during active gate — order preserved after reconcile.
32. Phase advance clears timing instance; new phase fresh timing.

**Reopen (AF 33–37)**

33. Player completes Confused turn — Reopen Turn rejected.
34. GM **Reopen Confused Turn** (confirm) succeeds.
35. Gate reactivates if actor still Confused.
36. Non-Confused turn Reopen unchanged from 0.2.0.
37. GM reopen does not reverse PF2e actions or conditions.

**GM overrides (AF 38–48)**

38. **Resolve Priority** (confirm) — marks resolved without End Turn; gate advances.
39. **Skip Priority** (confirm) — combatant exempt from gate; turn still open.
40. **Resume Current Once** — non-priority PC may End Turn once.
41. Override consumed after Resume End Turn.
42. **Clear Override** removes pending grant.
43. Allow Delay Once on Confused requires confirm dialog.
44. Override menu only visible to GM on portrait/context controls.
45. Non-primary GM cannot persist overrides (observe only).
46. Undo after override restores module state snapshot.
47. Adapter warning shown if condition API fails (simulate by disconnecting system test world if possible).
48. Fail-open: encounter remains playable when conditions unreadable.

**Integration (AF 49–60)**

49. Timing does not duplicate lifecycle start processing.
50. Timing does not duplicate lifecycle end / persistent damage.
51. End Turn blocked message for waiting-on-Confused is clear.
52. Delay blocked audit visible in debug log (no PII).
53. Condition item create/update on roster actor triggers reconcile.
54. Combatant removed mid-phase pruned from timing.
55. Combatant added mid-phase not in timing until next open phase.
56. Multi-player: player sees badges; blocked actions notify locally.
57. Two-browser test: state syncs after GM override.
58. Raise a Shield / reactions unaffected by timing gates.
59. Delay to Rearguard assignment still places PC in Rearguard phase.
60. Force Advance / End Remaining unaffected by timing blocks.

**Regression (AF 61–70)**

61. Full round Initiative → Vanguard → Enemy → Rearguard with no conditions — unchanged.
62. Three full rounds with mixed timing scenarios — no duplicate persistent damage.
63. Undo across phase boundary — timing warning still shown.
64. Combat end clears dock and timing state.
65. New combat fresh timing.
66. Packaged module 0.2.1 installs on Forge path unchanged.
67. No `-=` deletion warnings in console.
68. No NelTempo exceptions during 30-minute session.
69. PF2e conditions never removed by NelTempo timing actions.
70. Document any adapter fail-open cases with PF2e version and console excerpt.

## Flag inspection helper (GM console)

```js
const c = game.combat;
const s = c?.getFlag("nel-dynamic-initiative", "state");
const t = s?.lifecycle?.timing;
console.log({
  phase: s?.phase,
  lifecycleStatus: s?.lifecycle?.status,
  phaseInstanceId: s?.lifecycle?.phaseInstanceId,
  timingRevision: t?.revision,
  gateActive: t?.priorityGate?.active,
  unresolved: t?.priorityGate?.unresolvedCombatantIds,
  combatantTiming: t?.combatants,
});
```

## Acceptance map

| Layer | Criteria | Pass threshold |
| --- | --- | --- |
| Automated AE-1–AE-55 | Mocked/static | `npm test` exit 0 |
| Runtime AF-1–AF-70 | Live Foundry | Manual checklist; report failures with versions |

Automated tests do **not** constitute Foundry runtime acceptance.

## Related

- `docs/TEST_PLAN.md` — project-wide test index
- `docs/SLICE_0_2_1_CONDITION_TIMING.md` — design reference
- `PLAYTEST_CHECKLIST.md` — first-session 0.2.0 + 0.2.1 timing section
