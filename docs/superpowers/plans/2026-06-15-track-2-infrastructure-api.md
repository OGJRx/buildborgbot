# Track 2: Infrastructure & API Readiness Implementation Plan

> **Goal:** Solidify infrastructure (CI/CD pipeline) and prepare the backend API/Worker interface for dashboard consumption.
> **Scope:** CI/CD hardening, pipeline security, API contract stability.

---

### Task 1: Infrastructure Hardening (CI/CD)

- [ ] **Step 1: Update GitHub Actions pipeline**
Modify `.github/workflows/deploy.yml` to include `tsc --noEmit` before `wrangler deploy`.
- [ ] **Step 2: Add linting gate**
Add `eslint` or `biome` check to ensure code quality standards before deployment.
- [ ] **Step 3: Verification**
Push a test commit to verify the pipeline fails on type errors.

---

### Task 2: API Contract Stability

- [ ] **Step 1: Formalize Zod Schemas**
Move all API schemas (Config, Memory, Sequence, etc.) to a shared location `src/factory/schemas.ts` and export them. Ensure FE and BE use the same validation logic.
- [ ] **Step 2: Add Response Typing**
Ensure all API endpoints return strictly typed JSON responses matching the schemas.

---

### Task 3: Dashboard Readiness

- [ ] **Step 1: Implement "Summarize" Logic (Optimized)**
Verify `handleSummarize` in `handlers.ts` is robust. Ensure it's ready for REST API calls as well as Telegram callbacks.
- [ ] **Step 2: Add `/api/health`**
Implement a simple health check endpoint for monitoring.
- [ ] **Step 3: Documentation**
Generate a simple `API.md` file documenting the endpoints, required headers (`x-titanium-api-secret`), and example payloads.

---

### Task 4: Validation

- [ ] **Step 1: Final Pipeline Audit**
Run pipeline on branch and verify all stages (lint, typecheck, test, build).
- [ ] **Step 2: Final Contract Verification**
Test API endpoints with a curl request to verify schema validation.
