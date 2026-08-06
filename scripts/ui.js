import { MODULE_ID, PHASE_BAR_LAYOUTS, REQUESTS, SETTINGS } from "./constants.js";
import { getPlacementEditorProjection, requestAction } from "./controller.js";
import { formatCountdownDisplay, sanitizeCountdown } from "./countdown.js";
import { rollDynamicInitiative } from "./initiative.js";
import {
  canEndTurn,
  canReopenTurn,
  combatantLifecycleUiStatus,
  endCandidates,
  isLifecyclePhase,
  lifecycleProgress,
  LIFECYCLE_STATUS,
  phaseAdvanceReady,
} from "./lifecycle.js";
import { PLACEMENT_MODES, PLACEMENTS, placementForCurrentRound, queuedCorrectionFor } from "./placement-editor.js";
import { activateCombatantPortrait } from "./portrait-activation.js";
import {
  currentPhaseBarScalePercent,
  currentPortraitScalePercent,
  isTextEntryTarget,
  resolvedPhaseBarLayoutNow,
} from "./presentation.js";
import { PHASES, combatantPhase, nextPhase, phaseForResult, resultForCurrentRound } from "./state.js";
import { isTimingEnforced } from "./timing-service.js";
import {
  evaluateDelayEligibility,
  evaluateEndTurnEligibility,
  evaluateReopenEligibility,
  timingBadgeFor,
} from "./timing.js";
import {
  activePlayerOwners,
  combatantName,
  combatantSide,
  currentPortraitSize,
  escapeHTML,
  getCombat,
  getCombatant,
  getState,
  isUnavailable,
  isUnconscious,
  ownedPartyCombatants,
  portraitFor,
  standardSkillChoices,
  suggestedSkillFor,
  userCanOwnCombatant,
} from "./utils.js";

const DOCK_ID = "ndi-dock";
const LAUNCHER_ID = "ndi-launcher";
const MODAL_CLASS = "ndi-initiative-modal";
const DRAG_KEY = `${MODULE_ID}.dock-position`;
const openPromptIds = new Set();
let overflowMenuCloser = null;

function t(key, data) {
  try {
    return data ? game.i18n.format(key, data) : game.i18n.localize(key);
  } catch (_error) {
    return key;
  }
}

function phaseLabel(phase) {
  const key = {
    [PHASES.INITIATIVE]: "NDI.Phase.Initiative",
    [PHASES.VANGUARD]: "NDI.Phase.Vanguard",
    [PHASES.ENEMY]: "NDI.Phase.Enemy",
    [PHASES.REARGUARD]: "NDI.Phase.Rearguard",
  }[phase];
  return key ? t(key) : phase;
}

function isTurnFinished(state, combatantId) {
  const turn = state.lifecycle?.turns?.[combatantId];
  if (turn) return Boolean(turn.ended || turn.skipped);
  return Boolean(state.acted?.[combatantId]);
}

function lifecycleIsOpen(state) {
  return state.lifecycle?.status === LIFECYCLE_STATUS.OPEN;
}

function lifecycleBusy(state) {
  const status = state.lifecycle?.status;
  return [LIFECYCLE_STATUS.PREPARING, LIFECYCLE_STATUS.STARTING, LIFECYCLE_STATUS.ENDING].includes(status);
}

function phaseCombatants(combat, state) {
  const combatants = [...combat.combatants].filter((combatant) => !isUnavailable(combatant));
  switch (state.phase) {
    case PHASES.INITIATIVE:
      return combatants.filter((combatant) => combatantSide(combatant) === "party");
    case PHASES.VANGUARD:
      return combatants.filter(
        (combatant) => combatantPhase(state, combatant.id, combatantSide(combatant)) === PHASES.VANGUARD,
      );
    case PHASES.ENEMY:
      return combatants.filter(
        (combatant) => combatantPhase(state, combatant.id, combatantSide(combatant)) === PHASES.ENEMY,
      );
    case PHASES.REARGUARD:
      return combatants.filter(
        (combatant) => combatantPhase(state, combatant.id, combatantSide(combatant)) === PHASES.REARGUARD,
      );
    default:
      return [];
  }
}

function canUserClaim(combatant, state) {
  if (isTurnFinished(state, combatant.id)) return false;
  if (lifecycleBusy(state)) return false;
  if (state.activeCombatantId && state.activeCombatantId !== combatant.id) return false;
  if (state.phase === PHASES.ENEMY) return game.user.isGM;
  return game.user.isGM || userCanOwnCombatant(game.user, combatant);
}

function canUserEndTurn(combatant, state) {
  if (!isLifecyclePhase(state.phase) || !state.lifecycle) return false;
  if (!canEndTurn(state.lifecycle, combatant.id)) return false;
  const enforce = isTimingEnforced();
  const eligibility = evaluateEndTurnEligibility(state.lifecycle, combatant.id, { enforce });
  if (!eligibility.allowed) return false;
  if (game.user.isGM) return true;
  return userCanOwnCombatant(game.user, combatant);
}

function canUserReopen(combatant, state) {
  if (!isLifecyclePhase(state.phase) || !state.lifecycle) return false;
  if (!canReopenTurn(state.lifecycle, combatant.id)) return false;
  const enforce = isTimingEnforced();
  const eligibility = evaluateReopenEligibility(state.lifecycle, combatant.id, {
    isGM: game.user.isGM,
    enforce,
  });
  if (!eligibility.allowed) return false;
  // Players cannot use the generic reopen for Confused turns.
  if (eligibility.requiresOverride && !game.user.isGM) return false;
  if (eligibility.requiresOverride && game.user.isGM) return false; // use dedicated control
  if (game.user.isGM) return true;
  return userCanOwnCombatant(game.user, combatant);
}

function endTurnDisabledReason(combatant, state) {
  if (!state.lifecycle) return null;
  const turn = state.lifecycle.turns?.[combatant.id];
  const start = turn?.startStatus;
  if (start && start !== "completed" && start !== "skipped") {
    if (start === "failed" || start === "interrupted") return t("NDI.Lifecycle.Status.Review");
    return t("NDI.Lifecycle.Status.StartPending");
  }
  const eligibility = evaluateEndTurnEligibility(state.lifecycle, combatant.id, {
    enforce: isTimingEnforced(),
  });
  if (eligibility.allowed) return null;
  if (eligibility.reason === "waiting-for-confused") return t("NDI.Timing.ResolveConfusedFirst");
  if (eligibility.reason === "waiting-for-priority-combatant") return t("NDI.Timing.WaitingForPriority");
  return t("NDI.Lifecycle.CannotEndTurn");
}

function delayEligibilityFor(combatant, state) {
  return evaluateDelayEligibility(state.lifecycle, combatant.id, { enforce: isTimingEnforced() });
}

function timingBadgeLabel(key) {
  switch (key) {
    case "must-act-first":
      return t("NDI.Timing.MustActFirst");
    case "waiting-confused":
      return t("NDI.Timing.WaitingConfused");
    case "delay-blocked-grabbed":
      return t("NDI.Timing.DelayBlockedGrabbed");
    case "delay-blocked-restrained":
      return t("NDI.Timing.DelayBlockedRestrained");
    case "delay-blocked-confused":
      return t("NDI.Timing.DelayBlockedConfused");
    case "gm-override":
      return t("NDI.Timing.GmOverride");
    case "resume-allowed":
      return t("NDI.Timing.ResumeAllowed");
    default:
      return null;
  }
}

/**
 * Portrait overlay badges for forced-order / override only.
 * Delay-blocked reasons stay on the Delay control tooltip — they must not
 * cover the portrait image.
 */
function isPortraitOverlayBadge(key) {
  return (
    key === "must-act-first" ||
    key === "waiting-confused" ||
    key === "gm-override" ||
    key === "resume-allowed"
  );
}

function portraitOverlayBadgeClass(key) {
  if (key === "must-act-first") return "is-priority-badge";
  if (key === "waiting-confused") return "is-waiting-badge";
  if (key === "gm-override" || key === "resume-allowed") return "is-override-badge";
  return "";
}

function delayTooltip(combatant, state) {
  const eligibility = delayEligibilityFor(combatant, state);
  if (eligibility.allowed) return t("NDI.Control.Delay");
  if (eligibility.blockReason === "confused") return t("NDI.Timing.CannotDelayConfused");
  if (eligibility.blockReason === "restrained") return t("NDI.Timing.CannotDelayRestrained");
  if (eligibility.blockReason === "grabbed") return t("NDI.Timing.CannotDelayGrabbed");
  return t("NDI.Timing.DelayBlocked");
}

function statusFor(combatant, state) {
  if (isUnconscious(combatant)) return "Unconscious · Rearguard";
  if (state.phase === PHASES.INITIATIVE) {
    const result = resultForCurrentRound(state, combatant.id);
    if (!result) return "Awaiting roll";
    if (result.forced) return "Rearguard";
    return `${result.label ?? result.skill}: ${result.total} · ${phaseLabel(result.phase)}`;
  }
  if (lifecycleBusy(state)) return t("NDI.Lifecycle.StartingPhase").replace("…", "");
  if (state.lifecycle?.status === LIFECYCLE_STATUS.ENDING) return t("NDI.Lifecycle.EndingPhase");
  if (isTurnFinished(state, combatant.id)) return t("NDI.Control.Ended");
  const badge = timingBadgeFor(state.lifecycle, combatant.id, { enforce: isTimingEnforced() });
  // Priority / override status only — Delay Blocked is conveyed by the Delay control.
  if (isPortraitOverlayBadge(badge)) {
    const badgeLabel = timingBadgeLabel(badge);
    if (badgeLabel) return badgeLabel;
  }
  if (state.activeCombatantId === combatant.id) return "Active turn";
  if (state.delayed?.[combatant.id]) return "Delayed to Rearguard";
  return "Ready";
}

