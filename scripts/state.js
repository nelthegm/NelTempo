export const PHASES = Object.freeze({
  INITIATIVE: "initiative",
  VANGUARD: "vanguard",
  ENEMY: "enemy",
  REARGUARD: "rearguard",
});

export const PHASE_ORDER = Object.freeze([
  PHASES.INITIATIVE,
  PHASES.VANGUARD,
  PHASES.ENEMY,
  PHASES.REARGUARD,
]);

export function nextPhase(phase) {
  const index = PHASE_ORDER.indexOf(phase);
  if (index < 0) throw new Error(`Unknown phase: ${phase}`);
  return PHASE_ORDER[(index + 1) % PHASE_ORDER.length];
}

export function createState({ round = 1, enemyDC = 10, suggestedSkill = "perception" } = {}) {
  return {
    schema: 2,
    enabled: true,
    phase: PHASES.INITIATIVE,
    round,
    enemyDC,
    suggestedSkill,
    promptId: null,
    promptOpen: false,
    initialInitiativePending: true,
    enemyPhaseSerial: 0,
    activeCombatantId: null,
    results: {},
    acted: {},
    delayed: {},
    lastSkills: {},
    shields: {},
    history: [],
  };
}

export function cloneState(state) {
  return structuredClone(state);
}

export function phaseForResult(total, dc) {
  return Number(total) >= Number(dc) ? PHASES.VANGUARD : PHASES.REARGUARD;
}

/**
 * Return only an initiative result belonging to the state's current round.
 * Results written before schema 2 did not store a round; those are treated as
 * round-1 results so stale v0.1.2 values cannot block later prompts.
 */
export function resultForCurrentRound(state, combatantId) {
  const result = state?.results?.[combatantId] ?? null;
  if (!result) return null;
  const resultRound = Number(result.round ?? 1);
  return resultRound === Number(state.round ?? 1) ? result : null;
}

export function reclassifyResults(state) {
  const next = cloneState(state);
  for (const [combatantId, result] of Object.entries(next.results ?? {})) {
    if (!resultForCurrentRound(next, combatantId)) continue;
    if (Number.isFinite(Number(result.total))) result.phase = phaseForResult(result.total, next.enemyDC);
  }
  return next;
}

export function combatantPhase(state, combatantId, side = "party") {
  if (side === "enemy") return PHASES.ENEMY;
  if (state.delayed?.[combatantId]) return PHASES.REARGUARD;
  return resultForCurrentRound(state, combatantId)?.phase ?? PHASES.REARGUARD;
}

export function stripHistory(state) {
  const copy = cloneState(state);
  copy.history = [];
  return copy;
}

export function withHistory(state, label, maxEntries = 12) {
  const next = cloneState(state);
  const history = Array.isArray(next.history) ? next.history : [];
  history.push({ label, at: Date.now(), state: stripHistory(state) });
  next.history = history.slice(-maxEntries);
  return next;
}

export function undoState(state) {
  const history = Array.isArray(state.history) ? [...state.history] : [];
  const entry = history.pop();
  if (!entry?.state) return null;
  const restored = cloneState(entry.state);
  restored.history = history;
  return { state: restored, label: entry.label };
}

export function beginRoundTransition(state) {
  const next = withHistory(state, "Begin next round");
  next.schema = 2;
  next.phase = PHASES.INITIATIVE;
  next.round = Math.max(1, Number(next.round || 1) + 1);
  next.promptId = null;
  next.promptOpen = false;
  next.initialInitiativePending = false;
  next.activeCombatantId = null;
  next.results = {};
  next.acted = {};
  next.delayed = {};
  return next;
}

export function setPhase(state, phase) {
  if (!PHASE_ORDER.includes(phase)) throw new Error(`Unknown phase: ${phase}`);
  const next = withHistory(state, `Change phase to ${phase}`);
  next.phase = phase;
  next.activeCombatantId = null;
  if (phase === PHASES.ENEMY) next.enemyPhaseSerial = Number(next.enemyPhaseSerial || 0) + 1;
  return next;
}

export function submitResult(state, combatantId, { total, skill, label = skill }) {
  const next = withHistory(state, `Record initiative for ${combatantId}`);
  next.schema = 2;
  next.results[combatantId] = {
    total: Number(total),
    skill,
    label,
    phase: phaseForResult(total, next.enemyDC),
    round: Number(next.round ?? 1),
    at: Date.now(),
  };
  next.lastSkills[combatantId] = skill;
  return next;
}

export function markActed(state, combatantId, acted = true) {
  const next = withHistory(state, `${acted ? "Complete" : "Restore"} turn for ${combatantId}`);
  if (acted) next.acted[combatantId] = true;
  else delete next.acted[combatantId];
  if (next.activeCombatantId === combatantId) next.activeCombatantId = null;
  return next;
}

export function delayToRearguard(state, combatantId) {
  const next = withHistory(state, `Delay ${combatantId} to rearguard`);
  next.delayed[combatantId] = true;
  const result = resultForCurrentRound(next, combatantId);
  if (result) result.phase = PHASES.REARGUARD;
  if (next.activeCombatantId === combatantId) next.activeCombatantId = null;
  return next;
}
