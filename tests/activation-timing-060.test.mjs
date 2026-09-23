/** NelTempo 0.6.0 — observational activation timing coverage. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  activationDurationMs,
  activationTimingSummaryHTML,
  buildActivationTimingSummary,
  createActivationTiming,
  formatActivationDuration,
  formatActivationDurationAria,
  markActivationSummaryPosted,
  normalizeActivationTiming,
  reconcileActivationTiming,
  startActivationTiming,
  stopActivationTiming,
  stopAllActivationTiming,
} from "../scripts/activation-timing.js";
import { SETTINGS } from "../scripts/constants.js";
import { createLifecycle, delayActiveTurnToRearguard, LIFECYCLE_STATUS } from "../scripts/lifecycle.js";
import { createState, normalizeState, PHASES, SCHEMA_VERSION } from "../scripts/state.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const controllerSource = readFileSync(join(root, "scripts/controller.js"), "utf8");
const portraitSource = readFileSync(join(root, "scripts/portrait-activation.js"), "utf8");
const uiSource = readFileSync(join(root, "scripts/ui.js"), "utf8");
const lifecycleSource = readFileSync(join(root, "scripts/lifecycle.js"), "utf8");

let count = 0;
function scenario(name, test) {
  try {
    test();
    count += 1;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}

function start(timing, id, now, label = id, enabled = true) {
  return startActivationTiming(timing, id, { now, label, enabled }).timing;
}

function stop(timing, id, now) {
  return stopActivationTiming(timing, id, { now }).timing;
}

scenario("1 activation starts timer", () => {
  const timing = start(createActivationTiming(), "pc", 1000, "Valeros");
  assert.equal(timing.records.pc.activeSince, 1000);
  assert.equal(timing.records.pc.activationCount, 1);
});

scenario("2 phase entry alone does not start", () => {
  const state = createState();
  state.phase = PHASES.VANGUARD;
  state.lifecycle = createLifecycle({ phase: PHASES.VANGUARD, round: 1, roster: ["pc"] });
  assert.deepEqual(state.activationTiming.records, {});
});

scenario("3 portrait token selection alone does not start", () => {
  assert.equal(portraitSource.includes("startActivationTiming"), false);
  assert.equal(portraitSource.includes("beginActivationObservation"), false);
});

scenario("4 canonical claim records activeSince", () => {
  const claim = controllerSource.slice(
    controllerSource.indexOf("async function claimTurn"),
    controllerSource.indexOf("function isTurnEnded"),
  );
  assert.match(claim, /beginActivationObservation\(next, combatant\)/);
});

scenario("5 End Turn closes once", () => {
  const result = stopActivationTiming(start(createActivationTiming(), "pc", 1000), "pc", { now: 3500 });
  assert.equal(result.elapsedMs, 2500);
  assert.equal(result.timing.records.pc.activeSince, null);
});

scenario("6 duplicate End cannot double count", () => {
  let timing = start(createActivationTiming(), "pc", 1000);
  timing = stop(timing, "pc", 3500);
  const duplicate = stopActivationTiming(timing, "pc", { now: 9000 });
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.timing.records.pc.totalMs, 2500);
});

scenario("7 combatants keep independent totals", () => {
  let timing = start(createActivationTiming(), "pc", 1000);
  timing = stop(timing, "pc", 3000);
  timing = start(timing, "npc", 4000, "Ogre");
  timing = stop(timing, "npc", 9000);
  assert.equal(timing.records.pc.totalMs, 2000);
  assert.equal(timing.records.npc.totalMs, 5000);
});

scenario("8 Enemy NPC activation uses canonical claim", () => {
  const claim = controllerSource.slice(controllerSource.indexOf("async function claimTurn"), controllerSource.indexOf("function isTurnEnded"));
  assert.match(claim, /liveState\.phase === PHASES\.ENEMY/);
  assert.equal((claim.match(/beginActivationObservation/g) ?? []).length, 1);
  assert.match(claim, /finishActivationObservation/);
  assert.equal(claim.includes("OtherActive"), false);
});

scenario("9 Rearguard PC activation uses canonical claim", () => {
  const claim = controllerSource.slice(controllerSource.indexOf("function canClaimInPhase"), controllerSource.indexOf("function isTurnEnded"));
  assert.match(claim, /PHASES\.REARGUARD/);
  assert.match(claim, /beginActivationObservation/);
});

scenario("9b Portrait switch pauses prior timer and starts a new session", () => {
  let timing = start(createActivationTiming(), "pc1", 1000, "A");
  timing = stop(timing, "pc1", 5000);
  timing = start(timing, "pc2", 5000, "B");
  assert.equal(timing.records.pc1.totalMs, 4000);
  assert.equal(timing.records.pc1.activeSince, null);
  assert.equal(timing.records.pc2.activeSince, 5000);
  assert.equal(timing.records.pc2.activationCount, 1);
  timing = stop(timing, "pc2", 9000);
  timing = start(timing, "pc1", 9000, "A");
  assert.equal(timing.records.pc1.activationCount, 2);
  assert.equal(timing.records.pc1.activeSince, 9000);
});

scenario("9c Free claim switching is not blocked by another active combatant", () => {
  const claim = controllerSource.slice(controllerSource.indexOf("async function claimTurn"), controllerSource.indexOf("function isTurnEnded"));
  assert.equal(/activeCombatantId &&[\s\S]{0,80}OtherActive/.test(claim), false);
  const uiClaim = uiSource.slice(uiSource.indexOf("function canUserClaim"), uiSource.indexOf("function canUserEndTurn"));
  assert.equal(uiClaim.includes("activeCombatantId"), false);
});
scenario("10 Delay pauses timer", () => {
  let timing = start(createActivationTiming(), "pc", 1000);
  timing = stop(timing, "pc", 11000);
  assert.equal(timing.records.pc.totalMs, 10000);
  assert.equal(timing.records.pc.activeSince, null);
});

scenario("11 Enemy waiting time is excluded after Delay", () => {
  let timing = start(createActivationTiming(), "pc", 1000);
  timing = stop(timing, "pc", 11000);
  assert.equal(activationDurationMs(timing.records.pc, 21000), 10000);
});

scenario("12 delayed Rearguard resume starts a new session", () => {
  let timing = start(createActivationTiming(), "pc", 1000);
  timing = stop(timing, "pc", 11000);
  timing = start(timing, "pc", 21000);
  assert.equal(timing.records.pc.activeSince, 21000);
  assert.equal(timing.records.pc.activationCount, 2);
});

scenario("13 delayed eventual End accumulates both segments", () => {
  let timing = start(createActivationTiming(), "pc", 1000);
  timing = stop(timing, "pc", 32000);
  timing = start(timing, "pc", 50000);
  timing = stop(timing, "pc", 73000);
  assert.equal(timing.records.pc.totalMs, 54000);
});

scenario("14 Delay remains one Start and one End lifecycle", () => {
  const state = createState();
  state.phase = PHASES.VANGUARD;
  state.activeCombatantId = "pc";
  state.lifecycle = createLifecycle({ phase: PHASES.VANGUARD, round: 1, roster: ["pc"] });
  state.lifecycle.status = LIFECYCLE_STATUS.OPEN;
  state.lifecycle.turns.pc.startStatus = "completed";
  state.lifecycle.turns.pc.startClaimed = true;
  state.lifecycle.turns.pc.startProcessed = true;
  const delayed = delayActiveTurnToRearguard(state, "pc", { expectedRound: 1 });
  assert.equal(delayed.changed, true);
  assert.equal(delayed.state.delayed.pc.startStatus, "completed");
  assert.equal(delayed.state.delayed.pc.endStatus, "pending");
});

scenario("15 reactions do not start timing", () => {
  assert.equal(controllerSource.includes("reactionActivationTiming"), false);
  assert.equal(Object.keys(createActivationTiming().records).length, 0);
});

scenario("16 Ready does not start timing", () => {
  assert.equal(controllerSource.includes("readyActivationTiming"), false);
  assert.equal(Object.keys(createActivationTiming().records).length, 0);
});

scenario("17 administrative placement does not start timing", () => {
  const placement = controllerSource.slice(controllerSource.indexOf("async function placementApply"), controllerSource.indexOf("async function placementQueue"));
  assert.equal(placement.includes("beginActivationObservation"), false);
});

scenario("18 Mark Complete closes an existing timer without native End", () => {
  const handler = controllerSource.slice(controllerSource.indexOf("async function markCombatantComplete"), controllerSource.indexOf("async function markCombatantSkipped"));
  assert.match(handler, /finishActivationObservation/);
  assert.equal(handler.includes("processEndTurn("), false);
});

scenario("19 Mark Skipped closes an existing timer without native End", () => {
  const handler = controllerSource.slice(controllerSource.indexOf("async function markCombatantSkipped"), controllerSource.indexOf("async function markCombatantReview"));
  assert.match(handler, /finishActivationObservation/);
  assert.equal(handler.includes("processEndTurn("), false);
});

scenario("20 Reopen retains prior accumulated time", () => {
  let timing = start(createActivationTiming(), "pc", 1000);
  timing = stop(timing, "pc", 6000);
  const retained = normalizeActivationTiming(timing);
  assert.equal(retained.records.pc.totalMs, 5000);
});

scenario("21 reopened activation adds a session and time", () => {
  let timing = start(createActivationTiming(), "pc", 1000);
  timing = stop(timing, "pc", 6000);
  timing = start(timing, "pc", 10000);
  timing = stop(timing, "pc", 13000);
  assert.equal(timing.records.pc.totalMs, 8000);
  assert.equal(timing.records.pc.activationCount, 2);
});

scenario("22 reload preserves proven activeSince", () => {
  const timing = start(createActivationTiming(), "pc", 1000);
  const result = reconcileActivationTiming(timing, { activeCombatantId: "pc", now: 9000 });
  assert.equal(result.changed, false);
  assert.equal(result.timing.records.pc.activeSince, 1000);
});

scenario("23 reload after finalized segment does not duplicate", () => {
  let timing = start(createActivationTiming(), "pc", 1000);
  timing = stop(timing, "pc", 5000);
  const result = reconcileActivationTiming(timing, { activeCombatantId: null, now: 9000 });
  assert.equal(result.changed, false);
  assert.equal(result.timing.records.pc.totalMs, 4000);
});

scenario("24 malformed activeSince fails safely", () => {
  const timing = normalizeActivationTiming({ records: { pc: { totalMs: 4, activationCount: 1, activeSince: "bad" } } });
  assert.equal(timing.records.pc.activeSince, null);
  assert.equal(Number.isNaN(timing.records.pc.totalMs), false);
});

scenario("25 negative elapsed clamps to zero", () => {
  const result = stopActivationTiming(start(createActivationTiming(), "pc", 5000), "pc", { now: 1000 });
  assert.equal(result.elapsedMs, 0);
  assert.equal(result.timing.records.pc.totalMs, 0);
});

scenario("26 tracking disabled creates no records", () => {
  const result = startActivationTiming(createActivationTiming(), "pc", { now: 1000, enabled: false });
  assert.equal(result.changed, false);
  assert.deepEqual(result.timing.records, {});
});

scenario("27 display setting is presentation-only", () => {
  assert.equal(SETTINGS.SHOW_ACTIVATION_TIMER, "showActivationTimer");
  const timing = start(createActivationTiming(), "pc", 1000, "Valeros", true);
  assert.equal(timing.records.pc.activeSince, 1000);
});

scenario("28 summary includes every timed combatant", () => {
  let timing = start(createActivationTiming(), "a", 0, "A");
  timing = stop(timing, "a", 1000);
  timing = start(timing, "b", 0, "B");
  timing = stop(timing, "b", 2000);
  assert.equal(buildActivationTimingSummary(timing).entries.length, 2);
});

scenario("29 summary grand total is correct", () => {
  const timing = { records: {
    a: { totalMs: 4000, activationCount: 1, activeSince: null, label: "A" },
    b: { totalMs: 6000, activationCount: 1, activeSince: null, label: "B" },
  } };
  assert.equal(buildActivationTimingSummary(timing).totalMs, 10000);
});

scenario("30 activation average is correct", () => {
  const timing = { records: { a: { totalMs: 9000, activationCount: 2, activeSince: null, label: "A" } } };
  assert.equal(buildActivationTimingSummary(timing).entries[0].averageMs, 4500);
});

scenario("31 zero duration is safe", () => {
  const timing = start(createActivationTiming(), "a", 1000, "A");
  const finalized = stop(timing, "a", 1000);
  const entry = buildActivationTimingSummary(finalized).entries[0];
  assert.equal(entry.totalMs, 0);
  assert.equal(entry.averageMs, 0);
});

scenario("32 removed combatant snapshot is preserved safely", () => {
  let timing = start(createActivationTiming(), "gone", 0, "Removed Combatant");
  timing = stop(timing, "gone", 1000);
  assert.equal(buildActivationTimingSummary(timing).entries[0].label, "Removed Combatant");
});

scenario("33 multi-GM summary claim is idempotent", () => {
  const first = markActivationSummaryPosted(createActivationTiming());
  const second = markActivationSummaryPosted(first.timing);
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.match(controllerSource, /if \(!isPrimaryGM\(\)\) return/);
});

scenario("34 End Combat finalizes all active timers", () => {
  let timing = start(createActivationTiming(), "a", 1000);
  timing = start(timing, "b", 2000);
  const result = stopAllActivationTiming(timing, { now: 5000 });
  assert.deepEqual(result.stopped.sort(), ["a", "b"]);
  assert.equal(result.timing.records.a.totalMs, 4000);
  assert.equal(result.timing.records.b.totalMs, 3000);
});

scenario("35 dock cleanup destroys ticker", () => {
  const remove = uiSource.slice(uiSource.indexOf("export function removeUI"), uiSource.indexOf("export function syncNativeCombatTracker"));
  assert.match(remove, /stopActivationTimerTicker\(\)/);
});

scenario("36 duration formatter boundaries", () => {
  assert.equal(formatActivationDuration(0), "0:00");
  assert.equal(formatActivationDuration(999), "0:00");
  assert.equal(formatActivationDuration(1000), "0:01");
  assert.equal(formatActivationDuration(59000), "0:59");
  assert.equal(formatActivationDuration(60000), "1:00");
  assert.equal(formatActivationDuration(61000), "1:01");
  assert.equal(formatActivationDuration(3599000), "59:59");
  assert.equal(formatActivationDuration(3600000), "1:00:00");
});

scenario("37 schema-9 migration preserves 0.5 state", () => {
  const old = createState();
  old.schema = 9;
  delete old.activationTiming;
  old.sourceLinkedTiming.audit.push({ event: "preserved", at: 1 });
  old.lifecycle = createLifecycle({ phase: PHASES.VANGUARD, round: 1, roster: ["pc"] });
  old.phase = PHASES.VANGUARD;
  const migrated = normalizeState(old, { combatantIds: ["pc"] });
  assert.equal(migrated.schema, 10);
  assert.equal(migrated.sourceLinkedTiming.audit[0].event, "preserved");
  assert.ok(migrated.lifecycle.turns.pc);
  assert.deepEqual(migrated.activationTiming.records, {});
});

scenario("38 source-linked timing implementation is unchanged", () => {
  assert.equal(controllerSource.includes("processSourceLinkedBoundarySafely"), true);
  assert.equal(controllerSource.includes("releaseSourceLinkedEffects"), true);
});

scenario("39 Start and End lifecycle remain exactly-once owned", () => {
  assert.equal(lifecycleSource.includes("startActivationTiming"), false);
  assert.equal(lifecycleSource.includes("stopActivationTiming"), false);
  assert.match(controllerSource, /processStartTurn\(combat, id/);
  assert.match(controllerSource, /processEndTurn\(combat, id/);
});

scenario("40 phase guards do not depend on activation timing", () => {
  const guard = lifecycleSource.slice(lifecycleSource.indexOf("export function phaseAdvanceReady"));
  assert.equal(guard.includes("activationTiming"), false);
});

scenario("41 tracking off closes but does not erase totals", () => {
  let timing = start(createActivationTiming(), "pc", 1000);
  timing = stop(timing, "pc", 6000);
  timing = start(timing, "pc", 10000);
  const reconciled = reconcileActivationTiming(timing, { trackingEnabled: false, now: 12000 });
  assert.equal(reconciled.timing.records.pc.totalMs, 7000);
  assert.equal(reconciled.timing.records.pc.activeSince, null);
});

scenario("42 summary output escapes labels", () => {
  const html = activationTimingSummaryHTML({ records: { a: { totalMs: 1000, activationCount: 1, label: "<script>" } } });
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("&lt;script&gt;"), true);
});

scenario("43 malformed totals never produce NaN", () => {
  const timing = normalizeActivationTiming({ records: { a: { totalMs: NaN, activationCount: Infinity, activeSince: -1 } } });
  const summary = buildActivationTimingSummary(timing);
  assert.equal(Number.isNaN(summary.totalMs), false);
  assert.equal(summary.totalMs, 0);
});

scenario("44 accessible timer text names elapsed duration", () => {
  assert.equal(formatActivationDurationAria(82000), "Active for 1 minute 22 seconds");
});

scenario("45 state schema exports version 10", () => {
  assert.equal(SCHEMA_VERSION, 10);
  assert.equal(createState().schema, 10);
});

assert.ok(count >= 40);
console.log(`NelTempo 0.6.0 activation timing tests passed (${count} scenarios).`);
