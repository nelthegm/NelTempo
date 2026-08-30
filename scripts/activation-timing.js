/**
 * Observational real-world activation timing.
 *
 * This module is deliberately independent from PF2e and NelTempo lifecycle
 * decisions. Callers decide when canonical workflow activation begins/ends;
 * these helpers only record authoritative wall-clock timestamps and totals.
 */

/** Defensive ceiling for a single uninterrupted segment after a forward clock jump. */
export const MAX_ACTIVATION_SEGMENT_MS = 7 * 24 * 60 * 60 * 1000;

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeNonnegativeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(numeric));
}

function safeTimestamp(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.floor(numeric);
}

function safeLabel(value) {
  const label = String(value ?? "").trim();
  return label ? label.slice(0, 120) : null;
}

function cloneTiming(timing) {
  return structuredClone(normalizeActivationTiming(timing));
}

export function createActivationTiming() {
  return {
    records: {},
    summaryPosted: false,
  };
}

export function normalizeActivationRecord(record) {
  const source = plainObject(record) ? record : {};
  return {
    totalMs: safeNonnegativeInteger(source.totalMs),
    activationCount: safeNonnegativeInteger(source.activationCount),
    activeSince: safeTimestamp(source.activeSince),
    label: safeLabel(source.label),
  };
}

export function normalizeActivationTiming(timing) {
  const source = plainObject(timing) ? timing : {};
  const normalized = createActivationTiming();
  for (const [combatantId, record] of Object.entries(source.records ?? {})) {
    const id = String(combatantId || "").trim();
    if (!id) continue;
    normalized.records[id] = normalizeActivationRecord(record);
  }
  normalized.summaryPosted = Boolean(source.summaryPosted);
  return normalized;
}

/**
 * Start one actual NelTempo activation session. Duplicate starts are idempotent.
 * Delayed resumes and reopened activations are new sessions by design.
 */
export function startActivationTiming(
  timing,
  combatantId,
  { now = Date.now(), label = null, enabled = true } = {},
) {
  const next = cloneTiming(timing);
  const id = String(combatantId ?? "").trim();
  if (!enabled || !id) return { timing: next, changed: false, started: false };

  const current = normalizeActivationRecord(next.records[id]);
  if (current.activeSince != null) {
    if (!current.label && safeLabel(label)) {
      current.label = safeLabel(label);
      next.records[id] = current;
      return { timing: next, changed: true, started: false };
    }
    return { timing: next, changed: false, started: false };
  }

  current.activeSince = safeTimestamp(now) ?? safeTimestamp(Date.now()) ?? 0;
  current.activationCount = safeNonnegativeInteger(current.activationCount + 1);
  current.label = safeLabel(label) ?? current.label;
  next.records[id] = current;
  return { timing: next, changed: true, started: true };
}

/** Close one segment exactly once. Missing/malformed timestamps add no time. */
export function stopActivationTiming(
  timing,
  combatantId,
  { now = Date.now() } = {},
) {
  const next = cloneTiming(timing);
  const id = String(combatantId ?? "").trim();
  const existing = next.records[id];
  if (!id || !existing) return { timing: next, changed: false, elapsedMs: 0 };

  const record = normalizeActivationRecord(existing);
  if (record.activeSince == null) {
    next.records[id] = record;
    return { timing: next, changed: false, elapsedMs: 0 };
  }

  const stopAt = safeTimestamp(now);
  const rawElapsed = stopAt == null ? 0 : stopAt - record.activeSince;
  const elapsedMs = Math.min(
    MAX_ACTIVATION_SEGMENT_MS,
    Math.max(0, Number.isFinite(rawElapsed) ? Math.floor(rawElapsed) : 0),
  );
  record.totalMs = safeNonnegativeInteger(record.totalMs + elapsedMs);
  record.activeSince = null;
  next.records[id] = record;
  return { timing: next, changed: true, elapsedMs };
}

