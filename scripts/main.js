import { AUTO_ADVANCE, MODULE_ID, MODULE_TITLE, REQUESTS, SETTINGS, SOCKET_NAME } from "./constants.js";
import {
  reconcileLifecycleOnReady,
  reconcileTimingFromConditionHook,
  requestAction,
  socketHandler,
} from "./controller.js";
import { isTrackedConditionItem } from "./pf2e-condition-adapter.js";
import { registerRaisedShield } from "./shields.js";
import { handleInitiativePrompt, removeUI, renderDock, beginNelTempoWithOptionalCountdown, syncNativeCombatTracker } from "./ui.js";
import { debug, getCombat, getState } from "./utils.js";

function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.PORTRAIT_SIZE, {
    name: "Portrait Size",
    hint: "Height of combatant portraits in the NelTempo dock.",
    scope: "client",
    config: true,
    type: Number,
    default: 72,
    range: { min: 48, max: 112, step: 4 },
    onChange: renderDock,
  });

  game.settings.register(MODULE_ID, SETTINGS.VERTICAL_OFFSET, {
    name: "Top Offset",
    hint: "Default distance in pixels between the top of the window and the portrait dock. Dragging the dock overrides this locally.",
    scope: "client",
    config: true,
    type: Number,
    default: 8,
    range: { min: 0, max: 240, step: 2 },
    onChange: renderDock,
  });

  game.settings.register(MODULE_ID, SETTINGS.MAX_WIDTH, {
    name: "Maximum Dock Width",
    hint: "Maximum percentage of the browser width used by the portrait dock.",
    scope: "client",
    config: true,
    type: Number,
    default: 62,
    range: { min: 35, max: 95, step: 1 },
    onChange: renderDock,
  });

  game.settings.register(MODULE_ID, SETTINGS.AUTO_OPEN_PROMPTS, {
    name: "Automatically Open Initiative Prompts",
    hint: "Open the NelTempo skill prompt automatically when the GM requests checks.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.MANAGE_RAISED_SHIELD, {
    name: "Minimum Opposition for Raise a Shield",
    hint: "Keep Raise a Shield active until the end of the next Enemy phase, then remove it.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    restricted: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.AUTO_ADVANCE_PHASE, {
    name: "NDI.Setting.AutoAdvancePhase.Name",
    hint: "NDI.Setting.AutoAdvancePhase.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      [AUTO_ADVANCE.OFF]: "NDI.Setting.AutoAdvancePhase.Off",
      [AUTO_ADVANCE.PROMPT]: "NDI.Setting.AutoAdvancePhase.Prompt",
      [AUTO_ADVANCE.AUTOMATIC]: "NDI.Setting.AutoAdvancePhase.Automatic",
    },
    default: AUTO_ADVANCE.OFF,
    restricted: true,
  });

  // Default true; Foundry resolves missing world values to the registered default
  // without writing a migration for existing worlds.
  game.settings.register(MODULE_ID, SETTINGS.ENFORCE_CONDITION_TIMING, {
    name: "NDI.Setting.EnforceConditionTiming.Name",
    hint: "NDI.Setting.EnforceConditionTiming.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    restricted: true,
    onChange: renderDock,
  });

  game.settings.register(MODULE_ID, SETTINGS.DEBUG, {
    name: "NelTempo Debug Logging",
    hint: "Write concise NelTempo state diagnostics to the browser console (combat id, phase, revision, counts). No actor or token names.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, SETTINGS.PAN_CAMERA_ON_PORTRAIT, {
    name: "NDI.Setting.PanCameraOnPortrait.Name",
    hint: "NDI.Setting.PanCameraOnPortrait.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.INTERFACE_SCALE, {
    name: "NDI.Setting.InterfaceScale.Name",
    hint: "NDI.Setting.InterfaceScale.Hint",
    scope: "client",
    config: true,
    type: Number,
    default: 100,
    range: { min: 50, max: 100, step: 5 },
    onChange: renderDock,
  });
}

function addTrackerLauncher(_app, html) {
  const combat = getCombat();
  if (getState(combat)?.enabled) {
    syncNativeCombatTracker(true);
    return;
  }
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".ndi-tracker-launch")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ndi-tracker-launch";
  button.innerHTML = `<i class="fa-solid fa-bolt"></i> Start ${MODULE_TITLE}`;
  button.addEventListener("click", () => void beginNelTempoWithOptionalCountdown());
  root.prepend(button);
}

function queueConditionTimingReconcile(item) {
  if (!isTrackedConditionItem(item)) return;
  queueMicrotask(() => {
    void reconcileTimingFromConditionHook(item);
    renderDock();
  });
}

Hooks.once("init", () => {
  registerSettings();
  console.info(`${MODULE_TITLE} | Initializing`);
});

Hooks.once("ready", () => {
  if (game.system.id !== "pf2e") {
    ui.notifications.error("NelTempo requires the Pathfinder Second Edition system.");
    return;
  }

  game.socket.on(SOCKET_NAME, socketHandler);
  Hooks.on(`${MODULE_ID}.showPrompt`, handleInitiativePrompt);

  game.dynamicInitiative = Object.freeze({
    start: () => requestAction(REQUESTS.START),
    prompt: () => requestAction(REQUESTS.PROMPT),
    phase: (phase) => requestAction(REQUESTS.SET_PHASE, { phase }),
    undo: () => requestAction(REQUESTS.UNDO),
    end: () => requestAction(REQUESTS.END_COMBAT),
    render: renderDock,
  });

  void reconcileLifecycleOnReady();
  renderDock();
  debug("Ready", { core: game.version, pf2e: game.system.version });
});

for (const hook of [
  "canvasReady",
  "controlToken",
  "createCombat",
  "updateCombat",
  "createCombatant",
  "updateCombatant",
  "deleteCombatant",
  "updateUser",
]) {
  Hooks.on(hook, () => queueMicrotask(renderDock));
}

Hooks.on("deleteCombat", () => removeUI());
Hooks.on("renderCombatTracker", addTrackerLauncher);
Hooks.on("createItem", (item) => {
  void registerRaisedShield(item);
  queueConditionTimingReconcile(item);
});
Hooks.on("updateItem", (item, changes, options) => {
  if (!options?.[`${MODULE_ID}.shieldManagement`]) void registerRaisedShield(item);
  queueConditionTimingReconcile(item);
  queueMicrotask(renderDock);
});
Hooks.on("deleteItem", (item) => {
  queueConditionTimingReconcile(item);
  queueMicrotask(renderDock);
});
