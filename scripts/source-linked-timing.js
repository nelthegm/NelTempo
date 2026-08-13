/**
 * Pure state helpers for PF2e source-linked Effect timing.
 *
 * This module does not read or mutate Foundry documents. It stores only the
 * relationship needed to bridge PF2e's native initiative-based duration model
 * to NelTempo's existing per-combatant Start/End boundaries.
 */

export const SOURCE_LINK_BOUNDARY = Object.freeze({
  SOURCE_START: "source-start",
  SOURCE_END: "source-end",
  TARGET_START: "target-start",
  TARGET_END: "target-end",
});

export const SOURCE_LINK_STATUS = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  EXPIRED: "expired",
  REVIEW: "review",
});

const BOUNDARIES = new Set(Object.values(SOURCE_LINK_BOUNDARY));
const STATUSES = new Set(Object.values(SOURCE_LINK_STATUS));

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, max = 220) {
  return value == null || value === "" ? null : String(value).slice(0, max);
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

export function createSourceLinkedTiming() {
  return {
    generation: 1,
    relationships: {},
    audit: [],
  };
}

export function relationshipId(combatId, effectUuid) {
  return `${String(combatId ?? "combat")}:${String(effectUuid ?? "effect")}`;
}

export function sanitizeOriginalDuration(duration) {
  if (!isPlainObject(duration)) return null;
  const unit = text(duration.unit, 24);
  const expiry = text(duration.expiry, 24);
  const value = Number(duration.value);
  if (!unit || !Number.isFinite(value)) return null;
  return {
    value,
    unit,
    expiry,
    sustained: Boolean(duration.sustained),
  };
}

export function sanitizeSourceLinkedRelationship(entry, { id = null } = {}) {
  if (!isPlainObject(entry)) return null;
  const relationshipIdValue = text(entry.id ?? id, 500);
  if (!relationshipIdValue) return null;
  const boundary = BOUNDARIES.has(entry.boundary) ? entry.boundary : null;
  const status = STATUSES.has(entry.status) ? entry.status : SOURCE_LINK_STATUS.REVIEW;
  const originalDuration = sanitizeOriginalDuration(entry.originalDuration);
  return {
    id: relationshipIdValue,
    combatId: text(entry.combatId, 80),
    generation: Math.max(1, integer(entry.generation, 1)),
    sourceCombatantId: text(entry.sourceCombatantId, 80),
    targetCombatantId: text(entry.targetCombatantId, 80),
    effectUuid: text(entry.effectUuid, 500),
    effectId: text(entry.effectId, 80),
    effectActorUuid: text(entry.effectActorUuid, 500),
    boundary,
    dueRound: Math.max(1, integer(entry.dueRound, 1)),
    createdRound: Math.max(1, integer(entry.createdRound, 1)),
    createdActualTurnId: text(entry.createdActualTurnId, 220),
    originalDuration,
    status: boundary ? status : SOURCE_LINK_STATUS.REVIEW,
    reason: text(entry.reason, 160),
    detectedAt: Number.isFinite(Number(entry.detectedAt)) ? Number(entry.detectedAt) : Date.now(),
    processedAt:
      entry.processedAt == null || !Number.isFinite(Number(entry.processedAt))
        ? null
        : Number(entry.processedAt),
    processedBoundaryId: text(entry.processedBoundaryId, 220),
  };
}

function sanitizeAudit(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => {
      if (!isPlainObject(entry)) return null;
      return {
        event: text(entry.event, 80) ?? "source-link-review",
        relationshipId: text(entry.relationshipId, 80),
        combatantId: text(entry.combatantId, 16),
        reason: text(entry.reason, 120),
        at: Number.isFinite(Number(entry.at)) ? Number(entry.at) : Date.now(),
      };
    })
    .filter(Boolean)
    .slice(-80);
}

