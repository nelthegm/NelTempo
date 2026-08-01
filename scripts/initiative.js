import { MODULE_ID } from "./constants.js";
import { debug, escapeHTML, notify, slugLabel } from "./utils.js";

function buildStatistic(actor, skill, { initial = false } = {}) {
  const base = actor.getStatistic?.(skill) ?? (skill === "perception" ? actor.perception : actor.skills?.[skill]);
  if (!base) throw new Error(`Statistic '${skill}' is unavailable for ${actor.name}.`);

  const actorDefault = actor.system?.initiative?.statistic ?? "perception";
  if (initial && actorDefault === skill && actor.initiative?.statistic) return actor.initiative.statistic;

  if (typeof base.extend !== "function") return base;

  const label = game.i18n.format?.("PF2E.InitiativeWithSkill", { skillName: base.label }) ?? `Initiative (${base.label})`;
  return base.extend({
    slug: initial ? "initiative" : "dynamic-initiative",
    label: base.label,
    domains: ["initiative"],
    rollOptions: [base.slug, initial ? "dynamic-initiative:opening" : "dynamic-initiative:round-check"],
    check: {
      type: initial ? "initiative" : "skill-check",
      label,
    },
  });
}

async function fallbackRoll(actor, skill, label) {
  const statistic = actor.getStatistic?.(skill) ?? actor.skills?.[skill] ?? actor.perception;
  const modifier = Number(statistic?.check?.mod ?? statistic?.mod ?? 0);
  const roll = await new Roll("1d20 + @mod", { mod: modifier }).evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<strong>${escapeHTML(label)}</strong><br>Dynamic Initiative fallback roll`,
    flags: { [MODULE_ID]: { fallback: true, skill } },
  });
  return roll;
}

export async function rollDynamicInitiative(combatant, { skill, dc, initial }) {
  const actor = combatant?.actor;
  if (!actor) throw new Error("The combatant has no actor.");
  const label = slugLabel(actor, skill);

  try {
    const statistic = buildStatistic(actor, skill, { initial });
    const roll = await statistic.roll({
      skipDialog: false,
      extraRollOptions: [
        "dynamic-initiative",
        initial ? "dynamic-initiative:opening" : "dynamic-initiative:round-check",
      ],
    });
    if (!roll) return null;
    return { total: Number(roll.total), skill, label, roll };
  } catch (error) {
    console.error(`${MODULE_ID} | PF2e statistic roll failed; using fallback`, error);
    notify("warn", `Dynamic Initiative could not use PF2e's ${label} roll workflow. A basic fallback roll was used.`);
    const roll = await fallbackRoll(actor, skill, `${label} vs DC ${dc}`);
    debug("Fallback initiative roll", { actor: actor.name, skill, total: roll.total });
    return { total: Number(roll.total), skill, label, roll };
  }
}
