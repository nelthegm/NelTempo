import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  BOUNDARY_STATUS,
  LIFECYCLE_STATUS,
  createLifecycle,
  emptyTurnRecord,
} from "../scripts/lifecycle.js";
import {
  PLACEMENTS,
  PLACEMENT_METHODS,
  PLACEMENT_MODES,
  CORRECTION_STATUS,
  appendToOpenRoster,
  applyCurrentRoundPlacement,
  buildEditorProjection,
  cancelQueuedCorrection,
  destinationIsCurrent,
  destinationPhaseEnded,
  evaluatePlacementOptions,
  hasStartBoundaryThisRound,
  leaveOpenRoster,
  normalizePlacementCorrections,
  placementForCurrentRound,
  queueNextRoundCorrection,
  undoCrossesPlacementStart,
} from "../scripts/placement-editor.js";
import {
  PHASES,
  beginRoundTransition,
  combatantPhase,
  createState,
  normalizeState,
  submitResult,
  withHistory,
} from "../scripts/state.js";
import { MODULE_ID, REQUESTS } from "../scripts/constants.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- Baseline identity / version / tag ---
const moduleJson = JSON.parse(readFileSync(join(root, "module.json"), "utf8"));
assert.equal(moduleJson.version, "0.3.6");
assert.equal(moduleJson.id, "nel-dynamic-initiative");
assert.equal(moduleJson.title, "NelTempo");
assert.equal(MODULE_ID, "nel-dynamic-initiative");

const tagShow = execFileSync("git", ["show", "--no-patch", "--format=%H %D", "v0.2.2"], {
  cwd: root,
  encoding: "utf8",
});
assert.match(tagShow, /eba5cbddbd2365779ba06af73f1827e75c92628f/);

assert.equal(REQUESTS.PLACEMENT_APPLY, "placement-apply");
assert.equal(REQUESTS.PLACEMENT_QUEUE, "placement-queue");
assert.equal(REQUESTS.PLACEMENT_CANCEL_QUEUE, "placement-cancel-queue");

const fresh = createState();
assert.equal(fresh.schema, 6);
assert.deepEqual(fresh.placements, {});
assert.deepEqual(fresh.placementCorrections, {});
assert.deepEqual(fresh.placementAudit, []);

// Localization keys
const lang = JSON.parse(readFileSync(join(root, "lang/en.json"), "utf8"));
for (const key of [
  "NDI.Placement.Edit",
  "NDI.Placement.CurrentPlacement",
  "NDI.Placement.CurrentRound",
  "NDI.Placement.NextRound",
  "NDI.Placement.Pending",
  "NDI.Placement.QueueForNextRound",
  "NDI.Placement.CancelQueued",
  "NDI.Placement.GmCorrected",
  "NDI.Placement.CorrectionApplied",
  "NDI.Placement.CorrectionQueued",
  "NDI.Placement.CorrectionCancelled",
  "NDI.Placement.PhaseEnded",
  "NDI.Placement.TurnCompleted",
  "NDI.Placement.LifecycleBusy",
  "NDI.Placement.PendingUnsafe",
  "NDI.Placement.QueueInstead",
  "NDI.Placement.StateChanged",
  "NDI.Placement.JoinCurrentPhase",
  "NDI.Placement.UndoStateOnly",
  "NDI.Placement.UndoNativeWarning",
]) {
  assert.ok(lang[key], `missing localization ${key}`);
}

// Namespaces unchanged in source
const constantsSrc = readFileSync(join(root, "scripts/constants.js"), "utf8");
assert.match(constantsSrc, /nel-dynamic-initiative/);
assert.equal(constantsSrc.includes("MODULE_ID"), true);

// --- Initiative-phase corrections ---
let state = createState({ round: 1, enemyDC: 15 });
state = submitResult(state, "pc1", { total: 20, skill: "perception" });
assert.equal(state.results.pc1.phase, PHASES.VANGUARD);
state = applyCurrentRoundPlacement(state, "pc1", PLACEMENTS.REARGUARD, {
  userId: "gm1",
  originalPhase: PLACEMENTS.VANGUARD,
});
assert.equal(placementForCurrentRound(state, "pc1").phase, PLACEMENTS.REARGUARD);
assert.equal(combatantPhase(state, "pc1"), PLACEMENTS.REARGUARD);
assert.equal(state.results.pc1.phase, PHASES.REARGUARD);
assert.equal(state.lifecycle, null);
assert.equal(state.placements.pc1.method, PLACEMENT_METHODS.GM_CURRENT);

