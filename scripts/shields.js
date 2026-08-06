import { MODULE_ID, SETTINGS } from "./constants.js";
import { PHASES } from "./state.js";
import { debug, findCombatantForActor, getCombat, getState, isPrimaryGM, runCombatMutation, saveState } from "./utils.js";

function normalizedSlug(item) {
  return String(item?.slug ?? item?.system?.slug ?? item?.name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function isRaisedShieldEffect(item) {
  if (!item || item.type !== "effect") return false;
  const slug = normalizedSlug(item);
  return ["raise-a-shield", "raise-shield", "raised-shield", "raised-a-shield"].some(
    (candidate) => slug === candidate || slug.includes(candidate),
  );
}

/**
 * Explicit Parry defense effect detection (slug-based; not arbitrary item names).
 */
export function isParryEffect(item) {
  if (!item || item.type !== "effect") return false;
  const slug = normalizedSlug(item);
  if (!slug) return false;
  // Exact-ish parry effect slugs; avoid matching unrelated items that merely contain the letters.
  return slug === "parry" || slug.endsWith("-parry") || slug.startsWith("parry-") || slug.includes("parry-stance");
}

export function isManagedDefenseEffect(item) {
  return isRaisedShieldEffect(item) || isParryEffect(item);
}

export async function registerRaisedShield(item) {
  if (!isPrimaryGM() || !game.settings.get(MODULE_ID, SETTINGS.MANAGE_RAISED_SHIELD)) return;
  if (item.getFlag?.(MODULE_ID, "managedRaisedShield")) return;
  const combat = getCombat();
  const state = getState(combat);
  if (!combat || !state?.enabled || !isManagedDefenseEffect(item)) return;

  const combatant = findCombatantForActor(combat, item.actor);
  if (!combatant) return;

  // 0.3.5+: expire at the combatant's next start-of-turn (phase activation), not Enemy phase end.
  // Keep expireEnemySerial as a safety-net for orphaned effects discovered at Enemy leave.
  const currentSerial = Number(state.enemyPhaseSerial || 0);
  const expireEnemySerial = state.phase === PHASES.ENEMY ? currentSerial + 1 : currentSerial + 1;
  const originalDuration = foundry.utils.deepClone(item.system?.duration ?? null);
  const defenseKind = isParryEffect(item) ? "parry" : "raise-shield";

  const update = {
    [`flags.${MODULE_ID}.managedRaisedShield`]: true,
    [`flags.${MODULE_ID}.expireOnCombatantStart`]: true,
    [`flags.${MODULE_ID}.expireEnemySerial`]: expireEnemySerial,
    [`flags.${MODULE_ID}.originalDuration`]: originalDuration,
    [`flags.${MODULE_ID}.defenseKind`]: defenseKind,
  };

  if (item.system?.duration) {
    update["system.duration.unit"] = "unlimited";
    update["system.duration.expiry"] = null;
  }

  try {
    await item.update(update, { [`${MODULE_ID}.shieldManagement`]: true });
  } catch (error) {
    console.warn(`${MODULE_ID} | Unable to make defense effect duration unlimited`, error);
  }

  await runCombatMutation(combat.id, async () => {
    const liveState = getState(combat) ?? state;
    const next = foundry.utils.deepClone(liveState);
    next.shields ??= {};
    next.shields[item.uuid] = {
      itemUuid: item.uuid,
      actorUuid: item.actor?.uuid ?? null,
      combatantId: combatant.id,
      expireEnemySerial,
      expireOnCombatantStart: true,
      defenseKind,
      createdPhase: liveState.phase,
      createdAt: Date.now(),
    };
    const result = await saveState(combat, next, { reason: "register-shield" });
    if (!result.ok) {
      console.error(`${MODULE_ID} | Failed to persist defense tracking`, {
        reason: result.reason,
      });
      return;
    }
    debug("Registered managed defense", { combatantId: combatant.id, defenseKind });
  });
}

async function resolveItem(entry) {
  try {
    const document = await fromUuid(entry.itemUuid);
    if (document) return document;
  } catch (_error) {
    // Fall through to actor lookup.
  }
  if (!entry.actorUuid) return null;
  try {
    const actor = await fromUuid(entry.actorUuid);
    return (
      actor?.items?.find?.(
        (item) => item.uuid === entry.itemUuid || isManagedDefenseEffect(item),
      ) ?? null
    );
  } catch (_error) {
    return null;
  }
}

/**
 * Expire Raise Shield / Parry for one combatant at their start-of-turn boundary.
 */
export async function expireDefensesForCombatant(combat, state, combatantId) {
  if (!isPrimaryGM() || !game.settings.get(MODULE_ID, SETTINGS.MANAGE_RAISED_SHIELD)) return state;
  const id = String(combatantId);
  const shieldEntries = new Map(Object.entries(state.shields ?? {}));

  // Safety net: live effects flagged for this combatant.
  const combatant = combat.combatants?.get?.(id) ?? combat.combatants?.find?.((c) => c.id === id);
  for (const item of combatant?.actor?.items ?? []) {
    if (!isManagedDefenseEffect(item)) continue;
    if (!item.getFlag?.(MODULE_ID, "expireOnCombatantStart") && !item.getFlag?.(MODULE_ID, "managedRaisedShield")) {
      continue;
    }
    if (shieldEntries.has(item.uuid)) continue;
    shieldEntries.set(item.uuid, {
      itemUuid: item.uuid,
      actorUuid: item.actor?.uuid ?? null,
      combatantId: id,
      expireOnCombatantStart: true,
      discoveredAtStart: true,
    });
  }

  const next = foundry.utils.deepClone(state);
  next.shields ??= {};
  let changed = false;
  for (const [uuid, entry] of shieldEntries.entries()) {
    if (String(entry.combatantId) !== id) continue;
    if (entry.expireOnCombatantStart === false) continue;
    const item = await resolveItem(entry);
    try {
      if (item) await item.delete({ [`${MODULE_ID}.shieldExpiry`]: true });
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to expire managed defense at start of turn`, error);
    }
    delete next.shields[uuid];
    changed = true;
  }
  return changed ? next : state;
}

/**
 * Legacy Enemy-leave safety net for orphaned Raise Shield / Parry effects.
 * Prefer expireDefensesForCombatant at start-of-turn.
 */
export async function expireDueRaisedShields(combat, state) {
  if (!isPrimaryGM() || !game.settings.get(MODULE_ID, SETTINGS.MANAGE_RAISED_SHIELD)) return state;
  const serial = Number(state.enemyPhaseSerial || 0);
  const shieldEntries = new Map(Object.entries(state.shields ?? {}));

  for (const combatant of combat.combatants) {
    for (const item of combatant.actor?.items ?? []) {
      if (!isManagedDefenseEffect(item) || shieldEntries.has(item.uuid)) continue;
      // Only catch orphans that never received start-of-turn expiry tracking.
      if (item.getFlag?.(MODULE_ID, "expireOnCombatantStart")) continue;
      shieldEntries.set(item.uuid, {
        itemUuid: item.uuid,
        actorUuid: item.actor?.uuid ?? null,
        combatantId: combatant.id,
        expireEnemySerial: serial,
        discoveredAtEnemyEnd: true,
      });
    }
  }

  const shields = [...shieldEntries.entries()];
  if (!shields.length) return state;

  const next = foundry.utils.deepClone(state);
  for (const [uuid, entry] of shields) {
    // Start-of-turn managed defenses are not expired here.
    if (entry.expireOnCombatantStart) continue;
    if (Number(entry.expireEnemySerial) > serial) continue;
    const item = await resolveItem(entry);
    try {
      if (item) await item.delete({ [`${MODULE_ID}.shieldExpiry`]: true });
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to expire managed Raise a Shield effect`, error);
    }
    delete next.shields[uuid];
  }
  return next;
}

export async function clearManagedRaisedShields(combat, state) {
  if (!isPrimaryGM()) return state;
  for (const entry of Object.values(state?.shields ?? {})) {
    const item = await resolveItem(entry);
    try {
      if (item) await item.delete({ [`${MODULE_ID}.shieldExpiry`]: true });
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to remove managed defense at combat end`, error);
    }
  }
  const next = foundry.utils.deepClone(state ?? {});
  next.shields = {};
  if (combat && state?.enabled) {
    const result = await saveState(combat, next, { reason: "clear-shields" });
    if (!result.ok) {
      console.error(`${MODULE_ID} | Failed to clear defense tracking at combat end`, {
        reason: result.reason,
      });
    }
  }
  return next;
}