function portraitClasses(combatant, state) {
  const classes = ["ndi-portrait"];
  if (state.activeCombatantId === combatant.id) classes.push("is-active");
  if (isTurnFinished(state, combatant.id) || state.acted?.[combatant.id]) classes.push("is-acted");
  if (state.delayed?.[combatant.id]) classes.push("is-delayed");
  const resultPhase = resultForCurrentRound(state, combatant.id)?.phase;
  if (resultPhase) classes.push(`is-${resultPhase}`);
  if (isUnconscious(combatant)) classes.push("is-unconscious");
  if (isTurnFinished(state, combatant.id)) classes.push("is-ended");
  const badge = timingBadgeFor(state.lifecycle, combatant.id, { enforce: isTimingEnforced() });
  if (badge === "must-act-first") classes.push("is-priority");
  if (badge === "waiting-confused") classes.push("is-waiting-priority");
  if (badge?.startsWith("delay-blocked")) classes.push("is-delay-blocked");
  if (badge === "gm-override" || badge === "resume-allowed") classes.push("is-timing-override");
  if (isLocallyControlledCombatant(combatant)) classes.push("is-token-controlled");
  return classes.join(" ");
}

/**
 * Exact scene/token pair currently controlled by this client.
 */
function isLocallyControlledCombatant(combatant) {
  try {
    const canvasRef = canvas;
    if (!canvasRef?.ready || !canvasRef.scene) return false;
    const tokenId = combatant.tokenId ?? combatant.token?.id;
    const sceneId = combatant.sceneId ?? combatant.token?.parent?.id ?? combatant.token?.scene?.id;
    if (!tokenId || !sceneId) return false;
    if (String(canvasRef.scene.id) !== String(sceneId)) return false;
    const controlled = canvasRef.tokens?.controlled ?? [];
    return controlled.some((token) => token?.id === tokenId && !token.destroyed);
  } catch (_error) {
    return false;
  }
}

function portraitHTML(combatant, state) {
  const result = resultForCurrentRound(state, combatant.id);
  const ownerCanRoll = game.user.isGM || userCanOwnCombatant(game.user, combatant);
  const finished = isTurnFinished(state, combatant.id);
  const rollButton =
    state.phase === PHASES.INITIATIVE &&
    ownerCanRoll &&
    !isUnconscious(combatant) &&
    (!result || combatantPhase(state, combatant.id, combatantSide(combatant)) === PLACEMENTS.PENDING)
      ? `<button type="button" class="ndi-mini-button" data-action="roll" data-combatant-id="${combatant.id}" aria-label="${escapeHTML(t("NDI.Control.Roll"))}">
           <i class="fa-solid fa-dice-d20"></i> ${escapeHTML(t("NDI.Control.Roll"))}
         </button>`
      : "";

  let delayButton = "";
  if (state.phase === PHASES.VANGUARD && !finished && ownerCanRoll && lifecycleIsOpen(state)) {
    const delayOk = delayEligibilityFor(combatant, state).allowed;
    const tip = delayTooltip(combatant, state);
    delayButton = `<button type="button" class="ndi-icon-button" data-action="delay" data-combatant-id="${combatant.id}" title="${escapeHTML(tip)}" aria-label="${escapeHTML(tip)}" ${delayOk ? "" : "disabled aria-disabled=\"true\""}>
           <i class="fa-solid fa-arrow-down"></i>
         </button>`;
  }

  const gmCorrect = game.user.isGM && state.phase !== PHASES.INITIATIVE && lifecycleIsOpen(state)
    ? `<button type="button" class="ndi-icon-button ndi-gm-correct" data-action="toggle-acted" data-combatant-id="${combatant.id}" title="${finished ? escapeHTML(t("NDI.Control.RestoreTurn")) : escapeHTML(t("NDI.Control.MarkComplete"))}" aria-label="${finished ? escapeHTML(t("NDI.Control.RestoreTurn")) : escapeHTML(t("NDI.Control.MarkComplete"))}">
         <i class="fa-solid ${finished ? "fa-rotate-left" : "fa-check"}"></i>
       </button>`
    : "";

  const placementEdit = game.user.isGM
    ? `<button type="button" class="ndi-icon-button ndi-placement-edit" data-action="edit-placement" data-combatant-id="${combatant.id}" title="${escapeHTML(t("NDI.Placement.Edit"))}" aria-label="${escapeHTML(t("NDI.Placement.Edit"))}">
           <i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>
           <span class="ndi-sr-only">${escapeHTML(t("NDI.Placement.Edit"))}</span>
         </button>`
    : "";

  const queue = game.user.isGM ? queuedCorrectionFor(state, combatant.id) : null;
  const placement = placementForCurrentRound(state, combatant.id);
  let placementHint = "";
  if (queue) {
    placementHint = `<span class="ndi-placement-hint" title="${escapeHTML(t("NDI.Placement.NextRoundHint", { phase: placementPhaseLabel(queue.targetPhase) }))}">${escapeHTML(t("NDI.Placement.NextRoundShort", { phase: placementPhaseLabel(queue.targetPhase) }))}</span>`;
  } else if (placement?.method) {
    placementHint = `<span class="ndi-placement-hint" title="${escapeHTML(t("NDI.Placement.GmCorrected"))}">${escapeHTML(t("NDI.Placement.GmCorrectedShort"))}</span>`;
  }  const resultBadge = result && Number.isFinite(Number(result.total))
    ? `<span class="ndi-result-badge">${result.total}</span>`
    : "";
  const endedBadge = finished
    ? `<span class="ndi-ended-badge" aria-hidden="true"><i class="fa-solid fa-check"></i></span>`
    : "";
  const lifecyclePip = lifecycleStatusPip(combatant, state);

  const badgeKey = timingBadgeFor(state.lifecycle, combatant.id, { enforce: isTimingEnforced() });
  const showOverlay = isPortraitOverlayBadge(badgeKey);
  const badgeText = showOverlay ? timingBadgeLabel(badgeKey) : null;
  const badgeClass = showOverlay ? portraitOverlayBadgeClass(badgeKey) : "";
  const timingBadge = badgeText
    ? `<span class="ndi-timing-badge ${badgeClass}" title="${escapeHTML(badgeText)}" aria-hidden="true">${escapeHTML(badgeText)}</span>`
    : "";

  let turnControls = "";
  if (isLifecyclePhase(state.phase) && state.lifecycle?.roster?.includes(combatant.id)) {
    if (canUserEndTurn(combatant, state)) {
      turnControls = `<button type="button" class="ndi-end-turn-btn ndi-primary" data-action="end-turn" data-combatant-id="${combatant.id}" title="${escapeHTML(t("NDI.Control.EndTurn"))}" aria-label="${escapeHTML(t("NDI.Control.EndTurn"))}">
        <i class="fa-solid fa-check"></i> ${escapeHTML(t("NDI.Control.EndTurn"))}
      </button>`;
    } else if (!finished && canEndTurn(state.lifecycle, combatant.id)) {
      const why = endTurnDisabledReason(combatant, state);
      if (why) {
        turnControls = `<button type="button" class="ndi-end-turn-btn" data-action="end-turn" data-combatant-id="${combatant.id}" title="${escapeHTML(why)}" aria-label="${escapeHTML(why)}" disabled aria-disabled="true">
          <i class="fa-solid fa-check"></i> ${escapeHTML(t("NDI.Control.EndTurn"))}
        </button>`;
      }
    } else if (canUserReopen(combatant, state)) {
      turnControls = `<button type="button" class="ndi-reopen-turn-btn" data-action="reopen-turn" data-combatant-id="${combatant.id}" title="${escapeHTML(t("NDI.Control.ReopenTurn"))}" aria-label="${escapeHTML(t("NDI.Control.ReopenTurn"))}">
        <i class="fa-solid fa-rotate-left"></i> ${escapeHTML(t("NDI.Control.ReopenTurn"))}
      </button>`;
    } else if (finished) {
      const reopenEval = evaluateReopenEligibility(state.lifecycle, combatant.id, {
        isGM: game.user.isGM,
        enforce: isTimingEnforced(),
      });
      if (game.user.isGM && reopenEval.requiresOverride) {
        turnControls = `<button type="button" class="ndi-reopen-turn-btn" data-action="timing-reopen-confused" data-combatant-id="${combatant.id}" title="${escapeHTML(t("NDI.Timing.ReopenConfusedTurn"))}" aria-label="${escapeHTML(t("NDI.Timing.ReopenConfusedTurn"))}">
          <i class="fa-solid fa-rotate-left"></i> ${escapeHTML(t("NDI.Timing.ReopenConfusedTurn"))}
        </button>`;
      } else {
        turnControls = `<span class="ndi-ended-label">${escapeHTML(t("NDI.Control.Ended"))}</span>`;
      }
    }
  }

  const gmTiming =
    game.user.isGM && lifecycleIsOpen(state) && isLifecyclePhase(state.phase)
      ? gmTimingMenuHTML(combatant, state)
      : "";

  const portraitTip = game.user.isGM
    ? t("NDI.Portrait.ActivateAndEditTip")
    : t("NDI.Portrait.ActivateToken");

  return `<article class="${portraitClasses(combatant, state)}" data-combatant-id="${combatant.id}">
    <button type="button" class="ndi-portrait-main" data-action="activate-portrait" data-combatant-id="${combatant.id}" title="${escapeHTML(portraitTip)}" aria-label="${escapeHTML(portraitTip)}">
      <span class="ndi-image-wrap">
        <img src="${escapeHTML(portraitFor(combatant))}" alt="${escapeHTML(combatantName(combatant))}" draggable="false">
        ${resultBadge}
        ${endedBadge}
        ${lifecyclePip}
        ${timingBadge}
        ${isLocallyControlledCombatant(combatant) ? `<span class="ndi-token-selected" title="${escapeHTML(t("NDI.Portrait.TokenSelected"))}" aria-label="${escapeHTML(t("NDI.Portrait.TokenSelected"))}"><i class="fa-solid fa-crosshairs" aria-hidden="true"></i></span>` : ""}
      </span>
      <span class="ndi-name">${escapeHTML(combatantName(combatant))}</span>
      <span class="ndi-status">${escapeHTML(statusFor(combatant, state))}</span>
    </button>
    <span class="ndi-card-actions">${rollButton}${delayButton}${gmCorrect}${placementEdit}</span>
    <div class="ndi-turn-controls">${turnControls}${gmTiming}${placementHint}</div>
  </article>`;
}

