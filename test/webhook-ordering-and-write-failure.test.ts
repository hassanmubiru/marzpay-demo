import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { StreetContext } from "streetjs";

// Task 6.11 — Unit tests for webhook ordering and the DB write-failure path.
//
// Two contracts are exercised against the real WebhookController:
//
//  (A) Ordering (Req 5.1, 5.4): validateWebhook MUST run before any parse or
//      persist, and getStatus MUST run before completion is recorded
//      (markCompleted). We prove this two ways: a captured call-order log on a
//      happy path, and a gating check showing that a false validateWebhook
//      short-circuits everything downstream (no parse-driven getStatus, no
//      persist).
//
//  (B) DB write-failure (Req 6.4): when the Payment_Store reports the
//      completion write failed, the handler responds HTTP 500 with a
//      database-write-failed indication and leaves no partial row — the
//      pre-existing pending record is untouched and remains the single row for
//      its reference.
//
// The Payment_Store `markCompleted` is mocked (the recommended seam) so we can
// both record WHEN it is invoked relative to the marzpay client calls and
// induce a `{ ok: false, error }` write failure on demand. Every other
// Payment_Store function (initSchema/insertPending/findByReference/closeStore)
// keeps its real implementation, backed by an in-memory SQLite database, so the
// "no partial row" assertion observes the genuine stored state.
//
// _Requirements: 5.1, 5.4, 6.4_

vi.mock("../src/db/payments.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/db/payments.js")>();
  return { ...actual, markCompleted: vi.fn() };
});

import { WebhookController } from "../src/controllers/webhook.controller.js";
import {
  initSchema,
  insertPending,
  findByReference,
  markCompleted,
  closeStore,
  type WriteResult,
} from "../src/db/payments.js";
import type { MarzPayClient } from "../src/services/marzpay-types.js";

const markCompletedMock = vi.mocked(markCompleted);

/** A captured response from the stubbed `ctx.json(...)`. */
interface CapturedResponse {
  status: number;
  body: unknown;
}

/**
 * Build a recording MarzPay client stub. Every consumed method appends its name
 * to the shared `order` log the instant it is invoked, so the test can assert
 * the strict invocation ordering mandated by Requirements 5.1 and 5.4.
 */
function makeMarzpay(opts: {
  order: string[];
  valid: boolean;
  status?: string;
  txn?: { amount: number; currency: string; status: string };
}): MarzPayClient {
  const { order, valid, status = "completed", txn } = opts;
  const unexpected = (name: string) => (): never => {
    throw new Error(`unexpected call to ${name}`);
  };
  return {
    validateWebhook: (): boolean => {
      order.push("validateWebhook");
      return valid;
    },
    collections: {
      collectMoney: unexpected("collections.collectMoney") as never,
      getStatus: async (reference: string) => {
        order.push("getStatus");
        return { reference, status };
      },
    },
    transactions: {
      get: async (reference: string) => {
        order.push("transactions.get");
        return {
          id: "txn-1",
          reference,
          amount: txn?.amount ?? 5000,
          currency: txn?.currency ?? "UGX",
          status: txn?.status ?? "completed",
        };
      },
    },
    utils: {
      isValidPhoneNumber: unexpected("utils.isValidPhoneNumber") as never,
      formatPhoneNumber: unexpected("utils.formatPhoneNumber") as never,
    },
  };
}

/**
 * Minimal StreetContext stub exposing exactly what WebhookController reads: the
 * marzpay client and raw body on `ctx.state`, the signature header, and a
 * `json` sink that records every response.
 */
function makeContext(
  rawBody: string,
  marzpay: MarzPayClient,
): { ctx: StreetContext; captured: CapturedResponse[] } {
  const captured: CapturedResponse[] = [];
  const ctx = {
    state: { marzpay, rawBody },
    headers: { "x-marzpay-signature": "sig-abc" },
    body: rawBody,
    json(data: unknown, status = 200): void {
      captured.push({ status, body: data });
    },
  } as unknown as StreetContext;
  return { ctx, captured };
}

const REFERENCE = "ref-order-1";
const RAW_BODY = JSON.stringify({ reference: REFERENCE });

/** The pending row seeded before each test, used to detect partial writes. */
const SEED_PENDING = {
  reference: REFERENCE,
  amount: 5000,
  currency: "UGX",
  status: "pending",
  createdAt: "2024-01-01T00:00:00.000Z",
} as const;

