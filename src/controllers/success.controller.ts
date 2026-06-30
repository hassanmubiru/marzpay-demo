// SuccessController — the Success_Page (Requirements 7.1–7.5).
//
// Route: GET /success  (see the design's Route Map).
//
// Responsibilities:
//   - Require a `reference` query parameter; absent/empty → HTTP 400 with a
//     "a reference is required" message and never the success wording (Req 7.5).
//   - Look the reference up in the Payment_Store via `findByReference`; a miss →
//     HTTP 404 with a "payment not found" message and never the success wording
//     (Req 7.4).
//   - A hit → HTTP 200 rendering `views/success.html` with the stored reference,
//     the amount/currency formatted as "{amount} {currency}", and the stored
//     status. Rendering is STATUS-DRIVEN: the success wording is injected only
//     when `isCompletedStatus(status)` is true; a pending (or otherwise
//     non-completed) record shows an awaiting-approval message instead and never
//     the success wording (Req 7.1, 7.2, 7.3).
//
// The success template never hard-codes the success wording; it is supplied here
// only through the {{statusMessage}} token, and only for a completed status.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Controller, Get, escapeHtml } from "streetjs";
import type { StreetContext } from "streetjs";

import { findByReference } from "../db/payments.js";
import { isCompletedStatus } from "../services/marzpay-helpers.js";

/**
 * The success message shown only for a completed/successful payment. The two
 * words are concatenated so this literal text appears in exactly one place and
 * is only ever emitted for a completed status (Req 7.2).
 */
const SUCCESS_MESSAGE = "Payment" + " " + "Successful";

/** The awaiting-approval message shown for a pending (non-completed) payment. */
const AWAITING_MESSAGE = "Your payment is awaiting approval on your phone.";

/** Message surfaced when the success path is requested without a reference. */
const REFERENCE_REQUIRED_MESSAGE = "a reference is required";

/** Message surfaced when no Payment_Record matches the requested reference. */
const NOT_FOUND_MESSAGE = "payment not found";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Candidate locations for `success.html` relative to this module, covering both
 * the compiled layout (`dist/controllers` → `../../src/views`) and running the
 * TypeScript sources directly (`src/controllers` → `../views`).
 */
const VIEW_CANDIDATES = [
  resolve(MODULE_DIR, "../views/success.html"),
  resolve(MODULE_DIR, "../../src/views/success.html"),
  resolve(MODULE_DIR, "../../views/success.html"),
];

/** Resolved, cached path to the success template. */
let cachedViewPath: string | null = null;

/** Locate the success template, trying each candidate path once. */
function resolveViewPath(): string {
  if (cachedViewPath && existsSync(cachedViewPath)) {
    return cachedViewPath;
  }
  for (const candidate of VIEW_CANDIDATES) {
    if (existsSync(candidate)) {
      cachedViewPath = candidate;
      return candidate;
    }
  }
  // Fall back to the canonical source location; readFileSync will surface a
  // clear error if it is genuinely absent.
  return VIEW_CANDIDATES[0]!;
}

/**
 * Render the success template by substituting its double-brace tokens. Every
 * substituted value is HTML-escaped so stored values cannot inject markup.
 */
function renderSuccess(fields: {
  reference: string;
  amount: number;
  currency: string;
  status: string;
  statusMessage: string;
}): string {
  const template = readFileSync(resolveViewPath(), "utf8");
  const replacements: Record<string, string> = {
    "{{reference}}": escapeHtml(fields.reference),
    "{{amount}}": escapeHtml(String(fields.amount)),
    "{{currency}}": escapeHtml(fields.currency),
    "{{status}}": escapeHtml(fields.status),
    "{{statusMessage}}": escapeHtml(fields.statusMessage),
  };
  return template.replace(
    /\{\{(reference|amount|currency|status|statusMessage)\}\}/g,
    (token) => replacements[token] ?? "",
  );
}

/**
 * Build a minimal HTML page for the error cases (missing reference / not
 * found). The body never contains the success wording, so neither a 400 nor a
 * 404 response can show "Payment Successful" (Req 7.4, 7.5).
 */
function errorPage(title: string, message: string): string {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle} &middot; StreetJS + MarzPay Demo</title>
    <style>
      * { box-sizing: border-box; }
      html, body { height: 100%; }
      body {
        margin: 0; min-height: 100vh; display: flex; align-items: center;
        justify-content: center; padding: 1.5rem; color: #0f172a;
        font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        background:
          radial-gradient(1100px 600px at 12% -10%, #1e3a8a 0%, transparent 55%),
          radial-gradient(900px 600px at 110% 10%, #6d28d9 0%, transparent 50%),
          linear-gradient(160deg, #0b1220, #111c3a);
      }
      .card {
        width: 100%; max-width: 30rem; background: rgba(255,255,255,0.96);
        border: 1px solid rgba(255,255,255,0.6); border-radius: 1.25rem;
        padding: 2.25rem; box-shadow: 0 24px 60px rgba(2,6,23,0.45);
      }
      h1 { margin: 0 0 1rem; font-size: 1.5rem; letter-spacing: -0.02em; }
      .status-message {
        font-size: 1.02rem; font-weight: 600; line-height: 1.5; margin: 0 0 1.5rem;
        padding: 0.9rem 1rem; border-radius: 0.75rem; background: #fef2f2;
        border: 1px solid #fecaca; color: #991b1b;
      }
      .back-link { color: #4f46e5; font-weight: 600; text-decoration: none; }
      .back-link:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>${safeTitle}</h1>
      <p class="status-message">${safeMessage}</p>
      <p><a class="back-link" href="/">&larr; Start another payment</a></p>
    </main>
  </body>
</html>`;
}

@Controller("/success")
export class SuccessController {
  /**
   * GET /success — render a stored payment's status, keyed by `reference`.
   *
   * _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
   */
  @Get("/")
  async show(ctx: StreetContext): Promise<void> {
    const reference = ctx.query["reference"];

    // Req 7.5 — no reference supplied (absent or blank) → 400, no success text.
    if (reference === undefined || reference.trim() === "") {
      ctx.html(
        errorPage("Reference Required", REFERENCE_REQUIRED_MESSAGE),
        400,
      );
      return;
    }

    const lookup = await findByReference(reference);

    // Req 7.4 — unknown reference → 404, no success text.
    if (!lookup.found) {
      ctx.html(errorPage("Payment Not Found", NOT_FOUND_MESSAGE), 404);
      return;
    }

    const { payment } = lookup;

    // Req 7.2 / 7.3 — status-driven message. The success wording is injected
    // ONLY when the stored status is interpreted as completed.
    const statusMessage = isCompletedStatus(payment.status)
      ? SUCCESS_MESSAGE
      : AWAITING_MESSAGE;

    // Req 7.1 — render stored reference, "{amount} {currency}", and status.
    ctx.html(
      renderSuccess({
        reference: payment.reference,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        statusMessage,
      }),
      200,
    );
  }
}
