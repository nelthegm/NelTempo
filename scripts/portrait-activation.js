/**
 * Client-local portrait → exact token activation for NelTempo 0.3.1.
 * Never mutates combat flags, sockets, or world documents.
 */

import { MODULE_ID, SETTINGS } from "./constants.js";
import { diag, shortId } from "./utils.js";

export const ACTIVATION_REASON = Object.freeze({
  OK: "ok",
  MISSING_COMBATANT: "missing-combatant",
  MISSING_TOKEN: "missing-token",
  OFF_SCENE: "off-scene",
  CANVAS_UNREADY: "canvas-unready",
  PERMISSION: "permission-denied",
  CONTROL_FAILED: "control-failed",
  INVALID: "invalid",
});

function localize(key, data) {
  try {
    return data ? game.i18n.format(key, data) : game.i18n.localize(key);
  } catch (_error) {
    return key;
  }
}

function notifyWarn(key) {
  try {
    ui?.notifications?.warn?.(localize(key));
  } catch (_error) {
    // Notifications may be unavailable in tests.
  }
}

function isPanEnabled() {
  try {
    return game.settings.get(MODULE_ID, SETTINGS.PAN_CAMERA_ON_PORTRAIT) !== false;
  } catch (_error) {
    return true;
  }
}

/**
 * Resolve exact Scene / TokenDocument ids from a Combatant.
 * Uses combatant.tokenId / sceneId / token document — never Actor name or first match.
 */
export function resolveCombatantTokenIdentity(combatant) {
  if (!combatant?.id) return null;
  const tokenDoc = combatant.token ?? null;
  const tokenId = combatant.tokenId ?? tokenDoc?.id ?? null;
  const sceneId =
    combatant.sceneId ??
    tokenDoc?.parent?.id ??
    tokenDoc?.scene?.id ??
    null;
  if (!tokenId || !sceneId) return null;
  return {
    combatantId: String(combatant.id),
    tokenId: String(tokenId),
    sceneId: String(sceneId),
    tokenDocument: tokenDoc,
  };
}

/**
 * Whether the exact placeable is already the sole controlled token for this user.
 */
export function isSoleControlledToken(token, canvasRef = globalThis.canvas) {
  if (!token?.controlled) return false;
  const controlled = canvasRef?.tokens?.controlled ?? [];
  return controlled.length === 1 && controlled[0] === token;
}

/**
 * Native permission check for controlling a Token placeable.
 */
export function userCanControlToken(token, user = globalThis.game?.user) {
  if (!token || !user) return false;
  try {
    if (typeof token.can === "function") return Boolean(token.can(user, "control"));
  } catch (_error) {
    // fall through
  }
  try {
    if (typeof token._canControl === "function") return Boolean(token._canControl(user));
  } catch (_error) {
    // fall through
  }
  return Boolean(token.isOwner || user.isGM);
}

function emptyResult(partial = {}) {
  return {
    ok: false,
    combatId: null,
    combatantId: null,
    sceneMatched: false,
    tokenControlled: false,
    cameraPanned: false,
    reason: ACTIVATION_REASON.INVALID,
    error: null,
    ...partial,
  };
}

/**
 * Activate the exact combatant token on the current canvas scene.
 * Local-only: no sockets, no combat flag writes, no Undo.
 *
 * @param {object} combat Foundry Combat document
 * @param {string} combatantId
 * @param {{ pan?: boolean, notify?: boolean }} [options]
 */
