# NelTempo 0.6.0 RC1 — Activation Timing Manual Test Plan

Use a copied world or backup with Foundry 14.365 and PF2e 8.4.x. Confirm **Track Combat Activation Time** and **Show Live Activation Timer** are enabled unless a test says otherwise.

## TEST 1 — BASIC PC TIMER

Activate a PC. The timer appears below the portrait and increments. End Turn. The timer stops and disappears.

## TEST 2 — NPC TIMER

Activate an NPC during Enemy. The same timer behavior occurs, with no new lifecycle boundary beyond the existing Enemy-phase lifecycle.

## TEST 3 — DELAY

Activate a PC for about 10 seconds, Delay, wait about 10 seconds, resume in Rearguard for about 10 seconds, then End Turn. Recorded active time is about 20 seconds, not 30. Delay invokes no End and Rearguard resume invokes no second Start.

## TEST 4 — REACTION

Use a reaction during another combatant’s activation. No timer starts for the reactor.

## TEST 5 — READY

Execute a readied action. No timer starts and no NelTempo turn reopens.

## TEST 6 — RELOAD

Activate an actor, wait, reload, wait, and End Turn. The timer survives reload and the total remains coherent without replaying settled time.

## TEST 7 — HIDE TIMER

Disable **Show Live Activation Timer**. The live timer is invisible while tracking continues. End combat; the timing summary still includes the activation.

## TEST 8 — DISABLE TRACKING

Disable **Track Combat Activation Time**. Running timing finalizes internally, no future activation timing starts, live timers disappear, and End Combat posts no timing summary.

## TEST 9 — ADMIN COMPLETE

Activate a combatant, then have the GM use Mark Complete. Timing finalizes and is retained; no PF2e End processing is fabricated.

## TEST 10 — END COMBAT

Use several actors and End Combat normally. Exactly one public **NelTempo — Combat Timing** card appears with Combatant, Activations, Total Active Time, Average, and a grand total.

## TEST 11 — TWO GM

Where practical, connect two active GM clients. Perform activations and End Combat. Confirm one authoritative timing mutation per workflow event and exactly one timing summary card.

## Additional safety checks

- Portrait-only token selection, GM placement editing, phase entry, reactions, and Ready never start a timer.
- Mark Skipped, Mark Review, Reset Awaiting, lane removal, Force Advance, End Remaining, and normal combat cleanup do not leave a live timer running.
- Reopen retains prior time; only a later canonical activation begins a new session.
- Hidden NPCs use a neutral public summary label.
- Deleting the Combat externally removes the dock and its ticker without client errors. Normal NelTempo End Combat is the supported summary path.
