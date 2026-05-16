---
description: "Use when updating npm dependencies incrementally and safely."
applyTo: "package.json,package-lock.json,.nvmrc"
---

# Dependency Upgrade Workflow

## Philosophy

Update dependencies **incrementally per-package** with validation after each step. This ensures you can pinpoint breaking changes and avoid cascading failures.

## Systematic Approach

### Step 1: Discovery

```bash
npm outdated
```

This shows:
- `Current` → `Wanted`: Safe updates (minor/patch)
- `Wanted` → `Latest`: Major upgrades (may have breaking changes)

### Step 2: Group Updates

Create two lists:
- **Safe**: packages where `Current → Wanted` (minor/patch updates)
- **Major**: packages where `Wanted → Latest` (major versions)

### Step 3: Apply Safe Updates (One Per Package)

For **each** package in the Safe list:

```bash
# Update single package to latest minor/patch
npm update <package>
```

Then **immediately validate**:

```bash
npm run lint          # Check code style
npm run build         # Verify build succeeds
npm run test          # Run unit tests (backend/frontend)
npm test --workspace=backend  # For workspace projects
```

If validation passes, review changes:

```bash
git diff package.json
git diff package-lock.json
```

**Before moving to next package**, ensure all checks pass.

### Step 4: Security Check

After all safe updates:

```bash
npm audit --json
```

If vulnerabilities exist:
- Identify the dependency chain (`npm ls <vulnerable-package>`)
- Decide: update the dependent package or skip if incompatible

### Step 5: Major Upgrades (One Tool Family at a Time)

For **each** major version upgrade:

```bash
# Explicit major version install
npm install <package>@<major-version>
```

Then **immediately validate**:

```bash
npm run lint
npm run build
npm run test
```

Common major upgrades (in suggested order):
1. Test runners (Vitest, Jest, Playwright)
2. Build tools (Vite, Webpack)
3. Framework/runtime (React, Express)
4. Other tooling (ESLint, TypeScript)

### Step 6: E2E Validation (if applicable)

```bash
npm run test:e2e
```

This catches integration issues missed by unit tests.

### Step 7: Commit

```bash
git add package.json package-lock.json
git commit -m "chore: upgrade dependencies

- Updated [list packages and versions]
- All validations passed: lint, build, test
- npm audit: [status]"
```

## Guardrails

- ❌ **Never** use `npm update` on the entire tree at once—too risky
- ❌ **Never** use `npm audit fix --force` without understanding the conflict
- ❌ **Never** use `npm install --force` unless explicitly necessary
- ❌ **Never** mix dependency updates with unrelated code changes

## If Something Breaks

1. Review the last `npm update` command
2. Check the package's CHANGELOG for breaking changes
3. Determine if it's a code issue (fix) or incompatibility (revert and wait)
4. Revert if needed: `npm install <package>@<previous-version>`
5. Run full validation suite again

## Project Context

- **Backend**: Node.js + Express
- **Frontend**: React + TypeScript
- **Workspace**: npm workspaces (validate both backend and frontend)
- **Tested Node version**: 24.2.0
- **Bootstrap**: Run `nvm use` before npm commands (if nvm installed)
