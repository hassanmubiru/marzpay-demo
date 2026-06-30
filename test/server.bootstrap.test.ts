// Unit tests for server bootstrap wiring (Task 8.3).
//
// Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
//
// These tests exercise the `bootstrap(deps)` orchestration in src/server.ts
// through its dependency-injection seams (env, createApp, pluginFactory,
// controllers, initSchema, listen, log, printError, exit). They assert:
//   1. Exactly the four controllers (Home, Checkout, Success, Webhook) are
//      registered (Req 2.1).
//   2. The resolved MarzPay environment passed to MarzPayPlugin is `sandbox`
//      unless `production` is selected (Req 2.2, 2.3, 2.4).
//   3. An induced plugin install failure aborts startup with the
//      install-failed message and a non-zero exit, before binding a port
//      (Req 2.5).

import { describe, expect, it, vi } from "vitest";
import type { Constructor, StreetApp, StreetAppOptions } from "streetjs";
import type { PluginModule } from "streetjs";
import type { MarzPayPluginConfig } from "@streetjs/plugin-marzpay";

import {
  bootstrap,
  CONTROLLERS,
  MARZPAY_STATE_KEY,
  MARZPAY_TIMEOUT_MS,
} from "../src/server.js";
import type { BootstrapDeps } from "../src/server.js";
import { HomeController } from "../src/controllers/home.controller.js";
import { CheckoutController } from "../src/controllers/checkout.controller.js";
import { SuccessController } from "../src/controllers/success.controller.js";
import { WebhookController } from "../src/controllers/webhook.controller.js";

/**
 * A minimal stub StreetApp that records the calls bootstrap makes against it:
 * which plugins were loaded, which controllers were registered, and whether
 * `listen()` (the port bind) was ever invoked.
 */
class FakeApp {
  readonly registeredControllers: Constructor[] = [];
  readonly loadedPlugins: PluginModule[] = [];
  listenCalled = false;
  /** When set, `loadPlugin` rejects to simulate a failed install. */
  loadPluginRejection: Error | undefined;

  async loadPlugin(plugin: PluginModule): Promise<void> {
    if (this.loadPluginRejection) {
      throw this.loadPluginRejection;
    }
    this.loadedPlugins.push(plugin);
  }

  registerController(controller: Constructor): void {
    this.registeredControllers.push(controller);
  }

  async listen(): Promise<void> {
    this.listenCalled = true;
  }
}

/** A valid set of environment values for every required variable. */
function validEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    MARZPAY_API_KEY: "sandbox-api-key",
    MARZPAY_SECRET_KEY: "sandbox-secret-key",
    APP_URL: "https://demo.example.test",
    PORT: "3000",
    ...overrides,
  };
}

/** A dummy plugin module returned by the spy plugin factory. */
const DUMMY_PLUGIN = { name: "marzpay-stub" } as unknown as PluginModule;

/**
 * Build a fresh set of bootstrap dependencies wired to a FakeApp and spies.
 * Returns the deps plus handles to the captured artifacts so each test can
 * assert against them.
 */
function makeDeps(
  env: Record<string, string | undefined>,
  options: {
    /** Make the plugin factory itself throw (vs. loadPlugin rejecting). */
    factoryThrows?: Error;
    /** Make app.loadPlugin reject. */
    loadPluginRejects?: Error;
  } = {},
) {
  const app = new FakeApp();
  if (options.loadPluginRejects) {
    app.loadPluginRejection = options.loadPluginRejects;
  }

  const capturedPluginConfigs: MarzPayPluginConfig[] = [];
  const pluginFactory = vi.fn((config: MarzPayPluginConfig): PluginModule => {
    capturedPluginConfigs.push(config);
    if (options.factoryThrows) {
      throw options.factoryThrows;
    }
    return DUMMY_PLUGIN;
  });

  const createApp = vi.fn(
    (_options: StreetAppOptions): StreetApp => app as unknown as StreetApp,
  );
  const initSchema = vi.fn(async (): Promise<void> => undefined);
  const log = vi.fn();
  const printError = vi.fn();
  const exit = vi.fn();

  const deps: BootstrapDeps = {
    env,
    createApp,
    pluginFactory,
    initSchema,
    log,
    printError,
    exit,
  };

  return {
    deps,
    app,
    createApp,
    pluginFactory,
    capturedPluginConfigs,
    initSchema,
    log,
    printError,
    exit,
  };
}

