import { describe, it, expect } from "vitest";

import { derivePayment, type EventRow } from "../src/db/supabase-store.js";

// Unit tests for the pure append-only reduction used by the Supabase store.
// Status comes from the latest event; amount/currency come from the latest
// event with a valid value (so a zero-amount completion self-heals).

function evt(partial: Partial<EventRow>): EventRow {
  return {
    reference: "ref",
    amount: 0,
    currency: "UGX",
    status: "pending",
    created_at: "2024-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("derivePayment", () => {
  it("reports not found for an empty event list", () => {
    expect(derivePayment("ref", [])).toEqual({ found: false });
  });

  it("takes status from the most recent event", () => {
    const r = derivePayment("ref", [
      evt({ amount: 500, status: "pending", created_at: "2024-01-01T00:00:00.000Z" }),
      evt({ amount: 500, status: "completed", created_at: "2024-01-01T00:05:00.000Z" }),
    ]);
    expect(r.found).toBe(true);
    if (r.found) expect(r.payment.status).toBe("completed");
  });

  it("self-heals: a zero-amount completion keeps the earlier real amount", () => {
    const r = derivePayment("ref", [
      evt({ amount: 500, currency: "UGX", status: "pending", created_at: "2024-01-01T00:00:00.000Z" }),
      evt({ amount: 0, currency: "UGX", status: "completed", created_at: "2024-01-01T00:05:00.000Z" }),
    ]);
    expect(r.found).toBe(true);
    if (r.found) {
      expect(r.payment.status).toBe("completed");
      expect(r.payment.amount).toBe(500); // not clobbered to 0
      expect(r.payment.currency).toBe("UGX");
    }
  });

  it("uses the confirmed amount when the completion carries a positive value", () => {
    const r = derivePayment("ref", [
      evt({ amount: 500, status: "pending", created_at: "2024-01-01T00:00:00.000Z" }),
      evt({ amount: 5000, status: "completed", created_at: "2024-01-01T00:05:00.000Z" }),
    ]);
    expect(r.found).toBe(true);
    if (r.found) expect(r.payment.amount).toBe(5000);
  });

  it("uses the earliest event's timestamp as created_at", () => {
    const r = derivePayment("ref", [
      evt({ created_at: "2024-01-01T00:05:00.000Z", status: "completed" }),
      evt({ created_at: "2024-01-01T00:00:00.000Z", status: "pending", amount: 500 }),
    ]);
    expect(r.found).toBe(true);
    if (r.found) expect(r.payment.createdAt).toBe("2024-01-01T00:00:00.000Z");
  });
});
