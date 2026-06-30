import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fc from "fast-check";

import { CheckoutController } from "../src/controllers/checkout.controller.js";
import {
  initSchema,
  closeStore,
  findByReference,
  getPool,
} from "../src/db/payments.js";
import type {
  CollectMoneyInput,
  CollectMoneyResult,
  MarzPayClient,
} from "../src/services/marzpay-types.js";
import type { StreetContext } from "streetjs";

// Feature: streetjs-marzpay-demo, Property 7: Valid checkout shapes the
// collection and persists a pending record.
//
// For any phone value reported valid by `marzpay.utils.isValidPhoneNumber` and
// a successful `collectMoney` result, the CheckoutController calls
// `collectMoney` with exactly { amount: 5000, country: 'UG',
// phone_number: <submitted phone>, reference: <generated reference> }, persists
// exactly one pending Payment_Record for that reference with amount 5000,
// currency `UGX`, and status `pending`, and directs the customer to
// `/success?reference=<reference>`.
//
// Validates: Requirements 4.4, 4.5

/** Records of one stubbed checkout interaction, captured for assertions. */
interface Captured {
  /** Arguments passed to `collectMoney` (one entry per call). */
  collectCalls: CollectMoneyInput[];
  /** Status code passed to `ctx.send`, if any. */
  sendStatus: number | undefined;
  /** (name, value) pairs passed to `ctx.setHeader`. */
  headers: Record<string, string>;
  /** Bodies/status passed to `ctx.html`, if any. */
  htmlCalls: { body: string; status: number | undefined }[];
}

/**
 * Build a stub StreetContext whose body carries the submitted phone, whose
 * marzpay client reports the phone valid and resolves `collectMoney`
 * successfully, and which captures setHeader/send/html for assertions.
 */
function makeContext(phone: string): { ctx: StreetContext; captured: Captured } {
  const captured: Captured = {
    collectCalls: [],
    sendStatus: undefined,
    headers: {},
    htmlCalls: [],
  };

  const marzpay = {
    collections: {
      collectMoney: (input: CollectMoneyInput): Promise<CollectMoneyResult> => {
        captured.collectCalls.push(input);
        return Promise.resolve({
          reference: input.reference,
          status: "pending",
        });
      },
      getStatus: () => Promise.reject(new Error("not used")),
    },
    transactions: {
      get: () => Promise.reject(new Error("not used")),
    },
    validateWebhook: () => false,
    utils: {
      // Phone validity is stubbed true: the generator already produces
      // non-blank phone strings, so the controller reaches the collection path.
      isValidPhoneNumber: () => true,
      formatPhoneNumber: (value: string) => value,
    },
  } satisfies MarzPayClient;

  const ctx = {
    // The submitted phone arrives as a parsed object body, so the controller
    // reads `phone_number` directly without touching the raw request stream.
    body: { phone_number: phone },
    state: { marzpay },
    setHeader(name: string, value: string): void {
      captured.headers[name] = value;
    },
    send(status: number): void {
      captured.sendStatus = status;
    },
    html(body: string, status?: number): void {
      captured.htmlCalls.push({ body, status });
    },
  } as unknown as StreetContext;

  return { ctx, captured };
}

/** Count the rows stored for a given reference (idempotency / uniqueness check). */
async function countByReference(reference: string): Promise<number> {
  const result = await getPool().query(
    "SELECT COUNT(*) AS n FROM payments WHERE reference = ?",
    [reference],
  );
  return Number(result.rows[0]?.n ?? 0);
}

describe("Property 7: Valid checkout shapes the collection and persists a pending record", () => {
  beforeAll(async () => {
    await initSchema({ filePath: ":memory:" });
  });

  afterAll(async () => {
    await closeStore();
  });

  it("calls collectMoney with the exact shape, persists one pending record, and redirects", async () => {
    // Valid phone strings: realistic UG MSISDNs plus arbitrary non-blank
    // strings (all accepted because isValidPhoneNumber is stubbed true).
    const phoneArb = fc.oneof(
      fc
        .integer({ min: 100_000_000, max: 999_999_999 })
        .map((n) => `+256${n}`),
      fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim() !== ""),
    );

    const controller = new CheckoutController();

    await fc.assert(
      fc.asyncProperty(phoneArb, async (phone) => {
        const { ctx, captured } = makeContext(phone);

        await controller.create(ctx);

        // Req 4.4: collectMoney called exactly once with EXACTLY the required
        // shape — amount 5000, country 'UG', the submitted phone, and the
        // generated reference (and no other keys).
        expect(captured.collectCalls).toHaveLength(1);
        const call = captured.collectCalls[0]!;
        expect(Object.keys(call).sort()).toEqual(
          ["amount", "country", "phone_number", "reference"].sort(),
        );
        expect(call.amount).toBe(5000);
        expect(call.country).toBe("UG");
        expect(call.phone_number).toBe(phone);
        expect(typeof call.reference).toBe("string");
        expect(call.reference.length).toBeGreaterThan(0);

        const reference = call.reference;

        // Req 4.5: exactly one pending Payment_Record persisted for that
        // reference with amount 5000, currency UGX, status pending.
        expect(await countByReference(reference)).toBe(1);
        const lookup = await findByReference(reference);
        expect(lookup.found).toBe(true);
        if (!lookup.found) return;
        expect(lookup.payment.reference).toBe(reference);
        expect(lookup.payment.amount).toBe(5000);
        expect(lookup.payment.currency).toBe("UGX");
        expect(lookup.payment.status).toBe("pending");

        // Req 4.5: direct the customer to the success page for this reference
        // via a 303 redirect with the correct Location header.
        expect(captured.sendStatus).toBe(303);
        expect(captured.headers["Location"]).toBe(
          `/success?reference=${encodeURIComponent(reference)}`,
        );

        // No error page should have been rendered on the happy path.
        expect(captured.htmlCalls).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});
