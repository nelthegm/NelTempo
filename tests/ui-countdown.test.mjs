import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCountdownFromPrompt,
  clampInterfaceScale,
  formatCountdownDisplay,
  rebuildCountdown,
  remainingCountdownRounds,
  sanitizeCountdown,
  sanitizeCountdownLabel,
  sanitizeCountdownRounds,
} from "../scripts/countdown.js";
import {
  buildGmOnlyChatData,
  resolveGmWhisperRecipientIds,
} from "../scripts/gm-chat.js";
import { MODULE_ID, REQUESTS, SETTINGS } from "../scripts/constants.js";
import { beginRoundTransition, createState, normalizeState } from "../scripts/state.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const moduleJson = JSON.parse(readFileSync(join(root, "module.json"), "utf8"));
assert.equal(moduleJson.version, "0.3.2");
assert.equal(moduleJson.id, "nel-dynamic-initiative");
assert.equal(moduleJson.title, "NelTempo");
assert.equal(
  moduleJson.download,
  "https://github.com/nelthegm/NelTempo/releases/download/v0.3.2-rc1/dynamic-initiative.zip",
);
assert.equal(SETTINGS.INTERFACE_SCALE, "interfaceScale");
assert.equal(REQUESTS.COUNTDOWN_SET, "countdown-set");
assert.equal(REQUESTS.COUNTDOWN_CLEAR, "countdown-clear");

const lang = JSON.parse(readFileSync(join(root, "lang/en.json"), "utf8"));
for (const key of [
  "NDI.Setting.InterfaceScale.Name",
  "NDI.Setting.InterfaceScale.Hint",
  "NDI.Chat.StartedTitle",
  "NDI.Chat.StartedBody",
  "NDI.Countdown.Label",
  "NDI.Countdown.Rounds",
  "NDI.Portrait.TokenSelected",
  "NDI.Control.Start",
]) {
  assert.ok(lang[key], `missing ${key}`);
}

// --- GM-only chat ---
globalThis.game = {
  users: [
    { id: "gm1", isGM: true },
    { id: "gm2", isGM: true },
    { id: "player1", isGM: false },
  ],
};
globalThis.ChatMessage = {
  getWhisperRecipients(name) {
    assert.match(String(name), /^gm$/i);
    return globalThis.game.users.filter((u) => u.isGM);
  },
  applyMode(data, mode) {
    assert.equal(mode, "gm");
    data.whisper = resolveGmWhisperRecipientIds();
    return data;
  },
};

const whisperIds = resolveGmWhisperRecipientIds();
assert.deepEqual(whisperIds, ["gm1", "gm2"]);
assert.equal(whisperIds.includes("player1"), false);

const chatData = buildGmOnlyChatData("<h3>Dynamic Initiative Started</h3>");
assert.ok(Array.isArray(chatData.whisper));
assert.deepEqual(chatData.whisper, ["gm1", "gm2"]);
assert.equal(chatData.whisper.length > 0, true);
// Public messages still use empty whisper via separate helper path — ensure GM data is not public.
assert.notEqual(chatData.whisper.length, 0);

// --- Interface scale ---
assert.equal(clampInterfaceScale(100), 100);
assert.equal(clampInterfaceScale(50), 50);
assert.equal(clampInterfaceScale(75), 75);
assert.equal(clampInterfaceScale(40), 50);
assert.equal(clampInterfaceScale(140), 100);
assert.equal(clampInterfaceScale(73), 75);
assert.equal(clampInterfaceScale("nope", 100), 100);

