/**
 * Pure condition-timing state helpers for NelTempo.
 * No Foundry/PF2e document access; safe for unit tests.
 * Timing lives under lifecycle.timing and is normalized with lifecycle.
 */

import { CONDITION_SLUGS } from "./pf2e-condition-adapter.js";

/** Local mirror of LIFECYCLE_STATUS.OPEN — avoid circular import with lifecycle.js */
const OPEN = "open";

function turnFinished(lifecycle, combatantId) {
  const turn = lifecycle?.turns?.[String(combatantId)];
  return Boolean(turn?.ended || turn?.skipped);
}

export const TIMING_OVERRIDE = Object.freeze({
  ALLOW_DELAY_ONCE: "allow-delay-once",
  RESUME_CURRENT_ONCE: "resume-current-once",
  SKIP_PRIORITY: "skip-priority",
  RESOLVE_PRIORITY: "resolve-priority",
  REOPEN_CONFUSED: "reopen-confused",
  MOVE_REARGUARD: "move-rearguard",
});

export const DELAY_BLOCK = Object.freeze({
  CONFUSED: "confused",
  RESTRAINED: "restrained",
  GRABBED: "grabbed",
});

/** Display priority when multiple delay blocks apply. */
export const DELAY_BLOCK_PRIORITY = Object.freeze([
  DELAY_BLOCK.CONFUSED,
  DELAY_BLOCK.RESTRAINED,
  DELAY_BLOCK.GRABBED,
]);

const MAX_AUDIT = 40;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function now() {
  return Date.now();
}

export function emptyCombatantTiming(at = now()) {
  return {
    grabbed: false,
    restrained: false,
    confused: false,
    delayBlocked: false,
    delayBlockReason: null,
    priorityRequired: false,
    priorityResolved: false,
    detectedAt: at,
    lastCheckedAt: at,
    gmOverride: null,
  };
}

export function emptyPriorityGate() {
  return {
    active: false,
    condition: CONDITION_SLUGS.CONFUSED,
    unresolvedCombatantIds: [],
    completedCombatantIds: [],
  };
}

export function createTiming({ phaseInstanceId, revision = 0 } = {}) {
  return {
    phaseInstanceId: phaseInstanceId == null ? null : String(phaseInstanceId),
    revision: Math.max(0, Number(revision || 0) || 0),
    priorityGate: emptyPriorityGate(),
    combatants: {},
    audit: [],
  };
}

function sanitizeOverride(entry) {
  if (!isPlainObject(entry)) return null;
  const type = Object.values(TIMING_OVERRIDE).includes(entry.type) ? entry.type : null;
  if (!type) return null;
  return {
    type,
    grantedBy: entry.grantedBy == null || entry.grantedBy === "" ? null : String(entry.grantedBy),
    grantedAt: Number.isFinite(Number(entry.grantedAt)) ? Number(entry.grantedAt) : null,
    consumed: Boolean(entry.consumed),
    consumedAt: Number.isFinite(Number(entry.consumedAt)) ? Number(entry.consumedAt) : null,
  };
}

function sanitizeCombatantTiming(entry, at = now()) {
  if (!isPlainObject(entry)) return emptyCombatantTiming(at);
  const reason = DELAY_BLOCK_PRIORITY.includes(entry.delayBlockReason)
    ? entry.delayBlockReason
    : null;
  return {
    grabbed: Boolean(entry.grabbed),
    restrained: Boolean(entry.restrained),
    confused: Boolean(entry.confused),
    delayBlocked: Boolean(entry.delayBlocked),
    delayBlockReason: reason,
    priorityRequired: Boolean(entry.priorityRequired),
    priorityResolved: Boolean(entry.priorityResolved),
    detectedAt: Number.isFinite(Number(entry.detectedAt)) ? Number(entry.detectedAt) : at,
    lastCheckedAt: Number.isFinite(Number(entry.lastCheckedAt)) ? Number(entry.lastCheckedAt) : at,
    gmOverride: sanitizeOverride(entry.gmOverride),
  };
}

