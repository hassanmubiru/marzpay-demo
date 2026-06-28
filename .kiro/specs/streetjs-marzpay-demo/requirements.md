# Requirements Document

## Introduction

This feature delivers a small, end-to-end demonstration application that proves the StreetJS web framework integrates correctly with the official `@streetjs/plugin-marzpay` plugin against the real MarzPay sandbox. The demo intentionally implements exactly one business flow: a customer enters a mobile-money phone number and clicks "Pay", is routed through a StreetJS controller that creates a real MarzPay **mobile-money collection** in Uganda (UGX), approves the payment prompt on their phone, after which the application confirms completion (via an inbound MarzPay webhook plus an authoritative status check), persists the payment to SQLite, and surfaces it on a success page.

No fake APIs or mocked payment responses are permitted; the application MUST exercise the genuine MarzPay sandbox through the installed plugin.

This document is written against the **real, published APIs**:

- **`streetjs` (v1.0.x)** — a decorator-based, ESM-only TypeScript backend framework (Node >= 20, TypeScript >= 5, `NodeNext` resolution, decorators + `reflect-metadata`). Applications are bootstrapped with `streetApp({ port, host })`, then `app.registerController(SomeController)`, then `await app.listen()`. Controllers are decorated with `@Controller` / `@Get` / `@Post` / `@Injectable`, dependency injection is provided through the `container`, request handlers receive a typed `StreetContext` (`ctx`) exposing `ctx.json(...)` and plugin state at `ctx.state.<stateKey>`, and exceptions such as `NotFoundException` / `BadRequestException` are formatted by the framework. StreetJS ships **built-in SQLite** used for persistence (no external database dependency). The default port is 3000.
- **`@streetjs/plugin-marzpay` (v1.1.x)** — installed via `MarzPayPlugin({ apiKey, secretKey, environment, stateKey, timeoutMs })` (default `environment` is `sandbox`, default `timeoutMs` is 30000, credentials are sent as HTTP Basic auth over HTTPS). The plugin injects a MarzPay client into application state at `ctx.state.marzpay` (default `stateKey` `marzpay`) exposing capability namespaces including `collections.collectMoney`, `collections.getStatus`, `transactions.get`, `validateWebhook`, and offline `utils` phone helpers.

The complete target flow (mobile money):
Customer enters a phone number and clicks "Pay" → StreetJS controller → `marzpay.collections.collectMoney({ amount: 5000, country: 'UG', reference, phone_number })` → customer approves the prompt on their phone → Demo_App records a pending payment keyed by Reference → MarzPay webhook → Demo_App validates the webhook (best-effort) and authoritatively confirms completion via `collections.getStatus(reference)` / `transactions.get(reference)` → completed payment stored (built-in SQLite) → Success page displays the payment.

> **Verified-capability note.** The MarzPay webhook **signature scheme** is recorded by the plugin author as an undocumented limitation. Accordingly, signature validation via `validateWebhook(rawBody, signature)` is treated as a best-effort gate, and payment completion is authoritatively confirmed by calling `collections.getStatus(reference)` (and reading amount/currency via `transactions.get(reference)`) before a payment is marked completed. The webhook event type/name is also undocumented, so completion is determined from the returned **status value** indicating a completed/successful payment rather than from any assumed event name. The plugin operations `disbursements.sendMoney`, `accounts.getBalance`, `phoneVerification.*`, and `refund` are unsupported (they throw `UnsupportedOperationError` and issue no network request); no feature in this demo depends on them.

## Glossary

