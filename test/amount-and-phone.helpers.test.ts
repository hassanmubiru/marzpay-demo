import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  parseAmount,
  normalizePhone,
  acceptablePhone,
  MIN_AMOUNT,
  MAX_AMOUNT,
} from "../src/services/marzpay-helpers.js";

// Unit + property tests for the user-selectable amount and the local/
// international phone normalization helpers.

describe("parseAmount (500 – 1,000,000 UGX)", () => {
  it("accepts integers and numeric strings within range", () => {
    expect(parseAmount(500)).toEqual({ ok: true, amount: 500 });
    expect(parseAmount(1_000_000)).toEqual({ ok: true, amount: 1_000_000 });
    expect(parseAmount("5000")).toEqual({ ok: true, amount: 5000 });
    expect(parseAmount("50,000")).toEqual({ ok: true, amount: 50000 });
  });

  it("rejects out-of-range, fractional, and non-numeric values", () => {
    expect(parseAmount(499).ok).toBe(false);
    expect(parseAmount(1_000_001).ok).toBe(false);
    expect(parseAmount(1000.5).ok).toBe(false);
    expect(parseAmount("abc").ok).toBe(false);
    expect(parseAmount("").ok).toBe(false);
    expect(parseAmount(undefined).ok).toBe(false);
    expect(parseAmount(null).ok).toBe(false);
  });

  it("property: any integer in range is accepted and echoed back", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MIN_AMOUNT, max: MAX_AMOUNT }),
        (n) => {
          const r = parseAmount(n);
          return r.ok === true && r.amount === n;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("property: any integer outside range is rejected", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ max: MIN_AMOUNT - 1 }),
          fc.integer({ min: MAX_AMOUNT + 1 }),
        ),
        (n) => parseAmount(n).ok === false,
      ),
      { numRuns: 100 },
    );
  });
});

describe("normalizePhone (local + international → E.164)", () => {
  it("expands local UG numbers to +256", () => {
    expect(normalizePhone("0700000000")).toBe("+256700000000");
    expect(normalizePhone("0 700 000 000")).toBe("+256700000000");
  });

  it("keeps international numbers (with or without +)", () => {
    expect(normalizePhone("+256700000000")).toBe("+256700000000");
    expect(normalizePhone("256700000000")).toBe("+256700000000");
    expect(normalizePhone("+44 7700 900900")).toBe("+447700900900");
    expect(normalizePhone("00256700000000")).toBe("+256700000000");
  });

  it("rejects empty / too-short / non-numeric", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
  });
});

describe("acceptablePhone", () => {
  const stubValid = { isValidPhoneNumber: () => true };
  const stubInvalid = { isValidPhoneNumber: () => false };

  it("returns the normalized number when the plugin validates it", () => {
    expect(acceptablePhone(stubValid, "0700000000")).toBe("+256700000000");
  });

  it("accepts well-formed international E.164 even if the plugin rejects it", () => {
    expect(acceptablePhone(stubInvalid, "+447700900900")).toBe("+447700900900");
  });

  it("rejects clearly invalid input regardless of the plugin", () => {
    expect(acceptablePhone(stubValid, "")).toBeNull();
    expect(acceptablePhone(stubInvalid, "abc")).toBeNull();
  });
});
