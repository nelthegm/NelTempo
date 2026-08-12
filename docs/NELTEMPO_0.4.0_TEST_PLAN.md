# NelTempo 0.4.0 RC2 mandatory runtime plan

Run on Foundry `14.365` with PF2e `8.4.x`. Record the world, browser, module build SHA-256, Guard setting, and observed chat/effect changes for every case.

## Delay test 1 — Vanguard transfer

Use two PCs that succeed into Vanguard. Begin Vanguard, have PC 1 act and End Turn, then begin PC 2 and choose **Delay to Rearguard**.

Expected: PC 2 moves to Rearguard and says **Delayed** or **Delayed to Rearguard**, never Ended. No persistent damage, recovery, frightened reduction, duration expiry, PF2e `onEndTurn`, or NelTempo ending/ended hook runs. Vanguard can advance.

## Delay test 2 — Rearguard resume

Advance Vanguard → Enemy → Rearguard.

Expected: the delayed PC is actionable and resumes the same turn. Start Turn processing does not run a second time, and the portrait does not enter Rearguard as completed.

## Delay test 3 — actual End Turn

Have the delayed PC finish its actions and click **End Turn**.

Expected: PF2e End Turn runs exactly once, the portrait becomes Ended, Rearguard reports complete, and the phase can advance.

## Delay test 4 — reload

Delay the PC during Vanguard and reload before Rearguard. Repeat with a reload during Rearguard before End Turn.

Expected: the intentional Rearguard placement and same open turn survive. Original Start remains completed, End remains pending, and neither boundary duplicates after reload.

## Delay test 5 — observable effect timing

Use a PC with visible start- and end-of-turn effects.

Expected: the Start effect occurs once before Delay; the End effect occurs zero times at Delay and once after the actual Rearguard End Turn.

## Phase-control test

Exercise **Process & End Remaining**, **Advance Without Processing**, **Next Phase**, **Rearguard**, **Undo**, and **End** with Guard On/Off and complete/incomplete phases.

Expected: no `confirmDialog is not defined`, `ReferenceError`, or unhandled promise rejection. Cancel leaves state unchanged. Simulate unavailable/throwing DialogV2 and verify each destructive action fails closed with a NelTempo diagnostic.

## Guard test

With Guard On, verify an unfinished Rearguard delayed combatant blocks advancement and an intentionally delayed actor does not block leaving Vanguard. With Guard Off, verify force advancement uses safe Skipped semantics and does not invoke native End. No unresolved delayed turn may silently enter the next round.

## Administrative distinction and recovery

Verify GM **Move to Rearguard** changes placement without inventing a Delay. Inspect a delayed turn and confirm: status Delayed, original Start Completed, resume lane Rearguard, End Pending, Process/Retry Start unavailable. Mark Review, Complete, and Skipped must invoke no lifecycle boundary; End Turn remains the only normal native End path.
