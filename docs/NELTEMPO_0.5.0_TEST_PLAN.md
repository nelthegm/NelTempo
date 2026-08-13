# NelTempo 0.5.0 RC1 — Manual Foundry Test Plan

Target: Foundry VTT 14.365, PF2e 8.4.x. Use native PF2e actions and inspect embedded Item structure rather than chat prose. Record whether an Item is a Condition or Effect and capture its structured context, duration, start, and expiry before classifying behavior.

## Test 1 — Ordinary turn Effect

Use a visible native finite Effect with structured Start/End timing. Exercise the source creature's actual lifecycle. Expected: a uniquely proven source-linked Effect changes/expires at the source's actual boundary, not merely from Vanguard/Enemy/Rearguard movement. Unproven or Condition data remains native.

## Test 2 — Delay

Apply a timed Effect, start a Vanguard turn, Delay, advance through Enemy, resume the same turn in Rearguard, and End Turn. Expected: no duplicate Start timing, no End timing when Delay is chosen, no second Start on resume, and eventual End timing once.

## Test 3 — PC Grapple

Use native Grapple against an NPC. Inspect the actual Condition/Effect structure and observe behavior across phases. Expected: standard unlimited/prose-only Grabbed or Restrained stays PF2e-native; NelTempo does not guess a source. Existing Delay restriction remains correct.

## Test 4 — NPC Grab

Use a creature with native Grab if practical. Observe Enemy → Rearguard → Initiative → next round. Expected: unrelated phase movement does not alter it through NelTempo. Only an independently qualifying structured finite Effect receives compatibility bookkeeping.

## Test 5 — Escape

Successfully Escape using PF2e. Expected: PF2e removes/changes the Condition or Effect; NelTempo's live condition reader immediately stops blocking Delay, any exact compatibility record is pruned, and no later boundary attempts duplicate removal.

## Test 6 — Reactive Strike

Have a PC react during Enemy phase. Expected: NelTempo does nothing—no activation, Start, End, phase change, action refresh, or portrait lifecycle change.

## Test 7 — Shield Block or another reaction

Use Shield Block, Champion reaction, Aid, or another reaction. Expected: PF2e resolves it and NelTempo state remains byte-for-byte equivalent in lifecycle terms.

## Test 8 — Ready

Use Ready during a PC's real turn, End Turn, then trigger the readied action later. Expected: no NelTempo activation, Start, End, or reopen; the owner remains completed for the prior actual turn.

## Test 9 — Reload

Reload separately before Start, after Start, while Delayed, before End, after End, and while Grabbed/Restrained. Also reconnect a secondary GM. Expected: no duplicate boundaries or expiry, no lost Delay snapshot, no stale condition restriction, and uncertain Processing becomes Review rather than replay.

## Test 10 — Administrative movement

Move actors among Vanguard, Enemy, Rearguard, and Awaiting Roll; use initiative edits, Complete, Skipped, Review, and Reopen. Expected: no native timing merely because workflow placement changed. Explicit Process Start/End remains the only relevant boundary action.

## Additional authority and removal checks

- With two active GMs, create one qualifying Effect and reach its boundary. Expect one primary-GM mutation.
- Remove source and target Combatants separately. Expect no crash, no Actor Effect deletion caused merely by removal, and safe duration restoration/pruning.
- Defeat the source. Expect Review/native ownership, not an invented “source defeated removes condition” rule.
- End NelTempo while a qualifying Effect remains. Expect its original native duration restored.

## Mandatory 0.4.0 regression pass

Re-run Awaiting Roll, success/failure lanes, new-round reset, Fast Healing, regeneration, action/reaction refresh, shield/parry expiry, persistent damage, recovery, frightened, Confused priority and overrides, Delay one Start/one End, reload during Delay, phase guards, combatant recovery controls, confirmation fallbacks, and administrative no-lifecycle behavior. Any regression blocks RC1.
