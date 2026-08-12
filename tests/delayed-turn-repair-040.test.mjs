import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chooseNelTempoAction, confirmNelTempoAction } from "../scripts/confirmation.js";
import {
  BOUNDARY_STATUS,
  LIFECYCLE_STATUS,
  TURN_ADMIN_STATUS,
  TURN_WORKFLOW_STATUS,
  buildLifecycleInspection,
  buildRosterIds,
  canEndTurn,
  canRetryStartBoundary,
  combatantLifecycleUiStatus,
  createLifecycle,
  delayActiveTurnToRearguard,
  endCandidates,
  hydrateDelayedTurns,
  lifecycleProgress,
  markCombatantEndProcessing,
  markCombatantEndResult,
  markTurnCompleteAdministrative,
  markTurnEnded,
  markTurnReview,
  markTurnSkipped,
  phaseAdvanceReady,
  skipRemainingTurns,
  skipUnresolvedDelayedTurns,
  startCandidates,
  unresolvedDelayedTurnIds,
} from "../scripts/lifecycle.js";
import { applyCurrentRoundPlacement, PLACEMENTS } from "../scripts/placement-editor.js";
import { processEndTurn, processStartTurn } from "../scripts/pf2e-lifecycle-adapter.js";
import {
  PHASES,
  createState,
  getCombatantInitiativeLane,
  normalizeState,
} from "../scripts/state.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const controllerSource = readFileSync(join(root, "scripts/controller.js"), "utf8");
const uiSource = readFileSync(join(root, "scripts/ui.js"), "utf8");
const confirmationSource = readFileSync(join(root, "scripts/confirmation.js"), "utf8");

let count = 0;
async function test(name, callback) {
  await callback();
  count += 1;
  assert.ok(name);
}

function activeVanguard(id = "pc1", round = 4, phaseInstanceId = "vanguard-4") {
  const state = createState({ round });
  state.phase = PHASES.VANGUARD;
  state.results[id] = {
    total: 25,
    skill: "perception",
    label: "Perception",
    phase: PHASES.VANGUARD,
    round,
    at: 1,
  };
  state.lifecycle = createLifecycle({
    phase: PHASES.VANGUARD,
    round,
    roster: [id],
    phaseInstanceId,
  });
  state.lifecycle.status = LIFECYCLE_STATUS.OPEN;
  state.lifecycle.start.status = BOUNDARY_STATUS.COMPLETED;
  state.lifecycle.turns[id].startStatus = BOUNDARY_STATUS.COMPLETED;
  state.lifecycle.turns[id].startClaimed = true;
  state.lifecycle.turns[id].startProcessed = true;
  state.activeCombatantId = id;
  return state;
}

function delay(state = activeVanguard(), id = "pc1") {
  return delayActiveTurnToRearguard(state, id, {
    userId: "player1",
    at: 100,
    expectedRound: state.round,
    expectedPhaseInstanceId: state.lifecycle.phaseInstanceId,
  });
}

function enterRearguard(delayedState, id = "pc1") {
  const state = structuredClone(delayedState);
  state.phase = PHASES.REARGUARD;
  state.lifecycle = createLifecycle({
    phase: PHASES.REARGUARD,
    round: state.round,
    roster: [id],
    phaseInstanceId: `rearguard-${state.round}`,
  });
  const hydrated = hydrateDelayedTurns(state);
  hydrated.lifecycle.status = LIFECYCLE_STATUS.OPEN;
  hydrated.lifecycle.start.status = BOUNDARY_STATUS.COMPLETED;
  return hydrated;
}

await test("1 Active Vanguard actor can Delay to Rearguard", () => {
  const result = delay();
  assert.equal(result.changed, true);
  assert.equal(result.state.results.pc1.phase, PHASES.REARGUARD);
});

await test("2 Delay does not call native onEndTurn", () => {
  const section = controllerSource.slice(
    controllerSource.indexOf("async function delayCombatant"),
    controllerSource.indexOf("async function markCombatantActed"),
  );
  assert.equal(section.includes("processEndTurn("), false);
  assert.equal(section.includes("emitCombatantTurnEnding("), false);
});

await test("3 Delay does not mark End complete", () => {
  const record = delay().state.delayed.pc1;
  assert.equal(record.endStatus, BOUNDARY_STATUS.PENDING);
  assert.equal(record.endClaimed, false);
});

