# AGENTS

Behavioral contract for coding agents. Refer to [.github/copilot-instructions.md](.github/copilot-instructions.md) and [.github/instructions](.github/instructions) for task-specific guidance.

## Core Standards

- Keep TypeScript/lint quality intact; preserve backend/frontend boundaries.
- Make focused, localized changes; update tests when behavior changes.
- Never commit secrets or bypass checks.

## Awesome-Copilot Imports (Whitelist)

- `agents/typescript-mcp-expert.agent.md`
- `instructions/typescript-mcp-server.instructions.md`
- `instructions/code-review-generic.instructions.md`
- `skills/javascript-typescript-jest/SKILL.md`

❌ **Exclude:** Ruby, Go, PHP, Java, C#, Terraform, cloud stacks, or anything unlisted.

## Safety Guardrails

**Tool Guardian** blocks dangerous operations at pre-execution. See [awesome-copilot/docs/GUARDRAILS.md](https://github.com/github/awesome-copilot/blob/main/docs/GUARDRAILS.md) for blocked patterns. Override: `SKIP_TOOL_GUARD=true`.

## Definition of Complete

All acceptance criteria pass + checks green (`npm run build`, `npm run lint`, `npm run test --workspace=backend` for backend changes).

## Essential Files

- [.github/copilot-instructions.md](.github/copilot-instructions.md)
- [.github/instructions/coding-standards.instructions.md](.github/instructions/coding-standards.instructions.md) — Function docs, why-comments for 5+ line blocks
- [.github/instructions/completion-criteria.instructions.md](.github/instructions/completion-criteria.instructions.md)
- [.github/instructions/dependency-upgrades.instructions.md](.github/instructions/dependency-upgrades.instructions.md) — Systematic node module updates
- [.github/agents/project-maintainer.agent.md](.github/agents/project-maintainer.agent.md)
- [.github/hooks.json](.github/hooks.json) — Tool guardian config