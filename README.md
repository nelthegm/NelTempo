# NelTempo

*Formerly Dynamic Initiative.*

A portrait-driven combat controller for **Foundry VTT 14** and the **Pathfinder Second Edition** system.

NelTempo replaces a fixed individual initiative order with four encounter phases:

1. **Initiative** — Players choose a skill and roll against the current Enemy Initiative DC.
2. **Vanguard** — Successful PCs act in any order.
3. **Enemy** — The GM activates enemies in any order; player reactions resolve normally.
4. **Rearguard** — Failed PCs and Vanguard characters who delayed act in any order.

At the end of Rearguard, the GM changes to Initiative. The round advances, global round-transition effects can be resolved, and players roll again.

**Current version:** 0.3.6
**Module ID:** `nel-dynamic-initiative`
**Compatibility:** Foundry VTT V14 (verified 14.365), PF2e 8.4.0, Forge VTT hosting

## Installation

### Manifest URL (Forge / Foundry)

Paste this manifest URL into Forge or Foundry’s module installer:

```
https://raw.githubusercontent.com/nelthegm/NelTempo/main/module.json
```

This is the permanent Forge / Foundry install channel for stable **NelTempo 0.3.6**, runtime-accepted on Foundry VTT 14.365, PF2e 8.4.0, and Forge VTT. Fixes contradictory Ended counts and honors Guard Incomplete Phase = Off. The internal module ID remains `nel-dynamic-initiative`.

Direct ZIP (fallback):

```
https://github.com/nelthegm/NelTempo/releases/download/v0.3.6/dynamic-initiative.zip
```
### Manual ZIP install

1. Extract the ZIP (`dist/dynamic-initiative.zip` or the release archive).
2. Place the extracted folder in Foundry's `Data/modules` directory so that `module.json` is at `Data/modules/<folder>/module.json`.
3. Restart Foundry if it was running.
4. Open **Manage Modules** for the world.
5. Enable **NelTempo**.
6. Disable **Combat Carousel** for this world so the top-center portrait space is available.

## Starting an encounter

There are three supported workflows:

- Add tokens to Foundry's normal Combat Tracker, then click **Start NelTempo**.
- Select tokens on the canvas and click the top-center **NelTempo** launcher; the module creates an encounter from the selected tokens.
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
- During Vanguard or Rearguard, click your portrait to claim the next turn (optional highlight) and to control that combatant’s canvas token.
- Client setting **Pan Camera When Activating Portrait** (default on) centers your camera on the token after activation.
- Complete your actions in any order, then click **End Turn** on your portrait.
- **End Turn** runs your PF2e end-of-turn effects (including persistent damage) once for that combatant.
- **Reopen Turn** is only available before native end processing completes; after End Turn, native effects are not reversed through NelTempo.
- A Vanguard character can use **Delay to Rearguard**.

## GM initiative / phase editor (0.3.0)

GMs can open **Edit Initiative Placement** on a portrait to:

- Correct placement **This Round** when lifecycle-safe (Vanguard, Enemy, Rearguard, Pending)
- **Queue** a placement for the **Next Round** (replace with confirmation, or cancel)
- Join the current Open phase (missing start boundary runs once) or move to a future phase without premature boundaries

Players cannot open the editor. Original initiative chat rolls are never edited. See `docs/SLICE_0_3_0_GM_INITIATIVE_EDITOR.md`.

## Portrait activation (0.3.1)

Clicking the portrait image region controls that combatant’s **exact** token on the current scene (local only). It works even when another token is already controlled, and does not require the combatant to be eligible to act. Off-scene tokens do not switch scenes. See `docs/SLICE_0_3_1_PORTRAIT_ACTIVATION.md`.

## Phase lifecycle (0.3.5)

When the GM advances into Vanguard, Enemy, or Rearguard:

1. The module snapshots the phase roster and runs native PF2e **start-of-turn** once per combatant.
2. Players act freely; each uses **End Turn** when done — that runs native PF2e **end-of-turn** once for that combatant.
3. When everyone is finished, the dock shows **Phase Complete**.
4. The GM advances (or uses automatic advance). Incomplete phases show a guard dialog: Return, Process Remaining, or Advance Without Processing.

See `docs/SLICE_0_3_5_PHASE_TURN_LIFECYCLE.md`.

## Condition timing (0.2.1)

When **Enforce Condition Timing** is on (default):

- **Grabbed** and **Restrained** block voluntary **Delay to Rearguard** during Vanguard.
- **Confused** combatants must End Turn before others in the same open phase (deterministic roster order).
- GMs can grant one-shot overrides (Allow Delay Once, Move to Rearguard, Resolve/Skip Priority, Reopen Confused, Resume Current Once, Clear Override).

Condition detection uses structured PF2e slugs only (`grabbed`, `restrained`, `confused`); failed reads fail open. See `docs/SLICE_0_2_1_CONDITION_TIMING.md`.

## Settings

