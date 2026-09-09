import { Hono } from "hono";

export type AppOptions = {
  /** Clock override for tests. Defaults to the real time. */
  now?: () => Date;
  /** fetch override for tests. Defaults to the global fetch. */
  fetcher?: typeof fetch;
};

export function createApp(options: AppOptions = {}) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  return app;
}

export default createApp();