function gmTimingMenuHTML(combatant, state) {
  const record = state.lifecycle?.timing?.combatants?.[combatant.id];
  const hasBlock = Boolean(record?.delayBlocked);
  const hasOverride = Boolean(record?.gmOverride && !record.gmOverride.consumed);
  const gateActive = Boolean(state.lifecycle?.timing?.priorityGate?.active);
  const finished = isTurnFinished(state, combatant.id);
  if (!hasBlock && !hasOverride && !gateActive && !record?.confused) return "";

  let buttons = "";
  if (hasBlock && state.phase === PHASES.VANGUARD && !finished) {
    buttons += `<button type="button" class="ndi-timing-btn" data-action="timing-allow-delay" data-combatant-id="${combatant.id}" title="${escapeHTML(t("NDI.Timing.AllowDelayOnce"))}">${escapeHTML(t("NDI.Timing.AllowDelayOnce"))}</button>`;
    buttons += `<button type="button" class="ndi-timing-btn" data-action="timing-move-rearguard" data-combatant-id="${combatant.id}" title="${escapeHTML(t("NDI.Timing.MoveToRearguard"))}">${escapeHTML(t("NDI.Timing.MoveToRearguard"))}</button>`;
  }
  if (record?.confused && !finished && gateActive) {
    buttons += `<button type="button" class="ndi-timing-btn" data-action="timing-resolve-priority" data-combatant-id="${combatant.id}" title="${escapeHTML(t("NDI.Timing.ResolvePriority"))}">${escapeHTML(t("NDI.Timing.ResolvePriority"))}</button>`;
    buttons += `<button type="button" class="ndi-timing-btn" data-action="timing-skip-priority" data-combatant-id="${combatant.id}" title="${escapeHTML(t("NDI.Timing.SkipPriority"))}">${escapeHTML(t("NDI.Timing.SkipPriority"))}</button>`;
  }
  if (gateActive && !record?.confused && !finished) {
    buttons += `<button type="button" class="ndi-timing-btn" data-action="timing-resume-once" data-combatant-id="${combatant.id}" title="${escapeHTML(t("NDI.Timing.ResumeCurrentOnce"))}">${escapeHTML(t("NDI.Timing.ResumeCurrentOnce"))}</button>`;
  }
  if (hasOverride) {
    buttons += `<button type="button" class="ndi-timing-btn" data-action="timing-clear-override" data-combatant-id="${combatant.id}" title="${escapeHTML(t("NDI.Timing.ClearOverride"))}">${escapeHTML(t("NDI.Timing.ClearOverride"))}</button>`;
  }
  if (!buttons) return "";
  return `<div class="ndi-timing-menu" aria-label="${escapeHTML(t("NDI.Timing.MenuTitle"))}">${buttons}</div>`;
}

function initiativeZoneHTML({ label, zone, combatants, state, icon }) {
  const cards = combatants.length
    ? combatants.map((combatant) => portraitHTML(combatant, state)).join("")
    : `<span class="ndi-zone-empty">None</span>`;
  return `<section class="ndi-initiative-zone is-${zone}-zone">
    <div class="ndi-zone-title"><i class="fa-solid ${icon}"></i> ${label}</div>
    <div class="ndi-zone-portraits">${cards}</div>
  </section>`;
}

function initiativeStageHTML(combatants, state) {
  const vanguard = [];
  const awaiting = [];
  const rearguard = [];

  for (const combatant of combatants) {
    const phase = combatantPhase(state, combatant.id, combatantSide(combatant));
    if (isUnconscious(combatant) || phase === PHASES.REARGUARD) rearguard.push(combatant);
    else if (phase === PHASES.VANGUARD) vanguard.push(combatant);
    else awaiting.push(combatant);
  }

  return `<div class="ndi-initiative-stage">
    ${initiativeZoneHTML({ label: "Vanguard", zone: "vanguard", combatants: vanguard, state, icon: "fa-forward" })}
    ${initiativeZoneHTML({ label: "Awaiting Roll", zone: "awaiting", combatants: awaiting, state, icon: "fa-dice-d20" })}
    ${initiativeZoneHTML({ label: "Rearguard", zone: "rearguard", combatants: rearguard, state, icon: "fa-shield" })}
  </div>`;
}

function portraitStageHTML(combatants, state) {
  if (state.phase === PHASES.INITIATIVE) return initiativeStageHTML(combatants, state);
  return `<div class="ndi-portraits ${combatants.length ? "" : "is-empty"}">
    ${combatants.length
      ? combatants.map((combatant) => portraitHTML(combatant, state)).join("")
      : `<p>No eligible combatants in this phase.</p>`}
  </div>`;
}

function phaseProgressHTML(combat, state) {
  if (!isLifecyclePhase(state.phase) || !state.lifecycle) return "";
  const status = state.lifecycle.status;
  if (status === LIFECYCLE_STATUS.PREPARING || status === LIFECYCLE_STATUS.STARTING) {
    return `<div class="ndi-phase-progress is-busy" role="status">${escapeHTML(t("NDI.Lifecycle.StartingPhase"))}</div>`;
  }
  if (status === LIFECYCLE_STATUS.ENDING) {
    return `<div class="ndi-phase-progress is-busy" role="status">${escapeHTML(t("NDI.Lifecycle.EndingPhase"))}</div>`;
  }
  if (status === LIFECYCLE_STATUS.ERROR || status === LIFECYCLE_STATUS.INTERRUPTED) {
    return `<div class="ndi-phase-progress is-error" role="status">${escapeHTML(t("NDI.Lifecycle.Interrupted"))}</div>`;
  }
  const progress = lifecycleProgress(state.lifecycle, {
    combatantIds: [...combat.combatants].map((c) => c.id),
  });
  if (progress.complete || status === LIFECYCLE_STATUS.COMPLETE) {
    return `<div class="ndi-phase-progress is-complete" role="status">
      <i class="fa-solid fa-flag-checkered"></i> ${escapeHTML(t("NDI.Lifecycle.PhaseComplete"))}
      · ${escapeHTML(t("NDI.Lifecycle.EndedProgress", { ended: progress.ended, total: progress.total }))}
    </div>`;
  }
  return `<div class="ndi-phase-progress" role="status">
    ${escapeHTML(t("NDI.Lifecycle.EndedProgress", { ended: progress.ended, total: progress.total }))}
    · ${escapeHTML(t("NDI.Lifecycle.WaitingFor", { count: progress.remaining.length }))}
  </div>`;
}

function countdownPillHTML(state) {
  const display = formatCountdownDisplay(state.countdown, state.round);
  if (!display) {
    if (!game.user.isGM) return "";
    return `<button type="button" class="ndi-countdown-pill is-empty" data-action="edit-countdown" title="${escapeHTML(t("NDI.Countdown.Add"))}" aria-label="${escapeHTML(t("NDI.Countdown.Add"))}">
      <i class="fa-solid fa-hourglass-start" aria-hidden="true"></i>
      <span>${escapeHTML(t("NDI.Countdown.Add"))}</span>
    </button>`;
  }
  const nowClass = display.isNow ? " is-now" : "";
  const interactive = game.user.isGM
    ? ` data-action="edit-countdown" title="${escapeHTML(display.text)}" aria-label="${escapeHTML(t("NDI.Countdown.Edit"))}: ${escapeHTML(display.text)}"`
    : ` title="${escapeHTML(display.text)}" aria-label="${escapeHTML(display.text)}"`;
  const tag = game.user.isGM ? "button" : "div";
  const typeAttr = game.user.isGM ? ' type="button"' : "";
  return `<${tag}${typeAttr} class="ndi-countdown-pill${nowClass}"${interactive}>
      <i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>
      <span class="ndi-countdown-text">${escapeHTML(display.text)}</span>
    </${tag}>`;
}

function compactProgressText(combat, state) {
  if (!isLifecyclePhase(state.phase) || !state.lifecycle) return "";
  const progress = lifecycleProgress(state.lifecycle, {
    combatantIds: [...combat.combatants].map((c) => c.id),
  });
  return `${progress.ended}/${progress.total}`;
}

function gmPrimaryPhaseButtonHTML(combat, state) {
  const lifecycle = state.lifecycle;
  const progress = lifecycle
    ? lifecycleProgress(lifecycle, { combatantIds: [...combat.combatants].map((c) => c.id) })
    : null;
  const phaseComplete = lifecycle?.status === LIFECYCLE_STATUS.COMPLETE || progress?.complete;
  const busy = lifecycleBusy(state);

  if (state.phase === PHASES.INITIATIVE) {
    return `<button type="button" class="ndi-primary" data-action="prompt" title="${escapeHTML(t("NDI.Control.PromptInitiative"))}">
      <i class="fa-solid fa-dice-d20"></i> ${escapeHTML(t("NDI.Control.PromptInitiative"))}
    </button>`;
  }

  if (isLifecyclePhase(state.phase) && lifecycle) {
    if (phaseComplete && !busy) {
      return `<button type="button" class="ndi-primary" data-action="advance-phase" title="${escapeHTML(t("NDI.Control.AdvancePhase"))}">
        <i class="fa-solid fa-forward-step"></i> ${escapeHTML(t("NDI.Control.NextPhase"))}
      </button>`;
    }
    if (!phaseComplete && !busy) {
      return `<button type="button" data-action="apply-phase" ${progress && !progress.complete ? "disabled" : ""} title="${escapeHTML(phaseLabel(nextPhase(state.phase)))}">
        <i class="fa-solid fa-forward-step"></i> ${escapeHTML(t("NDI.Control.NextPhase"))}
      </button>`;
    }
    return "";
  }

  return `<button type="button" class="ndi-primary" data-action="apply-phase" title="${escapeHTML(phaseLabel(nextPhase(state.phase)))}">
    <i class="fa-solid fa-forward-step"></i> ${escapeHTML(t("NDI.Control.NextPhase"))}
  </button>`;
}

