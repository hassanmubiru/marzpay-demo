// Feature: streetjs-marzpay-demo, Property 6: Invalid phone numbers are rejected without a collection.
//
// For any submitted phone value that is absent, empty, or reported invalid by
// `marzpay.utils.isValidPhoneNumber`, the CheckoutController responds with HTTP
// status 400, surfaces a "valid phone number is required" message, and never
// invokes `collectMoney`.
//
// Validates: Requirements 4.1, 4.2
//
// Only the marzpay client boundary is stubbed: `utils.isValidPhoneNumber` is
// pinned to false and `collections.collectMoney` is a spy that records every
// invocation. A stub StreetContext captures `html(body, status)` and supplies
// the submitted phone via `ctx.body`. No network calls and no persistence are
// exercised on this rejection path (the handler returns before either).

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { StreetContext } from "streetjs";

import { CheckoutController } from "../src/controllers/checkout.controller.js";
import type {
  CollectMoneyInput,
  CollectMoneyResult,
  MarzPayClient,
} from "../src/services/marzpay-types.js";

/** A captured `ctx.html(body, status)` call. */
interface HtmlCall {
  body: string;
  status?: number;
}

/**
 * A phone-submission scenario. `absent` models a request whose body carries no
 * `phone_number` at all; `present` models a body that does carry one (which may
 * be empty, whitespace, or any arbitrary string).
 */
type PhoneScenario =
  | { kind: "absent" }
  | { kind: "present"; phone: string };

/**
 * Build a stub StreetContext for a single checkout invocation.
 *
 * - `ctx.body` carries the submitted phone (or omits it for the absent case).
 * - `ctx.req` reports the stream as already consumed so the controller does not
 *   attempt to read a raw body that does not exist in this stub.
 * - `ctx.state.marzpay` exposes a stubbed client whose `isValidPhoneNumber`
 *   always returns false and whose `collectMoney` is the supplied spy.
 * - `ctx.html` records each call so the test can assert status and message.
 */
function makeContext(
  scenario: PhoneScenario,
  collectMoney: (input: CollectMoneyInput) => Promise<CollectMoneyResult>,
): { ctx: StreetContext; htmlCalls: HtmlCall[] } {
  const htmlCalls: HtmlCall[] = [];

  const marzpay: MarzPayClient = {
    collections: {
      collectMoney,
      getStatus: async () => {
        throw new Error("getStatus must not be called on the gating path");
      },
    },
    transactions: {
      get: async () => {
        throw new Error("transactions.get must not be called on the gating path");
      },
    },
    validateWebhook: () => true,
    utils: {
      // Pinned invalid: any non-empty value the helper delegates here is rejected.
      isValidPhoneNumber: () => false,
      formatPhoneNumber: (v: string) => v,
    },
  };

  const body =
    scenario.kind === "absent"
      ? {}
      : { phone_number: scenario.phone };

  // A request stub whose stream is already finished, so the controller's raw
  // body fallback short-circuits to "no phone present".
  const req = {
    complete: true,
    readableEnded: true,
  } as unknown as StreetContext["req"];

  const ctx = {
    req,
    body,
    state: { marzpay },
    html: (data: string, status?: number) => {
      htmlCalls.push({ body: data, status });
    },
    setHeader: () => {
      throw new Error("setHeader must not be called on the gating path");
    },
    send: () => {
      throw new Error("send must not be called on the gating path");
    },
  } as unknown as StreetContext;

  return { ctx, htmlCalls };
}

describe("Property 6: Invalid phone numbers are rejected without a collection", () => {
  it("returns 400 with a 'valid phone number is required' message and never calls collectMoney", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          // Absent: no phone_number field on the body.
          fc.constant<PhoneScenario>({ kind: "absent" }),
          // Empty / whitespace-only values (rejected before any delegation).
          fc.constantFrom("", " ", "   ", "\t", "\n").map(
            (phone): PhoneScenario => ({ kind: "present", phone }),
          ),
          // Arbitrary strings reported invalid by the stubbed validator.
          fc.string().map((phone): PhoneScenario => ({ kind: "present", phone })),
        ),
        async (scenario) => {
          let collectCalls = 0;
          const collectSpy = async (
            _input: CollectMoneyInput,
          ): Promise<CollectMoneyResult> => {
            collectCalls += 1;
            return { reference: "should-not-happen", status: "pending" };
          };

          const { ctx, htmlCalls } = makeContext(scenario, collectSpy);

          await new CheckoutController().create(ctx);

          // Exactly one HTML response, with HTTP 400.
          expect(htmlCalls).toHaveLength(1);
          expect(htmlCalls[0].status).toBe(400);
          // The message must indicate a valid phone number is required.
          expect(htmlCalls[0].body).toContain("a valid phone number is required");
          // collectMoney must never be invoked on the rejection path.
          expect(collectCalls).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
