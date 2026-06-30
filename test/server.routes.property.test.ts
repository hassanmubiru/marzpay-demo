// Feature: streetjs-marzpay-demo, Property 4: Unmatched routes return 404
//
// Validates: Requirements 2.6
//
// For any request whose method+path pair is NOT one of the four registered
// routes (GET /, POST /checkout, GET /success, POST /webhooks/marzpay), the
// application responds with HTTP status 404.
//
// The test builds the REAL StreetApp via `bootstrap` with the four real
// controllers registered. To avoid a live MarzPay network install we pass a
// no-op stub plugin, initialize the schema against an in-memory SQLite
// database, and disable `listen`. We then drive genuine in-process requests
// through the framework's `_handleRequest` handler (the same entry point used
// by the production HTTP server) by wrapping it in an http.Server bound to an
// ephemeral port and issuing real HTTP requests with `fetch`.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { PluginModule } from "streetjs";

import { bootstrap, CONTROLLERS } from "../src/server.js";
import { closeStore, initSchema } from "../src/db/payments.js";

/** A no-op plugin standing in for the real MarzPay plugin (no network). */
class StubMarzPayPlugin extends PluginModule {
  readonly name = "stub-marzpay";
  readonly version = "0.0.0";
  // No onLoad: the plugin registers nothing, so routing is unaffected.
}

/** The four registered routes; everything else must 404 (Req 2.6). */
const REGISTERED: ReadonlyArray<readonly [string, string]> = [
  ["GET", "/"],
  ["POST", "/checkout"],
  ["GET", "/success"],
  ["POST", "/webhooks/marzpay"],
];

/** True when (method, path) is exactly one of the four registered routes. */
function isRegistered(method: string, path: string): boolean {
  return REGISTERED.some(([m, p]) => m === method && p === path);
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  // Build the real app: four controllers, stub plugin, in-memory SQLite, no
  // port binding from bootstrap itself.
  const result = await bootstrap({
    env: {
      MARZPAY_API_KEY: "test-api-key",
      MARZPAY_SECRET_KEY: "test-secret-key",
      MARZPAY_ENVIRONMENT: "sandbox",
      APP_URL: "https://demo.test",
      PORT: "3000",
    },
    pluginFactory: () => new StubMarzPayPlugin(),
    controllers: CONTROLLERS,
    initSchema: () => initSchema({ filePath: ":memory:" }),
    listen: false,
    // Silence bootstrap logging during the test run.
    log: () => {},
    printError: () => {},
  });

  if (!result) {
    throw new Error("bootstrap aborted unexpectedly during test setup");
  }

  // Drive the framework's in-process request handler through a real HTTP
  // server bound to an ephemeral port (supertest-style, but dependency-free).
  const app = result.app;
  server = createServer((req, res) => app._handleRequest(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await closeStore();
});

describe("Property 4: Unmatched routes return 404", () => {
  it("responds 404 for any method+path pair that is not a registered route", async () => {
    // A URL path segment from a safe, URL-clean alphabet.
    const segment = fc
      .string({ minLength: 1, maxLength: 10 })
      .map((s) => s.replace(/[^a-zA-Z0-9_-]/g, ""))
      .filter((s) => s.length > 0);

    // A path: "/" plus 0..4 segments joined by "/". Can produce "/", literal
    // registered paths, near-misses (e.g. "/checkout/extra"), and arbitrary
    // unmatched paths.
    const pathArb = fc
      .array(segment, { maxLength: 4 })
      .map((parts) => "/" + parts.join("/"));

    const methodArb = fc.constantFrom("GET", "POST", "PUT", "DELETE", "PATCH");

    // Any (method, path) pair excluded from the four registered routes.
    const unmatchedPair = fc
      .tuple(methodArb, pathArb)
      .filter(([method, path]) => !isRegistered(method, path));

    await fc.assert(
      fc.asyncProperty(unmatchedPair, async ([method, path]) => {
        const res = await fetch(`${baseUrl}${path}`, { method });
        // Drain the body so the connection is released between runs.
        await res.text();
        expect(res.status).toBe(404);
      }),
      { numRuns: 100 },
    );
  });
});