export function normalizeSourceLinkedTiming(value) {
  const source = isPlainObject(value) ? value : createSourceLinkedTiming();
  const timing = {
    generation: Math.max(1, integer(source.generation, 1)),
    relationships: {},
    audit: sanitizeAudit(source.audit),
  };
  for (const [id, entry] of Object.entries(source.relationships ?? {})) {
    const cleaned = sanitizeSourceLinkedRelationship(entry, { id });
    if (cleaned) timing.relationships[cleaned.id] = cleaned;
  }
  return timing;
}

export function pushSourceLinkedAudit(value, event, details = {}) {
  const timing = normalizeSourceLinkedTiming(value);
  timing.audit.push({
    event: text(event, 80) ?? "source-link-review",
    relationshipId: text(details.relationshipId, 80),
    combatantId: text(details.combatantId, 16),
    reason: text(details.reason, 120),
    at: Date.now(),
  });
  timing.audit = timing.audit.slice(-80);
  return timing;
}

export function upsertSourceLinkedRelationship(value, relationship) {
  let timing = normalizeSourceLinkedTiming(value);
  const cleaned = sanitizeSourceLinkedRelationship(relationship);
  if (!cleaned) return timing;
  timing.relationships[cleaned.id] = cleaned;
  timing.generation = Math.max(timing.generation, cleaned.generation);
  timing = pushSourceLinkedAudit(timing, "source-link-detected", {
    relationshipId: cleaned.id,
    combatantId: cleaned.sourceCombatantId,
    reason: cleaned.status,
  });
  return timing;
}

export function removeSourceLinkedRelationship(value, id, { reason = "pruned" } = {}) {
  let timing = normalizeSourceLinkedTiming(value);
  const relationship = timing.relationships[String(id)];
  if (!relationship) return { timing, removed: null };
  delete timing.relationships[String(id)];
  timing = pushSourceLinkedAudit(timing, "source-link-pruned", {
    relationshipId: relationship.id,
    combatantId: relationship.sourceCombatantId,
    reason,
  });
  return { timing, removed: relationship };
}

export function markSourceLinkedReview(value, id, reason) {
  let timing = normalizeSourceLinkedTiming(value);
  const relationship = timing.relationships[String(id)];
  if (!relationship) return timing;
  relationship.status = SOURCE_LINK_STATUS.REVIEW;
  relationship.reason = text(reason, 160) ?? "review";
  timing = pushSourceLinkedAudit(timing, "source-link-review", {
    relationshipId: relationship.id,
    combatantId: relationship.sourceCombatantId,
    reason: relationship.reason,
  });
  return timing;
}

export function boundaryId({ combatantId, boundary, round, actualTurnId = null }) {
  return `${Math.max(1, integer(round, 1))}:${String(combatantId)}:${String(boundary)}:${String(actualTurnId ?? "turn")}`;
}

export function relationshipMatchesBoundary(
  relationship,
  { combatantId, boundary, round, generation = null },
) {
  const entry = sanitizeSourceLinkedRelationship(relationship);
  if (!entry || entry.status !== SOURCE_LINK_STATUS.PENDING) return false;
  if (generation != null && Number(entry.generation) !== Number(generation)) return false;
  if (Number(round) < Number(entry.dueRound)) return false;
  if (entry.boundary !== boundary) return false;
  const ownerId = boundary.startsWith("source-")
    ? entry.sourceCombatantId
    : entry.targetCombatantId;
  return Boolean(ownerId && String(ownerId) === String(combatantId));
}

