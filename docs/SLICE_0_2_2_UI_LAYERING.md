# NelTempo 0.2.2 — UI Layering and Timing Badge Cleanup

## Reported problems

1. The portrait carousel and phase dock could render **above** open Foundry Actor, NPC, Item, Journal, DialogV2, and other application windows, intercepting pointer input meant for sheets.
2. Grabbed / Restrained / Confused Delay restrictions rendered a large **Delay Blocked** text overlay across the combatant portrait, obscuring the token art while the disabled Delay control already explained the restriction.

## Foundry V14 stacking contexts inspected

| Layer | Role | Typical z-index |
| --- | --- | --- |
| Canvas / `#board` | Scene | low / base |
| `#interface` HUD peers | Scene controls, pause, chrome | `--z-index-app` (fallback **30**) |
| ApplicationV1 `.window-app` | Legacy sheets / config | starts at `--z-index-window` (~100+), increments via `globalThis._maxZ` |
| ApplicationV2 | Modern sheets / apps | same window range via `ApplicationV2._maxZ` / bringToFront |
| DialogV2 / tooltips | Modal prompts | `--z-index-tooltip` and higher |

NelTempo previously used:

- `#ndi-dock` → `z-index: 110`
- `#ndi-launcher` → `z-index: 109`

That value sits **inside** the Foundry application window range, so the first opened sheets (often ~100–110) appeared under the dock.

## Chosen interface layer

Persistent NelTempo UI now uses:

```css
--ndi-interface-z: var(--z-index-app, 30);
z-index: var(--ndi-interface-z);
```

- Prefer Foundry’s `--z-index-app` when the core theme defines it.
- Fallback **30** stays above the canvas and below `--z-index-window` / Application `_maxZ` increments.
- No inline z-index is written from JavaScript.
- No Application / ApplicationV2 / DialogV2 monkey-patches.
- No `bringToFront`, no sheet z-index rewriting, no render hooks that reorder applications.

Mount remains `document.body` so `position: fixed` stays viewport-relative and z-index competes in the same stacking context as Foundry windows.

### Temporary initiative skill modal

`.ndi-modal-backdrop` uses `var(--z-index-tooltip, 9999)` so the skill prompt remains a short-lived modal overlay (same class of UI as DialogV2). The persistent dock and launcher stay in the interface layer.

## Pointer-event behavior

- Dock and launcher set `pointer-events: auto`.
- Timing portrait badges use `pointer-events: none` and are omitted entirely for Delay Blocked states (no empty hit target).
- Visually topmost Foundry applications receive clicks; NelTempo does not raise itself above them.

## Delay Blocked overlay removal

| Still present | Removed from portrait |
| --- | --- |
| Disabled Delay button + grey styling | Large Delay Blocked image overlay |
| `title` / `aria-label` / `aria-disabled` | Status line text “Delay Blocked: …” |
| Authoritative Delay rejection | |
| `delayBlockReason` timing state + audit | |
| Localization strings for tooltips/notifications | |

Tooltip copy (unchanged):

- Grabbed → `You cannot Delay while Grabbed.`
- Restrained → `You cannot Delay while Restrained.`
- Confused → `You cannot Delay while Confused.`

## Priority indicators preserved

Portrait overlay / status still show compact forced-order states:

- Must Act First
- Waiting for Confused Turn
- GM Timing Override
- Resume Allowed Once
- Priority outline / waiting dim / override outline classes

`timingBadgeFor` still returns `delay-blocked-*` keys for state/tests; the UI filters those keys out of portrait overlays only.

## Functional preservation

No changes to Grabbed/Restrained/Confused Delay rules, Confused priority gate, End Turn / Reopen authorization, GM overrides, timing reconciliation, phase lifecycle, persistent damage, state replacement, mutation queue, multi-GM authority, Undo, Raise Shield/Parry, or hidden combatant privacy.

## Known limitations

- Exact numeric values of Foundry CSS variables can vary by theme; `--z-index-app` fallback 30 is conservative for stock V14.
- The initiative skill modal remains a modal overlay above applications while open.
- Runtime sheet-over-dock verification requires Foundry V14 + PF2e 8.3.0 (not claimed from this environment).

## Runtime test requirements

See `PLAYTEST_CHECKLIST.md` (0.2.2 section) and the AF-style checks in the Slice 0.2.2 release notes: open Actor/NPC/Item/Journal/DialogV2 over the dock, confirm clicks reach the sheet, then verify Delay tooltips without portrait Delay Blocked overlays while priority badges remain.