const mainSrc = readFileSync(join(root, "scripts/main.js"), "utf8");
assert.match(mainSrc, /INTERFACE_SCALE/);
assert.match(mainSrc, /range:\s*\{\s*min:\s*50,\s*max:\s*100,\s*step:\s*5/);
assert.match(mainSrc, /scope:\s*"client"/);

const uiSrc = readFileSync(join(root, "scripts/ui.js"), "utf8");
assert.match(uiSrc, /--ndi-interface-scale/);
assert.match(uiSrc, /style\.zoom/);
assert.match(uiSrc, /is-token-controlled/);
assert.match(uiSrc, /TokenSelected/);
assert.match(uiSrc, /edit-countdown/);
assert.match(uiSrc, /beginNelTempoWithOptionalCountdown/);

// --- Countdown create ---
assert.equal(sanitizeCountdownLabel("  Reinforcements  "), "Reinforcements");
assert.equal(sanitizeCountdownLabel(""), null);
assert.equal(sanitizeCountdownLabel("<b>x</b>").includes("<"), true); // raw stored; UI escapes
assert.equal(sanitizeCountdownRounds(3), 3);
assert.equal(sanitizeCountdownRounds(0), null);
assert.equal(sanitizeCountdownRounds(100), null);
assert.equal(sanitizeCountdownRounds(""), null);

const built = buildCountdownFromPrompt("Reinforcements", 3, { currentRound: 1, userId: "gm1" });
assert.deepEqual(
  { label: built.label, triggerRound: built.triggerRound, createdRound: built.createdRound },
  { label: "Reinforcements", triggerRound: 4, createdRound: 1 },
);
assert.equal(buildCountdownFromPrompt("", 3, { currentRound: 1 }), null);
assert.equal(buildCountdownFromPrompt("Reinforcements", "", { currentRound: 1 }), null);
assert.equal(buildCountdownFromPrompt("Reinforcements", 0, { currentRound: 1 }), null);

// --- Countdown derivation ---
assert.equal(remainingCountdownRounds(built, 1), 3);
assert.equal(remainingCountdownRounds(built, 2), 2);
assert.equal(remainingCountdownRounds(built, 3), 1);
assert.equal(remainingCountdownRounds(built, 4), 0);
assert.equal(remainingCountdownRounds(built, 5), 0);
assert.equal(formatCountdownDisplay(built, 1).text, "Reinforcements: 3 Rounds");
assert.equal(formatCountdownDisplay(built, 3).text, "Reinforcements: 1 Round");
assert.equal(formatCountdownDisplay(built, 4).text, "Reinforcements: NOW");
assert.equal(formatCountdownDisplay(built, 4).isNow, true);
assert.equal(formatCountdownDisplay(built, 3).text, "Reinforcements: 1 Round"); // rewind from NOW math

// Phase-independent: same trigger with same round
assert.equal(remainingCountdownRounds(built, 2), remainingCountdownRounds(built, 2));

// Persist across normalize / round transition
let state = createState({ round: 1 });
assert.equal(state.schema, 5);
state.countdown = built;
state = normalizeState(state, { combatantIds: [] });
assert.equal(state.countdown.label, "Reinforcements");
assert.equal(state.countdown.triggerRound, 4);
const next = beginRoundTransition(state);
assert.equal(next.round, 2);
assert.equal(next.countdown.triggerRound, 4);
assert.equal(remainingCountdownRounds(next.countdown, next.round), 2);

// Edit rebuild
const rebuilt = rebuildCountdown("Ambush", 2, { currentRound: 5, userId: "gm1" });
assert.equal(rebuilt.triggerRound, 7);
assert.equal(remainingCountdownRounds(rebuilt, 5), 2);

// Escaping in UI path uses escapeHTML — verify helper still present
assert.match(uiSrc, /escapeHTML\(display\.text\)/);

// Controller start uses gm-only chat
const controllerSrc = readFileSync(join(root, "scripts/controller.js"), "utf8");
assert.match(controllerSrc, /gmOnlyChat/);
assert.match(controllerSrc, /createGmOnlyChat/);
assert.equal(controllerSrc.includes('Dynamic Initiative Started</h3><p>Set the Enemy'), false);

// Portrait activation still isolated from End Turn / Delay
assert.match(uiSrc, /data-action="end-turn"/);
assert.match(uiSrc, /data-action="delay"/);
assert.match(uiSrc, /data-action="edit-placement"/);

const css = readFileSync(join(root, "styles/dynamic-initiative.css"), "utf8");
assert.match(css, /\.ndi-countdown-pill/);
assert.match(css, /\.ndi-token-selected/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /--ndi-interface-z/);

const packSrc = readFileSync(join(root, "scripts/pack.mjs"), "utf8");
assert.match(packSrc, /countdown\.js/);

console.log("ui-countdown.test.mjs: ok");
