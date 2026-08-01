# Changelog

## 0.3.1

- Portrait clicks activate the combatant’s exact canvas token locally, releasing the user’s other controlled tokens first.
- Client setting **Pan Camera When Activating Portrait** (default on) smoothly pans to the token center after control.
- Activation works regardless of claim/End Turn eligibility; off-scene tokens do not switch scenes or clear control.
- Documentation: `docs/SLICE_0_3_1_PORTRAIT_ACTIVATION.md`, `docs/SLICE_0_3_1_TEST_PLAN.md`.

## 0.3.0

- Added GM-only **Edit Initiative Placement** DialogV2 (This Round / Next Round).
- Current-round corrections follow a lifecycle-safe matrix; unsafe options explain why and offer Next Round.
- Durable next-round placement queue (replace with confirmation, cancel, consume once on round transition).
- Current-phase join processes only the missing start boundary; corrections never create a new `phaseInstanceId` alone.
- Original initiative ChatMessages are preserved; placement audit records GM corrections separately (schema 4).
- Documentation: `docs/SLICE_0_3_0_GM_INITIATIVE_EDITOR.md`, `docs/SLICE_0_3_0_TEST_PLAN.md`.

## 0.2.2

- Persistent dock/launcher now use Foundry’s interface-layer z-index (`--z-index-app`, fallback 30) so Actor, NPC, Item, Journal, DialogV2, and other application windows render above NelTempo.
- Removed the large Delay Blocked portrait overlay; Delay remains disabled with tooltip / `aria-disabled` and authoritative rejection.
- Preserved compact Must Act First, Waiting for Confused Turn, and GM override indicators.
- Documentation: `docs/SLICE_0_2_2_UI_LAYERING.md`.

## 0.2.1

- Rebranded display name to **NelTempo** (formerly Dynamic Initiative); module id `nel-dynamic-initiative` unchanged.
- Added PF2e condition timing for **Grabbed**, **Restrained**, and **Confused** via structured slug adapter (`scripts/pf2e-condition-adapter.js`); fail-open when APIs unavailable.
- **Grabbed** and **Restrained** block voluntary Delay to Rearguard during open Vanguard lifecycle.
- **Confused** priority gate: Confused roster combatants must End Turn in deterministic order (roster → combatant id) before others.
- Timing state under `lifecycle.timing` with audit trail, badges, and mid-phase condition reconciliation.
- GM overrides: Allow Delay Once, Move to Rearguard, Resolve/Skip Priority, Reopen Confused Turn, Resume Current Once, Clear Override.
- World setting **Enforce Condition Timing** (default on; no migration write).
- Player Reopen blocked for Confused-resolved turns; GM uses dedicated override path.
- Documentation: `docs/SLICE_0_2_1_CONDITION_TIMING.md`, `docs/SLICE_0_2_1_TEST_PLAN.md`.

## 0.2.0

- Added formal phase lifecycle for Vanguard, Enemy, and Rearguard with durable `lifecycle` state (schema 3).
- Native PF2e start-of-turn processing runs once per roster combatant when a phase opens (`CombatantPF2e.onStartTurn` via lifecycle adapter).
- Native PF2e end-of-turn processing (including persistent damage) runs once when leaving a phase (`onEndTurn`).
- **End Turn** on carousel portraits marks completion only; **Reopen Turn** is available before phase end.
- Phase progress UI (`Ended X / Y`, Phase Complete) and GM controls: End Remaining Turns, Advance Phase, Force Advance, lifecycle recovery.
- World setting **Advance Completed Phases Automatically** (`off` | `prompt` | `automatic`, default off).
- Reload-safe interrupted recovery; multi-GM authority unchanged; Undo warns when crossing completed phase-end boundaries (state only).
- `combat.turn` updates suppress native turn events so lifecycle is not duplicated.

## 0.1.5

- Replaced legacy Foundry `"-=key"` combat-flag deletion with atomic complete replacement of the module-owned state object using V14 `_replace` / `ForcedReplacement`.
- Added cohesive state normalization that prunes stale combatant ids and keeps only plain serializable data.
- Serialized combat state mutations through a per-combat queue to avoid overlapping writes from rapid UI clicks.
- Added a lightweight `revision` counter incremented only on successful state writes.
- Undo restores gameplay state after normalizing against combatants still in the encounter.
- Moved **Dynamic Initiative Debug Logging** to a client-scoped setting (default off) with concise structured diagnostics.
- Added architecture, maintenance, and test-plan documentation; expanded automated tests.

## 0.1.4

- Replaced the opaque dock shell with a transparent portrait staging layout.
- Removed the top Dynamic Initiative title/header bar and moved round, phase, and DC information into the bottom control bar.
- Split the Initiative phase into green Vanguard, central Awaiting Roll, and red Rearguard zones.
- Initiative portraits now move to the left or right zone immediately after their result synchronizes.
- Added a player notification stating the rolled total and Vanguard/Rearguard placement.
- Renamed the GM dropdown label from Suggested to Skill.
- Changed carousel imagery to prefer the Actor portrait instead of token artwork.

## 0.1.3

- Fixed round-transition state maps not actually clearing because Foundry merges nested flag objects.
- Initiative results, acted states, and delays now reset cleanly at the start of every round.
- Native party initiative values are cleared when a new Dynamic Initiative round begins.
- Initiative prompt sockets now tolerate document-sync timing differences between GM and player clients.
- Initiative results now record their round, preventing legacy results from blocking later prompts.

## 0.1.0 — Initial playtest build

- Added four-phase Dynamic Initiative state machine.
- Added top-center portrait dock with draggable client-side placement.
- Added player-selected PF2e initiative skill prompts with remembered skills.
- Added editable Enemy Initiative DC and automatic Vanguard/Rearguard classification.
- Added free-order portrait activation for PCs and enemies.
- Added Delay to Rearguard, native turn activation, acted-state correction, and Undo.
- Added minimum-opposition Raise a Shield timing.
- Added GM macro API and Combat Tracker launcher.

## 0.1.1 — First live-world fixes

- Hid Foundry's native Encounter Tracker while Dynamic Initiative is active.
- Closed the Dynamic Initiative skill prompt before opening PF2e's modifier dialog.
- Changed the GM phase button to advance automatically: Initiative → Vanguard → Enemy → Rearguard → Initiative.
- Added canvas-token highlighting when a portrait is hovered.
- Added a live actor scan so Raise a Shield reliably expires when Enemy changes to Rearguard.
- Expanded Raised Shield effect-name compatibility.

## 0.1.2 — Combat tracker compatibility

- Prevented Dynamic Initiative state and turn updates from rendering the hidden native Combat Tracker.
- Added a guarded compatibility path for Monk's Combat Details 14.02 when its tracker hook throws on `CONFIG.statusEffects.find`.
- Stopped mirroring Dynamic Initiative results into native initiative values because the hidden tracker does not use them.
- Ensured round transitions can finish and the next Initiative prompt can broadcast even when a third-party tracker hook fails.
