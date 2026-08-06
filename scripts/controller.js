import { AUTO_ADVANCE, MODULE_ID, MODULE_TITLE, REQUESTS, SETTINGS, SOCKET_NAME, TURN_LIFECYCLE_AUTOMATION, PHASE_LIFECYCLE_SUMMARY } from "./constants.js";
import {
  buildCountdownFromPrompt,
  rebuildCountdown,
} from "./countdown.js";
import { createGmOnlyChat } from "./gm-chat.js";
import {
  PHASES,
  beginRoundTransition,
  createState,
  delayToRearguard,
  markActed,
  normalizeUndoRestore,
  reclassifyResults,
  resultForCurrentRound,
  submitResult,
  undoState,
  withHistory,
  combatantPhase,
} from "./state.js";
import {
  BOUNDARY_STATUS,
  LIFECYCLE_STATUS,
  beginEndBoundary,
  beginStartBoundary,
  buildRosterIds,
  canEndTurn,
  canReopenTurn,
  completeEndBoundary,
  completeStartBoundary,
  createLifecycle,
  endCandidates,
  isLifecyclePhase,
  lifecycleProgress,
  markCombatantEndProcessing,
  markCombatantEndResult,
  markCombatantStartProcessing,
  markCombatantStartResult,
  markTurnEnded,
  markTurnSkipped,
  phaseAdvanceReady,
  reopenTurn,
  skipFailedEnds,
  skipFailedStarts,
  skipPendingEnds,
  skipRemainingTurns,
  startCandidates,
  undoCrossesPhaseEnd,
  getCombatantLifecycleStatus,
} from "./lifecycle.js";
import {
  emitCombatantTurnEnded,
  emitCombatantTurnEnding,
  emitCombatantTurnReady,
  emitCombatantTurnStarted,
  emitLifecycleReview,
  emitPhaseLifecycleStarted,
} from "./lifecycle-hooks.js";
import { adapterReasonMessage, processEndTurn, processStartTurn } from "./pf2e-lifecycle-adapter.js";
import { clearManagedRaisedShields, expireDefensesForCombatant, expireDueRaisedShields } from "./shields.js";
import {
  applyEndTurnTiming,
  applyReopenTiming,
  isTimingEnforced,
  reconcileTimingState,
  refreshCombatantTiming,
} from "./timing-service.js";
import {
  PLACEMENTS,
  PLACEMENT_METHODS,
  PLACEMENT_MODES,
  appendToOpenRoster,
  applyCurrentRoundPlacement,
  buildEditorProjection,
  cancelQueuedCorrection,
  destinationIsCurrent,
  evaluatePlacementOptions,
  hasStartBoundaryThisRound,
  leaveOpenRoster,
  pushPlacementAudit,
  queueNextRoundCorrection,
  undoCrossesPlacementStart,
} from "./placement-editor.js";
import {
  TIMING_OVERRIDE,
  consumeTimingOverride,
  clearTimingOverride,
  evaluateDelayEligibility,
  evaluateEndTurnEligibility,
  evaluateReopenEligibility,
  grantTimingOverride,
  markPriorityResolved,
  pushTimingAudit,
  recomputePriorityGate,
  ensureTiming,
} from "./timing.js";
import {
  activePlayerOwners,
  clearNativeTurn,
  combatantIdList,
  combatantName,
  combatantSide,
  debug,
  diag,
  getCombat,
  getCombatant,
  getState,
  isPrimaryGM,
  isUnavailable,
  isUnconscious,
  notify,
  runCombatMutation,
  saveState,
  safeCombatUpdate,
  resetPartyNativeInitiative,
  setNativeTurn,
  shortId,
  socketPayload,
  userCanOwnCombatant,
} from "./utils.js";

/** In-flight phase transition promises keyed by combat id (join, do not double-run). */
const phaseTransitionLocks = new Map();
/** Guard automatic-advance prompts so multi-GM does not spam. */
const autoAdvancePrompted = new Set();

function publicChat(content) {
  return ChatMessage.create({ content, speaker: { alias: MODULE_TITLE } });
}

function gmOnlyChat(content) {
  return createGmOnlyChat(content);
}

function delayBlockMessage(blockReason) {
  if (blockReason === "confused") return localize("NDI.Timing.CannotDelayConfused");
  if (blockReason === "restrained") return localize("NDI.Timing.CannotDelayRestrained");
  if (blockReason === "grabbed") return localize("NDI.Timing.CannotDelayGrabbed");
  return localize("NDI.Timing.DelayBlocked");
}

function endTurnRejectMessage(reason) {
  if (reason === "waiting-for-confused") return localize("NDI.Timing.ResolveConfusedFirst");
  if (reason === "waiting-for-priority-combatant") return localize("NDI.Timing.WaitingForPriority");
  if (reason === "priority-order-changed") return localize("NDI.Timing.PriorityOrderChanged");
  if (reason === "combatant-not-current-priority") return localize("NDI.Timing.WaitingForPriority");
  return localize("NDI.Lifecycle.CannotEndTurn");
}

function defaultEnemyDC(combat) {
  const modifiers = combat.combatants
    .filter((combatant) => combatantSide(combatant) === "enemy")
    .map((combatant) => Number(combatant.actor?.initiative?.mod ?? combatant.actor?.system?.initiative?.totalModifier ?? NaN))
    .filter(Number.isFinite);
  return modifiers.length ? 10 + Math.max(...modifiers) : 10;
}

async function persistState(combat, state, reason) {
  const result = await saveState(combat, state, { reason });
  if (!result.ok) {
    throw result.error ?? new Error(result.reason ?? "Failed to save Dynamic Initiative state.");
  }
  return result;
}

async function mustUpdateCombat(combat, changes) {
  const result = await safeCombatUpdate(combat, changes);
  if (!result.ok) {
    throw result.error ?? new Error(result.reason ?? "Combat update failed.");
  }
  return result;
}

async function ensureCombat() {
  let combat = getCombat();
  if (!combat) {
    const controlled = canvas?.tokens?.controlled ?? [];
    if (!controlled.length) {
      notify("warn", game.i18n.localize("NDI.Notify.SelectTokens"));
      return null;
    }
    const CombatClass = CONFIG.Combat.documentClass;
    combat = await CombatClass.create({ scene: canvas.scene.id, active: true });
    await combat.createEmbeddedDocuments(
      "Combatant",
      controlled.map((token) => ({
        tokenId: token.id,
        sceneId: canvas.scene.id,
        actorId: token.actor?.id,
        hidden: token.document.hidden,
      })),
    );
  }

  // Dynamic Initiative owns the active-turn flow.  Starting Foundry's normal
  // tracker would immediately activate its first sorted combatant and fire a
  // native turn boundary before the Initiative phase has finished.  Set the
  // encounter to round 1 with no active native turn instead.
  if (!combat.started || Number(combat.round || 0) < 1) {
    await mustUpdateCombat(combat, { round: 1, turn: null });
  } else if (combat.turn != null) {
    await mustUpdateCombat(combat, { turn: null });
  }
  return combat;
}

function validateRequestUser(payload) {
  const user = game.users.get(payload.userId);
  if (!user) throw new Error(game.i18n.localize("NDI.Error.UserInactive"));
  if (!user.active) throw new Error(game.i18n.localize("NDI.Error.UserInactive"));
  return user;
}

/** START / PROMPT must be GM-authorized at every entry point (UI, API, socket). */
export function isGmEntryRequest(type) {
  return type === REQUESTS.START || type === REQUESTS.PROMPT;
}

function requireRequestUserIsGm(requestUser) {
  if (!requestUser?.isGM) throw new Error(localize("NDI.Error.GmOnly"));
  return requestUser;
}

function localize(key, data) {
  try {
    return data ? game.i18n.format(key, data) : game.i18n.localize(key);
  } catch (_error) {
    return key;
  }
}

/**
 * Build deterministic roster descriptors from the live encounter.
 * Ordering: higher initiative total first, then combatant id.
 */
function rosterDescriptors(combat, state) {
  return [...combat.combatants]
    .filter((combatant) => combatant?.id && !isUnavailable(combatant))
    .map((combatant) => {
      const side = combatantSide(combatant);
      const result = resultForCurrentRound(state, combatant.id);
      return {
        id: combatant.id,
        side,
        phase: combatantPhase(state, combatant.id, side),
        initiativeTotal: result?.total ?? null,
        delayed: Boolean(state.delayed?.[combatant.id]),
      };
    });
}

function snapshotRoster(combat, state, phase) {
  return buildRosterIds(rosterDescriptors(combat, state), phase);
}

function lifecycleDiag(event, combat, state, extra = {}) {
  const lifecycle = state?.lifecycle;
  diag(event, {
    combatId: shortId(combat?.id),
    phase: state?.phase ?? lifecycle?.phase,
    round: state?.round ?? lifecycle?.round,
    phaseInstanceId: shortId(lifecycle?.phaseInstanceId),
    status: lifecycle?.status,
    revision: Number(state?.revision ?? 0),
    ...extra,
  });
}

/* -------------------------------------------- */
/*  Start / end boundary processing             */
/* -------------------------------------------- */

/**
 * Read the world setting live at the advancement boundary.
 * Exact registered key: guardIncompletePhase (default true).
 */
export function shouldGuardIncompletePhase() {
  try {
    return game.settings.get(MODULE_ID, SETTINGS.GUARD_INCOMPLETE_PHASE) === true;
  } catch (_error) {
    return true;
  }
}

function turnLifecycleAutomationMode() {
  try {
    return game.settings.get(MODULE_ID, SETTINGS.TURN_LIFECYCLE_AUTOMATION) ?? TURN_LIFECYCLE_AUTOMATION.NATIVE;
  } catch (_error) {
    return TURN_LIFECYCLE_AUTOMATION.NATIVE;
  }
}

function phaseLifecycleSummaryMode() {
  try {
    return game.settings.get(MODULE_ID, SETTINGS.PHASE_LIFECYCLE_SUMMARY) ?? PHASE_LIFECYCLE_SUMMARY.GM;
  } catch (_error) {
    return PHASE_LIFECYCLE_SUMMARY.GM;
  }
}

function guardIncompletePhaseEnabled() {
  return shouldGuardIncompletePhase();
}

function allowAdvanceWithoutProcessing() {
  try {
    return game.settings.get(MODULE_ID, SETTINGS.ALLOW_ADVANCE_WITHOUT_PROCESSING) !== false;
  } catch (_error) {
    return true;
  }
}

async function maybePostPhaseLifecycleSummary(combat, state, lines) {
  const mode = phaseLifecycleSummaryMode();
  if (mode === PHASE_LIFECYCLE_SUMMARY.OFF || !lines?.length) return;
  const label = String(state.phase ?? "").replace(/^\w/, (c) => c.toUpperCase());
  const body = `<h3>${label} Begins</h3><p>Start-of-turn effects:</p><ul>${lines
    .map((line) => `<li>${line}</li>`)
    .join("")}</ul>`;
  if (mode === PHASE_LIFECYCLE_SUMMARY.GM) {
    await createGmOnlyChat(body);
    return;
  }
  await publicChat(body);
}

