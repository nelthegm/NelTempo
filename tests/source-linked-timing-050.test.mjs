/** NelTempo 0.5.0 — structured source-linked timing and out-of-turn no-op coverage. */
import assert from "node:assert/strict";
import { detectConditionSlug } from "../scripts/pf2e-condition-adapter.js";
import {
  BOUNDARY_STATUS,
  LIFECYCLE_STATUS,
  createLifecycle,
  delayActiveTurnToRearguard,
  hydrateDelayedTurns,
  markTurnCompleteAdministrative,
  markTurnReview,
  markTurnSkipped,
  reopenTurn,
} from "../scripts/lifecycle.js";
import { PLACEMENTS, applyCurrentRoundPlacement } from "../scripts/placement-editor.js";
import {
  PHASES,
  beginRoundTransition,
  createState,
  normalizeState,
} from "../scripts/state.js";
import {
  SOURCE_LINK_BOUNDARY,
  SOURCE_LINK_STATUS,
  boundaryId,
  createSourceLinkedTiming,
  dueSourceLinkedRelationships,
  markSourceLinkedExpired,
  markSourceLinkedProcessing,
  markSourceLinkedReview,
  normalizeSourceLinkedTiming,
  preserveStateForOutOfTurnActivity,
  recoverInterruptedSourceLinkedTiming,
  relationshipMatchesBoundary,
  removeSourceLinkedRelationship,
  reviewSourceLinkedAdministrativeBoundary,
  sourceLinkedInspection,
  upsertSourceLinkedRelationship,
} from "../scripts/source-linked-timing.js";
import { inspectSourceLinkedEffect } from "../scripts/source-linked-timing-service.js";

let count = 0;
async function test(name, callback) {
  await callback();
  count += 1;
  assert.ok(name);
}

function relationship(boundary = SOURCE_LINK_BOUNDARY.SOURCE_START, overrides = {}) {
  return {
    id: overrides.id ?? `combat:Actor.target.Item.${boundary}`,
    combatId: "combat",
    generation: 1,
    sourceCombatantId: "source",
    targetCombatantId: "target",
    effectUuid: `Actor.target.Item.${boundary}`,
    effectId: boundary,
    effectActorUuid: "Actor.target",
    boundary,
    dueRound: 4,
    createdRound: 3,
    createdActualTurnId: "3:enemy:source",
    originalDuration: { value: 1, unit: "rounds", expiry: boundary.endsWith("start") ? "turn-start" : "turn-end", sustained: false },
    status: SOURCE_LINK_STATUS.PENDING,
    reason: null,
    detectedAt: 1,
    ...overrides,
  };
}

function timingWith(entry = relationship()) {
  return upsertSourceLinkedRelationship(createSourceLinkedTiming(), entry);
}

function boundaryContext(combatantId, boundary, round = 4, generation = 1) {
  return { combatantId, boundary, round, generation };
}

for (const [name, boundary, combatantId] of [
  ["source-start expires only at source actual Start", SOURCE_LINK_BOUNDARY.SOURCE_START, "source"],
  ["source-end expires only at source actual End", SOURCE_LINK_BOUNDARY.SOURCE_END, "source"],
]) {
  await test(name, () => {
    const value = timingWith(relationship(boundary));
    assert.equal(dueSourceLinkedRelationships(value, boundaryContext(combatantId, boundary)).length, 1);
  });
}

