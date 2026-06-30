// Vercel serverless adapter for the StreetJS app.
//
// Vercel runs each request through a serverless function rather than a
// long-running server, so instead of `app.listen()` we assemble the StreetJS
// app once per cold start and route every incoming request to the framework's
// in-process handler (`_handleRequest`, the same entry point the docs note is
// "used by the edge adapter and tests").
//
// IMPORTANT (untested against live Vercel): this adapter is assembled from the
// documented StreetApp surface but is not an officially published Vercel
// integration — verify on a preview deployment. The built backend (dist/) and
// the React SPA (web/dist) must be present in the deployment; see DEPLOY.md.

import type { IncomingMessage, ServerResponse } from "node:http";

import { assembleApp } from "../dist/server.js";
import type { StreetApp } from "streetjs";

/**
 * Cold-start singleton: assemble the app once and reuse across invocations on
 * the same warm instance. A failed assembly is not cached, so the next request
 * retries (e.g. after fixing env vars).
 */
let appPromise: Promise<StreetApp> | null = null;

async function getApp(): Promise<StreetApp> {
  if (!appPromise) {
    // Collect startup error messages and convert process-exit into a thrown
    // error, so a misconfiguration surfaces as a readable 500 instead of a
    // FUNCTION_INVOCATION_FAILED crash (bootstrap would otherwise process.exit).
    const startupErrors: string[] = [];
    appPromise = assembleApp({
      printError: (m: string) => startupErrors.push(m),
      log: () => undefined,
      exit: (code: number) => {
        throw new Error(
          `Startup aborted (exit ${code}): ${
            startupErrors.join("; ") || "see configuration/plugin errors"
          }`,
        );
      },
    }).then((result) => {
      if (!result) {
        throw new Error(
          `App assembly aborted: ${startupErrors.join("; ") || "unknown error"}`,
        );
      }
      return result.app;
    });
    // Don't cache a rejected promise — let the next request try again.
    appPromise.catch(() => {
      appPromise = null;
    });
  }
  return appPromise;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const app = await getApp();
    app._handleRequest(req, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "server_initialization_failed", message }));
  }
}