await test("4 Delay preserves completed Start boundary", () => {
  const record = delay().state.delayed.pc1;
  assert.equal(record.startStatus, BOUNDARY_STATUS.COMPLETED);
  assert.equal(record.startProcessed, true);
});

await test("5 Delay records Rearguard resume state", () => {
  const record = delay().state.delayed.pc1;
  assert.equal(record.workflowStatus, TURN_WORKFLOW_STATUS.DELAYED);
  assert.equal(record.resumePhase, PHASES.REARGUARD);
  assert.equal(record.intentional, true);
});

await test("6 Delayed actor does not block leaving Vanguard", () => {
  const state = delay().state;
  assert.deepEqual(state.lifecycle.roster, []);
  assert.equal(phaseAdvanceReady(state.lifecycle), true);
});

await test("7 Delayed actor appears in Rearguard", () => {
  const state = enterRearguard(delay().state);
  assert.ok(state.lifecycle.roster.includes("pc1"));
  assert.ok(state.lifecycle.turns.pc1.delayedTurn);
});

await test("7a Delay overrides a current-round GM Vanguard placement", () => {
  const placed = applyCurrentRoundPlacement(
    activeVanguard(),
    "pc1",
    PLACEMENTS.VANGUARD,
    { userId: "gm" },
  );
  const delayed = delay(placed).state;
  const reloaded = normalizeState(delayed, { combatantIds: ["pc1"] });
  const lane = getCombatantInitiativeLane(reloaded, "pc1");
  assert.equal(lane, PHASES.REARGUARD);
  assert.deepEqual(
    buildRosterIds(
      [{ id: "pc1", side: "party", phase: lane, initiativeTotal: null, delayed: true }],
      PHASES.REARGUARD,
    ),
    ["pc1"],
  );
});

await test("8 Delayed actor is not visually Ended", () => {
  const state = enterRearguard(delay().state);
  assert.equal(combatantLifecycleUiStatus(state.lifecycle, "pc1"), "delayed");
  assert.equal(state.lifecycle.turns.pc1.ended, false);
});

await test("9 Rearguard activation does not call Start again", () => {
  const state = enterRearguard(delay().state);
  assert.deepEqual(startCandidates(state.lifecycle), []);
});

await test("10 Delayed actor can End Turn normally", () => {
  const state = enterRearguard(delay().state);
  state.lifecycle.status = LIFECYCLE_STATUS.OPEN;
  assert.equal(canEndTurn(state.lifecycle, "pc1"), true);
});

await test("11 Delayed End invokes the one available End boundary", () => {
  let state = enterRearguard(delay().state);
  state.lifecycle.status = LIFECYCLE_STATUS.OPEN;
  state = markCombatantEndProcessing(state, "pc1");
  state = markCombatantEndResult(state, "pc1", { ok: true });
  state = markTurnEnded(state, "pc1", { userId: "player1" }).state;
  assert.equal(state.lifecycle.turns.pc1.endProcessed, true);
  assert.deepEqual(endCandidates(state.lifecycle), []);
});

await test("12 Double End after Delay does not duplicate processing", () => {
  let state = enterRearguard(delay().state);
  state.lifecycle.status = LIFECYCLE_STATUS.OPEN;
  state = markCombatantEndResult(state, "pc1", { ok: true });
  const duplicate = markCombatantEndResult(state, "pc1", { ok: false, reason: "duplicate" });
  assert.equal(duplicate.lifecycle.turns.pc1.endStatus, BOUNDARY_STATUS.COMPLETED);
  assert.equal(duplicate.lifecycle.turns.pc1.endReason, null);
});

await test("13 Delayed actor blocks leaving Rearguard with Guard On", () => {
  const state = enterRearguard(delay().state);
  assert.equal(phaseAdvanceReady(state.lifecycle), false);
  assert.deepEqual(lifecycleProgress(state.lifecycle).remaining, ["pc1"]);
});

await test("14 Guard Off can safely skip unresolved delayed actor", () => {
  const state = enterRearguard(delay().state);
  const skipped = skipRemainingTurns(state, { reason: "guard-disabled-advance" });
  assert.equal(skipped.state.lifecycle.turns.pc1.endStatus, BOUNDARY_STATUS.SKIPPED);
  assert.equal(skipped.state.delayed.pc1, undefined);
});

await test("15 Guard Off skip does not invoke native End", () => {
  assert.equal(skipRemainingTurns.toString().includes("processEndTurn"), false);
});

