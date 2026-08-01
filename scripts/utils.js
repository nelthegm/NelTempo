import { FLAG_STATE, MODULE_ID, SETTINGS } from "./constants.js";
import {
  countPrunedCombatantEntries,
  normalizeState,
} from "./state.js";

/** @type {Map<string, Promise<unknown>>} */
const combatMutationChains = new Map();
/** @type {Map<string, number>} */
const combatMutationDepth = new Map();

export function debug(...args) {
  try {
    if (game.settings.get(MODULE_ID, SETTINGS.DEBUG)) console.debug(`${MODULE_ID} |`, ...args);
  } catch (_error) {
    // Settings may not be registered during very early initialization.
  }
}

/**
 * Concise structured diagnostics. Only emits when debug logging is enabled.
 * Never logs actor names, token names, full flags, or secrets.
 */
export function diag(event, details = {}) {
  try {
    if (!game.settings.get(MODULE_ID, SETTINGS.DEBUG)) return;
  } catch (_error) {
    return;
  }
  const safe = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    if (value === undefined) continue;
    if (["actorName", "tokenName", "flags", "source", "secrets", "name"].includes(key)) continue;
    safe[key] = value;
  }
  console.debug(`${MODULE_ID} | ${event}`, safe);
}

export function notify(level, message) {
  const fn = ui?.notifications?.[level] ?? ui?.notifications?.info;
  fn?.call(ui.notifications, message);
}

export function getCombat() {
  return game.combat ?? null;
}

export function getState(combat = getCombat()) {
  return combat?.getFlag(MODULE_ID, FLAG_STATE) ?? null;
}

export function shortId(id) {
  const text = String(id ?? "");
  return text.length <= 8 ? text : text.slice(0, 8);
}

export function combatantIdList(combat) {
  if (!combat?.combatants) return [];
  return [...combat.combatants].map((combatant) => combatant.id).filter(Boolean);
}

/**
 * Serialize mutations for a combat so rapid UI clicks cannot overlap writes.
 * Re-entrant: nested calls for the same combat run inline (no deadlock with saveState).
 */
export function runCombatMutation(combatId, task) {
  const key = String(combatId ?? "__none__");
  const depth = combatMutationDepth.get(key) ?? 0;
  if (depth > 0) return Promise.resolve().then(task);

  const previous = combatMutationChains.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    combatMutationDepth.set(key, (combatMutationDepth.get(key) ?? 0) + 1);
    try {
      return await task();
    } finally {
      const nextDepth = (combatMutationDepth.get(key) ?? 1) - 1;
      if (nextDepth <= 0) combatMutationDepth.delete(key);
      else combatMutationDepth.set(key, nextDepth);
    }
  });

  const tracked = run.catch(() => undefined).finally(() => {
    if (combatMutationChains.get(key) === tracked) combatMutationChains.delete(key);
  });
  combatMutationChains.set(key, tracked);
  return run;
}

let warnedMonksCombatDetails = false;

function isMonksCombatDetailsRenderError(error) {
  const text = `${error?.message ?? ""}\n${error?.stack ?? ""}`;
  return text.includes("monks-combat-details") && text.includes("CONFIG.statusEffects.find");
}

/**
 * Wrap a complete module-owned state object so Foundry V14 replaces it atomically.
 * Prefer the global `_replace` operator; fall back to foundry.data.operators.
 * Without Foundry (unit tests), returns the plain object for direct assignment.
 */
export function applyForceReplace(value) {
  if (typeof globalThis._replace === "function") return globalThis._replace(value);

  const operators = globalThis.foundry?.data?.operators;
  if (operators) {
    if (typeof operators._replace === "function") return operators._replace(value);
    if (typeof operators.ForcedReplacement === "function") {
      try {
        const wrapped = operators.ForcedReplacement(value);
        if (wrapped !== undefined) return wrapped;
      } catch (_error) {
        // Try as a constructable class next.
      }
      try {
        return new operators.ForcedReplacement(value);
      } catch (_error) {
        // Fall through to plain value.
      }
    }
  }

  return value;
}

/**
 * Build a combat update that replaces only this module's state flag.
 * Does not touch other modules' flags or core combat fields.
 */
