# NelTempo 0.5.0 RC1

NelTempo 0.5.0 hardens compatibility with PF2e's native turn-timing mechanics. It verifies and repairs only proven gaps caused by phase-based combat. Reactions and readied actions remain native PF2e activity and never create NelTempo turns.

- Adds conservative structured source-start/source-end Effect compatibility tied to the existing actual-turn lifecycle.
- Reconciles native removal, reload, combatant removal/defeat, and combat end without guessing PF2e rules.
- Reactions and readied actions remain PF2e-native no-ops for NelTempo state.
- Preserves stable 0.4.0 Delay, recovery, Awaiting Roll, authority, and Confused behavior.

This is local prerelease preparation for eventual `v0.5.0-rc1`; live Foundry/Forge acceptance is still required.
