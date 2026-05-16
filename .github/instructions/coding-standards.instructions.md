---
description: "Use when editing TypeScript, React, Express backend code, or tests."
applyTo: "backend/src/**/*.ts,frontend/src/**/*.{ts,tsx},**/*.{test,spec}.ts"
---

# Coding Standards

## Safety and Scope

- Make focused changes for the requested task only.
- Do not rewrite unrelated modules.
- Preserve backward compatibility unless asked to break it.

## Comments (Required)

- Add JSDoc/TSDoc comment blocks to all exported functions and classes.
- Use "why" comments (not "what") for code blocks **exceeding 5 lines**.
- Good: `// Why: Normalize across timezone boundaries before comparison`
- Bad: `// Loop through array and check each item`

## Architecture

- Keep backend and frontend concerns separated by workspace.
- Keep API behavior explicit and typed.
- Prefer existing patterns in each workspace before adding abstractions.

## Testing

- Update backend tests for backend logic changes.
- Do not disable tests to force passing results.

## Prohibited Changes

- Do not commit secrets, credentials, or generated binaries.
- Do not bypass lint or build checks.