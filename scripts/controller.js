import { MODULE_ID, REQUESTS, SOCKET_NAME } from "./constants.js";
import {
  PHASES,
  beginRoundTransition,
  createState,
  delayToRearguard,
  markActed,
  normalizeUndoRestore,
  reclassifyResults,
  resultForCurrentRound,
  setPhase,
  submitResult,
  undoState,
  withHistory,
  combatantPhase,
} from "./state.js";
import { clearManagedRaisedShields, expireDueRaisedShields } from "./shields.js";
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

function publicChat(content) {
  return ChatMessage.create({ content, speaker: { alias: "Dynamic Initiative" } });
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
      notify("warn", "Select the tokens that belong in the encounter, then start Dynamic Initiative again.");
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
  if (!user?.active) throw new Error("The requesting user is not active.");
  return user;
}

async function startDynamicInitiative() {
  const combat = await ensureCombat();
  if (!combat) return;
  const existing = getState(combat);
  if (existing?.enabled) {
    notify("info", "Dynamic Initiative is already active for this encounter.");
    return;
  }

  const state = createState({
    round: Math.max(1, Number(combat.round || 1)),
    enemyDC: defaultEnemyDC(combat),
    suggestedSkill: "last-used",
  });
  await persistState(combat, state, "start");
  await mustUpdateCombat(combat, { round: state.round, turn: null });
  await resetPartyNativeInitiative(combat);
  await publicChat(
    `<h3>Dynamic Initiative Started</h3><p>Set the Enemy Initiative DC, then prompt the players to roll.</p>`,
  );
}

async function promptInitiative(combat, state) {
  if (state.phase !== PHASES.INITIATIVE) {
    notify("warn", "Initiative can only be prompted during the Initiative phase.");
    return;
  }

  const next = withHistory(state, "Prompt initiative");
  next.schema = 2;
  // Remove any legacy or prior-round results before opening a fresh prompt.
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
    throw new Error("That initiative prompt is no longer active.");
  }
  const combatant = getCombatant(combat, payload.combatantId);
  if (!combatant || combatantSide(combatant) !== "party") throw new Error("Invalid player combatant.");
  if (!userCanOwnCombatant(requestUser, combatant)) throw new Error("You do not own that combatant.");

  const next = submitResult(state, combatant.id, {
    total: payload.total,
    skill: payload.skill,
    label: payload.label,
  });
  await persistState(combat, next, "submit-roll");
  // Dynamic Initiative keeps its initiative result in module state. The native
  // tracker is hidden and does not need a mirrored initiative update; avoiding
  // that update also prevents incompatible tracker modules from rendering.
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
    notify("info", "All Dynamic Initiative checks are complete. The GM can begin Vanguard.");
    next.promptOpen = false;
    await persistState(combat, next, "prompt-complete");
  }
}

async function changeDC(combat, state, payload) {
  const value = Math.max(0, Math.min(99, Number(payload.dc)));
  if (!Number.isFinite(value)) throw new Error("Enemy Initiative DC must be a number.");
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

  let next = state;

  if (state.phase === PHASES.ENEMY && target !== PHASES.ENEMY) {
    next = await expireDueRaisedShields(combat, next);
  }

  if (target === PHASES.INITIATIVE && state.phase !== PHASES.INITIATIVE) {
    next = beginRoundTransition(next);
    await mustUpdateCombat(combat, { round: next.round, turn: null });
    await resetPartyNativeInitiative(combat);
  } else {
    next = setPhase(next, target);
    await clearNativeTurn(combat);
  }

  if (state.phase === PHASES.INITIATIVE && target !== PHASES.INITIATIVE) {
    next.initialInitiativePending = false;
    next.promptOpen = false;
  }

  const saved = await persistState(combat, next, "phase-change");
  diag("phase-change-complete", {
    combatId: shortId(combat.id),
    phase: next.phase,
    revision: saved.revision,
    combatants: combatantIdList(combat).length,
  });
  const label = target.charAt(0).toUpperCase() + target.slice(1);
  await publicChat(`<h3>Round ${next.round}: ${label} Phase</h3>`);
}

function canClaimInPhase(combatant, state) {
  if (state.phase === PHASES.ENEMY) return combatantSide(combatant) === "enemy";
  if (![PHASES.VANGUARD, PHASES.REARGUARD].includes(state.phase)) return false;
  return combatantSide(combatant) === "party" && combatantPhase(state, combatant.id, "party") === state.phase;
}

async function claimTurn(combat, state, payload, requestUser) {
  const combatant = getCombatant(combat, payload.combatantId);
  if (!combatant || isUnavailable(combatant)) throw new Error("That combatant cannot act.");
  if (!canClaimInPhase(combatant, state)) throw new Error("That combatant is not eligible in the current phase.");
  if (state.acted?.[combatant.id]) throw new Error("That combatant has already acted this round.");
  if (state.activeCombatantId && state.activeCombatantId !== combatant.id) {
    throw new Error("Another combatant is currently taking a turn.");
  }
  if (!requestUser.isGM && !userCanOwnCombatant(requestUser, combatant)) {
    throw new Error("You do not own that combatant.");
  }
  if (state.phase === PHASES.ENEMY && !requestUser.isGM) throw new Error("Only the GM can activate enemies.");

  const next = withHistory(state, `Activate ${combatantName(combatant)}`);
  next.activeCombatantId = combatant.id;
  await persistState(combat, next, "claim-turn");
  await setNativeTurn(combat, combatant.id);
}

