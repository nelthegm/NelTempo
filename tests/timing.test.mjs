import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODULE_ID, MODULE_TITLE, REQUESTS, SETTINGS, SOCKET_NAME } from "../scripts/constants.js";
import {
  LIFECYCLE_STATUS,
  attachLifecycle,
  createLifecycle,
  markTurnEnded,
  normalizeLifecycle,
  reopenTurn,
} from "../scripts/lifecycle.js";
import {
  CONDITION_SLUGS,
  detectConditionSlug,
  isTrackedConditionItem,
  readTrackedConditions,
  toSerializableResult,
} from "../scripts/pf2e-condition-adapter.js";
import { PHASES, createState, delayToRearguard, normalizeState } from "../scripts/state.js";
import {
  DELAY_BLOCK,
  TIMING_OVERRIDE,
  applyConditionFlags,
  buildConfusedPriorityOrder,
  clearTimingOverride,
  consumeTimingOverride,
  createTiming,
  delayBlockReasonFromConditions,
  emptyCombatantTiming,
  ensureTiming,
  evaluateDelayEligibility,
  evaluateEndTurnEligibility,
  evaluateReopenEligibility,
  grantTimingOverride,
  markPriorityResolved,
  normalizeTiming,
  onTurnEndedTiming,
  onTurnReopenedTiming,
  pushTimingAudit,
  recomputePriorityGate,
  timingBadgeFor,
  upsertCombatantConditions,
} from "../scripts/timing.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const moduleJson = JSON.parse(readFileSync(join(root, "module.json"), "utf8"));
const en = JSON.parse(readFileSync(join(root, "lang/en.json"), "utf8"));

// --- Branding ---
assert.equal(moduleJson.title, "NelTempo");
assert.equal(moduleJson.id, "nel-dynamic-initiative");
assert.equal(moduleJson.version, "0.3.1");
assert.equal(MODULE_TITLE, "NelTempo");
assert.equal(MODULE_ID, "nel-dynamic-initiative");
assert.equal(SOCKET_NAME, "module.nel-dynamic-initiative");
assert.equal(SETTINGS.ENFORCE_CONDITION_TIMING, "enforceConditionTiming");
assert.equal(en["NDI.Title"], "NelTempo");

// Flag / settings / socket namespaces unchanged
assert.equal(MODULE_ID, "nel-dynamic-initiative");
assert.match(SOCKET_NAME, /^module\.nel-dynamic-initiative$/);

// --- Condition adapter (mocked actors) ---
function mockActor(slugs = [], { useHasCondition = true } = {}) {
  const set = new Set(slugs);
  const actor = {
    id: "actor1",
    hasCondition: useHasCondition
      ? (...args) => args.some((s) => set.has(s))
      : undefined,
    conditions: {
      hasType: (slug) => set.has(slug),
      filter: (fn) =>
        [...set].map((slug) => ({ key: slug, slug, active: true })).filter(fn),
    },
    getCondition: (slug) => (set.has(slug) ? { slug, active: true } : null),
    itemTypes: {
      condition: [...set].map((slug) => ({ type: "condition", slug, system: { slug }, active: true })),
    },
  };
  return actor;
}

// Force supported system for adapter unit tests
globalThis.game = { system: { id: "pf2e", version: "8.3.0" } };

const grabbed = readTrackedConditions(mockActor(["grabbed"]));
assert.equal(grabbed.ok, true);
assert.equal(grabbed.conditions.grabbed, true);
assert.equal(grabbed.conditions.restrained, false);
assert.equal(grabbed.method, "hasCondition");

const restrained = readTrackedConditions(mockActor(["restrained"]));
assert.equal(restrained.conditions.restrained, true);

const confused = readTrackedConditions(mockActor(["confused"]));
assert.equal(confused.conditions.confused, true);

// Does not parse descriptions / match names
const named = mockActor([]);
named.name = "Grabbed Goblin";
named.items = [{ name: "Confused", type: "feat" }];
const noParse = readTrackedConditions(named);
assert.equal(noParse.conditions.grabbed, false);
assert.equal(noParse.conditions.confused, false);

