/**
 * Pure phase-lifecycle state helpers for Dynamic Initiative.
 * No Foundry/PF2e document access; safe for unit tests.
 * Intentionally does not import state.js (avoids circular deps).
 */

export const LIFECYCLE_STATUS = Object.freeze({
  PREPARING: "preparing",
  STARTING: "starting",
  OPEN: "open",
  COMPLETE: "complete",
  ENDING: "ending",
  ENDED: "ended",
  INTERRUPTED: "interrupted",
  ERROR: "error",
});

export const BOUNDARY_STATUS = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  SKIPPED: "skipped",
  FAILED: "failed",
  INTERRUPTED: "interrupted",
});

const PHASES = Object.freeze({
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

/** Phases that run start/end turn lifecycle for a roster. */
export const LIFECYCLE_PHASES = Object.freeze([PHASES.VANGUARD, PHASES.ENEMY, PHASES.REARGUARD]);

export function isLifecyclePhase(phase) {
  return LIFECYCLE_PHASES.includes(phase);
}

function cloneState(state) {
  return structuredClone(state);
}

export function createPhaseInstanceId() {
  if (typeof foundry !== "undefined" && foundry?.utils?.randomID) {
    return foundry.utils.randomID();
  }
  return `ph${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function emptyBoundaryBlock(status = BOUNDARY_STATUS.PENDING) {
  return {
    status,
    startedAt: null,
    completedAt: null,
    processedCombatants: [],
    failedCombatants: [],
  };
}

function emptyTurnRecord() {
  return {
    ended: false,
    endedBy: null,
    endedAt: null,
    reopenedAt: null,
    skipped: false,
    startStatus: BOUNDARY_STATUS.PENDING,
    endStatus: BOUNDARY_STATUS.PENDING,
    startReason: null,
    endReason: null,
  };
}

/**
 * Snapshot a new lifecycle instance for entering a phase.
 * @param {{ phase: string, round: number, roster: string[], phaseInstanceId?: string }} args
 */
export function createLifecycle({ phase, round, roster, phaseInstanceId = null } = {}) {
  const ids = [...new Set((roster ?? []).map(String).filter(Boolean))];
  const turns = {};
  for (const id of ids) turns[id] = emptyTurnRecord();

  return {
    phaseInstanceId: phaseInstanceId || createPhaseInstanceId(),
    round: Math.max(1, Number(round || 1) || 1),
    phase: PHASE_ORDER.includes(phase) ? phase : PHASES.VANGUARD,
    status: LIFECYCLE_STATUS.PREPARING,
    roster: ids,
    forcedAdvance: false,
    start: emptyBoundaryBlock(BOUNDARY_STATUS.PENDING),
    end: emptyBoundaryBlock(BOUNDARY_STATUS.PENDING),
    turns,
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeFailedList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) => {
      if (typeof entry === "string") return { id: String(entry), reason: "failed" };
      if (!isPlainObject(entry) || entry.id == null) return null;
      return {
        id: String(entry.id),
        reason: entry.reason == null ? "failed" : String(entry.reason).slice(0, 200),
      };
    })
    .filter(Boolean);
}

function sanitizeTurn(entry) {
  if (!isPlainObject(entry)) return emptyTurnRecord();
  const startStatus = Object.values(BOUNDARY_STATUS).includes(entry.startStatus)
    ? entry.startStatus
    : BOUNDARY_STATUS.PENDING;
  const endStatus = Object.values(BOUNDARY_STATUS).includes(entry.endStatus)
    ? entry.endStatus
    : BOUNDARY_STATUS.PENDING;
  return {
    ended: Boolean(entry.ended),
    endedBy: entry.endedBy == null || entry.endedBy === "" ? null : String(entry.endedBy),
    endedAt: Number.isFinite(Number(entry.endedAt)) ? Number(entry.endedAt) : null,
    reopenedAt: Number.isFinite(Number(entry.reopenedAt)) ? Number(entry.reopenedAt) : null,
    skipped: Boolean(entry.skipped),
    startStatus,
    endStatus,
    startReason: entry.startReason == null ? null : String(entry.startReason).slice(0, 200),
    endReason: entry.endReason == null ? null : String(entry.endReason).slice(0, 200),
  };
}

function sanitizeBoundaryBlock(block) {
  if (!isPlainObject(block)) return emptyBoundaryBlock();
  const status = Object.values(BOUNDARY_STATUS).includes(block.status)
    ? block.status
    : BOUNDARY_STATUS.PENDING;
  return {
    status,
    startedAt: Number.isFinite(Number(block.startedAt)) ? Number(block.startedAt) : null,
    completedAt: Number.isFinite(Number(block.completedAt)) ? Number(block.completedAt) : null,
    processedCombatants: Array.isArray(block.processedCombatants)
      ? block.processedCombatants.map(String).filter(Boolean)
      : [],
    failedCombatants: sanitizeFailedList(block.failedCombatants),
  };
}

/**
 * Normalize lifecycle for persistence. Drops stale turn keys not in combat.
 * Preserves completed audit for roster members that still exist.
 * Does not invent start/end results for combatants added after snapshot.
 */
export function normalizeLifecycle(lifecycle, { combatantIds = null } = {}) {
  if (lifecycle == null) return null;
  if (!isPlainObject(lifecycle)) return null;

  const idSet = combatantIds == null ? null : new Set([...combatantIds].map(String));
  const phase = PHASE_ORDER.includes(lifecycle.phase) ? lifecycle.phase : PHASES.VANGUARD;
  if (!isLifecyclePhase(phase) && lifecycle.status !== LIFECYCLE_STATUS.ENDED) {
    // Initiative and unknown phases do not keep an active lifecycle.
    if (!isLifecyclePhase(lifecycle.phase)) return null;
  }

  const status = Object.values(LIFECYCLE_STATUS).includes(lifecycle.status)
    ? lifecycle.status
    : LIFECYCLE_STATUS.OPEN;

  let roster = Array.isArray(lifecycle.roster)
    ? lifecycle.roster.map(String).filter(Boolean)
    : [];
  // De-dupe while preserving order.
  const seen = new Set();
  roster = roster.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // Prune deleted combatants from unfinished roster tracking, but keep completed
  // turn audit for still-present combatants. Remove entirely-missing combatants.
  if (idSet) {
    roster = roster.filter((id) => idSet.has(id));
  }

  const turns = {};
  for (const id of roster) {
    turns[id] = sanitizeTurn(lifecycle.turns?.[id]);
  }
  // Preserve turn records for roster members only (not late joiners).
  if (isPlainObject(lifecycle.turns)) {
    for (const [id, entry] of Object.entries(lifecycle.turns)) {
      if (turns[id]) continue;
      if (idSet && !idSet.has(String(id))) continue;
      // Stale non-roster entries: only keep completed audit if still in combat.
      const cleaned = sanitizeTurn(entry);
      if (
        cleaned.startStatus === BOUNDARY_STATUS.COMPLETED ||
        cleaned.endStatus === BOUNDARY_STATUS.COMPLETED
      ) {
        // Not in current roster — drop; roster is the authoritative set.
      }
    }
  }

  return {
    phaseInstanceId: String(lifecycle.phaseInstanceId || createPhaseInstanceId()),
    round: Math.max(1, Number(lifecycle.round || 1) || 1),
    phase,
    status,
    roster,
    forcedAdvance: Boolean(lifecycle.forcedAdvance),
    start: sanitizeBoundaryBlock(lifecycle.start),
    end: sanitizeBoundaryBlock(lifecycle.end),
    turns,
  };
}

/**
 * After reload, convert uncertain Processing entries into Interrupted for GM review.
 */
export function interruptUncertainProcessing(lifecycle) {
  if (!lifecycle) return null;
  const next = structuredClone(lifecycle);
  let interrupted = false;

  if (
    [LIFECYCLE_STATUS.STARTING, LIFECYCLE_STATUS.ENDING].includes(next.status) ||
    next.start?.status === BOUNDARY_STATUS.PROCESSING ||
    next.end?.status === BOUNDARY_STATUS.PROCESSING
  ) {
    // Leave overall status as interrupted only when mid-boundary.
    if ([LIFECYCLE_STATUS.STARTING, LIFECYCLE_STATUS.ENDING, LIFECYCLE_STATUS.PREPARING].includes(next.status)) {
      next.status = LIFECYCLE_STATUS.INTERRUPTED;
      interrupted = true;
    }
  }

  for (const id of next.roster ?? []) {
    const turn = next.turns?.[id];
    if (!turn) continue;
    if (turn.startStatus === BOUNDARY_STATUS.PROCESSING) {
      turn.startStatus = BOUNDARY_STATUS.INTERRUPTED;
      turn.startReason = turn.startReason || "interrupted-reload";
      interrupted = true;
    }
    if (turn.endStatus === BOUNDARY_STATUS.PROCESSING) {
      turn.endStatus = BOUNDARY_STATUS.INTERRUPTED;
      turn.endReason = turn.endReason || "interrupted-reload";
      interrupted = true;
    }
  }

  if (
    next.start?.status === BOUNDARY_STATUS.PROCESSING ||
    (interrupted && next.status === LIFECYCLE_STATUS.STARTING)
  ) {
    next.start.status = BOUNDARY_STATUS.FAILED;
    next.status = LIFECYCLE_STATUS.INTERRUPTED;
  }
  if (
    next.end?.status === BOUNDARY_STATUS.PROCESSING ||
    (interrupted && next.status === LIFECYCLE_STATUS.ENDING)
  ) {
    next.end.status = BOUNDARY_STATUS.FAILED;
    next.status = LIFECYCLE_STATUS.INTERRUPTED;
  }

  return next;
}

export function lifecycleProgress(lifecycle, { combatantIds = null } = {}) {
  if (!lifecycle?.roster) {
    return { total: 0, ended: 0, remaining: [], complete: false };
  }
  const idSet = combatantIds == null ? null : new Set([...combatantIds].map(String));
  const active = lifecycle.roster.filter((id) => !idSet || idSet.has(String(id)));
  const remaining = [];
  let ended = 0;
  for (const id of active) {
    const turn = lifecycle.turns?.[id];
    if (turn?.ended || turn?.skipped) ended += 1;
    else remaining.push(id);
  }
  return {
    total: active.length,
    ended,
    remaining,
    complete: active.length === 0 || remaining.length === 0,
  };
}

export function isTurnFinished(lifecycle, combatantId) {
  const turn = lifecycle?.turns?.[String(combatantId)];
  return Boolean(turn?.ended || turn?.skipped);
}

export function canEndTurn(lifecycle, combatantId) {
  if (!lifecycle || lifecycle.status !== LIFECYCLE_STATUS.OPEN) return false;
  const id = String(combatantId);
  if (!lifecycle.roster?.includes(id)) return false;
  return !isTurnFinished(lifecycle, id);
}

export function canReopenTurn(lifecycle, combatantId) {
  if (!lifecycle || lifecycle.status !== LIFECYCLE_STATUS.OPEN) return false;
  if ([LIFECYCLE_STATUS.ENDING, LIFECYCLE_STATUS.ENDED].includes(lifecycle.status)) return false;
  const id = String(combatantId);
  if (!lifecycle.roster?.includes(id)) return false;
  const turn = lifecycle.turns?.[id];
  return Boolean(turn?.ended && !turn?.skipped);
}

/**
 * Mark End Turn (idempotent). Returns { state, changed }.
 */
export function markTurnEnded(state, combatantId, { userId = null, at = Date.now() } = {}) {
  const next = cloneState(state);
  const lifecycle = next.lifecycle;
  const id = String(combatantId);
  if (!lifecycle || lifecycle.status !== LIFECYCLE_STATUS.OPEN) {
    return { state: next, changed: false, reason: "lifecycle-not-open" };
  }
  if (!lifecycle.roster?.includes(id)) {
    return { state: next, changed: false, reason: "not-in-roster" };
  }
  lifecycle.turns ??= {};
  lifecycle.turns[id] ??= emptyTurnRecord();
  const turn = lifecycle.turns[id];
  if (turn.ended || turn.skipped) {
    return { state: next, changed: false, reason: "already-ended" };
  }
  turn.ended = true;
  turn.endedBy = userId == null ? null : String(userId);
  turn.endedAt = Number(at) || Date.now();
  turn.reopenedAt = null;
  next.acted ??= {};
  next.acted[id] = true;
  if (next.activeCombatantId === id) next.activeCombatantId = null;

  const progress = lifecycleProgress(lifecycle);
  if (progress.complete && lifecycle.status === LIFECYCLE_STATUS.OPEN) {
    lifecycle.status = LIFECYCLE_STATUS.COMPLETE;
  }
  return { state: next, changed: true, reason: null };
}

/**
 * Reopen a finished turn before phase end.
 */
export function reopenTurn(state, combatantId, { at = Date.now() } = {}) {
  const next = cloneState(state);
  const lifecycle = next.lifecycle;
  const id = String(combatantId);
  if (!canReopenTurn(lifecycle, id)) {
    return { state: next, changed: false, reason: "cannot-reopen" };
  }
  const turn = lifecycle.turns[id];
  turn.ended = false;
  turn.endedBy = null;
  turn.endedAt = null;
  turn.reopenedAt = Number(at) || Date.now();
  turn.skipped = false;
  if (next.acted) delete next.acted[id];
  if (lifecycle.status === LIFECYCLE_STATUS.COMPLETE) {
    lifecycle.status = LIFECYCLE_STATUS.OPEN;
  }
  return { state: next, changed: true, reason: null };
}

/**
 * Mark remaining unfinished roster combatants as skipped (GM End Remaining / Force Advance).
 */
export function skipRemainingTurns(state, { userId = null, at = Date.now() } = {}) {
  const next = cloneState(state);
  const lifecycle = next.lifecycle;
  if (!lifecycle || ![LIFECYCLE_STATUS.OPEN, LIFECYCLE_STATUS.COMPLETE].includes(lifecycle.status)) {
    return { state: next, changed: false, skipped: [] };
  }
  const skipped = [];
  for (const id of lifecycle.roster ?? []) {
    const turn = lifecycle.turns?.[id] ?? emptyTurnRecord();
    lifecycle.turns[id] = turn;
    if (turn.ended || turn.skipped) continue;
    turn.skipped = true;
    turn.ended = true;
    turn.endedBy = userId == null ? null : String(userId);
    turn.endedAt = Number(at) || Date.now();
    next.acted ??= {};
    next.acted[id] = true;
    skipped.push(id);
  }
  if (next.activeCombatantId && skipped.includes(next.activeCombatantId)) {
    next.activeCombatantId = null;
  }
  const progress = lifecycleProgress(lifecycle);
  if (progress.complete) lifecycle.status = LIFECYCLE_STATUS.COMPLETE;
  return { state: next, changed: skipped.length > 0, skipped };
}

export function setLifecycleStatus(state, status) {
  const next = cloneState(state);
  if (!next.lifecycle) return next;
  next.lifecycle.status = status;
  return next;
}

export function beginStartBoundary(state) {
  const next = cloneState(state);
  if (!next.lifecycle) return next;
  next.lifecycle.status = LIFECYCLE_STATUS.STARTING;
  next.lifecycle.start = {
    ...emptyBoundaryBlock(BOUNDARY_STATUS.PROCESSING),
    startedAt: Date.now(),
    processedCombatants: [...(next.lifecycle.start?.processedCombatants ?? [])],
    failedCombatants: [...(next.lifecycle.start?.failedCombatants ?? [])],
  };
  return next;
}

export function markCombatantStartProcessing(state, combatantId) {
  const next = cloneState(state);
  const id = String(combatantId);
  if (!next.lifecycle?.turns?.[id]) return next;
  if (next.lifecycle.turns[id].startStatus === BOUNDARY_STATUS.COMPLETED) return next;
  next.lifecycle.turns[id].startStatus = BOUNDARY_STATUS.PROCESSING;
  next.lifecycle.turns[id].startReason = null;
  return next;
}

export function markCombatantStartResult(state, combatantId, { ok, reason = null, skipped = false } = {}) {
  const next = cloneState(state);
  const id = String(combatantId);
  const lifecycle = next.lifecycle;
  if (!lifecycle?.turns?.[id]) return next;
  const turn = lifecycle.turns[id];
  if (turn.startStatus === BOUNDARY_STATUS.COMPLETED) return next;

  if (skipped) {
    turn.startStatus = BOUNDARY_STATUS.SKIPPED;
    turn.startReason = reason;
  } else if (ok) {
    turn.startStatus = BOUNDARY_STATUS.COMPLETED;
    turn.startReason = null;
    lifecycle.start.processedCombatants = uniquePush(lifecycle.start.processedCombatants, id);
    lifecycle.start.failedCombatants = (lifecycle.start.failedCombatants ?? []).filter((e) => e.id !== id);
  } else {
    turn.startStatus = BOUNDARY_STATUS.FAILED;
    turn.startReason = reason || "start-failed";
    lifecycle.start.failedCombatants = [
      ...(lifecycle.start.failedCombatants ?? []).filter((e) => e.id !== id),
      { id, reason: turn.startReason },
    ];
  }
  return next;
}

export function completeStartBoundary(state, { error = false } = {}) {
  const next = cloneState(state);
  if (!next.lifecycle) return next;
  const lifecycle = next.lifecycle;
  if (error) {
    lifecycle.status = LIFECYCLE_STATUS.ERROR;
    lifecycle.start.status = BOUNDARY_STATUS.FAILED;
    lifecycle.start.completedAt = Date.now();
    return next;
  }
  lifecycle.start.status = BOUNDARY_STATUS.COMPLETED;
  lifecycle.start.completedAt = Date.now();
  lifecycle.status = LIFECYCLE_STATUS.OPEN;
  return next;
}

export function beginEndBoundary(state, { forced = false } = {}) {
  const next = cloneState(state);
  if (!next.lifecycle) return next;
  next.lifecycle.status = LIFECYCLE_STATUS.ENDING;
  if (forced) next.lifecycle.forcedAdvance = true;
  next.lifecycle.end = {
    ...emptyBoundaryBlock(BOUNDARY_STATUS.PROCESSING),
    startedAt: Date.now(),
    processedCombatants: [...(next.lifecycle.end?.processedCombatants ?? [])],
    failedCombatants: [...(next.lifecycle.end?.failedCombatants ?? [])],
  };
  return next;
}

export function markCombatantEndProcessing(state, combatantId) {
  const next = cloneState(state);
  const id = String(combatantId);
  if (!next.lifecycle?.turns?.[id]) return next;
  if (next.lifecycle.turns[id].endStatus === BOUNDARY_STATUS.COMPLETED) return next;
  next.lifecycle.turns[id].endStatus = BOUNDARY_STATUS.PROCESSING;
  next.lifecycle.turns[id].endReason = null;
  return next;
}

export function markCombatantEndResult(state, combatantId, { ok, reason = null, skipped = false } = {}) {
  const next = cloneState(state);
  const id = String(combatantId);
  const lifecycle = next.lifecycle;
  if (!lifecycle?.turns?.[id]) return next;
  const turn = lifecycle.turns[id];
  if (turn.endStatus === BOUNDARY_STATUS.COMPLETED) return next;

  if (skipped) {
    turn.endStatus = BOUNDARY_STATUS.SKIPPED;
    turn.endReason = reason;
  } else if (ok) {
    turn.endStatus = BOUNDARY_STATUS.COMPLETED;
    turn.endReason = null;
    lifecycle.end.processedCombatants = uniquePush(lifecycle.end.processedCombatants, id);
    lifecycle.end.failedCombatants = (lifecycle.end.failedCombatants ?? []).filter((e) => e.id !== id);
  } else {
    turn.endStatus = BOUNDARY_STATUS.FAILED;
    turn.endReason = reason || "end-failed";
    lifecycle.end.failedCombatants = [
      ...(lifecycle.end.failedCombatants ?? []).filter((e) => e.id !== id),
      { id, reason: turn.endReason },
    ];
  }
  return next;
}

export function completeEndBoundary(state, { error = false } = {}) {
  const next = cloneState(state);
  if (!next.lifecycle) return next;
  const lifecycle = next.lifecycle;
  if (error) {
    lifecycle.status = LIFECYCLE_STATUS.ERROR;
    lifecycle.end.status = BOUNDARY_STATUS.FAILED;
    lifecycle.end.completedAt = Date.now();
    return next;
  }
  lifecycle.end.status = BOUNDARY_STATUS.COMPLETED;
  lifecycle.end.completedAt = Date.now();
  lifecycle.status = LIFECYCLE_STATUS.ENDED;
  return next;
}

/**
 * Combatants still needing start processing (pending/failed/interrupted, not completed/skipped).
 */
export function startCandidates(lifecycle, { onlyFailedOrInterrupted = false } = {}) {
  if (!lifecycle?.roster) return [];
  return lifecycle.roster.filter((id) => {
    const status = lifecycle.turns?.[id]?.startStatus ?? BOUNDARY_STATUS.PENDING;
    if (status === BOUNDARY_STATUS.COMPLETED || status === BOUNDARY_STATUS.SKIPPED) return false;
    if (onlyFailedOrInterrupted) {
      return [BOUNDARY_STATUS.FAILED, BOUNDARY_STATUS.INTERRUPTED, BOUNDARY_STATUS.PENDING].includes(status);
    }
    return true;
  });
}

export function endCandidates(lifecycle, { onlyFailedOrInterrupted = false } = {}) {
  if (!lifecycle?.roster) return [];
  return lifecycle.roster.filter((id) => {
    const status = lifecycle.turns?.[id]?.endStatus ?? BOUNDARY_STATUS.PENDING;
    if (status === BOUNDARY_STATUS.COMPLETED || status === BOUNDARY_STATUS.SKIPPED) return false;
    if (onlyFailedOrInterrupted) {
      return [BOUNDARY_STATUS.FAILED, BOUNDARY_STATUS.INTERRUPTED, BOUNDARY_STATUS.PENDING].includes(status);
    }
    return true;
  });
}

export function skipFailedStarts(state, combatantIds = null) {
  const next = cloneState(state);
  const lifecycle = next.lifecycle;
  if (!lifecycle) return next;
  const targets = combatantIds ?? startCandidates(lifecycle, { onlyFailedOrInterrupted: true });
  for (const id of targets) {
    const turn = lifecycle.turns?.[id];
    if (!turn) continue;
    if (turn.startStatus === BOUNDARY_STATUS.COMPLETED) continue;
    turn.startStatus = BOUNDARY_STATUS.SKIPPED;
    turn.startReason = turn.startReason || "skipped-by-gm";
    lifecycle.start.failedCombatants = (lifecycle.start.failedCombatants ?? []).filter((e) => e.id !== id);
  }
  return next;
}

export function skipFailedEnds(state, combatantIds = null) {
  const next = cloneState(state);
  const lifecycle = next.lifecycle;
  if (!lifecycle) return next;
  const targets = combatantIds ?? endCandidates(lifecycle, { onlyFailedOrInterrupted: true });
  for (const id of targets) {
    const turn = lifecycle.turns?.[id];
    if (!turn) continue;
    if (turn.endStatus === BOUNDARY_STATUS.COMPLETED) continue;
    turn.endStatus = BOUNDARY_STATUS.SKIPPED;
    turn.endReason = turn.endReason || "skipped-by-gm";
    lifecycle.end.failedCombatants = (lifecycle.end.failedCombatants ?? []).filter((e) => e.id !== id);
  }
  return next;
}

/**
 * Whether Undo would restore across a completed phase-end boundary.
 * Uses history snapshot comparison when available.
 */
export function undoCrossesPhaseEnd(state) {
  const history = Array.isArray(state?.history) ? state.history : [];
  const entry = history[history.length - 1];
  if (!entry?.state) return false;
  const currentEnded =
    state?.lifecycle?.status === LIFECYCLE_STATUS.ENDED ||
    state?.lifecycle?.end?.status === BOUNDARY_STATUS.COMPLETED;
  const prior = entry.state;
  // Undoing from a later phase/round after end completed, or undoing while end completed.
  if (currentEnded) return true;
  if (
    prior.lifecycle?.end?.status === BOUNDARY_STATUS.COMPLETED &&
    (prior.phase !== state.phase || prior.round !== state.round)
  ) {
    return true;
  }
  // If current phase has no end completed but history label indicates phase change after end.
  if (
    prior.lifecycle?.status === LIFECYCLE_STATUS.ENDED &&
    (Number(prior.round) !== Number(state.round) || prior.phase !== state.phase)
  ) {
    return true;
  }
  return false;
}

export function attachLifecycle(state, lifecycle) {
  const next = cloneState(state);
  next.lifecycle = lifecycle;
  return next;
}

export function clearLifecycle(state) {
  const next = cloneState(state);
  next.lifecycle = null;
  return next;
}

function uniquePush(list, id) {
  const next = Array.isArray(list) ? [...list] : [];
  if (!next.includes(id)) next.push(id);
  return next;
}

/**
 * Build deterministic roster ids for a phase from combatant descriptors.
 * @param {Array<{id: string, side: string, phase?: string, initiativeTotal?: number|null, delayed?: boolean}>} combatants
 * @param {string} phase
 */
export function buildRosterIds(combatants, phase) {
  const list = (combatants ?? []).filter((c) => c?.id);
  let filtered;
  if (phase === PHASES.VANGUARD) {
    filtered = list.filter((c) => c.side === "party" && c.phase === PHASES.VANGUARD);
  } else if (phase === PHASES.REARGUARD) {
    filtered = list.filter((c) => c.side === "party" && c.phase === PHASES.REARGUARD);
  } else if (phase === PHASES.ENEMY) {
    filtered = list.filter((c) => c.side === "enemy");
  } else {
    filtered = [];
  }

  // Deterministic: higher initiative total first (party), then combatant id.
  filtered.sort((a, b) => {
    const ta = Number.isFinite(Number(a.initiativeTotal)) ? Number(a.initiativeTotal) : -Infinity;
    const tb = Number.isFinite(Number(b.initiativeTotal)) ? Number(b.initiativeTotal) : -Infinity;
    if (tb !== ta) return tb - ta;
    return String(a.id).localeCompare(String(b.id));
  });
  return filtered.map((c) => String(c.id));
}
