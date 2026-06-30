// Feature: streetjs-marzpay-demo, README content checks (Task 11.2)
//
// Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
//
// These are example-based content assertions over the project README.md. They
// confirm the documentation contains the required setup steps (with literal
// commands in the required order), per-variable documentation, the ordered
// end-to-end flow, the credential acquisition source, the reachable URL
// expressed via APP_URL and PORT, and the webhook-signature-limitation note.
//
// Ordering is asserted by comparing the relative indexOf positions of the
// literal commands / stage markers within the README text.

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const README_PATH = join(__dirname, "..", "README.md");

/** Assert that each item in `ordered` appears in `text`, in the given order. */
function assertOrdered(text: string, ordered: string[]): void {
  let previousIndex = -1;
  let previousNeedle = "<start>";
  for (const needle of ordered) {
    const index = text.indexOf(needle);
    expect(index, `README should contain: ${JSON.stringify(needle)}`).toBeGreaterThanOrEqual(0);
    expect(
      index,
      `${JSON.stringify(needle)} should appear after ${JSON.stringify(previousNeedle)}`,
    ).toBeGreaterThan(previousIndex);
    previousIndex = index;
    previousNeedle = needle;
  }
}

describe("README content (Task 11.2)", () => {
  let readme: string;

  beforeAll(() => {
    readme = readFileSync(README_PATH, "utf8");
  });

  // Requirement 8.1: ordered, numbered setup sequence with literal commands.
  it("documents the setup steps with literal commands in the required order", () => {
    assertOrdered(readme, [
      "git clone",
      "cd marzpay-demo",
      "npm install streetjs @streetjs/plugin-marzpay",
      "street add marzpay",
      "cp .env.example .env",
      "npm run dev",
    ]);
  });

  it("includes the literal install command and the street add marzpay alternative note", () => {
    expect(readme).toContain("npm install streetjs @streetjs/plugin-marzpay");
    expect(readme).toContain("street add marzpay");
    // The alternative note should reference the plugin/CLI alternative.
    expect(readme.toLowerCase()).toContain("alternativ");
  });

  it("presents the setup steps as an ordered numbered sequence", () => {
    expect(readme).toMatch(/^\s*1\.\s+/m);
    expect(readme).toMatch(/^\s*2\.\s+/m);
    expect(readme).toMatch(/^\s*6\.\s+/m);
  });

  // Requirement 8.2: per-variable documentation for all five variables.
  it("documents each of the five environment variables", () => {
    for (const variable of [
      "MARZPAY_API_KEY",
      "MARZPAY_SECRET_KEY",
      "MARZPAY_ENVIRONMENT",
      "APP_URL",
      "PORT",
    ]) {
      expect(readme, `README should document ${variable}`).toContain(variable);
    }
  });

  it("documents that MARZPAY_ENVIRONMENT is optional and defaults to sandbox", () => {
    // Find a window of text around the MARZPAY_ENVIRONMENT mention in the table.
    const idx = readme.indexOf("MARZPAY_ENVIRONMENT");
    expect(idx).toBeGreaterThanOrEqual(0);
    const window = readme.slice(idx, idx + 400).toLowerCase();
    expect(window).toContain("optional");
    expect(window).toContain("sandbox");
    expect(window).toMatch(/default/);
  });

  it("documents whether variables are mandatory at startup", () => {
    const lower = readme.toLowerCase();
    expect(lower).toContain("mandatory");
  });

  // Requirement 8.3: ordered end-to-end flow stages.
  it("describes the end-to-end payment flow as an ordered sequence of stages", () => {
    // Scope the ordering check to the dedicated flow section so generic words
    // (e.g. "Pay", "approve") in the intro don't perturb relative positions.
    const sectionStart = readme.indexOf("## End-to-End Payment Flow");
    expect(sectionStart).toBeGreaterThanOrEqual(0);
    const afterStart = readme.indexOf("\n## ", sectionStart + 3);
    const flowSection = readme.slice(
      sectionStart,
      afterStart === -1 ? readme.length : afterStart,
    );

    assertOrdered(flowSection, [
      'clicks the "Pay 5000 UGX"', // customer enters phone and clicks "Pay"
      "collectMoney", // checkout initiates collection against the sandbox
      "approves the mobile-money payment prompt", // customer approves on their phone
      "webhook to the Webhook handler", // MarzPay sends a webhook
      "getStatus(reference)", // validate + authoritative confirmation
      "SQLite", // persist confirmed payment to the store
      "displays the stored payment", // success page displays the payment
    ]);
  });

  it("mentions the checkout/collection, webhook, confirmation, persistence, and success stages", () => {
    const lower = readme.toLowerCase();
    expect(lower).toContain("checkout");
    expect(lower).toContain("webhook");
    expect(lower).toContain("getstatus");
    expect(lower).toContain("success page");
  });

  // Requirement 8.4: credential acquisition source.
  it("documents how to obtain the sandbox credentials and their source", () => {
    const lower = readme.toLowerCase();
    expect(lower).toContain("sandbox dashboard");
    // The credential section should reference both credential variables.
    expect(readme).toContain("MARZPAY_API_KEY");
    expect(readme).toContain("MARZPAY_SECRET_KEY");
  });

  // Requirement 8.5: reachable URL expressed via APP_URL and PORT.
  it("states the reachable URL in terms of APP_URL and PORT", () => {
    // Locate the sentence(s) describing reachability after npm run dev.
    const devIdx = readme.indexOf("npm run dev");
    expect(devIdx).toBeGreaterThanOrEqual(0);
    // APP_URL and PORT must both be referenced when describing reachability.
    expect(readme).toContain("APP_URL");
    expect(readme).toContain("PORT");
    // A reachability statement should tie the URL to APP_URL/PORT.
    const lower = readme.toLowerCase();
    expect(lower).toMatch(/reach|reachable|open|browser/);
  });

  // Requirement 8.6: webhook-signature-limitation note + authoritative confirmation.
  it("notes the webhook signature limitation and authoritative getStatus/transactions.get confirmation", () => {
    const lower = readme.toLowerCase();
    expect(lower).toContain("signature");
    expect(lower).toContain("limitation");
    expect(readme).toContain("collections.getStatus");
    expect(readme).toContain("transactions.get");
  });
});