// Unknown API fails open
delete globalThis.game;
const failOpen = readTrackedConditions(mockActor(["grabbed"]));
assert.equal(failOpen.ok, false);
assert.equal(failOpen.conditions.grabbed, false);
globalThis.game = { system: { id: "pf2e", version: "8.3.0" } };

const serial = toSerializableResult(grabbed);
assert.equal(typeof JSON.stringify(serial), "string");
assert.ok(!("name" in serial));

assert.equal(isTrackedConditionItem({ type: "condition", system: { slug: "grabbed" } }), true);
assert.equal(isTrackedConditionItem({ type: "condition", system: { slug: "prone" } }), false);
assert.equal(isTrackedConditionItem({ type: "weapon", system: { slug: "grabbed" } }), false);

const slugDetect = detectConditionSlug(mockActor(["grabbed"]), CONDITION_SLUGS.GRABBED);
assert.equal(slugDetect.present, true);

// --- Delay block priority ---
assert.equal(delayBlockReasonFromConditions({ grabbed: true, restrained: true, confused: true }), DELAY_BLOCK.CONFUSED);
assert.equal(delayBlockReasonFromConditions({ grabbed: true, restrained: true }), DELAY_BLOCK.RESTRAINED);
assert.equal(delayBlockReasonFromConditions({ grabbed: true }), DELAY_BLOCK.GRABBED);

// --- Timing state model ---
let lc = createLifecycle({
  phase: PHASES.VANGUARD,
  round: 1,
  roster: ["pcA", "pcB", "pcC"],
  phaseInstanceId: "phase-1",
});
assert.ok(lc.timing);
assert.equal(lc.timing.phaseInstanceId, "phase-1");

lc.status = LIFECYCLE_STATUS.OPEN;
lc.timing = ensureTiming(lc);

lc.timing = upsertCombatantConditions(lc.timing, "pcA", { grabbed: true, restrained: false, confused: false });
lc.timing = upsertCombatantConditions(lc.timing, "pcB", { grabbed: false, restrained: true, confused: false });
lc.timing = upsertCombatantConditions(lc.timing, "pcC", { grabbed: false, restrained: false, confused: true });
lc.timing = recomputePriorityGate(lc.timing, lc);

assert.equal(lc.timing.combatants.pcA.delayBlocked, true);
assert.equal(lc.timing.combatants.pcA.delayBlockReason, DELAY_BLOCK.GRABBED);
assert.equal(lc.timing.combatants.pcB.delayBlockReason, DELAY_BLOCK.RESTRAINED);
assert.equal(lc.timing.combatants.pcC.delayBlockReason, DELAY_BLOCK.CONFUSED);
assert.equal(lc.timing.priorityGate.active, true);
assert.deepEqual(lc.timing.priorityGate.unresolvedCombatantIds, ["pcC"]);

// Both grabbed+restrained → restrained display
let both = applyConditionFlags(emptyCombatantTiming(), { grabbed: true, restrained: true, confused: false });
assert.equal(both.delayBlockReason, DELAY_BLOCK.RESTRAINED);

// Confused display priority over restrained/grabbed
both = applyConditionFlags(emptyCombatantTiming(), { grabbed: true, restrained: true, confused: true });
assert.equal(both.delayBlockReason, DELAY_BLOCK.CONFUSED);

// --- Grabbed/Restrained delay eligibility ---
let delayEval = evaluateDelayEligibility(lc, "pcA", { enforce: true });
assert.equal(delayEval.allowed, false);
assert.equal(delayEval.reason, "delay-blocked-grabbed");

delayEval = evaluateDelayEligibility(lc, "pcB", { enforce: true });
assert.equal(delayEval.allowed, false);
assert.equal(delayEval.reason, "delay-blocked-restrained");

