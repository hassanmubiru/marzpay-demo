/**
 * Server bootstrap for the StreetJS + MarzPay demo.
 *
 * Wires the strict startup sequence mandated by the design's "Bootstrap
 * Sequence" — no network port is bound until every earlier step succeeds:
 *
 *   1. Load `.env` (dotenv populates `process.env`).
 *   2. `validateConfig(process.env)` (pure): on `ok: false`, print EVERY
 *      offending variable and exit non-zero BEFORE any app creation, plugin
 *      install, or port bind (Req 1.4–1.9).
 *   3. `streetApp({ port, host })` — create the application.
 *   4. Install `MarzPayPlugin({ apiKey, secretKey, environment, stateKey,
 *      timeoutMs })`: on install failure, print an install-failed message and
 *      exit non-zero (Req 2.2–2.5).
 *   5. `registerController` for the four controllers (Req 2.1); unmatched
 *      paths fall through to StreetJS's default 404 (Req 2.6).
 *   6. `initSchema()` — create the SQLite `payments` table if absent.
 *   7. `await app.listen()` — bind the port (Req 1.9).
 *
 * The orchestration is split out of the module side effects so it can be
 * unit-tested: {@link bootstrap} accepts dependency-injection seams (env,
 * app factory, plugin factory, controller list, schema initializer, loggers,
 * and an exit hook). The module's auto-run entry point ({@link main}) supplies
 * the real implementations.
 */

import "reflect-metadata";

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import { streetApp } from "streetjs";
import type { Constructor, StreetApp, StreetAppOptions } from "streetjs";
import type { PluginModule } from "streetjs";
import { MarzPayPlugin } from "@streetjs/plugin-marzpay";
import type { MarzPayPluginConfig } from "@streetjs/plugin-marzpay";
import { SupabasePlugin } from "@streetjs/plugin-supabase";

import { validateConfig } from "./config.js";
import type { AppConfig } from "./config.js";
import { initSchema as initPaymentsSchema, usingSupabase } from "./db/store.js";
import { HomeController } from "./controllers/home.controller.js";
import { CheckoutController } from "./controllers/checkout.controller.js";
import { SuccessController } from "./controllers/success.controller.js";
import { WebhookController } from "./controllers/webhook.controller.js";
import {
  ApiCheckoutController,
  ApiPaymentsController,
} from "./controllers/api.controller.js";
import { createSpaMiddleware } from "./web-static.js";

/** State key under which the MarzPay client is injected (Req 2.4). */
export const MARZPAY_STATE_KEY = "marzpay";

/**
 * Request timeout (ms) handed to the MarzPay plugin. Matches the plugin's own
 * default; the demo has no environment variable for it.
 */
export const MARZPAY_TIMEOUT_MS = 30_000;

/** Host the server binds to. */
export const DEFAULT_HOST = "0.0.0.0";

/**
 * The four controllers the demo registers, in route-map order
 * (home, checkout, success, webhook). Exported so tests can assert that
 * exactly these are registered (Req 2.1).
 */
export const CONTROLLERS: readonly Constructor[] = [
  HomeController,
  CheckoutController,
  SuccessController,
  WebhookController,
];

/** Factory for a MarzPay plugin module (the install boundary). */
export type PluginFactory = (config: MarzPayPluginConfig) => PluginModule;

/** Injectable seams for {@link bootstrap}. Every field defaults to the real impl. */
export interface BootstrapDeps {
  /** Source environment record. Defaults to a `.env`-loaded `process.env`. */
  env?: Record<string, string | undefined>;
  /** Application factory. Defaults to {@link streetApp}. */
  createApp?: (options: StreetAppOptions) => StreetApp;
  /** MarzPay plugin factory. Defaults to {@link MarzPayPlugin}. */
  pluginFactory?: PluginFactory;
  /** Controllers to register. Defaults to {@link CONTROLLERS}. */
  controllers?: readonly Constructor[];
  /** SQLite schema initializer. Defaults to the Payment_Store's `initSchema`. */
  initSchema?: () => Promise<void>;
  /** Whether to call `app.listen()` as the final step. Defaults to `true`. */
  listen?: boolean;
  /** Informational logger. Defaults to `console.log`. */
  log?: (message: string) => void;
  /** Error logger. Defaults to `console.error`. */
  printError?: (message: string) => void;
  /** Process exit hook. Defaults to `process.exit`. */
  exit?: (code: number) => void;
}

