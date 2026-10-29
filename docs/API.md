# REST API

Base URL: `/api`. All administrative modules require a `SUPER_ADMIN` session and completed initial password change. There is no registration endpoint. JSON errors have `{ "error": "message" }`. Validation errors return 400; unauthenticated 401; unauthorized/CSRF 403; missing record 404; duplicate/reference/invalid transition 409; unavailable integration 503.

## Session and request protection

1. `GET /auth/session` creates a CSRF token and returns `{ user, csrfToken }`.
2. Send that token in `x-csrf-token` for every mutation, including login and password recovery. Send the `cf.sid` cookie on subsequent requests.
3. `POST /auth/login` accepts `{ email, password, remember }`, regenerates the session, and returns the user plus a new CSRF token. Replace the old token.
4. A user with `mustChangePassword: true` can use authentication/profile endpoints but cannot read financial APIs.

Session cookies are HTTP-only and SameSite Strict; production adds Secure and requires HTTPS. Allowed production Origin is exactly `APP_URL`. Development permits localhost/127.0.0.1 aliases on the configured port. A session lasts 8 hours, or 7 days when remembered. Five failed attempts lock an account for 15 minutes; login is also limited to 15 requests/15 minutes per IP. Recovery is limited to 5/hour. API requests are limited to 300/minute per IP. The limiter is process-local; use a shared limiter before scaling to multiple instances.

| Method | Endpoint | Request / purpose |
|---|---|---|
| GET | `/health` | Database health, no financial data; public |
| GET | `/auth/session` | Current sanitized user and CSRF token; public |
| POST | `/auth/login` | `{email,password,remember}` |
| POST | `/auth/logout` | Destroy session and record logout |
| POST | `/auth/forgot-password` | `{email}`; generic response |
| POST | `/auth/reset-password` | `{token,password}`; token valid 30 minutes, single use |
| POST | `/auth/change-password` | `{currentPassword,password}`; revokes other sessions and rotates current session |
| GET | `/auth/profile` | Sanitized user and latest 30 access/security events |
| PATCH | `/auth/profile` | `{displayName,email,currentPassword}` |
| GET | `/dashboard` | Statistics, six chart datasets, recent payments/refunds |
| GET | `/methods` | Payment methods with type, availability, and payment usage count |
| POST | `/methods` | `{name,kind,enabled}`; kind is `MANUAL` or `SIMULATOR` |
| PATCH | `/methods/:id` | Any of `{name,kind,enabled}`; used methods can only change availability |
| DELETE | `/methods/:id` | Delete an unused method; historical methods must be disabled instead |
| GET | `/orders` | Imported order/customer/seller references and totals |
| POST | `/payments` | `{orderId,methodId,evidence?,idempotencyKey}`; amount comes from stored order |
| GET | `/payments` | Query/filter/paginated payments and transactions |
| GET | `/payments/:id` | Payment, order, customer, seller, receipt, refunds, attempts, events, earnings |
| POST | `/payments/:id/actions` | `{action,evidence?,providerReference?}` |
| GET | `/refunds` | Paginated refund requests with original payment and transfers |
| POST | `/refunds` | `{paymentId,amountCents,reason,idempotencyKey}` |
| POST | `/refunds/:id/actions` | `{action,note?,providerReference?}` |
| GET | `/receipts` | Paginated verified receipt history |
| GET | `/receipts/:id/pdf` | Protected downloadable PDF |
| GET | `/customers` | Customer records, orders, payments, refunds, and verified spending |
| POST | `/customers` | Create an administrative customer master record |
| PATCH | `/customers/:id` | Update an administrative customer; linked external references are locked |
| DELETE | `/customers/:id` | Delete an administrative customer with no linked orders |
| GET | `/sellers` | Artisan records with financial totals/history |
| POST | `/sellers` | Create an administrative seller master record |
| PATCH | `/sellers/:id` | Update an administrative seller; linked external references are locked |
| DELETE | `/sellers/:id` | Delete a seller with no order or financial history |
| GET | `/earnings` | Seller earnings, paid/reserved/available/pending balances |
| GET | `/ledger?sellerId=...` | Signed append-only seller ledger |
| GET | `/payouts` | Paginated payout records |
| POST | `/payouts` | `{sellerId,amountCents,destination,idempotencyKey}` |
| POST | `/payouts/:id/actions` | `{action,note?,providerReference?}` |
| GET | `/reports` | Date-filtered financial datasets and summaries |
| GET | `/exports/:module/:format` | Module: payments, transactions, refunds, payouts, earnings, reports, ledger. Format: csv or pdf. Exports all matching records. |
| GET | `/notifications` | Latest 200 notifications |
| PATCH | `/notifications/:id/read` | Mark read; ID `all` marks all read |
| DELETE | `/notifications/:id` | Delete one notification; ID `read` clears all read notifications |
| GET | `/audit` | Searchable, paginated audit history |
| GET | `/settings` | Public-to-admin operational settings, no private keys |
| PATCH | `/settings` | All five settings described below |
| GET | `/integration` | Explicit integration status and latest 100 sync events |
| POST | `/integration/import` | Authorized single order JSON import |
| POST | `/integration/simulate-order` | Development simulator only |
| POST | `/integration/sync` | Authorized live adapter attempt; disabled in simulator |
| POST | `/integration/logs/:id/retry` | Retry pending/failed outgoing status event |
| POST | `/webhooks/payment` | Custom HMAC provider event; no cookie/CSRF; signature required |

