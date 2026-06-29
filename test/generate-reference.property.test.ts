import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { generateReference } from "../src/services/marzpay-helpers.js";

// Feature: streetjs-marzpay-demo, Property 5: Generated references are unique.
// For any number of payments created through `generateReference`, every
// generated Reference is distinct from every other generated Reference (no
// collisions across the generated set).
//
// Validates: Requirements 4.3
describe("Property 5: Generated references are unique", () => {
  it("produces N distinct references with no collisions", () => {
    fc.assert(
      fc.property(
        // Each run picks a batch size N and generates that many references.
        // Using a sizeable range exercises both small and large sets while
        // keeping each run fast.
        fc.integer({ min: 1, max: 1000 }),
        (n) => {
          const references: string[] = [];
          for (let i = 0; i < n; i++) {
            references.push(generateReference());
          }

          const unique = new Set(references);
          // Every generated reference must be distinct from every other one.
          expect(unique.size).toBe(references.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