/** Successful bootstrap outcome: the created app and the resolved config. */
export interface BootstrapResult {
  app: StreetApp;
  config: AppConfig;
}

/**
 * Run the startup sequence. Returns the created app and resolved config on
 * success, or `undefined` when startup is aborted (invalid config or a failed
 * plugin install) — in which case the `exit` seam has already been invoked.
 *
 * The sequence is strictly ordered: configuration is validated before the app
 * is created, the plugin is installed before any controller is registered or
 * the schema is initialized, and the port is bound only as the final step.
 */
export async function bootstrap(
  deps: BootstrapDeps = {},
): Promise<BootstrapResult | undefined> {
  const env = deps.env ?? loadEnvFromDotenv();
  const createApp = deps.createApp ?? streetApp;
  const pluginFactory = deps.pluginFactory ?? MarzPayPlugin;
  const controllers = deps.controllers ?? CONTROLLERS;
  const initSchema = deps.initSchema ?? initPaymentsSchema;
  const shouldListen = deps.listen ?? true;
  const log = deps.log ?? ((message: string) => console.log(message));
  const printError =
    deps.printError ?? ((message: string) => console.error(message));
  const exit = deps.exit ?? ((code: number) => process.exit(code));

  // (2) Validate configuration FIRST. On failure print every offending
  // variable and exit non-zero before any app creation or port bind (Req 1.5).
  const result = validateConfig(env);
  if (!result.ok) {
    printError("Configuration is invalid; the server cannot start:");
    for (const error of result.errors) {
      printError(`  - ${error}`);
    }
    exit(1);
    return undefined;
  }
  const config = result.config;

  // (3) Create the application (no port is bound yet).
  const app = createApp({ port: config.port, host: DEFAULT_HOST });

  // (4) Install the MarzPay plugin. The resolved environment (sandbox unless
  // production was selected) is passed through (Req 2.2, 2.3, 2.4). A failed
  // install aborts startup before any controller registration or port bind
  // (Req 2.5).
  try {
    await app.loadPlugin(
      pluginFactory({
        apiKey: config.marzpayApiKey,
        secretKey: config.marzpaySecretKey,
        environment: config.marzpayEnvironment,
        stateKey: MARZPAY_STATE_KEY,
        timeoutMs: MARZPAY_TIMEOUT_MS,
      }),
    );
  } catch (err) {
    printError(`MarzPay plugin installation failed: ${errorMessage(err)}`);
    exit(1);
    return undefined;
  }

  // (5) Register the four controllers; unmatched paths get StreetJS's default
  // 404 (Req 2.1, 2.6).
  for (const controller of controllers) {
    app.registerController(controller);
  }

  // (6) Initialize the SQLite schema (create the `payments` table if absent).
  await initSchema();

  // (7) Bind the port — the final step (Req 1.9).
  if (shouldListen) {
    await app.listen();
    log(
      `StreetJS + MarzPay demo listening on http://${DEFAULT_HOST}:${config.port}` +
        ` (MarzPay environment: ${config.marzpayEnvironment})`,
    );
  }

  return { app, config };
}

/** Load `.env` into `process.env` (best-effort) and return `process.env`. */
function loadEnvFromDotenv(): Record<string, string | undefined> {
  loadDotenv();
  return process.env;
}

/** Extract a human-readable message from an unknown thrown value. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Assemble the full application the production server and the serverless
 * (Vercel) adapter both use: the four core controllers PLUS the JSON API
 * controllers, the optional Supabase plugin (when configured), and the SPA
 * static middleware. Does NOT bind a port — callers decide whether to
 * `app.listen()` (long-running server) or hand `_handleRequest` to a
 * serverless platform.
 *
 * Returns `undefined` if startup was aborted (invalid config / failed install).
 */