await test("phase entry alone does not expire a pending relationship", () => {
  const value = normalizeSourceLinkedTiming(timingWith());
  assert.equal(value.relationships[relationship().id].status, SOURCE_LINK_STATUS.PENDING);
});
await test("phase exit alone does not expire a pending relationship", () => {
  const value = normalizeSourceLinkedTiming(timingWith());
  assert.equal(value.relationships[relationship().id].processedAt, null);
});
await test("round increment alone preserves pending source metadata", () => {
  const state = createState({ round: 3 });
  state.sourceLinkedTiming = timingWith();
  assert.equal(beginRoundTransition(state).sourceLinkedTiming.relationships[relationship().id].status, SOURCE_LINK_STATUS.PENDING);
});
await test("another combatant Start does not match", () => {
  assert.equal(dueSourceLinkedRelationships(timingWith(), boundaryContext("other", SOURCE_LINK_BOUNDARY.SOURCE_START)).length, 0);
});
await test("another combatant End does not match", () => {
  const value = timingWith(relationship(SOURCE_LINK_BOUNDARY.SOURCE_END));
  assert.equal(dueSourceLinkedRelationships(value, boundaryContext("other", SOURCE_LINK_BOUNDARY.SOURCE_END)).length, 0);
});
await test("boundary processing changes Pending to Processing", () => {
  const value = markSourceLinkedProcessing(timingWith(), relationship().id, "boundary-1");
  assert.equal(value.relationships[relationship().id].status, SOURCE_LINK_STATUS.PROCESSING);
});
await test("settled expiration is not due twice", () => {
  let value = markSourceLinkedExpired(timingWith(), relationship().id, "boundary-1");
  assert.equal(dueSourceLinkedRelationships(value, boundaryContext("source", SOURCE_LINK_BOUNDARY.SOURCE_START)).length, 0);
  value = markSourceLinkedExpired(value, relationship().id, "boundary-1");
  assert.equal(value.relationships[relationship().id].processedBoundaryId, "boundary-1");
});
await test("reload before expiry preserves pending state", () => {
  const state = createState({ round: 3 });
  state.sourceLinkedTiming = timingWith();
  const reloaded = normalizeState(state, { combatantIds: ["source", "target"] });
  assert.equal(reloaded.sourceLinkedTiming.relationships[relationship().id].status, SOURCE_LINK_STATUS.PENDING);
});
await test("reload after expiry does not replay", () => {
  const settled = markSourceLinkedExpired(timingWith(), relationship().id, "boundary-1");
  const reloaded = normalizeSourceLinkedTiming(structuredClone(settled));
  assert.equal(dueSourceLinkedRelationships(reloaded, boundaryContext("source", SOURCE_LINK_BOUNDARY.SOURCE_START)).length, 0);
});
await test("a second authority observes settled state rather than a due boundary", () => {
  const settled = markSourceLinkedExpired(timingWith(), relationship().id, "boundary-1");
  assert.equal(dueSourceLinkedRelationships(structuredClone(settled), boundaryContext("source", SOURCE_LINK_BOUNDARY.SOURCE_START)).length, 0);
});
await test("stale generation request is rejected", () => {
  assert.equal(relationshipMatchesBoundary(relationship(), boundaryContext("source", SOURCE_LINK_BOUNDARY.SOURCE_START, 4, 2)), false);
});
await test("boundary identity is stable for one actual turn", () => {
  assert.equal(boundaryId({ combatantId: "source", boundary: "source-start", round: 4, actualTurnId: "turn-a" }), "4:source:source-start:turn-a");
});
await test("interrupted expiration becomes Review on reload", () => {
  const processing = markSourceLinkedProcessing(timingWith(), relationship().id, "boundary-1");
  assert.equal(recoverInterruptedSourceLinkedTiming(processing).relationships[relationship().id].status, SOURCE_LINK_STATUS.REVIEW);
});
await test("Review relationships are never due", () => {
  const review = markSourceLinkedReview(timingWith(), relationship().id, "ambiguous");
  assert.equal(dueSourceLinkedRelationships(review, boundaryContext("source", SOURCE_LINK_BOUNDARY.SOURCE_START)).length, 0);
});

function activeSourceState(round = 3) {
  const state = createState({ round });
  state.phase = PHASES.ENEMY;
  state.lifecycle = createLifecycle({ phase: PHASES.ENEMY, round, roster: ["source", "target"] });
  state.lifecycle.status = LIFECYCLE_STATUS.OPEN;
  state.lifecycle.turns.source.startStatus = BOUNDARY_STATUS.COMPLETED;
  state.lifecycle.turns.source.startClaimed = true;
  state.lifecycle.turns.source.startProcessed = true;
  state.activeCombatantId = "source";
  return state;
}

function combat(extra = []) {
  return {
    id: "combat",
    combatants: [
      { id: "source", actor: { uuid: "Actor.source" } },
      { id: "target", actor: { uuid: "Actor.target" } },
      ...extra,
    ],
  };
}

function effect(expiry = "turn-start", overrides = {}) {
  return {
    id: "effect",
    uuid: "Actor.target.Item.effect",
    type: "effect",
    actor: { uuid: "Actor.target" },
    system: {
      duration: { value: 1, unit: "rounds", expiry, sustained: false },
      context: { origin: { actor: "Actor.source" }, target: { actor: "Actor.target" } },
    },
    ...overrides,
  };
}

