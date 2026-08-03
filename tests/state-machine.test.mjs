import assert from "node:assert/strict";
import {
  PHASES,
  beginRoundTransition,
  countPrunedCombatantEntries,
  createState,
  delayToRearguard,
  nextPhase,
  normalizeState,
  normalizeUndoRestore,
  phaseForResult,
  reclassifyResults,
  resultForCurrentRound,
  setPhase,
  submitResult,
  undoState,
  withHistory,
} from "../scripts/state.js";
import { MODULE_ID } from "../scripts/constants.js";
import { applyForceReplace, buildCompleteStateUpdate } from "../scripts/utils.js";

// --- Core phase machine ---
assert.equal(phaseForResult(30, 30), PHASES.VANGUARD);
assert.equal(phaseForResult(29, 30), PHASES.REARGUARD);
assert.equal(nextPhase(PHASES.INITIATIVE), PHASES.VANGUARD);
assert.equal(nextPhase(PHASES.VANGUARD), PHASES.ENEMY);
assert.equal(nextPhase(PHASES.ENEMY), PHASES.REARGUARD);
assert.equal(nextPhase(PHASES.REARGUARD), PHASES.INITIATIVE);

let state = createState({ round: 1, enemyDC: 30 });
assert.equal(state.revision, 0);
assert.equal(state.schema, 5);

state = submitResult(state, "pc1", { total: 31, skill: "perception" });
state = submitResult(state, "pc2", { total: 29, skill: "stealth" });
assert.equal(state.results.pc1.phase, PHASES.VANGUARD);
assert.equal(state.results.pc2.phase, PHASES.REARGUARD);
assert.equal(state.results.pc1.round, 1);
assert.equal(resultForCurrentRound(state, "pc1")?.total, 31);

state.enemyDC = 32;
state = reclassifyResults(state);
assert.equal(state.results.pc1.phase, PHASES.REARGUARD);

state = delayToRearguard(state, "pc1");
assert.equal(state.delayed.pc1, true);

const transition = beginRoundTransition(state);
assert.equal(transition.round, 2);
assert.equal(transition.phase, PHASES.INITIATIVE);
assert.deepEqual(transition.results, {});

const undone = undoState(transition);
assert.ok(undone);
assert.equal(undone.state.round, 1);

// --- Normalization: prune stale combatants, preserve valid ---
const dirty = createState({ round: 3, enemyDC: 15 });
dirty.phase = PHASES.VANGUARD;
dirty.results = {
  keep: { total: 20, skill: "perception", label: "Perception", phase: PHASES.VANGUARD, round: 3, at: 1 },
  gone: { total: 5, skill: "stealth", label: "Stealth", phase: PHASES.REARGUARD, round: 3, at: 1 },
};
dirty.acted = { keep: true, gone: true };
dirty.delayed = { gone: true };
dirty.lastSkills = { keep: "perception", gone: "stealth" };
dirty.activeCombatantId = "gone";
dirty.shields = {
  "Item.keep": { itemUuid: "Item.keep", combatantId: "keep", expireEnemySerial: 1 },
  "Item.gone": { itemUuid: "Item.gone", combatantId: "gone", expireEnemySerial: 1 },
};
const beforeNormalize = structuredClone(dirty);
const normalized = normalizeState(dirty, { combatantIds: ["keep"] });
assert.deepEqual(dirty, beforeNormalize, "normalizeState must not mutate input");
assert.ok(normalized.results.keep);
assert.equal(normalized.results.gone, undefined);
assert.equal(normalized.acted.gone, undefined);
assert.equal(normalized.delayed.gone, undefined);
assert.equal(normalized.lastSkills.gone, undefined);
assert.equal(normalized.activeCombatantId, null);
assert.ok(normalized.shields["Item.keep"]);
assert.equal(normalized.shields["Item.gone"], undefined);
assert.equal(normalized.phase, PHASES.VANGUARD);
assert.equal(normalized.round, 3);
assert.equal(normalized.results.keep.total, 20);
assert.equal(normalized.results.keep.phase, PHASES.VANGUARD);
assert.equal(normalized.lastSkills.keep, "perception");