function sanitizeAuditEntry(entry) {
  if (!isPlainObject(entry)) return null;
  const out = {
    event: entry.event == null ? "timing-event" : String(entry.event).slice(0, 80),
    at: Number.isFinite(Number(entry.at)) ? Number(entry.at) : now(),
  };
  for (const key of [
    "combatantId",
    "phase",
    "round",
    "phaseInstanceId",
    "condition",
    "restriction",
    "overrideType",
    "userId",
    "revision",
    "reason",
  ]) {
    if (entry[key] == null || entry[key] === "") continue;
    out[key] = String(entry[key]).slice(0, 120);
  }
  return out;
}

/**
 * Primary delay-block reason from structured condition flags.
 * Priority: Confused > Restrained > Grabbed.
 */
export function delayBlockReasonFromConditions(conditions = {}) {
  if (conditions.confused) return DELAY_BLOCK.CONFUSED;
  if (conditions.restrained) return DELAY_BLOCK.RESTRAINED;
  if (conditions.grabbed) return DELAY_BLOCK.GRABBED;
  return null;
}

export function applyConditionFlags(record, conditions, { at = now() } = {}) {
  const next = { ...record };
  next.grabbed = Boolean(conditions?.grabbed);
  next.restrained = Boolean(conditions?.restrained);
  next.confused = Boolean(conditions?.confused);
  next.delayBlockReason = delayBlockReasonFromConditions(next);
  next.delayBlocked = Boolean(next.delayBlockReason);
  next.priorityRequired = Boolean(next.confused && !next.priorityResolved);
  next.lastCheckedAt = at;
  if (!next.detectedAt) next.detectedAt = at;
  return next;
}

/**
 * Deterministic Confused priority order:
 * 1. Existing roster order
 * 2. combatant id as final tie-breaker (roster already id-stable)
 */
export function buildConfusedPriorityOrder(roster, combatants, turns = {}) {
  const ids = [];
  const seen = new Set();
  for (const id of roster ?? []) {
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    const record = combatants?.[key];
    if (!record?.confused) continue;
    if (record.priorityResolved) continue;
    const turn = turns?.[key];
    if (turn?.ended || turn?.skipped) continue;
    // Skip-priority override: not required in gate
    if (record.gmOverride?.type === TIMING_OVERRIDE.SKIP_PRIORITY && !record.gmOverride.consumed) {
      continue;
    }
    ids.push(key);
  }
  return ids;
}

export function recomputePriorityGate(timing, lifecycle) {
  const next = clone(timing);
  const roster = lifecycle?.roster ?? [];
  const turns = lifecycle?.turns ?? {};
  const unresolved = buildConfusedPriorityOrder(roster, next.combatants, turns);
  const completed = [];
  for (const id of roster) {
    const key = String(id);
    const record = next.combatants?.[key];
    if (!record?.confused) continue;
    if (record.priorityResolved || turns?.[key]?.ended || turns?.[key]?.skipped) {
      if (!completed.includes(key)) completed.push(key);
    }
  }
  next.priorityGate = {
    active: unresolved.length > 0,
    condition: CONDITION_SLUGS.CONFUSED,
    unresolvedCombatantIds: unresolved,
    completedCombatantIds: completed,
  };
  // Sync priorityRequired flags
  for (const id of Object.keys(next.combatants ?? {})) {
    const record = next.combatants[id];
    record.priorityRequired = Boolean(
      record.confused && !record.priorityResolved && unresolved.includes(id),
    );
  }
  return next;
}

export function pushTimingAudit(timing, event, details = {}) {
  const next = clone(timing);
  const entry = sanitizeAuditEntry({ event, at: now(), ...details });
  if (!entry) return next;
  next.audit = [...(next.audit ?? []), entry].slice(-MAX_AUDIT);
  next.revision = Math.max(0, Number(next.revision || 0) || 0) + 1;
  return next;
}

/**
 * Normalize timing for persistence. Prunes stale combatants. Drops timing when
 * phaseInstanceId does not match the active lifecycle instance.
 */