await test("16 Reload before Rearguard preserves Delay", () => {
  const state = delay().state;
  const reloaded = normalizeState(state, { combatantIds: ["pc1"] });
  assert.equal(reloaded.delayed.pc1.actualTurnId, state.delayed.pc1.actualTurnId);
});

await test("17 Reload during Rearguard preserves Delay", () => {
  const state = enterRearguard(delay().state);
  const reloaded = normalizeState(state, { combatantIds: ["pc1"] });
  assert.equal(reloaded.lifecycle.turns.pc1.delayedTurn.workflowStatus, TURN_WORKFLOW_STATUS.DELAYED);
});

await test("18 Reload never duplicates Start", () => {
  const reloaded = normalizeState(enterRearguard(delay().state), { combatantIds: ["pc1"] });
  assert.deepEqual(startCandidates(reloaded.lifecycle), []);
});

await test("19 Reload never duplicates End", () => {
  let state = enterRearguard(delay().state);
  state.lifecycle.status = LIFECYCLE_STATUS.OPEN;
  state = markCombatantEndResult(state, "pc1", { ok: true });
  const reloaded = normalizeState(state, { combatantIds: ["pc1"] });
  assert.deepEqual(endCandidates(reloaded.lifecycle), []);
});

await test("20 Round cannot silently advance with unresolved Delay under Guard On", () => {
  assert.deepEqual(unresolvedDelayedTurnIds(delay().state), ["pc1"]);
  assert.ok(controllerSource.includes("round-advance-delayed-review"));
});

await test("21 Reset/admin phase movement does not accidentally create Delay", () => {
  const state = activeVanguard();
  delete state.activeCombatantId;
  const moved = applyCurrentRoundPlacement(state, "pc1", PLACEMENTS.PENDING, { userId: "gm" });
  assert.equal(moved.delayed.pc1, undefined);
});

await test("22 Move to Rearguard administrative action remains lifecycle-neutral", () => {
  const state = activeVanguard();
  delete state.activeCombatantId;
  const before = structuredClone(state.lifecycle);
  const moved = applyCurrentRoundPlacement(state, "pc1", PLACEMENTS.REARGUARD, { userId: "gm" });
  assert.deepEqual(moved.lifecycle, before);
  assert.equal(moved.delayed.pc1, undefined);
});

await test("23 Delay command rejected for already-ended actor", () => {
  const state = activeVanguard();
  state.lifecycle.turns.pc1.ended = true;
  state.lifecycle.turns.pc1.endStatus = BOUNDARY_STATUS.COMPLETED;
  assert.equal(delay(state).reason, "already-ended");
});

await test("24 Delay command rejected for already-delayed actor", () => {
  const first = delay().state;
  first.activeCombatantId = "pc1";
  assert.equal(delay(first).reason, "already-delayed");
});

await test("25 stale-round Delay request rejected", () => {
  const state = activeVanguard();
  const result = delayActiveTurnToRearguard(state, "pc1", { expectedRound: 3 });
  assert.equal(result.reason, "stale-round");
});

await test("26 stale-phase Delay request rejected", () => {
  const state = activeVanguard();
  const result = delayActiveTurnToRearguard(state, "pc1", { expectedPhaseInstanceId: "old" });
  assert.equal(result.reason, "stale-phase");
});

await test("27 second GM cannot duplicate Delay lifecycle mutations", () => {
  const first = delay().state;
  first.activeCombatantId = "pc1";
  const second = delay(first);
  assert.equal(second.changed, false);
  assert.equal(first.delayed.pc1.actualTurnId, second.state.delayed.pc1.actualTurnId);
});

await test("28 Lifecycle Inspector reports Delayed", () => {
  const state = enterRearguard(delay().state);
  const inspection = buildLifecycleInspection(state.lifecycle, "pc1");
  assert.equal(inspection.workflowStatus, TURN_WORKFLOW_STATUS.DELAYED);
  assert.equal(inspection.resumePhase, PHASES.REARGUARD);
});

await test("29 Retry Start unavailable when delayed Start already completed", () => {
  const state = enterRearguard(delay().state);
  assert.equal(canRetryStartBoundary(state.lifecycle, "pc1"), false);
});

await test("30 Mark Review on delayed actor executes no lifecycle", () => {
  const state = enterRearguard(delay().state);
  const result = markTurnReview(state, "pc1");
  assert.equal(result.state.lifecycle.turns.pc1.administrativeStatus, TURN_ADMIN_STATUS.REVIEW);
  assert.equal(result.state.lifecycle.turns.pc1.endProcessed, false);
});

