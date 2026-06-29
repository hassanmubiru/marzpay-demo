# Implementation Plan: StreetJS + MarzPay Demo

## Overview

This plan implements the StreetJS + MarzPay mobile-money demo in TypeScript (Node.js >= 20, ESM, decorators) following the layered design: bootstrap (config validation, plugin install, controller registration, SQLite schema init), pure helpers that wrap the plugin client boundary, a built-in-SQLite `Payment_Store`, four decorator controllers, and HTML views. Work proceeds bottom-up so each layer is testable before it is wired together: project scaffolding first, then the pure/deterministic units (config validation, `Payment_Store`, `marzpay-helpers`), then HTML views, then the four controllers, then the `server.ts` bootstrap that ties everything together, and finally the full test suites (property-based, example/unit, real-sandbox integration, smoke/config) and the README.

The integration boundary is the MarzPay client injected by the plugin at `ctx.state.marzpay`; controllers call it directly. Property-based tests use `fast-check` with `vitest`, run a minimum of 100 generated cases each (`numRuns: 100`), and carry the tag comment `// Feature: streetjs-marzpay-demo, Property N: ...`. For property tests, only the marzpay client boundary (`collectMoney`, `getStatus`, `transactions.get`, `validateWebhook`, `utils.isValidPhoneNumber`) is stubbed and persistence uses an in-memory/temporary SQLite database. Test sub-tasks are placed close to the code they validate and marked optional with `*`.

## Tasks

- [ ] 1. Initialize project scaffolding and dependencies
  - [x] 1.1 Create `package.json`, `tsconfig.json`, and source layout
    - Initialize `package.json` declaring `streetjs` and `@streetjs/plugin-marzpay` as dependencies, plus `reflect-metadata` and `dotenv`; set `"type": "module"`; declare a Node.js engine of `">=20"`
    - Add dev dependencies: `typescript`, `vitest`, `fast-check`, `@types/node`
    - Add `tsconfig.json` with `experimentalDecorators: true`, `emitDecoratorMetadata: true`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `target: "ES2022"`, `strict: true`, and the `src/` rootDir layout
    - Add `scripts.dev` that builds and starts the StreetJS server (e.g. `tsc && node dist/server.js`), and `scripts.test` running `vitest --run`
    - Create the source directory structure: `src/`, `src/controllers/`, `src/services/`, `src/db/`, `src/views/`, `src/public/`, `test/`
    - _Requirements: 1.1, 1.2, 1.10_

  - [ ] 1.2 Create `.env.example` with the five variables
    - List `MARZPAY_API_KEY`, `MARZPAY_SECRET_KEY`, `MARZPAY_ENVIRONMENT`, `APP_URL`, and `PORT` with placeholder values and brief inline comments (noting `MARZPAY_ENVIRONMENT` is optional and defaults to `sandbox`)
    - _Requirements: 1.3_