export function stopAllActivationTiming(timing, { now = Date.now() } = {}) {
  let next = cloneTiming(timing);
  const stopped = [];
  for (const id of Object.keys(next.records)) {
    const result = stopActivationTiming(next, id, { now });
    next = result.timing;
    if (result.changed) stopped.push(id);
  }
  return { timing: next, changed: stopped.length > 0, stopped };
}

/**
 * Reload/setting reconciliation: only the proven canonical active combatant may
 * retain a running timestamp. Tracking-off closes every running segment.
 */
export function reconcileActivationTiming(
  timing,
  { activeCombatantId = null, trackingEnabled = true, now = Date.now() } = {},
) {
  let next = cloneTiming(timing);
  const allowed = trackingEnabled && activeCombatantId != null
    ? String(activeCombatantId)
    : null;
  const stopped = [];
  for (const [id, record] of Object.entries(next.records)) {
    if (record.activeSince == null || id === allowed) continue;
    const result = stopActivationTiming(next, id, { now });
    next = result.timing;
    if (result.changed) stopped.push(id);
  }
  return { timing: next, changed: stopped.length > 0, stopped };
}

export function activationDurationMs(record, now = Date.now()) {
  const normalized = normalizeActivationRecord(record);
  if (normalized.activeSince == null) return normalized.totalMs;
  const current = safeTimestamp(now);
  const rawElapsed = current == null ? 0 : current - normalized.activeSince;
  const elapsed = Math.min(
    MAX_ACTIVATION_SEGMENT_MS,
    Math.max(0, Number.isFinite(rawElapsed) ? Math.floor(rawElapsed) : 0),
  );
  return safeNonnegativeInteger(normalized.totalMs + elapsed);
}

/** Floor to whole seconds so live display never appears ahead of reality. */
export function formatActivationDuration(milliseconds) {
  const totalSeconds = Math.floor(safeNonnegativeInteger(milliseconds) / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${totalMinutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatActivationDurationAria(milliseconds) {
  const totalSeconds = Math.floor(safeNonnegativeInteger(milliseconds) / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const parts = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  if (seconds || parts.length === 0) parts.push(`${seconds} ${seconds === 1 ? "second" : "seconds"}`);
  return `Active for ${parts.join(" ")}`;
}

export function buildActivationTimingSummary(timing) {
  const normalized = normalizeActivationTiming(timing);
  const entries = Object.entries(normalized.records)
    .map(([combatantId, record]) => {
      const totalMs = safeNonnegativeInteger(record.totalMs);
      const activations = safeNonnegativeInteger(record.activationCount);
      return {
        combatantId,
        label: record.label ?? "Removed Combatant",
        activations,
        totalMs,
        averageMs: activations > 0 ? Math.floor(totalMs / activations) : 0,
      };
    })
    .filter((entry) => entry.activations > 0 || entry.totalMs > 0);

  const totalMs = entries.reduce(
    (sum, entry) => safeNonnegativeInteger(sum + entry.totalMs),
    0,
  );
  return { entries, totalMs };
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#039;",
    '"': "&quot;",
  })[character]);
}

export function activationTimingSummaryHTML(timing) {
  const summary = buildActivationTimingSummary(timing);
  const rows = summary.entries.length
    ? summary.entries.map((entry) => `<tr>
        <td>${escapeHTML(entry.label)}</td>
        <td>${entry.activations}</td>
        <td>${formatActivationDuration(entry.totalMs)}</td>
        <td>${formatActivationDuration(entry.averageMs)}</td>
      </tr>`).join("")
    : '<tr><td colspan="4">No activation timing was recorded.</td></tr>';
  return `<section class="ndi-combat-timing-summary">
    <h3>NelTempo — Combat Timing</h3>
    <table>
      <thead><tr><th>Combatant</th><th>Activations</th><th>Total Active Time</th><th>Average</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p><strong>Total Active Time:</strong> ${formatActivationDuration(summary.totalMs)}</p>
  </section>`;
}

export function markActivationSummaryPosted(timing) {
  const next = cloneTiming(timing);
  if (next.summaryPosted) return { timing: next, changed: false };
  next.summaryPosted = true;
  return { timing: next, changed: true };
}