async function runStartBoundary(
  combat,
  state,
  { onlyFailedOrInterrupted = false, onlyCombatantIds = null } = {},
) {
  let next = beginStartBoundary(state);
  await persistState(combat, next, "phase-start-begin");
  lifecycleDiag("phase-start-begin", combat, next);
  emitPhaseLifecycleStarted(combat, next);

  let candidates = startCandidates(next.lifecycle, { onlyFailedOrInterrupted });
  if (Array.isArray(onlyCombatantIds) && onlyCombatantIds.length) {
    const allow = new Set(onlyCombatantIds.map(String));
    candidates = candidates.filter((id) => allow.has(String(id)));
  }
  let anyFailed = false;
  const summaryLines = [];
  const automation = turnLifecycleAutomationMode();

  for (const combatantId of candidates) {
    // Re-read live state for phaseInstanceId / presence guards.
    const live = getState(combat) ?? next;
    if (live.lifecycle?.phaseInstanceId !== next.lifecycle.phaseInstanceId) {
      lifecycleDiag("lifecycle-interrupted", combat, live, { reason: "instance-mismatch" });
      break;
    }
    if (!getCombatant(combat, combatantId)) {
      next = markCombatantStartResult(next, combatantId, {
        ok: false,
        skipped: true,
        reason: "removed-combatant",
      });
      await persistState(combat, next, "combatant-start-skipped");
      continue;
    }
    const priorStatus = next.lifecycle.turns?.[combatantId]?.startStatus;
    if (priorStatus === BOUNDARY_STATUS.COMPLETED || priorStatus === BOUNDARY_STATUS.SKIPPED) {
      continue;
    }

    // Honor PF2e same-round guards (e.g. Delay to Rearguard after Vanguard start).
    const liveCombatant = getCombatant(combat, combatantId);
    const roundOfLastTurn = Number(liveCombatant?.roundOfLastTurn ?? liveCombatant?.flags?.pf2e?.roundOfLastTurn ?? NaN);
    if (Number.isFinite(roundOfLastTurn) && roundOfLastTurn === Number(next.round ?? combat.round)) {
      next = markCombatantStartResult(next, combatantId, { ok: true });
      next = await expireDefensesForCombatant(combat, next, combatantId);
      await persistState(combat, next, "combatant-start-already");
      emitCombatantTurnReady(combat, next, combatantId);
      lifecycleDiag("combatant-start-complete", combat, next, {
        combatantId: shortId(combatantId),
        reason: "already-started-this-round",
      });
      continue;
    }

    next = markCombatantStartProcessing(next, combatantId);
    await persistState(combat, next, "combatant-start-processing");
    emitCombatantTurnStarted(combat, next, combatantId);
    lifecycleDiag("combatant-start-begin", combat, next, {
      combatantId: shortId(combatantId),
      boundary: "start",
    });

    let result = { ok: true, nativeMethod: null, reason: null };
    if (automation === TURN_LIFECYCLE_AUTOMATION.NATIVE) {
      result = await processStartTurn(combat, combatantId);
    } else if (automation === TURN_LIFECYCLE_AUTOMATION.REMINDERS) {
      summaryLines.push(
        localize("NDI.Lifecycle.Summary.ReminderStart", { name: combatantName(liveCombatant) }),
      );
      result = { ok: true, nativeMethod: "reminder", reason: null };
    } else {
      result = { ok: true, nativeMethod: "tracking-only", reason: null };
    }

    if (result.ok) {
      next = markCombatantStartResult(next, combatantId, { ok: true });
      next = await expireDefensesForCombatant(combat, next, combatantId);
      emitCombatantTurnReady(combat, next, combatantId);
      if (automation === TURN_LIFECYCLE_AUTOMATION.NATIVE) {
        summaryLines.push(
          localize("NDI.Lifecycle.Summary.StartProcessed", { name: combatantName(liveCombatant) }),
        );
      }
      lifecycleDiag("combatant-start-complete", combat, next, {
        combatantId: shortId(combatantId),
        nativeMethod: result.nativeMethod,
      });
    } else {
      anyFailed = true;
      next = markCombatantStartResult(next, combatantId, {
        ok: false,
        reason: adapterReasonMessage(result),
      });
      emitLifecycleReview(combat, next, combatantId, "start");
      summaryLines.push(
        localize("NDI.Lifecycle.Summary.StartReview", { name: combatantName(liveCombatant) }),
      );
      lifecycleDiag("combatant-start-failed", combat, next, {
        combatantId: shortId(combatantId),
        reason: adapterReasonMessage(result),
      });
    }
    await persistState(combat, next, result.ok ? "combatant-start-complete" : "combatant-start-failed");
    // Continue siblings — one failure must not freeze the entire phase.
  }

  next = completeStartBoundary(next, { error: false });
  const reconciled = reconcileTimingState(combat, next, { reason: "phase-open" });
  next = reconciled.state;
  await persistState(combat, next, "phase-open");
  lifecycleDiag("phase-open", combat, next, {
    timingGate: Boolean(next.lifecycle?.timing?.priorityGate?.active),
    adapterFailures: reconciled.adapterFailures,
    anyFailed,
  });
  if (anyFailed) {
    notify("warn", localize("NDI.Lifecycle.StartReviewNeeded"));
  }
  if (reconciled.adapterFailures > 0) {
    notify("warn", localize("NDI.Timing.AdapterWarning"));
  }
  await maybePostPhaseLifecycleSummary(combat, next, summaryLines);
  return next;
}

/**
 * Run native end-of-turn for one combatant (authoritative GM). Idempotent.
 */
async function processIndividualEndTurn(combat, state, combatantId, { userId = null } = {}) {
  let next = state;
  const id = String(combatantId);
  const turn = next.lifecycle?.turns?.[id];
  if (!turn) return { state: next, ok: false, reason: "missing-turn" };
  if (turn.endStatus === BOUNDARY_STATUS.COMPLETED || turn.endStatus === BOUNDARY_STATUS.SKIPPED) {
    return { state: next, ok: true, reason: "already-complete" };
  }

  const liveCombatant = getCombatant(combat, id);
  const roundOfLastEnd = Number(liveCombatant?.flags?.pf2e?.roundOfLastTurnEnd ?? NaN);
  const endRound = Number(next.round ?? combat.round);
  if (Number.isFinite(roundOfLastEnd) && roundOfLastEnd === endRound) {
    next = markCombatantEndResult(next, id, { ok: true });
    return { state: next, ok: true, reason: "already-ended-this-round" };
  }

  next = markCombatantEndProcessing(next, id);
  await persistState(combat, next, "combatant-end-processing");
  emitCombatantTurnEnding(combat, next, id);

  const automation = turnLifecycleAutomationMode();
  let result = { ok: true, nativeMethod: "tracking-only", reason: null };
  if (automation === TURN_LIFECYCLE_AUTOMATION.NATIVE) {
    result = await processEndTurn(combat, id, { round: next.round });
  } else if (automation === TURN_LIFECYCLE_AUTOMATION.REMINDERS) {
    notify("info", localize("NDI.Lifecycle.ReminderEnd", { name: combatantName(liveCombatant) }));
    result = { ok: true, nativeMethod: "reminder", reason: null };
  }

  if (!result.ok) {
    next = markCombatantEndResult(next, id, { ok: false, reason: adapterReasonMessage(result) });
    await persistState(combat, next, "combatant-end-failed");
    emitLifecycleReview(combat, next, id, "end");
    return { state: next, ok: false, reason: adapterReasonMessage(result) };
  }

  next = markCombatantEndResult(next, id, { ok: true });
  const after = next.lifecycle?.turns?.[id];
  if (after && !after.ended && !after.skipped) {
    const marked = markTurnEnded(next, id, { userId });
    next = marked.changed ? applyEndTurnTiming(marked.state, id) : next;
  } else {
    // Legacy ended-without-endStatus (or already flagged): sync phase COMPLETE when all resolved.
    const progress = lifecycleProgress(next.lifecycle);
    if (progress.complete && next.lifecycle.status === LIFECYCLE_STATUS.OPEN) {
      next = structuredClone(next);
      next.lifecycle.status = LIFECYCLE_STATUS.COMPLETE;
    }
  }
  await persistState(combat, next, "combatant-end-complete");
  emitCombatantTurnEnded(combat, next, id);
  return { state: next, ok: true, reason: null };
}

/**
 * Formal phase-leave bookkeeping only — does not invoke PF2e end-of-turn.
 * Individual End Turn (or Process Remaining) owns native end processing.
 */
async function finalizePhaseLeave(combat, state, { forced = false } = {}) {
  let next = beginEndBoundary(state, { forced });
  const leftovers = endCandidates(next.lifecycle);
  for (const id of leftovers) {
    next = markCombatantEndResult(next, id, {
      ok: false,
      skipped: true,
      reason: forced ? "advance-without-processing" : "phase-leave-settled",
    });
  }
  next = completeEndBoundary(next, { error: false });
  await persistState(combat, next, "phase-ended");
  lifecycleDiag("phase-ended", combat, next, { forced: Boolean(forced) });
  return { state: next, ok: true };
}

/** Recovery path for failed individual ends — still may invoke native end once. */
async function runEndBoundary(combat, state, { onlyFailedOrInterrupted = false, forced = false } = {}) {
  let next = beginEndBoundary(state, { forced });
  await persistState(combat, next, "phase-end-begin");
  lifecycleDiag("phase-end-begin", combat, next, { forced: Boolean(forced) });

  const candidates = endCandidates(next.lifecycle, { onlyFailedOrInterrupted });
  let failed = false;

  for (const combatantId of candidates) {
    const live = getState(combat) ?? next;
    if (live.lifecycle?.phaseInstanceId !== next.lifecycle.phaseInstanceId) {
      lifecycleDiag("lifecycle-interrupted", combat, live, { reason: "instance-mismatch" });
      break;
    }
    if (!getCombatant(combat, combatantId)) {
      next = markCombatantEndResult(next, combatantId, {
        ok: false,
        skipped: true,
        reason: "removed-combatant",
      });
      await persistState(combat, next, "combatant-end-skipped");
      continue;
    }
    const priorStatus = next.lifecycle.turns?.[combatantId]?.endStatus;
    if (priorStatus === BOUNDARY_STATUS.COMPLETED || priorStatus === BOUNDARY_STATUS.SKIPPED) {
      continue;
    }

    const liveCombatant = getCombatant(combat, combatantId);
    const roundOfLastEnd = Number(liveCombatant?.flags?.pf2e?.roundOfLastTurnEnd ?? NaN);
    const endRound = Number(next.round ?? combat.round);
    if (Number.isFinite(roundOfLastEnd) && roundOfLastEnd === endRound) {
      next = markCombatantEndResult(next, combatantId, { ok: true });
      await persistState(combat, next, "combatant-end-already");
      lifecycleDiag("combatant-end-complete", combat, next, {
        combatantId: shortId(combatantId),
        reason: "already-ended-this-round",
      });
      continue;
    }

    next = markCombatantEndProcessing(next, combatantId);
    await persistState(combat, next, "combatant-end-processing");
    lifecycleDiag("combatant-end-begin", combat, next, {
      combatantId: shortId(combatantId),
      boundary: "end",
    });

    const result = await processEndTurn(combat, combatantId, { round: next.round });
    if (result.ok) {
      next = markCombatantEndResult(next, combatantId, { ok: true });
      lifecycleDiag("combatant-end-complete", combat, next, {
        combatantId: shortId(combatantId),
        nativeMethod: result.nativeMethod,
      });
    } else {
      failed = true;
      next = markCombatantEndResult(next, combatantId, {
        ok: false,
        reason: adapterReasonMessage(result),
      });
      emitLifecycleReview(combat, next, combatantId, "end");
      lifecycleDiag("combatant-end-failed", combat, next, {
        combatantId: shortId(combatantId),
        reason: adapterReasonMessage(result),
      });
    }
    await persistState(combat, next, result.ok ? "combatant-end-complete" : "combatant-end-failed");

    if (failed) break;
  }

  if (failed) {
    next = completeEndBoundary(next, { error: true });
    await persistState(combat, next, "phase-end-error");
    lifecycleDiag("lifecycle-error", combat, next, { boundary: "end" });
    notify("error", localize("NDI.Lifecycle.EndFailed"));
    return { state: next, ok: false };
  }

  next = completeEndBoundary(next, { error: false });
  await persistState(combat, next, "phase-ended");
  lifecycleDiag("phase-ended", combat, next);
  return { state: next, ok: true };
}

