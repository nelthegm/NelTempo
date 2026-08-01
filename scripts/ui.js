import { MODULE_ID, REQUESTS, SETTINGS } from "./constants.js";
import { requestAction } from "./controller.js";
import { rollDynamicInitiative } from "./initiative.js";
import { PHASES, combatantPhase, nextPhase, phaseForResult, resultForCurrentRound } from "./state.js";
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

function phaseLabel(phase) {
  return {
    [PHASES.INITIATIVE]: "Initiative",
    [PHASES.VANGUARD]: "Vanguard",
    [PHASES.ENEMY]: "Enemy",
    [PHASES.REARGUARD]: "Rearguard",
  }[phase] ?? phase;
}

function phaseCombatants(combat, state) {
  const combatants = [...combat.combatants].filter((combatant) => !isUnavailable(combatant));
  switch (state.phase) {
    case PHASES.INITIATIVE:
      return combatants.filter((combatant) => combatantSide(combatant) === "party");
    case PHASES.VANGUARD:
      return combatants.filter(
        (combatant) =>
          combatantSide(combatant) === "party" && combatantPhase(state, combatant.id, "party") === PHASES.VANGUARD,
      );
    case PHASES.ENEMY:
      return combatants.filter((combatant) => combatantSide(combatant) === "enemy");
    case PHASES.REARGUARD:
      return combatants.filter(
        (combatant) =>
          combatantSide(combatant) === "party" && combatantPhase(state, combatant.id, "party") === PHASES.REARGUARD,
      );
    default:
      return [];
  }
}

function canUserClaim(combatant, state) {
  if (state.acted?.[combatant.id]) return false;
  if (state.activeCombatantId && state.activeCombatantId !== combatant.id) return false;
  if (state.phase === PHASES.ENEMY) return game.user.isGM;
  return game.user.isGM || userCanOwnCombatant(game.user, combatant);
}

function statusFor(combatant, state) {
  if (isUnconscious(combatant)) return "Unconscious · Rearguard";
  if (state.phase === PHASES.INITIATIVE) {
    const result = resultForCurrentRound(state, combatant.id);
    if (!result) return "Awaiting roll";
    if (result.forced) return "Rearguard";
    return `${result.label ?? result.skill}: ${result.total} · ${phaseLabel(result.phase)}`;
  }
  if (state.activeCombatantId === combatant.id) return "Active turn";
  if (state.acted?.[combatant.id]) return "Turn complete";
  if (state.delayed?.[combatant.id]) return "Delayed to Rearguard";
  return "Ready";
}

function portraitClasses(combatant, state) {
  const classes = ["ndi-portrait"];
  if (state.activeCombatantId === combatant.id) classes.push("is-active");
  if (state.acted?.[combatant.id]) classes.push("is-acted");
  if (state.delayed?.[combatant.id]) classes.push("is-delayed");
  const resultPhase = resultForCurrentRound(state, combatant.id)?.phase;
  if (resultPhase) classes.push(`is-${resultPhase}`);
  if (isUnconscious(combatant)) classes.push("is-unconscious");
  return classes.join(" ");
}