delayEval = evaluateDelayEligibility(lc, "pcC", { enforce: true });
assert.equal(delayEval.allowed, false);
assert.equal(delayEval.reason, "delay-blocked-confused");

// Condition removal restores Delay
lc.timing = upsertCombatantConditions(lc.timing, "pcA", { grabbed: false, restrained: false, confused: false });
delayEval = evaluateDelayEligibility(lc, "pcA", { enforce: true });
assert.equal(delayEval.allowed, true);

// Mid-phase addition blocks future Delay
lc.timing = upsertCombatantConditions(lc.timing, "pcA", { grabbed: true, restrained: false, confused: false });
assert.equal(evaluateDelayEligibility(lc, "pcA", { enforce: true }).allowed, false);

// After End Turn, condition add does not reopen
let state = attachLifecycle(createState({ round: 1 }), lc);
state.phase = PHASES.VANGUARD;
state = markTurnEnded(state, "pcA").state;
lc = state.lifecycle;
lc.timing = upsertCombatantConditions(lc.timing, "pcA", { grabbed: true }, { ended: true });
assert.equal(lc.turns.pcA.ended, true);
assert.equal(lc.timing.combatants.pcA.priorityRequired, false);

// --- Confused priority ---
lc = createLifecycle({
  phase: PHASES.VANGUARD,
  round: 1,
  roster: ["fast", "confusedB", "confusedA", "normal"],
  phaseInstanceId: "phase-2",
});
lc.status = LIFECYCLE_STATUS.OPEN;
lc.timing = createTiming({ phaseInstanceId: "phase-2" });
lc.timing = upsertCombatantConditions(lc.timing, "confusedB", { confused: true });
lc.timing = upsertCombatantConditions(lc.timing, "confusedA", { confused: true });
lc.timing = upsertCombatantConditions(lc.timing, "normal", {});
lc.timing = upsertCombatantConditions(lc.timing, "fast", {});
lc.timing = recomputePriorityGate(lc.timing, lc);

// Roster order: confusedB before confusedA
assert.deepEqual(lc.timing.priorityGate.unresolvedCombatantIds, ["confusedB", "confusedA"]);
assert.equal(buildConfusedPriorityOrder(lc.roster, lc.timing.combatants, lc.turns)[0], "confusedB");

// Deterministic repeat
assert.deepEqual(
  buildConfusedPriorityOrder(lc.roster, lc.timing.combatants, lc.turns),
  buildConfusedPriorityOrder(lc.roster, lc.timing.combatants, lc.turns),
);

assert.equal(evaluateEndTurnEligibility(lc, "confusedB", { enforce: true }).allowed, true);
assert.equal(evaluateEndTurnEligibility(lc, "confusedA", { enforce: true }).allowed, false);
assert.equal(evaluateEndTurnEligibility(lc, "normal", { enforce: true }).reason, "waiting-for-confused");
assert.equal(evaluateEndTurnEligibility(lc, "fast", { enforce: true }).allowed, false);

// First may end; advance priority
state = attachLifecycle(createState({ round: 1 }), lc);
state.phase = PHASES.VANGUARD;
const ended1 = markTurnEnded(state, "confusedB");
assert.equal(ended1.changed, true);
let nextLc = ended1.state.lifecycle;
nextLc.timing = onTurnEndedTiming(nextLc.timing, nextLc, "confusedB");
assert.deepEqual(nextLc.timing.priorityGate.unresolvedCombatantIds, ["confusedA"]);
assert.equal(evaluateEndTurnEligibility(nextLc, "confusedA", { enforce: true }).allowed, true);

// Duplicate end does not advance twice
const endedDup = markTurnEnded(ended1.state, "confusedB");
assert.equal(endedDup.changed, false);

// Resolve second → gate clears
const ended2 = markTurnEnded(ended1.state, "confusedA");
nextLc = ended2.state.lifecycle;
nextLc.timing = onTurnEndedTiming(nextLc.timing, nextLc, "confusedA");
assert.equal(nextLc.timing.priorityGate.active, false);
assert.equal(evaluateEndTurnEligibility(nextLc, "normal", { enforce: true }).allowed, true);

