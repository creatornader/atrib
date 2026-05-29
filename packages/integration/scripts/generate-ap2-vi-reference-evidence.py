#!/usr/bin/env python3
"""Generate AP2 plus Verifiable Intent reference artifacts from upstream repos.

This script imports the official AP2 Python SDK and the public
agent-intent/verifiable-intent Python reference implementation. It writes a
deterministic fixture that the TypeScript interop harness can verify without
starting the credential-dependent AP2 sample services.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import subprocess
import sys

from pathlib import Path
from typing import Any, Callable


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_AP2_REPO = Path("/tmp/google-ap2-reference")
DEFAULT_VI_REPO = Path("/tmp/verifiable-intent-reference")
DEFAULT_OUTPUT_DIR = REPO_ROOT / "packages/integration/test/fixtures/ap2-vi-reference"

NOW_SECONDS = 1_779_840_000
RECEIPT_IAT = NOW_SECONDS + 30


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate AP2 / VI reference artifacts from official upstream code."
    )
    parser.add_argument(
        "--ap2-repo",
        type=Path,
        default=DEFAULT_AP2_REPO,
        help="Path to a google-agentic-commerce/AP2 checkout.",
    )
    parser.add_argument(
        "--vi-repo",
        type=Path,
        default=DEFAULT_VI_REPO,
        help="Path to an agent-intent/verifiable-intent checkout.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory for generated JSON artifacts.",
    )
    return parser.parse_args()


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def add_import_paths(ap2_repo: Path, vi_repo: Path) -> None:
    sdk_path = ap2_repo / "code/sdk/python"
    vi_src = vi_repo / "src"
    vi_examples = vi_repo / "examples"
    for path in (sdk_path, vi_src, vi_examples):
        if not path.exists():
            raise SystemExit(f"Required upstream path does not exist: {path}")
        sys.path.insert(0, str(path))


def repo_commit(path: Path) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(path), "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        return "unknown"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def hash_ascii(value: str) -> str:
    return b64url(hashlib.sha256(value.encode("ascii")).digest())


def jwt_parts(value: str) -> list[str]:
    parts = value.split(".")
    if len(parts) != 3 or not all(parts):
        raise SystemExit("Expected compact JWT with three segments")
    return parts


def sd_jwt_parts(value: str) -> dict[str, Any]:
    parts = value.split("~")
    trailing_tilde = parts[-1] == ""
    if trailing_tilde:
        parts = parts[:-1]
    if not parts:
        raise SystemExit("Expected SD-JWT with a compact JWT segment")
    return {
        "jwt": jwt_parts(parts[0]),
        "disclosures": parts[1:],
        "trailingTilde": trailing_tilde,
    }


def install_deterministic_disclosure_salts() -> None:
    import verifiable_intent.crypto.disclosure as disclosure

    counter = 0

    def deterministic_salt() -> str:
        nonlocal counter
        counter += 1
        digest = hashlib.sha256(f"atrib-vi-reference-salt:{counter}".encode("ascii")).digest()
        return b64url(digest[:16])

    disclosure._generate_salt = deterministic_salt


def with_kid(jwk: dict[str, Any], kid: str) -> dict[str, Any]:
    result = dict(jwk)
    result["kid"] = kid
    result["alg"] = "ES256"
    return result


def find_disclosure(sd_jwt: Any, predicate: Callable[[Any], bool], label: str) -> str:
    for disclosure, decoded in zip(sd_jwt.disclosures, sd_jwt.disclosure_values):
        value = decoded[-1] if decoded else None
        if predicate(value):
            return disclosure
    raise SystemExit(f"Could not find VI disclosure: {label}")


def jwcrypto_keypair(private_jwk: dict[str, Any], kid: str) -> tuple[Any, dict[str, Any]]:
    from jwcrypto.jwk import JWK

    key = dict(private_jwk)
    key["kid"] = kid
    key["alg"] = "ES256"
    signer = JWK.from_json(json.dumps(key))
    public_jwk = json.loads(signer.export_public())
    public_jwk["kid"] = kid
    public_jwk["alg"] = "ES256"
    return signer, public_jwk


def generate_vi_chain() -> dict[str, Any]:
    install_deterministic_disclosure_salts()

    import helpers

    helpers.time.time = lambda: NOW_SECONDS

    from helpers import (
        ACCEPTABLE_ITEMS,
        MERCHANTS,
        PAYMENT_INSTRUMENT,
        build_role_presentations,
        checkout_hash_from_jwt,
        create_checkout_jwt,
        find_product,
        get_agent_keys,
        get_issuer_keys,
        get_merchant_keys,
        get_user_keys,
    )
    from verifiable_intent.crypto.disclosure import build_selective_presentation, hash_bytes
    from verifiable_intent.crypto.sd_jwt import decode_sd_jwt, resolve_disclosures
    from verifiable_intent.issuance.agent import create_layer3_checkout, create_layer3_payment
    from verifiable_intent.issuance.issuer import create_layer1
    from verifiable_intent.issuance.user import create_layer2_autonomous
    from verifiable_intent.models.agent_mandate import (
        CheckoutL3Mandate,
        FinalCheckoutMandate,
        FinalPaymentMandate,
        PaymentL3Mandate,
    )
    from verifiable_intent.models.constraints import (
        AllowedMerchantConstraint,
        AllowedPayeeConstraint,
        CheckoutLineItemsConstraint,
        PaymentAmountConstraint,
    )
    from verifiable_intent.models.issuer_credential import IssuerCredential
    from verifiable_intent.models.user_mandate import (
        CheckoutMandate,
        MandateMode,
        PaymentMandate,
        UserMandate,
    )
    from verifiable_intent.verification.chain import verify_chain
    from verifiable_intent.verification.constraint_checker import check_constraints

    issuer = get_issuer_keys()
    user = get_user_keys()
    agent = get_agent_keys()
    merchant = get_merchant_keys()
    racket = find_product("BAB86345")
    if not racket:
        raise SystemExit("Reference VI product BAB86345 was not found")

    l1_credential = IssuerCredential(
        iss="https://www.mastercard.com",
        sub="user-alice-001",
        iat=NOW_SECONDS,
        exp=NOW_SECONDS + 86_400,
        aud="https://wallet.example.com",
        cnf_jwk=user.public_jwk,
        email="alice@example.com",
        pan_last_four="1234",
        scheme="Mastercard",
    )
    l1 = create_layer1(l1_credential, issuer.private_key, kid=issuer.kid)

    l2_mandate = UserMandate(
        nonce="atrib-vi-reference-l2",
        aud="https://agent.verifiable-intent.example",
        iat=NOW_SECONDS + 10,
        iss="https://wallet.example.com",
        exp=NOW_SECONDS + 86_400,
        mode=MandateMode.AUTONOMOUS,
        sd_hash=hash_bytes(l1.serialize().encode("ascii")),
        prompt_summary="Buy a Babolat tennis racket under $400",
        checkout_mandate=CheckoutMandate(
            vct="mandate.checkout.open.1",
            cnf_jwk=agent.public_jwk,
            cnf_kid=agent.kid,
            constraints=[
                AllowedMerchantConstraint(allowed=MERCHANTS),
                CheckoutLineItemsConstraint(
                    items=[{"id": "line-item-1", "acceptable_items": ACCEPTABLE_ITEMS, "quantity": 1}],
                ),
            ],
        ),
        payment_mandate=PaymentMandate(
            vct="mandate.payment.open.1",
            cnf_jwk=agent.public_jwk,
            cnf_kid=agent.kid,
            payment_instrument=PAYMENT_INSTRUMENT,
            risk_data={"device_id": "android1234", "ip_address": "192.168.1.100"},
            constraints=[
                PaymentAmountConstraint(currency="USD", min=10_000, max=40_000),
                AllowedPayeeConstraint(allowed=MERCHANTS),
            ],
        ),
        merchants=MERCHANTS,
        acceptable_items=ACCEPTABLE_ITEMS,
    )
    l2 = create_layer2_autonomous(l2_mandate, user.private_key, kid=user.kid)

    checkout_jwt = create_checkout_jwt([{"sku": racket["sku"], "quantity": 1}], merchant)
    checkout_hash = checkout_hash_from_jwt(checkout_jwt)
    l2_serialized = l2.serialize()
    l2_base_jwt = l2_serialized.split("~")[0]

    payment_disc = find_disclosure(
        l2, lambda value: isinstance(value, dict) and value.get("vct") == "mandate.payment.open.1", "L2 payment"
    )
    checkout_disc = find_disclosure(
        l2, lambda value: isinstance(value, dict) and value.get("vct") == "mandate.checkout.open.1", "L2 checkout"
    )
    merchant_disc = find_disclosure(
        l2, lambda value: isinstance(value, dict) and value.get("name") == "Tennis Warehouse", "merchant"
    )
    item_disc = find_disclosure(
        l2, lambda value: isinstance(value, dict) and value.get("id") == "BAB86345", "item"
    )

    final_payment = FinalPaymentMandate(
        transaction_id=checkout_hash,
        payee=MERCHANTS[0],
        payment_amount={"currency": "USD", "amount": racket["price"]},
        payment_instrument=PAYMENT_INSTRUMENT,
    )
    l3_payment = create_layer3_payment(
        PaymentL3Mandate(
            nonce="atrib-vi-reference-l3",
            aud="https://www.mastercard.com",
            iat=NOW_SECONDS + 20,
            iss="https://agent.example.com",
            exp=NOW_SECONDS + 300,
            final_payment=final_payment,
            final_merchant=MERCHANTS[0],
        ),
        agent.private_key,
        l2_base_jwt,
        payment_disc,
        merchant_disc,
        kid=agent.kid,
    )

    final_checkout = FinalCheckoutMandate(checkout_jwt=checkout_jwt, checkout_hash=checkout_hash)
    l3_checkout = create_layer3_checkout(
        CheckoutL3Mandate(
            nonce="atrib-vi-reference-l3",
            aud="https://tennis-warehouse.com",
            iat=NOW_SECONDS + 20,
            iss="https://agent.example.com",
            exp=NOW_SECONDS + 300,
            final_checkout=final_checkout,
        ),
        agent.private_key,
        l2_base_jwt,
        checkout_disc,
        item_disc,
        kid=agent.kid,
    )

    l2_checkout_only, l2_payment_only = build_role_presentations(l2, l2_serialized)
    l2_payment_presentation = build_selective_presentation(l2_base_jwt, [payment_disc, merchant_disc])
    l2_checkout_presentation = build_selective_presentation(l2_base_jwt, [checkout_disc, item_disc])
    l1_parsed = decode_sd_jwt(l1.serialize())

    merchant_result = verify_chain(
        l1_parsed,
        decode_sd_jwt(l2_checkout_only),
        l3_checkout=l3_checkout,
        issuer_public_key=issuer.public_key,
        l1_serialized=l1.serialize(),
        l2_serialized=l2_serialized,
        l2_checkout_serialized=l2_checkout_presentation,
    )
    network_result = verify_chain(
        l1_parsed,
        decode_sd_jwt(l2_serialized),
        l3_payment=l3_payment,
        issuer_public_key=issuer.public_key,
        l1_serialized=l1.serialize(),
        l2_serialized=l2_serialized,
        l2_payment_serialized=l2_payment_presentation,
    )
    if not merchant_result.valid:
        raise SystemExit(f"VI merchant chain verification failed: {merchant_result.errors}")
    if not network_result.valid:
        raise SystemExit(f"VI network chain verification failed: {network_result.errors}")

    l2_payment_claims = resolve_disclosures(decode_sd_jwt(l2_payment_only))
    payment_constraints = []
    for delegate in l2_payment_claims.get("delegate_payload", []):
        if isinstance(delegate, dict) and delegate.get("vct") == "mandate.payment.open.1":
            payment_constraints = delegate.get("constraints", [])
            break
    fulfillment = {}
    for delegate in network_result.l3_payment_claims.get("delegate_payload", []):
        if isinstance(delegate, dict) and delegate.get("vct") == "mandate.payment.1":
            fulfillment = delegate
            break
    fulfillment["allowed_merchants"] = MERCHANTS
    constraint_result = check_constraints(payment_constraints, fulfillment)
    if not constraint_result.satisfied:
        raise SystemExit(f"VI reference constraints failed: {constraint_result.violations}")

    closed_payment = find_disclosure(
        l3_payment,
        lambda value: isinstance(value, dict) and value.get("vct") == "mandate.payment.1",
        "L3 payment",
    )
    closed_checkout = find_disclosure(
        l3_checkout,
        lambda value: isinstance(value, dict) and value.get("vct") == "mandate.checkout.1",
        "L3 checkout",
    )

    return {
        "issuer": issuer,
        "user": user,
        "agent": agent,
        "merchant": merchant,
        "merchant_record": MERCHANTS[0],
        "racket": racket,
        "checkout_hash": checkout_hash,
        "closed_payment": closed_payment,
        "closed_checkout": closed_checkout,
        "l1": l1.serialize(),
        "l2": l2_serialized,
        "l2_payment_presentation": l2_payment_presentation,
        "l2_checkout_presentation": l2_checkout_presentation,
        "l3_payment": l3_payment.serialize(),
        "l3_checkout": l3_checkout.serialize(),
    }


def generate_ap2_receipts(vi: dict[str, Any]) -> dict[str, Any]:
    from ap2.sdk.generated.payment_mandate import PaymentMandate
    from ap2.sdk.generated.types.amount import Amount
    from ap2.sdk.generated.types.merchant import Merchant
    from ap2.sdk.generated.types.payment_instrument import PaymentInstrument
    from ap2.sdk.generated.types.pisp import PISP
    from ap2.sdk.jwt_helper import create_jwt
    from ap2.sdk.receipt_wrapper import ReceiptClient
    from jwcrypto.jwk import JWK

    merchant_record = vi["merchant_record"]
    racket = vi["racket"]
    client = ReceiptClient()

    payment_signer, payment_public_jwk = jwcrypto_keypair(
        vi["issuer"].private_jwk,
        "mastercard-ap2-receipt-key-1",
    )
    checkout_signer, checkout_public_jwk = jwcrypto_keypair(
        vi["merchant"].private_jwk,
        "tennis-warehouse-ap2-receipt-key-1",
    )

    payment_reference = hash_ascii(vi["closed_payment"])
    checkout_reference = hash_ascii(vi["closed_checkout"])

    payment_mandate = PaymentMandate(
        transaction_id=vi["checkout_hash"],
        payee=Merchant(
            id=merchant_record["id"],
            name=merchant_record["name"],
        ),
        payment_amount=Amount(amount=racket["price"], currency=racket["currency"]),
        payment_instrument=PaymentInstrument(
            id="f199c3dd-7106-478b-9b5f-7af9ca725170",
            type="mastercard.srcDigitalCard",
            description="Mastercard **** 1234",
        ),
        pisp=PISP(
            legal_name="Mastercard Reference Network",
            brand_name="Mastercard",
            domain_name="https://www.mastercard.com",
        ),
    )

    payment_receipt = client.create_payment_receipt(payment_mandate, payment_reference)
    payment_receipt.root.iat = RECEIPT_IAT
    payment_receipt.root.payment_id = "pay_vi_reference_1"
    payment_receipt.root.psp_confirmation_id = "psp_vi_reference_1"
    payment_receipt.root.network_confirmation_id = "net_vi_reference_1"

    checkout_receipt = client.create_checkout_receipt(
        merchant_record["website"],
        checkout_reference,
        "order_vi_reference_1",
    )
    checkout_receipt.root.iat = RECEIPT_IAT

    payment_header = {"alg": "ES256", "kid": "mastercard-ap2-receipt-key-1", "typ": "JWT"}
    checkout_header = {"alg": "ES256", "kid": "tennis-warehouse-ap2-receipt-key-1", "typ": "JWT"}
    payment_jwt = create_jwt(payment_header, payment_receipt.model_dump(), payment_signer)
    checkout_jwt = create_jwt(checkout_header, checkout_receipt.model_dump(), checkout_signer)

    payment_verify = client.verify_receipt(
        payment_jwt,
        JWK.from_json(json.dumps(payment_public_jwk)),
        lambda reference: reference == payment_reference,
        True,
    )
    checkout_verify = client.verify_receipt(
        checkout_jwt,
        JWK.from_json(json.dumps(checkout_public_jwk)),
        lambda reference: reference == checkout_reference,
        False,
    )
    if payment_verify != {"verified": True}:
        raise SystemExit(f"AP2 payment receipt verification failed: {payment_verify}")
    if checkout_verify != {"verified": True}:
        raise SystemExit(f"AP2 checkout receipt verification failed: {checkout_verify}")

    return {
        "payment_jwt": payment_jwt,
        "checkout_jwt": checkout_jwt,
        "payment_public_jwk": payment_public_jwk,
        "checkout_public_jwk": checkout_public_jwk,
    }


def main() -> None:
    args = parse_args()
    add_import_paths(args.ap2_repo, args.vi_repo)

    vi = generate_vi_chain()
    receipts = generate_ap2_receipts(vi)

    trusted_issuer = with_kid(vi["issuer"].public_jwk, vi["issuer"].kid)
    evidence = {
        "ap2": {
            "paymentReceiptJwtParts": jwt_parts(receipts["payment_jwt"]),
            "checkoutReceiptJwtParts": jwt_parts(receipts["checkout_jwt"]),
            "closedPaymentMandate": vi["closed_payment"],
            "closedCheckoutMandate": vi["closed_checkout"],
        },
        "vi": {
            "credentials": [
                {"layer": "L1", "sdJwtParts": sd_jwt_parts(vi["l1"])},
                {"layer": "L2", "sdJwtParts": sd_jwt_parts(vi["l2"])},
                {
                    "layer": "L3_PAYMENT",
                    "sdJwtParts": sd_jwt_parts(vi["l3_payment"]),
                    "parentPresentationParts": sd_jwt_parts(vi["l2_payment_presentation"]),
                },
                {
                    "layer": "L3_CHECKOUT",
                    "sdJwtParts": sd_jwt_parts(vi["l3_checkout"]),
                    "parentPresentationParts": sd_jwt_parts(vi["l2_checkout_presentation"]),
                },
            ]
        },
        "trustedIssuerKeys": [trusted_issuer],
        "receiptJwtIssuers": [
            {
                "issuer": "https://www.mastercard.com",
                "jwks": {"keys": [receipts["payment_public_jwk"]]},
            },
            {
                "issuer": "https://tennis-warehouse.com",
                "jwks": {"keys": [receipts["checkout_public_jwk"]]},
            },
        ],
    }

    result = {
        "status": "success",
        "source": "agent-intent/verifiable-intent examples/autonomous_flow.py plus google-agentic-commerce/AP2 code/sdk/python",
        "payment_receipt_jwt_parts": jwt_parts(receipts["payment_jwt"]),
        "checkout_receipt_jwt_parts": jwt_parts(receipts["checkout_jwt"]),
    }

    metadata = {
        "source_repositories": [
            "https://github.com/google-agentic-commerce/AP2",
            "https://github.com/agent-intent/verifiable-intent",
        ],
        "ap2_source_commit": repo_commit(args.ap2_repo),
        "vi_source_commit": repo_commit(args.vi_repo),
        "source_paths": [
            "AP2/code/sdk/python/ap2/sdk/receipt_wrapper.py",
            "AP2/code/sdk/python/ap2/sdk/jwt_helper.py",
            "AP2/code/sdk/python/ap2/sdk/generated/payment_receipt.py",
            "AP2/code/sdk/python/ap2/sdk/generated/checkout_receipt.py",
            "verifiable-intent/examples/autonomous_flow.py",
            "verifiable-intent/examples/helpers.py",
            "verifiable-intent/src/verifiable_intent/issuance/issuer.py",
            "verifiable-intent/src/verifiable_intent/issuance/user.py",
            "verifiable-intent/src/verifiable_intent/issuance/agent.py",
            "verifiable-intent/src/verifiable_intent/verification/chain.py",
            "verifiable-intent/src/verifiable_intent/verification/constraint_checker.py",
        ],
        "now_seconds": NOW_SECONDS,
        "receipt_iat": RECEIPT_IAT,
        "notes": [
            "VI credentials are generated and verified with the official Verifiable Intent Python reference implementation.",
            "AP2 compact receipt JWTs are generated and verified with the official AP2 Python SDK.",
            "Committed fixtures store compact JWTs as segments to avoid false-positive secret scans; tests reassemble them before verifier use.",
            "The full AP2 service scenario remains opt-in because it needs external credentials.",
        ],
    }

    args.output_dir.mkdir(parents=True, exist_ok=True)
    write_json(args.output_dir / "ap2-vi-reference-result.json", result)
    write_json(args.output_dir / "ap2-vi-reference-evidence.json", evidence)
    write_json(args.output_dir / "ap2-vi-reference-metadata.json", metadata)


if __name__ == "__main__":
    main()
