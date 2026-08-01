/**
 * Pure GM initiative / phase placement helpers for NelTempo 0.3.0.
 * No Foundry document access; safe for unit tests.
 * Intentionally avoids importing state.js (combatantPhase lives there) to prevent cycles.
 */

import {
  BOUNDARY_STATUS,
  LIFECYCLE_STATUS,
  emptyTurnRecord,
  isTurnFinished,
  lifecycleProgress,
} from "./lifecycle.js";

export const PHASES = Object.freeze({
  INITIATIVE: "initiative",
  VANGUARD: "vanguard",
  ENEMY: "enemy",
  REARGUARD: "rearguard",
});

const PHASE_ORDER = Object.freeze([
  PHASES.INITIATIVE,
  PHASES.VANGUARD,
  PHASES.ENEMY,
  PHASES.REARGUARD,
]);

function cloneState(state) {
  return structuredClone(state);
}

function resultForCurrentRound(state, combatantId) {
  const result = state?.results?.[combatantId] ?? null;
  if (!result) return null;
  const resultRound = Number(result.round ?? 1);
  return resultRound === Number(state.round ?? 1) ? result : null;
}
export const PLACEMENTS = Object.freeze({
  VANGUARD: "vanguard",
  ENEMY: "enemy",
  REARGUARD: "rearguard",
  PENDING: "pending",
});

export const PLACEMENT_MODES = Object.freeze({
  CURRENT_ROUND: "current-round",
  NEXT_ROUND: "next-round",
});

export const PLACEMENT_METHODS = Object.freeze({
  GM_CURRENT: "gm-current-round",
  GM_NEXT: "gm-next-round",
  GM_PENDING_RESET: "gm-pending-reset",
});

export const CORRECTION_STATUS = Object.freeze({
  QUEUED: "queued",
  APPLYING: "applying",
  APPLIED: "applied",
  CANCELLED: "cancelled",
  FAILED: "failed",
});

const MAX_AUDIT = 40;
const MAX_HISTORY = 24;