| Setting | Scope | Default | Description |
| --- | --- | --- | --- |
| Portrait Size | Client | 72 | Base portrait height in the dock |
| Portrait Scale | Client | 100% | Visual scale of portrait art (50–100%); control hit targets stay usable |
| Phase Bar Scale | Client | 100% | Scale of the phase/status bar only (60–100%) |
| Phase Bar Layout | Client | Auto | Auto / Compact / Full; Auto chooses Compact when space or scale is constrained |
| Top Offset | Client | 8 | Default distance from the top of the window |
| Maximum Dock Width | Client | 62 | Max width as a percentage of the browser |
| Automatically Open Initiative Prompts | Client | true | Auto-open skill prompts when the GM prompts |
| Manage Raise a Shield / Parry | World | true | Expire at that creature’s next start-of-turn |
| Turn Lifecycle Automation | World | Native | Off / Reminders Only / Native PF2e Processing |
| Phase Lifecycle Summary | Client | GM Only | Optional phase-start summary chat |
| Guard Incomplete Phase | World | true | Dialog before advancing unfinished phases |
| Allow GM Advance Without Processing | World | true | Show emergency skip option |
| Advance Completed Phases Automatically | World | Off | Off / Prompt GM / Automatic when all turns end |
| Enforce Condition Timing | World | true | Grabbed/Restrained delay block and Confused priority gate |
| NelTempo Debug Logging | Client | false | Concise state diagnostics in the browser console |

Legacy **Interface Scale** (whole-dock zoom) is migrated once into Portrait Scale and Phase Bar Scale, then hidden. The stored legacy value remains for rollback.

### Compact phase bar

- **GM Compact:** round, phase, ended count, one primary action (Next Phase / Prompt), overflow menu for End Remaining, Force Advance, Rearguard, Undo, End Combat.
- **Player Compact:** round, phase, and End Turn when exactly one eligible owned combatant can end.
- **GM right-click** a portrait to open the initiative/phase editor (left-click still selects the token).

### End Turn keybinding

Configure **NelTempo: End Current Turn** under Foundry Configure Controls. It is unbound by default and uses the normal End Turn authority path.

### Debug logging

When **NelTempo Debug Logging** is enabled, the console receives short events such as:

- `state-normalized`, `state-update-queued`, `state-update-started`, `state-update-complete`
- `state-update-stale`, `state-update-failed`
- `phase-change-requested`, `phase-change-complete`
- `undo-requested`, `undo-complete`
- `combatant-state-pruned`, `combat-ended-cleanup`

Logged fields are limited to shortened combat ids, phase slugs, revision numbers, combatant counts, pruned-entry counts, and reasons. Actor names, token names, full flags, and secrets are never logged.

## Raise a Shield / Parry

While NelTempo is active, newly created **Raise a Shield** and **Parry** effects are tracked and kept unlimited until that creature’s **next start-of-turn** (when their phase activates and actions refresh). They are not held until Enemy phase end.

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

## Known third-party noise (not NelTempo)

Unrelated console errors observed during playtests should not be treated as NelTempo failures:

- Monk’s Combat Details — `CONFIG.statusEffects.find is not a function`
- Pathfinder 2e Action Macros — actor-sheet render errors
- Magnetic Shot / other item alterations — invalid alteration rules
- PF2e Sustain Reminder — deprecated `renderTemplate` usage
- ForgeVTT host scripts — `setProperty is not defined` in some host contexts

NelTempo fails independently and logs its own concise errors.

## GM macro API

`start` and `prompt` require a GM user. Non-GM callers are rejected locally (no socket emit). Authoritative dispatch still re-checks GM permission on the elected primary GM.

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

### Package-socket trust note

Foundry’s `game.socket` package channel does not provide a separately authenticated sender User to receivers. NelTempo always stamps the local `userId` on outbound envelopes and ignores caller attempts to overwrite envelope fields, then re-validates the claimed user and permissions on the primary GM. A malicious client can still claim another user’s id on a raw socket emit; this release does not add socketlib or transport authentication.

## Documentation

- `docs/ARCHITECTURE.md` — state ownership, normalization, persistence
- `docs/SLICE_0_2_0_PHASE_LIFECYCLE.md` — phase lifecycle (0.2.0)
- `docs/SLICE_0_2_1_CONDITION_TIMING.md` — condition timing (0.2.1)
- `docs/SLICE_0_2_2_UI_LAYERING.md` — sheet layering and Delay badge cleanup (0.2.2)
- `docs/SLICE_0_3_0_GM_INITIATIVE_EDITOR.md` — GM initiative/phase editor (0.3.0)
- `docs/SLICE_0_3_0_TEST_PLAN.md` — 0.3.0 editor verification
- `docs/SLICE_0_3_1_PORTRAIT_ACTIVATION.md` — portrait token activation (0.3.1)
- `docs/SLICE_0_3_1_TEST_PLAN.md` — 0.3.1 activation verification
- `docs/MAINTENANCE_V14_STATE_REPAIR.md` — V14 repair notes
- `docs/TEST_PLAN.md` — static, mocked, and runtime test plan
- `docs/SLICE_0_2_1_TEST_PLAN.md` — 0.2.1 timing verification
- `FORGE_INSTALL.md` — Forge and manual installation notes
- `PLAYTEST_CHECKLIST.md` — focused first-session validation checklist
- `CHANGELOG.md` — release history

## Current limitations

- NelTempo does not judge whether a player's chosen initiative skill is narratively appropriate.
- Opening initiative automation from every possible third-party module cannot be guaranteed.
- Minimum-opposition shield timing recognizes PF2e effects whose slug or name matches **Raise a Shield**.
- Friendly NPCs are classified as party-side if they have player ownership, party alliance, or friendly token disposition. Other NPCs are treated as enemies.
- Condition timing does not automate Confused target selection, Grapple duration, or Escape actions (see slice doc for deferred work).
- The module is designed to coexist with PF2e Workbench; first live-world tests should use a copied world or backup.