- [ ] 2. Implement pure configuration validation (`src/config.ts`)
  - [ ] 2.1 Implement `validateConfig`
    - Define `MarzPayEnvironment`, `AppConfig`, and `ConfigResult` types per the design
    - Implement a pure `validateConfig(env)` (no `process.exit`, no I/O) that: treats `MARZPAY_API_KEY`, `MARZPAY_SECRET_KEY`, `APP_URL`, `PORT` as required (absent or empty string ⇒ offending); parses `PORT` to an integer in `[1, 65535]`; resolves `MARZPAY_ENVIRONMENT` (absent/empty ⇒ `sandbox`; `sandbox`/`production` accepted; any other non-empty value ⇒ offending); and returns `ok: false` with an `errors` array naming **every** offending variable (and none that are valid), else `ok: true` with the resolved `AppConfig`
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

  - [ ] 2.2 Write property test for required-variable completeness
    - **Property 1: Configuration requires all mandatory variables**
    - **Validates: Requirements 1.4, 1.5**
    - Generators: env records that drop/blank random subsets of the four required keys; assert `ok: false` and that `errors` names exactly the offending variables and no valid ones
    - Tag: `// Feature: streetjs-marzpay-demo, Property 1: ...`, minimum 100 runs

  - [ ] 2.3 Write property test for PORT range validation
    - **Property 2: PORT must be an integer in [1, 65535]**
    - **Validates: Requirements 1.6, 1.9**
    - Generators: non-numeric, fractional, zero, negative, and out-of-range `PORT` strings (expect error naming `PORT`), and otherwise-valid envs with integer ports in `[1, 65535]` (expect `config.port` to equal that integer)
    - Tag: `// Feature: streetjs-marzpay-demo, Property 2: ...`, minimum 100 runs

  - [ ] 2.4 Write property test for MARZPAY_ENVIRONMENT enum and default
    - **Property 3: MARZPAY_ENVIRONMENT enum and default resolution**
    - **Validates: Requirements 1.7, 1.8**
    - Generators: absent/empty (⇒ resolves to `sandbox`), exactly `sandbox`/`production` (⇒ resolves to the input), and arbitrary other non-empty strings (⇒ `ok: false` naming `MARZPAY_ENVIRONMENT`)
    - Tag: `// Feature: streetjs-marzpay-demo, Property 3: ...`, minimum 100 runs

- [ ] 3. Implement the built-in-SQLite persistence layer (`src/db/payments.ts` — `Payment_Store`)
  - [ ] 3.1 Implement schema initialization and types
    - Define `PaymentRecord`, `NewPayment`, `WriteResult`, and `LookupResult` types per the design
    - Implement `initSchema()` against the StreetJS built-in SQLite, creating the `payments` table with columns id (PK AUTOINCREMENT), reference (TEXT NOT NULL UNIQUE), amount (REAL NOT NULL), currency (TEXT NOT NULL), status (TEXT NOT NULL), created_at (TEXT NOT NULL ISO 8601 UTC)
    - Allow the database handle to be configurable (file path or in-memory/temp) so tests can use an in-memory DB
    - _Requirements: 6.1_

  - [ ] 3.2 Implement `insertPending`, `markCompleted`, and `findByReference`
    - `insertPending(payment)`: insert a pending record keyed by reference using `INSERT ... ON CONFLICT(reference) DO NOTHING` inside a transaction; idempotent (existing row left intact, no duplicate); return `{ ok: false, error }` on write failure with no partial row
    - `markCompleted(reference, { amount, currency, status })`: conditional `UPDATE` inside a transaction; idempotent by reference; leaves no partial row on failure
    - `findByReference(reference)`: return `{ found: true, payment }` or `{ found: false }`
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ] 3.3 Write property test for completed-payment field persistence
    - **Property 12: Completed payments persist the confirmed transaction fields**
    - **Validates: Requirements 6.2**
    - Generators: random confirmed transaction results (amount/currency/status); after `markCompleted`, assert exactly one record for the reference whose amount/currency/status equal the confirmed values and whose `created_at` is a valid ISO 8601 UTC timestamp
    - Tag: `// Feature: streetjs-marzpay-demo, Property 12: ...`, minimum 100 runs

  - [ ] 3.4 Write property test for idempotent persistence
    - **Property 13: Persistence is idempotent by reference**
    - **Validates: Requirements 6.3**
    - Generators: an arbitrary reference processed 1..k times (repeated `insertPending`/`markCompleted`) against an in-memory DB; assert exactly one row remains for that reference with no duplicates
    - Tag: `// Feature: streetjs-marzpay-demo, Property 13: ...`, minimum 100 runs

  - [ ] 3.5 Write property test for lookup round-trip
    - **Property 14: Lookup round-trip returns the stored record**
    - **Validates: Requirements 6.5**
    - Generators: random persisted records; assert `findByReference(reference)` returns `found: true` with a record equal to the one stored
    - Tag: `// Feature: streetjs-marzpay-demo, Property 14: ...`, minimum 100 runs

  - [ ] 3.6 Write property test for unknown-reference lookups
    - **Property 15: Lookup of an unknown reference reports not found**
    - **Validates: Requirements 6.6**
    - Generators: references guaranteed absent from the store; assert `findByReference` returns a not-found result
    - Tag: `// Feature: streetjs-marzpay-demo, Property 15: ...`, minimum 100 runs