export function normalizeTiming(timing, { combatantIds = null, phaseInstanceId = null } = {}) {
  if (timing == null) return null;
  if (!isPlainObject(timing)) return null;

  const expectedPhase = phaseInstanceId == null ? null : String(phaseInstanceId);
  const storedPhase =
    timing.phaseInstanceId == null || timing.phaseInstanceId === ""
      ? null
      : String(timing.phaseInstanceId);

  // Do not reuse timing decisions across unrelated phase instances.
  if (expectedPhase && storedPhase && expectedPhase !== storedPhase) {
    return createTiming({ phaseInstanceId: expectedPhase, revision: 0 });
  }

  const idSet = combatantIds == null ? null : new Set([...combatantIds].map(String));
  const combatants = {};
  for (const [id, entry] of Object.entries(timing.combatants ?? {})) {
    const key = String(id);
    if (idSet && !idSet.has(key)) continue;
    combatants[key] = sanitizeCombatantTiming(entry);
  }

  const unresolved = Array.isArray(timing.priorityGate?.unresolvedCombatantIds)
    ? timing.priorityGate.unresolvedCombatantIds.map(String).filter((id) => !idSet || idSet.has(id))
    : [];
  const completed = Array.isArray(timing.priorityGate?.completedCombatantIds)
    ? timing.priorityGate.completedCombatantIds.map(String).filter((id) => !idSet || idSet.has(id))
    : [];

  const audit = Array.isArray(timing.audit)
    ? timing.audit.map(sanitizeAuditEntry).filter(Boolean).slice(-MAX_AUDIT)
    : [];

  return {
    phaseInstanceId: storedPhase || expectedPhase,
    revision: Math.max(0, Number(timing.revision || 0) || 0),
    priorityGate: {
      active: Boolean(timing.priorityGate?.active) && unresolved.length > 0,
      condition: CONDITION_SLUGS.CONFUSED,
      unresolvedCombatantIds: unresolved,
      completedCombatantIds: completed,
    },
    combatants,
    audit,
  };
}

/**
 * Ensure lifecycle.timing exists and matches the current phase instance.
 */
export function ensureTiming(lifecycle) {
  if (!lifecycle) return null;
  const phaseInstanceId = lifecycle.phaseInstanceId ?? null;
  if (!lifecycle.timing || lifecycle.timing.phaseInstanceId !== phaseInstanceId) {
    return createTiming({ phaseInstanceId });
  }
  return normalizeTiming(lifecycle.timing, {
    phaseInstanceId,
    combatantIds: lifecycle.roster,
  });
}

/**
 * Update one combatant's live condition snapshot into timing state.
 * Does not mark Ended. Does not replay lifecycle.
 */
export function upsertCombatantConditions(timing, combatantId, conditions, { at = now(), ended = false } = {}) {
  const next = clone(timing);
  const id = String(combatantId);
  const prior = next.combatants[id] ? { ...next.combatants[id] } : emptyCombatantTiming(at);
  const wasConfused = Boolean(prior.confused);
  let record = applyConditionFlags(prior, conditions, { at });

  // Confused added after End Turn: record flags but do not insert into priority.
  if (ended) {
    record.priorityRequired = false;
    // Keep priorityResolved if already ended while confused, else leave false.
  } else if (record.confused && !wasConfused) {
    record.priorityResolved = false;
  } else if (!record.confused && wasConfused && !ended) {
    record.priorityResolved = false;
    record.priorityRequired = false;
  }

  next.combatants[id] = record;
  return next;
}

export function markPriorityResolved(timing, combatantId, { at = now() } = {}) {
  const next = clone(timing);
  const id = String(combatantId);
  next.combatants[id] ??= emptyCombatantTiming(at);
  next.combatants[id].priorityResolved = true;
  next.combatants[id].priorityRequired = false;
  next.combatants[id].lastCheckedAt = at;
  return next;
}

/**
 * Whether voluntary Delay is permitted under timing rules.
 * @returns {{ allowed: boolean, reason: string|null, blockReason: string|null, overrideType: string|null }}
 */
