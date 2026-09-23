/**
 * Foundry/PF2e adapter for finite source-linked Effect items.
 *
 * PF2e 8.4.0 calculates turn expiry from world time and the active native
 * combatant. NelTempo keeps native turn events suppressed, so a proven,
 * structured one-source Effect is temporarily protected from round-based
 * expiry and removed at the matching NelTempo actual-turn boundary.
 * Conditions (including Grabbed/Restrained) are never synthesized or owned.
 */

import { MODULE_ID } from "./constants.js";
import {
  SOURCE_LINK_BOUNDARY,
  SOURCE_LINK_STATUS,
  boundaryId,
  createSourceLinkedTiming,
  dueSourceLinkedRelationships,
  markSourceLinkedExpired,
  markSourceLinkedProcessing,
  markSourceLinkedReview,
  normalizeSourceLinkedTiming,
  pushSourceLinkedAudit,
  recoverInterruptedSourceLinkedTiming,
  relationshipId,
  removeSourceLinkedRelationship,
  sanitizeOriginalDuration,
  upsertSourceLinkedRelationship,
} from "./source-linked-timing.js";
import {
  diag,
  getCombat,
  getCombatant,
  getState,
  isPrimaryGM,
  runCombatMutation,
  saveState,
  shortId,
} from "./utils.js";

const INTERNAL_OPTION = `${MODULE_ID}.sourceLinkedTiming`;
const ITEM_FLAG = "sourceLinkedTiming";

function sourceLinkDiag(event, combat, state, extra = {}) {
  diag(event, {
    combatId: shortId(combat?.id),
    phase: state?.phase,
    round: Number(state?.round ?? 0),
    revision: Number(state?.revision ?? 0),
    ...extra,
  });
}

function combatantsForActorUuid(combat, actorUuid) {
  if (!combat || !actorUuid) return [];
  return [...(combat.combatants ?? [])].filter((combatant) => combatant.actor?.uuid === actorUuid);
}

function currentActualTurnId(state, combatantId) {
  const turn = state?.lifecycle?.turns?.[combatantId];
  return (
    turn?.delayedTurn?.actualTurnId ??
    (state?.lifecycle?.phaseInstanceId
      ? `${state.round}:${state.lifecycle.phaseInstanceId}:${combatantId}`
      : null)
  );
}

function effectFlag(item) {
  return item?.flags?.[MODULE_ID]?.[ITEM_FLAG] ?? null;
}

function isFiniteTurnEffect(item) {
  const duration = item?.system?.duration;
  return Boolean(
    item?.type === "effect" &&
      duration?.unit === "rounds" &&
      Number.isFinite(Number(duration.value)) &&
      Number.isInteger(Number(duration.value)) &&
      Number(duration.value) >= 0 &&
      ["turn-start", "turn-end"].includes(duration.expiry),
  );
}

/**
 * Inspect only PF2e structured fields. No names, chat prose, or proximity.
 */
