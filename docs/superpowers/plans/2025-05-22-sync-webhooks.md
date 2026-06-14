# Sync Webhooks Implementation Plan

**Goal:** Automate Telegram webhook registration for Bot Factory bots.

**Architecture:**
1.  **Backend Update:** Add a protected GET `/api/factory/bots` endpoint to `src/index.ts` to list all registered bots from the `factory_bots` table.
2.  **Automation Script:** Create `scripts/sync-webhooks.js` to:
    *   Fetch the bot list from the new endpoint, authenticating with `TITANIUM_API_SECRET`.
    *   Iterate through each bot, retrieve its Telegram token from `process.env` using `token_var_name`.
    *   Call Telegram's `setWebhook` API to point to the bot's specific webhook URL.

**Tech Stack:**
*   Node.js (for the script)
*   Cloudflare Workers (for the backend modification)

---

### Task 1: Update Backend to support listing bots
- Modify `src/index.ts` to include a GET `/api/factory/bots` route.
- Authentication: Verify `x-titanium-api-secret` header against `env.TITANIUM_API_SECRET`.

### Task 2: Implement Sync Script
- Create `scripts/sync-webhooks.js`.
- Use `node-fetch` (or built-in `fetch` if Node version is modern).
- Handle configuration: `WORKER_URL`, `TITANIUM_API_SECRET`, and individual bot tokens (all assumed to be available in `process.env`).

### Task 3: Verification
- Verify the new endpoint exists and is protected.
- Verify the script correctly iterates and calls Telegram.