const OPEN_ONLY = new Set([LIFECYCLE_STATUS.OPEN, LIFECYCLE_STATUS.COMPLETE]);
const BLOCKED_LIFECYCLE = new Set([
  LIFECYCLE_STATUS.PREPARING,
  LIFECYCLE_STATUS.STARTING,
  LIFECYCLE_STATUS.ENDING,
  LIFECYCLE_STATUS.INTERRUPTED,
  LIFECYCLE_STATUS.ERROR,
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isPlacementPhase(phase) {
  return Object.values(PLACEMENTS).includes(phase);
}

export function emptyPlacementRecord(round, at = Date.now()) {
  return {
    phase: PLACEMENTS.PENDING,
    round: Math.max(1, Number(round || 1) || 1),
    originalPhase: null,
    method: null,
    appliedBy: null,
    appliedAt: at,
  };
}

export function sanitizePlacementRecord(entry, fallbackRound = 1) {
  if (!isPlainObject(entry)) return null;
  const phase = isPlacementPhase(entry.phase) ? entry.phase : null;
  if (!phase) return null;
  return {
    phase,
    round: Math.max(1, Number(entry.round ?? fallbackRound) || 1),
    originalPhase: entry.originalPhase == null ? null : String(entry.originalPhase).slice(0, 40),
    method: Object.values(PLACEMENT_METHODS).includes(entry.method) ? entry.method : null,
    appliedBy: entry.appliedBy == null || entry.appliedBy === "" ? null : String(entry.appliedBy),
    appliedAt: Number.isFinite(Number(entry.appliedAt)) ? Number(entry.appliedAt) : null,
  };
}

export function sanitizeCorrectionEntry(entry) {
  if (!isPlainObject(entry)) return null;
  const targetPhase = isPlacementPhase(entry.targetPhase) ? entry.targetPhase : null;
  if (!targetPhase) return null;
  const status = Object.values(CORRECTION_STATUS).includes(entry.status)
    ? entry.status
    : CORRECTION_STATUS.QUEUED;
  return {
    targetPhase,
    effectiveRound: Math.max(1, Number(entry.effectiveRound || 1) || 1),
    status,
    createdBy: entry.createdBy == null || entry.createdBy === "" ? null : String(entry.createdBy),
    createdAt: Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : Date.now(),
    consumedAt: Number.isFinite(Number(entry.consumedAt)) ? Number(entry.consumedAt) : null,
    cancelledAt: Number.isFinite(Number(entry.cancelledAt)) ? Number(entry.cancelledAt) : null,
    revision: Math.max(0, Number(entry.revision || 0) || 0),
  };
}

function sanitizeAuditEntry(entry) {
  if (!isPlainObject(entry)) return null;
  const out = {
    event: entry.event == null ? "placement-event" : String(entry.event).slice(0, 80),
    at: Number.isFinite(Number(entry.at)) ? Number(entry.at) : Date.now(),
  };
  for (const key of [
    "combatantId",
    "sourcePhase",
    "targetPhase",
    "mode",
    "round",
    "effectiveRound",
    "revision",
    "reason",
    "userId",
    "method",
  ]) {
    if (entry[key] == null || entry[key] === "") continue;
    out[key] = String(entry[key]).slice(0, 120);
  }
  return out;
}

/**
 * Normalize placement maps for persistence. Prunes stale combatants.
 */
export function normalizePlacements(placements, { combatantIds = null, round = 1 } = {}) {
  if (!isPlainObject(placements)) return {};
  const idSet = combatantIds == null ? null : new Set([...combatantIds].map(String));
  const out = {};
  for (const [id, entry] of Object.entries(placements)) {
    const key = String(id);
    if (idSet && !idSet.has(key)) continue;
    const cleaned = sanitizePlacementRecord(entry, round);
    if (!cleaned) continue;
    // Keep only records for the current round (or future-dated applied this round).
    if (Number(cleaned.round) !== Number(round)) continue;
    out[key] = cleaned;
  }
  return out;
}

export function normalizePlacementCorrections(corrections, { combatantIds = null } = {}) {
  if (!isPlainObject(corrections)) return {};
  const idSet = combatantIds == null ? null : new Set([...combatantIds].map(String));
  const out = {};
  for (const [id, entry] of Object.entries(corrections)) {
    const key = String(id);
    if (idSet && !idSet.has(key)) continue;
    const cleaned = sanitizeCorrectionEntry(entry);
    if (!cleaned) continue;
    if (cleaned.status === CORRECTION_STATUS.CANCELLED || cleaned.status === CORRECTION_STATUS.APPLIED) {
      continue;
    }
    out[key] = cleaned;
  }
  return out;
}

export function normalizePlacementAudit(audit) {
  if (!Array.isArray(audit)) return [];
  return audit.map(sanitizeAuditEntry).filter(Boolean).slice(-MAX_AUDIT);
}

export function pushPlacementAudit(state, event, details = {}) {
  const next = cloneState(state);
  next.placementAudit = [
    ...(next.placementAudit ?? []),
    sanitizeAuditEntry({ event, at: Date.now(), ...details }),
  ]
    .filter(Boolean)
    .slice(-MAX_AUDIT);
  return next;
}

export function placementForCurrentRound(state, combatantId) {
  const entry = state?.placements?.[String(combatantId)];
  if (!entry) return null;
  if (Number(entry.round) !== Number(state.round ?? 1)) return null;
  return entry;
}

export function queuedCorrectionFor(state, combatantId) {
  const entry = state?.placementCorrections?.[String(combatantId)];
  if (!entry) return null;
  if (entry.status !== CORRECTION_STATUS.QUEUED) return null;
  return entry;
}

/**
 * Whether this combatant's start boundary already completed this round
 * (lifecycle turn record or acted with start completed).
 */
export function hasStartBoundaryThisRound(lifecycle, combatantId) {
  const turn = lifecycle?.turns?.[String(combatantId)];
  if (!turn) return false;
  return (
    turn.startStatus === BOUNDARY_STATUS.COMPLETED ||
    turn.startStatus === BOUNDARY_STATUS.SKIPPED
  );
}

export function hasEndBoundaryThisRound(lifecycle, combatantId) {
  const turn = lifecycle?.turns?.[String(combatantId)];
  if (!turn) return false;
  return (
    turn.endStatus === BOUNDARY_STATUS.COMPLETED ||
    turn.endStatus === BOUNDARY_STATUS.SKIPPED
  );
}

export function hasCompletedTurnThisRound(state, combatantId) {
  const id = String(combatantId);
  if (state.lifecycle && isTurnFinished(state.lifecycle, id)) return true;
  if (hasEndBoundaryThisRound(state.lifecycle, id)) return true;
  return false;
}

/**
 * Phase order index for "has this phase already ended this round?"
 * Initiative = -1, then Vanguard/Enemy/Rearguard.
 */
function phaseSequenceIndex(phase) {
  if (phase === PHASES.INITIATIVE) return -1;
  const idx = PHASE_ORDER.indexOf(phase);
  return idx < 0 ? 99 : idx;
}

export function destinationPhaseEnded(state, targetPhase) {
  if (targetPhase === PLACEMENTS.PENDING) return false;
  if (state.phase === PHASES.INITIATIVE) return false;
  const current = phaseSequenceIndex(state.phase);
  const target = phaseSequenceIndex(targetPhase);
  if (target < 0) return false;
  // Current phase that is ENDED means destination == current has ended.
  if (target === current) {
    return (
      state.lifecycle?.status === LIFECYCLE_STATUS.ENDED ||
      state.lifecycle?.end?.status === BOUNDARY_STATUS.COMPLETED
    );
  }
  // Destination earlier in sequence than current → already passed.
  return target < current;
}

export function destinationIsFuture(state, targetPhase) {
  if (targetPhase === PLACEMENTS.PENDING) return false;
  if (state.phase === PHASES.INITIATIVE) return true;
  const current = phaseSequenceIndex(state.phase);
  const target = phaseSequenceIndex(targetPhase);
  return target > current;
}

export function destinationIsCurrent(state, targetPhase) {
  if (targetPhase === PLACEMENTS.PENDING) return false;
  return state.phase === targetPhase;
}

/**
 * Evaluate legal current-round and next-round options for one combatant.
 * @returns {{ sourcePhase, currentRoundOptions: object[], nextRoundOptions: object[], reasons: object }}
 */
export function evaluatePlacementOptions(state, combatantId, { side = "party" } = {}) {
  const id = String(combatantId);
  const sourcePhase = resolveCombatantPlacement(state, id, side);
  const lifecycle = state.lifecycle;
  const lcStatus = lifecycle?.status ?? null;
  const started = hasStartBoundaryThisRound(lifecycle, id);
  const ended = hasCompletedTurnThisRound(state, id);
  const endBoundDone = hasEndBoundaryThisRound(lifecycle, id);
  const busy = BLOCKED_LIFECYCLE.has(lcStatus);

  const reasons = {};
  const currentRoundOptions = [];
  const nextRoundOptions = Object.values(PLACEMENTS).map((phase) => ({
    phase,
    mode: PLACEMENT_MODES.NEXT_ROUND,
    allowed: true,
    reason: null,
  }));

  function allowCurrent(phase, reason = null) {
    currentRoundOptions.push({
      phase,
      mode: PLACEMENT_MODES.CURRENT_ROUND,
      allowed: true,
      reason,
    });
  }

  function denyCurrent(phase, reason) {
    reasons[phase] = reason;
    currentRoundOptions.push({
      phase,
      mode: PLACEMENT_MODES.CURRENT_ROUND,
      allowed: false,
      reason,
    });
  }

  // Lifecycle busy → block This Round entirely.
  if (busy && state.phase !== PHASES.INITIATIVE) {
    for (const phase of Object.values(PLACEMENTS)) {
      denyCurrent(phase, "lifecycle-busy");
    }
    return { sourcePhase, currentRoundOptions, nextRoundOptions, reasons, started, ended, endBoundDone };
  }

  // Initiative (pre-lifecycle): all current placements allowed.
  if (state.phase === PHASES.INITIATIVE || !lifecycle) {
    for (const phase of Object.values(PLACEMENTS)) {
      allowCurrent(phase);
    }
    return { sourcePhase, currentRoundOptions, nextRoundOptions, reasons, started, ended, endBoundDone };
  }

  for (const phase of Object.values(PLACEMENTS)) {
    if (phase === sourcePhase) {
      denyCurrent(phase, "already-there");
      continue;
    }

    if (destinationPhaseEnded(state, phase)) {
      denyCurrent(phase, "phase-already-ended");
      continue;
    }

    if (phase === PLACEMENTS.PENDING) {
      if (!started && !ended) allowCurrent(phase);
      else denyCurrent(phase, "pending-unsafe");
      continue;
    }

    if (ended || endBoundDone) {
      denyCurrent(phase, "turn-completed");
      continue;
    }

    if (destinationIsFuture(state, phase)) {
      allowCurrent(phase);
      continue;
    }

    if (destinationIsCurrent(state, phase)) {
      // Join current Open phase when not already finished.
      if (OPEN_ONLY.has(lcStatus) || lcStatus === LIFECYCLE_STATUS.OPEN) {
        allowCurrent(phase);
      } else {
        denyCurrent(phase, "lifecycle-busy");
      }
      continue;
    }

    denyCurrent(phase, "unsafe");
  }

  return { sourcePhase, currentRoundOptions, nextRoundOptions, reasons, started, ended, endBoundDone };
}

/**
 * Resolve placement without importing combatantPhase (avoids circular init).
 * Mirrors state.combatantPhase once placements exist.
 */
export function resolveCombatantPlacement(state, combatantId, side = "party") {
  const placement = placementForCurrentRound(state, combatantId);
  if (placement?.phase) return placement.phase;
  if (side === "enemy") return PLACEMENTS.ENEMY;
  if (state.delayed?.[combatantId]) return PLACEMENTS.REARGUARD;
  return resultForCurrentRound(state, combatantId)?.phase ?? PLACEMENTS.REARGUARD;
}

/**
 * Apply authoritative current-round placement onto state maps.
 * Does not mutate lifecycle roster (controller does that).
 */
export function applyCurrentRoundPlacement(
  state,
  combatantId,
  targetPhase,
  { userId = null, originalPhase = null, method = PLACEMENT_METHODS.GM_CURRENT } = {},
) {
  const next = cloneState(state);
  const id = String(combatantId);
  const round = Number(next.round ?? 1);
  const prior = resolveCombatantPlacement(next, id, "party");
  const source = originalPhase ?? prior;

  next.placements ??= {};
  next.placements[id] = {
    phase: targetPhase,
    round,
    originalPhase: source,
    method,
    appliedBy: userId == null ? null : String(userId),
    appliedAt: Date.now(),
  };

  // Keep results/delayed coherent for party-style placement without fabricating dice.
  if (targetPhase === PLACEMENTS.PENDING) {
    if (next.delayed) delete next.delayed[id];
    // Clear conclusive assignment so normal initiative resolution can run again.
    // Original ChatMessage is never edited; placement audit retains originalPhase.
    if (next.results) delete next.results[id];
  } else if (targetPhase === PLACEMENTS.REARGUARD) {
    next.delayed ??= {};
    next.delayed[id] = true;
    const result = resultForCurrentRound(next, id);
    if (result) {
      result.phase = PHASES.REARGUARD;
    } else {
      next.results[id] = {
        total: null,
        skill: null,
        label: "GM placement",
        phase: PHASES.REARGUARD,
        round,
        forced: true,
        at: Date.now(),
      };
    }
  } else if (targetPhase === PLACEMENTS.VANGUARD) {
    if (next.delayed) delete next.delayed[id];
    const result = resultForCurrentRound(next, id);
    if (result) {
      result.phase = PHASES.VANGUARD;
    } else {
      next.results[id] = {
        total: null,
        skill: null,
        label: "GM placement",
        phase: PHASES.VANGUARD,
        round,
        forced: true,
        at: Date.now(),
      };
    }
  } else if (targetPhase === PLACEMENTS.ENEMY) {
    // Enemy placement is placement-map authoritative; clear delayed.
    if (next.delayed) delete next.delayed[id];
  }

  return pushPlacementAudit(next, "placement-correction-applied", {
    combatantId: id,
    sourcePhase: source,
    targetPhase,
    mode: PLACEMENT_MODES.CURRENT_ROUND,
    round: String(round),
    method,
    userId: userId == null ? null : String(userId),
  });
}

export function queueNextRoundCorrection(
  state,
  combatantId,
  targetPhase,
  { userId = null, replace = false } = {},
) {
  const next = cloneState(state);
  const id = String(combatantId);
  const effectiveRound = Math.max(1, Number(next.round || 1) + 1);
  const existing = next.placementCorrections?.[id];
  if (existing?.status === CORRECTION_STATUS.QUEUED && !replace) {
    return {
      state: next,
      ok: false,
      reason: "queue-exists",
      requiresReplaceConfirm: true,
    };
  }

  next.placementCorrections ??= {};
  next.placementCorrections[id] = {
    targetPhase,
    effectiveRound,
    status: CORRECTION_STATUS.QUEUED,
    createdBy: userId == null ? null : String(userId),
    createdAt: Date.now(),
    consumedAt: null,
    cancelledAt: null,
    revision: Number(next.revision || 0),
  };

  const event =
    existing?.status === CORRECTION_STATUS.QUEUED
      ? "placement-correction-replaced"
      : "placement-correction-queued";
  const audited = pushPlacementAudit(next, event, {
    combatantId: id,
    targetPhase,
    mode: PLACEMENT_MODES.NEXT_ROUND,
    effectiveRound: String(effectiveRound),
    userId: userId == null ? null : String(userId),
  });
  return { state: audited, ok: true, reason: null, requiresReplaceConfirm: false };
}

export function cancelQueuedCorrection(state, combatantId, { userId = null } = {}) {
  const next = cloneState(state);
  const id = String(combatantId);
  const existing = next.placementCorrections?.[id];
  if (!existing || existing.status !== CORRECTION_STATUS.QUEUED) {
    return { state: next, ok: false, reason: "no-queue" };
  }
  delete next.placementCorrections[id];
  const audited = pushPlacementAudit(next, "placement-correction-cancelled", {
    combatantId: id,
    targetPhase: existing.targetPhase,
    effectiveRound: String(existing.effectiveRound),
    userId: userId == null ? null : String(userId),
  });
  return { state: audited, ok: true, reason: null };
}

/**
 * Consume queued corrections for the state's current round into placements.
 * Called from beginRoundTransition after round increment / map clear.
 */
export function consumeQueuedCorrections(state, { userId = null } = {}) {
  let next = cloneState(state);
  const round = Number(next.round ?? 1);
  const queue = { ...(next.placementCorrections ?? {}) };
  next.placementCorrections = {};
  next.placements ??= {};

  for (const [id, entry] of Object.entries(queue)) {
    const cleaned = sanitizeCorrectionEntry(entry);
    if (!cleaned) continue;
    if (cleaned.status !== CORRECTION_STATUS.QUEUED) continue;
    if (Number(cleaned.effectiveRound) !== round) {
      // Keep for a later round if somehow still queued.
      if (Number(cleaned.effectiveRound) > round) {
        next.placementCorrections[id] = cleaned;
      }
      continue;
    }

    next = applyCurrentRoundPlacement(next, id, cleaned.targetPhase, {
      userId: cleaned.createdBy ?? userId,
      originalPhase: null,
      method: PLACEMENT_METHODS.GM_NEXT,
    });
    next = pushPlacementAudit(next, "placement-correction-consumed", {
      combatantId: id,
      targetPhase: cleaned.targetPhase,
      effectiveRound: String(round),
      method: PLACEMENT_METHODS.GM_NEXT,
    });
  }

  return next;
}

/**
 * Append combatant to an open lifecycle roster without new phaseInstanceId.
 */
export function appendToOpenRoster(state, combatantId, { initiativeTotal = null } = {}) {
  const next = cloneState(state);
  const id = String(combatantId);
  const lifecycle = next.lifecycle;
  if (!lifecycle || lifecycle.status !== LIFECYCLE_STATUS.OPEN) {
    return { state: next, changed: false, reason: "lifecycle-not-open" };
  }
  if (lifecycle.roster.includes(id)) {
    return { state: next, changed: false, reason: "already-in-roster" };
  }

  // Insert by initiative total among unfinished + finished, deterministic.
  const descriptors = lifecycle.roster.map((rid) => ({
    id: rid,
    initiativeTotal:
      resultForCurrentRound(next, rid)?.total ??
      (rid === id ? initiativeTotal : null),
  }));
  descriptors.push({ id, initiativeTotal });
  descriptors.sort((a, b) => {
    const ta = Number.isFinite(Number(a.initiativeTotal)) ? Number(a.initiativeTotal) : -Infinity;
    const tb = Number.isFinite(Number(b.initiativeTotal)) ? Number(b.initiativeTotal) : -Infinity;
    if (tb !== ta) return tb - ta;
    return String(a.id).localeCompare(String(b.id));
  });
  lifecycle.roster = descriptors.map((d) => d.id);
  lifecycle.turns ??= {};
  lifecycle.turns[id] ??= emptyTurnRecord();
  // If they already started this round elsewhere, mark start completed/skipped later by controller.

  if (lifecycle.status === LIFECYCLE_STATUS.COMPLETE) {
    lifecycle.status = LIFECYCLE_STATUS.OPEN;
  }

  return { state: next, changed: true, reason: null, needsStart: true };
}

/**
 * Remove unfinished combatant from open roster without running end boundary.
 * Mirrors Delay skip semantics when leaving current phase.
 */
export function leaveOpenRoster(state, combatantId, { userId = null } = {}) {
  const next = cloneState(state);
  const id = String(combatantId);
  const lifecycle = next.lifecycle;
  if (!lifecycle) return { state: next, changed: false, reason: "no-lifecycle" };
  if (!lifecycle.roster?.includes(id)) {
    return { state: next, changed: false, reason: "not-in-roster" };
  }
  if (isTurnFinished(lifecycle, id) || hasEndBoundaryThisRound(lifecycle, id)) {
    return { state: next, changed: false, reason: "turn-completed" };
  }

  lifecycle.turns ??= {};
  lifecycle.turns[id] ??= emptyTurnRecord();
  const turn = lifecycle.turns[id];
  turn.ended = true;
  turn.skipped = true;
  turn.endedBy = userId == null ? null : String(userId);
  turn.endedAt = Date.now();
  turn.endReason = "gm-placement-left-phase";
  if (turn.endStatus === BOUNDARY_STATUS.PENDING) {
    turn.endStatus = BOUNDARY_STATUS.SKIPPED;
  }
  next.acted ??= {};
  next.acted[id] = true;
  if (next.activeCombatantId === id) next.activeCombatantId = null;

  const progress = lifecycleProgress(lifecycle);
  if (progress.complete && lifecycle.status === LIFECYCLE_STATUS.OPEN) {
    lifecycle.status = LIFECYCLE_STATUS.COMPLETE;
  }

  return { state: next, changed: true, reason: null };
}

export function buildEditorProjection(state, combatantId, { side = "party", revision = 0 } = {}) {
  const id = String(combatantId);
  const options = evaluatePlacementOptions(state, id, { side });
  const queue = queuedCorrectionFor(state, id);
  const placement = placementForCurrentRound(state, id);
  return {
    combatantId: id,
    round: Number(state.round ?? 1),
    phase: state.phase,
    revision: Number(revision || state.revision || 0),
    sourcePhase: options.sourcePhase,
    started: options.started,
    ended: options.ended,
    endBoundDone: options.endBoundDone,
    lifecycleStatus: state.lifecycle?.status ?? null,
    phaseInstanceId: state.lifecycle?.phaseInstanceId ?? null,
    placementMethod: placement?.method ?? null,
    queued: queue
      ? {
          targetPhase: queue.targetPhase,
          effectiveRound: queue.effectiveRound,
        }
      : null,
    currentRoundOptions: options.currentRoundOptions,
    nextRoundOptions: options.nextRoundOptions,
  };
}

/**
 * True when the latest undo entry would reverse a correction that invoked a native start boundary.
 */
export function undoCrossesPlacementStart(state) {
  const history = Array.isArray(state?.history) ? state.history : [];
  const entry = history[history.length - 1];
  if (!entry?.state) return false;
  const priorAudit = entry.state.placementAudit ?? [];
  const currentAudit = state.placementAudit ?? [];
  if (currentAudit.length <= priorAudit.length) {
    // Fallback: label heuristic for placement apply after join.
    return /Place /i.test(String(entry.label ?? "")) && Boolean(state.lifecycle?.turns);
  }
  const priorLen = priorAudit.length;
  return currentAudit.slice(priorLen).some((row) => row?.event === "placement-start-boundary-invoked");
}

export { MAX_HISTORY, OPEN_ONLY, BLOCKED_LIFECYCLE };