- **Demo_App**: The complete StreetJS + MarzPay demonstration application defined by this document.
- **StreetJS**: The `streetjs` framework used to define controllers (`@Controller` / `@Get` / `@Post`), bootstrap the server (`streetApp`, `registerController`, `listen`), host the MarzPay plugin, and provide built-in SQLite.
- **MarzPay_Plugin**: The installed `@streetjs/plugin-marzpay` integration, configured via `MarzPayPlugin({ apiKey, secretKey, environment, stateKey, timeoutMs })`, exposing the MarzPay client on `ctx.state.marzpay`.
- **MarzPay_Client**: The client object injected at `ctx.state.marzpay` (default `stateKey` `marzpay`).
- **MarzPay_Sandbox**: The real MarzPay sandbox environment reached over HTTPS when `environment` is `sandbox`.
- **Home_Page**: The controller route that displays the demo title, a phone-number input, and the payment button.
- **Checkout_Handler**: The controller route that initiates a mobile-money collection and records a pending payment.
- **Webhook_Handler**: The controller route that receives MarzPay webhook events.
- **Success_Page**: The controller route that displays a stored payment's details to the customer.
- **Payment_Store**: The built-in-SQLite-backed data access layer for the `payments` table.
- **Phone_Number**: The customer's mobile-money MSISDN, supplied on the Home_Page and passed to `collectMoney` as `phone_number`.
- **collectMoney**: The verified MarzPay_Client method `collections.collectMoney({ amount, country, reference, phone_number })` that initiates a mobile-money collection and returns `{ reference, status, redirectUrl? }`; for mobile money no `redirectUrl` is returned (`redirectUrl` is returned only for the card method).
- **getStatus**: The verified MarzPay_Client method `collections.getStatus(reference)` returning `{ reference, status }`, used as the authoritative confirmation of payment completion.
- **getTransaction**: The verified MarzPay_Client method `transactions.get(reference)` returning `{ id, reference, amount, currency, status }`, used to read the confirmed amount, currency, and status.
- **validateWebhook**: The MarzPay_Client method `validateWebhook(rawBody, signature)` that performs best-effort verification of an inbound webhook using the configured credentials; the underlying signature scheme is a documented plugin limitation.
- **isValidPhoneNumber**: The offline MarzPay_Client helper `utils.isValidPhoneNumber(value)` used to validate a Phone_Number without a network call.
- **Reference**: The unique identifier the Demo_App assigns to a payment, used to correlate checkout, the pending record, the webhook, the status confirmation, and the success page.
- **Payment_Record**: A stored row in the `payments` table containing id, reference, amount, currency, status, and created_at; `status` is `pending` before confirmation and a completed/successful value after confirmation.
- **MARZPAY_ENVIRONMENT**: The environment variable selecting the MarzPay target; permitted values are `sandbox` and `production`, defaulting to `sandbox`.

## Requirements

### Requirement 1: Project Initialization and Configuration

**User Story:** As a developer, I want the demo project initialized with StreetJS and the MarzPay plugin, so that I can run the application locally with my sandbox credentials.

#### Acceptance Criteria

1. THE Demo_App SHALL provide a `package.json` that declares `streetjs` and `@streetjs/plugin-marzpay` as dependencies, declares `reflect-metadata`, sets `"type": "module"`, and declares a Node.js engine of 20 or greater.
2. THE Demo_App SHALL provide a `tsconfig.json` that enables `experimentalDecorators`, `emitDecoratorMetadata`, and `NodeNext` module resolution as required by StreetJS.
3. THE Demo_App SHALL provide a `.env.example` file listing the variables `MARZPAY_API_KEY`, `MARZPAY_SECRET_KEY`, `MARZPAY_ENVIRONMENT`, `APP_URL`, and `PORT`.
4. WHEN the Demo_App starts, THE Demo_App SHALL read `MARZPAY_API_KEY`, `MARZPAY_SECRET_KEY`, `MARZPAY_ENVIRONMENT`, `APP_URL`, and `PORT` from the environment before binding to any network port.
5. IF one or more of `MARZPAY_API_KEY`, `MARZPAY_SECRET_KEY`, `APP_URL`, or `PORT` is absent or set to an empty string at startup, THEN THE Demo_App SHALL terminate startup before binding to any port and SHALL emit an error indication that names every missing or empty variable.
6. IF the value of `PORT` is not an integer between 1 and 65535 inclusive, THEN THE Demo_App SHALL terminate startup before binding to any port and SHALL emit an error indication identifying `PORT` as invalid.
7. IF `MARZPAY_ENVIRONMENT` is present and non-empty and its value is neither `sandbox` nor `production`, THEN THE Demo_App SHALL terminate startup before binding to any port and SHALL emit an error indication identifying `MARZPAY_ENVIRONMENT` as invalid.
8. WHERE `MARZPAY_ENVIRONMENT` is absent or set to an empty string, THE Demo_App SHALL use `sandbox` as the MarzPay environment.
9. WHEN the Demo_App starts with all required environment variables present, non-empty, and valid, THE Demo_App SHALL listen for HTTP requests on the port specified by `PORT`.
10. WHERE the `npm run dev` script is invoked, THE Demo_App SHALL build and start the StreetJS server.

### Requirement 2: StreetJS Controllers and MarzPay Plugin Installation

**User Story:** As a developer, I want StreetJS to host the application controllers with the MarzPay plugin installed, so that the demo proves framework routing and plugin integration.

#### Acceptance Criteria

1. WHEN the Demo_App starts, THE Demo_App SHALL register StreetJS controllers for the home path, the checkout action, the success path, and the webhook path.
2. WHEN the Demo_App starts, THE Demo_App SHALL install the MarzPay_Plugin via `MarzPayPlugin` using the `MARZPAY_API_KEY` value as `apiKey` and the `MARZPAY_SECRET_KEY` value as `secretKey`.
3. WHEN the MarzPay_Plugin is installed, THE Demo_App SHALL set its `environment` option to the resolved MarzPay environment, which is `sandbox` unless `MARZPAY_ENVIRONMENT` selects `production`.
4. WHEN the MarzPay_Plugin is installed, THE Demo_App SHALL expose the MarzPay_Client on `ctx.state` at the configured `stateKey`.
5. IF the MarzPay_Plugin installation fails at startup, THEN THE Demo_App SHALL terminate startup and emit a message indicating that MarzPay_Plugin installation failed.
6. WHEN a request is received for a path that matches none of the registered controller routes, THE Demo_App SHALL respond with HTTP status 404.