export function buildCompleteStateUpdate(state) {
  return {
    [`flags.${MODULE_ID}.${FLAG_STATE}`]: applyForceReplace(state),
  };
}

/**
 * Update the Combat document without asking Foundry to render the native
 * tracker. Dynamic Initiative owns its own dock, and suppressing the unused
 * tracker avoids third-party tracker hooks interrupting phase changes.
 *
 * @returns {Promise<{ok: boolean, combatId: string|null, revision: number|null, reason: string|null, error: Error|null, document?: object|null}>}
 */
export async function safeCombatUpdate(combat, changes, options = {}) {
  if (!combat) {
    return {
      ok: false,
      combatId: null,
      revision: null,
      reason: "no-combat",
      error: new Error("No active combat encounter."),
    };
  }

  const combatId = combat.id ?? null;
  try {
    const document = await combat.update(changes, {
      ...options,
      render: false,
      [`${MODULE_ID}.internal`]: true,
    });
    return {
      ok: true,
      combatId,
      revision: null,
      reason: null,
      error: null,
      document: document ?? combat,
    };
  } catch (error) {
    // Monk's Combat Details 14.02 can throw from its post-render hook on PF2e
    // because CONFIG.statusEffects is not the Array shape it assumes. The
    // database update has already completed by the time that hook runs, so do
    // not abort Dynamic Initiative's state machine for this external UI error.
    if (isMonksCombatDetailsRenderError(error)) {
      if (!warnedMonksCombatDetails) {
        warnedMonksCombatDetails = true;
        console.warn(
          `${MODULE_ID} | Ignoring a Monk's Combat Details tracker-render error so Dynamic Initiative can continue.`,
          error,
        );
      }
      return {
        ok: true,
        combatId,
        revision: null,
        reason: "external-tracker-hook",
        error: null,
        document: combat,
      };
    }

    console.error(`${MODULE_ID} | combat update failed`, {
      combatId: shortId(combatId),
      reason: error?.message ?? "update-failed",
    });
    return {
      ok: false,
      combatId,
      revision: null,
      reason: "update-failed",
      error,
      document: null,
    };
  }
}

/**
 * Persist a complete normalized Dynamic Initiative state by replacing the
 * module-owned combat flag atomically. Increments revision once on success.
 *
 * @returns {Promise<{ok: boolean, combatId: string|null, revision: number|null, reason: string|null, error: Error|null}>}
 */