- [ ] 4. Implement pure MarzPay helpers (`src/services/marzpay-helpers.ts`)
  - [ ] 4.1 Implement `generateReference`, `isValidPhone`, `isCompletedStatus`, `parseWebhookReference`
    - `generateReference()`: return `crypto.randomUUID()`
    - `isValidPhone(client, phone)`: treat absent/empty as invalid, otherwise delegate to `client.isValidPhoneNumber(phone)`
    - `isCompletedStatus(status)`: single source of truth interpreting a status value as completed/successful (e.g. `completed`, `successful`, `success`)
    - `parseWebhookReference(rawBody)`: return `{ ok: true, reference }` or `{ ok: false, reason: "unparseable" | "missing_reference" }`; no network, no framework
    - _Requirements: 4.3, 5.3, 5.5, 5.6, 7.2_

  - [ ] 4.2 Write property test for unique reference generation
    - **Property 5: Generated references are unique**
    - **Validates: Requirements 4.3**
    - Generators: large N `generateReference()` calls; assert all generated references are distinct
    - Tag: `// Feature: streetjs-marzpay-demo, Property 5: ...`, minimum 100 runs

  - [ ] 4.3 Write unit tests for helper parsing and status interpretation
    - Test `parseWebhookReference` for valid JSON with a reference, non-JSON bodies (`unparseable`), and JSON missing a reference (`missing_reference`); test `isCompletedStatus` for completed vs non-completed status values; test `isValidPhone` treats absent/empty as invalid and delegates otherwise
    - _Requirements: 5.3, 5.5, 7.2_

- [ ] 5. Implement HTML views
  - [ ] 5.1 Create `src/views/home.html` and `src/views/success.html`
    - `home.html`: exact title text "StreetJS + MarzPay Demo", exactly one phone-number input control, and exactly one enabled button labeled "Pay 5000 UGX" inside a form that POSTs to `/checkout`
    - `success.html`: status-driven template surfacing the stored reference, `"{amount} {currency}"`, and stored status; shows "Payment Successful" only for a completed status and an awaiting-approval message for `pending`
    - Add any minimal static assets under `src/public/`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 7.1, 7.2, 7.3_

