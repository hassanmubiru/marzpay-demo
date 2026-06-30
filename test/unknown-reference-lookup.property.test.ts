import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fc from "fast-check";

import {
  initSchema,
  insertPending,
  findByReference,
  closeStore,
} from "../src/db/payments.js";

// Feature: streetjs-marzpay-demo, Property 15: Lookup of an unknown reference
// reports not found.
//
// For any reference that has never been stored, `findByReference(reference)`
// returns a not-found result.
//
// Strategy: back the Payment_Store with an in-memory SQLite database (pinned to
// a single worker internally for `':memory:'`). To guarantee the queried
// references are genuinely absent, we partition the reference namespace: every
// reference we actually persist is prefixed with `PRESENT_PREFIX`, while every
// generated query reference is prefixed with `ABSENT_PREFIX`. Because the two
// prefixes are disjoint, no generated query reference can ever collide with a
// stored one — so a correct store must always report it as not found.
//
// Validates: Requirements 6.6

const PRESENT_PREFIX = "present::";
const ABSENT_PREFIX = "absent::";

describe("Property 15: Lookup of an unknown reference reports not found", () => {
  beforeAll(async () => {
    // Fresh in-memory database for the whole suite.
    await initSchema({ filePath: ":memory:" });

    // Seed the store with a handful of known references under the PRESENT
    // namespace. This makes the lookups exercise a non-empty table while
    // keeping the ABSENT namespace provably disjoint, so absence is guaranteed
    // by construction rather than by an empty database alone.
    for (let i = 0; i < 16; i++) {
      const result = await insertPending({
        reference: `${PRESENT_PREFIX}${i}`,
        amount: 5000,
        currency: "UGX",
        status: "pending",
        createdAt: new Date().toISOString(),
      });
      expect(result.ok).toBe(true);
    }
  });

  afterAll(async () => {
    await closeStore();
  });

  it("returns { found: false } for references that were never stored", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Arbitrary text mapped into the ABSENT namespace, guaranteeing it can
        // never equal any reference persisted under the PRESENT namespace.
        fc.string().map((s) => `${ABSENT_PREFIX}${s}`),
        async (reference) => {
          const result = await findByReference(reference);
          expect(result.found).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
