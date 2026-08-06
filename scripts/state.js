import { normalizeLifecycle, interruptUncertainProcessing } from "./lifecycle.js";
import {
  PLACEMENTS,
  consumeQueuedCorrections,
  normalizePlacementAudit,
  normalizePlacementCorrections,
  normalizePlacements,
  placementForCurrentRound,
} from "./placement-editor.js";
import { sanitizeCountdown } from "./countdown.js";

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

/** Map keys whose entries are keyed by combatant id. */
export const COMBATANT_STATE_MAPS = Object.freeze([
  "results",
  "acted",
  "delayed",
  "lastSkills",
  "placements",
  "placementCorrections",
]);

const SCHEMA_VERSION = 6;

export function nextPhase(phase) {
  const index = PHASE_ORDER.indexOf(phase);
  if (index < 0) throw new Error(`Unknown phase: ${phase}`);
  return PHASE_ORDER[(index + 1) % PHASE_ORDER.length];
}

export function createState({ round = 1, enemyDC = 10, suggestedSkill = "perception" } = {}) {
  return {
    schema: SCHEMA_VERSION,
    revision: 0,
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
    /** Active phase lifecycle record, or null during Initiative / idle. */
    lifecycle: null,
    /** Current-round GM placement overrides keyed by combatant id. */
    placements: {},
    /** Next-round placement correction queue keyed by combatant id. */
    placementCorrections: {},
    /** Capped placement audit trail. */
    placementAudit: [],
    /** Optional public encounter countdown (schema 5). */
    countdown: null,
    /**
     * One-shot GM notice after upgrading an active combat to 0.3.5 turn timing.
     * When true, show migration dialog; cleared by ACK_LIFECYCLE_MIGRATION.
     */
    lifecycleMigrationNotice: false,
    history: [],
  };
}