- [ ] 6. Implement controllers
  - [ ] 6.1 Implement `HomeController` (`src/controllers/home.controller.ts`)
    - `@Controller('/')` with `@Get`; render `views/home.html`; return 200 on success and 500 with a "could not be loaded" message if rendering throws
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ] 6.2 Write unit test for home page contents
    - Assert 200 with exact title "StreetJS + MarzPay Demo", exactly one phone-number input, exactly one enabled "Pay 5000 UGX" button posting to `/checkout`, and 500 on an induced render failure
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ] 6.3 Implement `CheckoutController` (`src/controllers/checkout.controller.ts`)
    - `@Controller('/checkout')` with `@Post`; read the submitted phone number; if absent/empty or `marzpay.utils.isValidPhoneNumber` reports invalid → HTTP 400 "a valid phone number is required" and do **not** call `collectMoney`
    - Generate a unique reference via `generateReference()`; call `marzpay.collections.collectMoney({ amount: 5000, country: 'UG', reference, phone_number })` against the sandbox
    - On success → `insertPending` a record (amount 5000, currency `UGX`, status `pending`) and redirect to `/success?reference=<ref>`; on error or timeout → HTTP 502 "payment initiation failed" with no `Payment_Record` persisted
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ] 6.4 Write property test for phone gating
    - **Property 6: Invalid phone numbers are rejected without a collection**
    - **Validates: Requirements 4.1, 4.2**
    - Generators: absent/empty/invalid phone strings (stub `isValidPhoneNumber=false`, spy `collectMoney`); assert HTTP 400, a "valid phone number is required" message, and `collectMoney` never invoked
    - Tag: `// Feature: streetjs-marzpay-demo, Property 6: ...`, minimum 100 runs

  - [ ] 6.5 Write property test for valid checkout shaping and pending persistence
    - **Property 7: Valid checkout shapes the collection and persists a pending record**
    - **Validates: Requirements 4.4, 4.5**
    - Generators: valid phone strings with a successful stubbed `collectMoney`; assert `collectMoney` called with exactly `{ amount: 5000, country: 'UG', phone_number, reference }`, exactly one pending record persisted (amount 5000, currency `UGX`, status `pending`), and redirect to `/success?reference=<ref>`
    - Tag: `// Feature: streetjs-marzpay-demo, Property 7: ...`, minimum 100 runs

  - [ ] 6.6 Write property test for collection failure
    - **Property 8: Collection failure yields 502 and persists nothing**
    - **Validates: Requirements 4.6, 4.7**
    - Generators: `collectMoney` invocations that reject with error or timeout-style rejections; assert HTTP 502, a "payment initiation failed" message, and no `Payment_Record` persisted
    - Tag: `// Feature: streetjs-marzpay-demo, Property 8: ...`, minimum 100 runs

  - [ ] 6.7 Implement `WebhookController` (`src/controllers/webhook.controller.ts`)
    - `@Controller('/webhooks/marzpay')` with `@Post`; read the **raw** body and signature; call `marzpay.validateWebhook(rawBody, signature)` first, before reading content or touching any record
    - Invalid → HTTP 401, store unchanged; validated but `parseWebhookReference` is unparseable / has no reference → HTTP 400, store unchanged
    - Call authoritative `marzpay.collections.getStatus(reference)`; if `isCompletedStatus` is false → HTTP 200, status unchanged; if true → read `marzpay.transactions.get(reference)` and `markCompleted`, returning HTTP 200; on DB write failure → HTTP 500 "database write failed" with no partial row
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.2, 6.4_

  - [ ] 6.8 Write property test for invalid webhooks
    - **Property 9: Invalid webhooks are rejected and change nothing**
    - **Validates: Requirements 5.1, 5.2**
    - Generators: arbitrary raw bodies + signatures with `validateWebhook` stubbed to return false; assert HTTP 401 and every existing `Payment_Record` left unchanged (in-memory DB)
    - Tag: `// Feature: streetjs-marzpay-demo, Property 9: ...`, minimum 100 runs

  - [ ] 6.9 Write property test for validated-but-unusable webhooks
    - **Property 10: Validated but unusable webhooks return 400 and change nothing**
    - **Validates: Requirements 5.3**
    - Generators: `validateWebhook=true` with non-JSON bodies or JSON lacking a reference; assert HTTP 400 and every existing `Payment_Record` left unchanged
    - Tag: `// Feature: streetjs-marzpay-demo, Property 10: ...`, minimum 100 runs

  - [ ] 6.10 Write property test for status-driven authoritative completion
    - **Property 11: Webhook completion is status-driven and authoritative**
    - **Validates: Requirements 5.4, 5.5, 5.6**
    - Generators: validated webhooks carrying a reference with completed and non-completed `getStatus` values (stub `getStatus`/`transactions.get`, in-memory DB); assert `getStatus` is called first, that on a completed status the record is recorded completed using `transactions.get` fields with HTTP 200, and that on a non-completed status the response is HTTP 200 with the record's status unchanged
    - Tag: `// Feature: streetjs-marzpay-demo, Property 11: ...`, minimum 100 runs

  - [ ] 6.11 Write unit tests for webhook ordering and DB write-failure path
    - Assert `validateWebhook` is invoked before any parse/persist and `getStatus` is invoked before completion is recorded; assert that an induced `Payment_Store` write failure yields HTTP 500 with a database-write-failed indication and no partial row
    - _Requirements: 5.1, 5.4, 6.4_

  - [ ] 6.12 Implement `SuccessController` (`src/controllers/success.controller.ts`)
    - `@Controller('/success')` with `@Get`; no `reference` query param → HTTP 400 "a reference is required" and not "Payment Successful"
    - Look up via `findByReference`; not found → HTTP 404 "payment not found" and not "Payment Successful"; found → HTTP 200 rendering `views/success.html` with the stored reference, `"{amount} {currency}"`, and stored status, status-driven ("Payment Successful" only when `isCompletedStatus` is true, otherwise an awaiting-approval message)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ] 6.13 Write property test for success page field rendering
    - **Property 16: Success page always renders the stored record's fields**
    - **Validates: Requirements 7.1**
    - Generators: arbitrary stored records; assert HTTP 200 and that the stored reference, `"{amount} {currency}"` formatting (amount, single space, currency code), and stored status are rendered
    - Tag: `// Feature: streetjs-marzpay-demo, Property 16: ...`, minimum 100 runs

  - [ ] 6.14 Write property test for status-driven success rendering
    - **Property 17: Success page rendering is status-driven**
    - **Validates: Requirements 7.2, 7.3**
    - Generators: stored records with completed and `pending` statuses; assert "Payment Successful" appears iff `isCompletedStatus(status)` is true, and that a `pending` record shows an awaiting-approval message and not "Payment Successful"
    - Tag: `// Feature: streetjs-marzpay-demo, Property 17: ...`, minimum 100 runs

  - [ ] 6.15 Write property test for success page unknown-reference handling
    - **Property 18: Success page reports unknown references as not found**
    - **Validates: Requirements 7.4**
    - Generators: references guaranteed absent; assert HTTP 404, a "payment not found" message, and no "Payment Successful" text
    - Tag: `// Feature: streetjs-marzpay-demo, Property 18: ...`, minimum 100 runs

  - [ ] 6.16 Write unit test for success page missing-reference case
    - Assert a request with no `reference` returns HTTP 400 with "a reference is required" and does not show "Payment Successful"
    - _Requirements: 7.5_