function gmOverflowItemsHTML(combat, state) {
  const lifecycle = state.lifecycle;
  const progress = lifecycle
    ? lifecycleProgress(lifecycle, { combatantIds: [...combat.combatants].map((c) => c.id) })
    : null;
  const open = lifecycle?.status === LIFECYCLE_STATUS.OPEN;
  const busy = lifecycleBusy(state);
  const recovery = gmRecoveryControlsHTML(state);
  let items = "";

  if (state.phase === PHASES.INITIATIVE) {
    items += `<label class="ndi-field ndi-overflow-field">DC <input type="number" min="0" max="99" value="${state.enemyDC}" data-action="dc"></label>`;
    items += `<label class="ndi-field ndi-overflow-field">Skill
      <select data-action="suggested-skill">${skillOptionsHTML(state.suggestedSkill)}</select>
    </label>`;
  }

  if (isLifecyclePhase(state.phase) && lifecycle && open && progress && !progress.complete) {
    items += `<button type="button" data-action="end-remaining" ${busy ? "disabled" : ""} title="${escapeHTML(t("NDI.Control.EndRemaining"))}">
      <i class="fa-solid fa-check-double"></i> ${escapeHTML(t("NDI.Control.EndRemaining"))}
    </button>`;
    items += `<button type="button" data-action="force-advance" ${busy ? "disabled" : ""} title="${escapeHTML(t("NDI.Control.ForceAdvance"))}">
      <i class="fa-solid fa-bolt"></i> ${escapeHTML(t("NDI.Control.ForceAdvance"))}
    </button>`;
  }

  items += recovery;
  items += `<button type="button" data-action="move-active-rearguard" ${state.phase === PHASES.VANGUARD && !busy ? "" : "disabled"}>
    <i class="fa-solid fa-arrow-down"></i> ${escapeHTML(t("NDI.Control.Rearguard"))}
  </button>`;
  items += `<button type="button" data-action="undo"><i class="fa-solid fa-rotate-left"></i> ${escapeHTML(t("NDI.Control.Undo"))}</button>`;
  items += `<button type="button" class="ndi-danger" data-action="end-combat"><i class="fa-solid fa-flag-checkered"></i> ${escapeHTML(t("NDI.Control.End"))}</button>`;
  return items;
}

function gmCompactControlsHTML(combat, state) {
  const primary = gmPrimaryPhaseButtonHTML(combat, state);
  return `<div class="ndi-gm-controls is-compact">
    ${primary}
    <div class="ndi-overflow">
      <button type="button" class="ndi-overflow-toggle" data-action="toggle-overflow" title="${escapeHTML(t("NDI.Control.MoreActions"))}" aria-label="${escapeHTML(t("NDI.Control.MoreActions"))}" aria-haspopup="menu" aria-expanded="false">
        <i class="fa-solid fa-ellipsis" aria-hidden="true"></i>
      </button>
      <div class="ndi-overflow-menu" role="menu" hidden>
        ${gmOverflowItemsHTML(combat, state)}
      </div>
    </div>
  </div>`;
}

function bottomBarHTML(combat, state) {
  const layout = resolvedPhaseBarLayoutNow();
  const phaseScale = currentPhaseBarScalePercent() / 100;
  const progress = compactProgressText(combat, state);
  const dc = state.phase === PHASES.INITIATIVE ? ` · DC ${state.enemyDC}` : "";
  const progressBit = progress ? ` · ${progress}` : "";
  const reactionNote =
    state.phase === PHASES.ENEMY && layout === PHASE_BAR_LAYOUTS.FULL
      ? '<span class="ndi-reaction-note"><i class="fa-solid fa-shield-halved"></i> Reactions resolve normally</span>'
      : "";

  if (layout === PHASE_BAR_LAYOUTS.COMPACT) {
    const playerControls = playerCompactControlsHTML(combat, state);
    const gmControls = game.user.isGM ? gmCompactControlsHTML(combat, state) : "";
    return `<footer class="ndi-bottom-bar ndi-drag-handle is-compact" data-phase-layout="compact" style="--ndi-phase-bar-scale:${phaseScale}" title="Drag to move; double-click to reset">
      <div class="ndi-compact-status" title="${escapeHTML(`${t("NDI.Phase." + (state.phase === PHASES.INITIATIVE ? "Initiative" : state.phase === PHASES.VANGUARD ? "Vanguard" : state.phase === PHASES.ENEMY ? "Enemy" : "Rearguard"))}`)}">
        <span class="ndi-round-phase">R${state.round} · ${phaseLabel(state.phase)}${progressBit}${dc}</span>
        ${countdownPillHTML(state)}
      </div>
      ${playerControls}
      ${gmControls}
    </footer>`;
  }

  return `<footer class="ndi-bottom-bar ndi-drag-handle is-full" data-phase-layout="full" style="--ndi-phase-bar-scale:${phaseScale}" title="Drag to move; double-click to reset">
    <div class="ndi-status-row">
      <div class="ndi-round-phase">Round ${state.round} · ${phaseLabel(state.phase)} Phase${dc}</div>
      ${countdownPillHTML(state)}
    </div>
    ${phaseProgressHTML(combat, state)}
    ${reactionNote}
    ${playerActiveControlsHTML(combat, state)}
    ${gmControlsHTML(combat, state)}
  </footer>`;
}

function gmControlsHTML(combat, state) {
  if (!game.user.isGM) return "";
  const initiativeControls = state.phase === PHASES.INITIATIVE
    ? `<label class="ndi-field">DC <input type="number" min="0" max="99" value="${state.enemyDC}" data-action="dc"></label>
       <label class="ndi-field">Skill
         <select data-action="suggested-skill">${skillOptionsHTML(state.suggestedSkill)}</select>
       </label>
       <button type="button" data-action="prompt"><i class="fa-solid fa-dice-d20"></i> ${escapeHTML(t("NDI.Control.PromptInitiative"))}</button>`
    : "";

  const lifecycle = state.lifecycle;
  const progress = lifecycle
    ? lifecycleProgress(lifecycle, { combatantIds: [...combat.combatants].map((c) => c.id) })
    : null;
  const phaseComplete = lifecycle?.status === LIFECYCLE_STATUS.COMPLETE || progress?.complete;
  const open = lifecycle?.status === LIFECYCLE_STATUS.OPEN;
  const busy = lifecycleBusy(state);
  const recovery = gmRecoveryControlsHTML(state);

  let phaseButtons = "";
  if (isLifecyclePhase(state.phase) && lifecycle) {
    if (open && progress && !progress.complete) {
      phaseButtons += `<button type="button" data-action="end-remaining" ${busy ? "disabled" : ""} title="${escapeHTML(t("NDI.Control.EndRemaining"))}">
        <i class="fa-solid fa-check-double"></i> ${escapeHTML(t("NDI.Control.EndRemaining"))}
      </button>`;
      phaseButtons += `<button type="button" data-action="force-advance" ${busy ? "disabled" : ""} title="${escapeHTML(t("NDI.Control.ForceAdvance"))}">
        <i class="fa-solid fa-bolt"></i> ${escapeHTML(t("NDI.Control.ForceAdvance"))}
      </button>`;
    }
    if (phaseComplete && !busy) {
      phaseButtons += `<button type="button" class="ndi-primary" data-action="advance-phase" title="${escapeHTML(t("NDI.Control.AdvancePhase"))}">
        <i class="fa-solid fa-forward-step"></i> ${escapeHTML(t("NDI.Control.AdvancePhase"))}
      </button>`;
    } else if (!isLifecyclePhase(state.phase) || state.phase === PHASES.INITIATIVE) {
      phaseButtons += `<button type="button" data-action="apply-phase" title="${escapeHTML(phaseLabel(nextPhase(state.phase)))}">
        <i class="fa-solid fa-forward-step"></i> ${escapeHTML(t("NDI.Control.NextPhase"))}
      </button>`;
    } else if (!phaseComplete && !busy) {
      phaseButtons += `<button type="button" data-action="apply-phase" ${progress && !progress.complete ? "disabled" : ""} title="${escapeHTML(phaseLabel(nextPhase(state.phase)))}">
        <i class="fa-solid fa-forward-step"></i> ${escapeHTML(t("NDI.Control.NextPhase"))}
      </button>`;
    }
  } else {
    phaseButtons = `<button type="button" data-action="apply-phase" title="${escapeHTML(phaseLabel(nextPhase(state.phase)))}">
      <i class="fa-solid fa-forward-step"></i> ${escapeHTML(t("NDI.Control.NextPhase"))}
    </button>`;
  }

  return `<div class="ndi-gm-controls is-full">
    ${initiativeControls}
    ${recovery}
    ${phaseButtons}
    <button type="button" data-action="move-active-rearguard" ${state.phase === PHASES.VANGUARD && !busy ? "" : "disabled"}>
      <i class="fa-solid fa-arrow-down"></i> ${escapeHTML(t("NDI.Control.Rearguard"))}
    </button>
    <button type="button" data-action="undo"><i class="fa-solid fa-rotate-left"></i> ${escapeHTML(t("NDI.Control.Undo"))}</button>
    <button type="button" class="ndi-danger" data-action="end-combat"><i class="fa-solid fa-flag-checkered"></i> ${escapeHTML(t("NDI.Control.End"))}</button>
  </div>`;
}

function eligibleOwnedEndTurnCombatants(combat, state) {
  return [...combat.combatants].filter(
    (combatant) => userCanOwnCombatant(game.user, combatant) && canUserEndTurn(combatant, state),
  );
}

function playerCompactControlsHTML(combat, state) {
  if (game.user.isGM) return "";
  const eligible = eligibleOwnedEndTurnCombatants(combat, state);
  if (eligible.length !== 1) return "";
  const combatant = eligible[0];
  return `<div class="ndi-active-controls is-compact">
    <button type="button" class="ndi-primary" data-action="end-turn" data-combatant-id="${combatant.id}" title="${escapeHTML(t("NDI.Control.EndTurn"))}">
      <i class="fa-solid fa-check"></i> ${escapeHTML(t("NDI.Control.EndTurn"))}
    </button>
  </div>`;
}

