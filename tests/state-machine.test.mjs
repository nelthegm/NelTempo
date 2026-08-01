import assert from "node:assert/strict";
import {
  PHASES,
  beginRoundTransition,
  createState,
  delayToRearguard,
  nextPhase,
  phaseForResult,
  reclassifyResults,
  resultForCurrentRound,
  submitResult,
  undoState,
} from "../scripts/state.js";
import { buildStateUpdate } from "../scripts/utils.js";

assert.equal(phaseForResult(30, 30), PHASES.VANGUARD);
assert.equal(phaseForResult(29, 30), PHASES.REARGUARD);
assert.equal(nextPhase(PHASES.INITIATIVE), PHASES.VANGUARD);
assert.equal(nextPhase(PHASES.VANGUARD), PHASES.ENEMY);
assert.equal(nextPhase(PHASES.ENEMY), PHASES.REARGUARD);
assert.equal(nextPhase(PHASES.REARGUARD), PHASES.INITIATIVE);

let state = createState({ round: 1, enemyDC: 30 });
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
console.log("Dynamic Initiative state-machine tests passed.");

const oldStored = {
  round: 1,
  results: { pc1: { total: 31 }, pc2: { total: 29 } },
  acted: { pc1: true },
};
const newStored = { round: 2, results: {}, acted: {} };
const patch = buildStateUpdate("flags.test.state", oldStored, newStored);
assert.equal(patch["flags.test.state.round"], 2);
assert.equal(patch["flags.test.state.results.-=pc1"], null);
assert.equal(patch["flags.test.state.results.-=pc2"], null);
assert.equal(patch["flags.test.state.acted.-=pc1"], null);

const legacyRoundTwo = { ...newStored, results: { pc1: { total: 31 } } };
assert.equal(resultForCurrentRound(legacyRoundTwo, "pc1"), null);
