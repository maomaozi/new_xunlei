"""Xunlei GCID, reversed from `commands.CalcGcidForBytePerFile` (0x174f230)."""

import hashlib
from collections.abc import Callable
from pathlib import Path

ProgressCallback = Callable[[int], None]


def gcid_block_size(size: int) -> int:
    if size <= 0x8000000:  # <= 128 MB
        return 0x40000  # 256 KB
    if size <= 0x10000000:  # <= 256 MB
        return 0x80000  # 512 KB
    if size <= 0x20000000:  # <= 512 MB
        return 0x100000  # 1 MB
    return 0x200000  # 2 MB


def calc_gcid(
    path: Path,
    progress: ProgressCallback | None = None,
    cancelled: Callable[[], bool] | None = None,
) -> str:
    """SHA1 over the concatenated SHA1 digests of fixed-size blocks, upper-case hex."""
    size = path.stat().st_size
    block_size = gcid_block_size(size)
    digests = hashlib.sha1()
    done = 0
    with path.open("rb") as handle:
        while chunk := handle.read(block_size):
            if cancelled is not None and cancelled():
                raise InterruptedError("gcid calculation cancelled")
            digests.update(hashlib.sha1(chunk).digest())
            done += len(chunk)
            if progress is not None:
                progress(done)
    return digests.hexdigest().upper()
