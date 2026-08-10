# Impeccable (vendored)

Design skill for frontend work: `/impeccable <command> [target]`. Run `/impeccable init`
once per surface to capture design context, then commands like `critique`, `audit`,
`polish`, `harden`, and `layout` read it.

## Provenance

| | |
|---|---|
| Upstream | https://github.com/pbakaus/impeccable |
| Version | skill `4.0.4` (tag `skill-v4.0.4`, commit `9a949fb543d44cfb406f61bcab99d95d7f12cf1d`) |
| License | Apache-2.0 — see `.claude/LICENSE-impeccable` |
| Author | Paul Bakaus |

Vendored files:

- `.claude/skills/impeccable/` — the skill (SKILL.md, reference playbooks, detector scripts)
- `.claude/agents/impeccable-*.md` — subagents the skill delegates to

The skill's scripts depend only on Node builtins and require Node >= 22, so nothing
needs installing.

## Why vendored instead of installed

Upstream's installer (`npx impeccable install`) downloads its bundle from
`impeccable.style`, which this environment's network policy blocks. The files here are
copied verbatim from the `skill-v4.0.4` tag, which is what the installer would have
written for the `claude` provider at project scope.

## The detector hook is not committed

Upstream installs a `PostToolUse` + `Stop` hook that runs the deterministic detector on
UI edits. It belongs in `.claude/settings.local.json`, which is machine-local and
gitignored, so each person opts in themselves. The manifest is committed here as an
example — to enable it:

```bash
cp .claude/settings.local.json.example .claude/settings.local.json
```

Restart Claude Code afterward; hooks load at session start. The skill works fully
without it — the hook only adds automatic scanning on UI edits.

## Updating

Re-copy from a newer tag and update the version above:

```bash
git clone --depth 1 --branch skill-vX.Y.Z https://github.com/pbakaus/impeccable /tmp/impeccable
rm -rf .claude/skills/impeccable && cp -R /tmp/impeccable/.claude/skills/impeccable .claude/skills/
cp /tmp/impeccable/.claude/agents/impeccable-*.md .claude/agents/
```

`node .claude/skills/impeccable/scripts/doctor.mjs` reports drift between the installed
files and what the current version expects.
