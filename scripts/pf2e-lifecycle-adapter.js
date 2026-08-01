/**
 * Version-sensitive adapter for Pathfinder 2e combatant turn lifecycle.
 *
 * Inspected sources (Foundry V14 + PF2e 8.3.0):
 * - Foundry Combat._manageTurnEvents / _onStartTurn / _onEndTurn
 *   (resources/app/client/data/documents/combat.js)
 * - PF2e EncounterPF2e._onStartTurn / _onEndTurn
 *   (github.com/foundryvtt/pf2e @ pf2e-8.3.0 src/module/encounter/document.ts)
 * - PF2e CombatantPF2e.onStartTurn / onEndTurn
 *   (github.com/foundryvtt/pf2e @ pf2e-8.3.0 src/module/encounter/combatant.ts)
 *
 * Native pathway (PF2e 8.3.0):
 *   Encounter turn change → EncounterPF2e._onStartTurn(combatant, context)
 *     → combatant.onStartTurn()  [rules, recharge round, effects, pf2e.startTurn hook]
 *   Encounter turn change → EncounterPF2e._onEndTurn(combatant, context)
 *     → combatant.onEndTurn({ round })  [conditions incl. persistent damage, effects, pf2e.endTurn]
 *
 * This adapter invokes the combatant methods directly so Dynamic Initiative can
 * process a phase roster without flipping combat.turn between combatants.
 *
 * Do not put Dynamic Initiative state mutation here.
 */

const SUPPORTED_SYSTEM = "pf2e";
const MIN_MAJOR = 6;

/**
 * @typedef {object} LifecycleAdapterResult
 * @property {boolean} ok
 * @property {string|null} combatId
 * @property {string|null} combatantId
 * @property {"start"|"end"} boundary
 * @property {string|null} nativeMethod
 * @property {string|null} reason
 * @property {Error|null} error
 */

function resultBase(boundary, combat, combatant) {
  return {
    ok: false,
    combatId: combat?.id ?? null,
    combatantId: combatant?.id ?? null,
    boundary,
    nativeMethod: null,
    reason: null,
    error: null,
  };
}

export function isSupportedSystem() {
  try {
    if (typeof game === "undefined") return false;
    if (game.system?.id !== SUPPORTED_SYSTEM) return false;
    const version = String(game.system?.version ?? "0");
    const major = Number(version.split(".")[0] || 0);
    return Number.isFinite(major) && major >= MIN_MAJOR;
  } catch (_error) {
    return false;
  }
}

function resolveCombatant(combat, combatantId) {
  if (!combat || !combatantId) return null;
  return (
    combat.combatants?.get?.(combatantId) ??
    combat.combatants?.find?.((c) => c.id === combatantId) ??
    null
  );
}

/**
 * Detect the best available native start-turn method on a combatant.
 * PF2e 8.x: onStartTurn(); older 6.x local builds: startTurn().
 */
export function resolveStartMethod(combatant) {
  if (!combatant) return null;
  if (typeof combatant.onStartTurn === "function") {
    return { name: "onStartTurn", invoke: () => combatant.onStartTurn() };
  }
  if (typeof combatant.startTurn === "function") {
    return { name: "startTurn", invoke: () => combatant.startTurn() };
  }
  return null;
}

/**
 * Detect the best available native end-turn method on a combatant.
 * PF2e 8.x: onEndTurn({ round }); older 6.x: endTurn({ round }).
 */
export function resolveEndMethod(combatant, round) {
  if (!combatant) return null;
  const options = { round: Math.max(1, Number(round || 1) || 1) };
  if (typeof combatant.onEndTurn === "function") {
    return { name: "onEndTurn", invoke: () => combatant.onEndTurn(options) };
  }
  if (typeof combatant.endTurn === "function") {
    return { name: "endTurn", invoke: () => combatant.endTurn(options) };
  }
  return null;
}

/**
 * Whether the combatant is eligible for native lifecycle invocation.
 * Defeated combatants are included: PF2e onEndTurn itself skips conditions when actor.isDead.
 * Missing actors cannot be processed.
 */
export function canProcessCombatant(combatant) {
  if (!combatant) return { ok: false, reason: "missing-combatant" };
  if (!combatant.actor) return { ok: false, reason: "missing-actor" };
  return { ok: true, reason: null };
}

/**
 * Invoke native start-of-turn processing for one combatant.
 * @returns {Promise<LifecycleAdapterResult>}
 */
export async function processStartTurn(combat, combatantId) {
  const combatant = resolveCombatant(combat, combatantId);
  const base = resultBase("start", combat, combatant);

  if (!isSupportedSystem()) {
    return { ...base, reason: "unsupported-system" };
  }
  const eligibility = canProcessCombatant(combatant);
  if (!eligibility.ok) {
    return { ...base, reason: eligibility.reason };
  }

  const method = resolveStartMethod(combatant);
  if (!method) {
    return { ...base, reason: "no-native-start-method" };
  }

  try {
    await method.invoke();
    return {
      ...base,
      ok: true,
      nativeMethod: method.name,
      reason: null,
      error: null,
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      nativeMethod: method.name,
      reason: "native-start-threw",
      error: error instanceof Error ? error : new Error(String(error?.message ?? error)),
    };
  }
}

/**
 * Invoke native end-of-turn processing for one combatant.
 * This is where PF2e runs persistent damage, recovery checks, end-turn effects, etc.
 * @returns {Promise<LifecycleAdapterResult>}
 */
export async function processEndTurn(combat, combatantId, { round } = {}) {
  const combatant = resolveCombatant(combat, combatantId);
  const base = resultBase("end", combat, combatant);
  const effectiveRound = Number(round ?? combat?.round ?? 1) || 1;

  if (!isSupportedSystem()) {
    return { ...base, reason: "unsupported-system" };
  }
  const eligibility = canProcessCombatant(combatant);
  if (!eligibility.ok) {
    return { ...base, reason: eligibility.reason };
  }

  const method = resolveEndMethod(combatant, effectiveRound);
  if (!method) {
    return { ...base, reason: "no-native-end-method" };
  }

  try {
    await method.invoke();
    return {
      ...base,
      ok: true,
      nativeMethod: method.name,
      reason: null,
      error: null,
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      nativeMethod: method.name,
      reason: "native-end-threw",
      error: error instanceof Error ? error : new Error(String(error?.message ?? error)),
    };
  }
}

/**
 * Safe reason strings for diagnostics (no actor/token names).
 */
export function adapterReasonMessage(result) {
  if (!result) return "unknown";
  if (result.ok) return "ok";
  return String(result.reason ?? result.error?.message ?? "failed").slice(0, 120);
}
