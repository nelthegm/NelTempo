import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// JavaScript syntax check via node --check
for (const file of [
  "scripts/main.js",
  "scripts/controller.js",
  "scripts/state.js",
  "scripts/utils.js",
  "scripts/ui.js",
  "scripts/initiative.js",
  "scripts/shields.js",
  "scripts/constants.js",
  "scripts/lifecycle.js",
  "scripts/pf2e-lifecycle-adapter.js",
  "scripts/pf2e-condition-adapter.js",
  "scripts/timing.js",
  "scripts/timing-service.js",
  "scripts/placement-editor.js",
  "scripts/portrait-activation.js",
  "scripts/countdown.js",
  "scripts/gm-chat.js",
]) {
  execFileSync(process.execPath, ["--check", join(root, file)], { stdio: "pipe" });
}

// Import graph resolves (pure modules)
await import("../scripts/constants.js");
await import("../scripts/state.js");
// utils imports state + constants; works without Foundry globals for pure exports
await import("../scripts/utils.js");

// ZIP validation when dist package exists
const zipPath = join(root, "dist", "dynamic-initiative.zip");
if (existsSync(zipPath)) {
  let listed = "";
  try {
    listed = execFileSync("tar", ["-tf", zipPath], { encoding: "utf8" });
  } catch (_error) {
    // Windows may not have tar -tf for zip on older systems; try PowerShell
    listed = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/'/g, "''")}').Entries | ForEach-Object { $_.FullName }`,
      ],
      { encoding: "utf8" },
    );
  }
  const entries = listed
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter(Boolean);

  assert.ok(
    entries.some((entry) => entry === "module.json" || entry.endsWith("/module.json") === false && entry === "module.json"),
    "ZIP must contain module.json at archive root",
  );
  assert.ok(entries.includes("module.json"), `module.json at ZIP root, got: ${entries.slice(0, 20).join(", ")}`);
  assert.ok(entries.some((e) => e.startsWith("scripts/")), "ZIP includes scripts/");
  assert.ok(entries.some((e) => e.startsWith("styles/")), "ZIP includes styles/");
  assert.ok(entries.some((e) => e.startsWith("lang/")), "ZIP includes lang/");
  assert.ok(entries.includes("README.md"), "ZIP includes README.md");
  assert.ok(entries.includes("LICENSE"), "ZIP includes LICENSE");
  assert.equal(entries.some((e) => e.startsWith(".git")), false);
  assert.equal(entries.some((e) => e.startsWith("tests/")), false);
  assert.equal(entries.some((e) => e.startsWith("node_modules/")), false);
  assert.equal(entries.some((e) => e.startsWith("dist/")), false);

  const size = statSync(zipPath).size;
  assert.ok(size > 100, "ZIP should not be empty");
  console.log(`Package ZIP validated (${entries.length} entries, ${size} bytes).`);
} else {
  console.log("Package ZIP not present yet; skipping archive content checks.");
}

// package.json test script exists
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.ok(pkg.scripts?.test);

console.log("Dynamic Initiative package-validate tests passed.");
