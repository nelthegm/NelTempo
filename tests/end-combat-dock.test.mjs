/**
 * NelTempo — End Combat dock teardown regressions.
 * Guards the RC2 deadlock where clearManagedRaisedShields re-entered
 * runCombatMutation from inside endDynamicCombat and left the portrait dock stuck.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const shields = read("scripts/shields.js");
const clearStart = shields.indexOf("export async function clearManagedRaisedShields");
const clearEnd = shields.indexOf("\nexport ", clearStart + 1);
const clearBody = shields.slice(clearStart, clearEnd === -1 ? undefined : clearEnd);
assert.ok(clearBody.includes("saveState"));
assert.equal(
  /runCombatMutation\s*\(/.test(clearBody),
  false,
  "clearManagedRaisedShields must not re-enter the mutation queue (End Combat deadlock)",
);

const controller = read("scripts/controller.js");
const endStart = controller.indexOf("async function endDynamicCombat");
const endEnd = controller.indexOf("/* -------------------------------------------- */", endStart);
const endBody = controller.slice(endStart, endEnd);
assert.match(endBody, /next\.enabled = false/);
assert.match(endBody, /combat\.delete\(\)/);
assert.match(endBody, /combat end timing cleanup failed/);
assert.match(endBody, /combat end shield cleanup failed/);
assert.match(endBody, /combat end source-link release failed/);

const ui = read("scripts/ui.js");
assert.match(ui, /game\.combats\?\.get\?\.\(combat\.id\)/);
assert.match(ui, /case "end-combat":[\s\S]*removeUI\(\)/);
const remove = ui.slice(ui.indexOf("export function removeUI"), ui.indexOf("export function syncNativeCombatTracker"));
assert.match(remove, /overflowMenuCloser/);

const main = read("scripts/main.js");
assert.match(main, /Hooks\.on\("deleteCombat",[\s\S]*queueMicrotask\(removeUI\)/);

console.log("NelTempo end-combat dock teardown tests passed.");