state = applyCurrentRoundPlacement(state, "pc1", PLACEMENTS.ENEMY, { userId: "gm1" });
assert.equal(combatantPhase(state, "pc1", "party"), PLACEMENTS.ENEMY);

state = applyCurrentRoundPlacement(state, "pc1", PLACEMENTS.PENDING, {
  userId: "gm1",
  method: PLACEMENT_METHODS.GM_PENDING_RESET,
});
assert.equal(combatantPhase(state, "pc1"), PLACEMENTS.PENDING);
assert.equal(state.results.pc1, undefined);

const initOpts = evaluatePlacementOptions(createState({ round: 1 }), "pc1", { side: "party" });
assert.ok(initOpts.currentRoundOptions.every((o) => o.allowed));
assert.ok(initOpts.nextRoundOptions.every((o) => o.allowed));

// --- Open Vanguard: future move to Rearguard ---
state = createState({ round: 1, enemyDC: 15 });
state.phase = PHASES.VANGUARD;
state = submitResult(state, "pc1", { total: 22, skill: "perception" });
state = submitResult(state, "pc2", { total: 18, skill: "stealth" });
let lc = createLifecycle({
  phase: PHASES.VANGUARD,
  round: 1,
  roster: ["pc1", "pc2"],
  phaseInstanceId: "phase-v1",
});
lc.status = LIFECYCLE_STATUS.OPEN;
state.lifecycle = lc;
const phaseIdBefore = state.lifecycle.phaseInstanceId;

const futureOpts = evaluatePlacementOptions(state, "pc1", { side: "party" });
assert.equal(futureOpts.currentRoundOptions.find((o) => o.phase === PLACEMENTS.REARGUARD)?.allowed, true);
assert.equal(futureOpts.currentRoundOptions.find((o) => o.phase === PHASES.VANGUARD)?.allowed, false);

let left = leaveOpenRoster(state, "pc1", { userId: "gm1" });
assert.equal(left.changed, true);
state = left.state;
state = applyCurrentRoundPlacement(state, "pc1", PLACEMENTS.REARGUARD, {
  userId: "gm1",
  originalPhase: PLACEMENTS.VANGUARD,
});
assert.equal(state.lifecycle.phaseInstanceId, phaseIdBefore);
assert.equal(state.lifecycle.turns.pc1.skipped, true);
assert.equal(state.lifecycle.turns.pc1.endStatus, BOUNDARY_STATUS.SKIPPED);
assert.notEqual(state.lifecycle.turns.pc1.endStatus, BOUNDARY_STATUS.COMPLETED);
assert.equal(combatantPhase(state, "pc1"), PLACEMENTS.REARGUARD);
assert.equal(state.lifecycle.roster.includes("pc1"), true); // still in roster as finished/skipped

// --- Current phase join ---
state = createState({ round: 1 });
state.phase = PHASES.VANGUARD;
lc = createLifecycle({
  phase: PHASES.VANGUARD,
  round: 1,
  roster: ["pc1"],
  phaseInstanceId: "phase-join",
});
lc.status = LIFECYCLE_STATUS.OPEN;
state.lifecycle = lc;
state = applyCurrentRoundPlacement(state, "pending1", PLACEMENTS.VANGUARD, { userId: "gm1" });
const joined = appendToOpenRoster(state, "pending1", { initiativeTotal: 10 });
assert.equal(joined.changed, true);
assert.equal(joined.needsStart, true);
assert.ok(joined.state.lifecycle.roster.includes("pending1"));
assert.equal(joined.state.lifecycle.phaseInstanceId, "phase-join");
assert.equal(hasStartBoundaryThisRound(joined.state.lifecycle, "pending1"), false);

