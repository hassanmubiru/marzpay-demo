// Pure, framework-independent helpers for the StreetJS + MarzPay demo.
//
// This module holds ONLY deterministic logic: reference generation,
// phone-validation delegation, status-completion interpretation, and webhook
// payload parsing. It performs no network calls and depends on no framework —
// the network is the plugin client's responsibility. Keeping this logic pure
// makes it fast and exhaustively testable (unit + property-based).

import { randomUUID } from "node:crypto";
import type { MarzPayClient } from "./marzpay-types.js";

/**
 * Generate a collision-resistant Reference for a new payment.
 *
 * Uses `crypto.randomUUID()`, which yields RFC 4122 v4 UUIDs — distinct across
 * all created payments without coordination and well within the plugin's
 * 256-character reference guard (Req 4.3).
 */
export function generateReference(): string {
  return randomUUID();
}

/**
 * Decide whether a submitted phone value should be accepted, delegating the
 * actual format check to the offline plugin helper.
 *
 * An absent or empty (after trimming) value is treated as invalid without
 * consulting the client; any other value is delegated to
 * `client.isValidPhoneNumber` (Req 4.2).
 */
export function isValidPhone(
  client: Pick<MarzPayClient["utils"], "isValidPhoneNumber">,
  phone: string | undefined,
): boolean {
  if (phone === undefined || phone === null) {
    return false;
  }
  if (phone.trim() === "") {
    return false;
  }
  return client.isValidPhoneNumber(phone);
}

/**
 * The set of status values that count as a completed/successful payment.
 *
 * The MarzPay webhook event name is undocumented, so completion is derived from
 * the returned status value. This is the single source of truth consulted by
 * both the webhook completion gate and the success-page rendering so that
 * persistence and display always agree (Req 5.5, 5.6, 7.2).
 */
const COMPLETED_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "successful",
  "success",
]);

/**
 * Interpret a MarzPay status value as "completed/successful" or not.
 *
 * Comparison is case-insensitive and whitespace-insensitive so that minor
 * formatting differences in the status string do not change the verdict.
 */
export function isCompletedStatus(status: string): boolean {
  if (typeof status !== "string") {
    return false;
  }
  return COMPLETED_STATUSES.has(status.trim().toLowerCase());
}

/** Result of parsing a webhook body for its payment reference. */
export type WebhookParse =
  | { ok: true; reference: string }
  | { ok: false; reason: "unparseable" | "missing_reference" };

/**
 * Parse a (best-effort validated) webhook body to extract the payment
 * reference.
 *
 * - A body that is not valid JSON, or whose JSON root is not an object, yields
 *   `{ ok: false, reason: "unparseable" }`.
 * - A JSON object that carries no usable reference yields
 *   `{ ok: false, reason: "missing_reference" }`.
 * - Otherwise the extracted reference is returned. The reference is read from
 *   the top-level `reference` field, falling back to a nested `data.reference`,
 *   which is where MarzPay payloads commonly place it.
 *
 * No network, no framework — pure parsing only (Req 5.3).
 */
export function parseWebhookReference(rawBody: string): WebhookParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "unparseable" };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "unparseable" };
  }

  const root = parsed as Record<string, unknown>;
  const candidates: unknown[] = [root["reference"]];

  const data = root["data"];
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    candidates.push((data as Record<string, unknown>)["reference"]);
  }

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return { ok: true, reference: candidate };
    }
  }

  return { ok: false, reason: "missing_reference" };
}

/* -------------------------------------------------------------------------- */
/* Amount selection (500 – 1,000,000 UGX)                                     */
/* -------------------------------------------------------------------------- */

/** Inclusive bounds for a user-selected payment amount (UGX). */
export const MIN_AMOUNT = 500;
export const MAX_AMOUNT = 1_000_000;

/** Result of validating a user-supplied amount. */
export type AmountParse =
  | { ok: true; amount: number }
  | { ok: false; error: string };