describe("bootstrap controller registration (Req 2.1)", () => {
  it("registers exactly the four controllers in route-map order", async () => {
    const h = makeDeps(validEnv());

    const result = await bootstrap(h.deps);

    expect(result).toBeDefined();
    // Exactly four, no more, no fewer.
    expect(h.app.registeredControllers).toHaveLength(4);
    expect(h.app.registeredControllers).toEqual([
      HomeController,
      CheckoutController,
      SuccessController,
      WebhookController,
    ]);
    // The exported CONTROLLERS list is the single source of truth.
    expect(h.app.registeredControllers).toEqual([...CONTROLLERS]);
    // A clean startup binds the port and never reports an error.
    expect(h.app.listenCalled).toBe(true);
    expect(h.printError).not.toHaveBeenCalled();
    expect(h.exit).not.toHaveBeenCalled();
  });

  it("installs the plugin before registering controllers (no controllers on a failed install)", async () => {
    const h = makeDeps(validEnv(), {
      loadPluginRejects: new Error("install boom"),
    });

    await bootstrap(h.deps);

    // Install aborts startup before any controller is registered.
    expect(h.app.registeredControllers).toHaveLength(0);
  });
});

describe("bootstrap resolved MarzPay environment (Req 2.2, 2.3, 2.4)", () => {
  it("passes apiKey, secretKey, stateKey and timeout from config to the plugin", async () => {
    const h = makeDeps(validEnv());

    await bootstrap(h.deps);

    expect(h.pluginFactory).toHaveBeenCalledTimes(1);
    expect(h.capturedPluginConfigs).toHaveLength(1);
    const cfg = h.capturedPluginConfigs[0];
    expect(cfg.apiKey).toBe("sandbox-api-key");
    expect(cfg.secretKey).toBe("sandbox-secret-key");
    expect(cfg.stateKey).toBe(MARZPAY_STATE_KEY);
    expect(cfg.timeoutMs).toBe(MARZPAY_TIMEOUT_MS);
  });

  it("resolves to 'sandbox' when MARZPAY_ENVIRONMENT is absent", async () => {
    const h = makeDeps(validEnv({ MARZPAY_ENVIRONMENT: undefined }));

    const result = await bootstrap(h.deps);

    expect(h.capturedPluginConfigs[0].environment).toBe("sandbox");
    expect(result?.config.marzpayEnvironment).toBe("sandbox");
  });

  it("resolves to 'sandbox' when MARZPAY_ENVIRONMENT is empty", async () => {
    const h = makeDeps(validEnv({ MARZPAY_ENVIRONMENT: "" }));

    await bootstrap(h.deps);

    expect(h.capturedPluginConfigs[0].environment).toBe("sandbox");
  });

  it("resolves to 'production' when MARZPAY_ENVIRONMENT selects production", async () => {
    const h = makeDeps(validEnv({ MARZPAY_ENVIRONMENT: "production" }));

    const result = await bootstrap(h.deps);

    expect(h.capturedPluginConfigs[0].environment).toBe("production");
    expect(result?.config.marzpayEnvironment).toBe("production");
  });
});

describe("bootstrap plugin install failure (Req 2.5)", () => {
  it("aborts with an install-failed message and non-zero exit when loadPlugin rejects, before binding a port", async () => {
    const h = makeDeps(validEnv(), {
      loadPluginRejects: new Error("connection refused"),
    });

    const result = await bootstrap(h.deps);

    // Startup is aborted: no result, no port bound.
    expect(result).toBeUndefined();
    expect(h.app.listenCalled).toBe(false);
    // A non-zero exit was requested.
    expect(h.exit).toHaveBeenCalledWith(1);
    // The error names the MarzPay plugin installation failure.
    expect(h.printError).toHaveBeenCalled();
    const messages = h.printError.mock.calls.map((c) => String(c[0]));
    expect(
      messages.some((m) => /MarzPay plugin installation failed/i.test(m)),
    ).toBe(true);
  });

  it("aborts with an install-failed message and non-zero exit when the plugin factory throws, before binding a port", async () => {
    const h = makeDeps(validEnv(), {
      factoryThrows: new Error("bad credentials"),
    });

    const result = await bootstrap(h.deps);

    expect(result).toBeUndefined();
    expect(h.app.listenCalled).toBe(false);
    expect(h.app.registeredControllers).toHaveLength(0);
    expect(h.exit).toHaveBeenCalledWith(1);
    const messages = h.printError.mock.calls.map((c) => String(c[0]));
    expect(
      messages.some((m) => /MarzPay plugin installation failed/i.test(m)),
    ).toBe(true);
  });
});