export async function saveState(combat, state, { reason = "state-save" } = {}) {
  if (!combat?.id) {
    return {
      ok: false,
      combatId: null,
      revision: null,
      reason: "no-combat",
      error: new Error("No active combat encounter."),
    };
  }

  return runCombatMutation(combat.id, async () => {
    const live = game.combats?.get?.(combat.id) ?? combat;
    if (!live || live.id !== combat.id) {
      diag("state-update-failed", {
        combatId: shortId(combat.id),
        reason: "combat-missing",
      });
      return {
        ok: false,
        combatId: combat.id,
        revision: null,
        reason: "combat-missing",
        error: new Error("The combat encounter no longer exists."),
      };
    }

    if (!game.user?.isGM) {
      diag("state-update-failed", {
        combatId: shortId(live.id),
        reason: "not-gm",
        userId: shortId(game.user?.id),
      });
      return {
        ok: false,
        combatId: live.id,
        revision: null,
        reason: "not-gm",
        error: new Error("Only a GM can update Dynamic Initiative combat state."),
      };
    }

    const previous = getState(live);
    const previousRevision = Math.max(0, Number(previous?.revision ?? 0) || 0);
    const combatantIds = combatantIdList(live);

    let normalized;
    try {
      normalized = normalizeState(state, { combatantIds, includeHistory: true });
    } catch (error) {
      diag("state-update-failed", {
        combatId: shortId(live.id),
        reason: "normalize-failed",
      });
      console.error(`${MODULE_ID} | state normalization failed`, {
        combatId: shortId(live.id),
        reason: error?.message ?? "normalize-failed",
      });
      return {
        ok: false,
        combatId: live.id,
        revision: previousRevision,
        reason: "normalize-failed",
        error,
      };
    }

    const pruned = countPrunedCombatantEntries(state, normalized);
    normalized.revision = previousRevision + 1;

    diag("state-normalized", {
      combatId: shortId(live.id),
      phase: normalized.phase,
      revision: normalized.revision,
      combatants: combatantIds.length,
      pruned,
      reason,
    });

    if (pruned > 0) {
      diag("combatant-state-pruned", {
        combatId: shortId(live.id),
        pruned,
        combatants: combatantIds.length,
        revision: normalized.revision,
      });
    }

    diag("state-update-queued", {
      combatId: shortId(live.id),
      phase: normalized.phase,
      revision: normalized.revision,
      reason,
    });

    diag("state-update-started", {
      combatId: shortId(live.id),
      phase: normalized.phase,
      revision: normalized.revision,
      reason,
    });

    const changes = buildCompleteStateUpdate(normalized);
    const updateResult = await safeCombatUpdate(live, changes);
    if (!updateResult.ok) {
      diag("state-update-failed", {
        combatId: shortId(live.id),
        phase: normalized.phase,
        revision: previousRevision,
        reason: updateResult.reason,
      });
      return {
        ok: false,
        combatId: live.id,
        revision: previousRevision,
        reason: updateResult.reason,
        error: updateResult.error,
      };
    }

    const stored = getState(live);
    const storedRevision = Number(stored?.revision ?? NaN);
    if (Number.isFinite(storedRevision) && storedRevision !== normalized.revision) {
      // Another writer may have interleaved outside our queue; report mismatch.
      diag("state-update-stale", {
        combatId: shortId(live.id),
        revision: storedRevision,
        expected: normalized.revision,
      });
    }

    diag("state-update-complete", {
      combatId: shortId(live.id),
      phase: normalized.phase,
      revision: normalized.revision,
      combatants: combatantIds.length,
      pruned,
      reason,
    });

    return {
      ok: true,
      combatId: live.id,
      revision: normalized.revision,
      reason: null,
      error: null,
    };
  });
}

/** Clear native initiative values for party combatants at each new round. */
export async function resetPartyNativeInitiative(combat) {
  if (!combat) return;
  const updates = combat.combatants
    .filter((combatant) => combatantSide(combatant) === "party" && combatant.initiative != null)
    .map((combatant) => ({ _id: combatant.id, initiative: null }));
  if (!updates.length) return;
  await combat.updateEmbeddedDocuments("Combatant", updates, {
    render: false,
    [`${MODULE_ID}.internal`]: true,
  });
}

export function isPrimaryGM(user = game.user) {
  if (!user?.isGM || !user.active) return false;
  const activeGM = game.users?.activeGM;
  if (activeGM) return activeGM.id === user.id;
  const first = game.users
    .filter((candidate) => candidate.active && candidate.isGM)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  return first?.id === user.id;
}

export function userCanOwnCombatant(user, combatant) {
  if (!user || !combatant?.actor) return false;
  return user.isGM || combatant.actor.testUserPermission?.(user, "OWNER") || false;
}

export function activePlayerOwners(combatant) {
  if (!combatant?.actor) return [];
  return game.users.filter(
    (user) => user.active && !user.isGM && combatant.actor.testUserPermission?.(user, "OWNER"),
  );
}

export function combatantSide(combatant) {
  const actor = combatant?.actor;
  if (!actor) return "enemy";
  const alliance = actor.system?.details?.alliance ?? actor.alliance ?? null;
  if (alliance === "party") return "party";
  if (alliance === "opposition") return "enemy";
  if (actor.hasPlayerOwner) return "party";
  const disposition = Number(combatant.token?.disposition ?? combatant.token?.document?.disposition ?? 0);
  if (disposition > 0) return "party";
  return "enemy";
}

export function isUnavailable(combatant) {
  const actor = combatant?.actor;
  if (!actor) return true;
  if (actor.isDead || actor.statuses?.has?.("dead")) return true;
  return false;
}

export function isUnconscious(combatant) {
  const actor = combatant?.actor;
  return Boolean(actor?.statuses?.has?.("unconscious") || actor?.conditions?.has?.("unconscious"));
}