export function inspectSourceLinkedEffect(item, combat, state) {
  if (!isFiniteTurnEffect(item)) return { supported: false, candidate: false, reason: "not-finite-turn-effect" };
  const context = item.system?.context;
  const originActorUuid = context?.origin?.actor ?? null;
  const ownerActorUuid = item.actor?.uuid ?? null;
  const contextTargetUuid = context?.target?.actor ?? null;
  if (!originActorUuid || !ownerActorUuid) {
    return { supported: false, candidate: true, reason: "missing-structured-origin" };
  }
  if (contextTargetUuid && contextTargetUuid !== ownerActorUuid) {
    return { supported: false, candidate: true, reason: "target-owner-mismatch" };
  }

  const sources = combatantsForActorUuid(combat, originActorUuid);
  const targets = combatantsForActorUuid(combat, ownerActorUuid);
  if (sources.length !== 1) {
    return {
      supported: false,
      candidate: true,
      reason: sources.length > 1 ? "ambiguous-source-combatant" : "missing-source-combatant",
    };
  }
  if (targets.length !== 1) {
    return {
      supported: false,
      candidate: true,
      reason: targets.length > 1 ? "ambiguous-target-combatant" : "missing-target-combatant",
    };
  }

  const sourceCombatantId = sources[0].id;
  const targetCombatantId = targets[0].id;
  const sourceTurn = state?.lifecycle?.turns?.[sourceCombatantId];
  const sourceIsActive = state?.activeCombatantId === sourceCombatantId;
  const sourceTurnOpen = Boolean(sourceTurn?.startProcessed && !sourceTurn?.endProcessed && !sourceTurn?.skipped);
  if (!sourceIsActive || !sourceTurnOpen) {
    return { supported: false, candidate: true, reason: "source-turn-not-active" };
  }

  const duration = sanitizeOriginalDuration(item.system.duration);
  if (!duration) return { supported: false, candidate: true, reason: "invalid-duration" };
  const durationRounds = Number(duration.value);
  if (duration.expiry === "turn-start" && durationRounds === 0) {
    return { supported: false, candidate: true, reason: "elapsed-start-boundary" };
  }
  const boundary =
    duration.expiry === "turn-start"
      ? SOURCE_LINK_BOUNDARY.SOURCE_START
      : SOURCE_LINK_BOUNDARY.SOURCE_END;
  const dueRound = Number(state.round) + durationRounds;
  const effectUuid = item.uuid ?? `${ownerActorUuid}.Item.${item.id}`;
  return {
    supported: true,
    candidate: true,
    reason: null,
    relationship: {
      id: relationshipId(combat.id, effectUuid),
      combatId: combat.id,
      generation: Math.max(1, Number(state.sourceLinkedTiming?.generation ?? 1)),
      sourceCombatantId,
      targetCombatantId,
      effectUuid,
      effectId: item.id,
      effectActorUuid: ownerActorUuid,
      boundary,
      dueRound,
      createdRound: Number(state.round),
      createdActualTurnId: currentActualTurnId(state, sourceCombatantId),
      originalDuration: duration,
      status: SOURCE_LINK_STATUS.PENDING,
      reason: null,
      detectedAt: Date.now(),
    },
  };
}

async function persistSourceLinkedState(combat, state, reason) {
  const result = await saveState(combat, state, { reason });
  if (!result.ok) throw result.error ?? new Error(result.reason ?? "source-linked-state-save-failed");
  return getState(combat) ?? state;
}

async function protectEffect(item, relationship) {
  await item.update(
    {
      "system.duration": {
        value: -1,
        unit: "unlimited",
        expiry: null,
        sustained: Boolean(relationship.originalDuration?.sustained),
      },
      [`flags.${MODULE_ID}.${ITEM_FLAG}`]: {
        relationshipId: relationship.id,
        originalDuration: relationship.originalDuration,
        protectedAt: Date.now(),
      },
    },
    { [INTERNAL_OPTION]: true },
  );
}

async function restoreEffect(item, relationship) {
  const managed = effectFlag(item);
  if (!item || !managed) return false;
  const original = sanitizeOriginalDuration(
    managed.originalDuration ?? relationship?.originalDuration,
  );
  if (!original) return false;
  await item.update(
    {
      "system.duration": original,
      [`flags.${MODULE_ID}.-=${ITEM_FLAG}`]: null,
    },
    { [INTERNAL_OPTION]: true },
  );
  return true;
}

function reviewRelationshipFor(item, combat, state, reason) {
  const effectUuid = item?.uuid ?? `${item?.actor?.uuid ?? "Actor"}.Item.${item?.id ?? "effect"}`;
  const id = relationshipId(combat.id, effectUuid);
  return {
    id,
    combatId: combat.id,
    generation: Math.max(1, Number(state.sourceLinkedTiming?.generation ?? 1)),
    sourceCombatantId: null,
    targetCombatantId: null,
    effectUuid,
    effectId: item?.id ?? null,
    effectActorUuid: item?.actor?.uuid ?? null,
    boundary: null,
    dueRound: Number(state.round),
    createdRound: Number(state.round),
    createdActualTurnId: null,
    originalDuration: sanitizeOriginalDuration(item?.system?.duration),
    status: SOURCE_LINK_STATUS.REVIEW,
    reason,
    detectedAt: Date.now(),
  };
}

