# UCP test fixtures

Real captured response shapes from the Universal Commerce Protocol (UCP).

**Source:** https://github.com/universal-commerce-protocol/ucp
**Spec docs:** `docs/specification/checkout-rest.md`
**UCP version:** `2026-01-11`
**Verified:** 2026-04-06

## Files

- `checkout_session_completed.json`, Success response from `POST /checkout-sessions/{id}/complete`. Detection signal: `status === "completed"` and `order.id` is a string, AND a top-level `ucp.version` envelope is present (this is what distinguishes UCP from ACP since the rest of the shape is identical). The `order.permalink_url` is the canonical "checkout URL" used for content_id derivation.

## How UCP differs from ACP

The two protocols have converged on essentially the same checkout completion shape. The only structural difference is the top-level `ucp` envelope:

```json
{
  "ucp": { "version": "2026-01-11", "capabilities": [...] },
  "id": "chk_...",
  "status": "completed",
  "order": { "id": "ord_...", "permalink_url": "..." }
}
```

`detectTransaction` checks for `ucp.version` to set `protocol: 'UCP'`; in its absence the same shape is reported as `protocol: 'ACP'`.

## Redactions

None, public spec example.

## Updating these fixtures

See `../acp/README.md` for the update procedure.
