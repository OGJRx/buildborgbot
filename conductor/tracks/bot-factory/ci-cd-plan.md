# Bot Factory CI/CD Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate deployments to Cloudflare Workers on every PR and push to the default branch using GitHub Actions.

**Architecture:** A GitHub Action workflow triggered by push events to the default branch (configured via `github.event.repository.default_branch`) and pull requests. Uses `cloudflare/wrangler-action` to handle deployments using secrets stored in GitHub.

**Tech Stack:** GitHub Actions, Wrangler CLI, Cloudflare API.

---

### Task 1: GitHub Action Workflow Setup

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Create workflow file**

```yaml
name: Deploy Bot Factory

on:
  push:
    branches:
      - '**' # Triggers on push to any branch
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  deploy:
    runs-on: ubuntu-latest
    name: Deploy to Cloudflare Workers
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install dependencies
        run: npm install
      - name: Deploy
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          # Use secrets for tokens or other dynamic vars if needed in CI/CD context
          # Note: bot tokens should be managed via `wrangler secret put` 
          # on the worker, not necessarily in the CI/CD pipeline, 
          # unless automating secret rotation.
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add automated deployment pipeline"
```

---

### Task 2: Configure Secrets in GitHub

**Instructions:**
1. Navigate to your repository on GitHub.
2. Go to **Settings > Secrets and variables > Actions**.
3. Create the following Repository Secrets:
   - `CLOUDFLARE_API_TOKEN`: Your Cloudflare API token with Workers permissions.
   - `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare Account ID.

- [ ] **Step 1: Verification**

Ensure your local repo is synced to add these secrets in the GitHub UI.

---

### Task 3: Final Verification

- [ ] **Step 1: Trigger CI/CD**

Push the changes to your repository to trigger the workflow.
Verify the workflow execution in the **Actions** tab of your GitHub repository.