const pruned = countPrunedCombatantEntries(dirty, normalized);
assert.ok(pruned >= 4);

// No undefined values in normalized tree
assert.doesNotThrow(() => JSON.stringify(normalized));
const asJson = JSON.parse(JSON.stringify(normalized));
assert.deepEqual(asJson, normalized);

// Does not invent results for new combatants
const withNewcomer = normalizeState(dirty, { combatantIds: ["keep", "newPc"] });
assert.equal(withNewcomer.results.newPc, undefined);
assert.ok(withNewcomer.results.keep);

// --- Undo restore prunes deleted combatants ---
const histBase = createState({ round: 1, enemyDC: 10 });
let hist = submitResult(histBase, "pc1", { total: 20, skill: "perception" });
hist = submitResult(hist, "pc2", { total: 5, skill: "stealth" });
hist = setPhase(hist, PHASES.VANGUARD);
const undoEntry = undoState(hist);
assert.ok(undoEntry);
const restored = normalizeUndoRestore(undoEntry.state, ["pc1"]);
assert.ok(restored.results.pc1);
assert.equal(restored.results.pc2, undefined);

// --- Complete state replacement (no legacy -=) ---
const update = buildCompleteStateUpdate(normalized);
const path = `flags.${MODULE_ID}.state`;
assert.ok(Object.hasOwn(update, path));
assert.equal(Object.keys(update).length, 1);
const serialized = JSON.stringify(update);
assert.equal(serialized.includes("-="), false);
for (const key of Object.keys(update)) {
  assert.equal(key.includes("-="), false);
  assert.equal(key.startsWith("flags.nel-dynamic-initiative."), true);
  assert.equal(key.includes("flags.pf2e"), false);
}

// applyForceReplace uses global _replace when present
const originalReplace = globalThis._replace;
globalThis._replace = (value) => ({ __replaced: value });
try {
  const wrapped = applyForceReplace({ a: 1 });
  assert.deepEqual(wrapped, { __replaced: { a: 1 } });
  const withReplace = buildCompleteStateUpdate({ phase: "enemy" });
  assert.deepEqual(withReplace[path], { __replaced: { phase: "enemy" } });
} finally {
  if (originalReplace === undefined) delete globalThis._replace;
  else globalThis._replace = originalReplace;
}

// Identity fallback without Foundry operators
const plain = applyForceReplace({ b: 2 });
assert.deepEqual(plain, { b: 2 });

// --- Revision field preserved through normalize, not invented incorrectly ---
const revState = createState();
revState.revision = 7;
const revNorm = normalizeState(revState, { combatantIds: [] });
assert.equal(revNorm.revision, 7);

// --- History snapshots normalize ---
let hist2 = withHistory(createState(), "step");
hist2.results = { old: { total: 1, skill: "perception", phase: PHASES.VANGUARD, round: 1, at: 1 } };
hist2 = withHistory(hist2, "step2");
const histNorm = normalizeState(hist2, { combatantIds: [] });
assert.equal(histNorm.history.length > 0, true);
for (const entry of histNorm.history) {
  assert.equal(entry.state.results.old, undefined);
}

// --- Phase order unchanged ---
assert.deepEqual(
  [PHASES.INITIATIVE, PHASES.VANGUARD, PHASES.ENEMY, PHASES.REARGUARD].map(nextPhase),
  [PHASES.VANGUARD, PHASES.ENEMY, PHASES.REARGUARD, PHASES.INITIATIVE],
);

// --- Module id preserved ---
assert.equal(MODULE_ID, "nel-dynamic-initiative");

// Non-serializable nested junk is dropped without throwing
const withFn = createState();
withFn.results.pc1 = {
  total: 12,
  skill: "perception",
  label: "Perception",
  phase: PHASES.VANGUARD,
  round: 1,
  at: 1,
};
const cleanedFn = normalizeState(withFn, { combatantIds: ["pc1"] });
assert.equal(cleanedFn.results.pc1.total, 12);
assert.doesNotThrow(() => JSON.stringify(cleanedFn));

console.log("Dynamic Initiative state-machine tests passed.");
