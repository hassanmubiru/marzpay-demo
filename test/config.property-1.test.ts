import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { validateConfig } from "../src/config.js";

// Feature: streetjs-marzpay-demo, Property 1: Configuration requires all
// mandatory variables. For any environment record in which one or more of
// MARZPAY_API_KEY, MARZPAY_SECRET_KEY, APP_URL, or PORT is absent or an empty
// string, validateConfig returns ok: false and its errors list names every
// offending variable (and no variable that is actually present and valid).
//
// Validates: Requirements 1.4, 1.5

/** The four mandatory variables under test. */
const REQUIRED_KEYS = [
  "MARZPAY_API_KEY",
  "MARZPAY_SECRET_KEY",
  "APP_URL",
  "PORT",
] as const;

type RequiredKey = (typeof REQUIRED_KEYS)[number];

/** Per-key presence state: a valid value, absent, or blank ("" / undefined). */
type KeyState = "valid" | "absent" | "blank";

/** A non-empty, valid value for a given required key. */
function validValueFor(key: RequiredKey): string {
  // PORT must parse to an integer in [1, 65535] to be considered valid;
  // every other required key just needs to be a non-empty string.
  return key === "PORT" ? "3000" : `value-${key}`;
}

/**
 * Build an environment record from per-key states. Keys in the "absent" state
 * are omitted entirely; "blank" keys are set to the empty string; "valid" keys
 * receive a valid value. MARZPAY_ENVIRONMENT is always set to a non-offending
 * value so it can never contribute to the errors list.
 */
function buildEnv(
  states: Record<RequiredKey, KeyState>,
  environmentValue: string | undefined,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const key of REQUIRED_KEYS) {
    const state = states[key];
    if (state === "valid") {
      env[key] = validValueFor(key);
    } else if (state === "blank") {
      env[key] = "";
    }
    // "absent" => leave the key off the record entirely.
  }
  if (environmentValue !== undefined) {
    env.MARZPAY_ENVIRONMENT = environmentValue;
  }
  return env;
}

/** True when a key's state means it should be reported as offending. */
function isOffending(state: KeyState): boolean {
  return state === "absent" || state === "blank";
}

describe("Property 1: Configuration requires all mandatory variables", () => {
  it("reports exactly the absent/blank required variables and no valid ones", () => {
    const keyStateArb: fc.Arbitrary<KeyState> = fc.constantFrom(
      "valid",
      "absent",
      "blank",
    );

    const statesArb = fc
      .record<Record<RequiredKey, KeyState>>({
        MARZPAY_API_KEY: keyStateArb,
        MARZPAY_SECRET_KEY: keyStateArb,
        APP_URL: keyStateArb,
        PORT: keyStateArb,
      })
      // Precondition: at least one required variable must be offending so we
      // are exercising the failure path this property is about.
      .filter((states) => REQUIRED_KEYS.some((k) => isOffending(states[k])));

    // MARZPAY_ENVIRONMENT is optional and must never be offending here, so it
    // is restricted to absent/empty/valid enum values.
    const environmentArb = fc.constantFrom<string | undefined>(
      undefined,
      "",
      "sandbox",
      "production",
    );

    fc.assert(
      fc.property(statesArb, environmentArb, (states, environmentValue) => {
        const env = buildEnv(states, environmentValue);
        const result = validateConfig(env);

        // The configuration must be rejected.
        expect(result.ok).toBe(false);
        if (result.ok) return; // narrow type; unreachable given assertion above

        const offending = REQUIRED_KEYS.filter((k) => isOffending(states[k]));
        const valid = REQUIRED_KEYS.filter((k) => !isOffending(states[k]));

        // Every offending variable is named in the errors list.
        for (const key of offending) {
          expect(result.errors.some((e) => e.includes(key))).toBe(true);
        }

        // No valid variable is named in the errors list.
        for (const key of valid) {
          expect(result.errors.some((e) => e.includes(key))).toBe(false);
        }

        // The errors name exactly the offending variables: one entry each,
        // with no extraneous errors (MARZPAY_ENVIRONMENT is never offending).
        expect(result.errors.length).toBe(offending.length);
      }),
      { numRuns: 100 },
    );
  });
});
