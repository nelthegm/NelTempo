export const MODULE_ID = "nel-dynamic-initiative";
export const MODULE_TITLE = "Dynamic Initiative";
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
});