// Confused removal before resolution updates priority
lc = createLifecycle({
  phase: PHASES.VANGUARD,
  round: 1,
  roster: ["c1", "n1"],
  phaseInstanceId: "phase-3",
});
lc.status = LIFECYCLE_STATUS.OPEN;
lc.timing = createTiming({ phaseInstanceId: "phase-3" });
lc.timing = upsertCombatantConditions(lc.timing, "c1", { confused: true });
lc.timing = recomputePriorityGate(lc.timing, lc);
assert.equal(lc.timing.priorityGate.active, true);
lc.timing = upsertCombatantConditions(lc.timing, "c1", { confused: false });
lc.timing = recomputePriorityGate(lc.timing, lc);
assert.equal(lc.timing.priorityGate.active, false);

// Confused add mid-phase inserts priority
lc.timing = upsertCombatantConditions(lc.timing, "n1", { confused: true });
lc.timing = recomputePriorityGate(lc.timing, lc);
assert.deepEqual(lc.timing.priorityGate.unresolvedCombatantIds, ["n1"]);

// Confused after end does not insert
lc.turns.c1.ended = true;
lc.timing = upsertCombatantConditions(lc.timing, "c1", { confused: true }, { ended: true });
lc.timing = recomputePriorityGate(lc.timing, lc);
assert.equal(lc.timing.priorityGate.unresolvedCombatantIds.includes("c1"), false);

// Timing changes do not create new phaseInstanceId
const beforeId = lc.phaseInstanceId;
lc.timing = upsertCombatantConditions(lc.timing, "n1", { grabbed: true });
assert.equal(lc.phaseInstanceId, beforeId);

// --- Reopen ---
lc = createLifecycle({
  phase: PHASES.VANGUARD,
  round: 1,
  roster: ["conf", "other"],
  phaseInstanceId: "phase-4",
});
lc.status = LIFECYCLE_STATUS.OPEN;
lc.timing = createTiming({ phaseInstanceId: "phase-4" });
lc.timing = upsertCombatantConditions(lc.timing, "conf", { confused: true });
lc.timing = upsertCombatantConditions(lc.timing, "other", {});
state = attachLifecycle(createState({ round: 1 }), lc);
state.phase = PHASES.VANGUARD;
state = markTurnEnded(state, "conf").state;
state.lifecycle.timing = onTurnEndedTiming(state.lifecycle.timing, state.lifecycle, "conf");
assert.equal(state.lifecycle.status, LIFECYCLE_STATUS.OPEN);

const playerReopen = evaluateReopenEligibility(state.lifecycle, "conf", { isGM: false, enforce: true });
assert.equal(playerReopen.allowed, false);
assert.equal(playerReopen.reason, "confused-reopen-rejected");

const gmReopen = evaluateReopenEligibility(state.lifecycle, "conf", { isGM: true, enforce: true });
assert.equal(gmReopen.allowed, true);
assert.equal(gmReopen.requiresOverride, true);

const reopened = reopenTurn(state, "conf");
assert.equal(reopened.changed, true);
reopened.state.lifecycle.timing = onTurnReopenedTiming(
  reopened.state.lifecycle.timing,
  reopened.state.lifecycle,
  "conf",
);
assert.equal(reopened.state.lifecycle.timing.priorityGate.active, true);
assert.equal(reopened.state.lifecycle.turns.conf.ended, false);

// --- Overrides ---
lc = createLifecycle({
  phase: PHASES.VANGUARD,
  round: 1,
  roster: ["pcX"],
  phaseInstanceId: "phase-5",
});
lc.status = LIFECYCLE_STATUS.OPEN;
lc.timing = createTiming({ phaseInstanceId: "phase-5" });
lc.timing = upsertCombatantConditions(lc.timing, "pcX", { restrained: true });
lc.timing = grantTimingOverride(lc.timing, "pcX", TIMING_OVERRIDE.ALLOW_DELAY_ONCE, {
  grantedBy: "gm1",
});
assert.equal(evaluateDelayEligibility(lc, "pcX", { enforce: true }).allowed, true);
assert.equal(evaluateDelayEligibility(lc, "pcX", { enforce: true }).overrideType, TIMING_OVERRIDE.ALLOW_DELAY_ONCE);