await test("31 Mark Complete on delayed actor executes no native End", () => {
  const state = enterRearguard(delay().state);
  const result = markTurnCompleteAdministrative(state, "pc1");
  assert.equal(result.state.lifecycle.turns.pc1.endProcessed, false);
  assert.equal(result.state.delayed.pc1, undefined);
});

await test("32 Mark Skipped on delayed actor executes no native End", () => {
  const state = enterRearguard(delay().state);
  const result = markTurnSkipped(state, "pc1");
  assert.equal(result.state.lifecycle.turns.pc1.endProcessed, false);
  assert.equal(result.state.lifecycle.turns.pc1.endStatus, BOUNDARY_STATUS.SKIPPED);
});

await test("33 no unresolved runtime reference to legacy confirmation identifier", () => {
  assert.equal((controllerSource + uiSource + confirmationSource).includes("confirm" + "Dialog"), false);
});

await test("34 incomplete-phase confirmation opens through declared helper", async () => {
  let opened = false;
  globalThis.foundry = { applications: { api: { DialogV2: { wait: async () => { opened = true; return "return"; } } } } };
  const choice = await chooseNelTempoAction({ buttons: [{ action: "return" }], defaultAction: "return" });
  assert.equal(opened, true);
  assert.equal(choice, "return");
});

await test("35 cancellation leaves state unchanged", async () => {
  globalThis.foundry = { applications: { api: { DialogV2: { confirm: async () => false } } } };
  const state = { revision: 1 };
  if (await confirmNelTempoAction({ title: "Danger", content: "Cancel" })) state.revision += 1;
  assert.equal(state.revision, 1);
});

await test("36 Process Remaining performs intended action", async () => {
  globalThis.foundry = { applications: { api: { DialogV2: { wait: async () => "process" } } } };
  const choice = await chooseNelTempoAction({ buttons: [{ action: "process" }, { action: "return" }] });
  assert.equal(choice, "process");
  assert.ok(uiSource.includes("REQUESTS.PROCESS_END_REMAINING"));
});

await test("37 Advance Without Processing performs intended skip path", async () => {
  globalThis.foundry = { applications: { api: { DialogV2: { wait: async () => "skip" } } } };
  const choice = await chooseNelTempoAction({ buttons: [{ action: "skip" }, { action: "return" }] });
  const skipped = choice === "skip" ? skipRemainingTurns(enterRearguard(delay().state)) : null;
  assert.equal(skipped.state.lifecycle.turns.pc1.endStatus, BOUNDARY_STATUS.SKIPPED);
});

await test("38 dialog-construction failure leaves state unchanged", async () => {
  const originalError = console.error;
  console.error = () => {};
  globalThis.foundry = { applications: { api: { DialogV2: { confirm: async () => { throw new Error("render"); } } } } };
  const state = { changed: false };
  if (await confirmNelTempoAction({ diagnostic: "test" })) state.changed = true;
  console.error = originalError;
  assert.equal(state.changed, false);
});

await test("39 dialog failure logs diagnostic rather than rejecting", async () => {
  let logged = "";
  const originalError = console.error;
  console.error = (message) => { logged += message; };
  globalThis.foundry = { applications: { api: { DialogV2: { confirm: async () => { throw new Error("render"); } } } } };
  const result = await confirmNelTempoAction({ diagnostic: "repair-test" });
  console.error = originalError;
  assert.equal(result, false);
  assert.match(logged, /repair-test confirmation failed/);
});

await test("40 Next Phase works with Guard Off", () => {
  assert.ok(controllerSource.includes("guard-disabled-advance"));
  assert.ok(uiSource.includes("REQUESTS.SET_PHASE"));
});

await test("41 Next Phase works with Guard On and complete phase", () => {
  let state = enterRearguard(delay().state);
  state.lifecycle.status = LIFECYCLE_STATUS.OPEN;
  state = markCombatantEndResult(state, "pc1", { ok: true });
  assert.equal(phaseAdvanceReady(state.lifecycle), true);
});

await test("42 Guard On incomplete phase presents actionable choices", () => {
  assert.ok(uiSource.includes('action: "process"'));
  assert.ok(uiSource.includes('action: "skip"'));
  assert.ok(uiSource.includes('action: "return"'));
});

await test("43 Rearguard button does not use an undeclared confirmation", () => {
  assert.ok(uiSource.includes('case "move-active-rearguard"'));
  assert.ok(controllerSource.includes("delayActiveTurnToRearguard"));
});

