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
  DELAY: "delay",
  MOVE_REARGUARD: "move-rearguard",
  MARK_ACTED: "mark-acted",
  UNDO: "undo",
  END_COMBAT: "end-combat",
  REGISTER_SHIELD: "register-shield",
});
