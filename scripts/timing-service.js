/**
 * Foundry-facing timing reconciliation for NelTempo condition timing.
 * Mutates only plain serializable state objects; never persists Actor/Item docs.
 */

import { MODULE_ID, SETTINGS } from "./constants.js";
import { LIFECYCLE_STATUS, isLifecyclePhase, isTurnFinished } from "./lifecycle.js";
import { readCombatantConditions, toSerializableResult } from "./pf2e-condition-adapter.js";
import {
  createTiming,
  ensureTiming,
  onTurnEndedTiming,
  onTurnReopenedTiming,
  pushTimingAudit,
  recomputePriorityGate,
  upsertCombatantConditions,
} from "./timing.js";
import { diag, getCombatant, shortId } from "./utils.js";

export function isTimingEnforced() {
  try {
    return game.settings.get(MODULE_ID, SETTINGS.ENFORCE_CONDITION_TIMING) !== false;
  } catch (_error) {
    return true;
  }
}

function timingDiag(event, combat, state, extra = {}) {
  diag(event, {
    combatId: shortId(combat?.id),
    phase: state?.phase ?? state?.lifecycle?.phase,
    round: state?.round ?? state?.lifecycle?.round,
    phaseInstanceId: shortId(state?.lifecycle?.phaseInstanceId),
    revision: Number(state?.revision ?? 0),
    timingRevision: Number(state?.lifecycle?.timing?.revision ?? 0),
    ...extra,
  });
}

/**
 * Re-read live PF2e conditions for the current roster and rebuild timing state.
 * Safe during Open (and Complete for UI). Does not replay lifecycle boundaries.
 *
 * @returns {{ state: object, changed: boolean, adapterFailures: number }}
 */
