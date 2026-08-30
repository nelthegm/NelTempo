# NelTempo 0.6.0 RC1

NelTempo 0.6.0 adds informational real-world timing for combatants actively operated through NelTempo.

- Timing starts only through the canonical NelTempo claim/activation workflow.
- Phase entry, portrait token selection, reactions, Ready, and placement changes do not start timing.
- Delay closes the current timing segment without invoking End Turn. Rearguard claim resumes timing as a new activation session while preserving the same actual turn.
- Successful End Turn and administrative workflow closure finalize timing exactly once. A failed or ambiguous native End keeps timing available for review and reload reconciliation.
- Durable schema-10 timestamps survive reload; completed time is never erased by Reopen.
- The live `M:SS` timer uses one client-local ticker and never saves the Combat document every second.
- A primary-GM public combat-end card shows each safely labeled combatant’s activation count, total active time, average session time, and the encounter total.
- World tracking and client display settings are independent. Disabling tracking stops new observations and suppresses the final summary; hiding the timer affects presentation only.

Activation timing is observational only. It never invokes PF2e Start Turn or End Turn, changes phase placement or eligibility, blocks phase advancement, expires effects, or determines whether a turn is complete. No live Foundry/PF2e runtime acceptance is claimed by this local implementation.