- [ ] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Implement server bootstrap and wiring (`src/server.ts`)
  - [ ] 8.1 Wire the startup sequence: load env → validate → app → install plugin → register controllers → init schema → listen
    - Load `.env` via `dotenv`, call `validateConfig(process.env)`; on `ok: false` print every error and exit non-zero **before** any app creation, plugin install, or port bind
    - Create the app with `streetApp({ port, host })`; install `MarzPayPlugin({ apiKey: MARZPAY_API_KEY, secretKey: MARZPAY_SECRET_KEY, environment: <resolved>, stateKey: 'marzpay', timeoutMs })`; on install failure print an install-failed message and exit non-zero
    - `registerController` for `HomeController`, `CheckoutController`, `SuccessController`, `WebhookController` (relying on StreetJS default 404 for unmatched paths); call `initSchema()`; then `await app.listen()`
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 8.2 Write property test for unmatched-route 404s
    - **Property 4: Unmatched routes return 404**
    - **Validates: Requirements 2.6**
    - Generators: random method+path pairs excluded from the four registered routes (`GET /`, `POST /checkout`, `GET /success`, `POST /webhooks/marzpay`); assert HTTP 404 against the real app
    - Tag: `// Feature: streetjs-marzpay-demo, Property 4: ...`, minimum 100 runs

  - [ ] 8.3 Write unit tests for controller registration, resolved environment, and install failure
    - Assert exactly the four controllers are registered; assert the resolved MarzPay environment (`sandbox` unless `production` selected) is passed to `MarzPayPlugin`; assert an induced plugin install failure aborts startup with the install-failed message before binding a port
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 9. Real-sandbox integration tests (no mocks)
  - [ ] 9.1 Write live sandbox integration tests
    - Install the plugin with real sandbox credentials and confirm the MarzPay client is exposed at `ctx.state.marzpay`; drive the live mobile-money path `collectMoney` → `getStatus`/`transactions.get` against `MarzPay_Sandbox`; confirm the port binds only after valid configuration and a successful install (1–3 representative cases, no mocks)
    - _Requirements: 1.9, 2.2, 2.3, 2.4, 4.4, 5.6, 6.2_

