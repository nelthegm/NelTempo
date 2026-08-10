/** Canonical current-round initiative placement selector. */

export const INITIATIVE_LANES = Object.freeze({
  VANGUARD: "vanguard",
  AWAITING: "pending",
  ENEMY: "enemy",
  REARGUARD: "rearguard",
});

function currentRoundEntry(map, state, combatantId) {
  const entry = map?.[String(combatantId)] ?? null;
  if (!entry) return null;
  return Number(entry.round ?? 1) === Number(state?.round ?? 1) ? entry : null;
}

/**
 * Returns exactly Vanguard, Awaiting/Pending, Enemy, or Rearguard.
 * Missing/stale party results are Awaiting and never inferred failures.
 */
export function selectCombatantInitiativeLane(state, combatantId, side = "party") {
  const id = String(combatantId);
  const placement = currentRoundEntry(state?.placements, state, id);
  if (Object.values(INITIATIVE_LANES).includes(placement?.phase)) return placement.phase;
  if (side === "enemy") return INITIATIVE_LANES.ENEMY;
  if (state?.delayed?.[id]) return INITIATIVE_LANES.REARGUARD;
  const result = currentRoundEntry(state?.results, state, id);
  if (result?.phase === INITIATIVE_LANES.VANGUARD) return INITIATIVE_LANES.VANGUARD;
  if (result?.phase === INITIATIVE_LANES.REARGUARD) return INITIATIVE_LANES.REARGUARD;
  return INITIATIVE_LANES.AWAITING;
}
