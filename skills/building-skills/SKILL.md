---
name: building-skills
description: Builds, reviews and lints agent skills the evaluation-driven way from Anthropic's skill authoring best practices - baseline run without the skill, three eval cases, minimal SKILL.md, lint, then trigger and behaviour evals on every model that will run it. Use when creating, writing, scaffolding, renaming, splitting or reviewing a skill, when asked why a skill is never picked, does not trigger or fires on the wrong request (load this before opening that skill's files), when a SKILL.md grows past 500 lines, or when asked to lint or audit the skill library. Not for hooks, settings or plugin manifests.
---

# Building skills

`<skill-dir>` = the directory holding this SKILL.md. Scripts live in `<skill-dir>/scripts/`. Run them, do not read them.

Skills root for both scripts: `--root <dir>`, else env `SKILLS_DIR`, else `~/.claude/skills`.

Evals need Claude Code (`claude plugin eval`). Other agents: lint only, check triggers by hand.

## New skill

Copy this checklist into your reply and tick it off:

```
- [ ] 1. Baseline without the skill
- [ ] 2. Three eval cases
- [ ] 3. Minimal SKILL.md
- [ ] 4. Lint clean
- [ ] 5. Evals pass on every target model
- [ ] 6. Review and ship
```

**1. Baseline.** Run the task once without a skill in a fresh subagent. Write down each concrete failure: wrong tool, missing fact, wrong order, wrong output shape. No failures -> no skill needed. Say so and stop.

**2. Eval cases.** One per failure, minimum three, in `<skill>/evals/<case>/`. Always include:
- an obvious trigger ("summarize this CSV file")
- a paraphrased trigger ("what is in this spreadsheet export?")
- a should-not-trigger request that a sibling skill owns

Format and grader examples: [references/eval-format.md](references/eval-format.md).

**3. Minimal SKILL.md.** Write only what fixes the baseline failures. Rules below.

**4. Lint.**

```bash
node <skill-dir>/scripts/lint-skill.mjs --root <skills dir> <skill>
```

Fix every `ERROR`. Fix a `WARN` or name the reason it does not apply. Rerun until clean.

**5. Evals.** Run on each model that will use the skill:

```bash
node <skill-dir>/scripts/run-evals.mjs --root <skills dir> <skill> --model haiku
```

| Skill is run by | Models to test |
|---|---|
| The main session only | the main session's models, for example opus and sonnet |
| A Haiku subagent too | opus, sonnet, haiku |

A trigger case fails -> fix the description, not the body. A behaviour case fails only on haiku -> add the missing explicit step.

**6. Ship.** Review the diff, then ship the way the skills repo expects. Repo-specific steps (docs pages, README tables) belong in that repo's README or AGENTS.md, not in a skill.

## Existing skill or the whole library

- Lint all: `node <skill-dir>/scripts/lint-skill.mjs --root <skills dir> --all`. Vendored skills: one name per line in `<skills dir>/.skill-lint-ignore`.
- Skill does not trigger: add an obvious and a paraphrased case, run evals, then fix the description.
- Fires on the wrong request: add a should-not-trigger case, then add a `Not for X - use Y` clause to both descriptions.
- Rename: `git mv` the directory, set `name:`, then grep the old name across the skills root, `.gitattributes` and the agent config (instructions, agents, rules, hooks, settings). Check scripts too: import paths and hard-coded `<skills root>/<name>` paths. Run the renamed skill's tests.

## Rules

**Name**
- Gerund: `processing-pdfs`, `reading-videos`. Lowercase, digits, hyphens, max 64 chars, no `claude` or `anthropic`.
- Own new skills always use a gerund name. Skills vendored from outside keep their upstream name.

**Description** - always loaded, it is how the skill gets picked
- Third person, what first: "Records ...", never "Use when ..." first and never "I can" / "You can".
- Then `Use when` with the words the user actually types, in quotes.
- Then `Not for X - use Y` for each sibling that shares trigger words.
- Max 1024 chars, no `<` or `>`. Over budget: cut filler first, then far-off boundaries, never the what and the main triggers.

**Body**
- Under 500 lines. Over that: move a section to `references/<topic>.md`.
- Link every reference file directly from SKILL.md, with one line on when to read it. A reference file never links to another reference file.
- A reference file over 100 lines starts with a `## Contents` list.
- Only what the agent does not already know. No explanations of common tools or formats.
- One default per job, plus an escape hatch. Not a menu of options.
- One term per thing, throughout.
- Fragile sequence -> exact command and "do not change the flags". Judgment work -> goal and constraints only.
- Steps that must not be skipped -> a copyable checklist plus a validate -> fix -> repeat loop.
- Scripts: say "Run" (execute) or "See" (read). Scripts handle their own errors and print what to fix. Every constant gets its reason.
- Forward slashes in every path. Script paths as `<skill-dir>/...`, so they work wherever the skill is installed.
- MCP tools fully qualified: `server:tool`.
- No dates that go stale (`before October 2026 use ...`). Old ways go into a collapsed `Old patterns` section.
- Generic by default. If the skill can work for anyone, write it for anyone: no personal paths, no user, people, repo or company names, no customer data, no names of other skills, no personal tools, agents or config. Examples, eval prompts and test fixtures use invented names (`Acme`). A skill that only makes sense in one environment keeps only the specifics it needs to work.
- Stands alone: no wikilinks, no notes-vault paths, no "see the note on X". Inline the fact.
- Opus: no `double-check your work`, `think step by step` or `only report high-severity` lines. It verifies by itself and follows limits literally.
- Haiku: spell out each step and the expected output. It does not fill gaps.
- Text style: action first, short flat sentences, tables and lists, no em dash, no curly quotes.
