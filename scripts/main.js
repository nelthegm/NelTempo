import { AUTO_ADVANCE, MODULE_ID, MODULE_TITLE, PHASE_BAR_LAYOUTS, REQUESTS, SETTINGS, SOCKET_NAME } from "./constants.js";
import {
  reconcileLifecycleOnReady,
  reconcileTimingFromConditionHook,
  requestAction,
  socketHandler,
} from "./controller.js";
import { isTrackedConditionItem } from "./pf2e-condition-adapter.js";
import { migrateLegacyInterfaceScale, isTextEntryTarget } from "./presentation.js";
import { registerRaisedShield } from "./shields.js";
import {
  handleInitiativePrompt,
  removeUI,
  renderDock,
  beginNelTempoWithOptionalCountdown,
  syncNativeCombatTracker,
  endCurrentTurnFromKeybinding,
} from "./ui.js";
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
    name: "NDI.Setting.ManageRaisedShield.Name",
    hint: "NDI.Setting.ManageRaisedShield.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    restricted: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.TURN_LIFECYCLE_AUTOMATION, {
    name: "NDI.Setting.TurnLifecycleAutomation.Name",
    hint: "NDI.Setting.TurnLifecycleAutomation.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      off: "NDI.Setting.TurnLifecycleAutomation.Off",
      reminders: "NDI.Setting.TurnLifecycleAutomation.Reminders",
      native: "NDI.Setting.TurnLifecycleAutomation.Native",
    },
    default: "native",
    restricted: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.PHASE_LIFECYCLE_SUMMARY, {
    name: "NDI.Setting.PhaseLifecycleSummary.Name",
    hint: "NDI.Setting.PhaseLifecycleSummary.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      off: "NDI.Setting.PhaseLifecycleSummary.Off",
      gm: "NDI.Setting.PhaseLifecycleSummary.GM",
      everyone: "NDI.Setting.PhaseLifecycleSummary.Everyone",
    },
    default: "gm",
  });

  game.settings.register(MODULE_ID, SETTINGS.GUARD_INCOMPLETE_PHASE, {
    name: "NDI.Setting.GuardIncompletePhase.Name",
    hint: "NDI.Setting.GuardIncompletePhase.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    restricted: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.ALLOW_ADVANCE_WITHOUT_PROCESSING, {
    name: "NDI.Setting.AllowAdvanceWithoutProcessing.Name",
    hint: "NDI.Setting.AllowAdvanceWithoutProcessing.Hint",
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

  // Legacy dock zoom — retained for migration/rollback; hidden from the settings UI.
  game.settings.register(MODULE_ID, SETTINGS.INTERFACE_SCALE, {
    name: "NDI.Setting.InterfaceScale.Name",
    hint: "NDI.Setting.InterfaceScale.Hint",
    scope: "client",
    config: false,
    type: Number,
    default: 100,
    range: { min: 50, max: 100, step: 5 },
  });

  game.settings.register(MODULE_ID, SETTINGS.INTERFACE_SCALE_MIGRATED, {
    name: "Interface Scale Migrated",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, SETTINGS.PORTRAIT_SCALE, {
    name: "NDI.Setting.PortraitScale.Name",
    hint: "NDI.Setting.PortraitScale.Hint",
    scope: "client",
    config: true,
    type: Number,
    default: 100,
    range: { min: 50, max: 100, step: 5 },
    onChange: renderDock,
  });

  game.settings.register(MODULE_ID, SETTINGS.PHASE_BAR_SCALE, {
    name: "NDI.Setting.PhaseBarScale.Name",
    hint: "NDI.Setting.PhaseBarScale.Hint",
    scope: "client",
    config: true,
    type: Number,
    default: 100,
    range: { min: 60, max: 100, step: 10 },
    onChange: renderDock,
  });

  game.settings.register(MODULE_ID, SETTINGS.PHASE_BAR_LAYOUT, {
    name: "NDI.Setting.PhaseBarLayout.Name",
    hint: "NDI.Setting.PhaseBarLayout.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      [PHASE_BAR_LAYOUTS.AUTO]: "NDI.Setting.PhaseBarLayout.Auto",
      [PHASE_BAR_LAYOUTS.COMPACT]: "NDI.Setting.PhaseBarLayout.Compact",
      [PHASE_BAR_LAYOUTS.FULL]: "NDI.Setting.PhaseBarLayout.Full",
    },
    default: PHASE_BAR_LAYOUTS.AUTO,
    onChange: renderDock,
  });
}

function registerKeybindings() {
  game.keybindings.register(MODULE_ID, "endCurrentTurn", {
    name: "NDI.Keybinding.EndCurrentTurn.Name",
    hint: "NDI.Keybinding.EndCurrentTurn.Hint",
    editable: [],
    onDown: () => {
      void handleEndCurrentTurnKeybinding();
      return true;
    },
  });
}

async function handleEndCurrentTurnKeybinding() {
  try {
    const active = document.activeElement;
    if (isTextEntryTarget(active)) return;
    await endCurrentTurnFromKeybinding();
  } catch (error) {
    console.error(`${MODULE_ID} | End Turn keybinding failed`, error?.message ?? error);
  }
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
  registerKeybindings();
  console.info(`${MODULE_TITLE} | Initializing`);
});

Hooks.once("ready", () => {
  if (game.system.id !== "pf2e") {
    ui.notifications.error("NelTempo requires the Pathfinder Second Edition system.");
    return;
  }

  void migrateLegacyInterfaceScale().then((result) => {
    if (result?.migrated) debug("Interface scale migrated", { legacy: result.legacy });
  });

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