function playerActiveControlsHTML(combat, state) {
  // Players: only show End Turn / Delay for owned combatants — never GM recovery tools.
  if (game.user.isGM) {
    const combatant = getCombatant(combat, state.activeCombatantId);
    if (!combatant) return "";
    if (isTurnFinished(state, combatant.id)) return "";
    let delay = "";
    if (state.phase === PHASES.VANGUARD && lifecycleIsOpen(state)) {
      const delayOk = delayEligibilityFor(combatant, state).allowed;
      const tip = delayTooltip(combatant, state);
      delay = `<button type="button" data-action="delay" data-combatant-id="${combatant.id}" title="${escapeHTML(tip)}" ${delayOk ? "" : "disabled aria-disabled=\"true\""}><i class="fa-solid fa-arrow-down"></i> ${escapeHTML(t("NDI.Control.Delay"))}</button>`;
    }
    const endBtn = canUserEndTurn(combatant, state)
      ? `<button type="button" class="ndi-primary" data-action="end-turn" data-combatant-id="${combatant.id}"><i class="fa-solid fa-check"></i> ${escapeHTML(t("NDI.Control.EndTurn"))}</button>`
      : "";
    if (!delay && !endBtn) return "";
    return `<div class="ndi-active-controls">
      <strong>${escapeHTML(combatantName(combatant))}</strong>
      ${delay}
      ${endBtn}
    </div>`;
  }

  const eligible = eligibleOwnedEndTurnCombatants(combat, state);
  const combatant =
    eligible.length === 1
      ? eligible[0]
      : getCombatant(combat, state.activeCombatantId);
  if (!combatant || !userCanOwnCombatant(game.user, combatant)) return "";
  if (isTurnFinished(state, combatant.id) && eligible.length === 0) return "";

  let delay = "";
  if (state.phase === PHASES.VANGUARD && lifecycleIsOpen(state) && !isTurnFinished(state, combatant.id)) {
    const delayOk = delayEligibilityFor(combatant, state).allowed;
    const tip = delayTooltip(combatant, state);
    delay = `<button type="button" data-action="delay" data-combatant-id="${combatant.id}" title="${escapeHTML(tip)}" ${delayOk ? "" : "disabled aria-disabled=\"true\""}><i class="fa-solid fa-arrow-down"></i> ${escapeHTML(t("NDI.Control.Delay"))}</button>`;
  }
  const endBtn = canUserEndTurn(combatant, state)
    ? `<button type="button" class="ndi-primary" data-action="end-turn" data-combatant-id="${combatant.id}"><i class="fa-solid fa-check"></i> ${escapeHTML(t("NDI.Control.EndTurn"))}</button>`
    : "";
  if (!delay && !endBtn) return "";
  return `<div class="ndi-active-controls">
    <strong>${escapeHTML(combatantName(combatant))}</strong>
    ${delay}
    ${endBtn}
  </div>`;
}

function skillOptionsHTML(selected) {
  const skills = [
    ["last-used", "Last Used / Character Default"],
    ["perception", "Perception"],
    ["acrobatics", "Acrobatics"],
    ["arcana", "Arcana"],
    ["athletics", "Athletics"],
    ["crafting", "Crafting"],
    ["deception", "Deception"],
    ["diplomacy", "Diplomacy"],
    ["intimidation", "Intimidation"],
    ["medicine", "Medicine"],
    ["nature", "Nature"],
    ["occultism", "Occultism"],
    ["performance", "Performance"],
    ["religion", "Religion"],
    ["society", "Society"],
    ["stealth", "Stealth"],
    ["survival", "Survival"],
    ["thievery", "Thievery"],
  ];
  return skills
    .map(([slug, label]) => `<option value="${slug}" ${selected === slug ? "selected" : ""}>${label}</option>`)
    .join("");
}

function gmRecoveryControlsHTML(state) {
  if (!game.user.isGM || !state.lifecycle) return "";
  const status = state.lifecycle.status;
  if (status !== LIFECYCLE_STATUS.ERROR && status !== LIFECYCLE_STATUS.INTERRUPTED) return "";

  const startFailed = (state.lifecycle.start?.failedCombatants?.length ?? 0) > 0
    || Object.values(state.lifecycle.turns ?? {}).some(
      (t) => t.startStatus === "failed" || t.startStatus === "interrupted" || t.startStatus === "pending",
    );
  const endFailed = (state.lifecycle.end?.failedCombatants?.length ?? 0) > 0
    || Object.values(state.lifecycle.turns ?? {}).some(
      (t) => t.endStatus === "failed" || t.endStatus === "interrupted",
    );
  const endingContext =
    state.lifecycle.end?.status === "failed"
    || state.lifecycle.end?.status === "processing"
    || status === LIFECYCLE_STATUS.ENDING
    || (status === LIFECYCLE_STATUS.INTERRUPTED && state.lifecycle.end?.startedAt);

  if (endingContext || endFailed) {
    return `<button type="button" data-action="retry-failed-end" title="${escapeHTML(t("NDI.Control.RetryFailedEnd"))}">
        <i class="fa-solid fa-rotate"></i> ${escapeHTML(t("NDI.Control.RetryFailedEnd"))}
      </button>
      <button type="button" data-action="skip-failed-end" title="${escapeHTML(t("NDI.Control.SkipFailedEnd"))}">
        <i class="fa-solid fa-forward"></i> ${escapeHTML(t("NDI.Control.SkipFailedEnd"))}
      </button>`;
  }
  if (startFailed) {
    return `<button type="button" data-action="retry-failed-start" title="${escapeHTML(t("NDI.Control.RetryFailedStart"))}">
        <i class="fa-solid fa-rotate"></i> ${escapeHTML(t("NDI.Control.RetryFailedStart"))}
      </button>
      <button type="button" data-action="skip-failed-start" title="${escapeHTML(t("NDI.Control.SkipFailedStart"))}">
        <i class="fa-solid fa-forward"></i> ${escapeHTML(t("NDI.Control.SkipFailedStart"))}
      </button>`;
  }
  return "";
}

function restoreDockPosition(root) {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAG_KEY) ?? "null");
    if (!saved || !Number.isFinite(saved.left) || !Number.isFinite(saved.top)) return;
    root.style.left = `${saved.left}px`;
    root.style.top = `${saved.top}px`;
    root.style.transform = "none";
  } catch (_error) {
    // Ignore stale local state.
  }
}

function enableDrag(root) {
  const handle = root.querySelector(".ndi-drag-handle");
  if (!handle) return;
  let origin = null;
  handle.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button, input, select")) return;
    const rect = root.getBoundingClientRect();
    origin = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    root.style.left = `${rect.left}px`;
    root.style.top = `${rect.top}px`;
    root.style.transform = "none";
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (!origin) return;
    const left = Math.max(0, Math.min(window.innerWidth - root.offsetWidth, origin.left + event.clientX - origin.x));
    const top = Math.max(0, Math.min(window.innerHeight - 80, origin.top + event.clientY - origin.y));
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  });
  handle.addEventListener("pointerup", (event) => {
    if (!origin) return;
    origin = null;
    handle.releasePointerCapture(event.pointerId);
    const rect = root.getBoundingClientRect();
    localStorage.setItem(DRAG_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
  });
  handle.addEventListener("dblclick", () => {
    localStorage.removeItem(DRAG_KEY);
    root.style.left = "50%";
    root.style.top = `${game.settings.get(MODULE_ID, SETTINGS.VERTICAL_OFFSET)}px`;
    root.style.transform = "translateX(-50%)";
  });
}


async function confirmEndCombat() {
  const DialogV2 = foundry?.applications?.api?.DialogV2;
  if (DialogV2?.confirm) {
    return DialogV2.confirm({
      window: { title: t("NDI.Title") },
      content: `<p>${escapeHTML(t("NDI.Control.End"))}?</p>`,
      yes: { default: true },
    });
  }
  return window.confirm("End this combat encounter?");
}

function lifecycleStatusPip(combatant, state) {
  const status = combatantLifecycleUiStatus(state.lifecycle, combatant.id);
  if (!status) return "";
  const meta = {
    "start-pending": { icon: "fa-clock", tip: "NDI.Lifecycle.Status.StartPending", cls: "is-start-pending" },
    starting: { icon: "fa-spinner", tip: "NDI.Lifecycle.Status.Starting", cls: "is-starting" },
    ready: { icon: "fa-play", tip: "NDI.Lifecycle.Status.Ready", cls: "is-ready" },
    ended: { icon: "fa-check", tip: "NDI.Lifecycle.Status.Ended", cls: "is-ended-pip" },
    review: { icon: "fa-triangle-exclamation", tip: "NDI.Lifecycle.Status.Review", cls: "is-review" },
    skipped: { icon: "fa-forward", tip: "NDI.Lifecycle.Status.Skipped", cls: "is-skipped" },
  }[status];
  if (!meta) return "";
  const tip = t(meta.tip);
  return `<span class="ndi-lifecycle-pip ${meta.cls}" title="${escapeHTML(tip)}" aria-label="${escapeHTML(tip)}"><i class="fa-solid ${meta.icon}" aria-hidden="true"></i></span>`;
}

function incompletePhaseNames(combat, state) {
  if (!state.lifecycle) return [];
  const names = [];
  const remaining = lifecycleProgress(state.lifecycle, {
    combatantIds: [...combat.combatants].map((c) => c.id),
  }).remaining;
  const ends = endCandidates(state.lifecycle);
  const ids = [...new Set([...remaining, ...ends])];
  for (const id of ids) {
    const c = getCombatant(combat, id);
    if (c) names.push(combatantName(c));
  }
  return names;
}

/**
 * GM phase-advance guard: Return / Process Remaining / Advance Without Processing.
 * @returns {"return"|"process"|"skip"|null}
 */