const consumed = consumeTimingOverride(lc.timing, "pcX", TIMING_OVERRIDE.ALLOW_DELAY_ONCE);
assert.equal(consumed.consumed, true);
lc.timing = consumed.timing;
assert.equal(evaluateDelayEligibility(lc, "pcX", { enforce: true }).allowed, false);

// Consumed cannot be reused
const consumed2 = consumeTimingOverride(lc.timing, "pcX", TIMING_OVERRIDE.ALLOW_DELAY_ONCE);
assert.equal(consumed2.consumed, false);

// Unused override survives normalize / reload shape
lc.timing = grantTimingOverride(lc.timing, "pcX", TIMING_OVERRIDE.ALLOW_DELAY_ONCE, { grantedBy: "gm1" });
const normalized = normalizeLifecycle(lc, { combatantIds: ["pcX"] });
assert.equal(normalized.timing.combatants.pcX.gmOverride.type, TIMING_OVERRIDE.ALLOW_DELAY_ONCE);
assert.equal(normalized.timing.combatants.pcX.gmOverride.consumed, false);

// Clear override
lc.timing = clearTimingOverride(lc.timing, "pcX");
assert.equal(lc.timing.combatants.pcX.gmOverride, null);

// Resume once
lc.timing = upsertCombatantConditions(lc.timing, "pcX", { confused: false });
lc.roster = ["conf2", "pcX"];
lc.turns.conf2 = { ...lc.turns.pcX, ended: false };
lc.timing = upsertCombatantConditions(lc.timing, "conf2", { confused: true });
lc.timing = recomputePriorityGate(lc.timing, lc);
assert.equal(evaluateEndTurnEligibility(lc, "pcX", { enforce: true }).allowed, false);
lc.timing = grantTimingOverride(lc.timing, "pcX", TIMING_OVERRIDE.RESUME_CURRENT_ONCE, {
  grantedBy: "gm1",
});
assert.equal(evaluateEndTurnEligibility(lc, "pcX", { enforce: true }).allowed, true);

// --- Lifecycle gating ---
lc.status = LIFECYCLE_STATUS.STARTING;
assert.equal(evaluateDelayEligibility(lc, "pcX", { enforce: true }).reason, "lifecycle-not-open");
lc.status = LIFECYCLE_STATUS.ENDING;
assert.equal(evaluateEndTurnEligibility(lc, "pcX", { enforce: true }).reason, "lifecycle-not-open");
lc.status = LIFECYCLE_STATUS.OPEN;

// Enforce off
assert.equal(evaluateDelayEligibility(lc, "pcX", { enforce: false }).allowed, true);
assert.equal(evaluateEndTurnEligibility(lc, "conf2", { enforce: false }).allowed, true);

// --- Normalize / prune / serializable ---
lc.timing.combatants.stale = emptyCombatantTiming();
const pruned = normalizeTiming(lc.timing, {
  combatantIds: ["pcX", "conf2"],
  phaseInstanceId: "phase-5",
});
assert.equal(pruned.combatants.stale, undefined);
assert.ok(pruned.combatants.pcX);

// Wrong phaseInstanceId resets
const reset = normalizeTiming(lc.timing, {
  combatantIds: ["pcX"],
  phaseInstanceId: "other-phase",
});
assert.equal(reset.phaseInstanceId, "other-phase");
assert.deepEqual(reset.combatants, {});