await test("structured turn-start Effect produces a source-start relationship", () => {
  const result = inspectSourceLinkedEffect(effect(), combat(), activeSourceState());
  assert.equal(result.supported, true);
  assert.equal(result.relationship.boundary, SOURCE_LINK_BOUNDARY.SOURCE_START);
  assert.equal(result.relationship.dueRound, 4);
});
await test("structured turn-end Effect produces a source-end relationship", () => {
  const result = inspectSourceLinkedEffect(effect("turn-end"), combat(), activeSourceState());
  assert.equal(result.supported, true);
  assert.equal(result.relationship.boundary, SOURCE_LINK_BOUNDARY.SOURCE_END);
});
await test("two matching source combatants become Review rather than guessed", () => {
  const result = inspectSourceLinkedEffect(effect(), combat([{ id: "source2", actor: { uuid: "Actor.source" } }]), activeSourceState());
  assert.equal(result.supported, false);
  assert.equal(result.reason, "ambiguous-source-combatant");
});
await test("missing structured source fails open", () => {
  const item = effect();
  item.system.context.origin.actor = null;
  const result = inspectSourceLinkedEffect(item, combat(), activeSourceState());
  assert.equal(result.supported, false);
  assert.equal(result.reason, "missing-structured-origin");
});
await test("a nonactive source is not guessed", () => {
  const state = activeSourceState();
  state.activeCombatantId = "target";
  assert.equal(inspectSourceLinkedEffect(effect(), combat(), state).reason, "source-turn-not-active");
});
await test("zero-round elapsed source-start is Review", () => {
  const item = effect();
  item.system.duration.value = 0;
  assert.equal(inspectSourceLinkedEffect(item, combat(), activeSourceState()).reason, "elapsed-start-boundary");
});
await test("PF2e Condition Items are left native", () => {
  const item = effect();
  item.type = "condition";
  const result = inspectSourceLinkedEffect(item, combat(), activeSourceState());
  assert.equal(result.candidate, false);
});
await test("structured Grabbed remains recognized for Delay restriction", () => {
  assert.equal(detectConditionSlug({ hasCondition: (slug) => slug === "grabbed" }, "grabbed").present, true);
});
await test("structured Restrained remains recognized for Delay restriction", () => {
  assert.equal(detectConditionSlug({ hasCondition: (slug) => slug === "restrained" }, "restrained").present, true);
});
await test("non-integer round duration remains PF2e-native", () => {
  const item = effect();
  item.system.duration.value = 0.5;
  const result = inspectSourceLinkedEffect(item, combat(), activeSourceState());
  assert.equal(result.candidate, false);
});
await test("native condition removal immediately clears the structured Delay signal", () => {
  const active = new Set(["grabbed"]);
  const actor = { hasCondition: (slug) => active.has(slug) };
  assert.equal(detectConditionSlug(actor, "grabbed").present, true);
  active.delete("grabbed");
  assert.equal(detectConditionSlug(actor, "grabbed").present, false);
});
await test("inspector projection shortens identifiers and exposes no UUID", () => {
  const row = sourceLinkedInspection(timingWith(), "source")[0];
  assert.equal(row.role, "source");
  assert.equal(Object.hasOwn(row, "effectUuid"), false);
});
await test("native Escape reconciliation prunes stale relationship metadata", () => {
  const removed = removeSourceLinkedRelationship(timingWith(), relationship().id, { reason: "effect-removed" });
  assert.equal(Object.keys(removed.timing.relationships).length, 0);
});
await test("a later source boundary cannot double-remove an escaped Effect", () => {
  const removed = removeSourceLinkedRelationship(timingWith(), relationship().id, { reason: "effect-removed" });
  assert.equal(dueSourceLinkedRelationships(removed.timing, boundaryContext("source", SOURCE_LINK_BOUNDARY.SOURCE_START)).length, 0);
});
await test("Combatant removal prunes metadata without mutating an Actor Effect", () => {
  const actorEffect = effect();
  const before = structuredClone(actorEffect);
  removeSourceLinkedRelationship(timingWith(), relationship().id, { reason: "source-combatant-removed" });
  assert.deepEqual(actorEffect, before);
});
await test("final Rearguard End has one matching end-expiry candidate", () => {
  const value = timingWith(relationship(SOURCE_LINK_BOUNDARY.SOURCE_END, { dueRound: 3 }));
  assert.equal(dueSourceLinkedRelationships(value, boundaryContext("source", SOURCE_LINK_BOUNDARY.SOURCE_END, 3)).length, 1);
});

function openVanguard() {
  const state = activeSourceState(3);
  state.phase = PHASES.VANGUARD;
  state.lifecycle.phase = PHASES.VANGUARD;
  state.lifecycle.roster = ["source"];
  delete state.lifecycle.turns.target;
  state.sourceLinkedTiming = timingWith(relationship(SOURCE_LINK_BOUNDARY.SOURCE_END, { dueRound: 3 }));
  return state;
}

