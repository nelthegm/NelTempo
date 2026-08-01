import { FLAG_STATE, MODULE_ID, SETTINGS } from "./constants.js";

export function debug(...args) {
  try {
    if (game.settings.get(MODULE_ID, SETTINGS.DEBUG)) console.debug(`${MODULE_ID} |`, ...args);
  } catch (_error) {
    // Settings may not be registered during very early initialization.
  }
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

let warnedMonksCombatDetails = false;

function isMonksCombatDetailsRenderError(error) {
  const text = `${error?.message ?? ""}\n${error?.stack ?? ""}`;
  return text.includes("monks-combat-details") && text.includes("CONFIG.statusEffects.find");
}

/**
 * Update the Combat document without asking Foundry to render the native
 * tracker. Dynamic Initiative owns its own dock, and suppressing the unused
 * tracker avoids third-party tracker hooks interrupting phase changes.
 */
export async function safeCombatUpdate(combat, changes, options = {}) {
  if (!combat) throw new Error("No active combat encounter.");
  try {
    return await combat.update(changes, {
      ...options,
      render: false,
      [`${MODULE_ID}.internal`]: true,
    });
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
      return combat;
    }
    throw error;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameValue(left, right) {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch (_error) {
    return false;
  }
}

/**
 * Build a Foundry differential update which truly replaces nested state maps.
 * Document updates merge objects, so assigning results: {} alone does not
 * remove old combatant result keys. Foundry's -= deletion syntax is required.
 */
export function buildStateUpdate(basePath, previous, next) {
  if (!isPlainObject(previous)) return { [basePath]: next };
  const changes = {};

  const walk = (path, before, after) => {
    if (sameValue(before, after)) return;
    if (!isPlainObject(after) || !isPlainObject(before)) {
      changes[path] = after;
      return;
    }

    for (const key of Object.keys(before)) {
      if (!Object.hasOwn(after, key)) changes[`${path}.-=${key}`] = null;
    }
    for (const [key, value] of Object.entries(after)) {
      const childPath = `${path}.${key}`;
      if (!Object.hasOwn(before, key)) changes[childPath] = value;
      else walk(childPath, before[key], value);
    }
  };

  walk(basePath, previous, next);
  return changes;
}

export async function saveState(combat, state) {
  const basePath = `flags.${MODULE_ID}.${FLAG_STATE}`;
  const previous = getState(combat);
  const changes = buildStateUpdate(basePath, previous, state);
  if (Object.keys(changes).length) await safeCombatUpdate(combat, changes);
  return state;
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

export async function setNativeTurn(combat, combatantId) {
  if (!combat) return;
  const turns = combat.turns ?? [];
  const index = turns.findIndex((combatant) => combatant.id === combatantId);
  if (index < 0) return;
  await safeCombatUpdate(combat, { turn: index });
}

export async function clearNativeTurn(combat) {
  if (!combat || combat.turn == null) return;
  await safeCombatUpdate(combat, { turn: null });
}
