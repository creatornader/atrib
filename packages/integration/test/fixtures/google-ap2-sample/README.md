# Google AP2 sample fixtures

This directory contains a minimal captured artifact set from the official `google-agentic-commerce/AP2` Python sample:

- Scenario: `code/samples/python/scenarios/a2a/human-not-present/cards`
- AP2 reference repo commit: `e1ea56d`
- Run date: 2026-05-29

The fixture keeps only public or presentation material:

- `events.json`: the A2A function-response fragments needed to find `complete_checkout`, `create_checkout_presentation`, and `create_payment_presentation`. The checkout receipt JWT is split into parts and rejoined by the extractor at runtime.
- `temp-db/merchant_signing_key.pub`: the sample merchant public JWK used to verify the checkout receipt JWT.
- `temp-db/chk_*.sdjwt.json` and `temp-db/pay_*.sdjwt.json`: split forms of the full delegated checkout and payment mandate chains emitted by the sample. The extractor still accepts the raw `.sdjwt` files from a live official sample run.

It does not include `.env`, API keys, private PEM files, token stores, web-client logs, or payment credential responses.
