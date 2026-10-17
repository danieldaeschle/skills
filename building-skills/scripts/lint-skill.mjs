#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

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

const SKIPPED_DIRS = new Set([".git"]);
const NAME_PATTERN = /^[a-z0-9-]{1,64}$/;
// Hard upload limit on claude.ai; Claude Code truncates at 1536.
const DESCRIPTION_MAX_CHARS = 1024;
const BODY_MAX_LINES = 500;
// Agents preview long files with partial reads, so longer references need a contents list.
const REFERENCE_TOC_THRESHOLD = 100;
const LOCAL_LINK = /\]\(([^)#\s]+?)(?:#[^)]*)?\)/g;
const STALE_DATE =
  /\b(before|after|until|since|as of)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b[^.\n]*\b20\d\d\b/g;
const OPUS_REDUNDANT = /double-check|think step by step/i;

function unquote(value) {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return { invalid: value };
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { fields: null, body: text };
  const fields = {};
  const lines = match[1].split("\n");
  let index = 0;
  while (index < lines.length) {
    const keyMatch = lines[index].match(/^([\w-]+):\s*(.*)$/);
    index += 1;
    if (!keyMatch) continue;
    let value = keyMatch[2].trim();
    if ([">", ">-", "|", "|-", ""].includes(value)) {
      const block = [];
      while (index < lines.length && (/^[ \t]/.test(lines[index]) || !lines[index].trim())) {
        block.push(lines[index].trim());
        index += 1;
      }
      value = block.filter(Boolean).join(" ");
    }
    fields[keyMatch[1]] = unquote(value);
  }
  return { fields, body: text.slice(match[0].length) };
}

const stripCode = (text) => text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]+`/g, "");

function* localLinks(text) {
  for (const [, target] of stripCode(text).matchAll(LOCAL_LINK)) {
    if (target.includes("://") || target.startsWith("mailto:") || target.startsWith("/")) continue;
    yield target;
  }
}

function* markdownFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["evals", "node_modules", ".venv"].includes(entry.name)) continue;
      yield* markdownFiles(path);
    } else if (entry.name.endsWith(".md")) {
      yield path;
    }
  }
}

const lineCount = (text) => text.split("\n").length;

function lintSkill(skillDir) {
  const findings = [];
  const report = (level, message) => findings.push({ level, message });
  const skillFile = join(skillDir, "SKILL.md");
  const text = readFileSync(skillFile, "utf8").replace(/\r\n/g, "\n");
  const { fields, body } = parseFrontmatter(text);
  if (!fields) {
    report("ERROR", "SKILL.md has no YAML frontmatter");
    return findings;
  }

  const name = fields.name ?? "";
  if (!name) {
    report("ERROR", "frontmatter has no name");
  } else {
    if (!NAME_PATTERN.test(name)) report("ERROR", `name '${name}' must be lowercase letters, digits, hyphens, max 64 chars`);
    if (/claude|anthropic/.test(name)) report("ERROR", `name '${name}' uses a reserved word`);
    if (name !== basename(skillDir)) report("ERROR", `name '${name}' differs from directory '${basename(skillDir)}'`);
    if (!name.split("-")[0].endsWith("ing")) report("WARN", `name '${name}' is not a gerund, e.g. 'processing-pdfs'`);
  }

  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== "object") continue;
    report("ERROR", `${key} is a double-quoted string with an unescaped quote - Claude Code cannot read it`);
    fields[key] = value.invalid;
  }
  const description = fields.description ?? "";
  if (!description) {
    report("ERROR", "frontmatter has no description");
  } else {
    if (description.length > DESCRIPTION_MAX_CHARS) {
      report("ERROR", `description has ${description.length} chars, max ${DESCRIPTION_MAX_CHARS}`);
    }
    if (/[<>]/.test(description)) report("ERROR", "description contains < or >");
    if (/^Use\b/.test(description)) report("WARN", "description starts with 'Use ...' - lead with what the skill does, third person");
    if (/\b(I can|you can)\b/i.test(description)) report("WARN", "description is not third person ('I can' / 'you can')");
    if (!/(^|[.!?]\s+)Use\s+\w/.test(description)) report("WARN", "description has no 'Use when ...' trigger sentence");
  }

  const bodyLines = lineCount(body);
  if (bodyLines > BODY_MAX_LINES) {
    report("ERROR", `SKILL.md body has ${bodyLines} lines, max ${BODY_MAX_LINES} - move sections to references/`);
  }

  const checkLinks = (sourceText, sourceDir, sourceLabel) => {
    for (const target of localLinks(sourceText)) {
      if (target.includes("\\")) report("ERROR", `${sourceLabel} link '${target}' uses backslashes`);
      else if (!existsSync(join(sourceDir, target))) report("ERROR", `${sourceLabel} link '${target}' points to a missing file`);
    }
  };
  checkLinks(text, skillDir, "SKILL.md");

  for (const reference of markdownFiles(skillDir)) {
    if (reference === skillFile) continue;
    const relativePath = relative(skillDir, reference);
    const referenceText = readFileSync(reference, "utf8");
    checkLinks(referenceText, dirname(reference), relativePath);
    const referenceLines = lineCount(referenceText);
    // Templates are copied verbatim into output, a contents list would leak into it.
    if (referenceLines > REFERENCE_TOC_THRESHOLD && !/template/i.test(relativePath) && !/^#+\s*Contents/im.test(referenceText.slice(0, 3000))) {
      report("WARN", `${relativePath} has ${referenceLines} lines and no '## Contents' list`);
    }
    for (const target of localLinks(referenceText)) {
      if (target.endsWith(".md")) report("ERROR", `${relativePath} links to ${target} - keep references one level deep from SKILL.md`);
    }
  }

  const prose = stripCode(text);
  if (/\[\[[^\]\s][^\]]*\]\]/.test(prose)) report("WARN", "contains [[wikilinks]] - a skill must stand alone, inline the fact");
  for (const match of prose.matchAll(STALE_DATE)) report("WARN", `time-sensitive phrase: '${match[0].slice(0, 60)}'`);
  if (/[\u2014\u2013\u201C\u201D\u2018\u2019]/.test(text)) report("WARN", "contains an em/en dash or curly quotes - use - and straight quotes");
  if (OPUS_REDUNDANT.test(prose)) report("WARN", "contains a re-check prompt ('double-check' / 'think step by step') - Opus does this itself");
  return findings;
}

function ownSkillDirs() {
  return readdirSync(SKILLS_ROOT)
    .sort()
    .map((entry) => join(SKILLS_ROOT, entry))
    .filter((path) => {
      try {
        if (SKIPPED_DIRS.has(basename(path)) || lstatSync(path).isSymbolicLink()) return false;
        return statSync(path).isDirectory() && existsSync(join(path, "SKILL.md"));
      } catch {
        return false;
      }
    });
}

function resolveTarget(item) {
  const asPath = resolve(item.replace(/^~(?=\/)/, homedir()));
  const path = existsSync(join(asPath, "SKILL.md")) ? asPath : join(SKILLS_ROOT, item);
  if (!existsSync(join(path, "SKILL.md"))) {
    console.log(`ERROR ${item}: no SKILL.md found (tried ${path})`);
    process.exit(2);
  }
  return path;
}

if (argumentsList.length === 0 || argumentsList.includes("--help")) {
  console.log("Usage: lint-skill.mjs [--root <skills dir>] --all | <skill name or dir>...");
  process.exit(2);
}
const targets = argumentsList.includes("--all") ? ownSkillDirs() : argumentsList.map(resolveTarget);

let errorCount = 0;
let warningCount = 0;
for (const skillDir of targets) {
  for (const { level, message } of lintSkill(skillDir)) {
    console.log(`${level.padEnd(5)} ${basename(skillDir)}: ${message}`);
    if (level === "ERROR") errorCount += 1;
    else warningCount += 1;
  }
}
console.log(`${targets.length} skill(s), ${errorCount} error(s), ${warningCount} warning(s)`);
process.exit(errorCount ? 1 : 0);
