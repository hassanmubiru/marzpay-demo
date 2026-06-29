// Feature: streetjs-marzpay-demo, Property 3: MARZPAY_ENVIRONMENT enum and
// default resolution. For any otherwise-valid environment: absent/empty
// MARZPAY_ENVIRONMENT resolves to "sandbox"; exactly "sandbox"/"production"
// resolves to that input; any other present, non-empty value yields ok: false
// with an error naming MARZPAY_ENVIRONMENT.
//
// Validates: Requirements 1.7, 1.8

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { validateConfig } from "../src/config.js";

/** Arbitrary for a valid, non-empty required-variable value. */
const nonEmpty = fc.string({ minLength: 1 }).filter((s) => s !== "");

/** Arbitrary for a valid PORT string (integer in [1, 65535]). */
const validPortString = fc
  .integer({ min: 1, max: 65535 })
  .map((n) => String(n));

/**
 * Build an otherwise-valid environment record (all required variables present,
 * non-empty, and a valid PORT). The MARZPAY_ENVIRONMENT entry is supplied by
 * the caller via the `envOverride` partial.
 */
function baseEnv(parts: {
  apiKey: string;
  secretKey: string;
  appUrl: string;
  port: string;
}): Record<string, string | undefined> {
  return {
    MARZPAY_API_KEY: parts.apiKey,
    MARZPAY_SECRET_KEY: parts.secretKey,
    APP_URL: parts.appUrl,
    PORT: parts.port,
  };
}

const validParts = fc.record({
  apiKey: nonEmpty,
  secretKey: nonEmpty,
  appUrl: nonEmpty,
  port: validPortString,
});

describe("Property 3: MARZPAY_ENVIRONMENT enum and default resolution", () => {
  it("resolves to 'sandbox' when MARZPAY_ENVIRONMENT is absent or empty", () => {
    fc.assert(
      fc.property(
        validParts,
        // absent (key omitted) or empty string
        fc.oneof(fc.constant<undefined>(undefined), fc.constant("")),
        (parts, envValue) => {
          const env = baseEnv(parts);
          if (envValue !== undefined) {
            env.MARZPAY_ENVIRONMENT = envValue;
          }
          // else: leave the key absent entirely

          const result = validateConfig(env);
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.config.marzpayEnvironment).toBe("sandbox");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("resolves to the input when MARZPAY_ENVIRONMENT is exactly sandbox/production", () => {
    fc.assert(
      fc.property(
        validParts,
        fc.constantFrom("sandbox", "production"),
        (parts, envValue) => {
          const env = baseEnv(parts);
          env.MARZPAY_ENVIRONMENT = envValue;

          const result = validateConfig(env);
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.config.marzpayEnvironment).toBe(envValue);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns ok: false naming MARZPAY_ENVIRONMENT for any other non-empty value", () => {
    const otherValue = fc
      .string({ minLength: 1 })
      .filter((s) => s !== "" && s !== "sandbox" && s !== "production");

    fc.assert(
      fc.property(validParts, otherValue, (parts, envValue) => {
        const env = baseEnv(parts);
        env.MARZPAY_ENVIRONMENT = envValue;

        const result = validateConfig(env);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          // Exactly one error, and it names MARZPAY_ENVIRONMENT (the only
          // offending variable in an otherwise-valid environment).
          expect(
            result.errors.some((e) => e.includes("MARZPAY_ENVIRONMENT")),
          ).toBe(true);
          expect(
            result.errors.every((e) => e.includes("MARZPAY_ENVIRONMENT")),
          ).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