describe("WebhookController ordering and DB write-failure (Task 6.11)", () => {
  beforeEach(async () => {
    markCompletedMock.mockReset();
    await initSchema({ filePath: ":memory:" });
    const write = await insertPending({ ...SEED_PENDING });
    expect(write.ok).toBe(true);
  });

  afterEach(async () => {
    await closeStore();
  });

  it("invokes validateWebhook before parse/persist and getStatus before recording completion (Req 5.1, 5.4)", async () => {
    const order: string[] = [];
    // markCompleted (the persist step) records its position and succeeds.
    markCompletedMock.mockImplementation(async (): Promise<WriteResult> => {
      order.push("markCompleted");
      return { ok: true };
    });
    const marzpay = makeMarzpay({ order, valid: true, status: "completed" });
    const { ctx, captured } = makeContext(RAW_BODY, marzpay);

    const controller = new WebhookController();
    await controller.handle(ctx);

    // Happy path acknowledges with HTTP 200.
    expect(captured).toHaveLength(1);
    expect(captured[0].status).toBe(200);

    // The full, strictly-ordered sequence: validation first, the authoritative
    // status check next, the confirmed-amount read, then the completion write.
    expect(order).toEqual([
      "validateWebhook",
      "getStatus",
      "transactions.get",
      "markCompleted",
    ]);

    // Explicit ordering relationships the requirements call out:
    // validateWebhook before everything (parse + persist) — Req 5.1.
    expect(order.indexOf("validateWebhook")).toBe(0);
    // getStatus before completion is recorded — Req 5.4.
    expect(order.indexOf("getStatus")).toBeLessThan(
      order.indexOf("markCompleted"),
    );
  });

  it("short-circuits on an invalid signature: no getStatus, no parse-driven read, no persist (Req 5.1)", async () => {
    const order: string[] = [];
    markCompletedMock.mockImplementation(async (): Promise<WriteResult> => {
      order.push("markCompleted");
      return { ok: true };
    });
    // validateWebhook reports invalid; nothing downstream may run.
    const marzpay = makeMarzpay({ order, valid: false });
    const { ctx, captured } = makeContext(RAW_BODY, marzpay);

    const controller = new WebhookController();
    await controller.handle(ctx);

    expect(captured).toHaveLength(1);
    expect(captured[0].status).toBe(401);

    // Only validateWebhook ran — proving it gates the parse and persist steps.
    expect(order).toEqual(["validateWebhook"]);
    expect(markCompletedMock).not.toHaveBeenCalled();

    // The pre-existing record is untouched.
    const after = await findByReference(REFERENCE);
    expect(after.found).toBe(true);
    if (after.found) {
      expect(after.payment.status).toBe("pending");
    }
  });

  it("returns HTTP 500 with a database-write-failed indication and leaves no partial row when the completion write fails (Req 6.4)", async () => {
    const order: string[] = [];
    // Induce a Payment_Store write failure for the completion step.
    markCompletedMock.mockImplementation(async (): Promise<WriteResult> => {
      order.push("markCompleted");
      return { ok: false, error: "disk I/O error" };
    });
    const marzpay = makeMarzpay({
      order,
      valid: true,
      status: "completed",
      txn: { amount: 5000, currency: "UGX", status: "completed" },
    });
    const { ctx, captured } = makeContext(RAW_BODY, marzpay);

    const controller = new WebhookController();
    await controller.handle(ctx);

    // HTTP 500 with a database-write-failed indication (Req 6.4).
    expect(captured).toHaveLength(1);
    expect(captured[0].status).toBe(500);
    const body = captured[0].body as Record<string, unknown>;
    expect(String(body.error).toLowerCase()).toContain("database write failed");

    // getStatus still preceded the (failed) completion write.
    expect(order).toEqual([
      "validateWebhook",
      "getStatus",
      "transactions.get",
      "markCompleted",
    ]);

    // No partial row: the single pre-existing record for this reference is left
    // exactly as it was — still pending, with its original fields intact.
    const after = await findByReference(REFERENCE);
    expect(after.found).toBe(true);
    if (after.found) {
      expect(after.payment).toMatchObject({
        reference: REFERENCE,
        amount: 5000,
        currency: "UGX",
        status: "pending",
        createdAt: SEED_PENDING.createdAt,
      });
    }
  });
});
