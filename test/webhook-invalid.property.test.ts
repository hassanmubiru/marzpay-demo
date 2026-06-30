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
import type { MarzPayClient } from "../src/services/marzpay-types.js";

// Feature: streetjs-marzpay-demo, Property 9: Invalid webhooks are rejected and
// change nothing. For any webhook request whose validateWebhook(rawBody,
// signature) returns false, the WebhookController responds with HTTP status 401
// and leaves every existing Payment_Record unchanged.
//
// Validates: Requirements 5.1, 5.2

/**
 * A MarzPay client stub whose `validateWebhook` always reports the request as
 * invalid (Req 5.1/5.2). Every other method throws: reaching any of them would
 * mean the handler proceeded past the failed signature check, which Property 9
 * forbids.
 */
function rejectingMarzpay(): MarzPayClient {
  const fail = (name: string) => (): never => {
    throw new Error(`unexpected call to ${name} after invalid webhook`);
  };
  return {
    validateWebhook: () => false,
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
  signature: string,
  marzpay: MarzPayClient,
): { ctx: StreetContext; captured: CapturedResponse[] } {
  const captured: CapturedResponse[] = [];
  const ctx = {
    state: { marzpay, rawBody },
    headers: { "x-marzpay-signature": signature },
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

describe("Property 9: Invalid webhooks are rejected and change nothing", () => {
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

  it("returns HTTP 401 and leaves every existing Payment_Record unchanged", async () => {
    const controller = new WebhookController();

    await fc.assert(
      fc.asyncProperty(
        // Arbitrary raw bodies (including text that happens to be valid JSON
        // carrying a reference) and arbitrary signatures. With validateWebhook
        // stubbed to false, none of these may pass the signature gate.
        fc.string(),
        fc.string(),
        async (rawBody, signature) => {
          const { ctx, captured } = makeContext(
            rawBody,
            signature,
            rejectingMarzpay(),
          );

          await controller.handle(ctx);

          // Exactly one response, and it must be HTTP 401 (Req 5.2).
          expect(captured).toHaveLength(1);
          expect(captured[0].status).toBe(401);

          // Every existing Payment_Record is left unchanged (Req 5.2).
          const after = await snapshotAll();
          expect(after).toEqual(baseline);
        },
      ),
      { numRuns: 100 },
    );
  });
});
