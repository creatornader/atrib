#!/usr/bin/env python3
"""Generate AP2 reference receipt artifacts from the official Python SDK.

This script is intentionally opt-in. It imports `ap2` from a local checkout of
`google-agentic-commerce/AP2`, then writes fixture artifacts that the TypeScript
interop harness can verify without launching the full AP2 sample stack.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys

from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_AP2_REPO = Path("/tmp/google-ap2-reference")
DEFAULT_BASE_EVIDENCE = (
    REPO_ROOT / "packages/agent/test/fixtures/ap2/vi_autonomous_success_evidence.json"
)
DEFAULT_OUTPUT_DIR = REPO_ROOT / "packages/integration/test/fixtures/ap2-reference"

AP2_REFERENCE_PRIVATE_VALUE = int(
    "8148257353587924189659338712842645823841087893114875143627452571549447200317"
)
AP2_REFERENCE_KID = "official-ap2-reference-issuer"
AP2_REFERENCE_IAT = 1_779_840_030


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate AP2 receipt JWT artifacts with the official AP2 Python SDK."
    )
    parser.add_argument(
        "--ap2-repo",
        type=Path,
        default=DEFAULT_AP2_REPO,
        help="Path to a google-agentic-commerce/AP2 checkout.",
    )
    parser.add_argument(
        "--base-evidence",
        type=Path,
        default=DEFAULT_BASE_EVIDENCE,
        help="Base AP2 / VI evidence JSON whose VI chain and references should be reused.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory for generated JSON artifacts.",
    )
    return parser.parse_args()


def load_ap2_sdk(ap2_repo: Path) -> None:
    sdk_path = ap2_repo / "code/sdk/python"
    if not sdk_path.exists():
        raise SystemExit(f"AP2 SDK path does not exist: {sdk_path}")
    sys.path.insert(0, str(sdk_path))


def ap2_commit(ap2_repo: Path) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(ap2_repo), "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        return "unknown"


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def deterministic_jwk() -> tuple[Any, dict[str, Any]]:
    from cryptography.hazmat.primitives.asymmetric import ec
    from jwcrypto.jwk import JWK

    private_key = ec.derive_private_key(AP2_REFERENCE_PRIVATE_VALUE, ec.SECP256R1())
    jwk = JWK.from_pyca(private_key)
    private_jwk = json.loads(jwk.export())
    private_jwk["kid"] = AP2_REFERENCE_KID
    private_jwk["alg"] = "ES256"

    signer = JWK.from_json(json.dumps(private_jwk))
    public_jwk = json.loads(signer.export_public())
    public_jwk["kid"] = AP2_REFERENCE_KID
    public_jwk["alg"] = "ES256"
    return signer, public_jwk


def main() -> None:
    args = parse_args()
    load_ap2_sdk(args.ap2_repo)

    from ap2.sdk.generated.payment_mandate import PaymentMandate
    from ap2.sdk.generated.types.amount import Amount
    from ap2.sdk.generated.types.merchant import Merchant
    from ap2.sdk.generated.types.payment_instrument import PaymentInstrument
    from ap2.sdk.generated.types.pisp import PISP
    from ap2.sdk.jwt_helper import create_jwt
    from ap2.sdk.receipt_wrapper import ReceiptClient

    base_evidence = json.loads(args.base_evidence.read_text(encoding="utf-8"))
    base_ap2 = base_evidence["ap2"]
    base_payment = base_ap2["paymentReceipt"]
    base_checkout = base_ap2["checkoutReceipt"]

    signer, public_jwk = deterministic_jwk()
    client = ReceiptClient()

    payment_mandate = PaymentMandate(
        transaction_id="tx_reference_sdk_1",
        payee=Merchant(id="merchant_1", name="Demo Merchant"),
        payment_amount=Amount(amount=19900, currency="USD"),
        payment_instrument=PaymentInstrument(
            id="card_4242",
            type="card",
            description="Card ending in 4242",
        ),
        pisp=PISP(
            legal_name="Official AP2 Reference PISP LLC",
            brand_name="Official AP2 Reference PISP",
            domain_name=base_payment["iss"],
        ),
    )

    payment_receipt = client.create_payment_receipt(
        payment_mandate,
        base_payment["reference"],
    )
    payment_receipt.root.iat = AP2_REFERENCE_IAT
    payment_receipt.root.payment_id = "pay_reference_sdk_1"
    payment_receipt.root.psp_confirmation_id = "psp_reference_sdk_1"
    payment_receipt.root.network_confirmation_id = "net_reference_sdk_1"

    checkout_receipt = client.create_checkout_receipt(
        base_checkout["iss"],
        base_checkout["reference"],
        base_checkout["order_id"],
    )
    checkout_receipt.root.iat = AP2_REFERENCE_IAT

    header = {"alg": "ES256", "kid": AP2_REFERENCE_KID, "typ": "JWT"}
    payment_receipt_jwt = create_jwt(header, payment_receipt.model_dump(), signer)
    checkout_receipt_jwt = create_jwt(header, checkout_receipt.model_dump(), signer)

    from jwcrypto.jwk import JWK

    public_key = JWK.from_json(json.dumps(public_jwk))
    payment_verify = client.verify_receipt(
        payment_receipt_jwt,
        public_key,
        lambda reference: reference == base_payment["reference"],
        True,
    )
    checkout_verify = client.verify_receipt(
        checkout_receipt_jwt,
        public_key,
        lambda reference: reference == base_checkout["reference"],
        False,
    )
    if payment_verify != {"verified": True}:
        raise SystemExit(f"AP2 payment receipt failed SDK verification: {payment_verify}")
    if checkout_verify != {"verified": True}:
        raise SystemExit(f"AP2 checkout receipt failed SDK verification: {checkout_verify}")

    result_artifact = {
        "status": "success",
        "source": "google-agentic-commerce/AP2 code/sdk/python ap2.sdk.receipt_wrapper",
        "payment_receipt": payment_receipt_jwt,
        "checkout_receipt": checkout_receipt_jwt,
    }

    evidence_artifact = dict(base_evidence)
    evidence_artifact["ap2"] = dict(base_ap2)
    evidence_artifact["ap2"].pop("paymentReceipt", None)
    evidence_artifact["ap2"].pop("checkoutReceipt", None)
    evidence_artifact["ap2"]["paymentReceiptJwt"] = payment_receipt_jwt
    evidence_artifact["ap2"]["checkoutReceiptJwt"] = checkout_receipt_jwt
    evidence_artifact["receiptJwtIssuers"] = [
        {"issuer": base_payment["iss"], "jwks": {"keys": [public_jwk]}},
        {"issuer": base_checkout["iss"], "jwks": {"keys": [public_jwk]}},
    ]

    metadata = {
        "source_repository": "https://github.com/google-agentic-commerce/AP2",
        "source_commit": ap2_commit(args.ap2_repo),
        "source_paths": [
            "code/sdk/python/ap2/sdk/receipt_wrapper.py",
            "code/sdk/python/ap2/sdk/jwt_helper.py",
            "code/sdk/python/ap2/sdk/generated/payment_receipt.py",
            "code/sdk/python/ap2/sdk/generated/checkout_receipt.py",
        ],
        "base_evidence": str(args.base_evidence.relative_to(REPO_ROOT)),
        "receipt_iat": AP2_REFERENCE_IAT,
        "issuer_kid": AP2_REFERENCE_KID,
        "notes": [
            "Receipt JWTs are generated and verified with the official AP2 Python SDK.",
            "VI credentials come from atrib's deterministic AP2 / VI fixture corpus.",
            "The full AP2 sample stack still remains opt-in because it needs external credentials.",
        ],
    }

    args.output_dir.mkdir(parents=True, exist_ok=True)
    write_json(args.output_dir / "ap2-reference-result.json", result_artifact)
    write_json(args.output_dir / "ap2-reference-evidence.json", evidence_artifact)
    write_json(args.output_dir / "ap2-reference-metadata.json", metadata)


if __name__ == "__main__":
    main()
