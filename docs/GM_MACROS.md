# NelTempo GM Macros

## Toggle Activation Timer

Use this during combat when a player acts out of turn (reactions, Ready, etc.)
or when you need to pause/resume the timer on the currently activated combatant
without claiming or ending their turn.

1. Select exactly one token that is in the NelTempo encounter.
2. Run the macro (GM only).
3. Run it again on the same token to pause the timer.

```js
/**
 * NelTempo — Toggle Activation Timer (GM)
 * Select one encounter token, then execute.
 */
const api = game.dynamicInitiative;
if (!api?.toggleActivationTimer) {
  return ui.notifications.error("NelTempo API unavailable. Is the module enabled?");
}
await api.toggleActivationTimer();
```

Optional: pass a combatant id directly.

```js
await game.dynamicInitiative.toggleActivationTimer("COMBATANT_ID");
```

Notes:
- Requires **Track Combat Activation Time** enabled in world settings.
- Does not claim a turn, change phase eligibility, or invoke PF2e Start/End.
- Multiple combatants may have running timers at once (for example, active turn + reaction).
- Pausing and restarting creates a new timing session and adds to the total.
