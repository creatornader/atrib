# ACP test fixtures

Real captured response shapes from the Agentic Commerce Protocol (ACP).

**Source:** https://github.com/agentic-commerce-protocol/agentic-commerce-protocol
**Spec docs:** `rfcs/rfc.agentic_checkout.md`
**Verified:** 2026-04-06

## Files

- `checkout_session_completed.json` — Success response from `POST /checkout_sessions/{id}/complete`. Detection signal: `status === "completed"` and `order.id` is a string. The `order.permalink_url` is the canonical "checkout URL" used for content_id derivation.
- `order_create_event.json` — Server → merchant webhook event when an order is first created. Detection signal: `type === "order_create"`. Note: it is `order_create`, NOT `order.created` or `ORDER_CREATED`.
- `order_update_event.json` — Server → merchant webhook event for order state changes (shipped, refunded, etc.). Detection signal: `type === "order_update"`.

## Redactions

None — these are example payloads from the public spec, not real customer data.

## Updating these fixtures

If the upstream spec evolves, re-pull from the source URL above and update the affected fixture file. Add a comment in the JSON describing what changed and the new revision date. Do not remove fields silently — extra fields may be load-bearing for future detection logic.
