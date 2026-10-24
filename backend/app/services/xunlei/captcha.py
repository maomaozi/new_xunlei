"""`captcha_sign` for `/v1/shield/captcha/init` and sub-file index compression.

Reversed from xunlei-pan-cli 3.23.3 (`oauth2client.ucisbewoax` at 0xeb0230): the input
`client_id + client_version + package_name + device_id + timestamp_ms` goes through ten
chained MD5 rounds, each appending one salt; the result is prefixed with `1.`.
"""

import hashlib
from collections.abc import Iterable

CAPTCHA_SALTS = (
    "W+5mUIeXtfShAKCuiVYMd9FSqaN",
    "dZ3U9FIJO9B7+ixitCXbyFqw6lmeWbPKN",
    "y5U1PftIgoWOzwPgmSX76XgK4XpIMIm",
    "kfPJQCIIce/rHdzHRgq6VK+Olqsv3mF",
    "pKmVYogwoBlk3fMRif0alim",
    "r6mfYT63FXpYm1VHJ3KYhiultp6d",
    "DRi/3AoyMQVDK/7juSrbCXPrMWR7wg10NA",
    "/OQt",
    "Lp1GViF",
    "4h8VTyj2EyzNS9hY8zojvtTjn0hP7h9Yrz",
)


def captcha_sign(
    client_id: str, client_version: str, package_name: str, device_id: str, timestamp_ms: int
) -> str:
    current = f"{client_id}{client_version}{package_name}{device_id}{timestamp_ms}"
    for salt in CAPTCHA_SALTS:
        current = hashlib.md5((current + salt).encode()).hexdigest()
    return f"1.{current}"


def compress_indexes(indexes: Iterable[int]) -> str:
    """`[0, 1, 2, 5]` -> `"0-2,5"`, the `sub_file_index` format of device tasks."""
    ranges: list[list[int]] = []
    for index in sorted(set(indexes)):
        if ranges and index == ranges[-1][1] + 1:
            ranges[-1][1] = index
        else:
            ranges.append([index, index])
    return ",".join(str(a) if a == b else f"{a}-{b}" for a, b in ranges)
