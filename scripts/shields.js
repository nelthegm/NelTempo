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

export async function registerRaisedShield(item) {
  if (!isPrimaryGM() || !game.settings.get(MODULE_ID, SETTINGS.MANAGE_RAISED_SHIELD)) return;
  if (item.getFlag?.(MODULE_ID, "managedRaisedShield")) return;
  const combat = getCombat();
  const state = getState(combat);
  if (!combat || !state?.enabled || !isRaisedShieldEffect(item)) return;

  const combatant = findCombatantForActor(combat, item.actor);
  if (!combatant) return;

  const currentSerial = Number(state.enemyPhaseSerial || 0);
  const expireEnemySerial = state.phase === PHASES.ENEMY ? currentSerial : currentSerial + 1;
  const originalDuration = foundry.utils.deepClone(item.system?.duration ?? null);

  const update = {
    [`flags.${MODULE_ID}.managedRaisedShield`]: true,
    [`flags.${MODULE_ID}.expireEnemySerial`]: expireEnemySerial,
    [`flags.${MODULE_ID}.originalDuration`]: originalDuration,
  };

  if (item.system?.duration) {
    update["system.duration.unit"] = "unlimited";
    update["system.duration.expiry"] = null;
  }

  try {
    await item.update(update, { [`${MODULE_ID}.shieldManagement`]: true });
  } catch (error) {
    console.warn(`${MODULE_ID} | Unable to make Raise a Shield duration unlimited`, error);
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
      createdPhase: liveState.phase,
      createdAt: Date.now(),
    };
    const result = await saveState(combat, next, { reason: "register-shield" });
    if (!result.ok) {
      console.error(`${MODULE_ID} | Failed to persist Raise a Shield tracking`, {
        reason: result.reason,
      });
      return;
    }
    debug("Registered raised shield", { combatantId: combatant.id, expireEnemySerial });
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
    return actor?.items?.find?.((item) => item.uuid === entry.itemUuid || isRaisedShieldEffect(item)) ?? null;
  } catch (_error) {
    return null;
  }
}

export async function expireDueRaisedShields(combat, state) {
  if (!isPrimaryGM() || !game.settings.get(MODULE_ID, SETTINGS.MANAGE_RAISED_SHIELD)) return state;
  const serial = Number(state.enemyPhaseSerial || 0);
  const shieldEntries = new Map(Object.entries(state.shields ?? {}));

  // Live-world safety net: PF2e or another module may create the Raised Shield
  // effect without our createItem hook seeing it. Scan every encounter actor at
  // the end of the Enemy phase so a matching effect cannot remain indefinitely.
  for (const combatant of combat.combatants) {
    for (const item of combatant.actor?.items ?? []) {
      if (!isRaisedShieldEffect(item) || shieldEntries.has(item.uuid)) continue;
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
      console.warn(`${MODULE_ID} | Failed to remove managed Raise a Shield effect at combat end`, error);
    }
  }
  const next = foundry.utils.deepClone(state ?? {});
  next.shields = {};
  if (combat && state?.enabled) {
    const result = await saveState(combat, next, { reason: "clear-shields" });
    if (!result.ok) {
      console.error(`${MODULE_ID} | Failed to clear Raise a Shield tracking at combat end`, {
        reason: result.reason,
      });
    }
  }
  return next;
}
