# Audit Fixes — Track 1 Implementation Plan (Finalized)

> **Goal:** Resolve all critical and minor failures from the PR Track 1 Audit Report. 
> **Strict Constraints:** Zero `any`/`as` casts in production code. TypeScript strict mode must pass (0 errors). Full multitenant isolation. 100% test coverage for fix areas. No scope creep.

---

### Task 1: Environment & Dependency Verification

- [ ] **Step 1: Clean install**
Run: `rm -rf node_modules package-lock.json && npm install`
- [ ] **Step 2: Inspect library exports**
Run: `rg 'export.*D1Adapter|create' node_modules/@grammyjs/storage-cloudflare/dist/index.d.ts -n`
Note: Determine if `D1Adapter.create` exists.

---

### Task 2: Type and API Fixes (engine.ts)

- [ ] **Step 1: Implement typed storage wrapper**
Do NOT use casts. Use an explicit wrapper to satisfy `StorageAdapter<Record<string, unknown>>`:
```typescript
const raw = new D1Adapter(db, "factory_sessions");
const storage: StorageAdapter<Record<string, unknown>> = {
  read: (key) => raw.read(key),
  write: (key, value) => raw.write(key, value),
  delete: (key) => raw.delete(key),
};
```
If this type does not match, investigate version mismatch, do not cast.

- [ ] **Step 2: Correct Context Typing (src/factory/types.ts)**
Avoid `& ConversationFlavor` directly if it causes TS4111. Use explicit type wrapping:
```typescript
type FactoryContext = Context & SessionFlavor<Record<string, unknown>> & {
  conversation: ConversationFlavor<Context>["conversation"];
  env: CoreEnv;
  botId: string;
};
```

- [ ] **Step 3: Implement multitenant isolation**
Add `getStorageKey` to `conversations` configuration to ensure `chatId:botId` isolation.

- [ ] **Step 4: Verify types**
Run: `npx tsc --noEmit`
Expect: 0 errors.

---

### Task 3: Optimize Logic (handlers.ts)

- [ ] **Step 1: Reorder handleAction logic**
Move the `if (action === "feedback")` block to the top of `handleAction` to avoid unnecessary D1 queries.

---

### Task 4: TDD & Coverage (engine.test.ts)

- [ ] **Step 1: Test Budget Exceeded**
Add test case to mock budget exceeded state and verify no AI call is made (no `mockGenerateContent`).

- [ ] **Step 2: Test handleSummarize**
Add test case to verify `db.batch` calls for DELETE and INSERT message_id 0.

- [ ] **Step 3: Test handleAction feedback**
Add test case to verify `ctx.conversation.enter` invocation for "feedback" action.

---

### Task 5: Final Validation

- [ ] **Step 1: Run full test suite**
Run: `npm test`
Expect: 100% pass.

- [ ] **Step 2: Final Type Check**
Run: `npx tsc --noEmit`
Expect: 0 errors.

- [ ] **Step 3: Audit Check**
Run: `rg '\bas\b ' src/ --type ts`
Expect: 0 results (excluding `as const`/`as unknown` in test mocks).
