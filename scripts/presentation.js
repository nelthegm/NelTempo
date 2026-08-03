import { MODULE_ID, PHASE_BAR_LAYOUTS, SETTINGS } from "./constants.js";

/** Round to nearest step within [min, max]. */
export function clampScalePercent(value, { min = 50, max = 100, step = 5, fallback = 100 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const clamped = Math.min(max, Math.max(min, number));
  const steps = Math.round((clamped - min) / step);
  return Math.min(max, Math.max(min, min + steps * step));
}

export function clampPortraitScalePercent(value) {
  return clampScalePercent(value, { min: 50, max: 100, step: 5, fallback: 100 });
}

export function clampPhaseBarScalePercent(value) {
  return clampScalePercent(value, { min: 60, max: 100, step: 10, fallback: 100 });
}

/**
 * Resolve Auto/Compact/Full into Compact or Full.
 * Auto prefers Compact when the phase-bar scale is reduced or horizontal space is tight.
 */
export function resolvePhaseBarLayout(setting, phaseBarScalePercent, viewportWidth = 1280) {
  const requested = String(setting || PHASE_BAR_LAYOUTS.AUTO);
  if (requested === PHASE_BAR_LAYOUTS.COMPACT) return PHASE_BAR_LAYOUTS.COMPACT;
  if (requested === PHASE_BAR_LAYOUTS.FULL) return PHASE_BAR_LAYOUTS.FULL;
  const scale = clampPhaseBarScalePercent(phaseBarScalePercent);
  if (scale < 100) return PHASE_BAR_LAYOUTS.COMPACT;
  const width = Number(viewportWidth);
  if (Number.isFinite(width) && width < 1280) return PHASE_BAR_LAYOUTS.COMPACT;
  return PHASE_BAR_LAYOUTS.FULL;
}

/**
 * One-shot client migration: copy legacy INTERFACE_SCALE into portrait/phase scales.
 * Does not delete the legacy key. Safe to call multiple times.
 */
export async function migrateLegacyInterfaceScale({
  getSetting = (key) => game.settings.get(MODULE_ID, key),
  setSetting = (key, value) => game.settings.set(MODULE_ID, key, value),
} = {}) {
  let migrated = false;
  try {
    migrated = Boolean(getSetting(SETTINGS.INTERFACE_SCALE_MIGRATED));
  } catch (_error) {
    migrated = false;
  }
  if (migrated) {
    return { migrated: false, reason: "already-migrated" };
  }

  let legacy = 100;
  try {
    legacy = clampPortraitScalePercent(getSetting(SETTINGS.INTERFACE_SCALE));
  } catch (_error) {
    legacy = 100;
  }

  await setSetting(SETTINGS.PORTRAIT_SCALE, legacy);
  await setSetting(SETTINGS.PHASE_BAR_SCALE, clampPhaseBarScalePercent(Math.max(60, legacy)));
  await setSetting(SETTINGS.INTERFACE_SCALE_MIGRATED, true);
  return { migrated: true, legacy };
}

export function currentPortraitScalePercent() {
  try {
    return clampPortraitScalePercent(game.settings.get(MODULE_ID, SETTINGS.PORTRAIT_SCALE));
  } catch (_error) {
    try {
      return clampPortraitScalePercent(game.settings.get(MODULE_ID, SETTINGS.INTERFACE_SCALE));
    } catch (_inner) {
      return 100;
    }
  }
}

export function currentPhaseBarScalePercent() {
  try {
    return clampPhaseBarScalePercent(game.settings.get(MODULE_ID, SETTINGS.PHASE_BAR_SCALE));
  } catch (_error) {
    try {
      return clampPhaseBarScalePercent(Math.max(60, game.settings.get(MODULE_ID, SETTINGS.INTERFACE_SCALE)));
    } catch (_inner) {
      return 100;
    }
  }
}

export function currentPhaseBarLayoutSetting() {
  try {
    const value = game.settings.get(MODULE_ID, SETTINGS.PHASE_BAR_LAYOUT);
    if (Object.values(PHASE_BAR_LAYOUTS).includes(value)) return value;
  } catch (_error) {
    /* fall through */
  }
  return PHASE_BAR_LAYOUTS.AUTO;
}

export function resolvedPhaseBarLayoutNow() {
  let width = 1280;
  try {
    width = window.innerWidth;
  } catch (_error) {
    width = 1280;
  }
  return resolvePhaseBarLayout(
    currentPhaseBarLayoutSetting(),
    currentPhaseBarScalePercent(),
    width,
  );
}

/** True when focus is in a text-entry context that should ignore End Turn keybinding. */
export function isTextEntryTarget(target) {
  if (!target || typeof target !== "object") return false;
  const el = target.nodeType === 1 ? target : target.parentElement ?? target;
  if (!el) return false;
  const tag = String(el.tagName ?? "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  if (typeof el.closest === "function") {
    if (el.closest("input, textarea, select, [contenteditable='true'], .ProseMirror, .cm-editor, .tox-edit-area, .dialog, .window-app form, .application form")) {
      return true;
    }
  }
  return false;
}