// Already started — preserve
joined.state.lifecycle.turns.pending1 = emptyTurnRecord();
joined.state.lifecycle.turns.pending1.startStatus = BOUNDARY_STATUS.COMPLETED;
assert.equal(hasStartBoundaryThisRound(joined.state.lifecycle, "pending1"), true);

// --- Completed turn cannot rejoin ---
state = createState({ round: 1 });
state.phase = PHASES.VANGUARD;
lc = createLifecycle({
  phase: PHASES.VANGUARD,
  round: 1,
  roster: ["pc1"],
  phaseInstanceId: "phase-done",
});
lc.status = LIFECYCLE_STATUS.OPEN;
lc.turns.pc1.ended = true;
lc.turns.pc1.endStatus = BOUNDARY_STATUS.COMPLETED;
state.lifecycle = lc;
state = applyCurrentRoundPlacement(state, "pc1", PLACEMENTS.VANGUARD, { userId: "gm1" });
const doneOpts = evaluatePlacementOptions(state, "pc1", { side: "party" });
assert.equal(doneOpts.currentRoundOptions.find((o) => o.phase === PLACEMENTS.ENEMY)?.allowed, false);
assert.equal(doneOpts.currentRoundOptions.find((o) => o.phase === PLACEMENTS.ENEMY)?.reason, "turn-completed");
assert.ok(doneOpts.nextRoundOptions.every((o) => o.allowed));

// --- Past phase rejection ---
state = createState({ round: 1 });
state.phase = PHASES.REARGUARD;
lc = createLifecycle({
  phase: PHASES.REARGUARD,
  round: 1,
  roster: ["pc1"],
  phaseInstanceId: "phase-rg",
});
lc.status = LIFECYCLE_STATUS.OPEN;
state.lifecycle = lc;
assert.equal(destinationPhaseEnded(state, PLACEMENTS.VANGUARD), true);
assert.equal(destinationPhaseEnded(state, PLACEMENTS.ENEMY), true);
const pastOpts = evaluatePlacementOptions(state, "pc1", { side: "party" });
assert.equal(pastOpts.currentRoundOptions.find((o) => o.phase === PLACEMENTS.VANGUARD)?.reason, "phase-already-ended");

// --- Lifecycle busy blocks This Round ---
state = createState({ round: 1 });
state.phase = PHASES.VANGUARD;
lc = createLifecycle({ phase: PHASES.VANGUARD, round: 1, roster: ["pc1"], phaseInstanceId: "busy" });
lc.status = LIFECYCLE_STATUS.STARTING;
state.lifecycle = lc;
const busyOpts = evaluatePlacementOptions(state, "pc1");
assert.ok(busyOpts.currentRoundOptions.every((o) => !o.allowed && o.reason === "lifecycle-busy"));
assert.ok(busyOpts.nextRoundOptions.every((o) => o.allowed));

// --- Next-round queue ---
state = createState({ round: 2 });
let queued = queueNextRoundCorrection(state, "pc1", PLACEMENTS.ENEMY, { userId: "gm1" });
assert.equal(queued.ok, true);
state = queued.state;
assert.equal(state.placementCorrections.pc1.targetPhase, PLACEMENTS.ENEMY);
assert.equal(state.placementCorrections.pc1.effectiveRound, 3);
assert.equal(state.placementCorrections.pc1.status, CORRECTION_STATUS.QUEUED);

const replaceBlocked = queueNextRoundCorrection(state, "pc1", PLACEMENTS.VANGUARD, { replace: false });
assert.equal(replaceBlocked.ok, false);
assert.equal(replaceBlocked.requiresReplaceConfirm, true);

queued = queueNextRoundCorrection(state, "pc1", PLACEMENTS.REARGUARD, { userId: "gm1", replace: true });
assert.equal(queued.ok, true);
state = queued.state;
assert.equal(state.placementCorrections.pc1.targetPhase, PLACEMENTS.REARGUARD);

const cancelled = cancelQueuedCorrection(state, "pc1", { userId: "gm1" });
assert.equal(cancelled.ok, true);
assert.equal(cancelled.state.placementCorrections.pc1, undefined);

