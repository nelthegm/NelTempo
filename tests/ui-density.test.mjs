import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MODULE_ID,
  PHASE_BAR_LAYOUTS,
  SETTINGS,
  MIN_CONTROL_HIT_PX,
} from "../scripts/constants.js";
import {
  clampPhaseBarScalePercent,
  clampPortraitScalePercent,
  isTextEntryTarget,
  migrateLegacyInterfaceScale,
  resolvePhaseBarLayout,
} from "../scripts/presentation.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const moduleJson = JSON.parse(readFileSync(join(root, "module.json"), "utf8"));
assert.equal(moduleJson.version, "0.3.6");
assert.equal(moduleJson.id, "nel-dynamic-initiative");
assert.equal(moduleJson.title, "NelTempo");
assert.equal(
  moduleJson.download,
  "https://github.com/nelthegm/NelTempo/releases/download/v0.3.6/dynamic-initiative.zip",
);

assert.equal(SETTINGS.PORTRAIT_SCALE, "portraitScale");
assert.equal(SETTINGS.PHASE_BAR_SCALE, "phaseBarScale");
assert.equal(SETTINGS.PHASE_BAR_LAYOUT, "phaseBarLayout");
assert.equal(SETTINGS.INTERFACE_SCALE, "interfaceScale");
assert.equal(MIN_CONTROL_HIT_PX, 32);

assert.equal(clampPortraitScalePercent(50), 50);
assert.equal(clampPortraitScalePercent(100), 100);
assert.equal(clampPortraitScalePercent(73), 75);
assert.equal(clampPhaseBarScalePercent(50), 60);
assert.equal(clampPhaseBarScalePercent(85), 90);
assert.equal(clampPhaseBarScalePercent(100), 100);

assert.equal(resolvePhaseBarLayout(PHASE_BAR_LAYOUTS.FULL, 80, 800), PHASE_BAR_LAYOUTS.FULL);
assert.equal(resolvePhaseBarLayout(PHASE_BAR_LAYOUTS.COMPACT, 100, 2000), PHASE_BAR_LAYOUTS.COMPACT);
assert.equal(resolvePhaseBarLayout(PHASE_BAR_LAYOUTS.AUTO, 90, 2000), PHASE_BAR_LAYOUTS.COMPACT);
assert.equal(resolvePhaseBarLayout(PHASE_BAR_LAYOUTS.AUTO, 100, 1100), PHASE_BAR_LAYOUTS.COMPACT);
assert.equal(resolvePhaseBarLayout(PHASE_BAR_LAYOUTS.AUTO, 100, 1600), PHASE_BAR_LAYOUTS.FULL);

const store = {
  [SETTINGS.INTERFACE_SCALE]: 70,
  [SETTINGS.INTERFACE_SCALE_MIGRATED]: false,
};
const first = await migrateLegacyInterfaceScale({
  getSetting: (key) => store[key],
  setSetting: async (key, value) => {
    store[key] = value;
  },
});
assert.equal(first.migrated, true);
assert.equal(store[SETTINGS.PORTRAIT_SCALE], 70);
assert.equal(store[SETTINGS.PHASE_BAR_SCALE], 70);
assert.equal(store[SETTINGS.INTERFACE_SCALE_MIGRATED], true);
assert.equal(store[SETTINGS.INTERFACE_SCALE], 70);
const second = await migrateLegacyInterfaceScale({
  getSetting: (key) => store[key],
  setSetting: async (key, value) => {
    store[key] = value;
  },
});
assert.equal(second.migrated, false);

assert.equal(isTextEntryTarget({ tagName: "INPUT" }), true);
assert.equal(isTextEntryTarget({ tagName: "TEXTAREA" }), true);
assert.equal(isTextEntryTarget({ tagName: "SELECT" }), true);
assert.equal(isTextEntryTarget({ tagName: "DIV", isContentEditable: true }), true);
assert.equal(isTextEntryTarget({ tagName: "BUTTON" }), false);
assert.equal(isTextEntryTarget(null), false);

const mainSrc = readFileSync(join(root, "scripts/main.js"), "utf8");
assert.match(mainSrc, /PORTRAIT_SCALE/);
assert.match(mainSrc, /PHASE_BAR_SCALE/);
assert.match(mainSrc, /PHASE_BAR_LAYOUT/);
assert.match(mainSrc, /INTERFACE_SCALE_MIGRATED/);
assert.match(mainSrc, /config:\s*false/);
assert.match(mainSrc, /keybindings\.register/);
assert.match(mainSrc, /endCurrentTurn/);
assert.match(mainSrc, /migrateLegacyInterfaceScale/);
assert.match(mainSrc, /scope:\s*"client"/);

const uiSrc = readFileSync(join(root, "scripts/ui.js"), "utf8");
assert.match(uiSrc, /contextmenu/);
assert.match(uiSrc, /openPlacementEditor/);
assert.match(uiSrc, /toggle-overflow/);
assert.match(uiSrc, /ndi-overflow-menu/);
assert.match(uiSrc, /gmCompactControlsHTML/);
assert.match(uiSrc, /playerCompactControlsHTML/);
assert.match(uiSrc, /endCurrentTurnFromKeybinding/);
assert.match(uiSrc, /eligibleOwnedEndTurnCombatants/);
assert.match(uiSrc, /confirmEndCombat/);
assert.match(uiSrc, /REQUESTS\.END_TURN/);
assert.equal(uiSrc.includes("root.style.zoom"), false);
assert.match(uiSrc, /--ndi-portrait-scale/);
assert.match(uiSrc, /--ndi-phase-bar-scale/);
assert.match(uiSrc, /ActivateAndEditTip/);
assert.match(uiSrc, /addEventListener\("contextmenu"/);
assert.match(uiSrc, /if \(!game\.user\.isGM\) return/);

const css = readFileSync(join(root, "styles/dynamic-initiative.css"), "utf8");
assert.match(css, /--ndi-portrait-scale/);
assert.match(css, /min-height:\s*32px/);
assert.match(css, /min-width:\s*32px/);
assert.match(css, /\.ndi-overflow-menu/);
assert.match(css, /\.ndi-bottom-bar\.is-compact/);
assert.equal(/#ndi-dock\s*\{[^}]*zoom\s*:/s.test(css), false);
assert.equal(/transform:\s*scale\(var\(--ndi-portrait-scale/s.test(css), false);

const lang = JSON.parse(readFileSync(join(root, "lang/en.json"), "utf8"));
for (const key of [
  "NDI.Setting.PortraitScale.Name",
  "NDI.Setting.PhaseBarScale.Name",
  "NDI.Setting.PhaseBarLayout.Name",
  "NDI.Setting.PhaseBarLayout.Auto",
  "NDI.Portrait.ActivateAndEditTip",
  "NDI.Keybinding.EndCurrentTurn.Name",
  "NDI.Control.MoreActions",
]) {
  assert.ok(lang[key], `missing ${key}`);
}

const packSrc = readFileSync(join(root, "scripts/pack.mjs"), "utf8");
assert.match(packSrc, /presentation\.js/);

const authoritySrc = readFileSync(join(root, "tests/authority.test.mjs"), "utf8");
assert.match(authoritySrc, /socketPayload/);
assert.match(authoritySrc, /isGmEntryRequest/);

console.log("ui-density.test.mjs: ok");