async function incompletePhaseGuardDialog(combat, state) {
  const names = incompletePhaseNames(combat, state);
  const list = names.map((n) => `<li>${escapeHTML(n)}</li>`).join("");
  const content = `<p>${escapeHTML(t("NDI.Lifecycle.CannotAdvancePhase"))}</p>
    <p>${escapeHTML(t("NDI.Lifecycle.IncompleteTurnsList"))}</p>
    <ul>${list || `<li>${escapeHTML(t("NDI.Lifecycle.IncompleteUnknown"))}</li>`}</ul>`;

  let allowSkip = true;
  try {
    allowSkip = game.settings.get(MODULE_ID, SETTINGS.ALLOW_ADVANCE_WITHOUT_PROCESSING) !== false;
  } catch (_error) {
    allowSkip = true;
  }

  const DialogV2 = foundry?.applications?.api?.DialogV2;
  if (DialogV2?.wait) {
    const buttons = [
      {
        action: "return",
        label: t("NDI.Lifecycle.ReturnToPhase"),
        default: true,
      },
      {
        action: "process",
        label: t("NDI.Lifecycle.ProcessAndEndRemaining"),
      },
    ];
    if (allowSkip) {
      buttons.push({
        action: "skip",
        label: t("NDI.Lifecycle.AdvanceWithoutProcessing"),
      });
    }
    const result = await DialogV2.wait({
      window: { title: t("NDI.Lifecycle.CannotAdvanceTitle") },
      content,
      buttons,
      rejectClose: false,
    });
    if (result === "process" || result === "skip" || result === "return") return result;
    return "return";
  }

  // Fallback: confirm = process, cancel = return (no silent skip).
  const ok = window.confirm(
    `${t("NDI.Lifecycle.CannotAdvancePhase")}\n\n${names.join(", ")}\n\nOK = Process and End Remaining`,
  );
  return ok ? "process" : "return";
}

function placementReasonText(reason) {
  switch (reason) {
    case "phase-already-ended":
      return t("NDI.Placement.PhaseEnded");
    case "turn-completed":
      return t("NDI.Placement.TurnCompleted");
    case "lifecycle-busy":
      return t("NDI.Placement.LifecycleBusy");
    case "pending-unsafe":
      return t("NDI.Placement.PendingUnsafe");
    case "already-there":
      return t("NDI.Placement.AlreadyThere");
    default:
      return t("NDI.Placement.QueueInstead");
  }
}

function placementPhaseLabel(phase) {
  switch (phase) {
    case PLACEMENTS.VANGUARD:
      return t("NDI.Phase.Vanguard");
    case PLACEMENTS.ENEMY:
      return t("NDI.Phase.Enemy");
    case PLACEMENTS.REARGUARD:
      return t("NDI.Phase.Rearguard");
    case PLACEMENTS.PENDING:
      return t("NDI.Placement.Pending");
    default:
      return phase;
  }
}

async function openPlacementEditor(combatantId) {
  if (!game.user.isGM) return;
  const combat = getCombat();
  const projection = getPlacementEditorProjection(combat, combatantId);
  const combatant = getCombatant(combat, combatantId);
  if (!projection || !combatant) return;

  const currentButtons = projection.currentRoundOptions
    .map((opt) => {
      const label = placementPhaseLabel(opt.phase);
      const title = opt.allowed ? label : placementReasonText(opt.reason);
      return `<button type="button" data-placement-mode="current-round" data-placement-phase="${opt.phase}" ${opt.allowed ? "" : "disabled"} title="${escapeHTML(title)}">${escapeHTML(label)}</button>`;
    })
    .join("");
  const nextButtons = projection.nextRoundOptions
    .map((opt) => {
      const label = placementPhaseLabel(opt.phase);
      return `<button type="button" data-placement-mode="next-round" data-placement-phase="${opt.phase}" title="${escapeHTML(t("NDI.Placement.QueueForNextRound"))}">${escapeHTML(label)}</button>`;
    })
    .join("");
  const cancelQueue = projection.queued
    ? `<button type="button" data-placement-cancel="1">${escapeHTML(t("NDI.Placement.CancelQueued"))}</button>`
    : "";
  const queuedLine = projection.queued
    ? `<p><strong>${escapeHTML(t("NDI.Placement.Queued"))}:</strong> ${escapeHTML(placementPhaseLabel(projection.queued.targetPhase))} (${escapeHTML(t("NDI.Placement.EffectiveRound", { round: projection.queued.effectiveRound }))})</p>`
    : "";

  const content = `
    <div class="ndi-placement-editor">
      <p><strong>${escapeHTML(combatantName(combatant))}</strong></p>
      <p>${escapeHTML(t("NDI.Placement.CurrentRound"))}: ${escapeHTML(String(projection.round))} · ${escapeHTML(phaseLabel(projection.phase))}</p>
      <p>${escapeHTML(t("NDI.Placement.CurrentPlacement"))}: ${escapeHTML(placementPhaseLabel(projection.sourcePhase))}</p>
      <p>${escapeHTML(t("NDI.Placement.Started"))}: ${projection.started ? "✓" : "—"} · ${escapeHTML(t("NDI.Control.Ended"))}: ${projection.ended ? "✓" : "—"}</p>
      ${queuedLine}
      <div class="ndi-placement-section"><h3>${escapeHTML(t("NDI.Placement.CurrentRound"))}</h3><div class="ndi-placement-buttons">${currentButtons}</div></div>
      <div class="ndi-placement-section"><h3>${escapeHTML(t("NDI.Placement.NextRound"))}</h3><div class="ndi-placement-buttons">${nextButtons}</div></div>
      <div class="ndi-placement-buttons">${cancelQueue}</div>
    </div>
  `;

  const DialogV2 = foundry?.applications?.api?.DialogV2;
  if (!DialogV2?.wait) {
    notifyFallback(content);
    return;
  }

  await DialogV2.wait({
    window: { title: t("NDI.Placement.Edit") },
    content,
    buttons: [
      {
        action: "close",
        label: t("NDI.Placement.Close"),
        default: true,
      },
    ],
    render: (_event, dialog) => {
      const root = dialog?.element ?? dialog;
      root?.querySelectorAll?.("[data-placement-phase]")?.forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          if (button.disabled) return;
          const mode = button.dataset.placementMode;
          const phase = button.dataset.placementPhase;
          let replace = false;
          if (mode === PLACEMENT_MODES.NEXT_ROUND && projection.queued) {
            replace = await confirmDialog(
              t("NDI.Placement.ReplaceQueued"),
              t("NDI.Placement.ReplaceQueuedConfirm"),
            );
            if (!replace) return;
          }
          dialog.close?.();
          await requestAction(
            mode === PLACEMENT_MODES.NEXT_ROUND ? REQUESTS.PLACEMENT_QUEUE : REQUESTS.PLACEMENT_APPLY,
            {
              combatantId,
              targetPhase: phase,
              mode,
              replace,
              expectedRevision: projection.revision,
            },
          );
        });
      });
      root?.querySelector?.("[data-placement-cancel]")?.addEventListener("click", async (event) => {
        event.preventDefault();
        dialog.close?.();
        await requestAction(REQUESTS.PLACEMENT_CANCEL_QUEUE, { combatantId });
      });
    },
  });
}

function notifyFallback(html) {
  // Extremely degraded environments without DialogV2 — surface a notice only.
  ui?.notifications?.warn?.(t("NDI.Placement.DialogUnavailable"));
  void html;
}

