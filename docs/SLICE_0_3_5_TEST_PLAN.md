# NelTempo 0.3.5 — Runtime Test Plan

Foundry **14.365**, PF2e **8.4.0**. Module version **0.3.5**. Automation: Native PF2e Processing.

1. **Vanguard Fast Healing** — Two Vanguard actors with Fast Healing; enter Vanguard; both heal once before acting; neither heals again on portrait click.
2. **Enemy regeneration** — Two enemies with regeneration; enter Enemy; both process once; deactivation state respected.
3. **Dying actor** — Dying PC in Vanguard; native recovery workflow once; Heroic Recovery not auto-selected.
4. **Raise Shield / Parry** — Activate each; advance to that actor’s next phase start; each expires at phase activation (not Enemy phase end).
5. **Quickened / slowed / stunned** — Actions refresh per PF2e at start processing.
6. **Persistent damage** — End one actor’s turn; damage + recovery once; other actors in phase not processed.
7. **Multiple persistent conditions** — Independent rolls and recovery checks.
8. **Incomplete phase** — Advance with unfinished actors; verify Return / Process Remaining / Advance Without Processing.
9. **Phase reassignment** — Move unstarted into active phase → immediate start; move already-started → no repeat.
10. **Reload** — After start complete and after End Turn; no duplicated effects.
11. **GM handoff** — Change elected GM; no repeated healing / recovery / persistent damage.
12. **Privacy** — Hidden enemies and private rolls remain private; phase summary respects visibility.

Automated coverage: `tests/turn-lifecycle-035.test.mjs` plus existing lifecycle suites.
