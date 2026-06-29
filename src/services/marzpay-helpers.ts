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
