import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fc from "fast-check";

import { SuccessController } from "../src/controllers/success.controller.js";
import {
  initSchema,
  closeStore,
  insertPending,
} from "../src/db/payments.js";
import { isCompletedStatus } from "../src/services/marzpay-helpers.js";
import type { StreetContext } from "streetjs";

// Feature: streetjs-marzpay-demo, Property 17: Success page rendering is
// status-driven.
//
// For any stored Payment_Record, the Success_Page displays the text
// "Payment Successful" if and only if `isCompletedStatus(status)` is true; when
// the status is `pending` it displays an awaiting-approval message and does not
// display "Payment Successful".
//
// Validates: Requirements 7.2, 7.3

/** The exact completed-state wording the success page may emit (Req 7.2). */
const SUCCESS_TEXT = "Payment Successful";

/**
 * The awaiting-approval wording the controller injects for a pending (or any
 * non-completed) record (Req 7.3). Mirrors the controller's AWAITING_MESSAGE.
 */
const AWAITING_TEXT = "awaiting approval";

/** A captured `ctx.html(body, status)` call. */
interface HtmlCall {
  body: string;
  status: number | undefined;
}

/**
 * Build a stub StreetContext exposing exactly what SuccessController reads: the
 * `reference` query parameter and an `html(body, status)` sink that records the
 * rendered response for assertions.
 */
function makeContext(reference: string): {
  ctx: StreetContext;
  htmlCalls: HtmlCall[];
} {
  const htmlCalls: HtmlCall[] = [];
  const ctx = {
    query: { reference },
    html(body: string, status?: number): void {
      htmlCalls.push({ body, status });
    },
  } as unknown as StreetContext;
  return { ctx, htmlCalls };
}

// Monotonic counter guaranteeing a distinct reference per generated case so the
// shared in-memory DB never trips the UNIQUE(reference) constraint across runs.
let caseCounter = 0;

describe("Property 17: Success page rendering is status-driven", () => {
  beforeAll(async () => {
    await initSchema({ filePath: ":memory:" });
  });

  afterAll(async () => {
    await closeStore();
  });

  it('shows "Payment Successful" iff isCompletedStatus(status), and an awaiting message (not success) for pending', async () => {
    // Completed/successful vocabulary, including case- and whitespace-variants
    // that isCompletedStatus normalizes (trim + lowercase).
    const completedArb = fc.constantFrom(
      "completed",
      "successful",
      "success",
      "COMPLETED",
      "Successful",
      "  success  ",
    );
    // The pending status, exercised explicitly for the Req 7.3 assertion.
    const pendingArb = fc.constant("pending");
    // Arbitrary other statuses that are neither completed nor pending.
    const otherArb = fc
      .string({ maxLength: 16 })
      .filter(
        (s) => !isCompletedStatus(s) && s.trim().toLowerCase() !== "pending",
      );

    const statusArb = fc.oneof(completedArb, pendingArb, otherArb);

    const controller = new SuccessController();

    await fc.assert(
      fc.asyncProperty(
        statusArb,
        fc.double({
          min: 0,
          max: 1e9,
          noNaN: true,
          noDefaultInfinity: true,
        }),
        fc.string({ minLength: 1, maxLength: 8 }),
        async (status, amount, currency) => {
          const reference = `ref-${caseCounter++}`;

          // Seed a stored record carrying the generated status directly.
          const inserted = await insertPending({
            reference,
            amount,
            currency,
            status,
            createdAt: new Date().toISOString(),
          });
          expect(inserted.ok).toBe(true);

          const { ctx, htmlCalls } = makeContext(reference);
          await controller.show(ctx);

          // A found record renders exactly one HTTP 200 HTML response.
          expect(htmlCalls).toHaveLength(1);
          const { body, status: httpStatus } = htmlCalls[0]!;
          expect(httpStatus).toBe(200);

          const completed = isCompletedStatus(status);

          // Req 7.2: "Payment Successful" appears iff the status is completed.
          expect(body.includes(SUCCESS_TEXT)).toBe(completed);

          // Req 7.3: a pending record shows an awaiting-approval message and
          // never the success wording.
          if (status === "pending") {
            expect(body.includes(AWAITING_TEXT)).toBe(true);
            expect(body.includes(SUCCESS_TEXT)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
