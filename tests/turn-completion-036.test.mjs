/**
 * NelTempo 0.3.6 — unified turn completion and phase advancement regressions.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODULE_ID, REQUESTS, SETTINGS } from "../scripts/constants.js";
import {
  BOUNDARY_STATUS,
  LIFECYCLE_STATUS,
  beginStartBoundary,
  canEndTurn,
  completeStartBoundary,
  createLifecycle,
  endCandidates,
  getCombatantLifecycleStatus,
  isTurnEndedComplete,
  lifecycleProgress,
  markCombatantEndResult,
  markCombatantStartResult,
  markTurnEnded,
  markTurnSkipped,
  phaseAdvanceReady,
  skipPendingEnds,
  skipRemainingTurns,
} from "../scripts/lifecycle.js";
import { PHASES, createState } from "../scripts/state.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const moduleJson = JSON.parse(readFileSync(join(root, "module.json"), "utf8"));
assert.equal(moduleJson.version, "0.3.6");
assert.equal(moduleJson.id, MODULE_ID);
assert.equal(
  moduleJson.download,
  "https://github.com/nelthegm/NelTempo/releases/download/v0.3.6-rc1/dynamic-initiative.zip",
);
assert.equal(SETTINGS.GUARD_INCOMPLETE_PHASE, "guardIncompletePhase");

function openPhase(roster) {
  let state = createState({ round: 1 });
  state.phase = PHASES.VANGUARD;
  state.lifecycle = createLifecycle({ phase: PHASES.VANGUARD, round: 1, roster });
  state = beginStartBoundary(state);
  for (const id of roster) state = markCombatantStartResult(state, id, { ok: true });
  state = completeStartBoundary(state);
  return state;
}

function completeTurn(state, id) {
  let next = markCombatantEndResult(state, id, { ok: true });
  next = markTurnEnded(next, id, { userId: "u1" }).state;
  return next;
}

// 1–4: Portrait/End Turn path must complete lifecycle end (not legacy-only)
let state = openPhase(["a", "b"]);
assert.equal(canEndTurn(state.lifecycle, "a"), true);
state = completeTurn(state, "a");
assert.equal(isTurnEndedComplete(state.lifecycle, "a"), true);
assert.equal(getCombatantLifecycleStatus(state.lifecycle, "a").turnComplete, true);
assert.equal(getCombatantLifecycleStatus(state.lifecycle, "a").resolvedForAdvancement, true);
assert.equal(state.lifecycle.turns.a.endStatus, BOUNDARY_STATUS.COMPLETED);

// Legacy mark-ended alone is NOT ordinary complete / does not advance
let legacy = openPhase(["x", "y"]);
legacy = markTurnEnded(legacy, "x", { userId: "gm" }).state;
assert.equal(legacy.lifecycle.turns.x.ended, true);
assert.equal(legacy.lifecycle.turns.x.endStatus, BOUNDARY_STATUS.PENDING);
assert.equal(isTurnEndedComplete(legacy.lifecycle, "x"), false);
assert.equal(getCombatantLifecycleStatus(legacy.lifecycle, "x").needsReview, true);
assert.equal(getCombatantLifecycleStatus(legacy.lifecycle, "x").legacyEndedPending, true);
assert.equal(phaseAdvanceReady(legacy.lifecycle), false);

// 5–8: Header and guard use the same selector
state = openPhase(["a", "b"]);
let prog = lifecycleProgress(state.lifecycle);
assert.equal(prog.ended, 0);
assert.equal(prog.total, 2);
assert.equal(prog.complete, false);
assert.equal(phaseAdvanceReady(state.lifecycle), false);

state = completeTurn(state, "a");
prog = lifecycleProgress(state.lifecycle);
assert.equal(prog.ended, 1);
assert.equal(prog.total, 2);
assert.deepEqual(prog.remaining, ["b"]);
assert.equal(phaseAdvanceReady(state.lifecycle), false);

state = completeTurn(state, "b");
prog = lifecycleProgress(state.lifecycle);
assert.equal(prog.ended, 2);
assert.equal(prog.complete, true);
assert.equal(phaseAdvanceReady(state.lifecycle), true);
assert.deepEqual(endCandidates(state.lifecycle), []);

// 9–10: Skipped counts for advancement; Review does not
let skipState = openPhase(["a", "b"]);
skipState = completeTurn(skipState, "a");
skipState = markTurnSkipped(skipState, "b", { userId: "gm" }).state;
assert.equal(phaseAdvanceReady(skipState.lifecycle), true);
assert.equal(lifecycleProgress(skipState.lifecycle).ended, 2);

let reviewState = openPhase(["a", "b"]);
reviewState = completeTurn(reviewState, "a");
reviewState = markCombatantEndResult(reviewState, "b", { ok: false, reason: "native-end-threw" });
prog = lifecycleProgress(reviewState.lifecycle);
assert.equal(prog.ended, 1);
assert.equal(prog.review, 1);
assert.equal(phaseAdvanceReady(reviewState.lifecycle), false);
assert.equal(getCombatantLifecycleStatus(reviewState.lifecycle, "b").needsReview, true);

// 11–12: Complete advances; incomplete not ready
assert.equal(phaseAdvanceReady(state.lifecycle), true);
assert.equal(phaseAdvanceReady(openPhase(["p1", "p2"]).lifecycle), false);

// 16–20: Force / guard-off skip path marks pending Skipped without completing native end
let force = openPhase(["a", "b"]);
force = completeTurn(force, "a");
const forced = skipRemainingTurns(force, { userId: "gm", reason: "guard-disabled-advance" });
assert.equal(forced.state.lifecycle.turns.a.endStatus, BOUNDARY_STATUS.COMPLETED);
assert.equal(forced.state.lifecycle.turns.b.endStatus, BOUNDARY_STATUS.SKIPPED);
assert.equal(forced.state.lifecycle.turns.b.skipped, true);
assert.equal(phaseAdvanceReady(forced.state.lifecycle), true);

// Review does not block when skipPendingEnds runs (guard disabled / force)
const reviewed = skipPendingEnds(reviewState, { reason: "guard-disabled-advance" });
assert.equal(reviewed.state.lifecycle.turns.a.endStatus, BOUNDARY_STATUS.COMPLETED);
assert.equal(reviewed.state.lifecycle.turns.b.endStatus, BOUNDARY_STATUS.SKIPPED);
assert.equal(phaseAdvanceReady(reviewed.state.lifecycle), true);

// Setting key + requests used by advance path
assert.equal(REQUESTS.FORCE_ADVANCE, "force-advance");
assert.equal(REQUESTS.PROCESS_END_REMAINING, "process-end-remaining");
assert.equal(REQUESTS.SET_PHASE, "set-phase");

// Controller must read guard === true and must not keep warn-only unfinished branch
const controllerSrc = readFileSync(join(root, "scripts/controller.js"), "utf8");
assert.ok(controllerSrc.includes("shouldGuardIncompletePhase"));
assert.ok(controllerSrc.includes('SETTINGS.GUARD_INCOMPLETE_PHASE) === true'));
assert.ok(controllerSrc.includes("guard-disabled-advance"));
assert.ok(controllerSrc.includes("CannotAdvanceUseDialog"));
assert.equal(controllerSrc.includes("UnfinishedTurns"), false);

const uiSrc = readFileSync(join(root, "scripts/ui.js"), "utf8");
assert.ok(uiSrc.includes("shouldGuardIncompletePhase"));
assert.ok(uiSrc.includes("incompletePhaseGuardDialog"));
assert.ok(uiSrc.includes("DialogFallbackForce"));
assert.ok(!uiSrc.includes('ndi-gm-correct" data-action="toggle-acted"'));
assert.ok(uiSrc.includes('ndi-gm-correct" data-action="${finished ? "reopen-turn" : "end-turn"}"') || uiSrc.includes("end-turn"));

const lang = JSON.parse(readFileSync(join(root, "lang/en.json"), "utf8"));
assert.ok(lang["NDI.Lifecycle.CannotAdvanceUseDialog"]);
assert.ok(lang["NDI.Lifecycle.ReviewProgress"]);

console.log("NelTempo 0.3.6 turn-completion tests passed.");
