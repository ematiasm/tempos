"""Tests for the /attributes endpoints."""

from fastapi.testclient import TestClient

from app.core.config import settings
from tests.utils.utils import random_lower_string


def _create_attribute(
    client: TestClient, headers: dict[str, str], values: list[str] | None = None
) -> dict:
    payload = {
        "name": random_lower_string()[:15],
        "values": values if values is not None else ["S", "M", "L"],
    }
    r = client.post(f"{settings.API_V1_STR}/attributes/", headers=headers, json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def test_create_and_list_attributes(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    created = _create_attribute(client, superuser_token_headers)
    assert [v["value"] for v in created["values"]] == ["S", "M", "L"]
    assert all(v["attribute_id"] == created["id"] for v in created["values"])

    r = client.get(
        f"{settings.API_V1_STR}/attributes/", headers=superuser_token_headers
    )
    assert r.status_code == 200
    ids = {row["id"] for row in r.json()["data"]}
    assert created["id"] in ids


def test_create_attribute_dedupes_blank_values(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    created = _create_attribute(
        client, superuser_token_headers, ["Red", " red ", "", "  "]
    )
    assert [v["value"] for v in created["values"]] == ["Red"]


def test_update_attribute_syncs_values(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    attribute = _create_attribute(client, superuser_token_headers)
    r = client.patch(
        f"{settings.API_V1_STR}/attributes/{attribute['id']}",
        headers=superuser_token_headers,
        json={"name": "Size", "values": ["S", "XL"]},
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["name"] == "Size"
    # M and L removed, XL created, S kept
    assert sorted(v["value"] for v in updated["values"]) == ["S", "XL"]
    kept_ids = {v["id"] for v in attribute["values"]}
    new_ids = {v["id"] for v in updated["values"]}
    s_value = next(v for v in updated["values"] if v["value"] == "S")
    assert s_value["id"] in kept_ids
    assert len(new_ids - kept_ids) == 1


def test_delete_attribute(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    attribute = _create_attribute(client, superuser_token_headers)
    r = client.delete(
        f"{settings.API_V1_STR}/attributes/{attribute['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    r = client.get(
        f"{settings.API_V1_STR}/attributes/", headers=superuser_token_headers
    )
    ids = {row["id"] for row in r.json()["data"]}
    assert attribute["id"] not in ids


def test_delete_attribute_in_use_by_variant_rejected(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    attribute = _create_attribute(client, superuser_token_headers, ["Red"])
    value_id = attribute["values"][0]["id"]

    # create a product and a variant using the attribute value
    uom_payload = {
        "name": random_lower_string()[:10],
        "abbreviation": random_lower_string()[:3].upper(),
        "decimal_places": 0,
    }
    r = client.post(
        f"{settings.API_V1_STR}/uoms/",
        headers=superuser_token_headers,
        json=uom_payload,
    )
    uom_id = r.json()["id"]
    product_payload = {
        "name": random_lower_string()[:20],
        "uom_id": uom_id,
        "tax_ids": [],
    }
    r = client.post(
        f"{settings.API_V1_STR}/products/",
        headers=superuser_token_headers,
        json=product_payload,
    )
    product_id = r.json()["id"]
    r = client.post(
        f"{settings.API_V1_STR}/products/{product_id}/variants",
        headers=superuser_token_headers,
        json={"product_id": product_id, "attribute_value_ids": [value_id]},
    )
    assert r.status_code == 200, r.text

    # deleting the attribute must be rejected
    r = client.delete(
        f"{settings.API_V1_STR}/attributes/{attribute['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 400
    assert "in use" in r.json()["detail"]

    # removing the used value via sync must also be rejected
    r = client.patch(
        f"{settings.API_V1_STR}/attributes/{attribute['id']}",
        headers=superuser_token_headers,
        json={"values": []},
    )
    assert r.status_code == 400
    assert "in use" in r.json()["detail"]


def test_attributes_forbidden_for_user_without_roles(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/attributes/", headers=normal_user_token_headers
    )
    assert r.status_code == 403
