# Dynamic Initiative v0.1.5 — First Playtest Checklist

Use a copied world or make a world backup before the first test. Disable Combat Carousel and leave PF2e Workbench enabled.

## Setup

- [ ] Enable **Dynamic Initiative** in Manage Modules.
- [ ] Refresh every connected browser after enabling it.
- [ ] Add two player-owned PCs and two hostile NPCs to the encounter.
- [ ] Include one PC carrying a shield and one PC with a reaction.
- [ ] Confirm the portrait dock appears at the top-center and can be dragged.
- [ ] Confirm Foundry’s native Encounter Tracker is hidden while Dynamic Initiative is active.
- [ ] Hover each portrait and confirm its canvas token highlights.

## Opening Initiative

- [ ] Start Dynamic Initiative.
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
- [ ] Confirm only Vanguard portraits are displayed.
- [ ] Confirm either eligible player can claim the next turn.
- [ ] Confirm another player cannot claim while a turn is active.
- [ ] End the active turn and confirm its portrait dims.
- [ ] Delay one Vanguard character and confirm it moves to Rearguard.

## Enemy

- [ ] Click **Next Phase** to advance to Enemy.
- [ ] Confirm enemy portraits replace player portraits.
- [ ] Confirm only the GM can activate enemies.
- [ ] Confirm the reaction reminder is visible.
- [ ] Trigger Shield Block, Reactive Strike, or another reaction and confirm PF2e resolves it normally.

## Raise a Shield — Minimum Opposition

- [ ] Raise a Shield during Vanguard; confirm it remains through Enemy and expires when Enemy ends.
- [ ] Raise a Shield during Rearguard; confirm it survives the round transition and expires after the next Enemy phase.
- [ ] Confirm ending combat removes any shield effects managed by Dynamic Initiative.

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
- Whether Debug Logging was enabled in Dynamic Initiative settings
