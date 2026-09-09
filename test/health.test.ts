import { describe, expect, it } from "vitest";
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { createApp } from "../src/index";

describe("GET /health", () => {
  it("returns ok", async () => {
    const app = createApp();
    const ctx = createExecutionContext();
    const response = await app.fetch(new Request("http://localhost/health"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("GET /", () => {
  it("serves the homepage", async () => {
    const app = createApp();
    const ctx = createExecutionContext();
    const response = await app.fetch(new Request("http://localhost/"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Not an Octopus Energy product");
    expect(html).toContain("/trmnl?region=");
  });
});
