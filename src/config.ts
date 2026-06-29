/**
 * Pure configuration validation for the StreetJS + MarzPay demo.
 *
 * This module contains no I/O and no process side effects (no `process.exit`,
 * no environment reads). It operates on a plain key/value record so it can be
 * exhaustively unit- and property-tested without spawning a server.
 *
 * Validation rules (Requirements 1.4–1.9):
 * - Required keys: MARZPAY_API_KEY, MARZPAY_SECRET_KEY, APP_URL, PORT.
 *   A key is "offending" if it is absent or set to an empty string.
 * - PORT must parse to an integer in the inclusive range [1, 65535].
 * - MARZPAY_ENVIRONMENT is optional: absent/empty resolves to "sandbox";
 *   when present and non-empty it must be exactly "sandbox" or "production".
 * - On failure, `errors` names EVERY offending variable (and no valid one).
 */

/** The MarzPay target environment. */
export type MarzPayEnvironment = "sandbox" | "production";

/** The fully resolved, validated application configuration. */
export interface AppConfig {
  marzpayApiKey: string;
  marzpaySecretKey: string;
  /** Resolved environment; defaults to "sandbox" when unset. */
  marzpayEnvironment: MarzPayEnvironment;
  appUrl: string;
  port: number;
}

/**
 * Result of validating an environment record. On success it carries the
 * resolved {@link AppConfig}; on failure it carries one human-readable entry
 * per offending variable.
 */
export type ConfigResult =
  | { ok: true; config: AppConfig }
  | { ok: false; errors: string[] };

/** Required environment variable names. */
const REQUIRED_KEYS = [
  "MARZPAY_API_KEY",
  "MARZPAY_SECRET_KEY",
  "APP_URL",
  "PORT",
] as const;

/** Returns true when a value is absent or an empty string. */
function isMissing(value: string | undefined): boolean {
  return value === undefined || value === "";
}

/**
 * Parse a port string into an integer in [1, 65535].
 * Returns the integer when valid, otherwise `null`. Rejects non-numeric,
 * fractional, zero, negative, and out-of-range values.
 */
function parsePort(value: string): number | null {
  // Reject anything that is not a run of digits (no signs, decimals, or
  // whitespace), which keeps fractional and non-numeric strings out.
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }
  const port = Number(value.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return port;
}

/**
 * Validate an environment record and resolve it into an {@link AppConfig}.
 *
 * Pure: performs no I/O and never terminates the process.
 *
 * @param env A plain key/value record (e.g. `process.env`).
 * @returns `{ ok: true, config }` when every variable is valid, otherwise
 *   `{ ok: false, errors }` naming every offending variable.
 */
export function validateConfig(
  env: Record<string, string | undefined>,
): ConfigResult {
  const errors: string[] = [];

  // Required, non-empty string variables.
  for (const key of REQUIRED_KEYS) {
    if (key === "PORT") {
      continue; // PORT is reported by the dedicated check below.
    }
    if (isMissing(env[key])) {
      errors.push(`${key} is required but missing or empty`);
    }
  }

  // PORT: must be present, non-empty, and an integer in [1, 65535].
  const rawPort = env.PORT;
  let port: number | null = null;
  if (isMissing(rawPort)) {
    errors.push("PORT is required but missing or empty");
  } else {
    port = parsePort(rawPort as string);
    if (port === null) {
      errors.push("PORT is invalid: must be an integer between 1 and 65535");
    }
  }

  // MARZPAY_ENVIRONMENT: optional; resolve default or validate the enum.
  const rawEnv = env.MARZPAY_ENVIRONMENT;
  let marzpayEnvironment: MarzPayEnvironment = "sandbox";
  if (!isMissing(rawEnv)) {
    if (rawEnv === "sandbox" || rawEnv === "production") {
      marzpayEnvironment = rawEnv;
    } else {
      errors.push(
        "MARZPAY_ENVIRONMENT is invalid: must be 'sandbox' or 'production'",
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    config: {
      marzpayApiKey: env.MARZPAY_API_KEY as string,
      marzpaySecretKey: env.MARZPAY_SECRET_KEY as string,
      marzpayEnvironment,
      appUrl: env.APP_URL as string,
      port: port as number,
    },
  };
}
