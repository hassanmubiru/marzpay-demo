import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fc from "fast-check";

import type { StreetContext } from "streetjs";

import { WebhookController } from "../src/controllers/webhook.controller.js";
import {
  initSchema,
  insertPending,
  findByReference,
  closeStore,
  type NewPayment,
  type PaymentRecord,
} from "../src/db/payments.js";
import { parseWebhookReference } from "../src/services/marzpay-helpers.js";
import type { MarzPayClient } from "../src/services/marzpay-types.js";

// Feature: streetjs-marzpay-demo, Property 10: Validated but unusable webhooks
// return 400 and change nothing. For any webhook request that passes
// validateWebhook but whose raw body cannot be parsed or carries no payment
// reference, the WebhookController responds with HTTP status 400 and leaves
// every existing Payment_Record unchanged.
//
// Validates: Requirements 5.3

/**
 * A MarzPay client stub whose `validateWebhook` always reports the request as
 * VALID (true) — this property concerns the post-validation path. Every other
 * method throws: reaching `getStatus` / `transactions.get` would mean the
 * handler proceeded past the failed parse, which Property 10 forbids (a body
 * that is unparseable or lacks a reference must short-circuit at HTTP 400).
 */
function validatingMarzpay(): MarzPayClient {
  const fail = (name: string) => (): never => {
    throw new Error(`unexpected call to ${name} after unusable webhook`);
  };
  return {
    validateWebhook: () => true,
    collections: {
      collectMoney: fail("collections.collectMoney") as never,
      getStatus: fail("collections.getStatus") as never,
    },
    transactions: {
      get: fail("transactions.get") as never,
    },
    utils: {
      isValidPhoneNumber: fail("utils.isValidPhoneNumber") as never,
      formatPhoneNumber: fail("utils.formatPhoneNumber") as never,
    },
  };
}

/** A captured response from the stubbed `ctx.json(...)`. */
interface CapturedResponse {
  status: number;
  body: unknown;
}

/**
 * Build a minimal StreetContext stub exposing exactly what the WebhookController
 * reads: the marzpay client on state, the raw body (via `ctx.state.rawBody`),
 * the signature header, and a `json` sink that records the response.
 */
function makeContext(
  rawBody: string,
  marzpay: MarzPayClient,
): { ctx: StreetContext; captured: CapturedResponse[] } {
  const captured: CapturedResponse[] = [];
  const ctx = {
    state: { marzpay, rawBody },
    headers: { "x-marzpay-signature": "valid-signature" },
    body: rawBody,
    json(data: unknown, status = 200): void {
      captured.push({ status, body: data });
    },
  } as unknown as StreetContext;
  return { ctx, captured };
}

/** The fixed set of Payment_Records seeded into the in-memory store. */
const SEED: readonly NewPayment[] = [
  {
    reference: "seed-pending-1",
    amount: 5000,
    currency: "UGX",
    status: "pending",
    createdAt: "2024-01-01T00:00:00.000Z",
  },
  {
    reference: "seed-pending-2",
    amount: 5000,
    currency: "UGX",
    status: "pending",
    createdAt: "2024-02-02T12:30:00.000Z",
  },
  {
    reference: "seed-completed-1",
    amount: 5000,
    currency: "UGX",
    status: "completed",
    createdAt: "2024-03-03T08:15:00.000Z",
  },
];

/** Read the current stored record for every seeded reference. */
async function snapshotAll(): Promise<PaymentRecord[]> {
  const records: PaymentRecord[] = [];
  for (const seed of SEED) {
    const result = await findByReference(seed.reference);
    expect(result.found).toBe(true);
    if (result.found) {
      records.push(result.payment);
    }
  }
  return records;
}

/**
 * Raw bodies that are NOT valid JSON. Filtered so `JSON.parse` definitely
 * throws, guaranteeing `parseWebhookReference` returns `unparseable`.
 */
const nonJsonArb = fc.string().filter((s) => {
  try {
    JSON.parse(s);
    return false;
  } catch {
    return true;
  }
});

/**
 * Valid JSON whose root is not an object (primitive or array). The helper
 * treats these as `unparseable` since there is nowhere to carry a reference.
 */
const jsonNonObjectArb = fc
  .oneof(
    fc.integer(),
    fc.double({ noNaN: true }),
    fc.boolean(),
    fc.constant(null),
    fc.array(fc.jsonValue()),
    fc.string(),
  )
  .map((v) => JSON.stringify(v));

/**
 * JSON objects that carry NO usable reference: arbitrary keys excluding
 * `reference` and `data`, so neither the top-level `reference` nor the nested
 * `data.reference` fallback can supply one (`missing_reference`).
 */
const jsonNoRefArb = fc
  .dictionary(
    fc.string().filter((k) => k !== "reference" && k !== "data"),
    fc.jsonValue(),
  )
  .map((obj) => JSON.stringify(obj));

/**
 * JSON objects whose `reference` (and any `data.reference`) is present but
 * unusable: empty/whitespace string or a non-string value. The helper treats
 * these as `missing_reference`.
 */
const jsonUnusableRefArb = fc
  .record({
    reference: fc.oneof(
      fc.constant(""),
      fc.constant("   "),
      fc.constant(null),
      fc.integer(),
      fc.boolean(),
      fc.array(fc.string()),
    ),
  })
  .map((obj) => JSON.stringify(obj));

/** Any body that is validated but unusable (unparseable or no reference). */
const unusableBodyArb = fc.oneof(
  nonJsonArb,
  jsonNonObjectArb,
  jsonNoRefArb,
  jsonUnusableRefArb,
);

describe("Property 10: Validated but unusable webhooks return 400 and change nothing", () => {
  let baseline: PaymentRecord[];

  beforeAll(async () => {
    await initSchema({ filePath: ":memory:" });
    for (const seed of SEED) {
      const write = await insertPending(seed);
      expect(write.ok).toBe(true);
    }
    baseline = await snapshotAll();
  });

  afterAll(async () => {
    await closeStore();
  });

  it("returns HTTP 400 and leaves every existing Payment_Record unchanged", async () => {
    const controller = new WebhookController();

    await fc.assert(
      fc.asyncProperty(unusableBodyArb, async (rawBody) => {
        // Sanity: each generated body really is unusable per the pure helper,
        // so a 400 is the mandated outcome (Req 5.3).
        expect(parseWebhookReference(rawBody).ok).toBe(false);

        const { ctx, captured } = makeContext(rawBody, validatingMarzpay());

        await controller.handle(ctx);

        // Exactly one response, and it must be HTTP 400 (Req 5.3).
        expect(captured).toHaveLength(1);
        expect(captured[0]!.status).toBe(400);

        // Every existing Payment_Record is left unchanged (Req 5.3).
        const after = await snapshotAll();
        expect(after).toEqual(baseline);
      }),
      { numRuns: 100 },
    );
  });
});
