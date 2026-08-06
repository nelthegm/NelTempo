/**
 * NelTempo 0.3.5 phase turn lifecycle — focused pure-state coverage.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MODULE_ID,
  PHASE_LIFECYCLE_SUMMARY,
  REQUESTS,
  SETTINGS,
  TURN_LIFECYCLE_AUTOMATION,
} from "../scripts/constants.js";
import {
  BOUNDARY_STATUS,
  LIFECYCLE_STATUS,
  beginStartBoundary,
  buildRosterIds,
  canEndTurn,
  canReopenTurn,
  combatantLifecycleUiStatus,
  completeStartBoundary,
  createLifecycle,
  endCandidates,
  isLifecyclePhase,
  markCombatantEndResult,
  markCombatantStartResult,
  markTurnEnded,
  phaseAdvanceReady,
  skipPendingEnds,
  skipRemainingTurns,
  startCandidates,
} from "../scripts/lifecycle.js";
import {
  buildLifecycleHookPayload,
  LIFECYCLE_HOOKS,
} from "../scripts/lifecycle-hooks.js";
import { isParryEffect, isRaisedShieldEffect } from "../scripts/shields.js";
import { PHASES, createState, normalizeState } from "../scripts/state.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const moduleJson = JSON.parse(readFileSync(join(root, "module.json"), "utf8"));
assert.equal(moduleJson.version, "0.3.5");
assert.equal(moduleJson.id, MODULE_ID);

// Settings keys
assert.equal(SETTINGS.TURN_LIFECYCLE_AUTOMATION, "turnLifecycleAutomation");
assert.equal(SETTINGS.PHASE_LIFECYCLE_SUMMARY, "phaseLifecycleSummary");
assert.equal(SETTINGS.GUARD_INCOMPLETE_PHASE, "guardIncompletePhase");
assert.equal(SETTINGS.ALLOW_ADVANCE_WITHOUT_PROCESSING, "allowAdvanceWithoutProcessing");
assert.equal(TURN_LIFECYCLE_AUTOMATION.NATIVE, "native");
assert.equal(PHASE_LIFECYCLE_SUMMARY.GM, "gm");
assert.equal(REQUESTS.PROCESS_END_REMAINING, "process-end-remaining");

// Initiative has no start effects
assert.equal(isLifecyclePhase(PHASES.INITIATIVE), false);

// Phase roster: every combatant in phase is a start candidate once
const descriptors = [
  { id: "v1", side: "party", phase: PHASES.VANGUARD, initiativeTotal: 20 },
  { id: "v2", side: "party", phase: PHASES.VANGUARD, initiativeTotal: 10 },
  { id: "e1", side: "enemy", phase: PHASES.ENEMY, initiativeTotal: null },
  { id: "e2", side: "enemy", phase: PHASES.ENEMY, initiativeTotal: null },
  { id: "r1", side: "party", phase: PHASES.REARGUARD, initiativeTotal: 5 },
];
assert.deepEqual(buildRosterIds(descriptors, PHASES.VANGUARD), ["v1", "v2"]);
assert.deepEqual(buildRosterIds(descriptors, PHASES.ENEMY), ["e1", "e2"]);
assert.deepEqual(buildRosterIds(descriptors, PHASES.REARGUARD), ["r1"]);

function openPhase(roster) {
  let state = createState({ round: 1 });
  state.phase = PHASES.VANGUARD;
  state.lifecycle = createLifecycle({ phase: PHASES.VANGUARD, round: 1, roster });
  state = beginStartBoundary(state);
  for (const id of roster) state = markCombatantStartResult(state, id, { ok: true });
  state = completeStartBoundary(state);
  return state;
}

// Same combatant processed once — startCandidates empty after complete
let state = openPhase(["a", "b"]);
assert.deepEqual(startCandidates(state.lifecycle), []);
assert.equal(canEndTurn(state.lifecycle, "a"), true);
assert.equal(combatantLifecycleUiStatus(state.lifecycle, "a"), "ready");

// End Turn composed path settles end once
state = markCombatantEndResult(state, "a", { ok: true });
state = markTurnEnded(state, "a", { userId: "u1" }).state;
assert.equal(state.lifecycle.turns.a.endStatus, BOUNDARY_STATUS.COMPLETED);
assert.equal(canEndTurn(state.lifecycle, "a"), false);
assert.equal(canReopenTurn(state.lifecycle, "a"), false);
assert.equal(combatantLifecycleUiStatus(state.lifecycle, "a"), "ended");
assert.equal(phaseAdvanceReady(state.lifecycle), false);

// Duplicate end result cannot downgrade
const dup = markCombatantEndResult(state, "a", { ok: false, reason: "retry" });
assert.equal(dup.lifecycle.turns.a.endStatus, BOUNDARY_STATUS.COMPLETED);

// Incomplete phase guard readiness
assert.deepEqual(endCandidates(state.lifecycle), ["b"]);
state = markCombatantEndResult(state, "b", { ok: true });
state = markTurnEnded(state, "b", { userId: "u1" }).state;
assert.equal(phaseAdvanceReady(state.lifecycle), true);

// Advance without processing skips end boundaries
let skipState = openPhase(["x", "y"]);
skipState = markCombatantEndResult(skipState, "x", { ok: true });
skipState = markTurnEnded(skipState, "x", { userId: "gm" }).state;
const skipped = skipRemainingTurns(skipState, { userId: "gm" });
assert.equal(skipped.state.lifecycle.turns.y.skipped, true);
assert.equal(skipped.state.lifecycle.turns.y.endStatus, BOUNDARY_STATUS.SKIPPED);
const pending = skipPendingEnds(skipped.state);
assert.equal(pending.state.lifecycle.turns.x.endStatus, BOUNDARY_STATUS.COMPLETED);

// Failed start → review UI; sibling can still be ready
let failState = createState();
failState.lifecycle = createLifecycle({ phase: PHASES.VANGUARD, round: 1, roster: ["ok", "bad"] });
failState = beginStartBoundary(failState);
failState = markCombatantStartResult(failState, "ok", { ok: true });
failState = markCombatantStartResult(failState, "bad", { ok: false, reason: "native-start-threw" });
failState = completeStartBoundary(failState, { error: false });
assert.equal(combatantLifecycleUiStatus(failState.lifecycle, "ok"), "ready");
assert.equal(combatantLifecycleUiStatus(failState.lifecycle, "bad"), "review");
assert.equal(canEndTurn(failState.lifecycle, "bad"), false);
assert.equal(canEndTurn(failState.lifecycle, "ok"), true);

// Migration: schema bump + notice without retroactive processing
let legacy = createState({ round: 2 });
legacy.schema = 5;
legacy.enabled = true;
legacy.phase = PHASES.VANGUARD;
legacy.lifecycle = createLifecycle({ phase: PHASES.VANGUARD, round: 2, roster: ["pc1"] });
legacy.lifecycle.status = LIFECYCLE_STATUS.OPEN;
legacy.lifecycle.turns.pc1.startStatus = BOUNDARY_STATUS.COMPLETED;
legacy.lifecycle.turns.pc1.ended = true;
legacy.lifecycle.turns.pc1.endStatus = BOUNDARY_STATUS.PENDING;
const migrated = normalizeState(legacy, { combatantIds: ["pc1"] });
assert.equal(migrated.schema, 6);
assert.equal(migrated.lifecycleMigrationNotice, true);
assert.equal(migrated.lifecycle.turns.pc1.startStatus, BOUNDARY_STATUS.COMPLETED);
assert.equal(migrated.lifecycle.turns.pc1.endStatus, BOUNDARY_STATUS.PENDING);
assert.equal(migrated.round, 2);
assert.equal(migrated.phase, PHASES.VANGUARD);

// Defense detection (slug-based)
assert.equal(isRaisedShieldEffect({ type: "effect", slug: "raise-a-shield" }), true);
assert.equal(isParryEffect({ type: "effect", slug: "parry" }), true);
assert.equal(isParryEffect({ type: "effect", slug: "comparative-study" }), false);

// Public hooks sanitized (no HP / event ids)
const payload = buildLifecycleHookPayload({
  combat: { id: "combat1" },
  state: { round: 3, phase: PHASES.VANGUARD },
  combatantId: "c1",
  boundary: "start",
  lifecycleState: "complete",
});
assert.equal(payload.combatId, "combat1");
assert.equal(payload.round, 3);
assert.equal(payload.phase, PHASES.VANGUARD);
assert.equal(payload.combatantId, "c1");
assert.equal(payload.boundary, "start");
assert.equal("hp" in payload, false);
assert.equal("eventId" in payload, false);
assert.ok(LIFECYCLE_HOOKS.COMBATANT_TURN_ENDED.startsWith("neltempo."));

// Localization keys
const lang = JSON.parse(readFileSync(join(root, "lang/en.json"), "utf8"));
assert.ok(lang["NDI.Setting.TurnLifecycleAutomation.Name"]);
assert.ok(lang["NDI.Lifecycle.CannotAdvanceTitle"]);
assert.ok(lang["NDI.Lifecycle.ProcessAndEndRemaining"]);
assert.ok(lang["NDI.Lifecycle.AdvanceWithoutProcessing"]);

// Forbidden patterns
const controllerSrc = readFileSync(join(root, "scripts/controller.js"), "utf8");
const adapterSrc = readFileSync(join(root, "scripts/pf2e-lifecycle-adapter.js"), "utf8");
assert.equal(/flat.?check|applyDamage|hp\.value\s*[+\-]=/i.test(adapterSrc), false);
assert.equal(adapterSrc.includes("saveState"), false);
assert.ok(controllerSrc.includes("processIndividualEndTurn"));
assert.ok(controllerSrc.includes("finalizePhaseLeave"));
assert.ok(!controllerSrc.includes("End Turn only marks finished"));

console.log("NelTempo 0.3.5 turn-lifecycle tests passed.");
