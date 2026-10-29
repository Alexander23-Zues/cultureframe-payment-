# CultureFrame Payments

An administrator-only Cultural Product Payment Management System for CultureFrame. React/Vite/Tailwind frontend, Express REST API, Prisma persistence, and MySQL production schema. No public registration exists.

## Run this project

Requires Node.js 22.12 or newer. In the project folder:

```powershell
npm install
npm run db:generate
npm run db:setup
npm run dev
```

Open the URL printed by `npm run dev` (normally **http://127.0.0.1:5175**). The API normally runs on port 4000. If either port is occupied, startup selects another free port and updates the API proxy and allowed origin together. Each launch starts a development instance on an available port. Stop a running instance with Ctrl+C in its terminal. Set `VITE_PORT` and `PORT` in `.env` to choose other preferred ports. This workspace already has an ignored `.env` with the administrator credentials supplied by the project owner. On a fresh checkout, copy `.env.example` to `.env`, generate a random session secret of at least 32 characters, and set `ADMIN_EMAIL` and `ADMIN_INITIAL_PASSWORD` privately before initialization.

**First login requires a new password** (12–72 characters, uppercase, lowercase, and a number). Account creation is backend-only. Re-running the seed does not reset an existing password. Once provisioned, the initial password environment variable can be removed. Do not commit `.env`, local databases, or generated mail.

## What works locally

- Public cultural-themed landing page, privacy notice, terms, and admin sign-in.
- Server-verified bcrypt authentication, database-backed sessions, first-login password change, remember me, logout, expiry, lockouts, CSRF protection, and login audit history.
- Password recovery with hashed, expiring, single-use tokens. Without SMTP, development email is stored privately in `.local/mail`; nothing is sent externally.
- Dashboard with nine financial statistics, collections/daily transaction chart, monthly revenue, payment status/method distributions, refund and earnings trends.
- Payment requests use stored order totals. Manual transfer verification requires evidence and a unique transfer reference. Simulator success is limited to simulator payments and orders.
- Transaction search, status/method/date filters, sorting, pagination, detail views, CSV/PDF exports, and printing.
- Refund review, approval/rejection, processing/failure/retry, partial/full completion, duplicate prevention, remaining balance reservations, and configurable request windows.
- PDF receipts generated after verification, search, print previews, and retained refund history. Receipts are payment acknowledgments, not BIR tax invoices.
- Imported customer/seller records with payment/refund history and verified totals.
- Seller gross sales, commissions, fees, refund deductions, net earnings, unverified pending settlements, available balances, reserved payouts, and append-only financial ledgers.
- Payout reservation, approval/rejection, processing, recorded transfer completion, history, and duplicate prevention. Manual payout/refund completion records an independently performed transfer; it does not send money.
- Daily/weekly/monthly/annual date selection, payment/refund/payout reports, lifetime earnings, dated ledger exports, CSV/PDF, and print.
- Notifications/read state, audit log search and pagination, operational settings, payment method toggles, authorized profile edits, and password changes.
- Authorized JSON order import, labeled simulator, incremental paginated order polling, integration event outbox/history, secure custom webhook adapter, and explicitly unverified live API adapter.

## Storage and financial model

Local development uses **SQLite**, since MySQL is not installed in this workspace. Records are persistent in `prisma/development.db`. The production **MySQL** schema and SQL migration are in `prisma/mysql/`; all 20 requested tables are included with foreign keys, indexes, and unique constraints. MySQL deployment has not been executed here.

Money is stored as integer centavos with a maximum order/payment of PHP 1,000,000. Commission basis points are captured at payment creation. Commissions round to the nearest centavo; partial refunds reverse cumulative commission amounts so a full refund has no rounding drift. Processing fees are recorded separately and retained on refund; supported manual methods currently have zero fees. Settlement creates one sale ledger entry, refunds create deductions, and completed payouts create deductions. Pending payouts reserve available balances. A refund cannot consume funds already paid out or reserved. Financial writes run inside serializable transactions with optimistic version checks and database uniqueness.

Report collections are grouped by payment creation date; refunds and payouts are grouped by their update/completion date. Lifetime seller balances are explicitly labeled. The ledger export provides period-specific credits and deductions. The chart window is the last 30 calendar days, even when a wider report period is selected.

## MySQL (Laragon or Docker)

Create `cultural_product_payments` on MySQL 8+, or set private `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD` values and run `docker compose up -d mysql`. Set `DATABASE_URL` to your MySQL connection URL in `.env`:

```text
mysql://cultureframe:YOUR_URL_ENCODED_PASSWORD@localhost:3306/cultural_product_payments
```

Then:

```powershell
npm run db:mysql:generate
npm run db:mysql:deploy
npm run dev
```

Generating a Prisma client switches its database provider. To return to SQLite, restore its `file:./development.db` URL and run `npm run db:generate`. Do not run SQLite tests with a MySQL-generated client. The two migration directories are intentionally separate; do not apply one provider's SQL to the other.

## Verification

```powershell
npm run build
npm test
```

Tests migrate a new isolated SQLite database in `.local`, provision a test account, and exercise API/security/financial workflows without changing your administrator account or development database. Run the build first because the public-route test checks the production SPA. See [acceptance status](docs/ACCEPTANCE.md) for passed checks and unverified items.

## Production and integration

See [deployment instructions](docs/DEPLOYMENT.md), [REST API documentation](docs/API.md), and [CultureFrame adapter contract](docs/INTEGRATION.md).

Live CultureFrame synchronization, a real gateway checkout/refund provider, SMTP delivery, managed MySQL, external HTTPS hosting, backup restoration, and browser/mobile visual QA are **not verified** in this workspace. These are not claimed as complete integrations. `render.yaml` prepares a deployment; no hosting account has been accessed or deployment performed. Production startup rejects SQLite and simulator mode.

## Project structure

```text
src/                  React pages, components, responsive styles
server/               Express API, authentication, financial domain, PDF reports
prisma/               SQLite development schema and migrations
prisma/mysql/         MySQL production schema and migrations
tests/                Isolated end-to-end API acceptance tests
scripts/              Database/provider setup and test runner
docs/                 API, integration, deployment, acceptance status
render.yaml           Render service configuration
docker-compose.yml    Optional local MySQL service
```