/**
 * Enter a lifecycle phase: snapshot roster, run starts, open for play.
 */
async function enterLifecyclePhase(combat, state, targetPhase) {
  const roster = snapshotRoster(combat, state, targetPhase);
  let next = withHistory(state, `Enter ${targetPhase} phase`);
  next.phase = targetPhase;
  next.activeCombatantId = null;
  if (targetPhase === PHASES.ENEMY) {
    next.enemyPhaseSerial = Number(next.enemyPhaseSerial || 0) + 1;
  }
  if (state.phase === PHASES.INITIATIVE) {
    next.initialInitiativePending = false;
    next.promptOpen = false;
  }

  const lifecycle = createLifecycle({
    phase: targetPhase,
    round: next.round,
    roster,
  });
  next.lifecycle = lifecycle;
  next.lifecycle.status = LIFECYCLE_STATUS.PREPARING;

  await clearNativeTurn(combat);
  await persistState(combat, next, "phase-lifecycle-created");
  lifecycleDiag("phase-lifecycle-created", combat, next, {
    roster: roster.length,
  });
  lifecycleDiag("phase-roster-snapshotted", combat, next, {
    roster: roster.map(shortId).join(","),
  });

  next = await runStartBoundary(combat, next);
  return next;
}

/**
 * Full phase transition transaction (authoritative GM only).
 */
async function transitionToPhase(combat, state, targetPhase, options = {}) {
  const lockKey = combat.id;
  if (phaseTransitionLocks.has(lockKey)) {
    return phaseTransitionLocks.get(lockKey);
  }

  const run = (async () => {
    try {
      let next = state;
      const processRemaining = Boolean(options.processRemaining);
      const force = Boolean(options.force);

      // Leaving a lifecycle phase: individual End Turn owns native end.
      // Phase leave only finalizes bookkeeping unless Process Remaining / skip is requested.
      if (isLifecyclePhase(state.phase) && state.lifecycle) {
        const lc = state.lifecycle;
        const endDone =
          lc.status === LIFECYCLE_STATUS.ENDED || lc.end?.status === BOUNDARY_STATUS.COMPLETED;

        if (!endDone) {
          if (
            [LIFECYCLE_STATUS.STARTING, LIFECYCLE_STATUS.PREPARING, LIFECYCLE_STATUS.ENDING].includes(
              lc.status,
            )
          ) {
            notify("warn", localize("NDI.Lifecycle.TransitionBusy"));
            return state;
          }
          if (lc.status === LIFECYCLE_STATUS.ERROR || lc.status === LIFECYCLE_STATUS.INTERRUPTED) {
            notify("warn", localize("NDI.Lifecycle.ManualReviewRequired"));
            return state;
          }

          const ready = phaseAdvanceReady(lc, { combatantIds: combatantIdList(combat) });
          const guardEnabled = shouldGuardIncompletePhase();

          // Guard Incomplete Phase = false: never block; skip pending ends; advance immediately.
          if (!ready && !force && !processRemaining && !guardEnabled) {
            const skipped = skipRemainingTurns(next, {
              userId: game.user.id,
              reason: "guard-disabled-advance",
            });
            next = skipped.state;
            const pending = skipPendingEnds(next, { reason: "guard-disabled-advance" });
            next = pending.state;
            lifecycleDiag("phase-advanced-unguarded", combat, next, {
              skipped: skipped.skipped.length,
              endsSkipped: pending.skipped.length,
            });
          } else if (!ready && !force && !processRemaining && guardEnabled) {
            // Incomplete with guard on: never warn-and-return as the only path.
            // UI should open the dialog; if SET_PHASE arrives here, refuse without trapping
            // (clients must use Process Remaining or Force Advance).
            const progress = lifecycleProgress(lc, { combatantIds: combatantIdList(combat) });
            notify(
              "warn",
              localize("NDI.Lifecycle.CannotAdvanceUseDialog", {
                count: progress.remaining.length,
              }),
            );
            return state;
          }

          if (processRemaining) {
            const roster = [...(next.lifecycle?.roster ?? [])];
            for (const combatantId of roster) {
              const turn = next.lifecycle?.turns?.[combatantId];
              if (!turn) continue;
              if (turn.endStatus === BOUNDARY_STATUS.COMPLETED || turn.endStatus === BOUNDARY_STATUS.SKIPPED) {
                continue;
              }
              const processed = await processIndividualEndTurn(combat, next, combatantId, {
                userId: game.user.id,
              });
              next = processed.state;
              if (!processed.ok) {
                notify("error", localize("NDI.Lifecycle.ProcessRemainingFailed"));
                return next;
              }
            }
            if (!phaseAdvanceReady(next.lifecycle, { combatantIds: combatantIdList(combat) })) {
              notify("warn", localize("NDI.Lifecycle.ProcessRemainingIncomplete"));
              return next;
            }
          } else if (force) {
            // Explicit GM Advance Without Processing — always available to primary GM.
            const skipped = skipRemainingTurns(next, { userId: game.user.id });
            next = skipped.state;
            const pending = skipPendingEnds(next, { reason: "advance-without-processing" });
            next = pending.state;
            lifecycleDiag("phase-force-advanced", combat, next, {
              skipped: skipped.skipped.length,
              endsSkipped: pending.skipped.length,
            });
          }

          if (state.phase === PHASES.ENEMY && targetPhase !== PHASES.ENEMY) {
            next = await expireDueRaisedShields(combat, next);
          }

          const leave = await finalizePhaseLeave(combat, next, { forced: force });
          next = leave.state;
          if (!leave.ok) return next;
        } else if (state.phase === PHASES.ENEMY && targetPhase !== PHASES.ENEMY) {
          next = await expireDueRaisedShields(combat, next);
        }
      }

      // Enter next phase.
      if (targetPhase === PHASES.INITIATIVE) {
        next = beginRoundTransition(next);
        // beginRoundTransition already increments round and clears lifecycle.
        await mustUpdateCombat(combat, { round: next.round, turn: null });
        await resetPartyNativeInitiative(combat);
        await persistState(combat, next, "phase-change-initiative");
        lifecycleDiag("phase-change-complete", combat, next);
        await publicChat(`<h3>Round ${next.round}: Initiative Phase</h3>`);
        return next;
      }

      if (isLifecyclePhase(targetPhase)) {
        next = await enterLifecyclePhase(combat, next, targetPhase);
        const label = targetPhase.charAt(0).toUpperCase() + targetPhase.slice(1);
        await publicChat(`<h3>Round ${next.round}: ${label} Phase</h3>`);
        return next;
      }

      next = setPhase(next, targetPhase);
      await clearNativeTurn(combat);
      await persistState(combat, next, "phase-change");
      return next;
    } finally {
      phaseTransitionLocks.delete(lockKey);
    }
  })();

  phaseTransitionLocks.set(lockKey, run);
  return run;
}

/* -------------------------------------------- */
/*  Core request handlers                       */
/* -------------------------------------------- */

async function startDynamicInitiative(payload = {}) {
  const combat = await ensureCombat();
  if (!combat) return;
  const existing = getState(combat);
  if (existing?.enabled) {
    notify("info", localize("NDI.Notify.AlreadyActive"));
    return;
  }

  const state = createState({
    round: Math.max(1, Number(combat.round || 1)),
    enemyDC: defaultEnemyDC(combat),
    suggestedSkill: "last-used",
  });
  const countdown = buildCountdownFromPrompt(payload.countdownLabel, payload.countdownRounds, {
    currentRound: state.round,
    userId: game.user?.id ?? null,
  });
  if (countdown) state.countdown = countdown;

  await persistState(combat, state, "start");
  await mustUpdateCombat(combat, { round: state.round, turn: null });
  await resetPartyNativeInitiative(combat);
  await gmOnlyChat(
    `<h3>${localize("NDI.Chat.StartedTitle")}</h3><p>${localize("NDI.Chat.StartedBody")}</p>`,
  );
}

async function setCountdown(combat, state, payload, requestUser) {
  if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
  const live = getState(combat) ?? state;
  let next = withHistory(live, "Set encounter countdown");
  if (payload.clear) {
    next.countdown = null;
  } else {
    const rebuilt = rebuildCountdown(payload.label ?? live.countdown?.label, payload.rounds, {
      currentRound: live.round,
      userId: requestUser.id,
    });
    if (!rebuilt) throw new Error(localize("NDI.Countdown.Invalid"));
    next.countdown = rebuilt;
  }
  await persistState(combat, next, "countdown-set");
}

async function clearCountdown(combat, state, payload, requestUser) {
  return setCountdown(combat, state, { ...payload, clear: true }, requestUser);
}