export function evaluateDelayEligibility(lifecycle, combatantId, { enforce = true } = {}) {
  if (!enforce) {
    return { allowed: true, reason: null, blockReason: null, overrideType: null };
  }
  if (!lifecycle || lifecycle.status !== OPEN) {
    return { allowed: false, reason: "lifecycle-not-open", blockReason: null, overrideType: null };
  }
  const id = String(combatantId);
  const timing = lifecycle.timing;
  if (!timing) {
    return { allowed: true, reason: null, blockReason: null, overrideType: null };
  }
  const record = timing.combatants?.[id];
  if (!record?.delayBlocked) {
    return { allowed: true, reason: null, blockReason: null, overrideType: null };
  }

  const override = record.gmOverride;
  if (
    override &&
    !override.consumed &&
    (override.type === TIMING_OVERRIDE.ALLOW_DELAY_ONCE ||
      override.type === TIMING_OVERRIDE.MOVE_REARGUARD)
  ) {
    return {
      allowed: true,
      reason: null,
      blockReason: record.delayBlockReason,
      overrideType: override.type,
    };
  }

  return {
    allowed: false,
    reason:
      record.delayBlockReason === DELAY_BLOCK.CONFUSED
        ? "delay-blocked-confused"
        : record.delayBlockReason === DELAY_BLOCK.RESTRAINED
          ? "delay-blocked-restrained"
          : "delay-blocked-grabbed",
    blockReason: record.delayBlockReason,
    overrideType: null,
  };
}

/**
 * Whether End Turn is permitted under the Confused priority gate.
 */
export function evaluateEndTurnEligibility(lifecycle, combatantId, { enforce = true } = {}) {
  if (!enforce) {
    return { allowed: true, reason: null };
  }
  if (!lifecycle || lifecycle.status !== OPEN) {
    return { allowed: false, reason: "lifecycle-not-open" };
  }
  const id = String(combatantId);
  if (!lifecycle.roster?.includes(id)) {
    return { allowed: false, reason: "not-in-roster" };
  }
  if (turnFinished(lifecycle, id)) {
    return { allowed: false, reason: "already-ended" };
  }

  const timing = lifecycle.timing;
  const gate = timing?.priorityGate;
  if (!gate?.active) {
    return { allowed: true, reason: null };
  }

  const record = timing.combatants?.[id];
  // Resume Current Actor Once: allow this combatant even if not priority.
  if (
    record?.gmOverride &&
    !record.gmOverride.consumed &&
    record.gmOverride.type === TIMING_OVERRIDE.RESUME_CURRENT_ONCE
  ) {
    return { allowed: true, reason: null, overrideType: TIMING_OVERRIDE.RESUME_CURRENT_ONCE };
  }

  const unresolved = gate.unresolvedCombatantIds ?? [];
  if (unresolved.length === 0) {
    return { allowed: true, reason: null };
  }

  const currentPriority = unresolved[0];
  if (id === currentPriority) {
    return { allowed: true, reason: null };
  }

  if (record?.confused && unresolved.includes(id)) {
    return { allowed: false, reason: "waiting-for-priority-combatant" };
  }
  return { allowed: false, reason: "waiting-for-confused" };
}

/**
 * Player reopen of a Confused (or previously confused-resolved) turn is blocked.
 * GM may override separately.
 */
export function evaluateReopenEligibility(lifecycle, combatantId, { isGM = false, enforce = true } = {}) {
  if (!enforce) {
    return { allowed: true, reason: null };
  }
  const id = String(combatantId);
  const timing = lifecycle?.timing;
  const record = timing?.combatants?.[id];
  const wasConfusedPriority =
    Boolean(record?.confused) ||
    Boolean(record?.priorityResolved) ||
    (timing?.priorityGate?.completedCombatantIds ?? []).includes(id);

  if (!wasConfusedPriority) {
    return { allowed: true, reason: null };
  }

  if (!isGM) {
    return { allowed: false, reason: "confused-reopen-rejected" };
  }

  // GM still needs explicit reopen-confused override confirmation (handled by controller).
  return { allowed: true, reason: null, requiresOverride: true };
}

export function grantTimingOverride(timing, combatantId, type, { grantedBy = null, at = now() } = {}) {
  const next = clone(timing);
  const id = String(combatantId);
  next.combatants[id] ??= emptyCombatantTiming(at);
  next.combatants[id].gmOverride = {
    type,
    grantedBy: grantedBy == null ? null : String(grantedBy),
    grantedAt: at,
    consumed: false,
    consumedAt: null,
  };
  return next;
}

