/**
 * Build dist/dynamic-initiative.zip with module.json at the archive root.
 * Excludes development-only paths (git, tests, node_modules, dist).
 */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
const zipPath = join(distDir, "dynamic-initiative.zip");

const INCLUDE = [
  "module.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "FORGE_INSTALL.md",
  "PLAYTEST_CHECKLIST.md",
  "scripts/constants.js",
  "scripts/controller.js",
  "scripts/initiative.js",
  "scripts/lifecycle.js",
  "scripts/lifecycle-hooks.js",
  "scripts/main.js",
  "scripts/pf2e-condition-adapter.js",
  "scripts/pf2e-lifecycle-adapter.js",
  "scripts/placement-editor.js",
  "scripts/portrait-activation.js",
  "scripts/countdown.js",
  "scripts/presentation.js",
  "scripts/gm-chat.js",
  "scripts/shields.js",
  "scripts/state.js",
  "scripts/timing.js",
  "scripts/timing-service.js",
  "scripts/ui.js",
  "scripts/utils.js",
  "styles/dynamic-initiative.css",
  "lang/en.json",
  "assets/icon.svg",
  "docs/SLICE_0_2_1_CONDITION_TIMING.md",
  "docs/SLICE_0_2_1_TEST_PLAN.md",
  "docs/SLICE_0_2_2_UI_LAYERING.md",
  "docs/SLICE_0_3_0_GM_INITIATIVE_EDITOR.md",
  "docs/SLICE_0_3_0_TEST_PLAN.md",
  "docs/SLICE_0_3_1_PORTRAIT_ACTIVATION.md",
  "docs/SLICE_0_3_1_TEST_PLAN.md",
  "docs/SLICE_0_3_5_PHASE_TURN_LIFECYCLE.md",
  "docs/SLICE_0_3_5_TEST_PLAN.md",
];

function ensureIncludes() {
  for (const rel of INCLUDE) {
    const abs = join(root, rel);
    if (!existsSync(abs)) throw new Error(`Missing required package file: ${rel}`);
  }
}

function packWithPowerShell() {
  mkdirSync(distDir, { recursive: true });
  if (existsSync(zipPath)) rmSync(zipPath);

  const fileList = INCLUDE.map((rel) => rel.replace(/\//g, "\\")).join("','");
  const script = `
    $ErrorActionPreference = 'Stop'
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $root = '${root.replace(/'/g, "''")}'
    $zipPath = '${zipPath.replace(/'/g, "''")}'
    if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
    $zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
      $files = @('${fileList}')
      foreach ($rel in $files) {
        $full = Join-Path $root $rel
        $entryName = $rel -replace '\\\\','/'
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $full, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
      }
    } finally {
      $zip.Dispose()
    }
  `;
  execFileSync("powershell", ["-NoProfile", "-Command", script], { stdio: "inherit" });
}

ensureIncludes();
packWithPowerShell();

const bytes = readFileSync(zipPath);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const size = statSync(zipPath).size;

// Verify module.json at root
const listing = execFileSync(
  "powershell",
  [
    "-NoProfile",
    "-Command",
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/'/g, "''")}').Entries | ForEach-Object { $_.FullName }`,
  ],
  { encoding: "utf8" },
)
  .split(/\r?\n/)
  .map((line) => line.trim().replace(/\\/g, "/"))
  .filter(Boolean);

if (!listing.includes("module.json")) {
  throw new Error(`module.json missing from ZIP root. Entries: ${listing.join(", ")}`);
}

console.log(`Created ${relative(root, zipPath)}`);
console.log(`Entries: ${listing.length}`);
console.log(`Size: ${size} bytes`);
console.log(`SHA-256: ${sha256}`);
console.log(listing.join("\n"));
