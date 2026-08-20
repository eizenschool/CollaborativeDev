@AGENTS.md

# Claude Code Notes

Use `AGENTS.md` as the shared team instruction source.

The repository `docs/ai/MEMORY.md` is shared project context, not a substitute for Claude Code's private/local memory.

Follow the same progressive module-context loading rules as Codex:

```text
AGENTS.md
-> docs/ai/UI.md for UI/presentation work
-> relevant docs/ai/modules/Mx_*.md
-> relevant source files
-> conditional shared context only when needed
```
Do not load every file under `docs/ai/` automatically.
Do not load all six module context files by default.
