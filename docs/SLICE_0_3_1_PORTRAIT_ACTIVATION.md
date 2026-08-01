# NelTempo 0.3.1 — Portrait Activation and Optional Camera Pan

## Purpose

Clicking a NelTempo combatant portrait activates that combatant’s **exact** canvas token for the local user, optionally panning the camera. This is client-local navigation — not phase authorization.

## Accepted 0.3.0 baseline

- Annotated tag: `v0.3.0`
- Commit: `ee509150753834415e0db75ccc893a32296f22e0`
- Message: `NelTempo 0.3.0 GM placement editor runtime accepted`

## Why prior behavior felt broken

The portrait button used `data-action="claim"` and was **disabled** whenever NelTempo claim was illegal (another active combatant, already ended, wrong phase, etc.). There was no Foundry `Token#control` call. Activation therefore appeared to work only when claim was available.

## Exact-token identity

Resolved from the Combatant only:

- `combatantId`
- `tokenId` (`combatant.tokenId` / `combatant.token.id`)
- `sceneId` (`combatant.sceneId` / token parent scene)

Never by Actor name, Token name, portrait image, or first Actor token match.

## Current-scene limitation

If the combatant token is not on `canvas.scene`:

- do not release current control
- do not switch scenes
- show: “This combatant’s token is not on the active scene.”

## Permission behavior

Uses Foundry’s native `token.can(user, "control")` (with safe fallbacks). Failure preserves prior control and does not pan. No ownership mutation; no GM socket for player control.

## Local-only architecture

`scripts/portrait-activation.js`:

- no combat flag writes
- no socket messages
- no Undo / revision / mutation queue
- no Scene initial-view updates
- no TokenDocument movement

## Previous token release

After validation succeeds, `token.control({ releaseOthers: true, pan: false })` atomically releases the user’s other controlled tokens and controls the exact clicked token.

## Already-controlled token

If the exact token is already the sole controlled token:

- remains controlled (not toggled off)
- still pans when the setting is enabled

## Camera-pan setting

| Key | `panCameraOnPortraitActivation` |
| --- | --- |
| Scope | client |
| Type | Boolean |
| Default | `true` |

Name: **Pan Camera When Activating Portrait**

When enabled, after successful control: `token.panCanvas({ force: true, duration: 350 })` (fallback `canvas.animatePan` to token center, preserving scale). Pan failure does not undo control.

## Foundry APIs used

- `Token#control({ releaseOthers, pan })`
- `Token#panCanvas` / `Canvas#animatePan`
- `Token#can(user, "control")`
- `Token#center`
- Combatant `tokenId` / `sceneId` / `token`

## Accessibility

Portrait main region:

- `aria-label` / tooltip: Activate Token
- keyboard focus (`:focus-visible`)
- Enter / Space via native `<button>`

## Interactive-control isolation

End Turn, Delay, placement editor, timing menu, and other `[data-action]` controls keep their own handlers and do not run portrait activation.

## Hover

Existing pointerenter/leave token hover highlighting is unchanged.

## Hidden combatants

Players only see portraits already filtered by NelTempo visibility. No activation control exists for hidden portraits they cannot see.

## Claim coexistence

After local activation, if the combatant may still claim a free-order turn, the existing `CLAIM` request runs. Token activation itself never depends on claim eligibility.

## NelClick coexistence

No NelClick dependency or patch. Both modules call native token control from separate user gestures.

## Failure handling

Missing combatant/token, off-scene, canvas unready, permission, and control/pan exceptions are caught. Concise localized warnings; debug events when logging is enabled.

## Privacy

Debug logs use shortened ids only — no actor/token/user names or full UUIDs.

## Known limitations

- No automatic scene switching
- No remote / forced player camera movement
- Does not clear targets or templates
- Requires Foundry V14 canvas token APIs

## Runtime testing

See `docs/SLICE_0_3_1_TEST_PLAN.md`.