## Filters and exports

Payments: `q`, `status`, `method`, `from`, `to`, `sort` (`createdAt`, `amountCents`, `reference`, `status`), `direction` (`asc`/`desc`), `page` (default 1), `limit` (1–100, default 10). Refunds: `q` reference/reason, `status`, dates, pagination. Payouts: `q` reference/seller, `status`, pagination. Receipts: `q` number/payment/customer, pagination. Audit: `q` action/details, pagination. Dates use `YYYY-MM-DD` inclusive boundaries in Asia/Manila. CSV cells escape spreadsheet formula prefixes.

Refund exports use `refundStatus`; payout exports use `payoutStatus` instead of the payment `status` filter. Earnings exports are lifetime balances. Ledger exports honor dates. Export pagination parameters do not truncate exports.

## Financial state transitions

- Payment actions: `processing`, `verify`, `simulate-success`, `fail`, `cancel`, `expire`. Only Pending/Processing can settle. Manual `verify` requires evidence and a unique transfer reference. `simulate-success` requires development mode, simulator payment, and simulator order. Gateway settlement requires the verified custom webhook adapter.
- Refund actions: `review`, `approve`, `reject`, `process`, `complete`, `fail`, `retry`. Reject requires a reason; manual Complete requires a unique real transfer reference. Simulator Complete generates a simulated reference. Approval alone does not move or deduct funds. Request window is measured from verification. Active reservations plus completed refunds cannot exceed the original payment.
- Payout actions: `approve`, `process`, `reject`, `complete`. Reject requires a reason; Complete requires a unique transfer reference. Simulator sellers require a `SIM-` prefix. Request reserves earnings, Complete creates a debit, Reject releases the reservation.
- All creation mutations require an 8–100 character idempotency key; UUIDs are recommended. Replaying the same financial request returns its original record. Incompatible reuse fails.

`PATCH /settings` requires `{ organizationName, contactEmail, commissionBps, refundDays, notificationsEnabled }`. Commission is 0–3000 basis points, refund window 1–365 days. Unknown fields are rejected. Audit logging cannot be disabled.

See [INTEGRATION.md](INTEGRATION.md) for import JSON and webhook signing.

## Transaction history

`GET /api/transactions` requires a signed-in administrator with a changed initial password. It accepts the same `q`, `status`, `method`, `from`, `to`, `sort`, `direction`, `page`, and `limit` filters as `/api/payments`. The response includes `rows`, `total`, `page`, `limit`, and `summary` (`verifiedCents`, `refundedCents`, `netVerifiedCents`). Summary amounts cover all matching verified payments, independently of pagination. Financial changes are performed through the payment/refund/payout endpoints.
