---
description: "Use when determining whether a feature, fix, or PR is complete."
applyTo: "**/*"
---

# Completion Criteria

Use this checklist before declaring work complete.

## Functional Completion

- Requested behavior is implemented end-to-end.
- Existing behavior outside scope is unchanged.
- Error states for touched flows are handled.

## Quality Gates

- Build passes: `npm run build`
- Lint passes: `npm run lint`
- Backend tests pass for backend logic changes: `npm run test --workspace=backend`

## Final Rule

Do not mark work complete unless all required checks pass.
