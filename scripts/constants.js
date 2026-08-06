export const MODULE_ID = "nel-dynamic-initiative";
export const MODULE_TITLE = "NelTempo";
export const SOCKET_NAME = `module.${MODULE_ID}`;
export const FLAG_STATE = "state";

export const SETTINGS = Object.freeze({
  PORTRAIT_SIZE: "portraitSize",
  VERTICAL_OFFSET: "verticalOffset",
  MAX_WIDTH: "maxWidth",
  AUTO_OPEN_PROMPTS: "autoOpenPrompts",
  MANAGE_RAISED_SHIELD: "manageRaisedShield",
  DEBUG: "debugLogging",
  /** off | prompt | automatic — advance when all roster turns end */
  AUTO_ADVANCE_PHASE: "autoAdvancePhase",
  /** Enforce Grabbed/Restrained/Confused timing restrictions */
  ENFORCE_CONDITION_TIMING: "enforceConditionTiming",
  /** Client: pan camera when activating a portrait token */
  PAN_CAMERA_ON_PORTRAIT: "panCameraOnPortraitActivation",
  /**
   * Legacy client dock zoom (50–100). Kept for migration / rollback; hidden from config.
   * Prefer PORTRAIT_SCALE + PHASE_BAR_SCALE.
   */
  INTERFACE_SCALE: "interfaceScale",
  /** Client: visual scale of portrait art/content only (50–100). */
  PORTRAIT_SCALE: "portraitScale",
  /** Client: phase/status bar presentation scale (60–100). */
  PHASE_BAR_SCALE: "phaseBarScale",
  /** Client: auto | compact | full phase bar layout. */
  PHASE_BAR_LAYOUT: "phaseBarLayout",
  /** One-shot client migration from INTERFACE_SCALE → portrait/phase scales. */
  INTERFACE_SCALE_MIGRATED: "interfaceScaleMigratedV034",
  /** off | reminders | native — turn lifecycle automation mode */
  TURN_LIFECYCLE_AUTOMATION: "turnLifecycleAutomation",
  /** off | gm | everyone — phase start summary chat */
  PHASE_LIFECYCLE_SUMMARY: "phaseLifecycleSummary",
  /** When true, advancing an incomplete phase shows the GM guard dialog. */
  GUARD_INCOMPLETE_PHASE: "guardIncompletePhase",
  /** When true, the emergency Advance Without Processing option is available. */
  ALLOW_ADVANCE_WITHOUT_PROCESSING: "allowAdvanceWithoutProcessing",
});

export const PHASE_BAR_LAYOUTS = Object.freeze({
  AUTO: "auto",
  COMPACT: "compact",
  FULL: "full",
});

/** Minimum CSS-pixel hit target for important portrait / bar controls. */
export const MIN_CONTROL_HIT_PX = 32;

export const AUTO_ADVANCE = Object.freeze({
  OFF: "off",
  PROMPT: "prompt",
  AUTOMATIC: "automatic",
});

export const TURN_LIFECYCLE_AUTOMATION = Object.freeze({
  OFF: "off",
  REMINDERS: "reminders",
  NATIVE: "native",
});

export const PHASE_LIFECYCLE_SUMMARY = Object.freeze({
  OFF: "off",
  GM: "gm",
  EVERYONE: "everyone",
});

export const REQUESTS = Object.freeze({
  START: "start",
  PROMPT: "prompt",
  SUBMIT_ROLL: "submit-roll",
  SET_DC: "set-dc",
  SET_SKILL: "set-skill",
  SET_PHASE: "set-phase",
  CLAIM: "claim",
  END_TURN: "end-turn",
  REOPEN_TURN: "reopen-turn",
  END_REMAINING: "end-remaining",
  FORCE_ADVANCE: "force-advance",
  /** Process native end for incomplete combatants, then advance when ready. */
  PROCESS_END_REMAINING: "process-end-remaining",
  RETRY_FAILED_START: "retry-failed-start",
  SKIP_FAILED_START: "skip-failed-start",
  RETRY_FAILED_END: "retry-failed-end",
  SKIP_FAILED_END: "skip-failed-end",
  START_TURN_NOW: "start-turn-now",
  MARK_LIFECYCLE_REVIEW: "mark-lifecycle-review",
  ACK_LIFECYCLE_MIGRATION: "ack-lifecycle-migration",
  DELAY: "delay",
  MOVE_REARGUARD: "move-rearguard",
  MARK_ACTED: "mark-acted",
  UNDO: "undo",
  END_COMBAT: "end-combat",
  REGISTER_SHIELD: "register-shield",
  TIMING_ALLOW_DELAY_ONCE: "timing-allow-delay-once",
  TIMING_MOVE_REARGUARD: "timing-move-rearguard",
  TIMING_RESOLVE_PRIORITY: "timing-resolve-priority",
  TIMING_SKIP_PRIORITY: "timing-skip-priority",
  TIMING_REOPEN_CONFUSED: "timing-reopen-confused",
  TIMING_RESUME_CURRENT_ONCE: "timing-resume-current-once",
  TIMING_CLEAR_OVERRIDE: "timing-clear-override",
  TIMING_RECONCILE: "timing-reconcile",
  PLACEMENT_APPLY: "placement-apply",
  PLACEMENT_QUEUE: "placement-queue",
  PLACEMENT_CANCEL_QUEUE: "placement-cancel-queue",
  COUNTDOWN_SET: "countdown-set",
  COUNTDOWN_CLEAR: "countdown-clear",
});
