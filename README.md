# Dynamic Initiative

A portrait-driven combat controller for **Foundry VTT 14** and the **Pathfinder Second Edition** system.

Dynamic Initiative replaces a fixed individual initiative order with four encounter phases:

1. **Initiative** — Players choose a skill and roll against the current Enemy Initiative DC.
2. **Vanguard** — Successful PCs act in any order.
3. **Enemy** — The GM activates enemies in any order; player reactions resolve normally.
4. **Rearguard** — Failed PCs and Vanguard characters who delayed act in any order.

At the end of Rearguard, the GM changes to Initiative. The round advances, global round-transition effects can be resolved, and players roll again.

## Installation

### Forge / manual module installation

1. Extract the ZIP.
2. Place the `nel-dynamic-initiative` folder in Foundry's `Data/modules` directory.
3. Restart Foundry if it was running.
4. Open **Manage Modules** for the world.
5. Enable **Dynamic Initiative**.
6. Disable **Combat Carousel** for this world so the top-center portrait space is available.

## Starting an encounter

There are three supported workflows:

- Add tokens to Foundry's normal Combat Tracker, then click **Start Dynamic Initiative**.
- Select tokens on the canvas and click the top-center **Dynamic Initiative** launcher; the module creates an encounter from the selected tokens.
- Run this macro as a GM:

```js
game.dynamicInitiative.start();
```

## GM workflow

1. Confirm or edit the Enemy Initiative DC.
2. Select a suggested skill or leave **Last Used / Character Default**.
3. Click **Prompt Initiative**.
4. When rolls are complete, click **Next Phase** to enter **Vanguard**.
5. Players click eligible portraits to claim turns and use **End Turn** when finished.
6. Use **Next Phase** for **Enemy**, activate enemy portraits, then advance to **Rearguard**.
7. Advance from **Rearguard** to **Initiative** to begin the next round and prompt new checks.

## Portrait dock layout

- The dock uses Actor portrait art rather than token artwork whenever an Actor portrait is available.
- During Initiative, Vanguard results move into the green left zone, unrolled characters remain centered, and Rearguard results move into the red right zone.
- Round, phase, Enemy DC, and GM controls are displayed in the compact bottom bar.

## Player workflow

- During Initiative, choose an available skill or Lore in the prompt, then roll through PF2e's normal modifier dialog.
- During Vanguard or Rearguard, click your portrait to claim the next turn.
- Complete the full PF2e turn, then click **End Turn**.
- A Vanguard character can use **Delay to Rearguard**.

## Raise a Shield: minimum opposition

While Dynamic Initiative is active, newly created **Raise a Shield** effects are changed to unlimited duration and tracked by the module. They are removed at the end of the next applicable Enemy phase.

- Raised in Vanguard: expires at the end of the upcoming Enemy phase.
- Raised in Rearguard or Initiative: expires at the end of the next Enemy phase.
- Raised during Enemy: expires at the end of the current Enemy phase.

This option can be disabled in Module Settings.

## Timing intentionally left native to PF2e

The module uses native personal turns for:

- Persistent damage
- Frightened reduction
- Recovery checks
- Fast healing and regeneration
- MAP reset
- Reaction refresh
- Start- and end-of-turn effects

The shared Initiative phase is for global round transitions, environmental changes, hazard escalation, progress clocks, and the next initiative checks.

## Current limitations in v0.1.4

- Dynamic Initiative does not judge whether a player's chosen initiative skill is narratively appropriate.
- Opening initiative automation from every possible third-party module cannot be guaranteed.
- Minimum-opposition shield timing recognizes PF2e effects whose slug or name matches **Raise a Shield**.
- Friendly NPCs are classified as party-side if they have player ownership, party alliance, or friendly token disposition. Other NPCs are treated as enemies.
- The module is designed to coexist with PF2e Workbench, but the first live-world test should be performed in a copied world or after a backup.

## GM macro API

```js
game.dynamicInitiative.start();
game.dynamicInitiative.prompt();
game.dynamicInitiative.phase("vanguard");
game.dynamicInitiative.phase("enemy");
game.dynamicInitiative.phase("rearguard");
game.dynamicInitiative.phase("initiative");
game.dynamicInitiative.undo();
game.dynamicInitiative.end();
```

## Recommended first test

Use a copied world and a small encounter containing:

- Two PCs
- Two ordinary enemies
- One PC with a shield
- One PC with a reaction

Test initial initiative, skill changes, free player order, Delay to Rearguard, Enemy phase reactions, Raise a Shield expiration, rerolling initiative, a Rearguard-to-Vanguard consecutive turn, Undo, and ending combat.

## Included documentation

- `FORGE_INSTALL.md` — Forge and manual installation notes.
- `PLAYTEST_CHECKLIST.md` — focused first-session validation checklist.
## Compatibility note: Monk's Combat Details

Dynamic Initiative v0.1.4 suppresses native Combat Tracker rendering for its internal phase, round, turn, and flag updates. This prevents a known Monk's Combat Details 14.02 tracker-hook exception from interrupting round transitions and Initiative prompts. Monk's Combat Details can remain enabled, although its unrelated features may still produce its own console warning when another action renders the native tracker.

