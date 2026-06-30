/**
 * CheckoutController — initiates a mobile-money collection and records a
 * pending Payment_Record.
 *
 * Route: `POST /checkout` (Requirements 2.1, 4.x).
 *
 * Flow (design "Request Lifecycle" step 2):
 *   1. Read the submitted phone number from the request.                (Req 4.1)
 *   2. If absent/empty or `marzpay.utils.isValidPhoneNumber` reports it
 *      invalid → HTTP 400 "a valid phone number is required" and DO NOT
 *      call `collectMoney`.                                            (Req 4.2)
 *   3. Generate a unique Reference via `generateReference()`.          (Req 4.3)
 *   4. Call `marzpay.collections.collectMoney({ amount: 5000,
 *      country: 'UG', reference, phone_number })` against the sandbox. (Req 4.4)
 *   5. On success → `insertPending` (amount 5000, currency `UGX`, status
 *      `pending`) and redirect to `/success?reference=<ref>`.         (Req 4.5)
 *   6. On error or timeout → HTTP 502 "payment initiation failed" with no
 *      Payment_Record persisted.                                  (Req 4.6, 4.7)
 *
 * The MarzPay client is the integration boundary, read from
 * `ctx.state.marzpay`; this controller calls it directly (no HTTP wrapper).
 */

import type { IncomingMessage } from "node:http";
import { Controller, Post } from "streetjs";
import type { StreetContext } from "streetjs";

import { insertPending } from "../db/payments.js";
import { generateReference, isValidPhone } from "../services/marzpay-helpers.js";
import type { MarzPayClient } from "../services/marzpay-types.js";

/** Fixed collection parameters for this demo (UGX 5000 mobile money in Uganda). */
const PAYMENT_AMOUNT = 5000;
const PAYMENT_CURRENCY = "UGX";
const PAYMENT_COUNTRY = "UG";
const PENDING_STATUS = "pending";

/** Upper bound on the raw request body we are willing to read (1 MB). */
const MAX_BODY_BYTES = 1024 * 1024;

@Controller("/checkout")
export class CheckoutController {
  /**
   * Handle a checkout submission. Renders an HTML error on the 400/502 paths
   * and issues a redirect to the success page on the happy path.
   */
  @Post("/")
  async create(ctx: StreetContext): Promise<void> {
    const marzpay = ctx.state.marzpay as MarzPayClient | undefined;

    // Req 4.1: read the submitted phone number from the request.
    const phoneNumber = await readPhoneNumber(ctx);

    // Req 4.2: reject absent/empty/invalid phone numbers WITHOUT calling
    // collectMoney. `isValidPhone` treats absent/empty as invalid and delegates
    // the format check to the offline plugin helper.
    if (
      marzpay === undefined ||
      !isValidPhone(marzpay.utils, phoneNumber)
    ) {
      ctx.html(renderMessage("a valid phone number is required"), 400);
      return;
    }

    // Req 4.3: assign a unique Reference distinct from every other payment.
    const reference = generateReference();

    // Req 4.4: initiate the collection against the MarzPay sandbox.
    try {
      await marzpay.collections.collectMoney({
        amount: PAYMENT_AMOUNT,
        country: PAYMENT_COUNTRY,
        reference,
        phone_number: phoneNumber as string,
      });
    } catch {
      // Req 4.6 / 4.7: an error result or a timeout-style rejection maps to 502
      // and persists NO Payment_Record (we have not written one yet).
      ctx.html(renderMessage("payment initiation failed"), 502);
      return;
    }

    // Req 4.5: persist a pending Payment_Record keyed by the Reference.
    const write = await insertPending({
      reference,
      amount: PAYMENT_AMOUNT,
      currency: PAYMENT_CURRENCY,
      status: PENDING_STATUS,
      createdAt: new Date().toISOString(),
    });
    if (!write.ok) {
      // The collection started but persistence failed; surface a server error
      // rather than redirecting to a success page that has no record to show.
      ctx.html(renderMessage("payment could not be saved"), 500);
      return;
    }

    // Req 4.5: direct the customer to the success page for this Reference.
    // 303 See Other is the correct POST -> GET redirect semantic.
    ctx.setHeader(
      "Location",
      `/success?reference=${encodeURIComponent(reference)}`,
    );
    ctx.send(303);
  }
}

/**
 * Extract the submitted `phone_number` from the request.
 *
 * StreetJS parses `application/json`, `text/*`, and `multipart/form-data`
 * bodies into `ctx.body`, but it does NOT parse
 * `application/x-www-form-urlencoded` (the default encoding of the Home_Page
 * form) — for that content type it leaves `ctx.body` null and the raw request
 * stream unconsumed. This helper therefore handles all three shapes:
 *
 *   - parsed object body  → read `phone_number`
 *   - parsed string body  → parse as URL-encoded form data
 *   - unparsed body (null)→ read the raw stream and parse it as URL-encoded
 *     form data, falling back to JSON
 *
 * Returns `undefined` when no usable phone value is present.
 */
async function readPhoneNumber(
  ctx: StreetContext,
): Promise<string | undefined> {
  const body = ctx.body;

  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const value = (body as Record<string, unknown>)["phone_number"];
    return typeof value === "string" ? value : undefined;
  }

  if (typeof body === "string") {
    return phoneFromUrlEncoded(body) ?? phoneFromJson(body);
  }

  // body is null/undefined. If the framework already consumed the stream
  // (e.g. an unparseable JSON body), there is nothing left to read.
  const req = ctx.req;
  if (req.complete || req.readableEnded) {
    return undefined;
  }

  let raw: string;
  try {
    raw = await readRawBody(req);
  } catch {
    return undefined;
  }
  if (raw === "") {
    return undefined;
  }
  return phoneFromUrlEncoded(raw) ?? phoneFromJson(raw);
}

/** Parse `phone_number` out of a URL-encoded form body. */
function phoneFromUrlEncoded(raw: string): string | undefined {
  const value = new URLSearchParams(raw).get("phone_number");
  return value === null ? undefined : value;
}

/** Parse `phone_number` out of a JSON object body. */
function phoneFromJson(raw: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const value = (parsed as Record<string, unknown>)["phone_number"];
      if (typeof value === "string") {
        return value;
      }
    }
  } catch {
    /* not JSON — fall through */
  }
  return undefined;
}

/** Read the raw request body as UTF-8 text, bounded by {@link MAX_BODY_BYTES}. */
function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const onData = (chunk: Buffer): void => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        cleanup();
        req.destroy();
        reject(new Error("request body exceeds limit"));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      cleanup();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    const cleanup = (): void => {
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

/**
 * Render a minimal HTML page surfacing a single status message. Used for the
 * 400 (invalid phone) and 502 (collection failed) responses so the message is
 * visible to the customer (Req 4.2, 4.6, 4.7).
 */
function renderMessage(message: string): string {
  const safe = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>StreetJS + MarzPay Demo</title>
    ${INLINE_PAGE_STYLE}
  </head>
  <body>
    <main class="card">
      <h1>StreetJS + MarzPay Demo</h1>
      <p class="status-message error">${safe}</p>
      <p><a class="back-link" href="/">&larr; Back to start</a></p>
    </main>
  </body>
</html>`;
}

/** Escape the five HTML-significant characters for safe interpolation. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
