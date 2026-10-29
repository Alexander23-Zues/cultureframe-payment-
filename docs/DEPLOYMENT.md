# Setup, production deployment, and operations

## Local Windows setup

1. Install Node.js 22.12+ from the official Node.js distribution.
2. Open this project folder in VS Code. Install with `npm install`.
3. Create a private `.env` from `.env.example` if missing. Configure a session secret of at least 32 random characters, administrator email, and an initial password of at least 12 characters (maximum 72 UTF-8 bytes). The supplied administrator is already configured in this workspace's ignored environment file.
4. `npm run db:generate`, then `npm run db:setup`. Initialization creates the SQLite file if needed, applies migrations, provisions the administrator once, and adds clearly labeled development examples when simulator mode is selected.
5. `npm run dev`. Visit the Local URL printed by startup (normally http://127.0.0.1:5175). Sign in, then choose a new private password. No registration is available.
6. Run `npm run build` and `npm test` before a release. Tests create their own database and test account; they do not change the owner's password.

For a built local preview, set `APP_URL=http://localhost:4000` in your private environment, run `npm run build`, then `npm start`. Express serves both the compiled SPA and APIs from port 4000. `npm run dev` sets the application origin to its selected frontend port automatically. The HTTP Origin must match the configured application origin.

## MySQL and Laragon

Use MySQL 8.0+ with `utf8mb4` and a dedicated least-privilege application user. Create the database `cultural_product_payments`; grant the deployment user necessary migration rights and the runtime user only the rights required by the application. Configure a URL-encoded `mysql://` connection in the private environment. Use your managed provider's TLS options and verify certificate behavior before activation.

```powershell
npm run db:mysql:generate
npm run db:mysql:deploy
npm run build
```

Optional Docker service: set private `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD`, then `docker compose up -d mysql`. It publishes MySQL only on 127.0.0.1:3306 and keeps data in a named volume. Never remove that volume to resolve a routine connection error. Docker/MySQL were not installed or run in this workspace.

## Render

The supplied `render.yaml` defines an Express Node web service and does not create a database. Its fields follow the [official Render Blueprint reference](https://render.com/docs/blueprint-spec). Connect an authorized repository and provision managed MySQL separately. Configure these values privately in Render:

| Environment variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Managed MySQL URL, including provider-required TLS options |
| `APP_URL` | Exact HTTPS public app origin, without a trailing slash |
| `SESSION_SECRET` | Strong random secret; blueprint can generate it |
| `ADMIN_EMAIL` | Authorized administrator email |
| `ADMIN_INITIAL_PASSWORD` | Private initial provisioning password; remove after provisioning/password change |
| `INTEGRATION_MODE` | `live` (live adapter remains unverified until tested) |
| `CULTUREFRAME_API_URL` / `CULTUREFRAME_API_TOKEN` | Only after the owner approves and confirms the adapter contract |
| `INTEGRATION_AUTO_SYNC` / `INTEGRATION_SYNC_INTERVAL_MS` | `true` and the polling interval in milliseconds (default `300000`, minimum `60000`) |
| `PAYMENT_WEBHOOK_SECRET` | Only for an authorized custom gateway bridge |
| SMTP variables | Valid SMTP account and sender for reset delivery |

Build: `npm ci --include=dev && npm run db:mysql:generate && npm run build`.

Pre-deploy: `npm run db:mysql:deploy` (migrations plus idempotent administrator setup).

Start: `npm start`. Health check: `/api/health`. Render supplies `PORT`; production binds to 0.0.0.0. Express trusts one reverse proxy and sets Secure session cookies. Production startup refuses SQLite, missing/short secrets, non-HTTPS `APP_URL`, or simulator mode.

No Render account, managed database, DNS, or provider credentials have been used here. The blueprint is preparation, not a verified deployment. Confirm deployment plan support for pre-deploy commands and adjust your release process if needed.

## Release verification

- Apply MySQL migrations in staging; run the acceptance suite against a dedicated MySQL test environment before production. The included test runner deliberately uses SQLite.
- Confirm HTTPS and Secure/SameSite cookie behavior behind the actual proxy.
- Sign in as the provisioned administrator, change the initial password, and confirm it no longer works.
- Verify password-reset email delivery, expiry, and single use with the configured SMTP service.
- Verify the actual CultureFrame API contract and remote order/status reconciliation.
- Implement and verify the chosen gateway's checkout/refund/reconciliation bridge against its own sandbox. Local HMAC tests are not provider sandbox tests.
- Complete keyboard, mobile browser, tablet, and desktop visual checks using the manual checklist in ACCEPTANCE.md.
- Have the system operator review privacy/terms drafts, contact information, refund policy, retention, and receipt obligations before public use.

## Backups and restoration

Production: enable encrypted managed-MySQL backups and point-in-time recovery where supported. Set a documented retention schedule and restrict backup access. Test restoration into a separate database, validate record/ledger totals, and only then record the verified date in your operating log. No backup restoration was performed here. Avoid passing database passwords directly on shell command lines; use a protected client options file or your managed provider's backup interface.

Local SQLite: stop both application servers before copying `prisma/development.db` and any existing `-wal`/`-shm` sidecars into an encrypted backup location. Restore only while the application is stopped. Do not copy a live database and assume it is consistent. Never replace a production database with simulator data.

## Operational limits and recovery

- One organization, one super-administrator role, PHP currency, one seller/product line per order. There is no public checkout or multi-admin invitation UI.
- Manual refunds/payouts record externally verified transfers; they do not initiate bank/GCash/Maya transfers. Provider-specific automation is a separate activation milestone.
- API rate limits are process-local. Use a shared rate-limit store before horizontal scaling. Sessions are persistent in the SQL database.
- Inbound order polling is automatic when live API credentials and `INTEGRATION_AUTO_SYNC=true` are configured. Outbound payment-event retries remain administrator-triggered. Processing events left by a crash require reconciliation before operator recovery.
- Dashboard/report aggregation reads matching records into memory. Load-test realistic production volume and migrate heavy reporting to indexed SQL aggregates/background exports as needed.
- The administrator audit API has no edit/delete controls. Database operators can still alter data; production should restrict database permissions and use external log retention for tamper evidence.
- Initial password changes invalidate other sessions. Email changes require the current password but no verification email workflow; only trusted administrators can change the authorized email.
- Logs never deliberately contain passwords, reset tokens, or API keys. Development email files contain usable reset links and must remain private and ignored.
- If a payout reserves earnings needed by a refund, reject the eligible pending payout before completing the refund. Completed payouts require real-world funding/reconciliation; the application does not manufacture negative-balance funding entries.
