# Eval case format

`run-evals.mjs` packs the skills into a temporary plugin and runs `claude plugin eval` on it. Each run is isolated: no CLAUDE.md, no hooks, no MCP servers, no personal settings. Only the packed skills load.

## Contents
- Layout
- Trigger case
- Should-not-trigger case
- Behaviour case
- Data rules

## Layout

```
<skill>/evals/<case-name>/prompt.md
<skill>/evals/<case-name>/graders/<grader>.md
```

The case name becomes `<skill>--<case-name>` in the report.

## Trigger case

`prompt.md`:

```markdown
---
max_turns: 6
allowed_tools: [Skill, Read]
tags: [trigger]
---

summarize the attached sales.csv for me
```

`graders/fired.md`:

```markdown
---
type: tool_used
tool: Skill
input_match: '"skill"\s*:\s*"(?:[\w-]+:)?my-skill"'
---
```

## Should-not-trigger case

Same `prompt.md` shape, with a request a sibling skill owns. Grader:

```markdown
---
type: tool_used
tool: Skill
input_match: '"skill"\s*:\s*"(?:[\w-]+:)?my-skill"'
min: 0
max: 0
arm: both
---
```

Add a second grader that the sibling fired, so a silent run does not pass.

`Reached maximum number of turns` in the notes is expected. Keep `max_turns` at 6: a smaller model often looks around the workspace before it loads a skill.

## Behaviour case

Checks what the skill makes Claude do, against a baseline without the skill. Run it with `--ablation with-without`.

- `type: llm` - body is `PASS if ... FAIL if ...`. Judge defaults to haiku, use `--judge-model sonnet` when verdicts look wrong.
- `type: regex` - `pattern:` over the final reply.
- `type: tool_order` - `before:` and `after:`, each a tool name or `{ tool, input_match }`.
- `type: file_exists` - only files created during the run count.

Bash in a case needs `--allow-tools Bash` and runs inside the OS sandbox: no home dir, no network unless granted.

## Data rules

- Prompts use invented names and requests, never real people, customers or companies.
- No case reads a live mailbox, chat, ticket system or production system. Those skills get trigger cases only.
- Reports stay local: the script passes `--no-publish`.