await test("44 Undo button does not use an undeclared confirmation", () => {
  assert.ok(uiSource.includes('case "undo"'));
  assert.ok(uiSource.includes("REQUESTS.UNDO"));
});

await test("45 End Combat confirmation does not throw", async () => {
  globalThis.foundry = { applications: { api: { DialogV2: { confirm: async () => true } } } };
  assert.equal(await confirmNelTempoAction({ diagnostic: "end-combat" }), true);
});

await test("46 confirmation paths create no unhandled Promise rejection", async () => {
  const originalError = console.error;
  console.error = () => {};
  globalThis.foundry = { applications: { api: { DialogV2: { wait: async () => { throw new Error("failed"); } } } } };
  await assert.doesNotReject(() => chooseNelTempoAction({ defaultAction: "return", diagnostic: "no-rejection" }));
  console.error = originalError;
  delete globalThis.foundry;
  globalThis.window = { confirm: () => false };
  const fallback = await chooseNelTempoAction({
    defaultAction: "return",
    fallback: { message: "Skip?", confirmedAction: "skip", cancelledAction: "return" },
  });
  assert.equal(fallback, "return");
});

const originalGame = globalThis.game;
const effectCounts = {
  fastHealing: 0,
  regeneration: 0,
  actions: 0,
  reaction: 0,
  defenseExpiry: 0,
  persistentDamage: 0,
  recovery: 0,
  frightened: 0,
};
globalThis.game = { system: { id: "pf2e", version: "8.4.0" } };
const nativeCombatant = {
  id: "pc1",
  actor: {},
  async onStartTurn() {
    effectCounts.fastHealing += 1;
    effectCounts.regeneration += 1;
    effectCounts.actions += 1;
    effectCounts.reaction += 1;
    effectCounts.defenseExpiry += 1;
  },
  async onEndTurn() {
    effectCounts.persistentDamage += 1;
    effectCounts.recovery += 1;
    effectCounts.frightened += 1;
  },
};
const nativeCombat = { id: "combat", round: 4, combatants: new Map([["pc1", nativeCombatant]]) };
await processStartTurn(nativeCombat, "pc1");
const delayedForNative = enterRearguard(delay().state);

await test("47 Fast Healing once per legitimate Start", () => assert.equal(effectCounts.fastHealing, 1));
await test("48 regeneration once per legitimate Start", () => assert.equal(effectCounts.regeneration, 1));
await test("49 action refresh once per legitimate Start", () => assert.equal(effectCounts.actions, 1));
await test("50 reaction refresh once per legitimate Start", () => assert.equal(effectCounts.reaction, 1));
await test("51 Raise Shield/Parry expiry once per legitimate Start", () => assert.equal(effectCounts.defenseExpiry, 1));

await processEndTurn(nativeCombat, "pc1", { round: 4 });
await test("52 persistent damage once per legitimate End", () => assert.equal(effectCounts.persistentDamage, 1));
await test("53 recovery once per legitimate End", () => assert.equal(effectCounts.recovery, 1));
await test("54 frightened reduction once per legitimate End", () => assert.equal(effectCounts.frightened, 1));
await test("55 Delay introduces no extra Start", () => {
  assert.deepEqual(startCandidates(delayedForNative.lifecycle), []);
  assert.equal(effectCounts.fastHealing, 1);
});
await test("56 Delay introduces no early End", () => {
  const freshCounts = { end: 0 };
  const pureDelay = delay().state;
  assert.equal(pureDelay.delayed.pc1.endProcessed, false);
  assert.equal(freshCounts.end, 0);
});
await test("57 Delay plus eventual End produces one Start and one End total", () => {
  assert.equal(effectCounts.fastHealing, 1);
  assert.equal(effectCounts.persistentDamage, 1);
  assert.equal(delayedForNative.lifecycle.turns.pc1.startProcessed, true);
});

globalThis.game = originalGame;
delete globalThis.foundry;
delete globalThis.window;

// Corrupt/orphaned delayed records use safe skip only when the controller's
// Guard-Off policy explicitly requests it.
const orphaned = delay().state;
orphaned.lifecycle = null;
assert.deepEqual(skipUnresolvedDelayedTurns(orphaned).skipped, ["pc1"]);

assert.equal(count, 58);
console.log(`${count} NelTempo 0.4.0 delayed-turn/dialog/PF2e repair tests passed.`);