export function consumeTimingOverride(timing, combatantId, expectedType = null, { at = now() } = {}) {
  const next = clone(timing);
  const id = String(combatantId);
  const override = next.combatants?.[id]?.gmOverride;
  if (!override || override.consumed) {
    return { timing: next, consumed: false, reason: "no-override" };
  }
  if (expectedType && override.type !== expectedType) {
    return { timing: next, consumed: false, reason: "override-type-mismatch" };
  }
  override.consumed = true;
  override.consumedAt = at;
  return { timing: next, consumed: true, reason: null, overrideType: override.type };
}

export function clearTimingOverride(timing, combatantId) {
  const next = clone(timing);
  const id = String(combatantId);
  if (!next.combatants?.[id]) return next;
  next.combatants[id].gmOverride = null;
  return next;
}

/**
 * After a successful End Turn, advance Confused priority bookkeeping.
 */
export function onTurnEndedTiming(timing, lifecycle, combatantId) {
  let next = clone(timing);
  const id = String(combatantId);
  const record = next.combatants?.[id];
  if (record?.confused || next.priorityGate?.unresolvedCombatantIds?.includes(id)) {
    next = markPriorityResolved(next, id);
  }
  // Consume resume-once if it was used for this End Turn.
  if (
    record?.gmOverride &&
    !record.gmOverride.consumed &&
    record.gmOverride.type === TIMING_OVERRIDE.RESUME_CURRENT_ONCE
  ) {
    const consumed = consumeTimingOverride(next, id, TIMING_OVERRIDE.RESUME_CURRENT_ONCE);
    next = consumed.timing;
  }
  next = recomputePriorityGate(next, {
    ...lifecycle,
    turns: {
      ...(lifecycle?.turns ?? {}),
      [id]: { ...(lifecycle?.turns?.[id] ?? {}), ended: true },
    },
  });
  return next;
}

/**
 * After reopen, clear priorityResolved so Confused returns to the gate.
 */
export function onTurnReopenedTiming(timing, lifecycle, combatantId) {
  let next = clone(timing);
  const id = String(combatantId);
  next.combatants[id] ??= emptyCombatantTiming();
  if (next.combatants[id].confused) {
    next.combatants[id].priorityResolved = false;
  }
  next = recomputePriorityGate(next, {
    ...lifecycle,
    turns: {
      ...(lifecycle?.turns ?? {}),
      [id]: { ...(lifecycle?.turns?.[id] ?? {}), ended: false, skipped: false },
    },
  });
  return next;
}

/**
 * UI helper: badge key for a combatant under current timing.
 * Returns localization key suffix or null.
 */
export function timingBadgeFor(lifecycle, combatantId, { enforce = true } = {}) {
  if (!enforce || !lifecycle?.timing) return null;
  if (lifecycle.status !== OPEN) return null;
  const id = String(combatantId);
  const timing = lifecycle.timing;
  const record = timing.combatants?.[id];
  if (!record) return null;

  if (record.gmOverride && !record.gmOverride.consumed) {
    if (record.gmOverride.type === TIMING_OVERRIDE.RESUME_CURRENT_ONCE) {
      return "resume-allowed";
    }
    if (record.gmOverride.type === TIMING_OVERRIDE.ALLOW_DELAY_ONCE) {
      return "gm-override";
    }
  }

  if (turnFinished(lifecycle, id)) return null;

  const gate = timing.priorityGate;
  if (gate?.active) {
    const unresolved = gate.unresolvedCombatantIds ?? [];
    if (unresolved[0] === id) return "must-act-first";
    if (unresolved.includes(id)) return "waiting-confused";
    if (!record.confused) return "waiting-confused";
  }

  if (record.delayBlocked) {
    if (record.delayBlockReason === DELAY_BLOCK.CONFUSED) return "delay-blocked-confused";
    if (record.delayBlockReason === DELAY_BLOCK.RESTRAINED) return "delay-blocked-restrained";
    if (record.delayBlockReason === DELAY_BLOCK.GRABBED) return "delay-blocked-grabbed";
  }
  return null;
}

export function timingEnabledSetting(getSetting) {
  try {
    const value = getSetting();
    return value !== false;
  } catch (_error) {
    return true;
  }
}