async function promptInitiative(combat, state) {
  if (state.phase !== PHASES.INITIATIVE) {
    notify("warn", localize("NDI.Notify.PromptOnlyInitiative"));
    return;
  }

  const next = withHistory(state, "Prompt initiative");
  next.schema = 3;
  for (const combatantId of Object.keys(next.results ?? {})) {
    if (!resultForCurrentRound(next, combatantId)) delete next.results[combatantId];
  }
  next.promptId = foundry.utils.randomID();
  next.promptOpen = true;

  for (const combatant of combat.combatants) {
    if (combatantSide(combatant) !== "party" || isUnavailable(combatant)) continue;
    if (isUnconscious(combatant)) {
      next.results[combatant.id] = {
        total: null,
        skill: next.lastSkills?.[combatant.id] ?? "perception",
        label: "Unconscious",
        phase: PHASES.REARGUARD,
        round: Number(next.round ?? 1),
        forced: true,
        at: Date.now(),
      };
    }
  }

  await persistState(combat, next, "prompt-initiative");
  const prompt = {
    type: "show-initiative-prompt",
    combatId: combat.id,
    promptId: next.promptId,
    round: next.round,
    dc: next.enemyDC,
    suggestedSkill: next.suggestedSkill,
    initial: next.initialInitiativePending,
  };

  Hooks.callAll(`${MODULE_ID}.showPrompt`, prompt);
  game.socket.emit(SOCKET_NAME, prompt);
  await publicChat(
    `<h3>Round ${next.round}: Initiative Checks</h3><p>Roll against Enemy Initiative DC <strong>${next.enemyDC}</strong>.</p>`,
  );
}

async function submitInitiativeResult(combat, state, payload, requestUser) {
  if (state.phase !== PHASES.INITIATIVE || payload.promptId !== state.promptId) {
    throw new Error(localize("NDI.Error.PromptInactive"));
  }
  const combatant = getCombatant(combat, payload.combatantId);
  if (!combatant || combatantSide(combatant) !== "party") throw new Error(localize("NDI.Error.InvalidPlayerCombatant"));
  if (!userCanOwnCombatant(requestUser, combatant)) throw new Error(localize("NDI.Error.NotOwner"));

  const next = submitResult(state, combatant.id, {
    total: payload.total,
    skill: payload.skill,
    label: payload.label,
  });
  await persistState(combat, next, "submit-roll");
  try {
    await combatant.actor?.setFlag?.(MODULE_ID, "lastInitiativeSkill", payload.skill);
  } catch (error) {
    debug("Unable to remember initiative skill on actor", error);
  }

  const eligible = combat.combatants.filter(
    (candidate) => combatantSide(candidate) === "party" && !isUnavailable(candidate),
  );
  const complete = eligible.every(
    (candidate) => resultForCurrentRound(next, candidate.id) || isUnconscious(candidate),
  );
  if (complete) {
    notify("info", localize("NDI.Notify.ChecksComplete"));
    next.promptOpen = false;
    await persistState(combat, next, "prompt-complete");
  }
}

async function changeDC(combat, state, payload) {
  const value = Math.max(0, Math.min(99, Number(payload.dc)));
  if (!Number.isFinite(value)) throw new Error(localize("NDI.Error.DcNumber"));
  let next = withHistory(state, `Change Enemy Initiative DC to ${value}`);
  next.enemyDC = value;
  next = reclassifyResults(next);
  await persistState(combat, next, "set-dc");
}

async function changeSuggestedSkill(combat, state, payload) {
  const next = withHistory(state, `Change suggested initiative skill to ${payload.skill}`);
  next.suggestedSkill = String(payload.skill || "last-used");
  await persistState(combat, next, "set-skill");
}

async function changePhase(combat, state, payload) {
  const target = payload.phase;
  if (target === state.phase) return;
  diag("phase-change-requested", {
    combatId: shortId(combat.id),
    phase: state.phase,
    target,
    revision: Number(state.revision ?? 0),
    combatants: combatantIdList(combat).length,
  });

  await transitionToPhase(combat, state, target, { force: Boolean(payload.force) });
}

function canClaimInPhase(combatant, state) {
  if (state.phase === PHASES.ENEMY) return combatantSide(combatant) === "enemy";
  if (![PHASES.VANGUARD, PHASES.REARGUARD].includes(state.phase)) return false;
  return combatantSide(combatant) === "party" && combatantPhase(state, combatant.id, "party") === state.phase;
}

function lifecycleAllowsActions(state) {
  const status = state.lifecycle?.status;
  // During preparing/starting/ending, do not allow claims or end-turn.
  if (!isLifecyclePhase(state.phase)) return true;
  return status === LIFECYCLE_STATUS.OPEN || status === LIFECYCLE_STATUS.COMPLETE;
}

async function claimTurn(combat, state, payload, requestUser) {
  if (!lifecycleAllowsActions(state)) {
    throw new Error(localize("NDI.Lifecycle.NotOpen"));
  }
  const combatant = getCombatant(combat, payload.combatantId);
  if (!combatant || isUnavailable(combatant)) throw new Error(localize("NDI.Error.CannotAct"));
  if (!canClaimInPhase(combatant, state)) throw new Error(localize("NDI.Error.NotEligible"));
  if (state.acted?.[combatant.id] || isTurnEnded(state, combatant.id)) {
    throw new Error(localize("NDI.Error.AlreadyActed"));
  }
  if (state.activeCombatantId && state.activeCombatantId !== combatant.id) {
    throw new Error(localize("NDI.Error.OtherActive"));
  }
  if (!requestUser.isGM && !userCanOwnCombatant(requestUser, combatant)) {
    throw new Error(localize("NDI.Error.NotOwner"));
  }
  if (state.phase === PHASES.ENEMY && !requestUser.isGM) throw new Error(localize("NDI.Error.GmOnlyEnemies"));

  const next = withHistory(state, `Activate ${combatantName(combatant)}`);
  next.activeCombatantId = combatant.id;
  await persistState(combat, next, "claim-turn");
  // Native turn marker only (turnEvents suppressed) — lifecycle already ran at phase start.
  await setNativeTurn(combat, combatant.id);
}

function isTurnEnded(state, combatantId) {
  const turn = state.lifecycle?.turns?.[combatantId];
  if (turn) return Boolean(turn.ended || turn.skipped);
  return Boolean(state.acted?.[combatantId]);
}

async function endTurn(combat, state, payload, requestUser) {
  const combatantId = payload.combatantId ?? state.activeCombatantId;
  const combatant = getCombatant(combat, combatantId);
  if (!combatant) throw new Error(localize("NDI.Error.NoActiveCombatant"));
  if (!requestUser.isGM && !userCanOwnCombatant(requestUser, combatant)) {
    throw new Error(localize("NDI.Error.NotOwner"));
  }

  // Lifecycle phases: End Turn claims the individual end boundary and invokes PF2e once.
  if (isLifecyclePhase(state.phase) && state.lifecycle) {
    let liveState = getState(combat) ?? state;
    liveState = refreshCombatantTiming(combat, liveState, combatant.id);

    const turn = liveState.lifecycle?.turns?.[combatant.id];
    if (turn?.endStatus === BOUNDARY_STATUS.COMPLETED || turn?.endStatus === BOUNDARY_STATUS.SKIPPED) {
      if (isTurnEnded(liveState, combatant.id)) {
        lifecycleDiag("end-turn-complete", combat, liveState, {
          combatantId: shortId(combatant.id),
          reason: "already-ended",
        });
        return;
      }
    }

    if (!canEndTurn(liveState.lifecycle, combatant.id) && isTurnEnded(liveState, combatant.id)) {
      lifecycleDiag("end-turn-complete", combat, liveState, {
        combatantId: shortId(combatant.id),
        reason: "already-ended",
      });
      return;
    }
    if (!canEndTurn(liveState.lifecycle, combatant.id)) {
      throw new Error(localize("NDI.Lifecycle.CannotEndTurn"));
    }

    const enforce = isTimingEnforced();
    const eligibility = evaluateEndTurnEligibility(liveState.lifecycle, combatant.id, { enforce });
    if (!eligibility.allowed) {
      lifecycleDiag("priority-end-turn-rejected", combat, liveState, {
        combatantId: shortId(combatant.id),
        reason: eligibility.reason,
      });
      if (liveState.lifecycle?.timing) {
        liveState = structuredClone(liveState);
        liveState.lifecycle.timing = pushTimingAudit(
          liveState.lifecycle.timing,
          eligibility.reason === "waiting-for-confused"
            ? "nonpriority-end-turn-rejected"
            : "priority-end-turn-rejected",
          {
            combatantId: shortId(combatant.id),
            phase: liveState.lifecycle.phase,
            phaseInstanceId: shortId(liveState.lifecycle.phaseInstanceId),
            reason: eligibility.reason,
            userId: shortId(requestUser.id),
          },
        );
        await persistState(combat, liveState, "end-turn-rejected");
      }
      throw new Error(endTurnRejectMessage(eligibility.reason));
    }

    lifecycleDiag("end-turn-requested", combat, liveState, {
      combatantId: shortId(combatant.id),
      userId: shortId(requestUser.id),
    });

    const processed = await processIndividualEndTurn(
      combat,
      withHistory(liveState, `End turn ${combatant.id}`),
      combatant.id,
      { userId: requestUser.id },
    );
    let next = processed.state;
    if (!processed.ok) {
      notify("warn", localize("NDI.Lifecycle.EndReviewNeeded", { name: combatantName(combatant) }));
      return;
    }

    if (eligibility.overrideType === TIMING_OVERRIDE.RESUME_CURRENT_ONCE) {
      const consumed = consumeTimingOverride(
        next.lifecycle.timing,
        combatant.id,
        TIMING_OVERRIDE.RESUME_CURRENT_ONCE,
      );
      next.lifecycle.timing = consumed.timing;
      next.lifecycle.timing = pushTimingAudit(next.lifecycle.timing, "current-actor-resume-granted", {
        combatantId: shortId(combatant.id),
        reason: "consumed",
        phaseInstanceId: shortId(next.lifecycle.phaseInstanceId),
      });
      await persistState(combat, next, "end-turn-override-consumed");
    }

    await clearNativeTurn(combat);
    lifecycleDiag("end-turn-complete", combat, next, {
      combatantId: shortId(combatant.id),
    });

    if (next.lifecycle?.status === LIFECYCLE_STATUS.COMPLETE) {
      lifecycleDiag("phase-complete", combat, next);
      await maybeAutoAdvance(combat, next);
    }
    return;
  }

  // Initiative / legacy fallback: mark acted only.
  const next = markActed(state, combatant.id, true);
  await persistState(combat, next, "end-turn");
  await clearNativeTurn(combat);
}

