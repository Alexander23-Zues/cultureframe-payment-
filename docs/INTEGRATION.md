# CultureFrame and payment integration contract

The supplied website is https://jennycultureframe-1.onrender.com/. Inspecting that URL through the available web tool failed. Its backend source, private API definitions, credentials, and provider accounts were not supplied. No live integration is claimed.

## Local simulator

Set `INTEGRATION_MODE=simulator` only in development. Initial seed creates fictitious customers/artisans with `example.test` emails and `SIM-` references. The integration screen can create additional simulator orders. Create a payment using the simulator method, then select Simulate success from transaction details. This generates a receipt, a seller credit, notifications, an audit event, and a simulated outgoing status event. Simulated refunds and payouts maintain the same accounting constraints without transferring funds. Production startup rejects simulator mode.

## Authorized order import

An administrator can import a real order whose total has been checked independently. Source is explicitly `ADMIN_IMPORT`; it is never described as verified remote synchronization. Replaying identical order details is idempotent; conflicting references/totals are rejected. There is one seller and one product line per order in this version. Split multi-seller/multi-line CultureFrame orders into stable seller-order references in the upstream adapter, or extend the normalized order-line model before connecting an upstream backend with that structure.

```json
{
  "externalId": "CF-ORDER-1042",
  "product": "Handwoven market tote",
  "quantity": 1,
  "amountCents": 125000,
  "currency": "PHP",
  "customer": { "externalId": "CF-CUSTOMER-17", "name": "Customer name", "email": "customer@example.com", "phone": "", "address": "" },
  "seller": { "externalId": "CF-SELLER-04", "name": "Artisan name", "email": "seller@example.com", "craft": "Natural fiber crafts", "location": "Mansalay, Oriental Mindoro" }
}
```

## Live server-to-server adapter (unverified)

Set `INTEGRATION_MODE=live`, `CULTUREFRAME_API_URL` to the owner's agreed HTTPS integration base URL, and `CULTUREFRAME_API_TOKEN` to a private server-side Bearer token. Do not set an arbitrary public homepage as the API URL.

The implemented adapter proposes the following contract. **These endpoints are not known to exist in CultureFrame** and must be confirmed or implemented by its backend owner:

- `GET {base}/orders?updatedAfter={ISO-8601}&cursor={opaque}`, with Bearer authorization, returns `{ "orders": [ ...authorized order JSON above... ], "nextCursor": null }`, at most 1000 orders per page. Both query parameters are optional on the initial request. Return an opaque `nextCursor` while more pages remain and `null` on the final page. The payment service stores its successful-sync watermark and sends it as `updatedAfter` on the next run.
- `POST {base}/orders/{externalId}/payment-events`, with Bearer authorization, JSON, and the stable `Idempotency-Key` of the local outbox event. Payload contains the payment/refund reference, status, amountCents, and transfer reference where applicable.
- Remote success must return an HTTP 2xx response. Redirects are rejected to prevent credential forwarding. Requests time out after 15 seconds.

Successful order pulls save an `updatedAfter` watermark and follow up to 100 cursor pages. In live mode, `INTEGRATION_AUTO_SYNC=true` runs this pull on `INTEGRATION_SYNC_INTERVAL_MS` (five minutes by default, one minute minimum); manual synchronization remains available. A process-local guard prevents overlapping manual and scheduled pulls. Stable external IDs make replay idempotent, while changed order totals or identities are rejected for review. Customer and seller profile fields from an authorized CultureFrame source are refreshed during replay.

Payment/refund completion writes an outbox event inside the same financial database transaction. The integration page permits outbound delivery/retry; attempts, failures, and retry times are retained. Failed outbound events use exponential retry eligibility up to one hour and remain administrator-triggered. After a process crash, a Processing event should be reconciled by an operator against the remote idempotency record before recovery. The supplied site does not support inbound CultureFrame webhooks yet; order retrieval is a protected pull workflow. `CULTUREFRAME_WEBHOOK_SECRET` is reserved and is not an activated route.

Live status intentionally remains **unverified** even when credentials are configured. Confirm identity, ownership, totals, duplication behavior, retry handling, and remote order updates with the CultureFrame owner in staging before production activation.

## Custom gateway webhook adapter

No Stripe, PayMongo, GCash, or Maya gateway SDK/checkout is activated. GCash and Maya methods in this application mean **independently verified manual transfers**. The custom adapter is intended for an authorized server-side bridge that verifies its actual payment provider first. Native provider events must not be sent without adapting their authentication and semantics.

Configure a private `PAYMENT_WEBHOOK_SECRET` of at least 32 characters. A bridge may send `POST /api/webhooks/payment` with:

```json
{
  "id": "provider-unique-event-id",
  "paymentId": "local-payment-id",
  "status": "SUCCEEDED",
  "amountCents": 125000,
  "currency": "PHP",
  "providerReference": "unique-provider-transfer-reference"
}
```

Headers:

- `Content-Type: application/json`
- `X-Webhook-Timestamp`: Unix timestamp in seconds, within 5 minutes.
- `X-Webhook-Signature`: lowercase hex HMAC-SHA256 of `timestamp + '.' + exact raw JSON bytes`, using the shared private secret.

Only records explicitly designated `GATEWAY` by the trusted backend bridge can be settled by this route; the public/admin payment creation API does not create gateway checkout requests. Event IDs are unique, repeats are idempotent, transfer references are unique, and amount/currency must match. This adapter has local signature/idempotency tests, **not a live provider certification**. Real checkout creation, gateway failures/refunds/reconciliation, and provider-specific sandbox tests remain an activation milestone.

## Email

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `MAIL_FROM`. Port 465 uses implicit TLS; standard 587 uses STARTTLS. Delivery has not been tested against an external SMTP account. In development, omitted SMTP saves reset emails in ignored `.local/mail`. A reset token is stored hashed in the database, expires in 30 minutes, and can be used once. No reset token is returned by the API.
