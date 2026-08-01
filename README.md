# Dynamic Initiative

A portrait-driven combat controller for **Foundry VTT 14** and the **Pathfinder Second Edition** system.

Dynamic Initiative replaces a fixed individual initiative order with four encounter phases:

1. **Initiative** — Players choose a skill and roll against the current Enemy Initiative DC.
2. **Vanguard** — Successful PCs act in any order.
3. **Enemy** — The GM activates enemies in any order; player reactions resolve normally.
4. **Rearguard** — Failed PCs and Vanguard characters who delayed act in any order.

At the end of Rearguard, the GM changes to Initiative. The round advances, global round-transition effects can be resolved, and players roll again.

**Current version:** 0.1.5  
**Module ID:** `nel-dynamic-initiative`  
**Compatibility:** Foundry VTT V14 (verified 14.365), PF2e 8.3.0, Forge VTT hosting

## Installation

### Forge / manual module installation

1. Extract the ZIP (`dist/dynamic-initiative.zip` or the release archive).
2. Place the extracted folder in Foundry's `Data/modules` directory so that `module.json` is at `Data/modules/<folder>/module.json`.
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

## Settings

| Setting | Scope | Default | Description |
| --- | --- | --- | --- |
| Portrait Size | Client | 72 | Portrait height in the dock |
| Top Offset | Client | 8 | Default distance from the top of the window |
| Maximum Dock Width | Client | 62 | Max width as a percentage of the browser |
| Automatically Open Initiative Prompts | Client | true | Auto-open skill prompts when the GM prompts |
| Minimum Opposition for Raise a Shield | World | true | Manage Raise a Shield until end of next Enemy phase |
| Dynamic Initiative Debug Logging | Client | false | Concise state diagnostics in the browser console |

### Debug logging

When **Dynamic Initiative Debug Logging** is enabled, the console receives short events such as:

- `state-normalized`, `state-update-queued`, `state-update-started`, `state-update-complete`
- `state-update-stale`, `state-update-failed`
- `phase-change-requested`, `phase-change-complete`
- `undo-requested`, `undo-complete`
- `combatant-state-pruned`, `combat-ended-cleanup`

Logged fields are limited to shortened combat ids, phase slugs, revision numbers, combatant counts, pruned-entry counts, and reasons. Actor names, token names, full flags, and secrets are never logged.

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

## Development setup

```bash
cd C:\Dev\FoundryModules\DynamicInitiative
npm test
npm run pack
```

- Runtime entry: `scripts/main.js`
- State machine: `scripts/state.js`
- Persistence: `scripts/utils.js` (`saveState`, `safeCombatUpdate`)
- GM/player requests: `scripts/controller.js`
- Portrait dock UI: `scripts/ui.js`

## Package creation

```bash
npm run pack
```

Creates `dist/dynamic-initiative.zip` with `module.json` at the ZIP root, runtime scripts, styles, localization, README, and LICENSE. Excludes `.git`, `node_modules`, `tests`, and `dist` contents other than the archive itself.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Forced-deletion compatibility warnings | Should be gone in 0.1.5+. Confirm the loaded module version is 0.1.5 and hard-refresh clients. |
| Phase change does nothing | Only the primary active GM applies state mutations. Confirm a GM is active. |
| Initiative prompt missing on a player | Ensure the player owns the combatant and **Automatically Open Initiative Prompts** is on. |
| Stale combatant results after removal | 0.1.5 replaces the full module state object each write and prunes missing combatant ids. |
| Undo after removing a combatant | Undo restores gameplay fields but does not recreate deleted combatants. |

## Known third-party noise (not Dynamic Initiative)

Unrelated console errors observed during playtests should not be treated as Dynamic Initiative failures:

- Monk’s Combat Details — `CONFIG.statusEffects.find is not a function`
- Pathfinder 2e Action Macros — actor-sheet render errors
- Magnetic Shot / other item alterations — invalid alteration rules
- PF2e Sustain Reminder — deprecated `renderTemplate` usage
- ForgeVTT host scripts — `setProperty is not defined` in some host contexts

Dynamic Initiative fails independently and logs its own concise errors.

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

## Documentation

- `docs/ARCHITECTURE.md` — state ownership, normalization, persistence
- `docs/MAINTENANCE_V14_STATE_REPAIR.md` — V14 repair notes
- `docs/TEST_PLAN.md` — static, mocked, and runtime test plan
- `FORGE_INSTALL.md` — Forge and manual installation notes
- `PLAYTEST_CHECKLIST.md` — focused first-session validation checklist
- `CHANGELOG.md` — release history

## Current limitations in v0.1.5

- Dynamic Initiative does not judge whether a player's chosen initiative skill is narratively appropriate.
- Opening initiative automation from every possible third-party module cannot be guaranteed.
- Minimum-opposition shield timing recognizes PF2e effects whose slug or name matches **Raise a Shield**.
- Friendly NPCs are classified as party-side if they have player ownership, party alliance, or friendly token disposition. Other NPCs are treated as enemies.
- The module is designed to coexist with PF2e Workbench, but the first live-world test should be performed in a copied world or after a backup.
- This maintenance release intentionally does **not** add phase-lifecycle automation, automatic phase advancement, Grabbed/Restrained/Confused timing, or new initiative rules.
