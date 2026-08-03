import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { MODULE_ID, SETTINGS } from "../scripts/constants.js";
import {
  ACTIVATION_REASON,
  activateCombatantPortrait,
  isSoleControlledToken,
  resolveCombatantTokenIdentity,
  userCanControlToken,
} from "../scripts/portrait-activation.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- Baseline / tag / version ---
const moduleJson = JSON.parse(readFileSync(join(root, "module.json"), "utf8"));
assert.equal(moduleJson.version, "0.3.3");
assert.equal(moduleJson.id, "nel-dynamic-initiative");
assert.equal(moduleJson.title, "NelTempo");
assert.equal(MODULE_ID, "nel-dynamic-initiative");
assert.equal(SETTINGS.PAN_CAMERA_ON_PORTRAIT, "panCameraOnPortraitActivation");

const tagTarget = execFileSync("git", ["rev-list", "-n", "1", "v0.3.0"], {
  cwd: root,
  encoding: "utf8",
}).trim();
assert.equal(tagTarget, "ee509150753834415e0db75ccc893a32296f22e0");

const lang = JSON.parse(readFileSync(join(root, "lang/en.json"), "utf8"));
for (const key of [
  "NDI.Portrait.ActivateToken",
  "NDI.Portrait.OffScene",
  "NDI.Portrait.NoPermission",
  "NDI.Portrait.TokenMissing",
  "NDI.Portrait.CanvasNotReady",
  "NDI.Setting.PanCameraOnPortrait.Name",
  "NDI.Setting.PanCameraOnPortrait.Hint",
]) {
  assert.ok(lang[key], `missing ${key}`);
}

const mainSrc = readFileSync(join(root, "scripts/main.js"), "utf8");
assert.match(mainSrc, /PAN_CAMERA_ON_PORTRAIT/);
assert.match(mainSrc, /scope:\s*"client"/);
assert.match(mainSrc, /default:\s*true/);
assert.equal(mainSrc.includes("migrate"), false);

const constantsSrc = readFileSync(join(root, "scripts/constants.js"), "utf8");
assert.match(constantsSrc, /nel-dynamic-initiative/);
assert.match(constantsSrc, /panCameraOnPortraitActivation/);

const uiSrc = readFileSync(join(root, "scripts/ui.js"), "utf8");
assert.match(uiSrc, /activate-portrait/);
assert.match(uiSrc, /activateCombatantPortrait/);
assert.match(uiSrc, /NDI\.Portrait\.ActivateToken/);
// Interactive controls keep their own actions
assert.match(uiSrc, /data-action="end-turn"/);
assert.match(uiSrc, /data-action="delay"/);
assert.match(uiSrc, /data-action="edit-placement"/);
assert.equal(/data-action="claim"/g.test(uiSrc.replace(/case "claim"/g, "")), false);

const activationSrc = readFileSync(join(root, "scripts/portrait-activation.js"), "utf8");
assert.equal(activationSrc.includes("requestAction"), false);
assert.equal(activationSrc.includes("SOCKET"), false);
assert.equal(activationSrc.includes("persistState"), false);
assert.equal(activationSrc.includes("withHistory"), false);
assert.equal(activationSrc.includes("combat.update"), false);
assert.equal(/actor\.name|token\.name|Actor\.name/i.test(activationSrc), false);
assert.match(activationSrc, /tokenId/);
assert.match(activationSrc, /sceneId/);
assert.match(activationSrc, /releaseOthers:\s*true/);

const packSrc = readFileSync(join(root, "scripts/pack.mjs"), "utf8");
assert.match(packSrc, /portrait-activation\.js/);
assert.match(packSrc, /SLICE_0_3_1_PORTRAIT_ACTIVATION/);

// --- Exact identity resolution ---
const combatantA = {
  id: "cbtA",
  tokenId: "tokA",
  sceneId: "scn1",
  token: { id: "tokA", parent: { id: "scn1" } },
};
const combatantB = {
  id: "cbtB",
  tokenId: "tokB",
  sceneId: "scn1",
  token: { id: "tokB", parent: { id: "scn1" }, actorId: "sameActor" },
};
const idA = resolveCombatantTokenIdentity(combatantA);
const idB = resolveCombatantTokenIdentity(combatantB);
assert.equal(idA.tokenId, "tokA");
assert.equal(idA.sceneId, "scn1");
assert.equal(idB.tokenId, "tokB");
assert.notEqual(idA.tokenId, idB.tokenId);

assert.equal(resolveCombatantTokenIdentity(null), null);
assert.equal(resolveCombatantTokenIdentity({ id: "x" }), null);

