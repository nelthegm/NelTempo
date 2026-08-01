# Installing NelTempo on The Forge

*Formerly Dynamic Initiative.* Module id remains `nel-dynamic-initiative`.

Use the ZIP labeled **Forge upload** (`dynamic-initiative.zip`). Its `module.json` is at the archive root, which avoids a nested-module import.

1. Back up or clone the world used for the first test.
2. Open your Forge **Games Configuration** page.
3. In **Table Tools**, choose **Summon Import Wizard**.
4. Turn off **Install found packages from the Bazaar** so this remains a custom package.
5. Upload `dynamic-initiative.zip` (or `nel-dynamic-initiative-v0.3.0-forge.zip` if you rename the release archive) and choose **Analyze**.
6. Complete the import, then open the world's **Manage Modules** menu.
7. Disable **Combat Carousel**.
8. Enable **NelTempo**. Keep **PF2e Workbench** enabled.
9. Save module settings and refresh every connected browser.

The top-center portrait dock appears only while NelTempo is active. If no encounter exists, select the tokens to include and use the NelTempo launcher, or add them to the regular Combat Tracker first.

## Manual Data/modules archive

The manual ZIP contains the outer `nel-dynamic-initiative` folder. It is intended for a normal Foundry data directory:

`Data/modules/nel-dynamic-initiative/module.json`
