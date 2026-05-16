---
name: project-completion
description: "Use when evaluating if work is complete, defining acceptance criteria, or checking merge readiness. Keywords: done, complete, acceptance criteria, ready to merge."
---

# Project Completion Skill

Use this skill when deciding whether work is complete.

## Trigger Phrases

- definition of done
- acceptance criteria
- complete this task
- is this ready to merge

## Steps

1. List explicit user requirements.
2. Verify each requirement has implementation evidence.
3. Run required validations for changed areas.
4. Return a pass/fail summary with blockers.

## Required Validation Commands

- `npm run build`
- `npm run lint`
- `npm run test --workspace=backend` for backend logic changes