// --- Mock canvas / token activation ---
function makeToken({ id, controlled = false, canControl = true, panFail = false }) {
  const token = {
    id,
    controlled,
    destroyed: false,
    center: { x: 100 + id.length, y: 200 },
    x: 0,
    y: 0,
    isOwner: canControl,
    can(user, action) {
      return action === "control" && canControl;
    },
    control(opts = {}) {
      if (!canControl) return false;
      if (opts.releaseOthers) {
        for (const t of globalThis.canvas.tokens.controlled.slice()) {
          if (t !== token) t.controlled = false;
        }
        globalThis.canvas.tokens.controlled = [token];
      } else if (!globalThis.canvas.tokens.controlled.includes(token)) {
        globalThis.canvas.tokens.controlled.push(token);
      }
      token.controlled = true;
      return true;
    },
    async panCanvas() {
      if (panFail) throw new Error("pan-boom");
      globalThis.__panCalls = (globalThis.__panCalls ?? 0) + 1;
    },
  };
  return token;
}

function installCanvas({ sceneId = "scn1", tokens = [] } = {}) {
  globalThis.__panCalls = 0;
  const map = new Map(tokens.map((t) => [t.id, t]));
  globalThis.canvas = {
    ready: true,
    scene: { id: sceneId },
    stage: { scale: { x: 1 } },
    tokens: {
      controlled: tokens.filter((t) => t.controlled),
      get: (id) => map.get(id) ?? null,
      placeables: tokens,
    },
  };
  globalThis.game = {
    user: { id: "u1", isGM: false },
    settings: {
      get(_mod, key) {
        if (key === SETTINGS.PAN_CAMERA_ON_PORTRAIT) return globalThis.__panSetting !== false;
        if (key === SETTINGS.DEBUG) return false;
        return undefined;
      },
    },
    i18n: { localize: (k) => k, format: (k) => k },
  };
  globalThis.ui = { notifications: { warn() {} } };
}

function makeCombat(combatants) {
  const list = combatants;
  return {
    id: "combat1",
    combatants: {
      get(id) {
        return list.find((c) => c.id === id) ?? null;
      },
      [Symbol.iterator]: function* () {
        yield* list;
      },
    },
  };
}

// No controlled → controls clicked
{
  const tokA = makeToken({ id: "tokA" });
  const tokOther = makeToken({ id: "tokOther", controlled: true });
  installCanvas({ tokens: [tokA, tokOther] });
  globalThis.canvas.tokens.controlled = [tokOther];
  const combat = makeCombat([
    { id: "cbtA", tokenId: "tokA", sceneId: "scn1", token: { id: "tokA", parent: { id: "scn1" } } },
  ]);
  const result = await activateCombatantPortrait(combat, "cbtA", { pan: true, notify: false });
  assert.equal(result.ok, true);
  assert.equal(result.tokenControlled, true);
  assert.equal(result.cameraPanned, true);
  assert.equal(tokA.controlled, true);
  assert.equal(tokOther.controlled, false);
  assert.deepEqual(globalThis.canvas.tokens.controlled.map((t) => t.id), ["tokA"]);
  assert.equal(globalThis.__panCalls, 1);
}

// Multiple controlled → only clicked remains
{
  const tokA = makeToken({ id: "tokA" });
  const tokB = makeToken({ id: "tokB", controlled: true });
  const tokC = makeToken({ id: "tokC", controlled: true });
  installCanvas({ tokens: [tokA, tokB, tokC] });
  globalThis.canvas.tokens.controlled = [tokB, tokC];
  const combat = makeCombat([
    { id: "cbtA", tokenId: "tokA", sceneId: "scn1", token: { id: "tokA", parent: { id: "scn1" } } },
  ]);
  const result = await activateCombatantPortrait(combat, "cbtA", { pan: false, notify: false });
  assert.equal(result.ok, true);
  assert.equal(result.cameraPanned, false);
  assert.equal(tokA.controlled, true);
  assert.equal(tokB.controlled, false);
  assert.equal(tokC.controlled, false);
}

// Already sole controlled → remains, still pans, no toggle off
{
  const tokA = makeToken({ id: "tokA", controlled: true });
  installCanvas({ tokens: [tokA] });
  globalThis.canvas.tokens.controlled = [tokA];
  assert.equal(isSoleControlledToken(tokA), true);
  const combat = makeCombat([
    { id: "cbtA", tokenId: "tokA", sceneId: "scn1", token: { id: "tokA", parent: { id: "scn1" } } },
  ]);
  const result = await activateCombatantPortrait(combat, "cbtA", { pan: true, notify: false });
  assert.equal(result.ok, true);
  assert.equal(tokA.controlled, true);
  assert.equal(result.cameraPanned, true);
  assert.equal(globalThis.__panCalls, 1);
}