function bindDockEvents(root, combat, state) {
  const setPortraitTokenHover = (combatantId, hovered) => {
    const combatant = getCombatant(combat, combatantId);
    const token = combatant?.token?.object ?? canvas?.tokens?.get?.(combatant?.tokenId);
    if (!token || token.destroyed) return;
    token.hover = hovered;
    token.renderFlags?.set?.({ refreshState: true, refreshBorder: true });
    token.refresh?.();
  };

  const closeOverflowMenus = () => {
    root.querySelectorAll(".ndi-overflow-menu").forEach((menu) => {
      menu.hidden = true;
    });
    root.querySelectorAll(".ndi-overflow-toggle").forEach((btn) => {
      btn.setAttribute("aria-expanded", "false");
    });
    if (overflowMenuCloser) {
      document.removeEventListener("pointerdown", overflowMenuCloser, true);
      document.removeEventListener("keydown", overflowMenuCloser, true);
      overflowMenuCloser = null;
    }
  };

  const openOverflowMenu = (toggle) => {
    closeOverflowMenus();
    const menu = toggle.parentElement?.querySelector(".ndi-overflow-menu");
    if (!menu) return;
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    overflowMenuCloser = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "pointerdown" && toggle.parentElement?.contains(event.target)) return;
      closeOverflowMenus();
    };
    document.addEventListener("pointerdown", overflowMenuCloser, true);
    document.addEventListener("keydown", overflowMenuCloser, true);
  };

  root.addEventListener("pointerover", (event) => {
    const portrait = event.target.closest(".ndi-portrait[data-combatant-id]");
    if (!portrait || portrait.contains(event.relatedTarget)) return;
    setPortraitTokenHover(portrait.dataset.combatantId, true);
  });

  root.addEventListener("pointerout", (event) => {
    const portrait = event.target.closest(".ndi-portrait[data-combatant-id]");
    if (!portrait || portrait.contains(event.relatedTarget)) return;
    setPortraitTokenHover(portrait.dataset.combatantId, false);
  });

  root.addEventListener("contextmenu", (event) => {
    const portrait = event.target.closest(".ndi-portrait[data-combatant-id]");
    if (!portrait) return;
    if (!game.user.isGM) return;
    const combatantId = portrait.dataset.combatantId;
    if (!combatantId || !getCombatant(combat, combatantId)) return;
    event.preventDefault();
    event.stopPropagation();
    void openPlacementEditor(combatantId);
  });

  root.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const combatantId = target.dataset.combatantId;

    if (action !== "toggle-overflow") closeOverflowMenus();

    switch (action) {
      case "toggle-overflow": {
        event.stopPropagation();
        const menu = target.parentElement?.querySelector(".ndi-overflow-menu");
        if (!menu) break;
        if (menu.hidden) openOverflowMenu(target);
        else closeOverflowMenus();
        break;
      }
      case "activate-portrait": {
        // Local token navigation first — never gated on claim eligibility.
        await activateCombatantPortrait(combat, combatantId);
        // Preserve free-order claim when the combatant may currently act.
        const claimCombatant = getCombatant(combat, combatantId);
        if (claimCombatant && canUserClaim(claimCombatant, state) && state.phase !== PHASES.INITIATIVE) {
          await requestAction(REQUESTS.CLAIM, { combatantId });
        }
        break;
      }
      case "edit-countdown":
        event.stopPropagation();
        if (game.user.isGM) await openCountdownEditor(state);
        break;
      case "claim":
        if (!target.disabled && state.phase !== PHASES.INITIATIVE) await requestAction(REQUESTS.CLAIM, { combatantId });
        break;
      case "roll":
        await openInitiativePrompt(combatantId);
        break;
      case "prompt":
        await requestAction(REQUESTS.PROMPT);
        break;
      case "apply-phase":
      case "advance-phase": {
        const phase = nextPhase(state.phase);
        let guard = true;
        try {
          guard = game.settings.get(MODULE_ID, SETTINGS.GUARD_INCOMPLETE_PHASE) !== false;
        } catch (_error) {
          guard = true;
        }
        if (
          game.user.isGM &&
          guard &&
          isLifecyclePhase(state.phase) &&
          state.lifecycle &&
          !phaseAdvanceReady(state.lifecycle, {
            combatantIds: [...combat.combatants].map((c) => c.id),
          })
        ) {
          const choice = await incompletePhaseGuardDialog(combat, state);
          if (choice === "return" || choice == null) break;
          if (choice === "process") {
            await requestAction(REQUESTS.PROCESS_END_REMAINING);
            break;
          }
          if (choice === "skip") {
            await requestAction(REQUESTS.FORCE_ADVANCE);
            break;
          }
        }
        await requestAction(REQUESTS.SET_PHASE, { phase });
        break;
      }
      case "force-advance": {
        const progress = state.lifecycle
          ? lifecycleProgress(state.lifecycle, { combatantIds: [...combat.combatants].map((c) => c.id) })
          : { remaining: [] };
        const ok = await confirmDialog(
          t("NDI.Control.ForceAdvance"),
          t("NDI.Lifecycle.ForceAdvanceConfirm", { count: progress.remaining?.length ?? 0 }),
        );
        if (ok) await requestAction(REQUESTS.FORCE_ADVANCE);
        break;
      }
      case "end-remaining": {
        const ok = await confirmDialog(
          t("NDI.Control.EndRemaining"),
          t("NDI.Lifecycle.EndRemainingConfirm"),
        );
        if (ok) await requestAction(REQUESTS.END_REMAINING);
        break;
      }
      case "retry-failed-start":
        await requestAction(REQUESTS.RETRY_FAILED_START);
        break;
      case "skip-failed-start":
        await requestAction(REQUESTS.SKIP_FAILED_START);
        break;
      case "retry-failed-end":
        await requestAction(REQUESTS.RETRY_FAILED_END);
        break;
      case "skip-failed-end":
        await requestAction(REQUESTS.SKIP_FAILED_END);
        break;
      case "move-active-rearguard":
        await requestAction(REQUESTS.MOVE_REARGUARD, { combatantId: state.activeCombatantId });
        break;
      case "delay":
        if (target.disabled) break;
        event.stopPropagation();
        await requestAction(REQUESTS.DELAY, { combatantId });
        break;
      case "end-turn":
        if (target.disabled) break;
        event.stopPropagation();
        await requestAction(REQUESTS.END_TURN, { combatantId });
        break;
      case "reopen-turn":
        event.stopPropagation();
        await requestAction(REQUESTS.REOPEN_TURN, { combatantId });
        break;
      case "timing-allow-delay": {
        event.stopPropagation();
        const ok = await confirmDialog(t("NDI.Timing.AllowDelayOnce"), t("NDI.Timing.AllowDelayConfirm"));
        if (ok) await requestAction(REQUESTS.TIMING_ALLOW_DELAY_ONCE, { combatantId, confirmed: true });
        break;
      }
      case "timing-move-rearguard":
        event.stopPropagation();
        await requestAction(REQUESTS.TIMING_MOVE_REARGUARD, { combatantId, gmMove: true });
        break;
      case "timing-resolve-priority": {
        event.stopPropagation();
        const ok = await confirmDialog(t("NDI.Timing.ResolvePriority"), t("NDI.Timing.ResolvePriorityConfirm"));
        if (ok) await requestAction(REQUESTS.TIMING_RESOLVE_PRIORITY, { combatantId, confirmed: true });
        break;
      }
      case "timing-skip-priority": {
        event.stopPropagation();
        const ok = await confirmDialog(t("NDI.Timing.SkipPriority"), t("NDI.Timing.SkipPriorityConfirm"));
        if (ok) await requestAction(REQUESTS.TIMING_SKIP_PRIORITY, { combatantId, confirmed: true });
        break;
      }
      case "timing-reopen-confused": {
        event.stopPropagation();
        const ok = await confirmDialog(t("NDI.Timing.ReopenConfusedTurn"), t("NDI.Timing.ReopenConfusedConfirm"));
        if (ok) await requestAction(REQUESTS.TIMING_REOPEN_CONFUSED, { combatantId, confirmed: true });
        break;
      }
      case "timing-resume-once":
        event.stopPropagation();
        await requestAction(REQUESTS.TIMING_RESUME_CURRENT_ONCE, { combatantId });
        break;
      case "timing-clear-override":
        event.stopPropagation();
        await requestAction(REQUESTS.TIMING_CLEAR_OVERRIDE, { combatantId });
        break;
      case "edit-placement":
        event.stopPropagation();
        await openPlacementEditor(combatantId);
        break;
      case "toggle-acted":
        event.stopPropagation();
        await requestAction(REQUESTS.MARK_ACTED, {
          combatantId,
          acted: !isTurnFinished(state, combatantId),
        });
        break;
      case "undo":
        await requestAction(REQUESTS.UNDO);
        break;
      case "end-combat":
        if (await confirmEndCombat()) await requestAction(REQUESTS.END_COMBAT);
        break;
      default:
        break;
    }
  });

  const dcInput = root.querySelector('[data-action="dc"]');
  dcInput?.addEventListener("change", () => requestAction(REQUESTS.SET_DC, { dc: dcInput.value }));
  const skillSelect = root.querySelector('[data-action="suggested-skill"]');
  skillSelect?.addEventListener("change", () => requestAction(REQUESTS.SET_SKILL, { skill: skillSelect.value }));
}

/**
 * Persistent dock/launcher mount on document.body.
 * Stacking is owned by CSS --ndi-interface-z (below Foundry --z-index-window).
 * Do not set inline z-index or reorder Foundry application windows.
 */
function mountInterfaceElement(element) {
  document.body.append(element);
}

function createLauncher() {
  if (!game.user.isGM) return;
  const existing = document.getElementById(LAUNCHER_ID);
  if (existing) return;
  const combat = getCombat();
  const hasSelectedTokens = Boolean(canvas?.tokens?.controlled?.length);
  if (!combat && !hasSelectedTokens) return;
  const button = document.createElement("button");
  button.id = LAUNCHER_ID;
  button.type = "button";
  button.innerHTML = `<i class="fa-solid fa-bolt"></i> ${escapeHTML(t("NDI.Title"))}`;
  button.addEventListener("click", () => void beginNelTempoWithOptionalCountdown());
  mountInterfaceElement(button);
}

/**
 * Optional countdown fields before starting NelTempo.
 */
export async function beginNelTempoWithOptionalCountdown() {
  if (!game.user.isGM) return;
  const DialogV2 = foundry?.applications?.api?.DialogV2;
  if (!DialogV2?.wait) {
    await requestAction(REQUESTS.START, {});
    return;
  }

  const result = await DialogV2.wait({
    window: { title: t("NDI.Title") },
    content: `<form class="ndi-countdown-form">
      <p>${escapeHTML(t("NDI.Countdown.StartHint"))}</p>
      <label>${escapeHTML(t("NDI.Countdown.Label"))}
        <input type="text" name="countdownLabel" maxlength="80" placeholder="${escapeHTML(t("NDI.Countdown.LabelPlaceholder"))}">
      </label>
      <label>${escapeHTML(t("NDI.Countdown.Rounds"))}
        <input type="number" name="countdownRounds" min="1" max="99" step="1" placeholder="3">
      </label>
    </form>`,
    buttons: [
      {
        action: "start",
        label: t("NDI.Control.Start"),
        default: true,
        callback: (_event, button) => readNamedFormFields(button, ["countdownLabel", "countdownRounds"]),
      },
      { action: "cancel", label: t("NDI.Placement.Close") },
    ],
  });

  if (!result || result === "cancel") return;
  await requestAction(REQUESTS.START, {
    countdownLabel: result.countdownLabel,
    countdownRounds: result.countdownRounds,
  });
}

function readNamedFormFields(button, names) {
  const el = button?.element ?? button;
  const form =
    button?.form ??
    el?.closest?.("form") ??
    el?.closest?.(".application")?.querySelector?.("form.ndi-countdown-form") ??
    document.querySelector("form.ndi-countdown-form");
  const out = {};
  for (const name of names) out[name] = "";
  if (!form) return out;
  const data = new FormData(form);
  for (const name of names) out[name] = String(data.get(name) ?? "");
  return out;
}

async function openCountdownEditor(state) {
  if (!game.user.isGM) return;
  const existing = sanitizeCountdown(state.countdown);
  const display = formatCountdownDisplay(existing, state.round);
  const DialogV2 = foundry?.applications?.api?.DialogV2;
  if (!DialogV2?.wait) return;

  const result = await DialogV2.wait({
    window: { title: t("NDI.Countdown.Edit") },
    content: `<form class="ndi-countdown-form">
      <label>${escapeHTML(t("NDI.Countdown.Label"))}
        <input type="text" name="label" maxlength="80" value="${escapeHTML(existing?.label ?? "")}" placeholder="${escapeHTML(t("NDI.Countdown.LabelPlaceholder"))}">
      </label>
      <label>${escapeHTML(t("NDI.Countdown.RoundsFromNow"))}
        <input type="number" name="rounds" min="1" max="99" step="1" value="${display && !display.isNow ? display.remaining : 3}">
      </label>
    </form>`,
    buttons: [
      {
        action: "save",
        label: t("NDI.Countdown.Save"),
        default: true,
        callback: (_event, button) => readNamedFormFields(button, ["label", "rounds"]),
      },
      {
        action: "clear",
        label: t("NDI.Countdown.Clear"),
      },
      { action: "cancel", label: t("NDI.Placement.Close") },
    ],
  });

  if (!result || result === "cancel") return;
  if (result === "clear") {
    await requestAction(REQUESTS.COUNTDOWN_CLEAR, {});
    return;
  }
  await requestAction(REQUESTS.COUNTDOWN_SET, {
    label: result.label,
    rounds: result.rounds,
  });
}