export async function activateCombatantPortrait(combat, combatantId, options = {}) {
  const notify = options.notify !== false;
  const panRequested = options.pan ?? isPanEnabled();
  const combatId = combat?.id ?? null;
  const id = combatantId == null ? null : String(combatantId);

  diag("portrait-activation-requested", {
    combatId: shortId(combatId),
    combatantId: shortId(id),
    panEnabled: Boolean(panRequested),
  });

  if (!combat || !id) {
    return emptyResult({
      combatId,
      combatantId: id,
      reason: ACTIVATION_REASON.MISSING_COMBATANT,
    });
  }

  const combatant = combat.combatants?.get?.(id) ?? [...(combat.combatants ?? [])].find((c) => c.id === id);
  if (!combatant) {
    diag("portrait-activation-failed", {
      combatId: shortId(combatId),
      combatantId: shortId(id),
      reason: ACTIVATION_REASON.MISSING_COMBATANT,
    });
    if (notify) notifyWarn("NDI.Portrait.TokenMissing");
    return emptyResult({
      combatId,
      combatantId: id,
      reason: ACTIVATION_REASON.MISSING_COMBATANT,
    });
  }

  const identity = resolveCombatantTokenIdentity(combatant);
  if (!identity) {
    diag("portrait-activation-token-missing", {
      combatId: shortId(combatId),
      combatantId: shortId(id),
    });
    if (notify) notifyWarn("NDI.Portrait.TokenMissing");
    return emptyResult({
      combatId,
      combatantId: id,
      reason: ACTIVATION_REASON.MISSING_TOKEN,
    });
  }

  diag("portrait-token-resolved", {
    combatId: shortId(combatId),
    combatantId: shortId(id),
    sceneId: shortId(identity.sceneId),
    tokenId: shortId(identity.tokenId),
  });

  const canvasRef = globalThis.canvas;
  if (!canvasRef?.ready || !canvasRef.scene) {
    diag("portrait-activation-failed", {
      combatId: shortId(combatId),
      combatantId: shortId(id),
      reason: ACTIVATION_REASON.CANVAS_UNREADY,
    });
    if (notify) notifyWarn("NDI.Portrait.CanvasNotReady");
    return emptyResult({
      combatId,
      combatantId: id,
      reason: ACTIVATION_REASON.CANVAS_UNREADY,
    });
  }

  if (String(canvasRef.scene.id) !== identity.sceneId) {
    diag("portrait-activation-off-scene", {
      combatId: shortId(combatId),
      combatantId: shortId(id),
      sceneId: shortId(identity.sceneId),
      tokenId: shortId(identity.tokenId),
    });
    if (notify) notifyWarn("NDI.Portrait.OffScene");
    return emptyResult({
      combatId,
      combatantId: id,
      sceneMatched: false,
      reason: ACTIVATION_REASON.OFF_SCENE,
    });
  }

  const token =
    canvasRef.tokens?.get?.(identity.tokenId) ??
    canvasRef.tokens?.placeables?.find?.((t) => t.id === identity.tokenId) ??
    null;

  if (!token || token.destroyed) {
    diag("portrait-activation-token-missing", {
      combatId: shortId(combatId),
      combatantId: shortId(id),
      sceneId: shortId(identity.sceneId),
      tokenId: shortId(identity.tokenId),
    });
    if (notify) notifyWarn("NDI.Portrait.TokenMissing");
    return emptyResult({
      combatId,
      combatantId: id,
      sceneMatched: true,
      reason: ACTIVATION_REASON.MISSING_TOKEN,
    });
  }

  if (!userCanControlToken(token)) {
    diag("portrait-activation-permission-denied", {
      combatId: shortId(combatId),
      combatantId: shortId(id),
      sceneId: shortId(identity.sceneId),
      tokenId: shortId(identity.tokenId),
    });
    if (notify) notifyWarn("NDI.Portrait.NoPermission");
    return emptyResult({
      combatId,
      combatantId: id,
      sceneMatched: true,
      reason: ACTIVATION_REASON.PERMISSION,
    });
  }

  const alreadySole = isSoleControlledToken(token, canvasRef);
  let tokenControlled = alreadySole;

  if (!alreadySole) {
    try {
      const ok = token.control({ releaseOthers: true, pan: false });
      tokenControlled = ok !== false && Boolean(token.controlled);
    } catch (error) {
      diag("portrait-activation-failed", {
        combatId: shortId(combatId),
        combatantId: shortId(id),
        tokenId: shortId(identity.tokenId),
        reason: ACTIVATION_REASON.CONTROL_FAILED,
        error: String(error?.message ?? "control-failed").slice(0, 120),
      });
      if (notify) notifyWarn("NDI.Portrait.NoPermission");
      return emptyResult({
        combatId,
        combatantId: id,
        sceneMatched: true,
        reason: ACTIVATION_REASON.CONTROL_FAILED,
        error: error?.message ?? "control-failed",
      });
    }
  }

  if (!tokenControlled) {
    diag("portrait-activation-failed", {
      combatId: shortId(combatId),
      combatantId: shortId(id),
      tokenId: shortId(identity.tokenId),
      reason: ACTIVATION_REASON.CONTROL_FAILED,
    });
    if (notify) notifyWarn("NDI.Portrait.NoPermission");
    return emptyResult({
      combatId,
      combatantId: id,
      sceneMatched: true,
      reason: ACTIVATION_REASON.CONTROL_FAILED,
    });
  }

  diag("portrait-token-controlled", {
    combatId: shortId(combatId),
    combatantId: shortId(id),
    tokenId: shortId(identity.tokenId),
    controlResult: true,
    panEnabled: Boolean(panRequested),
  });

  let cameraPanned = false;
  if (panRequested) {
    try {
      diag("portrait-camera-pan-started", {
        combatId: shortId(combatId),
        combatantId: shortId(id),
        tokenId: shortId(identity.tokenId),
      });
      if (typeof token.panCanvas === "function") {
        await token.panCanvas({ force: true, duration: 350 });
        cameraPanned = true;
      } else if (typeof canvasRef.animatePan === "function") {
        const center = token.center ?? { x: token.x, y: token.y };
        await canvasRef.animatePan({
          x: center.x,
          y: center.y,
          scale: canvasRef.stage?.scale?.x ?? canvasRef.scale ?? undefined,
          duration: 350,
        });
        cameraPanned = true;
      }
      if (cameraPanned) {
        diag("portrait-camera-pan-complete", {
          combatId: shortId(combatId),
          combatantId: shortId(id),
          tokenId: shortId(identity.tokenId),
        });
      } else {
        diag("portrait-camera-pan-skipped", {
          combatId: shortId(combatId),
          combatantId: shortId(id),
          reason: "no-pan-api",
        });
      }
    } catch (error) {
      diag("portrait-camera-pan-skipped", {
        combatId: shortId(combatId),
        combatantId: shortId(id),
        tokenId: shortId(identity.tokenId),
        reason: "pan-failed",
        error: String(error?.message ?? "pan-failed").slice(0, 120),
      });
      // Keep token control; pan failure is non-fatal.
    }
  } else {
    diag("portrait-camera-pan-skipped", {
      combatId: shortId(combatId),
      combatantId: shortId(id),
      reason: "setting-disabled",
    });
  }

  return {
    ok: true,
    combatId,
    combatantId: id,
    sceneMatched: true,
    tokenControlled: true,
    cameraPanned,
    reason: ACTIVATION_REASON.OK,
    error: null,
  };
}
