"""Domain validation helpers."""

import re

_CUIT_WEIGHTS = (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)


def normalize_and_validate_documento(documento: str | None) -> str | None:
    """Normalize a counterparty document to bare digits and validate it.

    Accepted values: ``None``/blank (normalized to ``None``) or an 11-digit
    CUIT/CUIL with a valid modulo-11 check digit. Anything else — including
    DNIs, which are intentionally rejected until the future ARCA padron
    lookup can resolve them to a CUIT — raises ``ValueError``.
    """
    if documento is None:
        return None
    digits = re.sub(r"\D", "", documento)
    if not digits:
        return None
    if len(digits) != 11:
        raise ValueError("Document must be an 11-digit CUIT/CUIL")
    total = sum(int(d) * w for d, w in zip(digits[:10], _CUIT_WEIGHTS, strict=True))
    check = 11 - (total % 11)
    if check == 11:
        check = 0
    elif check == 10:
        check = 9
    if check != int(digits[10]):
        raise ValueError("Invalid CUIT/CUIL check digit")
    return digits
