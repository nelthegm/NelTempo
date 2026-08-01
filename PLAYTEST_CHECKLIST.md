# NelTempo v0.3.0 — Playtest Checklist

*Formerly Dynamic Initiative.* Use a copied world or make a world backup before the first test. Disable Combat Carousel and leave PF2e Workbench enabled.

## Setup

- [ ] Enable **NelTempo** in Manage Modules.
- [ ] Refresh every connected browser after enabling it.
- [ ] Add two player-owned PCs and two hostile NPCs to the encounter.
- [ ] Include one PC carrying a shield and one PC with a reaction.
- [ ] Confirm the portrait dock appears at the top-center and can be dragged.
- [ ] Confirm Foundry’s native Encounter Tracker is hidden while NelTempo is active.
- [ ] Hover each portrait and confirm its canvas token highlights.

## Opening Initiative

- [ ] Start NelTempo.
- [ ] Change the Enemy Initiative DC.
- [ ] Set a suggested initiative skill.
- [ ] Prompt Initiative.
- [ ] Confirm each player receives a prompt.
- [ ] Confirm a player can change the suggested skill, including to a Lore skill.
- [ ] Confirm the PF2e modifier dialog appears before the roll.
- [ ] Confirm results equal to or above the DC enter Vanguard.
- [ ] Confirm lower results enter Rearguard.
- [ ] Change the DC before beginning Vanguard and confirm existing results reclassify.

## Vanguard

- [ ] Click **Next Phase** to advance to Vanguard.
- [ ] Confirm start-of-turn processing runs once (effects / reaction refresh) for Vanguard roster.
- [ ] Confirm only Vanguard portraits are displayed.
- [ ] Confirm either eligible player can claim the next turn.
- [ ] Confirm another player cannot claim while a turn is active.
- [ ] Click **End Turn** on a portrait (not only the bottom bar); confirm Ended state and no persistent damage yet.
- [ ] Reopen Turn, then End Turn again.
- [ ] Confirm phase progress `Ended X / Y` and **Phase Complete** when all finished.
- [ ] Delay one Vanguard character and confirm it moves to Rearguard.

## Enemy

- [ ] Click **Advance Phase** / **Next Phase** to leave Vanguard.
- [ ] Confirm Vanguard end-of-turn processing (including any persistent damage) runs once at the boundary.
- [ ] Confirm Enemy start-of-turn runs once; enemy portraits replace player portraits.
- [ ] Confirm only the GM can activate enemies and End Turn for them.
- [ ] Confirm the reaction reminder is visible.
- [ ] Trigger Shield Block, Reactive Strike, or another reaction and confirm PF2e resolves it normally.

## Raise a Shield — Minimum Opposition

- [ ] Raise a Shield during Vanguard; confirm it remains through Enemy and expires when Enemy ends.
- [ ] Raise a Shield during Rearguard; confirm it survives the round transition and expires after the next Enemy phase.
- [ ] Confirm ending combat removes any shield effects managed by NelTempo.

## Condition timing (0.2.1)

Requires **Enforce Condition Timing** on (default). See `docs/SLICE_0_2_1_TEST_PLAN.md` for full AF checklist.

- [ ] Apply **Grabbed** to a Vanguard PC; confirm **Delay to Rearguard** is blocked.
- [ ] Remove Grabbed; confirm Delay works again.
- [ ] Apply **Restrained**; confirm Delay blocked with Restrained message.
- [ ] Apply **Confused** to one Vanguard PC; confirm **Must Act First** badge and non-Confused PCs cannot End Turn until it resolves.
- [ ] Two Confused PCs: confirm roster order determines who must act first.
- [ ] GM **Allow Delay Once** permits one Delay despite block; second attempt blocked.
- [ ] GM **Move to Rearguard** moves a blocked combatant without removing the condition.
- [ ] GM **Resolve Priority** / **Skip Priority** advances gate without removing Confused.
- [ ] Player cannot **Reopen Turn** after a Confused-resolved turn; GM **Reopen Confused Turn** works with confirm.
- [ ] Toggle **Enforce Condition Timing** off; confirm Delay and End Turn unrestricted.

## UI layering and badges (0.2.2)

See `docs/SLICE_0_2_2_UI_LAYERING.md`.

- [ ] Open a PC Actor sheet over the NelTempo carousel; sheet renders above NelTempo.
- [ ] Click sheet controls where the carousel is behind; clicks reach the sheet.
- [ ] Repeat with NPC sheet, Item sheet, Journal, and a DialogV2 confirmation.
- [ ] Focus alternating overlapping sheets; Foundry window order remains normal.
- [ ] Close all sheets; NelTempo remains above the canvas and usable.
- [ ] Apply Grabbed; Delay is greyed out with Grabbed tooltip; **no Delay Blocked text covers the portrait**.
- [ ] Repeat for Restrained and Confused Delay tooltips without portrait Delay Blocked overlays.
- [ ] Confirm **Must Act First** / **Waiting for Confused Turn** still appear for Confused priority.
- [ ] Refresh with Grabbed active; no Delay Blocked portrait overlay returns.

## GM initiative / phase editor (0.3.0)

See `docs/SLICE_0_3_0_TEST_PLAN.md`.

- [ ] As GM, open **Edit Initiative Placement** from a portrait; as player, confirm the control is absent.
- [ ] During Initiative, set Vanguard / Enemy / Rearguard / Pending; original chat rolls unchanged.
- [ ] In open Vanguard, move an unacted combatant to Rearguard; no end-turn effects; later Rearguard start/end once.
- [ ] Join current Open phase for a Pending combatant; only that combatant receives start processing.
- [ ] Reject completed combatant rejoin and moves into ended phases; Next Round remains available.
- [ ] Queue / refresh / replace (confirm) / cancel a next-round correction; confirm one-time application.
- [ ] Grabbed / Restrained / Confused remain after correction; Allow Delay Once not consumed.
- [ ] Dual-GM or stale dialog: one mutation succeeds; other gets state-changed message.
- [ ] Undo after current-phase join shows placement state-only warning.
- [ ] Confirm 0.2.2 sheet layering still correct with editor DialogV2 open/closed.

## Rearguard and Next Round

- [ ] Click **Next Phase** to advance to Rearguard.
- [ ] Confirm failed PCs and delayed Vanguard PCs appear.
- [ ] Complete Rearguard turns in either order.
- [ ] Click **Next Phase** from Rearguard and confirm Initiative begins and the round number advances.
- [ ] Prompt new Initiative Checks.
- [ ] Confirm each character's previously used skill is preselected.
- [ ] Confirm encounter-opening initiative abilities do not repeat.
- [ ] Let a Rearguard PC become Vanguard and take the first turn, confirming consecutive turns are allowed.

## Corrections and End

- [ ] Mark a portrait acted/unacted as GM.
- [ ] Use Undo after a turn completion, Delay, phase change, and DC change.
- [ ] End combat and confirm the encounter and portrait dock are removed.

## Report useful diagnostics

When reporting a problem, include:

- Foundry core version
- PF2e system version
- PF2e Workbench version
- The phase and round where it occurred
- Browser console error text, if any
- Whether Debug Logging was enabled in NelTempo settings
