/**
 * Sanitized public lifecycle hooks for integrations.
 * Presentation notifications only — not permission to mutate lifecycle state.
 */

import { MODULE_ID } from "./constants.js";

const HOOKS = Object.freeze({
  PHASE_LIFECYCLE_STARTED: "neltempo.phaseLifecycleStarted",
  COMBATANT_TURN_STARTED: "neltempo.combatantTurnStarted",
  COMBATANT_TURN_READY: "neltempo.combatantTurnReady",
  COMBATANT_TURN_ENDING: "neltempo.combatantTurnEnding",
  COMBATANT_TURN_ENDED: "neltempo.combatantTurnEnded",
  LIFECYCLE_REVIEW: "neltempo.lifecycleReview",
});

export { HOOKS as LIFECYCLE_HOOKS };

function viewerMaySeeActor(combatant) {
  try {
    if (!combatant) return false;
    if (game.user?.isGM) return true;
    if (combatant.hidden) return false;
    const token = combatant.token;
    if (token?.document?.hidden || token?.hidden) return false;
    return true;
  } catch (_error) {
    return false;
  }
}

/**
 * Build a sanitized hook payload. Never includes event IDs, socket envelopes, or HP.
 */
export function buildLifecycleHookPayload({
  combat,
  state,
  combatantId = null,
  boundary = null,
  lifecycleState = null,
} = {}) {
  const combatant =
    combatantId && combat
      ? combat.combatants?.get?.(combatantId) ??
        combat.combatants?.find?.((c) => c.id === combatantId) ??
        null
      : null;
  const authorized = viewerMaySeeActor(combatant);
  return {
    combatId: combat?.id ?? null,
    round: Number(state?.round ?? combat?.round ?? 1) || 1,
    phase: state?.phase ?? state?.lifecycle?.phase ?? null,
    combatantId: combatantId == null ? null : String(combatantId),
    actorId: authorized && combatant?.actor?.id ? String(combatant.actor.id) : null,
    tokenId: authorized && combatant?.tokenId ? String(combatant.tokenId) : null,
    boundary: boundary == null ? null : String(boundary),
    state: lifecycleState == null ? null : String(lifecycleState),
  };
}

export function emitLifecycleHook(name, payload) {
  try {
    if (typeof Hooks === "undefined" || typeof Hooks.callAll !== "function") return;
    Hooks.callAll(name, payload);
  } catch (error) {
    console.warn(`${MODULE_ID} | lifecycle hook failed`, name, error);
  }
}

export function emitPhaseLifecycleStarted(combat, state) {
  emitLifecycleHook(
    HOOKS.PHASE_LIFECYCLE_STARTED,
    buildLifecycleHookPayload({ combat, state, lifecycleState: "starting" }),
  );
}

export function emitCombatantTurnStarted(combat, state, combatantId) {
  emitLifecycleHook(
    HOOKS.COMBATANT_TURN_STARTED,
    buildLifecycleHookPayload({
      combat,
      state,
      combatantId,
      boundary: "start",
      lifecycleState: "processing",
    }),
  );
}

export function emitCombatantTurnReady(combat, state, combatantId) {
  emitLifecycleHook(
    HOOKS.COMBATANT_TURN_READY,
    buildLifecycleHookPayload({
      combat,
      state,
      combatantId,
      boundary: "start",
      lifecycleState: "complete",
    }),
  );
}

export function emitCombatantTurnEnding(combat, state, combatantId) {
  emitLifecycleHook(
    HOOKS.COMBATANT_TURN_ENDING,
    buildLifecycleHookPayload({
      combat,
      state,
      combatantId,
      boundary: "end",
      lifecycleState: "processing",
    }),
  );
}

export function emitCombatantTurnEnded(combat, state, combatantId) {
  emitLifecycleHook(
    HOOKS.COMBATANT_TURN_ENDED,
    buildLifecycleHookPayload({
      combat,
      state,
      combatantId,
      boundary: "end",
      lifecycleState: "complete",
    }),
  );
}

export function emitLifecycleReview(combat, state, combatantId, boundary) {
  emitLifecycleHook(
    HOOKS.LIFECYCLE_REVIEW,
    buildLifecycleHookPayload({
      combat,
      state,
      combatantId,
      boundary,
      lifecycleState: "review",
    }),
  );
}
