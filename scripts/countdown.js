/**
 * Pure encounter-countdown helpers for NelTempo 0.3.2.
 * Derived remaining rounds from triggerRound — never mutates on phase/turn.
 */

const MAX_LABEL = 80;
const MIN_ROUNDS = 1;
const MAX_ROUNDS = 99;

export function clampInterfaceScale(value, fallback = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(50, Math.round(n / 5) * 5));
}

export function sanitizeCountdownLabel(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_LABEL);
}

export function sanitizeCountdownRounds(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.trunc(n);
  if (rounded < MIN_ROUNDS || rounded > MAX_ROUNDS) return null;
  return rounded;
}

/**
 * Build countdown record from optional prompt fields.
 * Returns null when either field is missing/invalid.
 */
export function buildCountdownFromPrompt(labelRaw, roundsRaw, { currentRound = 1, userId = null } = {}) {
  const label = sanitizeCountdownLabel(labelRaw);
  const rounds = sanitizeCountdownRounds(roundsRaw);
  if (!label || rounds == null) return null;
  const createdRound = Math.max(1, Number(currentRound) || 1);
  return {
    label,
    triggerRound: createdRound + rounds,
    createdRound,
    createdBy: userId == null ? null : String(userId),
  };
}

export function sanitizeCountdown(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const label = sanitizeCountdownLabel(entry.label);
  const triggerRound = Math.max(1, Math.trunc(Number(entry.triggerRound) || 0));
  if (!label || !Number.isFinite(triggerRound) || triggerRound < 1) return null;
  const createdRound = Math.max(1, Math.trunc(Number(entry.createdRound) || 1) || 1);
  return {
    label,
    triggerRound,
    createdRound,
    createdBy: entry.createdBy == null || entry.createdBy === "" ? null : String(entry.createdBy),
  };
}

/**
 * Remaining rounds until trigger (never negative).
 * At/after trigger → 0 (display as NOW).
 */
export function remainingCountdownRounds(countdown, currentRound) {
  const cleaned = sanitizeCountdown(countdown);
  if (!cleaned) return null;
  const round = Math.max(1, Number(currentRound) || 1);
  return Math.max(0, cleaned.triggerRound - round);
}

export function formatCountdownDisplay(countdown, currentRound) {
  const cleaned = sanitizeCountdown(countdown);
  if (!cleaned) return null;
  const remaining = remainingCountdownRounds(cleaned, currentRound);
  if (remaining == null) return null;
  if (remaining === 0) {
    return {
      label: cleaned.label,
      text: `${cleaned.label}: NOW`,
      remaining: 0,
      isNow: true,
    };
  }
  const unit = remaining === 1 ? "Round" : "Rounds";
  return {
    label: cleaned.label,
    text: `${cleaned.label}: ${remaining} ${unit}`,
    remaining,
    isNow: false,
  };
}

/**
 * Rebuild trigger from a new remaining-rounds value measured from currentRound.
 */
export function rebuildCountdown(existingOrLabel, remainingRounds, { currentRound = 1, userId = null } = {}) {
  const label =
    typeof existingOrLabel === "string"
      ? sanitizeCountdownLabel(existingOrLabel)
      : sanitizeCountdownLabel(existingOrLabel?.label);
  const rounds = sanitizeCountdownRounds(remainingRounds);
  if (!label || rounds == null) return null;
  const round = Math.max(1, Number(currentRound) || 1);
  return {
    label,
    triggerRound: round + rounds,
    createdRound: round,
    createdBy: userId == null ? null : String(userId),
  };
}

export { MAX_LABEL, MIN_ROUNDS, MAX_ROUNDS };