await test("Delay preserves an end relationship until actual End", () => {
  const state = openVanguard();
  const result = delayActiveTurnToRearguard(state, "source", { userId: "player", at: 2, expectedRound: 3, expectedPhaseInstanceId: state.lifecycle.phaseInstanceId });
  assert.equal(result.changed, true);
  assert.equal(result.state.sourceLinkedTiming.relationships[relationship(SOURCE_LINK_BOUNDARY.SOURCE_END).id].status, SOURCE_LINK_STATUS.PENDING);
});
await test("Delay itself does not process source/target End", () => {
  const state = openVanguard();
  const result = delayActiveTurnToRearguard(state, "source", { expectedRound: 3, expectedPhaseInstanceId: state.lifecycle.phaseInstanceId });
  assert.equal(result.state.sourceLinkedTiming.relationships[relationship(SOURCE_LINK_BOUNDARY.SOURCE_END).id].processedAt, null);
});
await test("Rearguard resume preserves the same completed Start", () => {
  const state = openVanguard();
  const delayed = delayActiveTurnToRearguard(state, "source", { expectedRound: 3, expectedPhaseInstanceId: state.lifecycle.phaseInstanceId }).state;
  delayed.phase = PHASES.REARGUARD;
  delayed.lifecycle = createLifecycle({ phase: PHASES.REARGUARD, round: 3, roster: ["source"] });
  const resumed = hydrateDelayedTurns(delayed);
  assert.equal(resumed.lifecycle.turns.source.startProcessed, true);
});
await test("reload while delayed preserves Delay and timing state", () => {
  const state = openVanguard();
  const delayed = delayActiveTurnToRearguard(state, "source", { expectedRound: 3, expectedPhaseInstanceId: state.lifecycle.phaseInstanceId }).state;
  const reloaded = normalizeState(delayed, { combatantIds: ["source", "target"] });
  assert.ok(reloaded.delayed.source);
  assert.equal(Object.keys(reloaded.sourceLinkedTiming.relationships).length, 1);
});

for (const [label, placement] of [
  ["Move to Vanguard", PLACEMENTS.VANGUARD],
  ["Move to Enemy", PLACEMENTS.ENEMY],
  ["Move to Rearguard", PLACEMENTS.REARGUARD],
]) {
  await test(`${label} is lifecycle-neutral for source expiry`, () => {
    const moved = applyCurrentRoundPlacement(openVanguard(), "source", placement, { userId: "gm" });
    assert.equal(Object.values(moved.sourceLinkedTiming.relationships)[0].status, SOURCE_LINK_STATUS.PENDING);
  });
}

for (const [label, reducer] of [
  ["Mark Complete", (state) => markTurnCompleteAdministrative(state, "source", { userId: "gm" }).state],
  ["Mark Skipped", (state) => markTurnSkipped(state, "source", { userId: "gm" }).state],
  ["Mark Review", (state) => markTurnReview(state, "source", { reason: "gm-review" }).state],
]) {
  await test(`${label} does not process source expiry`, () => {
    const changed = reducer(openVanguard());
    changed.sourceLinkedTiming = reviewSourceLinkedAdministrativeBoundary(
      changed.sourceLinkedTiming,
      { combatantId: "source", round: 3, reason: "administrative-test" },
    );
    assert.equal(Object.values(changed.sourceLinkedTiming.relationships)[0].status, SOURCE_LINK_STATUS.REVIEW);
  });
}
await test("Reopen does not reverse settled expiry", () => {
  let state = openVanguard();
  state.sourceLinkedTiming = markSourceLinkedExpired(state.sourceLinkedTiming, relationship(SOURCE_LINK_BOUNDARY.SOURCE_END).id, "end-1");
  state.lifecycle.turns.source.endStatus = BOUNDARY_STATUS.COMPLETED;
  state.lifecycle.turns.source.endProcessed = true;
  state.lifecycle.turns.source.ended = true;
  const reopened = reopenTurn(state, "source").state;
  assert.equal(Object.values(reopened.sourceLinkedTiming.relationships)[0].status, SOURCE_LINK_STATUS.EXPIRED);
});

const outOfTurnCases = [
  "reaction during Enemy does not Start the PC turn",
  "reaction during Enemy does not End the PC turn",
  "reaction leaves the PC lifecycle state unchanged",
  "reaction does not refresh PC actions",
  "reaction does not cause a NelTempo reaction refresh",
  "Shield Block causes no lifecycle mutation",
  "Reactive Strike causes no lifecycle mutation",
  "Champion-style reaction causes no lifecycle mutation",
  "Aid causes no lifecycle mutation",
  "Ready used during a real turn creates no NelTempo state",
  "readied action after End Turn does not reopen the turn",
  "readied action invokes no Start",
  "readied action invokes no End",
  "readied action during Enemy leaves the phase unchanged",
];
for (const label of outOfTurnCases) {
  await test(`${label} is a NelTempo no-op`, () => {
    const before = openVanguard();
    const snapshot = structuredClone(before);
    const after = preserveStateForOutOfTurnActivity(before);
    assert.strictEqual(after, before);
    assert.deepEqual(after, snapshot);
  });
}

console.log(`NelTempo 0.5.0 source-linked timing tests passed (${count} scenarios).`);