/** Detect and protect one newly created structured Effect item. */
export async function reconcileSourceLinkedItem(item, options = {}) {
  if (options?.[INTERNAL_OPTION] || !isPrimaryGM()) return { changed: false, reason: "not-authority" };
  const combat = getCombat();
  const state = getState(combat);
  if (!combat || !state?.enabled || item?.type !== "effect") return { changed: false, reason: "inactive" };

  return runCombatMutation(combat.id, async () => {
    let liveState = getState(combat) ?? state;
    liveState = structuredClone(liveState);
    liveState.sourceLinkedTiming = normalizeSourceLinkedTiming(
      liveState.sourceLinkedTiming ?? createSourceLinkedTiming(),
    );

    const existingFlag = effectFlag(item);
    if (existingFlag?.relationshipId) {
      const relationship = liveState.sourceLinkedTiming.relationships[existingFlag.relationshipId];
      if (relationship) return { changed: false, reason: "already-managed" };
      liveState.sourceLinkedTiming = upsertSourceLinkedRelationship(
        liveState.sourceLinkedTiming,
        reviewRelationshipFor(item, combat, liveState, "managed-effect-state-missing"),
      );
      await persistSourceLinkedState(combat, liveState, "source-link-review");
      return { changed: true, reason: "managed-effect-state-missing" };
    }

    const inspection = inspectSourceLinkedEffect(item, combat, liveState);
    if (!inspection.candidate) return { changed: false, reason: inspection.reason };
    const priorReview = Object.values(liveState.sourceLinkedTiming.relationships).find(
      (entry) =>
        entry.effectUuid === item.uuid &&
        entry.status === SOURCE_LINK_STATUS.REVIEW &&
        !entry.boundary,
    );
    if (!inspection.supported && priorReview?.reason === inspection.reason) {
      return { changed: false, reason: "review-unchanged" };
    }
    const relationship = inspection.supported
      ? inspection.relationship
      : reviewRelationshipFor(item, combat, liveState, inspection.reason);
    liveState.sourceLinkedTiming = upsertSourceLinkedRelationship(
      liveState.sourceLinkedTiming,
      relationship,
    );
    liveState = await persistSourceLinkedState(combat, liveState, "source-link-detected");

    if (!inspection.supported) {
      sourceLinkDiag("source-link-review", combat, liveState, {
        relationshipId: shortId(relationship.id),
        reason: inspection.reason,
      });
      return { changed: true, reason: inspection.reason };
    }

    try {
      await protectEffect(item, relationship);
      sourceLinkDiag("source-link-detected", combat, liveState, {
        relationshipId: shortId(relationship.id),
        combatantId: shortId(relationship.sourceCombatantId),
        reason: relationship.boundary,
      });
      return { changed: true, reason: "protected" };
    } catch (error) {
      const failedState = structuredClone(getState(combat) ?? liveState);
      failedState.sourceLinkedTiming = markSourceLinkedReview(
        failedState.sourceLinkedTiming,
        relationship.id,
        "effect-protection-failed",
      );
      await persistSourceLinkedState(combat, failedState, "source-link-review");
      console.error(`${MODULE_ID} | source-linked effect protection failed`, {
        relationshipId: shortId(relationship.id),
        reason: error?.message ?? "update-failed",
      });
      return { changed: true, reason: "effect-protection-failed" };
    }
  });
}

async function resolveRelationshipItem(combat, relationship) {
  try {
    const resolved = typeof fromUuid === "function" ? await fromUuid(relationship.effectUuid) : null;
    if (resolved) return resolved;
  } catch (_error) {
    // Fall through to the combatant owner's embedded collection.
  }
  const target = getCombatant(combat, relationship.targetCombatantId);
  return target?.actor?.items?.get?.(relationship.effectId) ?? null;
}

