# UCP test fixtures

Real captured response shapes from the Universal Commerce Protocol (UCP).

**Source:** https://github.com/universal-commerce-protocol/ucp
**Spec docs:** `docs/specification/checkout-rest.md`
**UCP version:** `2026-08-25`
**Verified:** 2026-09-02

## Files

- `checkout_session_completed.json`: Success response from `POST /checkout-sessions/{id}/complete` under UCP v2026-08-25. Detection signal: `status === "completed"` and `order.id` is a string, plus a top-level `ucp.version` envelope. The current envelope also carries capability and payment-handler maps. The `order.permalink_url` is the canonical "checkout URL" used for content_id derivation.

## How UCP differs from ACP

The two protocols retain the same synchronous checkout close signal. UCP adds
its versioned envelope and current capability or payment-handler metadata:

```json
{
  "ucp": {
    "version": "2026-08-25",
    "capabilities": { "dev.ucp.shopping.checkout": [{ "version": "2026-08-25" }] },
    "payment_handlers": {
      "dev.ucp.common.payment": [{ "version": "2026-08-25", "id": "handler_1" }]
    }
  },
  "id": "chk_...",
  "status": "completed",
  "order": { "id": "ord_...", "permalink_url": "..." }
}
```

`detectTransaction` checks for `ucp.version` to set `protocol: 'UCP'`; in its absence the same completed shape is reported as `protocol: 'ACP'`. An asynchronous UCP response with `status: "complete_in_progress"` has no order and is not a completed transaction event.

## Redactions

None; public spec example.

## Updating these fixtures

See `../acp/README.md` for the update procedure.