### Requirement 3: Home Page

**User Story:** As a customer, I want a home page with a phone-number field and a clear payment button, so that I can start the mobile-money payment flow.

#### Acceptance Criteria

1. WHEN a customer requests the home path, THE Home_Page SHALL respond with HTTP status 200 within 2 seconds and render a page containing the exact text "StreetJS + MarzPay Demo".
2. WHEN the home path is requested successfully, THE Home_Page SHALL display exactly one input control for the customer's mobile-money Phone_Number.
3. WHEN the home path is requested successfully, THE Home_Page SHALL display exactly one enabled payment button bearing the exact label "Pay 5000 UGX".
4. WHEN the customer activates the payment button, THE Home_Page SHALL submit the entered Phone_Number to the Checkout_Handler at the registered checkout action path.
5. IF the Home_Page cannot be rendered, THEN THE Home_Page SHALL respond with HTTP status 500 and display a message indicating that the page could not be loaded.

### Requirement 4: Mobile-Money Payment Initiation

**User Story:** As a customer, I want clicking the payment button to start a real mobile-money collection on my phone, so that I can approve and complete my purchase.

#### Acceptance Criteria

1. WHEN the Checkout_Handler receives a payment request, THE Checkout_Handler SHALL read the submitted Phone_Number from the request.
2. IF the submitted Phone_Number is absent, empty, or reported as invalid by `marzpay.utils.isValidPhoneNumber`, THEN THE Checkout_Handler SHALL respond with HTTP status 400, SHALL display a message indicating that a valid phone number is required, and SHALL NOT call `collectMoney`.
3. WHEN the Checkout_Handler processes a valid payment request, THE Checkout_Handler SHALL assign the payment a Reference that is distinct from the Reference of every other created payment, such that the Reference can later be used to request the Success_Page.
4. WHEN the Checkout_Handler initiates a payment, THE Checkout_Handler SHALL call `marzpay.collections.collectMoney` against the MarzPay_Sandbox with an `amount` of 5000, a `country` of `UG`, the submitted Phone_Number as `phone_number`, and the Demo_App-assigned Reference.
5. WHEN `collectMoney` returns successfully, THE Checkout_Handler SHALL persist a Payment_Record keyed by the Reference with an amount of 5000, a currency of `UGX`, and a status of `pending`, and SHALL direct the customer to the Success_Page for that Reference.
6. IF `collectMoney` returns an error, THEN THE Checkout_Handler SHALL respond with HTTP status 502, SHALL display a message indicating that payment initiation failed, and SHALL NOT persist a Payment_Record.
7. IF `collectMoney` does not return within the plugin's configured `timeoutMs`, THEN THE Checkout_Handler SHALL respond with HTTP status 502 and SHALL display a message indicating that payment initiation failed.

### Requirement 5: Webhook Validation and Authoritative Status Confirmation

**User Story:** As a developer, I want incoming MarzPay webhooks validated and then authoritatively confirmed, so that only authentic, completed payments are recorded.

#### Acceptance Criteria

1. WHEN the Webhook_Handler receives a request, THE Webhook_Handler SHALL call `marzpay.validateWebhook` with the raw request body and the request signature before reading the event content or updating any Payment_Record.
2. IF `validateWebhook` reports the request as invalid, THEN THE Webhook_Handler SHALL respond with HTTP status 401, SHALL NOT update any Payment_Record, and SHALL leave every existing Payment_Record unchanged.
3. IF a request is validated but its payload cannot be parsed or omits a payment Reference, THEN THE Webhook_Handler SHALL respond with HTTP status 400, SHALL NOT update any Payment_Record, and SHALL leave every existing Payment_Record unchanged.
4. WHEN a validated webhook carries a payment Reference, THE Webhook_Handler SHALL authoritatively confirm the payment by calling `marzpay.collections.getStatus` with that Reference before recording completion, because the webhook signature scheme is a documented plugin limitation.
5. WHEN `getStatus` reports a status value that does not indicate a completed or successful payment, THE Webhook_Handler SHALL respond with HTTP status 200 and SHALL leave the Payment_Record's status unchanged.
6. WHEN `getStatus` reports a status value that indicates a completed or successful payment, THE Webhook_Handler SHALL record the payment as completed in the Payment_Store and SHALL respond with HTTP status 200.