/**
 * Process due source links after the native PF2e boundary reports success.
 * The Effect is protected until then, so a failed/retryable adapter attempt
 * cannot consume source-linked expiry early.
 */
export async function processSourceLinkedBoundary(combat, state, combatantId, kind) {
  if (!combat || !state?.enabled || !isPrimaryGM()) return { state, processed: 0, reviewed: 0 };
  const boundary = kind === "start" ? SOURCE_LINK_BOUNDARY.SOURCE_START : SOURCE_LINK_BOUNDARY.SOURCE_END;
  let next = structuredClone(state);
  next.sourceLinkedTiming = normalizeSourceLinkedTiming(next.sourceLinkedTiming ?? createSourceLinkedTiming());
  const actualTurnId = currentActualTurnId(next, combatantId);
  const processedId = boundaryId({
    combatantId,
    boundary,
    round: next.round,
    actualTurnId,
  });
  const due = dueSourceLinkedRelationships(next.sourceLinkedTiming, {
    combatantId,
    boundary,
    round: next.round,
    generation: next.sourceLinkedTiming.generation,
  });
  let processed = 0;
  let reviewed = 0;

  for (const relationship of due) {
    next.sourceLinkedTiming = markSourceLinkedProcessing(
      next.sourceLinkedTiming,
      relationship.id,
      processedId,
    );
    next = await persistSourceLinkedState(combat, next, "source-link-expiry-pending");
    const item = await resolveRelationshipItem(combat, relationship);
    try {
      if (item) await item.delete({ [INTERNAL_OPTION]: true });
      next = structuredClone(getState(combat) ?? next);
      next.sourceLinkedTiming = markSourceLinkedExpired(
        next.sourceLinkedTiming,
        relationship.id,
        processedId,
      );
      next = await persistSourceLinkedState(combat, next, "source-link-expired");
      const pruned = removeSourceLinkedRelationship(next.sourceLinkedTiming, relationship.id, {
        reason: "expiry-settled",
      });
      next.sourceLinkedTiming = pruned.timing;
      next = await persistSourceLinkedState(combat, next, "source-link-pruned");
      processed += 1;
      sourceLinkDiag("source-link-expired", combat, next, {
        relationshipId: shortId(relationship.id),
        combatantId: shortId(combatantId),
        reason: boundary,
      });
    } catch (error) {
      next = structuredClone(getState(combat) ?? next);
      next.sourceLinkedTiming = markSourceLinkedReview(
        next.sourceLinkedTiming,
        relationship.id,
        "native-effect-delete-failed",
      );
      next = await persistSourceLinkedState(combat, next, "source-link-review");
      reviewed += 1;
      console.error(`${MODULE_ID} | source-linked expiry needs review`, {
        relationshipId: shortId(relationship.id),
        reason: error?.message ?? "delete-failed",
      });
    }
  }
  return { state: next, processed, reviewed };
}

/** Reconcile Escape/item deletion without parsing chat. */
export async function reconcileSourceLinkedItemDeletion(item, options = {}) {
  if (options?.[INTERNAL_OPTION] || !isPrimaryGM()) return { changed: false };
  const combat = getCombat();
  const state = getState(combat);
  if (!combat || !state?.sourceLinkedTiming || !item?.uuid) return { changed: false };
  return runCombatMutation(combat.id, async () => {
    let next = structuredClone(getState(combat) ?? state);
    const timing = normalizeSourceLinkedTiming(next.sourceLinkedTiming);
    const relationship = Object.values(timing.relationships).find((entry) => entry.effectUuid === item.uuid);
    if (!relationship) return { changed: false };
    const removed = removeSourceLinkedRelationship(timing, relationship.id, { reason: "effect-removed" });
    next.sourceLinkedTiming = removed.timing;
    await persistSourceLinkedState(combat, next, "source-link-reconciled");
    sourceLinkDiag("source-link-reconciled", combat, next, {
      relationshipId: shortId(relationship.id),
      reason: "effect-removed",
    });
    return { changed: true };
  });
}

