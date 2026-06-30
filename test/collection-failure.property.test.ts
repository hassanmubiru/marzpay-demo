// Feature: streetjs-marzpay-demo, Property 8: Collection failure yields 502 and
// persists nothing.
//
// For any `collectMoney` invocation that rejects (an error result or a
// timeout-style rejection), the CheckoutController responds with HTTP status
// 502, surfaces a "payment initiation failed" message, and persists no
// Payment_Record.
//
// Validates: Requirements 4.6, 4.7

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import fc from "fast-check";

import { CheckoutController } from "../src/controllers/checkout.controller.js";
import {
  initSchema,
  closeStore,
  getPool,
} from "../src/db/payments.js";
import type { StreetContext } from "streetjs";
import type { MarzPayClient } from "../src/services/marzpay-types.js";

/** Captured output of a stubbed `ctx.html(body, status)` call. */
interface CapturedHtml {
  body: string;
  status: number;
}

/**
 * A stub StreetContext that exposes just enough surface for the
 * CheckoutController failure path: an object `body` carrying the phone number,
 * a `state.marzpay` boundary, and capturing implementations of the response
 * methods the controller may call (`html`, `setHeader`, `send`).
 */
interface StubContext {
  ctx: StreetContext;
  htmlCalls: CapturedHtml[];
  /** Records whether a redirect/empty response was issued (happy-path signal). */
  sendCalls: number[];
  headers: Record<string, string>;
}

function makeContext(
  phoneNumber: string,
  marzpay: MarzPayClient,
): StubContext {
  const htmlCalls: CapturedHtml[] = [];
  const sendCalls: number[] = [];
  const headers: Record<string, string> = {};

  // A minimal request stub. The controller reads `phone_number` directly from
  // the object `body` below, so it never touches the raw request stream.
  const req = {
    complete: true,
    readableEnded: true,
  } as unknown as IncomingMessage;

  const ctx = {
    req,
    res: {} as unknown as ServerResponse,
    path: "/checkout",
    method: "POST",
    params: {},
    query: {},
    headers: {},
    body: { phone_number: phoneNumber },
    files: [],
    state: { marzpay },
    user: null,
    startTime: 0n,
    json(): void {},
    text(): void {},
    html(data: string, status?: number): void {
      htmlCalls.push({ body: data, status: status ?? 200 });
    },
    send(status: number): void {
      sendCalls.push(status);
    },
    setHeader(name: string, value: string): void {
      headers[name] = value;
    },
    cookie(): string | undefined {
      return undefined;
    },
    setCookie(): void {},
    sent: false,
  } as unknown as StreetContext;

  return { ctx, htmlCalls, sendCalls, headers };
}

/**
 * A description of how a `collectMoney` rejection should be shaped. Covers
 * ordinary error rejections, non-Error thrown values, and a timeout-style
 * rejection (Req 4.6 covers error results; Req 4.7 covers timeout-style ones).
 */
type RejectionSpec =
  | { kind: "error"; message: string }
  | { kind: "timeout" }
  | { kind: "string"; value: string }
  | { kind: "object" }
  | { kind: "undefined" };

const rejectionArb: fc.Arbitrary<RejectionSpec> = fc.oneof(
  fc.record({
    kind: fc.constant("error" as const),
    message: fc.string({ maxLength: 40 }),
  }),
  fc.constant({ kind: "timeout" as const }),
  fc.record({
    kind: fc.constant("string" as const),
    value: fc.string({ maxLength: 40 }),
  }),
  fc.constant({ kind: "object" as const }),
  fc.constant({ kind: "undefined" as const }),
);

/** Build the value a rejected `collectMoney` should reject with. */
function rejectionValue(spec: RejectionSpec): unknown {
  switch (spec.kind) {
    case "error":
      return new Error(spec.message);
    case "timeout": {
      // A timeout-style rejection as the plugin surfaces when `timeoutMs`
      // elapses (Req 4.7).
      const err = new Error("collectMoney timed out");
      err.name = "TimeoutError";
      (err as Error & { code?: string }).code = "ETIMEDOUT";
      return err;
    }
    case "string":
      return spec.value;
    case "object":
      return { code: "MARZPAY_ERROR", retriable: false };
    case "undefined":
      return undefined;
  }
}

/**
 * Build a MarzPay client stub whose phone validation always passes (so the
 * controller proceeds to `collectMoney`) and whose `collectMoney` always
 * rejects per the supplied spec. `getStatus`/`transactions.get`/`validateWebhook`
 * are not exercised on this path.
 */
function makeMarzpay(spec: RejectionSpec): MarzPayClient {
  return {
    collections: {
      collectMoney: () => Promise.reject(rejectionValue(spec)),
      getStatus: () => Promise.reject(new Error("not used")),
    },
    transactions: {
      get: () => Promise.reject(new Error("not used")),
    },
    validateWebhook: () => false,
    utils: {
      isValidPhoneNumber: () => true,
      formatPhoneNumber: (value: string) => value,
    },
  } as unknown as MarzPayClient;
}

/** Count every row currently stored in the payments table. */
async function totalRows(): Promise<number> {
  const result = await getPool().query(`SELECT COUNT(*) AS n FROM payments`);
  return Number(result.rows[0]?.n ?? 0);
}

/** A phone string that is non-empty after trimming (so it passes the gate). */
const phoneArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim() !== "");

describe("Property 8: Collection failure yields 502 and persists nothing", () => {
  beforeAll(async () => {
    // Real Payment_Store backed by a shared in-memory SQLite database.
    await initSchema({ filePath: ":memory:" });
  });

  afterAll(async () => {
    await closeStore();
  });

  it("responds 502 with a 'payment initiation failed' message and persists no record", async () => {
    await fc.assert(
      fc.asyncProperty(phoneArb, rejectionArb, async (phone, spec) => {
        // Clean slate so the "persists nothing" assertion is unambiguous.
        await getPool().query(`DELETE FROM payments`);

        const marzpay = makeMarzpay(spec);
        const { ctx, htmlCalls, sendCalls } = makeContext(phone, marzpay);

        const controller = new CheckoutController();
        await controller.create(ctx);

        // Exactly one HTML response, with status 502 and the failure message.
        expect(htmlCalls.length).toBe(1);
        expect(htmlCalls[0].status).toBe(502);
        expect(htmlCalls[0].body).toContain("payment initiation failed");

        // No redirect/empty response was issued (the happy path never ran).
        expect(sendCalls.length).toBe(0);

        // No Payment_Record was persisted.
        expect(await totalRows()).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