export async function assembleApp(
  overrides: Pick<BootstrapDeps, "exit" | "printError" | "log" | "env"> = {},
): Promise<BootstrapResult | undefined> {
  const result = await bootstrap({
    controllers: [
      ...CONTROLLERS,
      ApiCheckoutController,
      ApiPaymentsController,
    ],
    listen: false,
    ...overrides,
  });
  if (!result) {
    return undefined;
  }

  const { app } = result;

  // Load the Supabase plugin when connection settings are present, exposing the
  // Supabase client at ctx.state.supabase (the durable store also uses it).
  if (usingSupabase()) {
    const url = process.env.SUPABASE_URL as string;
    const apiKey = (process.env.SUPABASE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY) as string;
    try {
      await app.loadPlugin(
        new SupabasePlugin({ url, apiKey, stateKey: "supabase" }),
      );
    } catch (err) {
      console.error(`Supabase plugin installation failed: ${errorMessage(err)}`);
    }
  }

  // Serve the built React SPA under /app (StreetJS core has no static serving).
  // Resolve the build dir robustly across local (relative to dist/server.js)
  // and serverless (bundle at the lambda root, web/dist included via cwd).
  const spaCandidates = [
    process.env.SPA_DIST_DIR,
    fileURLToPath(new URL("../web/dist", import.meta.url)),
    resolve(process.cwd(), "web/dist"),
  ].filter((p): p is string => Boolean(p));
  const spaRoot = spaCandidates.find((p) => existsSync(p)) ?? spaCandidates[0]!;
  app.use(createSpaMiddleware({ root: spaRoot, mountPath: "/app" }));

  return result;
}

/** Real entry point: assemble the app and bind the port (long-running server). */
export async function main(): Promise<void> {
  const result = await assembleApp();
  if (!result) {
    return; // startup aborted; bootstrap already exited non-zero.
  }

  const { app, config } = result;
  await app.listen();
  console.log(
    `StreetJS + MarzPay demo listening on http://${DEFAULT_HOST}:${config.port}` +
      ` (MarzPay environment: ${config.marzpayEnvironment})`,
  );
  console.log(`  - Server-rendered UI:  http://localhost:${config.port}/`);
  console.log(`  - React SPA (SDK):     http://localhost:${config.port}/app`);
  console.log(
    `  - Persistence:         ${usingSupabase() ? "Supabase (append-only)" : "built-in SQLite"}`,
  );
}

// Auto-run when executed directly (e.g. `node dist/server.js`) for the
// long-running local/server deployment. NOT on Vercel — there the platform
// imports this module and invokes the default export per request (see below),
// so we must not also start a listening server.
const invokedPath = process.argv[1];
const isDirectRun =
  invokedPath !== undefined &&
  import.meta.url === new URL(`file://${invokedPath}`).href;

if (isDirectRun) {
  main().catch((err) => {
    console.error(`Fatal startup error: ${errorMessage(err)}`);
    process.exit(1);
  });
}

/* -------------------------------------------------------------------------- */
/* Serverless entry point (Vercel `node` framework)                           */
/* -------------------------------------------------------------------------- */
//
// Vercel detects this file as the root entrypoint and requires a DEFAULT EXPORT
// that is a request handler (or HTTP server) — it does not use `app.listen()`.
// So we lazily assemble the StreetJS app once per cold start and route every
// request through the framework's in-process handler. Startup failures are
// converted into a readable 500 instead of a process.exit crash.

let serverlessAppPromise: Promise<StreetApp> | null = null;

async function getServerlessApp(): Promise<StreetApp> {
  if (!serverlessAppPromise) {
    const startupErrors: string[] = [];
    serverlessAppPromise = assembleApp({
      printError: (m: string) => startupErrors.push(m),
      log: () => undefined,
      exit: (code: number) => {
        throw new Error(
          `Startup aborted (exit ${code}): ${
            startupErrors.join("; ") || "configuration/plugin error"
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
    // Don't cache a rejected promise — let the next request retry.
    serverlessAppPromise.catch(() => {
      serverlessAppPromise = null;
    });
  }
  return serverlessAppPromise;
}

/** Default export: the serverless request handler used by Vercel. */
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const app = await getServerlessApp();
    app._handleRequest(req, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({ error: "server_initialization_failed", message }),
    );
  }
}