function portraitHTML(combatant, state) {
  const result = resultForCurrentRound(state, combatant.id);
  const ownerCanRoll = game.user.isGM || userCanOwnCombatant(game.user, combatant);
  const rollButton =
    state.phase === PHASES.INITIATIVE && !result && ownerCanRoll && !isUnconscious(combatant)
      ? `<button type="button" class="ndi-mini-button" data-action="roll" data-combatant-id="${combatant.id}">
           <i class="fa-solid fa-dice-d20"></i> Roll
         </button>`
      : "";
  const delayButton =
    state.phase === PHASES.VANGUARD && !state.acted?.[combatant.id] && ownerCanRoll
      ? `<button type="button" class="ndi-icon-button" data-action="delay" data-combatant-id="${combatant.id}" title="Delay to Rearguard">
           <i class="fa-solid fa-arrow-down"></i>
         </button>`
      : "";
  const gmCorrect = game.user.isGM && state.phase !== PHASES.INITIATIVE
    ? `<button type="button" class="ndi-icon-button ndi-gm-correct" data-action="toggle-acted" data-combatant-id="${combatant.id}" title="${state.acted?.[combatant.id] ? "Restore turn" : "Mark turn complete"}">
         <i class="fa-solid ${state.acted?.[combatant.id] ? "fa-rotate-left" : "fa-check"}"></i>
       </button>`
    : "";
  const resultBadge = result && Number.isFinite(Number(result.total))
    ? `<span class="ndi-result-badge">${result.total}</span>`
    : "";

  return `<article class="${portraitClasses(combatant, state)}" data-combatant-id="${combatant.id}">
    <button type="button" class="ndi-portrait-main" data-action="claim" data-combatant-id="${combatant.id}" ${canUserClaim(combatant, state) ? "" : "disabled"}>
      <span class="ndi-image-wrap">
        <img src="${escapeHTML(portraitFor(combatant))}" alt="${escapeHTML(combatantName(combatant))}">
        ${resultBadge}
      </span>
      <span class="ndi-name">${escapeHTML(combatantName(combatant))}</span>
      <span class="ndi-status">${escapeHTML(statusFor(combatant, state))}</span>
    </button>
    <span class="ndi-card-actions">${rollButton}${delayButton}${gmCorrect}</span>
  </article>`;
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
    const result = resultForCurrentRound(state, combatant.id);
    if (isUnconscious(combatant) || result?.phase === PHASES.REARGUARD) rearguard.push(combatant);
    else if (result?.phase === PHASES.VANGUARD) vanguard.push(combatant);
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

function bottomBarHTML(combat, state) {
  const reactionNote = state.phase === PHASES.ENEMY
    ? '<span class="ndi-reaction-note"><i class="fa-solid fa-shield-halved"></i> Reactions resolve normally</span>'
    : "";
  const dc = state.phase === PHASES.INITIATIVE ? ` · Enemy DC ${state.enemyDC}` : "";
  return `<footer class="ndi-bottom-bar ndi-drag-handle" title="Drag to move; double-click to reset">
    <div class="ndi-round-phase">Round ${state.round} · ${phaseLabel(state.phase)} Phase${dc}</div>
    ${reactionNote}
    ${playerActiveControlsHTML(combat, state)}
    ${gmControlsHTML(state)}
  </footer>`;
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

function gmControlsHTML(state) {
  if (!game.user.isGM) return "";
  const initiativeControls = state.phase === PHASES.INITIATIVE
    ? `<label class="ndi-field">DC <input type="number" min="0" max="99" value="${state.enemyDC}" data-action="dc"></label>
       <label class="ndi-field">Skill
         <select data-action="suggested-skill">${skillOptionsHTML(state.suggestedSkill)}</select>
       </label>
       <button type="button" data-action="prompt"><i class="fa-solid fa-dice-d20"></i> Prompt Initiative</button>`
    : "";

  return `<div class="ndi-gm-controls">
    ${initiativeControls}
    <button type="button" data-action="apply-phase" title="Advance to ${phaseLabel(nextPhase(state.phase))}"><i class="fa-solid fa-forward-step"></i> Next Phase</button>
    <button type="button" data-action="move-active-rearguard" ${state.phase === PHASES.VANGUARD ? "" : "disabled"}><i class="fa-solid fa-arrow-down"></i> Rearguard</button>
    <button type="button" data-action="undo"><i class="fa-solid fa-rotate-left"></i> Undo</button>
    <button type="button" class="ndi-danger" data-action="end-combat"><i class="fa-solid fa-flag-checkered"></i> End</button>
  </div>`;
}

function playerActiveControlsHTML(combat, state) {
  const combatant = getCombatant(combat, state.activeCombatantId);
  if (!combatant) return "";
  const canControl = game.user.isGM || userCanOwnCombatant(game.user, combatant);
  if (!canControl) return "";
  const delay = state.phase === PHASES.VANGUARD
    ? `<button type="button" data-action="delay" data-combatant-id="${combatant.id}"><i class="fa-solid fa-arrow-down"></i> Delay to Rearguard</button>`
    : "";
  return `<div class="ndi-active-controls">
    <strong>${escapeHTML(combatantName(combatant))}</strong>
    ${delay}
    <button type="button" class="ndi-primary" data-action="end-turn" data-combatant-id="${combatant.id}"><i class="fa-solid fa-check"></i> End Turn</button>
  </div>`;
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
      window: { title: "End Dynamic Initiative" },
      content: "<p>End this combat encounter?</p>",
      yes: { default: true },
    });
  }
  return window.confirm("End this combat encounter?");
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

  root.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const combatantId = target.dataset.combatantId;

    switch (action) {
      case "claim":
        if (!target.disabled && state.phase !== PHASES.INITIATIVE) await requestAction(REQUESTS.CLAIM, { combatantId });
        break;
      case "roll":
        await openInitiativePrompt(combatantId);
        break;
      case "prompt":
        await requestAction(REQUESTS.PROMPT);
        break;
      case "apply-phase": {
        const phase = nextPhase(state.phase);
        await requestAction(REQUESTS.SET_PHASE, { phase });
        break;
      }
      case "move-active-rearguard":
        await requestAction(REQUESTS.MOVE_REARGUARD, { combatantId: state.activeCombatantId });
        break;
      case "delay":
        event.stopPropagation();
        await requestAction(REQUESTS.DELAY, { combatantId });
        break;
      case "end-turn":
        await requestAction(REQUESTS.END_TURN, { combatantId });
        break;
      case "toggle-acted":
        event.stopPropagation();
        await requestAction(REQUESTS.MARK_ACTED, { combatantId, acted: !state.acted?.[combatantId] });
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
  button.innerHTML = '<i class="fa-solid fa-bolt"></i> Dynamic Initiative';
  button.addEventListener("click", () => requestAction(REQUESTS.START));
  document.body.append(button);
}

export function renderDock() {
  document.getElementById(DOCK_ID)?.remove();
  document.getElementById(LAUNCHER_ID)?.remove();

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
  root.style.setProperty("--ndi-portrait-size", `${currentPortraitSize()}px`);
  root.style.setProperty("--ndi-max-width", `${game.settings.get(MODULE_ID, SETTINGS.MAX_WIDTH)}vw`);
  root.style.top = `${game.settings.get(MODULE_ID, SETTINGS.VERTICAL_OFFSET)}px`;
  root.innerHTML = `${portraitStageHTML(combatants, state)}${bottomBarHTML(combat, state)}`;
  document.body.append(root);
  restoreDockPosition(root);
  enableDrag(root);
  bindDockEvents(root, combat, state);
  updateOpenPromptDC(state.enemyDC);
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
