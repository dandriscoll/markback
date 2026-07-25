# Agent skills

Skills that teach a coding agent to work in Markback directly — no tooling in
the loop, no guessing at the syntax.

| Skill | What it covers |
|---|---|
| [`markback`](./markback/SKILL.md) | Reading and writing `.mb` files by hand: headers, the four layouts, `%` file headers, position ranges, structured feedback, canonical form, lint codes. `references/tooling.md` covers the CLI, the Python and Node APIs, and the VS Code extension. |

## Installing

The format is the [Agent Skills](https://code.claude.com/docs/en/skills)
convention — a directory with a `SKILL.md` whose frontmatter `description` tells
the agent when to load it. Copy or symlink the skill directory into wherever
your agent looks for skills:

```bash
# Claude Code — for one project
mkdir -p .claude/skills && cp -r skills/markback .claude/skills/

# Claude Code — for every project
cp -r skills/markback ~/.claude/skills/
```

For an agent that reads a single instructions file instead, paste
`markback/SKILL.md` into it, or point at it from there.
