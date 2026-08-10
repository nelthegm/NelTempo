/** NelTempo 0.4.0 — initiative lanes, combatant controls, and recovery. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REQUESTS } from "../scripts/constants.js";
import {
  BOUNDARY_STATUS,
  LIFECYCLE_STATUS,
  buildLifecycleInspection,
  canEndTurn,
  canReopenTurn,
  canRetryEndBoundary,
  canRetryStartBoundary,
  createLifecycle,
  markCombatantEndProcessing,
  markCombatantEndResult,
  markCombatantStartResult,
  markTurnCompleteAdministrative,
  markTurnEnded,
  markTurnReview,
  markTurnSkipped,
  reopenTurn,
} from "../scripts/lifecycle.js";
import {
  PLACEMENTS,
  PLACEMENT_METHODS,
  applyCurrentRoundPlacement,
  leaveOpenRoster,
} from "../scripts/placement-editor.js";
import {
  PHASES,
  beginRoundTransition,
  createState,
  getCombatantInitiativeLane,
  normalizeState,
  submitResult,
} from "../scripts/state.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Unresolved party initiative is Awaiting/Pending; absence never means failure.
let state = createState({ round: 7, enemyDC: 20 });
assert.equal(getCombatantInitiativeLane(state, "pc1", "party"), PLACEMENTS.PENDING);
assert.equal(getCombatantInitiativeLane(state, "npc1", "enemy"), PLACEMENTS.ENEMY);

state.results.pc1 = {
  total: 30,
  skill: "perception",
  label: "Perception",
  phase: PHASES.VANGUARD,
  round: 6,
  at: 1,
};
assert.equal(getCombatantInitiativeLane(state, "pc1", "party"), PLACEMENTS.PENDING);
const reloadedPending = normalizeState(state, { combatantIds: ["pc1", "pc2", "npc1"] });
assert.equal(getCombatantInitiativeLane(reloadedPending, "pc1", "party"), PLACEMENTS.PENDING);
assert.equal(getCombatantInitiativeLane(reloadedPending, "pc2", "party"), PLACEMENTS.PENDING);

// Success/failure resolve immediately and survive normalization independently.
state = submitResult(state, "pc1", { total: 25, skill: "perception" });
const partialReload = normalizeState(state, { combatantIds: ["pc1", "pc2"] });
assert.equal(getCombatantInitiativeLane(partialReload, "pc1"), PHASES.VANGUARD);
assert.equal(getCombatantInitiativeLane(partialReload, "pc2"), PLACEMENTS.PENDING);
state = submitResult(state, "pc2", { total: 12, skill: "stealth" });
assert.equal(getCombatantInitiativeLane(state, "pc1"), PHASES.VANGUARD);
assert.equal(getCombatantInitiativeLane(state, "pc2"), PHASES.REARGUARD);
const mixedReload = normalizeState(state, { combatantIds: ["pc1", "pc2"] });
assert.equal(getCombatantInitiativeLane(mixedReload, "pc1"), PHASES.VANGUARD);
assert.equal(getCombatantInitiativeLane(mixedReload, "pc2"), PHASES.REARGUARD);

// Reset clears only the current result; a reroll consumes the Pending marker.
state = applyCurrentRoundPlacement(state, "pc1", PLACEMENTS.PENDING, {
  userId: "gm",
  method: PLACEMENT_METHODS.GM_PENDING_RESET,
});
assert.equal(state.results.pc1, undefined);
assert.equal(getCombatantInitiativeLane(state, "pc1"), PLACEMENTS.PENDING);
state = submitResult(state, "pc1", { total: 9, skill: "arcana" });
assert.equal(state.placements.pc1, undefined);
assert.equal(getCombatantInitiativeLane(state, "pc1"), PHASES.REARGUARD);

// Every round invalidates prior current-round placement/results.
const nextRound = beginRoundTransition(state);
assert.equal(nextRound.round, 8);
assert.equal(getCombatantInitiativeLane(nextRound, "pc1"), PLACEMENTS.PENDING);
assert.equal(getCombatantInitiativeLane(nextRound, "pc2"), PLACEMENTS.PENDING);

function openTurn(id = "pc") {
  const value = createState({ round: 7 });
  value.phase = PHASES.VANGUARD;
  value.lifecycle = createLifecycle({ phase: PHASES.VANGUARD, round: 7, roster: [id] });
  value.lifecycle.status = LIFECYCLE_STATUS.OPEN;
  value.lifecycle.turns[id].startStatus = BOUNDARY_STATUS.COMPLETED;
  value.lifecycle.turns[id].startClaimed = true;
  value.lifecycle.turns[id].startProcessed = true;
  return value;
}

// Administrative completion never claims native processing and is inspectable.
let lifeState = openTurn();
let administrative = markTurnCompleteAdministrative(lifeState, "pc", { userId: "gm" });
assert.equal(administrative.changed, true);
assert.equal(administrative.state.lifecycle.turns.pc.endStatus, BOUNDARY_STATUS.COMPLETED);
assert.equal(administrative.state.lifecycle.turns.pc.endClaimed, true);
assert.equal(administrative.state.lifecycle.turns.pc.endProcessed, false);
assert.equal(canEndTurn(administrative.state.lifecycle, "pc"), false);
let inspection = buildLifecycleInspection(administrative.state.lifecycle, "pc");
assert.equal(inspection.end.claimed, true);
assert.equal(inspection.end.processed, false);
assert.equal(inspection.end.completed, true);

// Administrative completion also settles an unresolved start without running it.
lifeState = openTurn();
lifeState.lifecycle.turns.pc.startStatus = BOUNDARY_STATUS.FAILED;
lifeState.lifecycle.turns.pc.startProcessed = false;
lifeState.lifecycle.turns.pc.startReason = "native-start-threw";
administrative = markTurnCompleteAdministrative(lifeState, "pc", { userId: "gm" });
assert.equal(administrative.state.lifecycle.turns.pc.startStatus, BOUNDARY_STATUS.SKIPPED);
assert.equal(administrative.state.lifecycle.turns.pc.startProcessed, false);
assert.equal(administrative.state.lifecycle.status, LIFECYCLE_STATUS.COMPLETE);

// Reopen is workflow-only; closing preserves the original settled boundary.
assert.equal(canReopenTurn(administrative.state.lifecycle, "pc"), true);
let reopened = reopenTurn(administrative.state, "pc");
assert.equal(reopened.state.lifecycle.turns.pc.reopened, true);
assert.equal(reopened.state.lifecycle.turns.pc.endStatus, BOUNDARY_STATUS.COMPLETED);
assert.equal(reopened.state.lifecycle.turns.pc.endProcessed, false);
assert.equal(canEndTurn(reopened.state.lifecycle, "pc"), true);
const reclosed = markTurnEnded(reopened.state, "pc", { userId: "gm" });
assert.equal(reclosed.state.lifecycle.turns.pc.reopened, false);
assert.equal(reclosed.state.lifecycle.turns.pc.endStatus, BOUNDARY_STATUS.COMPLETED);
assert.equal(reclosed.state.lifecycle.turns.pc.endProcessed, false);

// A genuinely processed end remains processed through reopen/close.
lifeState = openTurn();
lifeState = markCombatantEndProcessing(lifeState, "pc");
lifeState = markCombatantEndResult(lifeState, "pc", { ok: true });
lifeState = markTurnEnded(lifeState, "pc", { userId: "gm" }).state;
assert.equal(lifeState.lifecycle.turns.pc.endProcessed, true);
reopened = reopenTurn(lifeState, "pc");
assert.equal(reopened.state.lifecycle.turns.pc.endProcessed, true);
assert.equal(markTurnEnded(reopened.state, "pc", { userId: "gm" }).state.lifecycle.turns.pc.endProcessed, true);

// Skip and Review are administrative and do not process boundaries.
lifeState = openTurn();
const skipped = markTurnSkipped(lifeState, "pc", { userId: "gm" });
assert.equal(skipped.state.lifecycle.turns.pc.endStatus, BOUNDARY_STATUS.SKIPPED);
assert.equal(skipped.state.lifecycle.turns.pc.endProcessed, false);
lifeState = openTurn();
const reviewed = markTurnReview(lifeState, "pc");
assert.equal(reviewed.state.lifecycle.turns.pc.administrativeStatus, "review");
assert.equal(reviewed.state.lifecycle.turns.pc.startProcessed, true);
assert.equal(reviewed.state.lifecycle.turns.pc.endProcessed, false);

// Retry is offered only for pre-invocation adapter failures, never throws/interruption.
lifeState = openTurn();
lifeState.lifecycle.turns.pc.startStatus = BOUNDARY_STATUS.PENDING;
lifeState = markCombatantStartResult(lifeState, "pc", { ok: false, reason: "missing-actor" });
assert.equal(canRetryStartBoundary(lifeState.lifecycle, "pc"), true);
lifeState.lifecycle.turns.pc.startReason = "native-start-threw";
assert.equal(canRetryStartBoundary(lifeState.lifecycle, "pc"), false);
lifeState = openTurn();
lifeState = markCombatantEndResult(lifeState, "pc", { ok: false, reason: "no-native-end-method" });
assert.equal(canRetryEndBoundary(lifeState.lifecycle, "pc"), true);
lifeState.lifecycle.turns.pc.endReason = "native-end-threw";
assert.equal(canRetryEndBoundary(lifeState.lifecycle, "pc"), false);
lifeState.lifecycle.turns.pc.endStatus = BOUNDARY_STATUS.INTERRUPTED;
assert.equal(canRetryEndBoundary(lifeState.lifecycle, "pc"), false);

// Placement correction does not silently process or skip a lifecycle boundary.
lifeState = openTurn();
const left = leaveOpenRoster(lifeState, "pc", { userId: "gm" });
assert.equal(left.changed, true);
assert.equal(left.state.lifecycle.roster.includes("pc"), false);
assert.equal(left.state.lifecycle.turns.pc, undefined);
assert.equal(left.state.acted.pc, undefined);

for (const request of [
  REQUESTS.START_TURN_NOW,
  REQUESTS.RETRY_COMBATANT_START,
  REQUESTS.RETRY_COMBATANT_END,
  REQUESTS.MARK_TURN_COMPLETE,
  REQUESTS.MARK_TURN_SKIPPED,
  REQUESTS.MARK_LIFECYCLE_REVIEW,
]) assert.ok(request);

const uiSource = readFileSync(join(root, "scripts/ui.js"), "utf8");
assert.match(uiSource, /openCombatantControls/);
assert.match(uiSource, /openLifecycleInspector/);
assert.match(uiSource, /ReopenWarning/);
assert.match(uiSource, /contextmenu/);
const controllerSource = readFileSync(join(root, "scripts/controller.js"), "utf8");
assert.match(controllerSource, /retryableStartCandidates/);
assert.match(controllerSource, /retryableEndCandidates/);

console.log("NelTempo 0.4.0 combatant controls and recovery tests passed.");
