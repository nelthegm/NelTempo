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
  /** Client: overall NelTempo dock scale percent 50–100 */
  INTERFACE_SCALE: "interfaceScale",
});

export const AUTO_ADVANCE = Object.freeze({
  OFF: "off",
  PROMPT: "prompt",
  AUTOMATIC: "automatic",
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
  RETRY_FAILED_START: "retry-failed-start",
  SKIP_FAILED_START: "skip-failed-start",
  RETRY_FAILED_END: "retry-failed-end",
  SKIP_FAILED_END: "skip-failed-end",
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
