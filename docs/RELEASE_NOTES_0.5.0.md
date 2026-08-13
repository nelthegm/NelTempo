# NelTempo 0.5.0 RC1

NelTempo 0.5.0 hardens compatibility with PF2e's native turn-timing mechanics. It verifies and repairs only a proven gap caused by phase-based combat: finite PF2e Effect items whose unique structured origin ties expiry to the source creature's next actual Start or End. Timing follows the existing NelTempo lifecycle, not phase changes or round increments.

- Supports uniquely proven structured `source-start` and `source-end` Effect relationships.
- Protects qualifying Effects from early world-time/native-tracker expiry, then removes the native PF2e document once at the due actual boundary.
- Reconciles native removal (including Escape outcomes), reload, defeated/removed combatants, and combat shutdown without inventing PF2e rules.
- Adds GM Lifecycle Inspector rows and privacy-safe source-link diagnostics.
- Keeps standard Grabbed, Restrained, Grapple, and monster Grab native when no unique structured source exists.
- Preserves 0.4.0 Delay, Awaiting Roll, lifecycle recovery, authority, confirmation, and Confused behavior.
- Explicitly leaves reactions and readied actions outside NelTempo turn state.

PF2e continues to own Effect and Condition mechanics. NelTempo supplies only the compatibility boundary bookkeeping that PF2e's sequential tracker cannot express under free phase activation.

This is prerelease metadata for eventual `v0.5.0-rc1`. No live Foundry/Forge runtime acceptance is claimed until the manual plan passes.