export function renderDock() {
  document.getElementById(DOCK_ID)?.remove();
  document.getElementById(LAUNCHER_ID)?.remove();
  if (overflowMenuCloser) {
    document.removeEventListener("pointerdown", overflowMenuCloser, true);
    document.removeEventListener("keydown", overflowMenuCloser, true);
    overflowMenuCloser = null;
  }

  const combat = getCombat();
  const state = getState(combat);
  syncNativeCombatTracker(Boolean(combat && state?.enabled));
  if (state?.phase !== PHASES.INITIATIVE) {
    document.querySelectorAll(`.${MODAL_CLASS}`).forEach((element) => element.remove());
    openPromptIds.clear();
  }
  if (!combat || !state?.enabled) {
    createLauncher();
    return;
  }

  const combatants = phaseCombatants(combat, state);
  const root = document.createElement("section");
  root.id = DOCK_ID;
  const portraitScale = currentPortraitScalePercent() / 100;
  const phaseBarScale = currentPhaseBarScalePercent() / 100;
  root.style.setProperty("--ndi-portrait-size", `${currentPortraitSize()}px`);
  root.style.setProperty("--ndi-portrait-scale", String(portraitScale));
  root.style.setProperty("--ndi-phase-bar-scale", String(phaseBarScale));
  root.style.setProperty("--ndi-max-width", `${game.settings.get(MODULE_ID, SETTINGS.MAX_WIDTH)}vw`);
  root.dataset.portraitScale = String(currentPortraitScalePercent());
  root.dataset.phaseBarScale = String(currentPhaseBarScalePercent());
  root.dataset.phaseBarLayout = resolvedPhaseBarLayoutNow();
  root.style.top = `${game.settings.get(MODULE_ID, SETTINGS.VERTICAL_OFFSET)}px`;
  // Do not use Chromium zoom on the dock root — it shrinks all hit targets. Portrait visuals scale via CSS vars.
  // Never set an inline z-index — CSS interface-layer variable owns stacking.
  root.innerHTML = `${portraitStageHTML(combatants, state)}${bottomBarHTML(combat, state)}`;
  mountInterfaceElement(root);
  restoreDockPosition(root);
  enableDrag(root);
  bindDockEvents(root, combat, state);
  updateOpenPromptDC(state.enemyDC);
}

/**
 * Foundry keybinding entry: End Turn for exactly one eligible owned combatant.
 * Uses the existing requestAction/authority path. Notifies only when explicitly illegal.
 */
export async function endCurrentTurnFromKeybinding() {
  if (isTextEntryTarget(document.activeElement)) return { ok: false, reason: "text-entry" };
  const combat = getCombat();
  const state = getState(combat);
  if (!combat || !state?.enabled) {
    ui?.notifications?.warn?.(t("NDI.Error.NotActive"));
    return { ok: false, reason: "not-active" };
  }
  const eligible = eligibleOwnedEndTurnCombatants(combat, state);
  if (eligible.length !== 1) {
    ui?.notifications?.warn?.(t("NDI.Keybinding.EndCurrentTurn.NotEligible"));
    return { ok: false, reason: "not-eligible", count: eligible.length };
  }
  const combatant = eligible[0];
  await requestAction(REQUESTS.END_TURN, { combatantId: combatant.id });
  return { ok: true, combatantId: combatant.id };
}

function closePrompt(modal) {
  if (!modal) return;
  openPromptIds.delete(modal.dataset.promptKey);
  modal.remove();
}

export async function openInitiativePrompt(combatantId, promptData = null) {
  const combat = getCombat();
  const state = getState(combat);
  const combatant = getCombatant(combat, combatantId);
  if (!combat || !state?.enabled || !combatant?.actor) return;
  if (!game.user.isGM && !userCanOwnCombatant(game.user, combatant)) return;
  const effectiveRound = Number(promptData?.round ?? state.round ?? 1);
  const effectivePromptId = String(promptData?.promptId ?? state.promptId ?? "");
  const effectiveDC = Number(promptData?.dc ?? state.enemyDC ?? 10);
  // A remote client can receive the prompt socket a fraction before its local
  // Combat document reaches the new Initiative phase. Accept a current/future
  // GM prompt payload instead of silently discarding it during that race.
  if (!promptData && state.phase !== PHASES.INITIATIVE) return;
  if (promptData && effectiveRound < Number(state.round ?? 1)) return;
  const currentResult = Number(state.round ?? 1) === effectiveRound
    ? resultForCurrentRound(state, combatant.id)
    : null;
  if (currentResult || isUnconscious(combatant)) return;
  if (!effectivePromptId) return;

  const promptKey = `${combat.id}.${effectivePromptId}.${combatant.id}`;
  if (openPromptIds.has(promptKey)) return;
  openPromptIds.add(promptKey);

  const choices = standardSkillChoices(combatant.actor);
  const selected = promptData?.selectedSkill ?? suggestedSkillFor(combatant, state);
  const options = choices
    .map((choice) => `<option value="${escapeHTML(choice.slug)}" ${choice.slug === selected ? "selected" : ""}>${escapeHTML(choice.label)}${choice.mod == null ? "" : ` (${choice.mod >= 0 ? "+" : ""}${choice.mod})`}</option>`)
    .join("");
  const modal = document.createElement("div");
  modal.className = `${MODAL_CLASS} ndi-modal-backdrop`;
  modal.dataset.promptKey = promptKey;
  modal.innerHTML = `<form class="ndi-modal-card">
      <header><i class="fa-solid fa-dice-d20"></i> Initiative Check</header>
      <img src="${escapeHTML(portraitFor(combatant))}" alt="${escapeHTML(combatantName(combatant))}">
      <h3>${escapeHTML(combatantName(combatant))}</h3>
      <p>Round ${effectiveRound} · Enemy Initiative DC <strong class="ndi-prompt-dc">${effectiveDC}</strong></p>
      <label>Initiative skill
        <select name="skill">${options}</select>
      </label>
      <p class="ndi-modal-help">Choose the skill that fits the current situation. The normal PF2e modifier dialog opens next.</p>
      <footer>
        <button type="button" data-modal-action="cancel">Later</button>
        <button type="submit" class="ndi-primary"><i class="fa-solid fa-dice-d20"></i> Roll Initiative</button>
      </footer>
    </form>`;
  document.body.append(modal);

  modal.querySelector('[data-modal-action="cancel"]')?.addEventListener("click", () => closePrompt(modal));
  modal.querySelector("form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const skill = new FormData(event.currentTarget).get("skill");
    const reopenData = { ...promptData, selectedSkill: String(skill) };
    // The PF2e modifier dialog is a second application. Close our full-screen
    // backdrop before opening it so the native roll dialog is not trapped
    // behind the Dynamic Initiative prompt.
    closePrompt(modal);
    try {
      const latestState = getState(combat);
      const rollDC = Number(
        latestState?.round === effectiveRound ? latestState.enemyDC : effectiveDC,
      );
      const result = await rollDynamicInitiative(combatant, {
        skill: String(skill),
        dc: rollDC,
        initial: Boolean(promptData?.initial ?? latestState?.initialInitiativePending),
      });
      if (!result) {
        void openInitiativePrompt(combatantId, reopenData);
        return;
      }
      const placement = phaseForResult(result.total, rollDC);
      ui.notifications.info(
        `${combatantName(combatant)} rolled ${result.total}: ${phaseLabel(placement)}.`,
      );
      await requestAction(REQUESTS.SUBMIT_ROLL, {
        combatantId: combatant.id,
        promptId: effectivePromptId,
        total: result.total,
        skill: result.skill,
        label: result.label,
      });
    } catch (error) {
      console.error(`${MODULE_ID} | Initiative prompt failed`, error);
      ui.notifications.error(error.message ?? "Initiative roll failed.");
      void openInitiativePrompt(combatantId, reopenData);
    }
  });
}

function updateOpenPromptDC(dc) {
  document.querySelectorAll(`.${MODAL_CLASS} .ndi-prompt-dc`).forEach((element) => {
    element.textContent = String(dc);
  });
}

export function handleInitiativePrompt(prompt) {
  const combat = game.combats.get(prompt.combatId);
  if (!combat || getCombat()?.id !== combat.id) return;
  const state = getState(combat);
  if (!state?.enabled) return;
  // The socket can arrive before the Combat flag update on a remote client.
  // Treat the GM-issued prompt payload as authoritative for this prompt.
  if (Number(prompt.round ?? 0) < Number(state.round ?? 0)) return;

  const combatants = game.user.isGM
    ? combat.combatants.filter(
        (combatant) =>
          combatantSide(combatant) === "party" &&
          !isUnavailable(combatant) &&
          activePlayerOwners(combatant).length === 0,
      )
    : ownedPartyCombatants(combat, game.user);

  if (!game.settings.get(MODULE_ID, SETTINGS.AUTO_OPEN_PROMPTS)) return;
  for (const combatant of combatants) void openInitiativePrompt(combatant.id, prompt);
}

export function removeUI() {
  document.getElementById(DOCK_ID)?.remove();
  document.getElementById(LAUNCHER_ID)?.remove();
  document.querySelectorAll(`.${MODAL_CLASS}`).forEach((element) => element.remove());
  openPromptIds.clear();
  syncNativeCombatTracker(false);
}

export function syncNativeCombatTracker(active) {
  document.body?.classList.toggle("ndi-suppress-native-tracker", active);

  const trackerRoots = document.querySelectorAll(
    "#combat-tracker, .combat-tracker, [data-tab='combat'][data-group='primary']",
  );
  for (const tracker of trackerRoots) {
    const application = tracker.closest(".application, .app");
    if (application && application.id !== "sidebar" && !application.closest("#sidebar")) {
      application.classList.toggle("ndi-native-tracker-hidden", active);
    } else {
      tracker.classList.toggle("ndi-native-tracker-hidden", active);
    }
  }
}