/** Reload/removal reconciliation. Missing combatants restore native duration before pruning. */
export async function reconcileSourceLinkedCombat(
  combat = getCombat(),
  { reason = "reconcile", alreadyQueued = false } = {},
) {
  if (!combat || !isPrimaryGM()) return { changed: false, reason: "not-authority" };
  const state = getState(combat);
  if (!state?.enabled) return { changed: false, reason: "inactive" };

  const work = async () => {
    let next = structuredClone(getState(combat) ?? state);
    let timing = recoverInterruptedSourceLinkedTiming(
      next.sourceLinkedTiming ?? createSourceLinkedTiming(),
    );
    let changed = JSON.stringify(timing) !== JSON.stringify(next.sourceLinkedTiming ?? createSourceLinkedTiming());

    for (const relationship of Object.values(timing.relationships)) {
      if (relationship.status === SOURCE_LINK_STATUS.EXPIRED) continue;
      if (
        relationship.status === SOURCE_LINK_STATUS.REVIEW &&
        (!relationship.boundary || !relationship.sourceCombatantId || !relationship.targetCombatantId)
      ) {
        continue;
      }
      const source = getCombatant(combat, relationship.sourceCombatantId);
      const target = getCombatant(combat, relationship.targetCombatantId);
      const item = await resolveRelationshipItem(combat, relationship);
      if (!item) {
        const removed = removeSourceLinkedRelationship(timing, relationship.id, { reason: "effect-missing" });
        timing = removed.timing;
        changed = true;
        continue;
      }
      if (!source || !target) {
        try {
          await restoreEffect(item, relationship);
        } catch (_error) {
          timing = markSourceLinkedReview(timing, relationship.id, "restore-after-removal-failed");
          changed = true;
          continue;
        }
        const removed = removeSourceLinkedRelationship(timing, relationship.id, {
          reason: !source ? "source-combatant-removed" : "target-combatant-removed",
        });
        timing = removed.timing;
        changed = true;
        continue;
      }
      if (source.actor?.isDead || source.isDefeated) {
        if (
          relationship.status === SOURCE_LINK_STATUS.REVIEW &&
          relationship.reason === "source-defeated-native-owned"
        ) {
          continue;
        }
        try {
          await restoreEffect(item, relationship);
        } catch (_error) {
          // Preserve Review either way; do not delete the PF2e effect.
        }
        timing = markSourceLinkedReview(timing, relationship.id, "source-defeated-native-owned");
        changed = true;
      }
    }

    if (!changed) return { changed: false, reason };
    timing = pushSourceLinkedAudit(timing, "source-link-reconciled", { reason });
    next.sourceLinkedTiming = timing;
    next = await persistSourceLinkedState(combat, next, "source-link-reconciled");
    sourceLinkDiag("source-link-reconciled", combat, next, { reason });
    return { changed: true, reason };
  };

  if (alreadyQueued) return work();
  return runCombatMutation(combat.id, work);
}

/** Restore protected native durations when NelTempo combat ends. */
export async function releaseSourceLinkedEffects(combat, state = getState(combat)) {
  if (!combat || !state?.sourceLinkedTiming || !isPrimaryGM()) return { released: 0 };
  let released = 0;
  for (const relationship of Object.values(normalizeSourceLinkedTiming(state.sourceLinkedTiming).relationships)) {
    if (relationship.status === SOURCE_LINK_STATUS.EXPIRED) continue;
    const item = await resolveRelationshipItem(combat, relationship);
    if (!item) continue;
    try {
      if (await restoreEffect(item, relationship)) released += 1;
    } catch (_error) {
      // Ending combat must not fail because a PF2e document vanished concurrently.
    }
  }
  return { released };
}

export { INTERNAL_OPTION as SOURCE_LINK_INTERNAL_OPTION };
