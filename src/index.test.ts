import { describe, it, expect, vi } from "vitest";
import worker from "./index";
import { FactoryEngine } from "./factory/engine";

vi.mock("./factory/engine", () => ({
  FactoryEngine: {
    handleUpdate: vi.fn(() => new Response("OK")),
  },
}));

describe("Worker Entry Point", () => {
  it("should return 404 for unknown routes", async () => {
    const request = new Request("http://localhost/unknown");
    const env = { DB: { prepare: vi.fn() } } as any;
    const ctx = { waitUntil: vi.fn() } as any;
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(404);
  });

  it("should route webhooks to FactoryEngine", async () => {
    const request = new Request("http://localhost/webhook/factory/bot1", {
      method: "POST",
      body: JSON.stringify({ update_id: 1 }),
    });
    const env = { DB: { prepare: vi.fn() } } as any;
    const ctx = { waitUntil: vi.fn() } as any;
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(200);
    expect(FactoryEngine.handleUpdate).toHaveBeenCalled();
  });
});
