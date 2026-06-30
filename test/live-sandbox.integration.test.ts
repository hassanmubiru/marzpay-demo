// Feature: streetjs-marzpay-demo, Task 9.1: Live MarzPay sandbox integration tests (NO MOCKS)
//
// Validates: Requirements 1.9, 2.2, 2.3, 2.4, 4.4, 5.6, 6.2
//
// These are REAL integration tests against the genuine MarzPay sandbox. Per the
// spec's no-mock mandate, NOTHING here is stubbed: the real `bootstrap()` runs
// the real `validateConfig`, installs the real `@streetjs/plugin-marzpay`
// against `MarzPay_Sandbox`, binds a real port, and drives the live
// mobile-money path `collectMoney` -> `getStatus` / `transactions.get` through
// the MarzPay client injected at `ctx.state.marzpay`.
//
// Credentials are read from the environment (`.env` is loaded via dotenv):
//   - MARZPAY_API_KEY, MARZPAY_SECRET_KEY   (required for ANY live test)
//   - MARZPAY_ENVIRONMENT                   (optional; defaults to "sandbox")
//   - MARZPAY_TEST_PHONE                    (a sandbox MSISDN; required only for
//                                            the live collectMoney flow)
//
// When the sandbox credentials are ABSENT the live suite is SKIPPED gracefully
// (it does not fail the test run). A separate always-on test prints a clear
// reason so it is obvious in CI why the live cases did not execute.

import "reflect-metadata";

import net from "node:net";
import { randomUUID } from "node:crypto";

import { config as loadDotenv } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Controller, Get } from "streetjs";
import type { StreetApp, StreetContext } from "streetjs";

import { bootstrap, CONTROLLERS, MARZPAY_STATE_KEY } from "../src/server.js";
import { initSchema, closeStore } from "../src/db/payments.js";
import type { MarzPayClient } from "../src/services/marzpay-types.js";

// Load `.env` so a developer's local sandbox credentials are picked up.
loadDotenv();