- [ ] 10. Smoke and configuration tests
  - [ ] 10.1 Write smoke/config tests for project artifacts
    - Assert `package.json` declares `streetjs`, `@streetjs/plugin-marzpay`, and `reflect-metadata`, sets `"type": "module"`, declares a Node `>=20` engine, and has a `dev` script that builds and starts the server; assert `tsconfig.json` enables `experimentalDecorators`, `emitDecoratorMetadata`, and `NodeNext`; assert `.env.example` lists the five variables; assert the `payments` schema has the six columns with `reference` NOT NULL UNIQUE; assert README content is present
    - _Requirements: 1.1, 1.2, 1.3, 1.10, 6.1_

- [ ] 11. Write README documentation
  - [ ] 11.1 Create `README.md`
    - Document setup as an ordered numbered sequence with literal commands in this exact order: clone the repo, change into the directory, install with `npm install streetjs @streetjs/plugin-marzpay` (noting the `street add marzpay` alternative), copy `.env.example` to `.env`, add sandbox keys, run `npm run dev`
    - Document each environment variable (`MARZPAY_API_KEY`, `MARZPAY_SECRET_KEY`, `MARZPAY_ENVIRONMENT`, `APP_URL`, `PORT`) with name, one-line purpose, and whether mandatory at startup (noting `MARZPAY_ENVIRONMENT` is optional and defaults to `sandbox`)
    - Describe the end-to-end mobile-money flow as an ordered sequence (enter phone + "Pay" → checkout collection against the sandbox → approve prompt on phone → webhook → validate + authoritative `getStatus` confirmation → persist → success page); state the reachable URL in terms of `APP_URL` and `PORT`; document how to obtain the MarzPay sandbox credentials and their source; note the webhook-signature-scheme plugin limitation and that completion is authoritatively confirmed via `collections.getStatus` and `transactions.get`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ] 11.2 Write README content checks
    - Assert the ordered setup steps with literal commands (including `npm install streetjs @streetjs/plugin-marzpay` and the `street add marzpay` note), per-variable documentation, the ordered end-to-end flow, the credential acquisition source, the reachable URL expressed via `APP_URL` and `PORT`, and the webhook-signature-limitation note
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [ ] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirements (and property numbers where applicable) for traceability.
- Property-based tests use `fast-check` with `vitest`, run a minimum of 100 cases each (`numRuns: 100`), and carry the `// Feature: streetjs-marzpay-demo, Property N: ...` tag. Each of Properties 1–18 maps to exactly one property test.
- For property/example tests only the marzpay client boundary (`collectMoney`, `getStatus`, `transactions.get`, `validateWebhook`, `utils.isValidPhoneNumber`) is stubbed and SQLite runs in-memory/temp, so the real helpers, controllers, and `Payment_Store` are exercised deterministically without network calls.
- Integration tests exercise the genuine MarzPay sandbox (no mocks), per the spec's no-mock mandate.
- Checkpoints ensure incremental validation at reasonable breaks.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1", "4.1", "5.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.2", "4.2", "4.3"] },
    { "id": 3, "tasks": ["3.3", "3.4", "3.5", "3.6", "6.1", "6.3", "6.7", "6.12"] },
    { "id": 4, "tasks": ["6.2", "6.4", "6.5", "6.6", "6.8", "6.9", "6.10", "6.11", "6.13", "6.14", "6.15", "6.16", "8.1"] },
    { "id": 5, "tasks": ["8.2", "8.3", "9.1", "11.1"] },
    { "id": 6, "tasks": ["10.1", "11.2"] }
  ]
}
```
