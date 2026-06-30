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
import { config as loadDotenv } from "dotenv";
import { streetApp } from "streetjs";
import { MarzPayPlugin } from "@streetjs/plugin-marzpay";
import { validateConfig } from "./config.js";
import { initSchema as initPaymentsSchema } from "./db/payments.js";
import { HomeController } from "./controllers/home.controller.js";
import { CheckoutController } from "./controllers/checkout.controller.js";
import { SuccessController } from "./controllers/success.controller.js";
import { WebhookController } from "./controllers/webhook.controller.js";
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
export const CONTROLLERS = [
    HomeController,
    CheckoutController,
    SuccessController,
    WebhookController,
];
/**
 * Run the startup sequence. Returns the created app and resolved config on
 * success, or `undefined` when startup is aborted (invalid config or a failed
 * plugin install) — in which case the `exit` seam has already been invoked.
 *
 * The sequence is strictly ordered: configuration is validated before the app
 * is created, the plugin is installed before any controller is registered or
 * the schema is initialized, and the port is bound only as the final step.
 */
export async function bootstrap(deps = {}) {
    const env = deps.env ?? loadEnvFromDotenv();
    const createApp = deps.createApp ?? streetApp;
    const pluginFactory = deps.pluginFactory ?? MarzPayPlugin;
    const controllers = deps.controllers ?? CONTROLLERS;
    const initSchema = deps.initSchema ?? initPaymentsSchema;
    const shouldListen = deps.listen ?? true;
    const log = deps.log ?? ((message) => console.log(message));
    const printError = deps.printError ?? ((message) => console.error(message));
    const exit = deps.exit ?? ((code) => process.exit(code));
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
        await app.loadPlugin(pluginFactory({
            apiKey: config.marzpayApiKey,
            secretKey: config.marzpaySecretKey,
            environment: config.marzpayEnvironment,
            stateKey: MARZPAY_STATE_KEY,
            timeoutMs: MARZPAY_TIMEOUT_MS,
        }));
    }
    catch (err) {
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
        log(`StreetJS + MarzPay demo listening on http://${DEFAULT_HOST}:${config.port}` +
            ` (MarzPay environment: ${config.marzpayEnvironment})`);
    }
    return { app, config };
}
/** Load `.env` into `process.env` (best-effort) and return `process.env`. */
function loadEnvFromDotenv() {
    loadDotenv();
    return process.env;
}
/** Extract a human-readable message from an unknown thrown value. */
function errorMessage(err) {
    if (err instanceof Error) {
        return err.message;
    }
    return String(err);
}
/** Real entry point: bootstrap with the production dependencies. */
export async function main() {
    await bootstrap();
}
// Auto-run when executed directly (e.g. `node dist/server.js`), but not when
// imported by a test. `process.argv[1]` is the invoked script path.
const invokedPath = process.argv[1];
const isDirectRun = invokedPath !== undefined &&
    import.meta.url === new URL(`file://${invokedPath}`).href;
if (isDirectRun) {
    main().catch((err) => {
        console.error(`Fatal startup error: ${errorMessage(err)}`);
        process.exit(1);
    });
}
//# sourceMappingURL=server.js.map