// Persist through normalizeState — no Actor/Item/names
state = createState({ round: 1 });
state.phase = PHASES.VANGUARD;
state.lifecycle = createLifecycle({
  phase: PHASES.VANGUARD,
  round: 1,
  roster: ["pc1"],
  phaseInstanceId: "persist-1",
});
state.lifecycle.status = LIFECYCLE_STATUS.OPEN;
state.lifecycle.timing = upsertCombatantConditions(
  state.lifecycle.timing,
  "pc1",
  { grabbed: true },
);
const persisted = normalizeState(state, { combatantIds: ["pc1"] });
assert.equal(persisted.lifecycle.timing.combatants.pc1.grabbed, true);
const json = JSON.stringify(persisted);
assert.ok(!json.includes("Actor"));
assert.ok(!/"name"\s*:/.test(JSON.stringify(persisted.lifecycle.timing)));
JSON.parse(json); // serializable

// Delay path unchanged when allowed (pure state helper)
state = createState({ round: 1 });
state.phase = PHASES.VANGUARD;
state.results.pc1 = { total: 20, skill: "perception", label: "Perception", phase: PHASES.VANGUARD, round: 1, at: 1 };
const delayed = delayToRearguard(state, "pc1");
assert.equal(delayed.delayed.pc1, true);
assert.equal(delayed.results.pc1.phase, PHASES.REARGUARD);

// Badges
lc = createLifecycle({
  phase: PHASES.VANGUARD,
  round: 1,
  roster: ["p1", "p2"],
  phaseInstanceId: "badge-1",
});
lc.status = LIFECYCLE_STATUS.OPEN;
lc.timing = createTiming({ phaseInstanceId: "badge-1" });
lc.timing = upsertCombatantConditions(lc.timing, "p1", { confused: true });
lc.timing = upsertCombatantConditions(lc.timing, "p2", {});
lc.timing = recomputePriorityGate(lc.timing, lc);
assert.equal(timingBadgeFor(lc, "p1", { enforce: true }), "must-act-first");
assert.equal(timingBadgeFor(lc, "p2", { enforce: true }), "waiting-confused");

lc.timing = upsertCombatantConditions(lc.timing, "p2", { grabbed: true });
lc.timing = recomputePriorityGate(lc.timing, lc);
// waiting for confused still wins for non-confused while gate active
assert.equal(timingBadgeFor(lc, "p2", { enforce: true }), "waiting-confused");

// Audit push capped / safe
lc.timing = pushTimingAudit(lc.timing, "delay-blocked-grabbed", {
  combatantId: "p2",
  actorName: "SHOULD_NOT_APPEAR",
  phaseInstanceId: "badge-1",
});
assert.ok(lc.timing.audit.at(-1).event === "delay-blocked-grabbed");
assert.equal(lc.timing.audit.at(-1).actorName, undefined);

// Request constants present
assert.ok(REQUESTS.TIMING_ALLOW_DELAY_ONCE);
assert.ok(REQUESTS.TIMING_REOPEN_CONFUSED);
assert.ok(REQUESTS.TIMING_RESUME_CURRENT_ONCE);

// Localization keys present
for (const key of [
  "NDI.Timing.MustActFirst",
  "NDI.Timing.WaitingConfused",
  "NDI.Timing.DelayBlockedGrabbed",
  "NDI.Timing.DelayBlockedRestrained",
  "NDI.Timing.DelayBlockedConfused",
  "NDI.Timing.CannotDelayGrabbed",
  "NDI.Timing.CannotDelayRestrained",
  "NDI.Timing.CannotDelayConfused",
  "NDI.Timing.AllowDelayOnce",
  "NDI.Timing.ResolvePriority",
  "NDI.Timing.SkipPriority",
  "NDI.Timing.ReopenConfusedTurn",
  "NDI.Timing.ResumeCurrentOnce",
  "NDI.Timing.ClearOverride",
  "NDI.Setting.EnforceConditionTiming.Name",
]) {
  assert.ok(en[key], `missing locale ${key}`);
}