export function portraitFor(combatant) {
  // The dock is a portrait carousel, not a token carousel. Prefer the Actor's
  // character portrait and only fall back to token art when no portrait exists.
  return (
    combatant?.actor?.img ??
    combatant?.token?.texture?.src ??
    combatant?.token?.document?.texture?.src ??
    combatant?.actor?.prototypeToken?.texture?.src ??
    "icons/svg/mystery-man.svg"
  );
}

export function combatantName(combatant) {
  return combatant?.name ?? combatant?.actor?.name ?? "Unknown";
}

export function getCombatant(combat, combatantId) {
  return combat?.combatants?.get?.(combatantId) ?? combat?.combatants?.find?.((c) => c.id === combatantId) ?? null;
}

export function findCombatantForActor(combat, actor) {
  if (!combat || !actor) return null;
  return combat.combatants.find(
    (combatant) => combatant.actor?.uuid === actor.uuid || combatant.actor?.id === actor.id,
  ) ?? null;
}

export function ownedPartyCombatants(combat, user = game.user) {
  return combat.combatants.filter(
    (combatant) =>
      combatantSide(combatant) === "party" && !isUnavailable(combatant) && userCanOwnCombatant(user, combatant),
  );
}

export function standardSkillChoices(actor) {
  const choices = [];
  const seen = new Set();
  const add = (slug, label, mod = null) => {
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    choices.push({ slug, label: label || slug, mod: Number.isFinite(Number(mod)) ? Number(mod) : null });
  };

  const perception = actor.getStatistic?.("perception") ?? actor.perception ?? null;
  add("perception", perception?.label ?? game.i18n.localize("PF2E.PerceptionLabel") ?? "Perception", perception?.check?.mod ?? perception?.mod);

  for (const [slug, statistic] of Object.entries(actor.skills ?? {})) {
    if (!statistic) continue;
    add(slug, statistic.label ?? slug, statistic.check?.mod ?? statistic.mod);
  }

  return choices.sort((a, b) => {
    if (a.slug === "perception") return -1;
    if (b.slug === "perception") return 1;
    return String(a.label).localeCompare(String(b.label));
  });
}

export function suggestedSkillFor(combatant, state) {
  const actorFlag = combatant.actor?.getFlag?.(MODULE_ID, "lastInitiativeSkill");
  const remembered = state?.lastSkills?.[combatant.id] ?? actorFlag;
  const suggested = state?.suggestedSkill;
  const choices = standardSkillChoices(combatant.actor);
  const valid = new Set(choices.map((choice) => choice.slug));
  if (suggested && suggested !== "last-used" && valid.has(suggested)) return suggested;
  if (remembered && valid.has(remembered)) return remembered;
  const actorDefault = combatant.actor?.system?.initiative?.statistic;
  if (actorDefault && valid.has(actorDefault)) return actorDefault;
  return "perception";
}

export function slugLabel(actor, slug) {
  return standardSkillChoices(actor).find((choice) => choice.slug === slug)?.label ?? slug;
}

export function escapeHTML(value) {
  const text = String(value ?? "");
  return text.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#039;",
    '"': "&quot;",
  })[character]);
}

export function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

export function currentPortraitSize() {
  return clampNumber(game.settings.get(MODULE_ID, SETTINGS.PORTRAIT_SIZE), 48, 112, 72);
}

export function socketPayload(type, data = {}) {
  return { type, userId: game.user.id, sentAt: Date.now(), ...data };
}

/**
 * Optionally sync the native combat turn marker for UI/third-party tools.
 * Always suppress Foundry/PF2e turnEvents — Dynamic Initiative owns start/end
 * boundaries via the phase lifecycle adapter, not combat.turn changes.
 */
export async function setNativeTurn(combat, combatantId) {
  if (!combat) return;
  const turns = combat.turns ?? [];
  const index = turns.findIndex((combatant) => combatant.id === combatantId);
  if (index < 0) return;
  const result = await safeCombatUpdate(combat, { turn: index }, { turnEvents: false });
  if (!result.ok && result.error) throw result.error;
}

export async function clearNativeTurn(combat) {
  if (!combat || combat.turn == null) return;
  const result = await safeCombatUpdate(combat, { turn: null }, { turnEvents: false });
  if (!result.ok && result.error) throw result.error;
}