async function reopenCombatantTurn(combat, state, payload, requestUser) {
  const combatant = getCombatant(combat, payload.combatantId);
  if (!combatant) throw new Error(localize("NDI.Error.InvalidCombatant"));
  if (!requestUser.isGM && !userCanOwnCombatant(requestUser, combatant)) {
    throw new Error(localize("NDI.Error.NotOwner"));
  }

  let liveState = refreshCombatantTiming(combat, getState(combat) ?? state, combatant.id);
  if (!canReopenTurn(liveState.lifecycle, combatant.id)) {
    throw new Error(localize("NDI.Lifecycle.CannotReopen"));
  }

  const enforce = isTimingEnforced();
  const eligibility = evaluateReopenEligibility(liveState.lifecycle, combatant.id, {
    isGM: requestUser.isGM,
    enforce,
  });
  if (!eligibility.allowed) {
    if (liveState.lifecycle?.timing) {
      liveState = structuredClone(liveState);
      liveState.lifecycle.timing = pushTimingAudit(
        liveState.lifecycle.timing,
        "confused-reopen-rejected",
        {
          combatantId: shortId(combatant.id),
          phaseInstanceId: shortId(liveState.lifecycle.phaseInstanceId),
          userId: shortId(requestUser.id),
        },
      );
      await persistState(combat, liveState, "reopen-rejected");
    }
    throw new Error(localize("NDI.Timing.ConfusedReopenRejected"));
  }

  // GM reopening a Confused turn requires the dedicated override path (or confirmation flag).
  if (eligibility.requiresOverride && requestUser.isGM && !payload.timingOverrideConfirmed) {
    throw new Error(localize("NDI.Timing.UseReopenConfusedControl"));
  }

  const result = reopenTurn(withHistory(liveState, `Reopen turn ${combatant.id}`), combatant.id);
  if (!result.changed) return;
  let next = applyReopenTiming(result.state, combatant.id);
  if (eligibility.requiresOverride) {
    next.lifecycle.timing = pushTimingAudit(next.lifecycle.timing, "confused-reopen-overridden", {
      combatantId: shortId(combatant.id),
      phaseInstanceId: shortId(next.lifecycle.phaseInstanceId),
      userId: shortId(requestUser.id),
    });
  }
  await persistState(combat, next, "reopen-turn");
  lifecycleDiag("turn-reopened", combat, next, {
    combatantId: shortId(combatant.id),
  });
}

async function endRemainingTurns(combat, state, requestUser) {
  if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
  if (!isLifecyclePhase(state.phase) || !state.lifecycle) {
    throw new Error(localize("NDI.Lifecycle.NotOpen"));
  }
  if (![LIFECYCLE_STATUS.OPEN, LIFECYCLE_STATUS.COMPLETE].includes(state.lifecycle.status)) {
    throw new Error(localize("NDI.Lifecycle.NotOpen"));
  }

  // Process and End Remaining: native end for each incomplete combatant.
  let next = withHistory(state, "Process and end remaining turns");
  const roster = [...(next.lifecycle?.roster ?? [])];
  for (const combatantId of roster) {
    const turn = next.lifecycle?.turns?.[combatantId];
    if (!turn) continue;
    if (turn.endStatus === BOUNDARY_STATUS.COMPLETED || turn.endStatus === BOUNDARY_STATUS.SKIPPED) {
      continue;
    }
    const processed = await processIndividualEndTurn(combat, next, combatantId, {
      userId: requestUser.id,
    });
    next = processed.state;
    if (!processed.ok) {
      notify("error", localize("NDI.Lifecycle.ProcessRemainingFailed"));
      return;
    }
  }
  lifecycleDiag("phase-complete", combat, next, { processedRemaining: true });
  await maybeAutoAdvance(combat, next);
}

async function forceAdvance(combat, state, requestUser) {
  if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
  const target = nextPhaseValue(state.phase);
  await transitionToPhase(combat, state, target, { force: true });
}

async function processEndRemainingAndAdvance(combat, state, requestUser) {
  if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
  const target = nextPhaseValue(state.phase);
  await transitionToPhase(combat, state, target, { processRemaining: true });
}

async function acknowledgeLifecycleMigration(combat, state, requestUser) {
  if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
  if (!state.lifecycleMigrationNotice) return;
  const next = withHistory(state, "Acknowledge lifecycle migration");
  next.lifecycleMigrationNotice = false;
  await persistState(combat, next, "ack-lifecycle-migration");
}

function nextPhaseValue(phase) {
  const order = [PHASES.INITIATIVE, PHASES.VANGUARD, PHASES.ENEMY, PHASES.REARGUARD];
  const index = order.indexOf(phase);
  return order[(index + 1) % order.length];
}

async function maybeAutoAdvance(combat, state) {
  if (!isPrimaryGM()) return;
  if (state.lifecycle?.status !== LIFECYCLE_STATUS.COMPLETE) return;

  let mode = AUTO_ADVANCE.OFF;
  try {
    mode = game.settings.get(MODULE_ID, SETTINGS.AUTO_ADVANCE_PHASE);
  } catch (_error) {
    mode = AUTO_ADVANCE.OFF;
  }

  if (mode === AUTO_ADVANCE.OFF) return;

  const key = `${combat.id}:${state.lifecycle.phaseInstanceId}`;
  if (mode === AUTO_ADVANCE.PROMPT) {
    if (autoAdvancePrompted.has(key)) return;
    autoAdvancePrompted.add(key);
    const DialogV2 = foundry?.applications?.api?.DialogV2;
    const label = state.phase;
    let confirmed = false;
    if (DialogV2?.confirm) {
      confirmed = await DialogV2.confirm({
        window: { title: localize("NDI.Lifecycle.AdvancePhase") },
        content: `<p>${localize("NDI.Lifecycle.PhaseCompletePrompt", { phase: label })}</p>`,
        yes: { default: true },
      });
    } else {
      confirmed = window.confirm(localize("NDI.Lifecycle.PhaseCompletePrompt", { phase: label }));
    }
    if (!confirmed) return;
    const live = getState(combat);
    if (!live?.enabled || live.lifecycle?.phaseInstanceId !== state.lifecycle.phaseInstanceId) return;
    await transitionToPhase(combat, live, nextPhaseValue(live.phase), { force: false });
    return;
  }

  if (mode === AUTO_ADVANCE.AUTOMATIC) {
    // Queued mutation — not a timing heuristic.
    const live = getState(combat);
    if (!live?.enabled || live.lifecycle?.status !== LIFECYCLE_STATUS.COMPLETE) return;
    if (phaseTransitionLocks.has(combat.id)) return;
    await transitionToPhase(combat, live, nextPhaseValue(live.phase), { force: false });
  }
}

async function retryFailedStart(combat, state) {
  if (!state.lifecycle || state.lifecycle.status !== LIFECYCLE_STATUS.ERROR) {
    if (state.lifecycle?.status !== LIFECYCLE_STATUS.INTERRUPTED) {
      throw new Error(localize("NDI.Lifecycle.NoFailedStart"));
    }
  }
  lifecycleDiag("lifecycle-recovery-requested", combat, state, { action: "retry-start" });
  // Reset overall status so start can resume; keep completed combatants.
  let next = structuredClone(state);
  next.lifecycle.status = LIFECYCLE_STATUS.STARTING;
  next.lifecycle.start.status = BOUNDARY_STATUS.PROCESSING;
  next.lifecycle.start.failedCombatants = [];
  await persistState(combat, next, "retry-failed-start");
  next = await runStartBoundary(combat, next, { onlyFailedOrInterrupted: true });
  return next;
}

async function skipFailedStartHandler(combat, state) {
  let next = skipFailedStarts(withHistory(state, "Skip failed starts"));
  // If all starts resolved, open the phase.
  const pending = startCandidates(next.lifecycle);
  if (pending.length === 0) {
    next = completeStartBoundary(next, { error: false });
  } else {
    next.lifecycle.status = LIFECYCLE_STATUS.ERROR;
  }
  await persistState(combat, next, "skip-failed-start");
  lifecycleDiag("lifecycle-recovery-requested", combat, next, { action: "skip-start" });
  return next;
}

async function retryFailedEnd(combat, state) {
  if (
    !state.lifecycle ||
    ![LIFECYCLE_STATUS.ERROR, LIFECYCLE_STATUS.INTERRUPTED, LIFECYCLE_STATUS.ENDING].includes(
      state.lifecycle.status,
    )
  ) {
    throw new Error(localize("NDI.Lifecycle.NoFailedEnd"));
  }
  lifecycleDiag("lifecycle-recovery-requested", combat, state, { action: "retry-end" });
  let next = structuredClone(state);
  next.lifecycle.status = LIFECYCLE_STATUS.ENDING;
  next.lifecycle.end.status = BOUNDARY_STATUS.PROCESSING;
  next.lifecycle.end.failedCombatants = [];
  await persistState(combat, next, "retry-failed-end");
  const endResult = await runEndBoundary(combat, next, { onlyFailedOrInterrupted: true });
  if (!endResult.ok) return endResult.state;

  // After successful end recovery, enter the next phase.
  return transitionToPhase(combat, endResult.state, nextPhaseValue(endResult.state.phase), {
    force: false,
  });
}

async function skipFailedEndHandler(combat, state) {
  let next = skipFailedEnds(withHistory(state, "Skip failed ends"));
  const pending = endCandidates(next.lifecycle);
  if (pending.length === 0) {
    next = completeEndBoundary(next, { error: false });
    await persistState(combat, next, "skip-failed-end");
    lifecycleDiag("lifecycle-recovery-requested", combat, next, { action: "skip-end" });
    return transitionToPhase(combat, next, nextPhaseValue(next.phase), { force: false });
  }
  next.lifecycle.status = LIFECYCLE_STATUS.ERROR;
  await persistState(combat, next, "skip-failed-end");
  return next;
}