// Permission denied preserves prior control
{
  const tokA = makeToken({ id: "tokA", canControl: false });
  const tokPrior = makeToken({ id: "tokPrior", controlled: true });
  installCanvas({ tokens: [tokA, tokPrior] });
  globalThis.canvas.tokens.controlled = [tokPrior];
  const combat = makeCombat([
    { id: "cbtA", tokenId: "tokA", sceneId: "scn1", token: { id: "tokA", parent: { id: "scn1" } } },
  ]);
  const result = await activateCombatantPortrait(combat, "cbtA", { pan: true, notify: false });
  assert.equal(result.ok, false);
  assert.equal(result.reason, ACTIVATION_REASON.PERMISSION);
  assert.equal(tokPrior.controlled, true);
  assert.equal(globalThis.__panCalls, 0);
  assert.equal(userCanControlToken(tokA), false);
}

// Off-scene does not release prior control or switch scene
{
  const tokA = makeToken({ id: "tokA" });
  const tokPrior = makeToken({ id: "tokPrior", controlled: true });
  installCanvas({ sceneId: "scnActive", tokens: [tokA, tokPrior] });
  globalThis.canvas.tokens.controlled = [tokPrior];
  const combat = makeCombat([
    { id: "cbtA", tokenId: "tokA", sceneId: "scnOther", token: { id: "tokA", parent: { id: "scnOther" } } },
  ]);
  const result = await activateCombatantPortrait(combat, "cbtA", { pan: true, notify: false });
  assert.equal(result.ok, false);
  assert.equal(result.reason, ACTIVATION_REASON.OFF_SCENE);
  assert.equal(result.sceneMatched, false);
  assert.equal(tokPrior.controlled, true);
  assert.equal(globalThis.canvas.scene.id, "scnActive");
  assert.equal(globalThis.__panCalls, 0);
}

// Missing token
{
  installCanvas({ tokens: [] });
  const combat = makeCombat([
    { id: "cbtA", tokenId: "gone", sceneId: "scn1", token: { id: "gone", parent: { id: "scn1" } } },
  ]);
  const result = await activateCombatantPortrait(combat, "cbtA", { notify: false });
  assert.equal(result.ok, false);
  assert.equal(result.reason, ACTIVATION_REASON.MISSING_TOKEN);
}

// Canvas unready
{
  installCanvas({ tokens: [] });
  globalThis.canvas.ready = false;
  const combat = makeCombat([
    { id: "cbtA", tokenId: "tokA", sceneId: "scn1", token: { id: "tokA", parent: { id: "scn1" } } },
  ]);
  const result = await activateCombatantPortrait(combat, "cbtA", { notify: false });
  assert.equal(result.reason, ACTIVATION_REASON.CANVAS_UNREADY);
}

// Pan failure keeps control
{
  const tokA = makeToken({ id: "tokA", panFail: true });
  installCanvas({ tokens: [tokA] });
  const combat = makeCombat([
    { id: "cbtA", tokenId: "tokA", sceneId: "scn1", token: { id: "tokA", parent: { id: "scn1" } } },
  ]);
  const result = await activateCombatantPortrait(combat, "cbtA", { pan: true, notify: false });
  assert.equal(result.ok, true);
  assert.equal(result.tokenControlled, true);
  assert.equal(result.cameraPanned, false);
  assert.equal(tokA.controlled, true);
}

// Pan disabled
{
  const tokA = makeToken({ id: "tokA" });
  installCanvas({ tokens: [tokA] });
  globalThis.__panSetting = false;
  const combat = makeCombat([
    { id: "cbtA", tokenId: "tokA", sceneId: "scn1", token: { id: "tokA", parent: { id: "scn1" } } },
  ]);
  const result = await activateCombatantPortrait(combat, "cbtA", { notify: false });
  assert.equal(result.ok, true);
  assert.equal(result.cameraPanned, false);
  assert.equal(globalThis.__panCalls, 0);
  globalThis.__panSetting = true;
}

// Deleted combatant
{
  installCanvas({ tokens: [] });
  const combat = makeCombat([]);
  const result = await activateCombatantPortrait(combat, "missing", { notify: false });
  assert.equal(result.reason, ACTIVATION_REASON.MISSING_COMBATANT);
}

console.log("portrait-activation.test.mjs: ok");
