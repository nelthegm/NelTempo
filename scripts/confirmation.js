import { MODULE_ID } from "./constants.js";

function logFailure(diagnostic, error) {
  console.error(`${MODULE_ID} | ${diagnostic} confirmation failed; action cancelled`, error);
}

function dialogV2() {
  return globalThis.foundry?.applications?.api?.DialogV2 ?? null;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function fallbackConfirm(message, diagnostic) {
  try {
    const confirm = globalThis.window?.confirm;
    if (typeof confirm !== "function") {
      logFailure(diagnostic, new Error("No confirmation API is available."));
      return false;
    }
    return confirm.call(globalThis.window, message) === true;
  } catch (error) {
    logFailure(diagnostic, error);
    return false;
  }
}

/**
 * Module-owned boolean confirmation. Any construction, rendering, or fallback
 * failure resolves false so callers cannot perform a destructive mutation.
 */
export async function confirmNelTempoAction({ title, content, diagnostic = "action" } = {}) {
  try {
    const DialogV2 = dialogV2();
    if (typeof DialogV2?.confirm === "function") {
      return (await DialogV2.confirm({
        window: { title: String(title ?? "NelTempo") },
        content: `<p>${escapeHtml(content)}</p>`,
        yes: { default: false },
        no: { default: true },
        rejectClose: false,
      })) === true;
    }
  } catch (error) {
    logFailure(diagnostic, error);
    return false;
  }

  return fallbackConfirm(`${title ?? "NelTempo"}\n\n${content ?? ""}`, diagnostic);
}

/**
 * Module-owned multi-choice confirmation used by the incomplete-phase guard.
 * The optional fallback remains explicitly cancellable. Failures always choose
 * defaultAction (normally "return"), never a processing or skip mutation.
 */
export async function chooseNelTempoAction({
  title,
  content,
  buttons,
  defaultAction = "return",
  fallback = null,
  diagnostic = "action-choice",
} = {}) {
  try {
    const DialogV2 = dialogV2();
    if (typeof DialogV2?.wait === "function") {
      const result = await DialogV2.wait({
        window: { title: String(title ?? "NelTempo") },
        content: String(content ?? ""),
        buttons: Array.isArray(buttons) ? buttons : [],
        rejectClose: false,
      });
      const actions = new Set((buttons ?? []).map((button) => button.action));
      return actions.has(result) ? result : defaultAction;
    }
  } catch (error) {
    logFailure(diagnostic, error);
    return defaultAction;
  }

  if (!fallback) {
    logFailure(diagnostic, new Error("DialogV2.wait is unavailable."));
    return defaultAction;
  }
  const confirmed = fallbackConfirm(fallback.message, diagnostic);
  return confirmed ? fallback.confirmedAction : fallback.cancelledAction;
}