async function delayCombatant(combat, state, payload, requestUser) {
  if (state.phase !== PHASES.VANGUARD) throw new Error(localize("NDI.Error.DelayOnlyVanguard"));
  const combatant = getCombatant(combat, payload.combatantId ?? state.activeCombatantId);
  if (!combatant || combatantSide(combatant) !== "party") throw new Error(localize("NDI.Error.InvalidVanguard"));
  if (!requestUser.isGM && !userCanOwnCombatant(requestUser, combatant)) {
    throw new Error(localize("NDI.Error.NotOwner"));
  }

  const isGmMove = payload.type === REQUESTS.MOVE_REARGUARD || payload.gmMove === true;
  if (isGmMove && !requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));

  // Re-read combat / lifecycle / live conditions before voluntary Delay.
  let liveState = refreshCombatantTiming(combat, getState(combat) ?? state, combatant.id);
  const enforce = isTimingEnforced();

  if (!isGmMove) {
    const eligibility = evaluateDelayEligibility(liveState.lifecycle, combatant.id, { enforce });
    if (!eligibility.allowed) {
      if (liveState.lifecycle?.timing) {
        liveState = structuredClone(liveState);
        const event =
          eligibility.blockReason === "confused"
            ? "delay-blocked-confused"
            : eligibility.blockReason === "restrained"
              ? "delay-blocked-restrained"
              : "delay-blocked-grabbed";
        liveState.lifecycle.timing = pushTimingAudit(liveState.lifecycle.timing, event, {
          combatantId: shortId(combatant.id),
          phase: liveState.lifecycle.phase,
          phaseInstanceId: shortId(liveState.lifecycle.phaseInstanceId),
          restriction: eligibility.blockReason,
          userId: shortId(requestUser.id),
        });
        await persistState(combat, liveState, "delay-blocked");
      }
      throw new Error(delayBlockMessage(eligibility.blockReason));
    }

    // Consume Allow Delay Once after validation, before mutation.
    if (eligibility.overrideType === TIMING_OVERRIDE.ALLOW_DELAY_ONCE) {
      const consumed = consumeTimingOverride(
        liveState.lifecycle.timing,
        combatant.id,
        TIMING_OVERRIDE.ALLOW_DELAY_ONCE,
      );
      if (!consumed.consumed) {
        throw new Error(delayBlockMessage(eligibility.blockReason));
      }
      liveState = structuredClone(liveState);
      liveState.lifecycle.timing = pushTimingAudit(consumed.timing, "delay-override-consumed", {
        combatantId: shortId(combatant.id),
        overrideType: TIMING_OVERRIDE.ALLOW_DELAY_ONCE,
        phaseInstanceId: shortId(liveState.lifecycle.phaseInstanceId),
      });
    }
  } else if (liveState.lifecycle?.timing) {
    liveState = structuredClone(liveState);
    liveState.lifecycle.timing = grantTimingOverride(
      liveState.lifecycle.timing,
      combatant.id,
      TIMING_OVERRIDE.MOVE_REARGUARD,
      { grantedBy: requestUser.id },
    );
    const consumed = consumeTimingOverride(
      liveState.lifecycle.timing,
      combatant.id,
      TIMING_OVERRIDE.MOVE_REARGUARD,
    );
    liveState.lifecycle.timing = pushTimingAudit(consumed.timing, "delay-override-consumed", {
      combatantId: shortId(combatant.id),
      overrideType: TIMING_OVERRIDE.MOVE_REARGUARD,
      phaseInstanceId: shortId(liveState.lifecycle.phaseInstanceId),
    });
  }

  // Delay removes them from Vanguard play; mark ended/skipped in lifecycle so phase can complete.
  let next = delayToRearguard(liveState, combatant.id);
  if (next.lifecycle?.timing) {
    next.lifecycle.timing = pushTimingAudit(next.lifecycle.timing, "delay-allowed", {
      combatantId: shortId(combatant.id),
      phaseInstanceId: shortId(next.lifecycle.phaseInstanceId),
      reason: isGmMove ? "gm-move" : "voluntary",
    });
  }
  if (next.lifecycle?.roster?.includes(combatant.id)) {
    const turn = next.lifecycle.turns?.[combatant.id];
    if (turn && !turn.ended) {
      turn.ended = true;
      turn.skipped = true;
      turn.endedBy = requestUser.id;
      turn.endedAt = Date.now();
      turn.endReason = "delayed-to-rearguard";
      // Delayed combatants leave this phase; skip end-of-phase processing for them
      // so end-turn runs in Rearguard instead (native once-per-phase model).
      if (turn.endStatus === BOUNDARY_STATUS.PENDING) {
        turn.endStatus = BOUNDARY_STATUS.SKIPPED;
      }
    }
    next.acted ??= {};
    next.acted[combatant.id] = true;
    const progress = lifecycleProgress(next.lifecycle, { combatantIds: combatantIdList(combat) });
    if (progress.complete && next.lifecycle.status === LIFECYCLE_STATUS.OPEN) {
      next.lifecycle.status = LIFECYCLE_STATUS.COMPLETE;
    }
    // Remove delayed combatant from Confused priority gate.
    if (next.lifecycle.timing) {
      next.lifecycle.timing = markPriorityResolved(next.lifecycle.timing, combatant.id);
      next.lifecycle.timing = recomputePriorityGate(next.lifecycle.timing, next.lifecycle);
    }
  }
  await persistState(combat, next, "delay-rearguard");
  await clearNativeTurn(combat);
  if (next.lifecycle?.status === LIFECYCLE_STATUS.COMPLETE) {
    await maybeAutoAdvance(combat, next);
  }
}

async function markCombatantActed(combat, state, payload, requestUser) {
  const combatant = getCombatant(combat, payload.combatantId);
  if (!combatant) throw new Error(localize("NDI.Error.InvalidCombatant"));
  if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));

  if (isLifecyclePhase(state.phase) && state.lifecycle?.roster?.includes(combatant.id)) {
    if (payload.acted === false) {
      const result = reopenTurn(withHistory(state, `Restore turn ${combatant.id}`), combatant.id);
      await persistState(combat, result.state, "mark-acted");
    } else if (payload.skipWithoutProcessing) {
      const result = markTurnSkipped(
        withHistory(state, `Mark skipped ${combatant.id}`),
        combatant.id,
        { userId: requestUser.id, reason: "marked-skipped" },
      );
      await persistState(combat, result.state, "mark-skipped");
      if (result.state.lifecycle?.status === LIFECYCLE_STATUS.COMPLETE) {
        await maybeAutoAdvance(combat, result.state);
      }
    } else {
      // Authoritative End Turn pipeline (native once) — same as portrait End Turn.
      await endTurn(combat, state, { combatantId: combatant.id }, requestUser);
      return;
    }
    if ((getState(combat)?.activeCombatantId ?? null) == null) await clearNativeTurn(combat);
    return;
  }

  const next = markActed(state, combatant.id, payload.acted !== false);
  await persistState(combat, next, "mark-acted");
  if (next.activeCombatantId == null) await clearNativeTurn(combat);
}

async function undo(combat, state) {
  diag("undo-requested", {
    combatId: shortId(combat.id),
    phase: state.phase,
    revision: Number(state.revision ?? 0),
    combatants: combatantIdList(combat).length,
  });

  const undone = undoState(state);
  if (!undone) {
    notify("info", localize("NDI.Notify.NothingToUndo"));
    return;
  }

  if (undoCrossesPhaseEnd(state) || state.lifecycle?.end?.status === BOUNDARY_STATUS.COMPLETED || undoCrossesPlacementStart(state)) {
    const DialogV2 = foundry?.applications?.api?.DialogV2;
    const placementStart = undoCrossesPlacementStart(state);
    const title = placementStart
      ? localize("NDI.Placement.UndoStateOnly")
      : localize("NDI.Undo.PhaseStateOnly");
    const warning = placementStart
      ? localize("NDI.Placement.UndoNativeWarning")
      : localize("NDI.Undo.PhaseEndWarning");
    const content = `<p><strong>${title}</strong></p><p>${warning}</p>`;
    let confirmed = false;
    if (DialogV2?.confirm) {
      confirmed = await DialogV2.confirm({
        window: { title },
        content,
        yes: { default: false },
      });
    } else {
      confirmed = window.confirm(warning);
    }
    if (!confirmed) return;
  }

  const restored = normalizeUndoRestore(undone.state, combatantIdList(combat));
  // Do not replay native start/end from undo — state only.
  let toPersist = restored;
  if (undoCrossesPlacementStart(state)) {
    toPersist = pushPlacementAudit(restored, "placement-undo-state-only", {
      combatId: shortId(combat.id),
      revision: String(state.revision ?? 0),
    });
  }
  const saved = await persistState(combat, toPersist, "undo");
  await mustUpdateCombat(combat, { round: restored.round, turn: null });
  if (restored.activeCombatantId) await setNativeTurn(combat, restored.activeCombatantId);

  diag("undo-complete", {
    combatId: shortId(combat.id),
    phase: restored.phase,
    revision: saved.revision,
    combatants: combatantIdList(combat).length,
  });
  notify("info", localize("NDI.Notify.Undid", { label: undone.label }));
}

async function endDynamicCombat(combat, state) {
  const cleaned = await clearManagedRaisedShields(combat, state);
  const next = foundry.utils.deepClone(cleaned ?? state);
  next.enabled = false;
  next.lifecycle = null;
  try {
    await persistState(combat, next, "combat-end-cleanup");
  } catch (error) {
    console.error(`${MODULE_ID} | combat end cleanup failed`, {
      combatId: shortId(combat.id),
      reason: error?.message ?? "cleanup-failed",
    });
  }
  diag("combat-ended-cleanup", {
    combatId: shortId(combat.id),
    revision: Number(next.revision ?? 0),
  });
  await combat.delete();
}

/* -------------------------------------------- */
/*  GM timing overrides                         */
/* -------------------------------------------- */

async function requireOpenLifecycle(combat, state) {
  const live = structuredClone(getState(combat) ?? state);
  if (!live?.lifecycle || live.lifecycle.status !== LIFECYCLE_STATUS.OPEN) {
    throw new Error(localize("NDI.Lifecycle.NotOpen"));
  }
  live.lifecycle.timing = ensureTiming(live.lifecycle);
  return live;
}

async function timingAllowDelayOnce(combat, state, payload, requestUser) {
  if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
  const combatant = getCombatant(combat, payload.combatantId);
  if (!combatant) throw new Error(localize("NDI.Error.InvalidCombatant"));
  let live = await requireOpenLifecycle(combat, state);
  live = refreshCombatantTiming(combat, live, combatant.id);
  const record = live.lifecycle.timing.combatants?.[combatant.id];
  const needsConfirm =
    record?.delayBlockReason === "restrained" || record?.delayBlockReason === "confused";
  if (needsConfirm && !payload.confirmed) {
    throw new Error(localize("NDI.Timing.OverrideNeedsConfirm"));
  }
  live = structuredClone(live);
  live.lifecycle.timing = grantTimingOverride(
    live.lifecycle.timing,
    combatant.id,
    TIMING_OVERRIDE.ALLOW_DELAY_ONCE,
    { grantedBy: requestUser.id },
  );
  live.lifecycle.timing = pushTimingAudit(live.lifecycle.timing, "delay-override-granted", {
    combatantId: shortId(combatant.id),
    overrideType: TIMING_OVERRIDE.ALLOW_DELAY_ONCE,
    phaseInstanceId: shortId(live.lifecycle.phaseInstanceId),
    userId: shortId(requestUser.id),
  });
  await persistState(combat, withHistory(live, `Allow delay once ${combatant.id}`), "timing-allow-delay");
  notify("info", localize("NDI.Timing.AllowDelayOnceGranted"));
}

async function timingResolvePriority(combat, state, payload, requestUser) {
  if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
  if (!payload.confirmed) throw new Error(localize("NDI.Timing.OverrideNeedsConfirm"));
  const combatant = getCombatant(combat, payload.combatantId);
  if (!combatant) throw new Error(localize("NDI.Error.InvalidCombatant"));
  let live = await requireOpenLifecycle(combat, state);
  live = structuredClone(live);
  live.lifecycle.timing = markPriorityResolved(live.lifecycle.timing, combatant.id);
  live.lifecycle.timing = recomputePriorityGate(live.lifecycle.timing, live.lifecycle);
  live.lifecycle.timing = pushTimingAudit(live.lifecycle.timing, "confused-priority-resolved", {
    combatantId: shortId(combatant.id),
    reason: "gm-resolve-priority",
    phaseInstanceId: shortId(live.lifecycle.phaseInstanceId),
    userId: shortId(requestUser.id),
  });
  await persistState(combat, withHistory(live, `Resolve priority ${combatant.id}`), "timing-resolve-priority");
}