export function dueSourceLinkedRelationships(value, boundaryContext) {
  const timing = normalizeSourceLinkedTiming(value);
  return Object.values(timing.relationships)
    .filter((entry) => relationshipMatchesBoundary(entry, {
      ...boundaryContext,
      generation: boundaryContext.generation ?? timing.generation,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function markSourceLinkedProcessing(value, id, processedBoundaryId) {
  let timing = normalizeSourceLinkedTiming(value);
  const relationship = timing.relationships[String(id)];
  if (!relationship || relationship.status !== SOURCE_LINK_STATUS.PENDING) return timing;
  relationship.status = SOURCE_LINK_STATUS.PROCESSING;
  relationship.processedBoundaryId = text(processedBoundaryId, 220);
  timing = pushSourceLinkedAudit(timing, "source-link-expiry-pending", {
    relationshipId: relationship.id,
    combatantId: relationship.sourceCombatantId,
    reason: relationship.boundary,
  });
  return timing;
}

export function markSourceLinkedExpired(value, id, processedBoundaryId) {
  let timing = normalizeSourceLinkedTiming(value);
  const relationship = timing.relationships[String(id)];
  if (!relationship) return timing;
  if (
    relationship.status === SOURCE_LINK_STATUS.EXPIRED &&
    relationship.processedBoundaryId === processedBoundaryId
  ) {
    return timing;
  }
  relationship.status = SOURCE_LINK_STATUS.EXPIRED;
  relationship.reason = "boundary-processed";
  relationship.processedAt = Date.now();
  relationship.processedBoundaryId = text(processedBoundaryId, 220);
  timing = pushSourceLinkedAudit(timing, "source-link-expired", {
    relationshipId: relationship.id,
    combatantId: relationship.sourceCombatantId,
    reason: relationship.boundary,
  });
  return timing;
}

export function recoverInterruptedSourceLinkedTiming(value) {
  let timing = normalizeSourceLinkedTiming(value);
  for (const relationship of Object.values(timing.relationships)) {
    if (relationship.status !== SOURCE_LINK_STATUS.PROCESSING) continue;
    relationship.status = SOURCE_LINK_STATUS.REVIEW;
    relationship.reason = "interrupted-boundary";
    timing = pushSourceLinkedAudit(timing, "source-link-review", {
      relationshipId: relationship.id,
      combatantId: relationship.sourceCombatantId,
      reason: relationship.reason,
    });
  }
  return timing;
}

/** Administrative settlement never expires an Effect; due links become Review. */
export function reviewSourceLinkedAdministrativeBoundary(
  value,
  { combatantId, round, boundaries = Object.values(SOURCE_LINK_BOUNDARY), reason = "administrative-boundary" },
) {
  let timing = normalizeSourceLinkedTiming(value);
  const allowed = new Set(boundaries);
  for (const relationship of Object.values(timing.relationships)) {
    if (relationship.status !== SOURCE_LINK_STATUS.PENDING) continue;
    if (Number(relationship.dueRound) > Number(round)) continue;
    if (!allowed.has(relationship.boundary)) continue;
    const ownerId = relationship.boundary?.startsWith("source-")
      ? relationship.sourceCombatantId
      : relationship.targetCombatantId;
    if (String(ownerId) !== String(combatantId)) continue;
    timing = markSourceLinkedReview(timing, relationship.id, reason);
  }
  return timing;
}

export function sourceLinkedInspection(value, combatantId) {
  const timing = normalizeSourceLinkedTiming(value);
  const id = String(combatantId ?? "");
  return Object.values(timing.relationships)
    .filter((entry) => entry.sourceCombatantId === id || entry.targetCombatantId === id)
    .map((entry) => ({
      boundary: entry.boundary,
      status: entry.status,
      reason: entry.reason,
      dueRound: entry.dueRound,
      role: entry.sourceCombatantId === id ? "source" : "target",
      effectId: entry.effectId ? String(entry.effectId).slice(0, 8) : null,
      otherCombatantId:
        entry.sourceCombatantId === id ? entry.targetCombatantId : entry.sourceCombatantId,
    }))
    .sort((a, b) => `${a.boundary}:${a.effectId}`.localeCompare(`${b.boundary}:${b.effectId}`));
}

/** Ordinary reactions and readied actions intentionally have no state reducer. */
export function preserveStateForOutOfTurnActivity(state) {
  return state;
}
