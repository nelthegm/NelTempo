import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODULE_ID, REQUESTS } from "../scripts/constants.js";
import { createState, normalizeState } from "../scripts/state.js";
import {
  applyForceReplace,
  buildCompleteStateUpdate,
  runCombatMutation,
} from "../scripts/utils.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

// 1. module.json valid JSON
const moduleJson = JSON.parse(read("module.json"));
assert.equal(moduleJson.id, "nel-dynamic-initiative");
assert.equal(moduleJson.title, "NelTempo");
assert.equal(moduleJson.version, "0.3.5");
assert.ok(Array.isArray(moduleJson.esmodules));
assert.ok(moduleJson.esmodules.includes("scripts/main.js"));
assert.equal(
  moduleJson.download,
  "https://github.com/nelthegm/NelTempo/releases/download/v0.3.5-rc1/dynamic-initiative.zip",
);
assert.equal(moduleJson.manifest, "https://raw.githubusercontent.com/nelthegm/NelTempo/main/module.json");

// 2. Entry points exist
for (const file of [
  "scripts/main.js",
  "scripts/controller.js",
  "scripts/state.js",
  "scripts/utils.js",
  "scripts/ui.js",
  "scripts/initiative.js",
  "scripts/shields.js",
  "scripts/constants.js",
  "scripts/lifecycle.js",
  "scripts/pf2e-lifecycle-adapter.js",
  "styles/dynamic-initiative.css",
  "lang/en.json",
  "LICENSE",
  "README.md",
]) {
  assert.ok(existsSync(join(root, file)), `missing ${file}`);
}

// 3. Localization valid
const lang = JSON.parse(read("lang/en.json"));
assert.equal(typeof lang["NDI.Title"], "string");

// 4. No legacy deletion / replacement update-key generation in runtime scripts.
// Defensive startsWith("-=") filters that reject such keys are allowed.
const scriptFiles = [
  "scripts/main.js",
  "scripts/controller.js",
  "scripts/state.js",
  "scripts/utils.js",
  "scripts/ui.js",
  "scripts/initiative.js",
  "scripts/shields.js",
  "scripts/constants.js",
];
const bannedPatterns = [
  /\$\{[^}]*\}\.-=\$\{/, // `${path}.-=${key}`
  /`[^`]*\.-=\$\{/, // template path.-=${
  /["']-=\$\{/, // "-=${id}"
  /changes\s*\[\s*`\$\{[^}]*\}\.-=/, // changes[`${path}.-=
  /buildStateUpdate\s*\(\s*basePath/, // removed differential builder signature
];
for (const file of scriptFiles) {
  const source = read(file);
  for (const pattern of bannedPatterns) {
    assert.equal(pattern.test(source), false, `${file} matches banned legacy pattern ${pattern}`);
  }
}

// 5. Complete replacement only touches module namespace
const state = normalizeState(createState({ round: 2 }), { combatantIds: ["a"] });
const update = buildCompleteStateUpdate(state);
const keys = Object.keys(update);
assert.equal(keys.length, 1);
assert.equal(keys[0], `flags.${MODULE_ID}.state`);
assert.equal(keys[0].includes("pf2e"), false);
assert.equal(JSON.stringify(update).includes("-="), false);

// 6. Mutation queue is sequential
const order = [];
const p1 = runCombatMutation("c1", async () => {
  order.push("start-1");
  await new Promise((r) => setTimeout(r, 20));
  order.push("end-1");
  return 1;
});
const p2 = runCombatMutation("c1", async () => {
  order.push("start-2");
  order.push("end-2");
  return 2;
});
const results = await Promise.all([p1, p2]);
assert.deepEqual(results, [1, 2]);
assert.deepEqual(order, ["start-1", "end-1", "start-2", "end-2"]);

// 7. Re-entrant mutation does not deadlock
const reentrant = await runCombatMutation("c2", async () => {
  const inner = await runCombatMutation("c2", async () => "inner");
  return `outer:${inner}`;
});
assert.equal(reentrant, "outer:inner");

// 8. Different combats can proceed independently (queued separately)
const multi = [];
await Promise.all([
  runCombatMutation("a", async () => {
    multi.push("a-start");
    await new Promise((r) => setTimeout(r, 15));
    multi.push("a-end");
  }),
  runCombatMutation("b", async () => {
    multi.push("b-start");
    multi.push("b-end");
  }),
]);
assert.ok(multi.includes("a-start") && multi.includes("b-start"));

// 9. Socket request constants remain compatible
assert.equal(REQUESTS.SET_PHASE, "set-phase");
assert.equal(REQUESTS.UNDO, "undo");
assert.equal(REQUESTS.SUBMIT_ROLL, "submit-roll");
assert.equal(REQUESTS.START, "start");

// 10. Debug setting registration is client-scoped in source
const mainSource = read("scripts/main.js");
assert.ok(mainSource.includes("NelTempo Debug Logging"));
assert.ok(mainSource.includes('scope: "client"'));
assert.ok(mainSource.includes("default: false"));

// 11. No actor/token documents persisted into normalize output
const withGarbage = createState();
withGarbage.results.pc1 = {
  total: 10,
  skill: "perception",
  label: "Perception",
  phase: "vanguard",
  round: 1,
  at: 1,
  actor: { name: "Secret Hero", system: { hp: 99 } },
  token: { name: "Token" },
};
const clean = normalizeState(withGarbage, { combatantIds: ["pc1"] });
assert.equal(clean.results.pc1.actor, undefined);
assert.equal(clean.results.pc1.token, undefined);
assert.equal(JSON.stringify(clean).includes("Secret Hero"), false);

// 12. Failed force-replace path still omits -= keys
assert.equal(JSON.stringify(applyForceReplace(clean)).includes("-="), false);

console.log("Dynamic Initiative persistence tests passed.");
