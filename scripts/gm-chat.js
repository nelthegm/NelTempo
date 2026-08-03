/**
 * GM-only ChatMessage helpers (Foundry V14 whisper recipients).
 */

import { MODULE_TITLE } from "./constants.js";

/**
 * Build whisper recipient user ids for all GMs.
 * Prefers ChatMessage.getWhisperRecipients("GM").
 */
export function resolveGmWhisperRecipientIds(users = globalThis.game?.users) {
  let recipients = null;
  try {
    recipients =
      globalThis.ChatMessage?.getWhisperRecipients?.("GM") ??
      globalThis.ChatMessage?.getWhisperRecipients?.("gm") ??
      null;
  } catch (_error) {
    recipients = null;
  }
  if (!recipients?.length && users) {
    recipients = [...users].filter((user) => user?.isGM);
  }
  return [...(recipients ?? [])]
    .map((entry) => (typeof entry === "string" ? entry : entry?.id))
    .filter(Boolean);
}

/**
 * GM-only instructional chat data. Uses whisper recipients — never public.
 */
export function buildGmOnlyChatData(content, { speakerAlias = MODULE_TITLE } = {}) {
  const data = {
    content,
    speaker: { alias: speakerAlias },
    whisper: resolveGmWhisperRecipientIds(),
  };
  try {
    if (typeof globalThis.ChatMessage?.applyMode === "function") {
      globalThis.ChatMessage.applyMode(data, "gm");
    }
  } catch (_error) {
    // whisper array already set
  }
  if (!Array.isArray(data.whisper) || data.whisper.length === 0) {
    data.whisper = resolveGmWhisperRecipientIds();
  }
  return data;
}

export function createGmOnlyChat(content) {
  return globalThis.ChatMessage.create(buildGmOnlyChatData(content));
}
