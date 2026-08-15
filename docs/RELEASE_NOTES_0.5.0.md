# NelTempo 0.5.0

NelTempo 0.5.0 hardens Pathfinder 2e turn-timing compatibility under NelTempo's phase-based combat model.

- PF2e remains authoritative for ordinary Start Turn and End Turn mechanics.
- Reactions do not create NelTempo turns.
- Ready and readied actions do not create or reopen NelTempo turns.
- Delay remains one actual turn across Vanguard to Rearguard: one Start, no End on Delay, no second Start on resume, and one eventual End.
- Audited PF2e Effect duration, Grapple, Grabbed, Restrained, monster Grab, Escape, reactions, Ready, and round-transition behavior.
- Standard Grapple, Grabbed, Restrained, and monster Grab source relationships remain native because no unique structured source relationship was proven.
- Adds compatibility handling only for uniquely structured finite Effects whose duration requires source-turn context.
- Supports proven `source-start` and `source-end` expiration boundaries for nonnegative integer-round Effects.
- Unrelated NelTempo phase changes cannot prematurely expire these Effects.
- Reload preserves pending timing and does not replay completed expiration.
- Uncertain in-flight timing fails conservatively to Review rather than guessing.
- Primary-GM serialization prevents duplicate timing mutations.
- Lifecycle Inspector and debug diagnostics expose concise privacy-safe timing information.

PF2e continues to own generic Effect and Condition expiration. NelTempo supplies only the compatibility boundary bookkeeping that PF2e's sequential tracker cannot express under free phase activation. This direct stable promotion follows automated validation; no live Foundry/Forge runtime acceptance is claimed.