async function endTurn(combat, state, payload, requestUser) {
  const combatantId = payload.combatantId ?? state.activeCombatantId;
  const combatant = getCombatant(combat, combatantId);
  if (!combatant) throw new Error("No active combatant.");
  if (!requestUser.isGM && !userCanOwnCombatant(requestUser, combatant)) {
    throw new Error("You do not own the active combatant.");
  }
  const next = markActed(state, combatant.id, true);
  await persistState(combat, next, "end-turn");
  await clearNativeTurn(combat);
}

async function delayCombatant(combat, state, payload, requestUser) {
  if (state.phase !== PHASES.VANGUARD) throw new Error("Only Vanguard combatants can delay to Rearguard.");
  const combatant = getCombatant(combat, payload.combatantId ?? state.activeCombatantId);
  if (!combatant || combatantSide(combatant) !== "party") throw new Error("Invalid Vanguard combatant.");
  if (!requestUser.isGM && !userCanOwnCombatant(requestUser, combatant)) {
    throw new Error("You do not own that combatant.");
  }
  const next = delayToRearguard(state, combatant.id);
  await persistState(combat, next, "delay-rearguard");
  await clearNativeTurn(combat);
}

async function markCombatantActed(combat, state, payload) {
  const combatant = getCombatant(combat, payload.combatantId);
  if (!combatant) throw new Error("Invalid combatant.");
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
    notify("info", "There is nothing to undo.");
    return;
  }

  // Normalize the restored snapshot against combatants still in the encounter.
  // Deleted combatants are not recreated; a fresh revision is assigned on save.
  const restored = normalizeUndoRestore(undone.state, combatantIdList(combat));
  const saved = await persistState(combat, restored, "undo");
  await mustUpdateCombat(combat, { round: restored.round, turn: null });
  if (restored.activeCombatantId) await setNativeTurn(combat, restored.activeCombatantId);

  diag("undo-complete", {
    combatId: shortId(combat.id),
    phase: restored.phase,
    revision: saved.revision,
    combatants: combatantIdList(combat).length,
  });
  notify("info", `Undid: ${undone.label}`);
}

async function endDynamicCombat(combat, state) {
  // The UI already asks for confirmation, so delete the encounter directly
  // instead of invoking Foundry's second confirmation dialog.  Clear any
  // module-managed shield effects first and preserve that cleaned state.
  const cleaned = await clearManagedRaisedShields(combat, state);
  const next = foundry.utils.deepClone(cleaned ?? state);
  next.enabled = false;
  try {
    await persistState(combat, next, "combat-end-cleanup");
  } catch (error) {
    // Combat may already be mid-delete; do not block encounter removal.
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

async function dispatchGMRequest(payload) {
  const requestUser = validateRequestUser(payload);
  if (payload.type === REQUESTS.START) return await startDynamicInitiative();

  const combat = game.combats.get(payload.combatId) ?? getCombat();
  const state = getState(combat);
  if (!combat || !state?.enabled) throw new Error("Dynamic Initiative is not active.");

  switch (payload.type) {
    case REQUESTS.PROMPT:
      return await promptInitiative(combat, state);
    case REQUESTS.SUBMIT_ROLL:
      return await submitInitiativeResult(combat, state, payload, requestUser);
    case REQUESTS.SET_DC:
      if (!requestUser.isGM) throw new Error("Only the GM can change the DC.");
      return await changeDC(combat, state, payload);
    case REQUESTS.SET_SKILL:
      if (!requestUser.isGM) throw new Error("Only the GM can set the suggested skill.");
      return await changeSuggestedSkill(combat, state, payload);
    case REQUESTS.SET_PHASE:
      if (!requestUser.isGM) throw new Error("Only the GM can change phases.");
      return await changePhase(combat, state, payload);
    case REQUESTS.CLAIM:
      return await claimTurn(combat, state, payload, requestUser);
    case REQUESTS.END_TURN:
      return await endTurn(combat, state, payload, requestUser);
    case REQUESTS.DELAY:
    case REQUESTS.MOVE_REARGUARD:
      return await delayCombatant(combat, state, payload, requestUser);
    case REQUESTS.MARK_ACTED:
      if (!requestUser.isGM) throw new Error("Only the GM can correct acted status.");
      return await markCombatantActed(combat, state, payload);
    case REQUESTS.UNDO:
      if (!requestUser.isGM) throw new Error("Only the GM can undo.");
      return await undo(combat, state);
    case REQUESTS.END_COMBAT:
      if (!requestUser.isGM) throw new Error("Only the GM can end combat.");
      return await endDynamicCombat(combat, state);
    default:
      throw new Error(`Unknown Dynamic Initiative request: ${payload.type}`);
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
      notify("error", error.message ?? "Dynamic Initiative request failed.");
    }
  });
}

export async function requestAction(type, data = {}) {
  const combat = getCombat();
  const payload = socketPayload(type, { combatId: combat?.id ?? null, ...data });
  if (isPrimaryGM()) return handleGMRequest(payload);
  game.socket.emit(SOCKET_NAME, payload);
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
