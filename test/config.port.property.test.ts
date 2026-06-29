// Feature: streetjs-marzpay-demo, Property 2: PORT must be an integer in [1, 65535]
//
// Validates: Requirements 1.6, 1.9
//
// For any environment in which PORT does not parse to an integer within the
// inclusive range 1-65535 (non-numeric, fractional, zero, negative, or out of
// range), validateConfig returns ok: false with an error naming PORT; and for
// any otherwise-valid environment whose PORT is an integer in [1, 65535], the
// resolved config.port equals that integer.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { validateConfig } from "../src/config.js";

/**
 * Build an otherwise-valid environment record, leaving PORT to the caller so
 * that the only variable under test is PORT itself. MARZPAY_ENVIRONMENT is
 * randomly absent or a valid enum value so that it never contributes an error.
 */
function baseEnv(
  port: string | undefined,
  environment?: string,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    MARZPAY_API_KEY: "api-key",
    MARZPAY_SECRET_KEY: "secret-key",
    APP_URL: "https://example.test",
  };
  if (port !== undefined) {
    env.PORT = port;
  }
  if (environment !== undefined) {
    env.MARZPAY_ENVIRONMENT = environment;
  }
  return env;
}

/** True when at least one error entry names PORT. */
function hasPortError(errors: string[]): boolean {
  return errors.some((e) => e.includes("PORT"));
}

describe("Property 2: PORT must be an integer in [1, 65535]", () => {
  it("rejects PORT values that are not integers in [1, 65535] with an error naming PORT", () => {
    // Arbitrary that produces invalid PORT strings spanning every invalid
    // shape called out by the property: non-numeric, fractional, zero,
    // negative, and out-of-range (both below 1 and above 65535).
    const invalidPort = fc.oneof(
      // Non-numeric strings (letters/symbols, never a bare run of digits).
      fc
        .string()
        .filter((s) => !/^\s*\d+\s*$/.test(s)),
      // Fractional numbers rendered as strings, e.g. "80.5".
      fc
        .float({ min: Math.fround(0.01), max: 70000, noNaN: true })
        .filter((n) => !Number.isInteger(n))
        .map((n) => String(n)),
      // Zero, expressed a few ways.
      fc.constantFrom("0", "00", " 0 "),
      // Negative integers.
      fc.integer({ min: -100000, max: -1 }).map((n) => String(n)),
      // Out of range above the maximum.
      fc.integer({ min: 65536, max: 10_000_000 }).map((n) => String(n)),
    );

    fc.assert(
      fc.property(
        invalidPort,
        fc.option(fc.constantFrom("sandbox", "production"), { nil: undefined }),
        (port, environment) => {
          const result = validateConfig(baseEnv(port, environment));
          // Must fail and the failure must name PORT.
          expect(result.ok).toBe(false);
          if (result.ok === false) {
            expect(hasPortError(result.errors)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("accepts integer PORT values in [1, 65535] and resolves config.port to that integer", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 65535 }),
        fc.option(fc.constantFrom("sandbox", "production"), { nil: undefined }),
        (port, environment) => {
          const result = validateConfig(baseEnv(String(port), environment));
          // Otherwise-valid env with a good PORT must succeed and round-trip.
          expect(result.ok).toBe(true);
          if (result.ok === true) {
            expect(result.config.port).toBe(port);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