// Queue survives normalize / consume once
state = createState({ round: 1, enemyDC: 10 });
state = submitResult(state, "pc1", { total: 5, skill: "perception" });
queued = queueNextRoundCorrection(state, "pc1", PLACEMENTS.VANGUARD, { userId: "gm1" });
state = queued.state;
const normalized = normalizeState(state, { combatantIds: ["pc1"] });
assert.ok(normalized.placementCorrections.pc1);
assert.equal(JSON.parse(JSON.stringify(normalized.placementCorrections)).pc1.targetPhase, PLACEMENTS.VANGUARD);

const nextRound = beginRoundTransition(normalized);
assert.equal(nextRound.round, 2);
assert.equal(combatantPhase(nextRound, "pc1"), PLACEMENTS.VANGUARD);
assert.equal(nextRound.placementCorrections.pc1, undefined);
assert.equal(nextRound.placements.pc1.method, PLACEMENT_METHODS.GM_NEXT);
assert.equal(nextRound.results.pc1?.forced, true);
assert.equal(nextRound.results.pc1?.total, null);

// Pending queue → unresolved
state = createState({ round: 4 });
queued = queueNextRoundCorrection(state, "pc2", PLACEMENTS.PENDING, { userId: "gm1" });
const pendingRound = beginRoundTransition(queued.state);
assert.equal(combatantPhase(pendingRound, "pc2"), PLACEMENTS.PENDING);
assert.equal(pendingRound.results.pc2, undefined);

// Stale combatant pruned
const withStale = normalizePlacementCorrections(
  { gone: { targetPhase: "vanguard", effectiveRound: 9, status: "queued" }, keep: { targetPhase: "enemy", effectiveRound: 9, status: "queued" } },
  { combatantIds: new Set(["keep"]) },
);
assert.equal(withStale.gone, undefined);
assert.ok(withStale.keep);

// Privacy: no names in placement records
state = applyCurrentRoundPlacement(createState({ round: 1 }), "abc123", PLACEMENTS.VANGUARD, {
  userId: "user99",
});
const dump = JSON.stringify(state.placements);
assert.equal(/Hero|Goblin|Alice/i.test(dump), false);
assert.ok(!dump.includes("Actor."));

// Editor projection
state = createState({ round: 1 });
state.phase = PHASES.INITIATIVE;
state.revision = 7;
const proj = buildEditorProjection(state, "pc1", { side: "party", revision: 7 });
assert.equal(proj.revision, 7);
assert.equal(proj.phase, PHASES.INITIATIVE);
assert.ok(Array.isArray(proj.currentRoundOptions));

// Undo crosses placement start detection
state = createState({ round: 1 });
state.phase = PHASES.VANGUARD;
state.lifecycle = createLifecycle({
  phase: PHASES.VANGUARD,
  round: 1,
  roster: ["pc1"],
  phaseInstanceId: "x",
});
state.lifecycle.status = LIFECYCLE_STATUS.OPEN;
const prior = withHistory(state, "Place pc1 → vanguard");
prior.placementAudit = [
  ...(prior.placementAudit ?? []),
  { event: "placement-start-boundary-invoked", at: Date.now(), combatantId: "pc1" },
];
assert.equal(undoCrossesPlacementStart(prior), true);

// destination helpers
state = createState({ round: 1 });
state.phase = PHASES.ENEMY;
assert.equal(destinationIsCurrent(state, PLACEMENTS.ENEMY), true);
assert.equal(destinationIsCurrent(state, PLACEMENTS.PENDING), false);

// Schema migration defaults
const legacy = createState({ round: 1 });
delete legacy.placements;
delete legacy.placementCorrections;
delete legacy.placementAudit;
legacy.schema = 3;
const migrated = normalizeState(legacy, { combatantIds: [] });
assert.equal(migrated.schema >= 4, true);
assert.deepEqual(migrated.placements, {});
assert.deepEqual(migrated.placementCorrections, {});

// Pack include list mentions placement-editor
const packSrc = readFileSync(join(root, "scripts/pack.mjs"), "utf8");
assert.match(packSrc, /placement-editor\.js/);

console.log("placement.test.mjs: ok");