async function timingSkipPriority(combat, state, payload, requestUser) {
  if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
  if (!payload.confirmed) throw new Error(localize("NDI.Timing.OverrideNeedsConfirm"));
  const combatant = getCombatant(combat, payload.combatantId);
  if (!combatant) throw new Error(localize("NDI.Error.InvalidCombatant"));
  let live = await requireOpenLifecycle(combat, state);
  live = structuredClone(live);
  live.lifecycle.timing = grantTimingOverride(
    live.lifecycle.timing,
    combatant.id,
    TIMING_OVERRIDE.SKIP_PRIORITY,
    { grantedBy: requestUser.id },
  );
  // Leave override unconsumed so the combatant stays exempt from the gate this phase.
  live.lifecycle.timing = recomputePriorityGate(live.lifecycle.timing, live.lifecycle);
  live.lifecycle.timing = pushTimingAudit(live.lifecycle.timing, "confused-priority-advanced", {
    combatantId: shortId(combatant.id),
    reason: "gm-skip-priority",
    phaseInstanceId: shortId(live.lifecycle.phaseInstanceId),
    userId: shortId(requestUser.id),
  });
  await persistState(combat, withHistory(live, `Skip priority ${combatant.id}`), "timing-skip-priority");
}

async function timingReopenConfused(combat, state, payload, requestUser) {
  if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
  if (!payload.confirmed) throw new Error(localize("NDI.Timing.OverrideNeedsConfirm"));
  return reopenCombatantTurn(
    combat,
    state,
    { ...payload, timingOverrideConfirmed: true },
    requestUser,
  );
}

async function timingResumeCurrentOnce(combat, state, payload, requestUser) {
  if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
  const combatant = getCombatant(combat, payload.combatantId);
  if (!combatant) throw new Error(localize("NDI.Error.InvalidCombatant"));
  let live = await requireOpenLifecycle(combat, state);
  live = structuredClone(live);
  live.lifecycle.timing = grantTimingOverride(
    live.lifecycle.timing,
    combatant.id,
    TIMING_OVERRIDE.RESUME_CURRENT_ONCE,
    { grantedBy: requestUser.id },
  );
  live.lifecycle.timing = pushTimingAudit(live.lifecycle.timing, "current-actor-resume-granted", {
    combatantId: shortId(combatant.id),
    phaseInstanceId: shortId(live.lifecycle.phaseInstanceId),
    userId: shortId(requestUser.id),
  });
  await persistState(combat, withHistory(live, `Resume once ${combatant.id}`), "timing-resume-once");
  notify("info", localize("NDI.Timing.ResumeGranted"));
}

async function timingClearOverride(combat, state, payload, requestUser) {
  if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
  const combatant = getCombatant(combat, payload.combatantId);
  if (!combatant) throw new Error(localize("NDI.Error.InvalidCombatant"));
  let live = await requireOpenLifecycle(combat, state);
  live = structuredClone(live);
  live.lifecycle.timing = clearTimingOverride(live.lifecycle.timing, combatant.id);
  live.lifecycle.timing = pushTimingAudit(live.lifecycle.timing, "timing-override-cleared", {
    combatantId: shortId(combatant.id),
    phaseInstanceId: shortId(live.lifecycle.phaseInstanceId),
    userId: shortId(requestUser.id),
  });
  await persistState(combat, withHistory(live, `Clear timing override ${combatant.id}`), "timing-clear-override");
}

async function timingReconcileRequest(combat, state, requestUser) {
  if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
  const live = getState(combat) ?? state;
  const result = reconcileTimingState(combat, live, { reason: "gm-reconcile" });
  if (result.changed) {
    await persistState(combat, result.state, "timing-reconcile");
  }
  if (result.adapterFailures > 0) {
    notify("warn", localize("NDI.Timing.AdapterWarning"));
  }
}

/* -------------------------------------------- */
/*  GM initiative / phase placement editor      */
/* -------------------------------------------- */

/**
 * Process a single combatant's missing start boundary while phase stays Open.
 * Does not flip lifecycle to Starting or create a new phaseInstanceId.
 */
async function runSingleCombatantStart(combat, state, combatantId) {
  let next = structuredClone(state);
  const id = String(combatantId);
  if (!next.lifecycle?.turns?.[id]) return next;

  const liveCombatant = getCombatant(combat, id);
  const roundOfLastTurn = Number(
    liveCombatant?.roundOfLastTurn ?? liveCombatant?.flags?.pf2e?.roundOfLastTurn ?? NaN,
  );
  if (Number.isFinite(roundOfLastTurn) && roundOfLastTurn === Number(next.round ?? combat.round)) {
    next = markCombatantStartResult(next, id, { ok: true });
    next = pushPlacementAudit(next, "placement-start-boundary-preserved", {
      combatantId: shortId(id),
      reason: "already-started-this-round",
      round: String(next.round),
    });
    return next;
  }

  if (hasStartBoundaryThisRound(next.lifecycle, id)) {
    next = pushPlacementAudit(next, "placement-start-boundary-preserved", {
      combatantId: shortId(id),
      reason: "start-already-recorded",
      round: String(next.round),
    });
    return next;
  }

  next = markCombatantStartProcessing(next, id);
  await persistState(combat, next, "placement-start-processing");
  next = pushPlacementAudit(next, "placement-start-boundary-invoked", {
    combatantId: shortId(id),
    round: String(next.round),
    phaseInstanceId: shortId(next.lifecycle.phaseInstanceId),
  });

  const result = await processStartTurn(combat, id);
  if (result.ok) {
    next = markCombatantStartResult(next, id, { ok: true });
  } else {
    next = markCombatantStartResult(next, id, {
      ok: false,
      reason: adapterReasonMessage(result),
    });
    next.lifecycle.status = LIFECYCLE_STATUS.ERROR;
    notify("error", localize("NDI.Lifecycle.StartFailed"));
  }
  return next;
}

async function placementApply(combat, state, payload, requestUser) {
  if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
  const combatant = getCombatant(combat, payload.combatantId);
  if (!combatant) throw new Error(localize("NDI.Error.InvalidCombatant"));

  let live = getState(combat) ?? state;
  if (
    payload.expectedRevision != null &&
    Number(payload.expectedRevision) !== Number(live.revision ?? 0)
  ) {
    live = pushPlacementAudit(live, "placement-stale-request-rejected", {
      combatantId: shortId(combatant.id),
      revision: String(live.revision ?? 0),
      reason: "revision-mismatch",
    });
    await persistState(combat, live, "placement-stale");
    throw new Error(localize("NDI.Placement.StateChanged"));
  }

  const targetPhase = payload.targetPhase;
  if (!Object.values(PLACEMENTS).includes(targetPhase)) {
    throw new Error(localize("NDI.Placement.InvalidTarget"));
  }

  const mode = payload.mode === PLACEMENT_MODES.NEXT_ROUND
    ? PLACEMENT_MODES.NEXT_ROUND
    : PLACEMENT_MODES.CURRENT_ROUND;
  const side = combatantSide(combatant);
  const options = evaluatePlacementOptions(live, combatant.id, { side });

  live = pushPlacementAudit(live, "placement-correction-requested", {
    combatantId: shortId(combatant.id),
    sourcePhase: options.sourcePhase,
    targetPhase,
    mode,
    round: String(live.round),
    userId: shortId(requestUser.id),
  });

  if (mode === PLACEMENT_MODES.NEXT_ROUND) {
    const queued = queueNextRoundCorrection(withHistory(live, `Queue placement ${combatant.id}`), combatant.id, targetPhase, {
      userId: requestUser.id,
      replace: Boolean(payload.replace),
    });
    if (!queued.ok) {
      if (queued.requiresReplaceConfirm && !payload.replace) {
        throw new Error(localize("NDI.Placement.QueueExists"));
      }
      throw new Error(localize("NDI.Placement.CorrectionRejected"));
    }
    await persistState(combat, queued.state, "placement-queue");
    notify("info", localize("NDI.Placement.CorrectionQueued"));
    return;
  }

  const opt = options.currentRoundOptions.find((entry) => entry.phase === targetPhase);
  if (!opt?.allowed) {
    live = pushPlacementAudit(live, "placement-correction-rejected", {
      combatantId: shortId(combatant.id),
      targetPhase,
      reason: opt?.reason ?? "unsafe",
      userId: shortId(requestUser.id),
    });
    await persistState(combat, live, "placement-rejected");
    throw new Error(localize("NDI.Placement.CorrectionRejected"));
  }

  const sourcePhase = options.sourcePhase;
  let next = withHistory(live, `Place ${combatant.id} → ${targetPhase}`);
  const phaseInstanceBefore = next.lifecycle?.phaseInstanceId ?? null;

  // Leave current open phase roster when moving away from the active phase.
  if (
    next.lifecycle &&
    [LIFECYCLE_STATUS.OPEN, LIFECYCLE_STATUS.COMPLETE].includes(next.lifecycle.status) &&
    next.lifecycle.roster?.includes(combatant.id) &&
    sourcePhase === next.phase &&
    targetPhase !== next.phase
  ) {
    const left = leaveOpenRoster(next, combatant.id, { userId: requestUser.id });
    if (!left.changed && left.reason === "turn-completed") {
      throw new Error(localize("NDI.Placement.TurnCompleted"));
    }
    next = left.state;
    if (next.lifecycle?.timing) {
      next.lifecycle.timing = markPriorityResolved(next.lifecycle.timing, combatant.id);
      next.lifecycle.timing = recomputePriorityGate(next.lifecycle.timing, next.lifecycle);
    }
    next = pushPlacementAudit(next, "placement-current-phase-left", {
      combatantId: shortId(combatant.id),
      sourcePhase,
      targetPhase,
      phaseInstanceId: shortId(phaseInstanceBefore),
    });
  }

  next = applyCurrentRoundPlacement(next, combatant.id, targetPhase, {
    userId: requestUser.id,
    originalPhase: sourcePhase,
    method:
      targetPhase === PLACEMENTS.PENDING
        ? PLACEMENT_METHODS.GM_PENDING_RESET
        : PLACEMENT_METHODS.GM_CURRENT,
  });

  // Join current open phase when destination is the active phase.
  if (
    destinationIsCurrent(next, targetPhase) &&
    next.lifecycle &&
    next.lifecycle.status === LIFECYCLE_STATUS.OPEN
  ) {
    const total = resultForCurrentRound(next, combatant.id)?.total ?? null;
    const joined = appendToOpenRoster(next, combatant.id, { initiativeTotal: total });
    next = joined.state;
    if (joined.changed) {
      next = pushPlacementAudit(next, "placement-current-phase-joined", {
        combatantId: shortId(combatant.id),
        targetPhase,
        phaseInstanceId: shortId(next.lifecycle.phaseInstanceId),
      });
      await persistState(combat, next, "placement-join");
      next = await runSingleCombatantStart(combat, next, combatant.id);
      const reconciled = reconcileTimingState(combat, next, { reason: "placement-join" });
      next = reconciled.state;
    }
  } else if (next.lifecycle && [LIFECYCLE_STATUS.OPEN, LIFECYCLE_STATUS.COMPLETE].includes(next.lifecycle.status)) {
    const reconciled = reconcileTimingState(combat, next, { reason: "placement-correction" });
    next = reconciled.state;
  }

  // Guarantee: correction never creates a new phaseInstanceId by itself.
  if (
    phaseInstanceBefore &&
    next.lifecycle?.phaseInstanceId &&
    next.lifecycle.phaseInstanceId !== phaseInstanceBefore
  ) {
    next.lifecycle.phaseInstanceId = phaseInstanceBefore;
  }

  await persistState(combat, next, "placement-apply");
  notify("info", localize("NDI.Placement.CorrectionApplied"));
}

