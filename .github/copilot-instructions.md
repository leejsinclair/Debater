# Copilot Instructions

These instructions guide GitHub Copilot behavior in this repository.

## Scope

Applies to all coding tasks in this workspace.

## Before Coding

- Read [AGENTS.md](../AGENTS.md).
- Load applicable files in [.github/instructions](instructions).
- Keep edits focused on the requested change.
- If reusing awesome-copilot content, follow the whitelist in [AGENTS.md](../AGENTS.md) only.

## Implementation Expectations

- Keep edits minimal and localized.
- Match existing naming, style, and architecture.
- Avoid changing unrelated files.
- Add or update backend tests when behavior changes.

## Validation Expectations

Run the smallest necessary set of checks for the change type:

- Always: `npm run build`
- Style/lint-sensitive edits: `npm run lint`
- Backend logic changes: `npm run test --workspace=backend`

## Done Criteria

A task is complete only when relevant acceptance criteria and checks pass.

## Safety Guardrails

This repository uses **Tool Guardian** to intercept and block dangerous operations before execution. See [AGENTS.md](../AGENTS.md) for the blocked patterns and override instructions.