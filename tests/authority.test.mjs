import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODULE_ID, REQUESTS } from "../scripts/constants.js";
import {
  dispatchGMRequestForTests,
  isGmEntryRequest,
  requestAction,
} from "../scripts/controller.js";
import { SOCKET_ENVELOPE_KEYS, socketPayload } from "../scripts/utils.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const moduleJson = JSON.parse(readFileSync(join(root, "module.json"), "utf8"));
assert.equal(moduleJson.version, "0.3.5");
assert.equal(moduleJson.id, "nel-dynamic-initiative");
assert.equal(moduleJson.title, "NelTempo");
assert.equal(
  moduleJson.download,
  "https://github.com/nelthegm/NelTempo/releases/download/v0.3.5-rc1/dynamic-initiative.zip",
);

assert.equal(isGmEntryRequest(REQUESTS.START), true);
assert.equal(isGmEntryRequest(REQUESTS.PROMPT), true);
assert.equal(isGmEntryRequest(REQUESTS.END_TURN), false);
assert.equal(isGmEntryRequest(REQUESTS.DELAY), false);
assert.equal(isGmEntryRequest(REQUESTS.COUNTDOWN_SET), false);
assert.equal(isGmEntryRequest(REQUESTS.PLACEMENT_APPLY), false);

const controllerSrc = readFileSync(join(root, "scripts/controller.js"), "utf8");
assert.match(controllerSrc, /isGmEntryRequest\(payload\.type\)/);
assert.match(controllerSrc, /requireRequestUserIsGm/);
assert.match(controllerSrc, /isGmEntryRequest\(type\) && !game\.user\?\.isGM/);

const utilsSrc = readFileSync(join(root, "scripts/utils.js"), "utf8");
assert.match(utilsSrc, /SOCKET_ENVELOPE_KEYS/);
assert.match(utilsSrc, /\.\.\.sanitized/);
assert.equal(utilsSrc.includes("userId: game.user.id, sentAt: Date.now(), ...data"), false);

const portraitSrc = readFileSync(join(root, "scripts/portrait-activation.js"), "utf8");
assert.equal(portraitSrc.includes("requestAction"), false);
assert.equal(portraitSrc.includes("SOCKET"), false);

const mainSrc = readFileSync(join(root, "scripts/main.js"), "utf8");
assert.match(mainSrc, /INTERFACE_SCALE/);
assert.match(mainSrc, /start:\s*\(\)\s*=>\s*requestAction\(REQUESTS\.START\)/);
assert.match(mainSrc, /prompt:\s*\(\)\s*=>\s*requestAction\(REQUESTS\.PROMPT\)/);

// --- Mock Foundry globals for socketPayload / requestAction / dispatch ---
const players = {
  player1: { id: "player1", isGM: false, active: true },
  assistant: { id: "assistant", isGM: true, active: true },
  gm1: { id: "gm1", isGM: true, active: true },
  inactive: { id: "inactive", isGM: false, active: false },
};

let combatUpdateCount = 0;
let chatCreateCount = 0;
let socketEmitCount = 0;
let promptOpened = false;
let saveStateCount = 0;
const notifications = [];

const combat = {
  id: "combat1",
  round: 1,
  turn: null,
  started: true,
  combatants: [],
  getFlag() {
    return null;
  },
  async update() {
    combatUpdateCount += 1;
    return this;
  },
  async updateEmbeddedDocuments() {
    combatUpdateCount += 1;
    return [];
  },
};

globalThis.game = {
  user: players.player1,
  users: {
    get(id) {
      return players[id] ?? null;
    },
    filter(fn) {
      return Object.values(players).filter(fn);
    },
    get activeGM() {
      return players.gm1;
    },
  },
  combats: {
    get(id) {
      return id === combat.id ? combat : null;
    },
  },
  combat,
  i18n: {
    localize(key) {
      return key;
    },
    format(key) {
      return key;
    },
  },
  socket: {
    emit() {
      socketEmitCount += 1;
    },
  },
  settings: {
    get() {
      return false;
    },
  },
};

globalThis.ui = {
  notifications: {
    error(message) {
      notifications.push(["error", message]);
    },
    info(message) {
      notifications.push(["info", message]);
    },
    warn(message) {
      notifications.push(["warn", message]);
    },
  },
};

globalThis.ChatMessage = {
  async create() {
    chatCreateCount += 1;
    return {};
  },
};

globalThis.foundry = {
  utils: {
    randomID() {
      return "prompt-id";
    },
  },
};

function resetCounters() {
  combatUpdateCount = 0;
  chatCreateCount = 0;
  socketEmitCount = 0;
  promptOpened = false;
  saveStateCount = 0;
  notifications.length = 0;
}

