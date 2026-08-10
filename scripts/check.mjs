import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const rootPath = decodeURIComponent(root.pathname).replace(/^\/(?:([A-Za-z]:))/, "$1");
const excluded = new Set([".git", "dist", "node_modules"]);

function filesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else files.push(path);
  }
  return files;
}

const files = filesUnder(rootPath);
const scripts = files.filter((path) => [".js", ".mjs"].includes(extname(path)));
for (const path of scripts) {
  const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${path}\n`);
    process.exit(result.status || 1);
  }
}

for (const name of ["module.json", "package.json", "lang/en.json"]) {
  JSON.parse(readFileSync(join(rootPath, name), "utf8"));
}

console.log(`Static validation passed (${scripts.length} JavaScript modules; 3 JSON documents).`);