### Requirement 6: Payment Persistence

**User Story:** As a developer, I want payments stored in the built-in SQLite database, so that the demo proves a durable database write keyed by reference.

#### Acceptance Criteria

1. THE Payment_Store SHALL use the StreetJS built-in SQLite database and SHALL provide a `payments` table containing the columns id, reference, amount, currency, status, and created_at, where the reference column is constrained to be non-null and unique across all Payment_Records.
2. WHEN a webhook is validated and `getStatus` confirms a completed payment, THE Payment_Store SHALL store exactly one Payment_Record whose reference equals the confirmed Reference, whose amount and currency equal the values read from `marzpay.transactions.get` for that Reference, whose status equals the confirmed completed status, and whose created_at is recorded as an ISO 8601 UTC value.
3. IF a Payment_Record with the same Reference already exists when a payment is processed, THEN THE Payment_Store SHALL retain exactly one Payment_Record for that Reference and SHALL NOT create a duplicate Payment_Record.
4. IF storing a Payment_Record fails, THEN THE Payment_Store SHALL NOT store a partial Payment_Record and SHALL return an error to the calling handler indicating that the database write failed.
5. WHEN a Payment_Record is requested by Reference and a matching Payment_Record exists, THE Payment_Store SHALL return the single stored Payment_Record whose reference equals the requested Reference.
6. IF a Payment_Record is requested by a Reference that matches no stored Payment_Record, THEN THE Payment_Store SHALL return a result indicating that no matching Payment_Record was found.

### Requirement 7: Success Page

**User Story:** As a customer, I want a success page showing my payment, so that I can see whether the transaction completed.

#### Acceptance Criteria

1. WHEN a customer requests the success path with a Reference that matches a stored Payment_Record, THE Success_Page SHALL respond with HTTP status 200 and display the matched Payment_Record's stored Reference, its amount and currency formatted as the amount followed by a single space and the currency code, and its stored status.
2. WHILE the matched Payment_Record's stored status indicates a completed or successful payment, THE Success_Page SHALL display the text "Payment Successful".
3. WHILE the matched Payment_Record's stored status is `pending`, THE Success_Page SHALL display a message indicating that the payment is awaiting approval and SHALL NOT display the text "Payment Successful".
4. IF the success path is requested with a Reference that matches no stored Payment_Record, THEN THE Success_Page SHALL respond with HTTP status 404, SHALL display a message indicating the payment was not found, and SHALL NOT display the text "Payment Successful".
5. IF the success path is requested with no Reference supplied, THEN THE Success_Page SHALL respond with HTTP status 400, SHALL display a message indicating that a Reference is required, and SHALL NOT display the text "Payment Successful".

### Requirement 8: Documentation

**User Story:** As a new developer, I want a README that gets the demo running in under five minutes, so that I can evaluate the integration quickly.

#### Acceptance Criteria

1. THE Demo_App SHALL provide a `README.md` that documents the setup steps as an ordered, numbered sequence in this exact order: clone the repository, change into the project directory, install dependencies with `npm install streetjs @streetjs/plugin-marzpay` (noting the `street add marzpay` alternative for adding the plugin), copy `.env.example` to `.env`, add sandbox keys to `.env`, and run `npm run dev`, with the literal command shown for each step that requires one.
2. THE README.md SHALL document each environment variable (`MARZPAY_API_KEY`, `MARZPAY_SECRET_KEY`, `MARZPAY_ENVIRONMENT`, `APP_URL`, and `PORT`) with, for each variable, its name, a one-line description of its purpose, and whether it is mandatory at startup, including that `MARZPAY_ENVIRONMENT` is optional and defaults to `sandbox`.
3. THE README.md SHALL describe the end-to-end payment flow as an ordered sequence of these stages: customer enters a phone number and clicks "Pay" on the Home_Page, the Checkout_Handler initiates a mobile-money collection against the MarzPay_Sandbox, the customer approves the prompt on their phone, MarzPay sends a webhook to the Webhook_Handler, the Webhook_Handler validates the webhook and authoritatively confirms completion via `getStatus`, the confirmed payment is persisted to the Payment_Store, and the Success_Page displays the payment.
4. THE README.md SHALL document how to obtain the MarzPay sandbox credentials referenced by `MARZPAY_API_KEY` and `MARZPAY_SECRET_KEY`, including the source from which a developer retrieves them.
5. THE README.md SHALL state the URL at which the running Demo_App is reachable after `npm run dev`, expressed in terms of the `APP_URL` and `PORT` environment variables.
6. THE README.md SHALL note that the MarzPay webhook signature scheme is a documented plugin limitation and that payment completion is authoritatively confirmed via `collections.getStatus` and `transactions.get`.
