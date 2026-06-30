import { describe, it, expect } from "vitest";

import type { StreetContext } from "streetjs";

import { SuccessController } from "../src/controllers/success.controller.js";

// Task 6.16 — Unit test for the Success_Page missing-reference case.
//
// When the success path is requested with no `reference` supplied, the
// SuccessController must respond with HTTP status 400, surface a message
// indicating that a reference is required, and never display the success
// wording "Payment Successful".
//
// _Requirements: 7.5_

interface HtmlCall {
  body: string;
  status: number;
}

/**
 * Build a minimal StreetContext exposing exactly what SuccessController.show
 * reads on this path: `query.reference` for input and `html(body, status)` as
 * the response sink. The store is never consulted because the handler returns
 * before any lookup when the reference is missing.
 */
function makeContext(query: Record<string, string>): {
  ctx: StreetContext;
  htmlCalls: HtmlCall[];
} {
  const htmlCalls: HtmlCall[] = [];
  const ctx = {
    query,
    html(body: string, status?: number): void {
      htmlCalls.push({ body, status: status ?? 200 });
    },
  } as unknown as StreetContext;
  return { ctx, htmlCalls };
}

describe("SuccessController missing-reference case (Req 7.5)", () => {
  it("returns HTTP 400 with 'a reference is required' and no success text when reference is absent", async () => {
    const controller = new SuccessController();
    const { ctx, htmlCalls } = makeContext({});

    await controller.show(ctx);

    expect(htmlCalls).toHaveLength(1);
    const [response] = htmlCalls;
    expect(response!.status).toBe(400);
    expect(response!.body).toContain("a reference is required");
    expect(response!.body).not.toContain("Payment Successful");
  });

  it("returns HTTP 400 with 'a reference is required' and no success text when reference is an empty string", async () => {
    const controller = new SuccessController();
    const { ctx, htmlCalls } = makeContext({ reference: "" });

    await controller.show(ctx);

    expect(htmlCalls).toHaveLength(1);
    const [response] = htmlCalls;
    expect(response!.status).toBe(400);
    expect(response!.body).toContain("a reference is required");
    expect(response!.body).not.toContain("Payment Successful");
  });

  it("returns HTTP 400 with 'a reference is required' and no success text when reference is whitespace only", async () => {
    const controller = new SuccessController();
    const { ctx, htmlCalls } = makeContext({ reference: "   " });

    await controller.show(ctx);

    expect(htmlCalls).toHaveLength(1);
    const [response] = htmlCalls;
    expect(response!.status).toBe(400);
    expect(response!.body).toContain("a reference is required");
    expect(response!.body).not.toContain("Payment Successful");
  });
});