// socketPayload envelope hardening
game.user = players.gm1;
const inputData = {
  combatId: "combat1",
  userId: "forged-player",
  type: "forged-type",
  sentAt: 1,
  dc: 15,
};
const frozenCopy = structuredClone(inputData);
const payload = socketPayload(REQUESTS.SET_DC, inputData);
assert.equal(payload.userId, "gm1");
assert.equal(payload.type, REQUESTS.SET_DC);
assert.notEqual(payload.sentAt, 1);
assert.equal(payload.combatId, "combat1");
assert.equal(payload.dc, 15);
assert.deepEqual(inputData, frozenCopy);
for (const key of SOCKET_ENVELOPE_KEYS) {
  assert.ok(Object.prototype.hasOwnProperty.call(payload, key));
}

const startEnvelope = socketPayload(REQUESTS.START, { userId: "player1", countdownLabel: "X" });
assert.equal(startEnvelope.userId, "gm1");
assert.equal(startEnvelope.type, REQUESTS.START);
assert.equal(startEnvelope.countdownLabel, "X");

// Local API: non-GM start/prompt reject without socket emit
resetCounters();
game.user = players.player1;
const startDenied = await requestAction(REQUESTS.START, {});
assert.equal(startDenied.ok, false);
assert.equal(startDenied.reason, "gm-only");
assert.equal(socketEmitCount, 0);
assert.equal(combatUpdateCount, 0);
assert.equal(chatCreateCount, 0);

const promptDenied = await requestAction(REQUESTS.PROMPT, {});
assert.equal(promptDenied.ok, false);
assert.equal(promptDenied.reason, "gm-only");
assert.equal(socketEmitCount, 0);
assert.equal(combatUpdateCount, 0);
assert.equal(promptOpened, false);

// Player ownership actions still leave local path open (may emit when not primary)
resetCounters();
game.user = players.player1;
await requestAction(REQUESTS.END_TURN, { combatantId: "c1" });
assert.equal(socketEmitCount, 1);
resetCounters();
await requestAction(REQUESTS.DELAY, { combatantId: "c1" });
assert.equal(socketEmitCount, 1);

// Assistant GM (isGM) may emit START/PROMPT when not primary
resetCounters();
game.user = players.assistant;
await requestAction(REQUESTS.START, {});
assert.equal(socketEmitCount, 1);
resetCounters();
await requestAction(REQUESTS.PROMPT, {});
assert.equal(socketEmitCount, 1);

// Authoritative dispatch: forged / player identity rejected before mutation
resetCounters();
game.user = players.gm1;
await assert.rejects(
  () => dispatchGMRequestForTests({ type: REQUESTS.START, userId: "player1", combatId: combat.id }),
  (error) => String(error.message).includes("NDI.Error.GmOnly"),
);
assert.equal(combatUpdateCount, 0);
assert.equal(chatCreateCount, 0);
assert.equal(saveStateCount, 0);

await assert.rejects(
  () =>
    dispatchGMRequestForTests({
      type: REQUESTS.PROMPT,
      userId: "player1",
      combatId: combat.id,
    }),
  (error) => String(error.message).includes("NDI.Error.GmOnly"),
);
assert.equal(combatUpdateCount, 0);
assert.equal(promptOpened, false);

// Missing / inactive user fails safely
await assert.rejects(
  () => dispatchGMRequestForTests({ type: REQUESTS.START, userId: "missing-user" }),
  (error) => String(error.message).includes("NDI.Error.UserInactive"),
);
await assert.rejects(
  () => dispatchGMRequestForTests({ type: REQUESTS.START, userId: "inactive" }),
  (error) => String(error.message).includes("NDI.Error.UserInactive"),
);

// GM and assistant GM pass the GM gate (may fail later for missing active encounter)
await assert.rejects(
  () => dispatchGMRequestForTests({ type: REQUESTS.PROMPT, userId: "gm1", combatId: combat.id }),
  (error) => String(error.message).includes("NDI.Error.NotActive"),
);
await assert.rejects(
  () =>
    dispatchGMRequestForTests({
      type: REQUESTS.PROMPT,
      userId: "assistant",
      combatId: combat.id,
    }),
  (error) => String(error.message).includes("NDI.Error.NotActive"),
);

// Countdown / placement remain GM-gated in dispatch source
assert.match(controllerSrc, /COUNTDOWN_SET:[\s\S]*requestUser\.isGM/);
assert.match(controllerSrc, /PLACEMENT_APPLY/);
assert.match(controllerSrc, /NDI\.Error\.GmOnly/);

// Primary-GM mutation ownership remains in handleGMRequest
assert.match(controllerSrc, /export async function handleGMRequest[\s\S]*if \(!isPrimaryGM\(\)\) return/);

// Portrait / phase-bar scales remain client settings (local-only)
assert.match(mainSrc, /SETTINGS\.PORTRAIT_SCALE/);
assert.match(mainSrc, /SETTINGS\.PHASE_BAR_SCALE/);
assert.match(mainSrc, /scope:\s*"client"/);

console.log("authority.test.mjs: ok");