async function placementQueue(combat, state, payload, requestUser) {
  return placementApply(combat, state, { ...payload, mode: PLACEMENT_MODES.NEXT_ROUND }, requestUser);
}

async function placementCancelQueue(combat, state, payload, requestUser) {
  if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
  const combatant = getCombatant(combat, payload.combatantId);
  if (!combatant) throw new Error(localize("NDI.Error.InvalidCombatant"));
  const live = getState(combat) ?? state;
  const result = cancelQueuedCorrection(withHistory(live, `Cancel queued placement ${combatant.id}`), combatant.id, {
    userId: requestUser.id,
  });
  if (!result.ok) throw new Error(localize("NDI.Placement.NoQueue"));
  await persistState(combat, result.state, "placement-cancel-queue");
  notify("info", localize("NDI.Placement.CorrectionCancelled"));
}

export function getPlacementEditorProjection(combat, combatantId) {
  const state = getState(combat);
  if (!state?.enabled) return null;
  const combatant = getCombatant(combat, combatantId);
  if (!combatant) return null;
  return buildEditorProjection(state, combatantId, {
    side: combatantSide(combatant),
    revision: state.revision,
  });
}

/**
 * Authoritative GM reconciliation after a condition item change.
 * Serialized through the combat mutation queue.
 */
export async function reconcileTimingFromConditionHook(item) {
  if (!isPrimaryGM()) return;
  if (!isTimingEnforced()) return;
  const actor = item?.actor;
  if (!actor) return;
  const combat = getCombat();
  const state = getState(combat);
  if (!combat || !state?.enabled || !state.lifecycle) return;
  if (state.lifecycle.status !== LIFECYCLE_STATUS.OPEN) {
    // Preserve interrupted/manual-review; do not activate timing controls.
    return;
  }
  const affected = [...combat.combatants].some((c) => c.actor?.id === actor.id);
  if (!affected) return;

  return runCombatMutation(combat.id, async () => {
    const live = getState(combat);
    if (!live?.enabled || live.lifecycle?.status !== LIFECYCLE_STATUS.OPEN) return;
    const result = reconcileTimingState(combat, live, { reason: "condition-hook" });
    if (result.changed) {
      await persistState(combat, result.state, "timing-condition-reconcile");
    }
  });
}

async function dispatchGMRequest(payload) {
  const requestUser = validateRequestUser(payload);
  if (isGmEntryRequest(payload.type)) {
    requireRequestUserIsGm(requestUser);
  }
  if (payload.type === REQUESTS.START) {
    return await startDynamicInitiative(payload);
  }

  const combat = game.combats.get(payload.combatId) ?? getCombat();
  const state = getState(combat);
  if (!combat || !state?.enabled) throw new Error(localize("NDI.Error.NotActive"));

  switch (payload.type) {
    case REQUESTS.PROMPT:
      return await promptInitiative(combat, state);
    case REQUESTS.SUBMIT_ROLL:
      return await submitInitiativeResult(combat, state, payload, requestUser);
    case REQUESTS.SET_DC:
      if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
      return await changeDC(combat, state, payload);
    case REQUESTS.SET_SKILL:
      if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
      return await changeSuggestedSkill(combat, state, payload);
    case REQUESTS.SET_PHASE:
      if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
      return await changePhase(combat, state, payload);
    case REQUESTS.CLAIM:
      return await claimTurn(combat, state, payload, requestUser);
    case REQUESTS.END_TURN:
      return await endTurn(combat, state, payload, requestUser);
    case REQUESTS.REOPEN_TURN:
      return await reopenCombatantTurn(combat, state, payload, requestUser);
    case REQUESTS.END_REMAINING:
      if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
      return await endRemainingTurns(combat, state, requestUser);
    case REQUESTS.PROCESS_END_REMAINING:
      if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
      return await processEndRemainingAndAdvance(combat, state, requestUser);
    case REQUESTS.FORCE_ADVANCE:
      if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
      return await forceAdvance(combat, state, requestUser);
    case REQUESTS.ACK_LIFECYCLE_MIGRATION:
      if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
      return await acknowledgeLifecycleMigration(combat, state, requestUser);
    case REQUESTS.RETRY_FAILED_START:
      if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
      return await retryFailedStart(combat, state);
    case REQUESTS.SKIP_FAILED_START:
      if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
      return await skipFailedStartHandler(combat, state);
    case REQUESTS.RETRY_FAILED_END:
      if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
      return await retryFailedEnd(combat, state);
    case REQUESTS.SKIP_FAILED_END:
      if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
      return await skipFailedEndHandler(combat, state);
    case REQUESTS.DELAY:
    case REQUESTS.MOVE_REARGUARD:
      return await delayCombatant(combat, state, payload, requestUser);
    case REQUESTS.MARK_ACTED:
      if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
      return await markCombatantActed(combat, state, payload, requestUser);
    case REQUESTS.UNDO:
      if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
      return await undo(combat, state);
    case REQUESTS.END_COMBAT:
      if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
      return await endDynamicCombat(combat, state);
    case REQUESTS.TIMING_ALLOW_DELAY_ONCE:
      return await timingAllowDelayOnce(combat, state, payload, requestUser);
    case REQUESTS.TIMING_MOVE_REARGUARD:
      return await delayCombatant(
        combat,
        state,
        { ...payload, type: REQUESTS.MOVE_REARGUARD, gmMove: true },
        requestUser,
      );
    case REQUESTS.TIMING_RESOLVE_PRIORITY:
      return await timingResolvePriority(combat, state, payload, requestUser);
    case REQUESTS.TIMING_SKIP_PRIORITY:
      return await timingSkipPriority(combat, state, payload, requestUser);
    case REQUESTS.TIMING_REOPEN_CONFUSED:
      return await timingReopenConfused(combat, state, payload, requestUser);
    case REQUESTS.TIMING_RESUME_CURRENT_ONCE:
      return await timingResumeCurrentOnce(combat, state, payload, requestUser);
    case REQUESTS.TIMING_CLEAR_OVERRIDE:
      return await timingClearOverride(combat, state, payload, requestUser);
    case REQUESTS.TIMING_RECONCILE:
      return await timingReconcileRequest(combat, state, requestUser);
    case REQUESTS.PLACEMENT_APPLY:
      return await placementApply(combat, state, payload, requestUser);
    case REQUESTS.PLACEMENT_QUEUE:
      return await placementQueue(combat, state, payload, requestUser);
    case REQUESTS.PLACEMENT_CANCEL_QUEUE:
      return await placementCancelQueue(combat, state, payload, requestUser);
    case REQUESTS.COUNTDOWN_SET:
      if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
      return await setCountdown(combat, state, payload, requestUser);
    case REQUESTS.COUNTDOWN_CLEAR:
      if (!requestUser.isGM) throw new Error(localize("NDI.Error.GmOnly"));
      return await clearCountdown(combat, state, payload, requestUser);
    default:
      throw new Error(`Unknown NelTempo request: ${payload.type}`);
  }
}

export async function handleGMRequest(payload) {
  if (!isPrimaryGM()) return;

  const combatId = payload?.combatId ?? getCombat()?.id ?? "global";
  return runCombatMutation(combatId, async () => {
    try {
      return await dispatchGMRequest(payload);
    } catch (error) {
      console.error(`${MODULE_ID} | Request failed`, {
        type: payload?.type,
        combatId: shortId(payload?.combatId),
        reason: error?.message ?? "request-failed",
      });
      notify("error", error.message ?? "NelTempo request failed.");
    }
  });
}

/**
 * Local request entry used by UI and `game.dynamicInitiative`.
 * START / PROMPT reject non-GM callers locally without emitting a socket request.
 * Authoritative GM checks still run again in dispatch on the primary GM.
 */
export async function requestAction(type, data = {}) {
  if (isGmEntryRequest(type) && !game.user?.isGM) {
    const message = localize("NDI.Error.GmOnly");
    notify("error", message);
    return { ok: false, reason: "gm-only", error: new Error(message) };
  }

  const combat = getCombat();
  const payload = socketPayload(type, { combatId: combat?.id ?? null, ...data });
  if (isPrimaryGM()) return handleGMRequest(payload);
  game.socket.emit(SOCKET_NAME, payload);
}

/** @internal Exported for focused authority tests. */
export async function dispatchGMRequestForTests(payload) {
  return dispatchGMRequest(payload);
}

export function socketHandler(payload) {
  if (!payload || typeof payload !== "object") return;
  if (payload.type === "show-initiative-prompt") {
    Hooks.callAll(`${MODULE_ID}.showPrompt`, payload);
    return;
  }
  if (isPrimaryGM()) void handleGMRequest(payload);
}

export function partyRollRecipients(combat) {
  const recipients = new Set();
  for (const combatant of combat.combatants) {
    if (combatantSide(combatant) !== "party" || isUnavailable(combatant)) continue;
    for (const user of activePlayerOwners(combatant)) recipients.add(user.id);
  }
  return recipients;
}

/**
 * On ready/reload: convert uncertain Processing lifecycle entries to interrupted,
 * then reconcile live condition timing without replaying boundaries.
 */
export async function reconcileLifecycleOnReady() {
  if (!isPrimaryGM()) return;
  const combat = getCombat();
  const state = getState(combat);
  if (!combat || !state?.enabled || !state.lifecycle) return;

  const lc = state.lifecycle;
  const uncertain =
    [LIFECYCLE_STATUS.STARTING, LIFECYCLE_STATUS.ENDING, LIFECYCLE_STATUS.PREPARING].includes(lc.status) ||
    Object.values(lc.turns ?? {}).some(
      (t) =>
        t.startStatus === BOUNDARY_STATUS.PROCESSING || t.endStatus === BOUNDARY_STATUS.PROCESSING,
    );

  if (uncertain) {
    const { interruptUncertainProcessing } = await import("./lifecycle.js");
    const next = structuredClone(state);
    next.lifecycle = interruptUncertainProcessing(next.lifecycle);
    await persistState(combat, next, "lifecycle-restored");
    lifecycleDiag("lifecycle-restored", combat, next, { reason: "reload-interrupt" });
    notify("warn", localize("NDI.Lifecycle.Interrupted"));
    return;
  }

  // Open phase: recompute live conditions, restore badges/overrides, no boundary replay.
  if (lc.status === LIFECYCLE_STATUS.OPEN || lc.status === LIFECYCLE_STATUS.COMPLETE) {
    const result = reconcileTimingState(combat, state, { reason: "reload" });
    if (result.changed) {
      await persistState(combat, result.state, "timing-reload-reconcile");
      lifecycleDiag("timing-state-reconciled", combat, result.state, { reason: "reload" });
    }
  }
}