/**
 * Validate a user-selected amount. Accepts a number or a numeric string
 * (commas/spaces tolerated, e.g. "5,000"). The amount must be a whole number of
 * UGX within [MIN_AMOUNT, MAX_AMOUNT]; anything else is rejected with a clear
 * message. Pure and deterministic.
 */
export function parseAmount(input: unknown): AmountParse {
  let n: number;
  if (typeof input === "number") {
    n = input;
  } else if (typeof input === "string") {
    const cleaned = input.replace(/[,\s]/g, "");
    if (cleaned === "" || !/^\d+$/.test(cleaned)) {
      return { ok: false, error: "amount must be a whole number" };
    }
    n = Number(cleaned);
  } else {
    return { ok: false, error: "amount is required" };
  }

  if (!Number.isInteger(n)) {
    return { ok: false, error: "amount must be a whole number" };
  }
  if (n < MIN_AMOUNT || n > MAX_AMOUNT) {
    return {
      ok: false,
      error: `amount must be between ${MIN_AMOUNT} and ${MAX_AMOUNT} UGX`,
    };
  }
  return { ok: true, amount: n };
}

/* -------------------------------------------------------------------------- */
/* Phone normalization (local + international)                                */
/* -------------------------------------------------------------------------- */

/** Default country dialing code used to expand local numbers (Uganda). */
const DEFAULT_DIAL_CODE = "256";

/**
 * Normalize a submitted phone number to E.164 (`+<digits>`), accepting both
 * local and international formats:
 *
 *   - `+256700000000` / `256700000000`  → kept as `+256700000000`
 *   - `0700000000` (local)              → expanded to `+256700000000`
 *   - `+44 7700 900900` (international)  → spaces/dashes stripped → `+447700900900`
 *
 * Returns the normalized E.164 string, or `null` when the value cannot be a
 * valid phone number (empty, too short/long, or non-numeric). Pure; no network.
 */
export function normalizePhone(
  raw: string | undefined,
  defaultDialCode: string = DEFAULT_DIAL_CODE,
): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  // Strip everything except digits and a single leading '+'.
  const hadPlus = raw.trim().startsWith("+");
  let digits = raw.replace(/[^\d]/g, "");
  if (digits === "") {
    return null;
  }

  let e164: string;
  if (hadPlus) {
    // Already international.
    e164 = `+${digits}`;
  } else if (digits.startsWith("00")) {
    // International access prefix (e.g. 00256...) → '+'.
    e164 = `+${digits.slice(2)}`;
  } else if (digits.startsWith("0")) {
    // Local format → expand with the default country dial code.
    e164 = `+${defaultDialCode}${digits.slice(1)}`;
  } else if (digits.startsWith(defaultDialCode)) {
    // Bare country code without '+'.
    e164 = `+${digits}`;
  } else {
    // Fall back to treating it as a local subscriber number.
    e164 = `+${defaultDialCode}${digits}`;
  }

  // E.164 allows up to 15 digits; require a sensible minimum.
  const e164Digits = e164.slice(1);
  if (e164Digits.length < 8 || e164Digits.length > 15) {
    return null;
  }
  return e164;
}

/**
 * Accept a phone number if it is valid for either a local or international
 * format. First tries the plugin's offline validator on the normalized number;
 * if the plugin rejects it (e.g. it only knows local UG numbers) but the value
 * is a well-formed E.164 international number, it is still accepted.
 *
 * Returns the normalized E.164 number to send to `collectMoney`, or `null` if
 * the value is not acceptable.
 */
export function acceptablePhone(
  client: Pick<MarzPayClient["utils"], "isValidPhoneNumber">,
  raw: string | undefined,
): string | null {
  const normalized = normalizePhone(raw);
  if (normalized === null) {
    return null;
  }
  // Plugin validator first (covers local UG numbers it recognises).
  try {
    if (client.isValidPhoneNumber(normalized)) {
      return normalized;
    }
  } catch {
    /* validator threw — fall back to the E.164 check below */
  }
  // International fallback: a well-formed E.164 number is acceptable.
  if (/^\+[1-9]\d{7,14}$/.test(normalized)) {
    return normalized;
  }
  return null;
}