export function cloneState(state) {
  return structuredClone(state);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSerializablePrimitive(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

/**
 * Recursively produce a plain JSON-serializable value.
 * Drops functions, symbols, undefined, and non-plain class instances.
 */
export function toSerializable(value, depth = 0) {
  if (depth > 32) return null;
  if (value === undefined) return undefined;
  if (isSerializablePrimitive(value)) {
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => toSerializable(entry, depth + 1))
      .filter((entry) => entry !== undefined);
  }
  if (!isPlainObject(value)) return undefined;

  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof key !== "string" || key.startsWith("-=") || key.startsWith("==")) continue;
    const cleaned = toSerializable(entry, depth + 1);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

function sanitizeResult(result) {
  if (!isPlainObject(result)) return null;
  const totalRaw = result.total;
  const total =
    totalRaw === null || totalRaw === undefined
      ? null
      : Number.isFinite(Number(totalRaw))
        ? Number(totalRaw)
        : null;
  const phase =
    result.phase == null || result.phase === ""
      ? null
      : PHASE_ORDER.includes(result.phase)
        ? result.phase
        : PHASES.REARGUARD;
  const cleaned = {
    total,
    skill: result.skill == null ? null : String(result.skill),
    label: result.label == null ? null : String(result.label),
    round: Math.max(1, Number(result.round ?? 1) || 1),
    at: Number.isFinite(Number(result.at)) ? Number(result.at) : Date.now(),
  };
  if (phase) cleaned.phase = phase;
  if (result.forced) cleaned.forced = true;
  return cleaned;
}

function sanitizeShieldEntry(entry) {
  if (!isPlainObject(entry)) return null;
  return toSerializable({
    itemUuid: entry.itemUuid == null ? null : String(entry.itemUuid),
    actorUuid: entry.actorUuid == null ? null : String(entry.actorUuid),
    combatantId: entry.combatantId == null ? null : String(entry.combatantId),
    expireEnemySerial: Math.max(0, Number(entry.expireEnemySerial || 0) || 0),
    expireOnCombatantStart: entry.expireOnCombatantStart !== false,
    defenseKind: entry.defenseKind == null ? null : String(entry.defenseKind).slice(0, 40),
    createdPhase: entry.createdPhase == null ? null : String(entry.createdPhase),
    createdAt: Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : Date.now(),
    discoveredAtEnemyEnd: entry.discoveredAtEnemyEnd ? true : undefined,
    discoveredAtStart: entry.discoveredAtStart ? true : undefined,
  });
}

/**
 * Count combatant-map keys present in source but omitted from normalized output.
 */
export function countPrunedCombatantEntries(source, normalized) {
  let removed = 0;
  for (const key of COMBATANT_STATE_MAPS) {
    const before = Object.keys(source?.[key] ?? {});
    const after = new Set(Object.keys(normalized?.[key] ?? {}));
    for (const id of before) {
      if (!after.has(id)) removed += 1;
    }
  }
  return removed;
}

/**
 * Build a new plain, serializable Dynamic Initiative state object.
 * Does not mutate the input. Optionally prunes combatant-keyed maps to
 * the provided combatant id set (exact combatant document ids).
 */
export function normalizeState(state, { combatantIds = null, includeHistory = true } = {}) {
  if (!isPlainObject(state)) {
    throw new Error("Invalid Dynamic Initiative state.");
  }

  // Clone first so callers can keep their original reference unchanged.
  const source = cloneState(state);
  const idSet = combatantIds == null ? null : new Set([...combatantIds].map(String));

  const phase = PHASE_ORDER.includes(source.phase) ? source.phase : PHASES.INITIATIVE;
  const next = {
    schema: Math.max(SCHEMA_VERSION, Number(source.schema ?? SCHEMA_VERSION) || SCHEMA_VERSION),
    revision: Math.max(0, Number(source.revision ?? 0) || 0),
    enabled: Boolean(source.enabled),
    phase,
    round: Math.max(1, Number(source.round || 1) || 1),
    enemyDC: Math.max(0, Math.min(99, Number(source.enemyDC ?? 10) || 0)),
    suggestedSkill: String(source.suggestedSkill ?? "perception"),
    promptId: source.promptId == null || source.promptId === "" ? null : String(source.promptId),
    promptOpen: Boolean(source.promptOpen),
    initialInitiativePending: Boolean(source.initialInitiativePending),
    enemyPhaseSerial: Math.max(0, Number(source.enemyPhaseSerial || 0) || 0),
    activeCombatantId:
      source.activeCombatantId == null || source.activeCombatantId === ""
        ? null
        : String(source.activeCombatantId),
    results: {},
    acted: {},
    delayed: {},
    lastSkills: {},
    shields: {},
    lifecycle: null,
    placements: {},
    placementCorrections: {},
    placementAudit: [],
    countdown: null,
    lifecycleMigrationNotice: false,
    history: [],
  };

  const priorSchema = Number(source.schema ?? 0) || 0;

  for (const [combatantId, result] of Object.entries(source.results ?? {})) {
    if (idSet && !idSet.has(String(combatantId))) continue;
    const cleaned = sanitizeResult(result);
    if (cleaned) next.results[String(combatantId)] = cleaned;
  }

  for (const [combatantId, acted] of Object.entries(source.acted ?? {})) {
    if (idSet && !idSet.has(String(combatantId))) continue;
    if (acted) next.acted[String(combatantId)] = true;
  }

  for (const [combatantId, delayed] of Object.entries(source.delayed ?? {})) {
    if (idSet && !idSet.has(String(combatantId))) continue;
    if (delayed) next.delayed[String(combatantId)] = true;
  }

  for (const [combatantId, skill] of Object.entries(source.lastSkills ?? {})) {
    if (idSet && !idSet.has(String(combatantId))) continue;
    if (skill == null || skill === "") continue;
    next.lastSkills[String(combatantId)] = String(skill);
  }

  if (idSet && next.activeCombatantId && !idSet.has(next.activeCombatantId)) {
    next.activeCombatantId = null;
  }

  for (const [uuid, entry] of Object.entries(source.shields ?? {})) {
    const cleaned = sanitizeShieldEntry(entry);
    if (!cleaned) continue;
    if (idSet && cleaned.combatantId && !idSet.has(String(cleaned.combatantId))) continue;
    next.shields[String(uuid)] = cleaned;
  }

  next.placements = normalizePlacements(source.placements, {
    combatantIds: idSet,
    round: next.round,
  });
  next.placementCorrections = normalizePlacementCorrections(source.placementCorrections, {
    combatantIds: idSet,
  });
  next.placementAudit = normalizePlacementAudit(source.placementAudit);
  next.countdown = sanitizeCountdown(source.countdown);

  // Lifecycle: normalize and prune roster against current combatants.
  // Never invent a lifecycle for Initiative; preserve open/ending instances.
  if (source.lifecycle != null) {
    let lifecycle = normalizeLifecycle(source.lifecycle, { combatantIds: idSet });
    // Convert uncertain Processing entries after reload when flag is set by caller.
    if (lifecycle && source._interruptLifecycleProcessing) {
      lifecycle = interruptUncertainProcessing(lifecycle);
    }
    // Mid-combat upgrade from pre-0.3.5: do not retroactively process effects.
    // Mark uncertain start/end processing as interrupted (Review); leave completed intact.
    if (lifecycle && priorSchema > 0 && priorSchema < 6 && source.enabled) {
      lifecycle = interruptUncertainProcessing(lifecycle);
      next.lifecycleMigrationNotice = true;
    }
    next.lifecycle = lifecycle;
  } else {
    next.lifecycle = null;
  }

  if (source.lifecycleMigrationNotice) next.lifecycleMigrationNotice = true;

  if (includeHistory && Array.isArray(source.history)) {
    next.history = source.history
      .map((entry) => {
        if (!isPlainObject(entry) || !isPlainObject(entry.state)) return null;
        const snapshot = normalizeState(entry.state, { combatantIds, includeHistory: false });
        snapshot.history = [];
        return {
          label: String(entry.label ?? "Undo"),
          at: Number.isFinite(Number(entry.at)) ? Number(entry.at) : Date.now(),
          state: snapshot,
        };
      })
      .filter(Boolean)
      .slice(-12);
  }

  return toSerializable(next);
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
  const placement = placementForCurrentRound(state, combatantId);
  if (placement?.phase === PLACEMENTS.PENDING) return PLACEMENTS.PENDING;
  if (placement?.phase) return placement.phase;
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

/**
 * Restore an undo snapshot, then prune combatant keys that no longer exist.
 * Does not invent results for newly added combatants.
 */
export function normalizeUndoRestore(state, combatantIds) {
  return normalizeState(state, { combatantIds, includeHistory: true });
}

export function beginRoundTransition(state) {
  const next = withHistory(state, "Begin next round");
  next.schema = SCHEMA_VERSION;
  next.phase = PHASES.INITIATIVE;
  next.round = Math.max(1, Number(next.round || 1) + 1);
  next.promptId = null;
  next.promptOpen = false;
  next.initialInitiativePending = false;
  next.activeCombatantId = null;
  next.results = {};
  next.acted = {};
  next.delayed = {};
  next.lifecycle = null;
  next.placements = {};
  // Preserve queue across the clear, then consume entries for the new round.
  next.placementCorrections = structuredClone(state.placementCorrections ?? {});
  // Countdown is round-derived; preserve the structured record across rounds.
  next.countdown = sanitizeCountdown(state.countdown);
  return consumeQueuedCorrections(next);
}

export function setPhase(state, phase) {
  if (!PHASE_ORDER.includes(phase)) throw new Error(`Unknown phase: ${phase}`);
  const next = withHistory(state, `Change phase to ${phase}`);
  next.phase = phase;
  next.activeCombatantId = null;
  if (phase === PHASES.ENEMY) next.enemyPhaseSerial = Number(next.enemyPhaseSerial || 0) + 1;
  // Lifecycle is attached by the controller transition transaction.
  // Clear when entering Initiative so stale instances cannot linger.
  if (phase === PHASES.INITIATIVE) next.lifecycle = null;
  return next;
}

export function submitResult(state, combatantId, { total, skill, label = skill }) {
  const next = withHistory(state, `Record initiative for ${combatantId}`);
  next.schema = SCHEMA_VERSION;
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
