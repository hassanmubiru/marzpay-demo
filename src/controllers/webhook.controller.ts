// WebhookController — receives MarzPay webhook events at POST /webhooks/marzpay.
//
// The ordering mandated by Requirement 5 is strict and security-relevant:
//
//   1. validateWebhook(rawBody, signature) FIRST — before reading the event
//      content or touching any Payment_Record (Req 5.1). Invalid → HTTP 401
//      with every record left unchanged (Req 5.2).
//   2. parseWebhookReference(rawBody) — a validated-but-unparseable body, or one
//      carrying no reference, → HTTP 400 with every record unchanged (Req 5.3).
//   3. collections.getStatus(reference) — the AUTHORITATIVE completion check,
//      because the webhook signature scheme is a documented plugin limitation
//      (Req 5.4). A non-completed status → HTTP 200, record unchanged (Req 5.5).
//   4. On a completed status, read transactions.get(reference) for the confirmed
//      amount/currency/status and record completion via the Payment_Store,
//      returning HTTP 200 (Req 5.6, 6.2). A DB write failure → HTTP 500 with a
//      database-write-failed indication and no partial row (Req 6.4).

import type { StreetContext } from "streetjs";
import { Controller, Post } from "streetjs";

import { markCompleted, findByReference } from "../db/store.js";
import {
  isCompletedStatus,
  parseWebhookReference,
} from "../services/marzpay-helpers.js";
import type { MarzPayClient } from "../services/marzpay-types.js";

/**
 * Request header names that may carry the webhook signature. The MarzPay
 * signature scheme is undocumented (a recorded plugin limitation), so no single
 * canonical header is guaranteed; we look across the common candidates and fall
 * back to an empty string, which `validateWebhook` treats as invalid.
 *
 * Header keys on `StreetContext` are already lower-cased by the framework.
 */
const SIGNATURE_HEADERS: readonly string[] = [
  "x-marzpay-signature",
  "marzpay-signature",
  "x-webhook-signature",
  "x-signature",
  "signature",
];

/**
 * Recover the raw request body as a string for signature validation and
 * reference parsing.
 *
 * StreetJS consumes the request stream and parses a JSON body into `ctx.body`
 * (or `null` when the JSON is malformed); it does not retain the original raw
 * bytes. We therefore reconstruct a best-effort raw body:
 *
 * - a raw body explicitly stashed on `ctx.state.rawBody` (e.g. by middleware)
 *   wins, since it is the true original payload;
 * - a string `ctx.body` (text/* content type) is already raw;
 * - any other non-null `ctx.body` is re-serialised with `JSON.stringify`;
 * - an absent/null body yields the empty string.
 */
function readRawBody(ctx: StreetContext): string {
  const stashed = (ctx.state as Record<string, unknown>)["rawBody"];
  if (typeof stashed === "string") {
    return stashed;
  }
  const body: unknown = ctx.body;
  if (typeof body === "string") {
    return body;
  }
  if (body === null || body === undefined) {
    return "";
  }
  try {
    return JSON.stringify(body);
  } catch {
    return "";
  }
}

/** Extract the webhook signature from the first matching request header. */
function readSignature(ctx: StreetContext): string {
  for (const name of SIGNATURE_HEADERS) {
    const value = ctx.headers[name];
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return "";
}

@Controller("/webhooks/marzpay")
export class WebhookController {
  @Post("")
  async handle(ctx: StreetContext): Promise<void> {
    const marzpay = ctx.state["marzpay"] as MarzPayClient | undefined;
    if (!marzpay) {
      // The plugin must be installed for the webhook to be processed at all.
      ctx.json({ error: "MarzPay client is not available" }, 500);
      return;
    }

    // (1) Best-effort signature validation FIRST — before reading event content
    // or touching any Payment_Record (Req 5.1).
    const rawBody = readRawBody(ctx);
    const signature = readSignature(ctx);
    if (!marzpay.validateWebhook(rawBody, signature)) {
      // Invalid signature → reject, change nothing (Req 5.2).
      ctx.json({ error: "invalid webhook signature" }, 401);
      return;
    }

    // (2) Parse the validated body for a payment reference (Req 5.3).
    const parsed = parseWebhookReference(rawBody);
    if (!parsed.ok) {
      ctx.json({ error: "webhook payload missing a valid reference" }, 400);
      return;
    }
    const reference = parsed.reference;

    // (3) Authoritatively confirm completion via getStatus (Req 5.4).
    const status = await marzpay.collections.getStatus(reference);
    if (!isCompletedStatus(status.status)) {
      // Not completed → acknowledge but leave the record's status unchanged
      // (Req 5.5).
      ctx.json({ received: true, reference, status: status.status }, 200);
      return;
    }

    // (4) Completed → read the confirmed amount/currency/status from
    // transactions.get and record completion (Req 5.6, 6.2). Guard against a
    // zero/empty amount from the sandbox's transactions.get by falling back to
    // the amount/currency already stored at checkout, so completion never
    // clobbers the real values.
    const txn = await marzpay.transactions.get(reference);
    const existing = await findByReference(reference);
    const fallbackAmount = existing.found ? existing.payment.amount : txn.amount;
    const fallbackCurrency = existing.found
      ? existing.payment.currency
      : txn.currency;
    const write = await markCompleted(reference, {
      amount: Number.isFinite(txn.amount) && txn.amount > 0 ? txn.amount : fallbackAmount,
      currency:
        typeof txn.currency === "string" && txn.currency.trim() !== ""
          ? txn.currency
          : fallbackCurrency,
      status: txn.status,
    });
    if (!write.ok) {
      // No partial row is persisted; surface a database-write-failed
      // indication (Req 6.4).
      ctx.json({ error: "database write failed", detail: write.error }, 500);
      return;
    }

    ctx.json({ received: true, reference, status: txn.status }, 200);
  }
}
