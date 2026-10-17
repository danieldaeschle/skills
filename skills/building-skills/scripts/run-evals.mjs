#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const NOT_PACKED = new Set([".git"]);
const NOT_COPIED = new Set(["node_modules", ".venv", "__pycache__", "evals", "results", ".git"]);
const PLUGIN_NAME = "skills";
const RUNS_KEPT = 5;
// A run older than this cannot still be in progress: case timeouts are minutes, not hours.
const STALE_RUN_MS = 6 * 60 * 60 * 1000;
const CACHE_DIR = join(homedir(), ".cache", "skill-evals");

const rawArguments = process.argv.slice(2);
const rootFlagIndex = rawArguments.indexOf("--root");
if (rootFlagIndex !== -1 && !rawArguments[rootFlagIndex + 1]) {
  console.log("--root needs a directory");
  process.exit(2);
}
const SKILLS_ROOT = resolve(
  (rootFlagIndex === -1 ? process.env.SKILLS_DIR : rawArguments[rootFlagIndex + 1]) ?? join(homedir(), ".claude", "skills"),
);
const argumentsList = rootFlagIndex === -1 ? rawArguments : rawArguments.filter((_, index) => index !== rootFlagIndex && index !== rootFlagIndex + 1);
const firstFlag = argumentsList.findIndex((item) => item.startsWith("-"));
const skillNames = firstFlag === -1 ? argumentsList : argumentsList.slice(0, firstFlag);
const passthrough = firstFlag === -1 ? [] : argumentsList.slice(firstFlag);
if (skillNames.length === 0) {
  console.log("Usage: run-evals.mjs [--root <skills dir>] <skill>... [claude plugin eval flags, e.g. --model haiku --ablation with-without]");
  process.exit(2);
}

if (existsSync(CACHE_DIR)) {
  const staleBefore = Date.now() - STALE_RUN_MS;
  for (const oldRun of readdirSync(CACHE_DIR).sort().slice(0, -(RUNS_KEPT - 1))) {
    const runPath = join(CACHE_DIR, oldRun);
    if (statSync(runPath).mtimeMs < staleBefore) rmSync(runPath, { recursive: true, force: true });
  }
}
const runDir = join(CACHE_DIR, new Date().toISOString().replace(/[:.]/g, "-"));
const pluginDir = join(runDir, "plugin");
mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
writeFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: PLUGIN_NAME }, null, 2));

for (const entry of readdirSync(SKILLS_ROOT)) {
  const source = join(SKILLS_ROOT, entry);
  try {
    if (NOT_PACKED.has(entry) || lstatSync(source).isSymbolicLink() || !existsSync(join(source, "SKILL.md"))) continue;
  } catch {
    continue;
  }
  cpSync(source, join(pluginDir, "skills", entry), {
    recursive: true,
    filter: (path) => !NOT_COPIED.has(basename(path)) && !path.endsWith(".zip"),
  });
}

let caseCount = 0;
for (const skillName of skillNames) {
  const evalsDir = join(SKILLS_ROOT, skillName, "evals");
  if (!existsSync(evalsDir)) {
    console.error(`${skillName}: no evals/ directory at ${evalsDir} - write cases first, see references/eval-format.md`);
    process.exit(2);
  }
  for (const caseName of readdirSync(evalsDir)) {
    if (caseName === "results" || !existsSync(join(evalsDir, caseName, "prompt.md"))) continue;
    cpSync(join(evalsDir, caseName), join(pluginDir, "evals", `${skillName}--${caseName}`), { recursive: true });
    caseCount += 1;
  }
}
if (caseCount === 0) {
  console.error("No eval cases found.");
  process.exit(2);
}

const claudeBinary = [join(homedir(), ".local", "bin", "claude"), "/usr/local/bin/claude"].find(existsSync) ?? "claude";
const evalArguments = ["plugin", "eval", pluginDir, "--no-publish", "--trust-plugin", "--output-dir", join(runDir, "results")];
// Trigger cases grade the Skill tool, which the default with-without ablation only counts as an indicator.
if (!passthrough.includes("--ablation")) evalArguments.push("--ablation", "none");
evalArguments.push(...passthrough);

console.log(`${caseCount} case(s), results in ${join(runDir, "results")}`);
const result = spawnSync(claudeBinary, evalArguments, { stdio: "inherit" });
// `claude plugin eval` exits 0 without running anything when the account lacks access.
const outputDirIndex = passthrough.indexOf("--output-dir");
const outputDir = outputDirIndex >= 0 ? passthrough[outputDirIndex + 1] : join(runDir, "results");
if (result.status === 0 && !existsSync(outputDir)) {
  console.error("No results written - `claude plugin eval` ran nothing. Check the account has plugin-eval access.");
  process.exit(1);
}
process.exit(result.status ?? 1);
