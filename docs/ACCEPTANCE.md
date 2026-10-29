# Acceptance and verification status

Verified on October 13, 2026 (Asia/Manila). This document records actual checks, not a claim of 100% production completion.

## Passed automated checks

`npm test` covers **55 automated checks**: 23 UI regression tests, 2 development startup tests, and 30 API acceptance tests. The API suite uses a freshly migrated, isolated SQLite database. The UI suite uses the real admin page components with mocked API responses and chart containers; it does not replace visual browser QA.

| Check | Result |
|---|---|
| One initial admin, bcrypt hash, duplicate seed safety | Passed |
| Public SPA routes served, credentials absent from HTML, no signup endpoint | Passed |
| Financial API authentication across all modules | Passed |
| CSRF validation, disallowed Origin, generic invalid login | Passed |
| First-login password change and session rotation | Passed |
| Authorized imports, linked references, conflicting import rejection | Passed |
| Customer/seller create, update, safe delete, and linked-history protection | Passed |
| Stored order totals, payment idempotency, duplicate prevention | Passed |
| Manual verification evidence and unique transfer references | Passed |
| Failed/cancelled/expired payment states and new retry requests | Passed |
| Transaction search, filtering, sorting, pagination, invalid date rejection | Passed |
| Dedicated transaction history and full-filter summary independent of pagination | Passed |
| Every admin sidebar destination and direct route, unknown route handling | Passed DOM regression tests |
| First-login return route, customer/seller state isolation, stale request cancellation | Passed DOM regression tests |
| Busy development port selection and reserved API/web ports | Passed |
| Concurrent payment creation serialized; exactly one active payment | Passed |
| Refund reservations, duplicate prevention, rejection release | Passed |
| Partial/full refunds, exact centavo rounding, ledger balance | Passed |
| Manual refund references and configurable request window | Passed |
| Failed refund retry rechecks unreserved balance | Passed |
| Verified receipt generation/search and downloadable PDF bytes | Passed |
| Payout reservation, overspending rejection, completion once | Passed |
| CSV/PDF exports for all seven financial export modules | Passed |
| CSV formula-prefix escaping | Passed |
| Dashboard totals and date-filtered reports | Passed |
| SQL persistence across a second database client | Passed |
| Customer, seller, and ledger API datasets | Passed |
| Settings validation, payment-method CRUD/history protection, notification preferences | Passed |
| Audit records and mark-all notification read state | Passed |
| Integration mode disclosure and unconfigured live adapter behavior | Passed |
| HMAC webhook verification, replay idempotency, gateway amount matching | Passed for custom local adapter |
| Profile edits require current password | Passed |
| Logout, persisted session expiry, login lockout | Passed |
| Generic reset response, hashed/single-use token, session revocation | Passed |
| Expired reset rejection and recovery rate limit | Passed |

Development startup was exercised with occupied ports: Vite selected a free port, the proxied API health check returned 200, the application modules were served, and CSRF checks accepted the selected local origin while rejecting an external origin. Each launch keeps the terminal running and prints its actual Local URL.

`npm run build`: production frontend compiled successfully. Bundles are separated for React, animation, charts, and the lazy-loaded administrator workspace.

`prisma validate --schema prisma/mysql/schema.prisma`: MySQL production schema validated with a MySQL-format configuration. SQL migration generated for all 20 requested tables. No MySQL server was available for migration execution or MySQL-specific concurrency tests.

Local HTTP smoke check: the Vite homepage returned HTTP 200 and `/api/health` returned `{ "status": "ok", "mode": "simulator" }` through the development proxy.

## Verification still required

| Area | Actual status / required access |
|---|---|
| Browser navigation, first-login UI, chart rendering, modals | All 15 sidebar destinations, direct links, URL/active-link matching, first-login return destination, search, retry, and module state isolation passed DOM tests. Visual chart/layout checks remain unverified: the computer-use inventory reported no connected browsers. |
| Android, iPhone, tablet, desktop layout and accessibility | Responsive CSS implemented, but device/browser visual and keyboard QA not performed. |
| MySQL migrations and persistence | Schema/migrations supplied, not executed against MySQL. Laragon/MySQL/Docker are unavailable in this workspace. |
| CultureFrame backend | Public website access failed in the available web tool. Backend source, credentials, and API contract were not supplied. |
| CultureFrame live pull/status synchronization | Proposed HTTPS/Bearer adapter supplied, not remotely verified. Local simulator/import verified. |
| Real payment gateway checkout/refunds | No provider account/credentials supplied. Manual transfer recording and custom signed-event adapter are implemented. Native provider bridge and sandbox certification remain required. |
| SMTP delivery | Local development outbox verified; external SMTP unconfigured and untested. |
| Render/HTTPS hosting | Blueprint and instructions provided; nothing deployed. |
| Backup restoration, load testing, production operations | Instructions and limits documented; no restoration or production load test performed. |
| Privacy/terms and receipts | Operational drafts and payment acknowledgments supplied; system operator review required before production use. |

## Manual browser checklist

1. Open the Local URL printed by `npm run dev` (preferred port 5175); inspect the landing page and section navigation at 390, 768, and 1440 pixel widths.
2. Confirm there is no registration link/page. Open Admin login, test show/hide password and invalid login, then sign in using the provisioned account.
3. Confirm financial records remain blocked until the initial password is changed; enter the new private password yourself.
4. Open every sidebar item. Check sidebar collapse/mobile navigation, keyboard focus, charts, table scrolling, and error/loading/empty states.
5. In Integration, create a simulator order. Create its simulator payment, open details, and simulate success. Confirm the receipt, earnings, notification, audit record, and simulated sync event.
6. Search/filter/sort transactions and change pages. Compare CSV/PDF exports with the selected filters. Open PDF receipts and print previews.
7. Request a partial refund, review/approve/process/complete it, and confirm payment/refund/earnings/ledger totals. Attempt an excessive duplicate refund and confirm rejection.
8. Request a simulator seller payout, approve it, and complete it with a `SIM-` transfer reference. Confirm reserved and available balances.
9. Change commission/refund/notification settings, reload, and confirm persistence and audit events.
10. Test profile/password/logout/forgot-password flows. Local reset messages are in `.local/mail`; never share the reset links.
11. Repeat the non-destructive workflow in MySQL staging and the authorized CultureFrame/provider sandboxes before production activation.
