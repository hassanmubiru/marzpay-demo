import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fc from "fast-check";

import type { StreetContext } from "streetjs";

import { WebhookController } from "../src/controllers/webhook.controller.js";
import {
  initSchema,
  insertPending,
  findByReference,
  closeStore,
} from "../src/db/payments.js";
import { isCompletedStatus } from "../src/services/marzpay-helpers.js";
import type {
  MarzPayClient,
  StatusResult,
  TransactionResult,
} from "../src/services/marzpay-types.js";

// Feature: streetjs-marzpay-demo, Property 11: Webhook completion is
// status-driven and authoritative. For any validated webhook carrying a
// reference, the WebhookController first calls collections.getStatus(reference);
// when the returned status is interpreted as completed by isCompletedStatus the
// matching Payment_Record is recorded completed (using amount/currency/status
// read from transactions.get) and the response is HTTP 200; when the status is
// not completed the response is HTTP 200 and the Payment_Record's status is left
// unchanged.
//
// Validates: Requirements 5.4, 5.5, 5.6

/** A captured response from the stubbed `ctx.json(...)`. */
interface CapturedResponse {
  status: number;
  body: unknown;
}

/**
 * A validated MarzPay client stub that records the order of the calls it
 * receives so we can assert getStatus runs before transactions.get (and before
 * any completion is recorded). `validateWebhook` always returns true — this
 * property concerns the post-validation, status-driven path. `collectMoney` is
 * never reached on the webhook path and throws if invoked.
 */
function makeMarzpay(
  statusResult: StatusResult,
  txn: TransactionResult,
  calls: string[],
): MarzPayClient {
  return {
    validateWebhook: () => {
      calls.push("validateWebhook");
      return true;
    },
    collections: {
      collectMoney: (() => {
        throw new Error("unexpected call to collections.collectMoney");
      }) as never,
      getStatus: (reference: string): Promise<StatusResult> => {
        calls.push("getStatus");
        return Promise.resolve({ ...statusResult, reference });
      },
    },
    transactions: {
      get: (reference: string): Promise<TransactionResult> => {
        calls.push("transactionsGet");
        return Promise.resolve({ ...txn, reference });
      },
    },
    utils: {
      isValidPhoneNumber: (() => {
        throw new Error("unexpected call to utils.isValidPhoneNumber");
      }) as never,
      formatPhoneNumber: (() => {
        throw new Error("unexpected call to utils.formatPhoneNumber");
      }) as never,
    },
  };
}

/**
 * Build a minimal StreetContext stub exposing exactly what the WebhookController
 * reads: the marzpay client and raw body on state, a signature header, and a
 * `json` sink that records the response.
 */
function makeContext(
  rawBody: string,
  marzpay: MarzPayClient,
): { ctx: StreetContext; captured: CapturedResponse[] } {
  const captured: CapturedResponse[] = [];
  const ctx = {
    state: { marzpay, rawBody },
    headers: { "x-marzpay-signature": "sig" },
    body: rawBody,
    json(data: unknown, status = 200): void {
      captured.push({ status, body: data });
    },
  } as unknown as StreetContext;
  return { ctx, captured };
}

// The seeded pending record's fields. The completion path must overwrite these
// with the transactions.get fields; the non-completion path must leave them.
const SEED_AMOUNT = 5000;
const SEED_CURRENCY = "UGX";
const SEED_STATUS = "pending";

/** Monotonic counter guaranteeing a fresh, unique reference per generated case. */
let nextRef = 0;

/** Status values that isCompletedStatus accepts (varied case/whitespace). */
const completedStatusArb = fc.constantFrom(
  "completed",
  "successful",
  "success",
  "COMPLETED",
  "Successful",
  "  success  ",
);

/** Status values that isCompletedStatus rejects. */
const nonCompletedStatusArb = fc.oneof(
  fc.constantFrom("pending", "failed", "processing", "cancelled", "expired", ""),
  fc.string().filter((s) => !isCompletedStatus(s)),
);

describe("Property 11: Webhook completion is status-driven and authoritative", () => {
  beforeAll(async () => {
    await initSchema({ filePath: ":memory:" });
  });

  afterAll(async () => {
    await closeStore();
  });

  it("calls getStatus first and records completion only for completed statuses", async () => {
    const controller = new WebhookController();

    // Each generated case: whether the authoritative status is completed, the
    // exact status string getStatus returns, and the transactions.get fields
    // that a completion must persist.
    const caseArb = fc.record({
      completed: fc.boolean(),
      completedStatus: completedStatusArb,
      nonCompletedStatus: nonCompletedStatusArb,
      txnAmount: fc.integer({ min: 1, max: 10_000_000 }),
      txnCurrency: fc
        .string({ minLength: 1, maxLength: 8 })
        .filter((s) => s.trim() !== ""),
      txnStatus: completedStatusArb,
    });

    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        // Fresh reference + seeded pending record for this case.
        const reference = `prop11-ref-${nextRef++}`;
        const seedWrite = await insertPending({
          reference,
          amount: SEED_AMOUNT,
          currency: SEED_CURRENCY,
          status: SEED_STATUS,
          createdAt: "2024-01-01T00:00:00.000Z",
        });
        expect(seedWrite.ok).toBe(true);

        const getStatusValue = c.completed
          ? c.completedStatus
          : c.nonCompletedStatus;
        const statusResult: StatusResult = {
          reference,
          status: getStatusValue,
        };
        const txn: TransactionResult = {
          id: `txn-${reference}`,
          reference,
          amount: c.txnAmount,
          currency: c.txnCurrency,
          status: c.txnStatus,
        };

        const calls: string[] = [];
        const marzpay = makeMarzpay(statusResult, txn, calls);
        const rawBody = JSON.stringify({ reference });
        const { ctx, captured } = makeContext(rawBody, marzpay);

        await controller.handle(ctx);

        // Exactly one response, always HTTP 200 on the validated path
        // (Req 5.5, 5.6).
        expect(captured).toHaveLength(1);
        expect(captured[0]!.status).toBe(200);

        // getStatus is the AUTHORITATIVE check and is consulted before any
        // transactions.get / completion recording (Req 5.4).
        const getStatusIdx = calls.indexOf("getStatus");
        expect(getStatusIdx).toBeGreaterThanOrEqual(0);
        const txnIdx = calls.indexOf("transactionsGet");
        if (txnIdx >= 0) {
          expect(getStatusIdx).toBeLessThan(txnIdx);
        }

        const after = await findByReference(reference);
        expect(after.found).toBe(true);
        if (!after.found) return;

        if (isCompletedStatus(getStatusValue)) {
          // Completed: transactions.get was read and the record now holds the
          // confirmed amount/currency/status (Req 5.6, 6.2).
          expect(txnIdx).toBeGreaterThanOrEqual(0);
          expect(after.payment.amount).toBe(c.txnAmount);
          expect(after.payment.currency).toBe(c.txnCurrency);
          expect(after.payment.status).toBe(c.txnStatus);
        } else {
          // Not completed: no transactions.get, record left fully unchanged
          // (Req 5.5).
          expect(txnIdx).toBe(-1);
          expect(after.payment.amount).toBe(SEED_AMOUNT);
          expect(after.payment.currency).toBe(SEED_CURRENCY);
          expect(after.payment.status).toBe(SEED_STATUS);
        }
      }),
      { numRuns: 100 },
    );
  });
});