export function reconcileTimingState(combat, state, { reason = "reconcile" } = {}) {
  if (!state?.lifecycle || !isLifecyclePhase(state.phase)) {
    return { state, changed: false, adapterFailures: 0 };
  }

  // Do not opportunistically reorder during Starting/Ending/etc.
  const status = state.lifecycle.status;
  const mayRebuildGate = status === LIFECYCLE_STATUS.OPEN || status === LIFECYCLE_STATUS.COMPLETE;

  const next = structuredClone(state);
  let timing = ensureTiming(next.lifecycle) ?? createTiming({ phaseInstanceId: next.lifecycle.phaseInstanceId });
  next.lifecycle.timing = timing;

  if (!isTimingEnforced()) {
    // Clear active gate presentation when disabled, preserve audit.
    timing.priorityGate = {
      active: false,
      condition: "confused",
      unresolvedCombatantIds: [],
      completedCombatantIds: timing.priorityGate?.completedCombatantIds ?? [],
    };
    for (const id of Object.keys(timing.combatants ?? {})) {
      const record = timing.combatants[id];
      record.delayBlocked = false;
      record.delayBlockReason = null;
      record.priorityRequired = false;
    }
    next.lifecycle.timing = timing;
    return { state: next, changed: true, adapterFailures: 0 };
  }

  let adapterFailures = 0;
  const before = JSON.stringify(timing);

  for (const combatantId of next.lifecycle.roster ?? []) {
    const combatant = getCombatant(combat, combatantId);
    const ended = isTurnFinished(next.lifecycle, combatantId);
    const result = readCombatantConditions(combatant);
    if (!result.ok) {
      adapterFailures += 1;
      timingDiag("condition-timing-detected", combat, next, {
        combatantId: shortId(combatantId),
        reason: result.reason ?? "adapter-failed",
        method: result.method,
      });
      // Fail open: do not invent restriction from a failed read.
      // Keep prior persisted restriction only if live read failed entirely —
      // still refresh lastCheckedAt when we had a prior record.
      if (timing.combatants[combatantId]) {
        timing.combatants[combatantId].lastCheckedAt = Date.now();
      }
      continue;
    }

    const prior = timing.combatants[combatantId];
    const wasConfused = Boolean(prior?.confused);
    timing = upsertCombatantConditions(timing, combatantId, result.conditions, {
      ended,
      at: Date.now(),
    });

    const record = timing.combatants[combatantId];
    timing = pushTimingAudit(timing, "condition-timing-detected", {
      combatantId: shortId(combatantId),
      phase: next.lifecycle.phase,
      round: String(next.lifecycle.round),
      phaseInstanceId: shortId(next.lifecycle.phaseInstanceId),
      condition: [
        record.confused ? "confused" : null,
        record.restrained ? "restrained" : null,
        record.grabbed ? "grabbed" : null,
      ]
        .filter(Boolean)
        .join("+") || "none",
      reason,
      revision: String(timing.revision),
    });

    if (!ended && record.confused && !wasConfused) {
      timing = pushTimingAudit(timing, "confused-added-mid-phase", {
        combatantId: shortId(combatantId),
        phase: next.lifecycle.phase,
        phaseInstanceId: shortId(next.lifecycle.phaseInstanceId),
        revision: String(timing.revision),
      });
    }
    if (!ended && !record.confused && wasConfused) {
      timing = pushTimingAudit(timing, "confused-removed-mid-phase", {
        combatantId: shortId(combatantId),
        phase: next.lifecycle.phase,
        phaseInstanceId: shortId(next.lifecycle.phaseInstanceId),
        revision: String(timing.revision),
      });
    }

    // Silence unused serializable helper reference in production builds.
    void toSerializableResult;
  }

  // Prune combatants no longer in roster / combat.
  const rosterSet = new Set((next.lifecycle.roster ?? []).map(String));
  for (const id of Object.keys(timing.combatants)) {
    if (!rosterSet.has(id)) delete timing.combatants[id];
  }

  if (mayRebuildGate) {
    const priorActive = Boolean(timing.priorityGate?.active);
    const priorFirst = timing.priorityGate?.unresolvedCombatantIds?.[0] ?? null;
    timing = recomputePriorityGate(timing, next.lifecycle);
    if (timing.priorityGate.active && !priorActive) {
      timing = pushTimingAudit(timing, "confused-priority-created", {
        phase: next.lifecycle.phase,
        phaseInstanceId: shortId(next.lifecycle.phaseInstanceId),
        revision: String(timing.revision),
        reason: String(timing.priorityGate.unresolvedCombatantIds.length),
      });
    } else if (
      timing.priorityGate.active &&
      priorFirst &&
      timing.priorityGate.unresolvedCombatantIds[0] !== priorFirst
    ) {
      timing = pushTimingAudit(timing, "confused-priority-advanced", {
        phase: next.lifecycle.phase,
        phaseInstanceId: shortId(next.lifecycle.phaseInstanceId),
        combatantId: shortId(timing.priorityGate.unresolvedCombatantIds[0]),
        revision: String(timing.revision),
      });
    } else if (!timing.priorityGate.active && priorActive) {
      timing = pushTimingAudit(timing, "confused-priority-resolved", {
        phase: next.lifecycle.phase,
        phaseInstanceId: shortId(next.lifecycle.phaseInstanceId),
        revision: String(timing.revision),
      });
    }
  }

  timing = pushTimingAudit(timing, "timing-state-reconciled", {
    phase: next.lifecycle.phase,
    phaseInstanceId: shortId(next.lifecycle.phaseInstanceId),
    reason,
    revision: String(timing.revision),
  });

  next.lifecycle.timing = timing;
  const after = JSON.stringify(timing);
  return { state: next, changed: before !== after, adapterFailures };
}

export function applyEndTurnTiming(state, combatantId) {
  if (!state?.lifecycle?.timing) return state;
  const next = structuredClone(state);
  next.lifecycle.timing = onTurnEndedTiming(next.lifecycle.timing, next.lifecycle, combatantId);
  return next;
}

export function applyReopenTiming(state, combatantId) {
  if (!state?.lifecycle?.timing) return state;
  const next = structuredClone(state);
  next.lifecycle.timing = onTurnReopenedTiming(next.lifecycle.timing, next.lifecycle, combatantId);
  return next;
}

/**
 * Fresh live condition check for one combatant before a Delay/End decision.
 */
export function refreshCombatantTiming(combat, state, combatantId) {
  if (!state?.lifecycle) return state;
  const next = structuredClone(state);
  next.lifecycle.timing =
    ensureTiming(next.lifecycle) ?? createTiming({ phaseInstanceId: next.lifecycle.phaseInstanceId });

  if (!isTimingEnforced()) return next;

  const combatant = getCombatant(combat, combatantId);
  const result = readCombatantConditions(combatant);
  if (!result.ok) {
    return next;
  }
  const ended = isTurnFinished(next.lifecycle, combatantId);
  let timing = upsertCombatantConditions(next.lifecycle.timing, combatantId, result.conditions, {
    ended,
  });
  if (
    next.lifecycle.status === LIFECYCLE_STATUS.OPEN ||
    next.lifecycle.status === LIFECYCLE_STATUS.COMPLETE
  ) {
    timing = recomputePriorityGate(timing, next.lifecycle);
  }
  next.lifecycle.timing = timing;
  return next;
}