// Adapter source does not parse descriptions
const adapterSrc = readFileSync(join(root, "scripts/pf2e-condition-adapter.js"), "utf8");
assert.equal(/description/i.test(adapterSrc) && /innerHTML|textContent|parse.*description/.test(adapterSrc), false);
assert.ok(adapterSrc.includes("hasCondition"));
assert.ok(adapterSrc.includes("grabbed"));
assert.ok(adapterSrc.includes("restrained"));
assert.ok(adapterSrc.includes("confused"));

// No monkey-patch of PF2e classes in timing modules
const timingSrc = readFileSync(join(root, "scripts/timing.js"), "utf8");
assert.equal(timingSrc.includes("prototype"), false);

// --- Slice 0.2.2 UI layering and Delay badge cleanup ---
const cssSrc = readFileSync(join(root, "styles/dynamic-initiative.css"), "utf8");
assert.ok(cssSrc.includes("--ndi-interface-z"));
assert.ok(cssSrc.includes("--z-index-app"));
assert.ok(cssSrc.includes("var(--ndi-interface-z)"));
assert.equal(/#ndi-dock\s*\{[^}]*z-index:\s*110\b/s.test(cssSrc), false);
assert.equal(/#ndi-launcher\s*\{[^}]*z-index:\s*109\b/s.test(cssSrc), false);
assert.equal(/z-index:\s*110\b/.test(cssSrc), false);
assert.equal(/z-index:\s*109\b/.test(cssSrc), false);
assert.equal(/z-index:\s*10000\b/.test(cssSrc), false);

const uiSrc = readFileSync(join(root, "scripts/ui.js"), "utf8");
assert.ok(uiSrc.includes("isPortraitOverlayBadge"));
assert.ok(uiSrc.includes("CannotDelayGrabbed"));
assert.ok(uiSrc.includes("CannotDelayRestrained"));
assert.ok(uiSrc.includes("CannotDelayConfused"));
assert.ok(uiSrc.includes("aria-disabled"));
assert.equal(/\.bringToFront\s*\(/.test(uiSrc), false);
assert.equal(/foundry\.applications\.api\.ApplicationV2/.test(uiSrc), false);
assert.equal(/style\.zIndex\s*=/.test(uiSrc), false);
// Delay-blocked overlay keys are filtered from portrait badges
assert.match(uiSrc, /isPortraitOverlayBadge\(badgeKey\)/);
assert.match(uiSrc, /isPortraitOverlayBadge\(badge\)/);

// timingBadgeFor still reports delay-blocked for state/tests
lc = createLifecycle({
  phase: PHASES.VANGUARD,
  round: 1,
  roster: ["blockedOnly"],
  phaseInstanceId: "badge-delay",
});
lc.status = LIFECYCLE_STATUS.OPEN;
lc.timing = createTiming({ phaseInstanceId: "badge-delay" });
lc.timing = upsertCombatantConditions(lc.timing, "blockedOnly", { grabbed: true });
lc.timing = recomputePriorityGate(lc.timing, lc);
assert.equal(timingBadgeFor(lc, "blockedOnly", { enforce: true }), "delay-blocked-grabbed");
assert.equal(evaluateDelayEligibility(lc, "blockedOnly", { enforce: true }).allowed, false);
assert.equal(evaluateDelayEligibility(lc, "blockedOnly", { enforce: true }).blockReason, "grabbed");

// Locale strings retained for tooltips / rejection
assert.ok(en["NDI.Timing.DelayBlockedGrabbed"]);
assert.ok(en["NDI.Timing.CannotDelayGrabbed"]);
assert.ok(en["NDI.Timing.MustActFirst"]);
assert.ok(en["NDI.Timing.WaitingConfused"]);

const controllerSrc = readFileSync(join(root, "scripts/controller.js"), "utf8");
assert.ok(controllerSrc.includes("CannotDelayGrabbed"));
assert.equal(controllerSrc.includes("bringToFront"), false);
assert.equal(/ApplicationV2\.prototype|Application\.prototype/.test(controllerSrc), false);

console.log("NelTempo timing tests passed.");
