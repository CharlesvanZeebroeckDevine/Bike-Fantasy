from __future__ import annotations

import hashlib
from typing import Any, TypeVar

T = TypeVar("T")


def chunked(items: list[T], size: int) -> list[list[T]]:
    """Yield successive n-sized chunks from items."""
    return [items[i : i + size] for i in range(0, len(items), size)]


def stable_rider_slug(name: str, nationality: str | None = None) -> str:
    """
    Generate a stable slug for a rider if PCS URL is missing.
    Uses 'name|nationality' as base for hash (or 'name|' if no nationality).
    """
    base = f"{name}|{nationality or ''}".encode("utf-8")
    h = hashlib.sha1(base).hexdigest()[:12]
    return f"rider/{h}"


def derive_price_from_points(rank_points: int) -> int:
    """
    Pricing rule (Megabike):
    - price == PCS points from the configured ranking source.
    """
    return max(0, int(rank_points))