/** Read a trimmed, non-empty environment value or `undefined`. */
function envValue(key: string): string | undefined {
  const raw = process.env[key];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

const API_KEY = envValue("MARZPAY_API_KEY");
const SECRET_KEY = envValue("MARZPAY_SECRET_KEY");
const TEST_PHONE = envValue("MARZPAY_TEST_PHONE");

/** Live tests need both credentials; otherwise the suite is skipped. */
const HAS_CREDENTIALS = API_KEY !== undefined && SECRET_KEY !== undefined;

/** The mobile-money collection flow additionally needs a sandbox MSISDN. */
const HAS_PHONE = HAS_CREDENTIALS && TEST_PHONE !== undefined;

/** The resolved environment the plugin is expected to run against. */
const EXPECTED_ENVIRONMENT =
  envValue("MARZPAY_ENVIRONMENT") === "production" ? "production" : "sandbox";

const SKIP_REASON =
  "MARZPAY_API_KEY / MARZPAY_SECRET_KEY are not set — skipping live MarzPay " +
  "sandbox integration tests (set real sandbox credentials in .env to run them)";

const PHONE_SKIP_REASON =
  "MARZPAY_TEST_PHONE is not set — skipping the live collectMoney flow (set a " +
  "sandbox MSISDN in .env to drive collectMoney -> getStatus/transactions.get)";

// Fixed collection parameters mandated by the spec (UGX 5000, Uganda).
const PAYMENT_AMOUNT = 5000;
const PAYMENT_COUNTRY = "UG";
const PAYMENT_CURRENCY = "UGX";

/**
 * Captures the MarzPay client the plugin injects at `ctx.state.<stateKey>` so a
 * test can both confirm the exposure AND drive the live calls through the very
 * object the framework hands to controllers. Reset before each capture.
 */
let capturedClient: MarzPayClient | undefined;

/**
 * A tiny probe controller registered alongside the four real controllers. Its
 * only job is to read `ctx.state.marzpay` and surface what the plugin exposed,
 * so the test can assert the client is present on the live request path.
 */
@Controller("/__probe")
class ProbeController {
  @Get("/")
  run(ctx: StreetContext): void {
    const client = ctx.state[MARZPAY_STATE_KEY] as MarzPayClient | undefined;
    capturedClient = client;
    ctx.json({
      stateKey: MARZPAY_STATE_KEY,
      marzpayPresent: client !== undefined,
      hasCollectMoney:
        typeof client?.collections?.collectMoney === "function",
      hasGetStatus: typeof client?.collections?.getStatus === "function",
      hasTransactionsGet: typeof client?.transactions?.get === "function",
    });
  }
}

/** Resolve an unused TCP port on the loopback interface. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** True when something is already accepting connections on `port`. */
function isPortBound(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.setTimeout(1000);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

// An informational, always-on breadcrumb so the run clearly communicates why
// the live suite did (or did not) execute. Never fails the build.
describe("live MarzPay sandbox integration — prerequisites", () => {
  it(
    HAS_CREDENTIALS
      ? "sandbox credentials present — live integration tests will run"
      : "sandbox credentials absent — live integration tests are skipped",
    () => {
      if (!HAS_CREDENTIALS) {
        // eslint-disable-next-line no-console
        console.warn(`[live-sandbox] ${SKIP_REASON}`);
      } else if (!HAS_PHONE) {
        // eslint-disable-next-line no-console
        console.warn(`[live-sandbox] ${PHONE_SKIP_REASON}`);
      }
      expect(true).toBe(true);
    },
  );
});

describe.skipIf(!HAS_CREDENTIALS)(
  "live MarzPay sandbox integration (no mocks)",
  () => {
    let app: StreetApp;
    let port: number;
    let boundBeforeBootstrap = false;

    beforeAll(async () => {
      port = await getFreePort();
      // Confirm nothing is listening on the chosen port BEFORE startup, so the
      // post-bootstrap reachability check proves the bind happened during the
      // real validate -> install -> listen sequence (Req 1.9).
      boundBeforeBootstrap = await isPortBound(port);

      // Drive the genuine bootstrap: real validateConfig + real MarzPayPlugin
      // install against the sandbox. Only the env (to pin an ephemeral PORT and
      // ensure APP_URL is present), the controller list (to add the probe), and
      // the schema target (in-memory so no payments.db file is written) are
      // supplied — the validation and plugin install are entirely real.
      const env: Record<string, string | undefined> = {
        ...process.env,
        PORT: String(port),
        APP_URL: envValue("APP_URL") ?? `http://127.0.0.1:${port}`,
      };

      const result = await bootstrap({
        env,
        controllers: [ProbeController, ...CONTROLLERS],
        initSchema: () => initSchema({ filePath: ":memory:" }),
        listen: true,
        log: () => undefined,
        printError: (message) => {
          // Surface unexpected startup errors to aid diagnosis.
          // eslint-disable-next-line no-console
          console.error(`[live-sandbox bootstrap] ${message}`);
        },
        exit: () => undefined,
      });

      // A valid config + successful real install must yield a running app.
      expect(result).toBeDefined();
      app = result!.app;
      // The port bound is exactly the configured PORT (Req 1.9).
      expect(result!.config.port).toBe(port);
      // The resolved environment passed through to the plugin (Req 2.3).
      expect(result!.config.marzpayEnvironment).toBe(EXPECTED_ENVIRONMENT);
    }, 60_000);

    afterAll(async () => {
      if (app) {
        await app.close();
      }
      await closeStore();
    });

    it("binds the port only after valid configuration and a successful plugin install (Req 1.9, 2.2, 2.3)", async () => {
      // The port was free before bootstrap...
      expect(boundBeforeBootstrap).toBe(false);
      // ...and is reachable only after the real validate -> install -> listen
      // sequence completed, which is exactly the "bind last" ordering.
      await expect(isPortBound(port)).resolves.toBe(true);
    });

    it("exposes the MarzPay client at ctx.state.marzpay on the live request path (Req 2.4)", async () => {
      capturedClient = undefined;

      const res = await fetch(`http://127.0.0.1:${port}/__probe`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        stateKey: string;
        marzpayPresent: boolean;
        hasCollectMoney: boolean;
        hasGetStatus: boolean;
        hasTransactionsGet: boolean;
      };

      // The client is injected under the configured state key (default
      // "marzpay") and carries the verified capability surface this demo uses.
      expect(body.stateKey).toBe(MARZPAY_STATE_KEY);
      expect(body.marzpayPresent).toBe(true);
      expect(body.hasCollectMoney).toBe(true);
      expect(body.hasGetStatus).toBe(true);
      expect(body.hasTransactionsGet).toBe(true);

      // The same object is available to the test for driving live calls.
      expect(capturedClient).toBeDefined();
      expect(typeof capturedClient!.collections.collectMoney).toBe("function");
      expect(typeof capturedClient!.collections.getStatus).toBe("function");
      expect(typeof capturedClient!.transactions.get).toBe("function");
    });

    it.skipIf(!HAS_PHONE)(
      "drives the live mobile-money path collectMoney -> getStatus -> transactions.get against the sandbox (Req 4.4, 5.6, 6.2)",
      async () => {
        // Ensure we hold the live client the framework injects at ctx.state.
        if (!capturedClient) {
          const res = await fetch(`http://127.0.0.1:${port}/__probe`);
          expect(res.status).toBe(200);
          await res.json();
        }
        const marzpay = capturedClient!;
        expect(marzpay).toBeDefined();

        // A unique Reference correlates the collection, the status check, and
        // the transaction read (the same correlation the checkout flow uses).
        const reference = `demo-itest-${randomUUID()}`;

        // (Req 4.4) Initiate the real mobile-money collection: amount 5000,
        // country UG, the submitted phone, and our Reference.
        const collection = await marzpay.collections.collectMoney({
          amount: PAYMENT_AMOUNT,
          country: PAYMENT_COUNTRY,
          reference,
          phone_number: TEST_PHONE!,
        });
        expect(collection.reference).toBe(reference);
        expect(typeof collection.status).toBe("string");
        // Mobile money returns no card redirect URL.
        expect(collection.redirectUrl).toBeUndefined();

        // (Req 5.6) Authoritatively read the status by reference. The customer
        // has not approved the prompt on their phone, so this is typically a
        // pending/processing (non-completed) status — we assert the call
        // succeeds and echoes our reference rather than forcing completion,
        // which requires a manual phone approval the test cannot perform.
        const status = await marzpay.collections.getStatus(reference);
        expect(status.reference).toBe(reference);
        expect(typeof status.status).toBe("string");
        expect(status.status.length).toBeGreaterThan(0);

        // (Req 6.2) Read the confirmed amount/currency via transactions.get,
        // the same values the Payment_Store persists on completion.
        const tx = await marzpay.transactions.get(reference);
        expect(tx.reference).toBe(reference);
        expect(tx.amount).toBe(PAYMENT_AMOUNT);
        expect(tx.currency).toBe(PAYMENT_CURRENCY);
        expect(typeof tx.status).toBe("string");
      },
      120_000,
    );
  },
);
