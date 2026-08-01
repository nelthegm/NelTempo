/**
 * Version-sensitive adapter for Pathfinder 2e condition detection.
 *
 * Inspected sources (Foundry V14 + PF2e 8.3.0):
 * - ActorPF2e.hasCondition(...slugs) → this.conditions.hasType(s)
 *   (github.com/foundryvtt/pf2e @ pf2e-8.3.0 src/module/actor/base.ts)
 * - ActorPF2e.getCondition(slug) → conditions filtered by key/slug, prefers active
 * - ActorPF2e.itemTypes.condition / ActorConditions collection
 * - Condition slugs: grabbed, restrained, confused (CONDITION_SLUGS)
 *
 * Conditions in PF2e 8.x are embedded Item documents of type "condition".
 * This adapter uses structured slug APIs only — never description text or names.
 *
 * Fail-open: when the system or API cannot be determined safely, returns ok:false
 * with all condition flags false so NelTempo does not invent restrictions.
 */

const SUPPORTED_SYSTEM = "pf2e";
const MIN_MAJOR = 6;

export const CONDITION_SLUGS = Object.freeze({
  GRABBED: "grabbed",
  RESTRAINED: "restrained",
  CONFUSED: "confused",
});

const TRACKED = Object.freeze([
  CONDITION_SLUGS.GRABBED,
  CONDITION_SLUGS.RESTRAINED,
  CONDITION_SLUGS.CONFUSED,
]);

/**
 * @typedef {object} ConditionAdapterResult
 * @property {boolean} ok
 * @property {string|null} actorId
 * @property {{ grabbed: boolean, restrained: boolean, confused: boolean }} conditions
 * @property {string|null} method
 * @property {string|null} reason
 * @property {string|null} error
 */

function emptyConditions() {
  return { grabbed: false, restrained: false, confused: false };
}

function baseResult(actor) {
  return {
    ok: false,
    actorId: actor?.id ?? null,
    conditions: emptyConditions(),
    method: null,
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

/**
 * Detect a single condition via structured PF2e APIs.
 * Preference order mirrors PF2e 8.3.0 public surface:
 * 1. actor.hasCondition(slug)
 * 2. actor.conditions.hasType(slug)
 * 3. actor.getCondition(slug) with active check
 * 4. itemTypes.condition slug match (structured only)
 */
export function detectConditionSlug(actor, slug) {
  if (!actor || !slug) return { present: false, method: null, reason: "missing-actor-or-slug" };

  if (typeof actor.hasCondition === "function") {
    try {
      return { present: Boolean(actor.hasCondition(slug)), method: "hasCondition", reason: null };
    } catch (error) {
      return {
        present: false,
        method: "hasCondition",
        reason: "hasCondition-threw",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (actor.conditions && typeof actor.conditions.hasType === "function") {
    try {
      return { present: Boolean(actor.conditions.hasType(slug)), method: "conditions.hasType", reason: null };
    } catch (error) {
      return {
        present: false,
        method: "conditions.hasType",
        reason: "hasType-threw",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (typeof actor.getCondition === "function") {
    try {
      const condition = actor.getCondition(slug);
      return { present: Boolean(condition?.active ?? condition), method: "getCondition", reason: null };
    } catch (error) {
      return {
        present: false,
        method: "getCondition",
        reason: "getCondition-threw",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const items = actor.itemTypes?.condition;
  if (Array.isArray(items) || (items && typeof items[Symbol.iterator] === "function")) {
    try {
      for (const item of items) {
        const itemSlug = item?.system?.slug ?? item?.slug ?? null;
        if (itemSlug === slug) {
          const active = item?.active !== false && item?.system?.active !== false;
          if (active) return { present: true, method: "itemTypes.condition", reason: null };
        }
      }
      return { present: false, method: "itemTypes.condition", reason: null };
    } catch (error) {
      return {
        present: false,
        method: "itemTypes.condition",
        reason: "itemTypes-threw",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { present: false, method: null, reason: "no-condition-api" };
}

/**
 * Read Grabbed / Restrained / Confused for an Actor.
 * @returns {ConditionAdapterResult}
 */
export function readTrackedConditions(actor) {
  const base = baseResult(actor);

  if (!isSupportedSystem()) {
    return { ...base, reason: "unsupported-system" };
  }
  if (!actor) {
    return { ...base, reason: "missing-actor" };
  }

  const conditions = emptyConditions();
  const methods = [];
  let anyApi = false;
  let apiFailure = null;

  for (const slug of TRACKED) {
    const detected = detectConditionSlug(actor, slug);
    if (detected.method) {
      anyApi = true;
      methods.push(detected.method);
    }
    if (detected.reason && detected.reason !== "missing-actor-or-slug") {
      if (detected.reason === "no-condition-api") {
        // continue — may still fail overall
      } else if (detected.error || detected.reason.endsWith("-threw")) {
        apiFailure = detected;
      }
    }
    if (detected.present) {
      if (slug === CONDITION_SLUGS.GRABBED) conditions.grabbed = true;
      if (slug === CONDITION_SLUGS.RESTRAINED) conditions.restrained = true;
      if (slug === CONDITION_SLUGS.CONFUSED) conditions.confused = true;
    }
  }

  if (!anyApi) {
    return {
      ...base,
      conditions,
      reason: "no-condition-api",
      error: apiFailure?.error ?? null,
    };
  }

  if (apiFailure && !conditions.grabbed && !conditions.restrained && !conditions.confused) {
    // API threw and we could not confirm any condition — fail open.
    return {
      ...base,
      conditions,
      method: apiFailure.method,
      reason: apiFailure.reason || "condition-api-failed",
      error: apiFailure.error ?? null,
    };
  }

  return {
    ok: true,
    actorId: actor.id ?? null,
    conditions,
    method: methods[0] ?? "structured",
    reason: null,
    error: null,
  };
}

/**
 * Convenience: read conditions from a Combatant document.
 * @returns {ConditionAdapterResult}
 */
export function readCombatantConditions(combatant) {
  if (!combatant) {
    return {
      ok: false,
      actorId: null,
      conditions: emptyConditions(),
      method: null,
      reason: "missing-combatant",
      error: null,
    };
  }
  return readTrackedConditions(combatant.actor ?? null);
}

/**
 * Whether an Item document is a tracked PF2e condition (structured type + slug).
 */
export function isTrackedConditionItem(item) {
  if (!item) return false;
  const type = item.type ?? item?.system?.type;
  if (type !== "condition") return false;
  const slug = item.system?.slug ?? item.slug ?? null;
  return TRACKED.includes(slug);
}

/**
 * Serializable summary for diagnostics (no names, no UUIDs beyond actor id short form).
 */
export function toSerializableResult(result) {
  return {
    ok: Boolean(result?.ok),
    actorId: result?.actorId == null ? null : String(result.actorId),
    conditions: {
      grabbed: Boolean(result?.conditions?.grabbed),
      restrained: Boolean(result?.conditions?.restrained),
      confused: Boolean(result?.conditions?.confused),
    },
    method: result?.method == null ? null : String(result.method),
    reason: result?.reason == null ? null : String(result.reason).slice(0, 200),
    error: result?.error == null ? null : String(result.error).slice(0, 200),
  };
}
