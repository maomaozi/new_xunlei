"""Aliyun OSS upload using the STS credentials returned by `POST /drive/v1/files`.

`xunlei-pan-cli` calls `bucket.PutObjectFromFile`; large files additionally use the
standard OSS multipart protocol so objects above the 5 GB single PUT limit work.
"""

import asyncio
import base64
import email.utils
import hashlib
import hmac
import logging
import re
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote
from xml.sax.saxutils import escape

import httpx

logger = logging.getLogger(__name__)

CONTENT_TYPE = "application/octet-stream"
READ_SIZE = 256 * 1024
# A stalled socket fails after a minute without progress and is retried by the caller.
STALL_TIMEOUT = httpx.Timeout(60, connect=20)


class OssError(RuntimeError):
    pass


@dataclass
class OssTarget:
    endpoint: str
    bucket: str
    key: str
    access_key_id: str
    access_key_secret: str
    security_token: str

    @classmethod
    def from_params(cls, params: dict[str, object]) -> "OssTarget":
        def text(name: str) -> str:
            return str(params.get(name) or "").strip()

        target = cls(
            endpoint=re.sub(r"^https?://", "", text("endpoint")).rstrip("/"),
            bucket=text("bucket"),
            key=text("key").lstrip("/"),
            access_key_id=text("access_key_id"),
            access_key_secret=text("access_key_secret"),
            security_token=text("security_token"),
        )
        if not all(vars(target).values()):
            raise OssError("incomplete OSS upload credentials")
        return target

    @property
    def url(self) -> str:
        return f"https://{self.bucket}.{self.endpoint}/{quote(self.key)}"

    def headers(self, method: str, sub_resource: str = "") -> dict[str, str]:
        date = email.utils.formatdate(usegmt=True)
        resource = f"/{self.bucket}/{self.key}{sub_resource}"
        content_type = CONTENT_TYPE if method in {"PUT", "POST"} else ""
        string_to_sign = (
            f"{method}\n\n{content_type}\n{date}\n"
            f"x-oss-security-token:{self.security_token}\n{resource}"
        )
        digest = hmac.new(
            self.access_key_secret.encode(), string_to_sign.encode(), hashlib.sha1
        ).digest()
        headers = {
            "Date": date,
            "x-oss-security-token": self.security_token,
            "Authorization": f"OSS {self.access_key_id}:{base64.b64encode(digest).decode()}",
        }
        if content_type:
            headers["Content-Type"] = content_type
        return headers


Progress = Callable[[int], None]
Cancelled = Callable[[], bool]


async def _file_chunks(
    path: Path, offset: int, length: int, progress: Progress, cancelled: Cancelled
) -> AsyncIterator[bytes]:
    handle = await asyncio.to_thread(path.open, "rb")
    try:
        await asyncio.to_thread(handle.seek, offset)
        remaining = length
        while remaining > 0:
            if cancelled():
                raise asyncio.CancelledError
            chunk = await asyncio.to_thread(handle.read, min(READ_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            progress(len(chunk))
            yield chunk
    finally:
        await asyncio.to_thread(handle.close)


def _check(response: httpx.Response, action: str) -> None:
    if response.status_code >= 300:
        code = re.search(r"<Code>(.*?)</Code>", response.text)
        raise OssError(
            f"OSS {action} failed: HTTP {response.status_code} {code.group(1) if code else ''}"
        )


async def put_object(
    client: httpx.AsyncClient,
    target: OssTarget,
    path: Path,
    progress: Progress,
    cancelled: Cancelled,
) -> None:
    size = path.stat().st_size
    headers = target.headers("PUT") | {"Content-Length": str(size)}
    response = await client.put(
        target.url,
        content=_file_chunks(path, 0, size, progress, cancelled),
        headers=headers,
        timeout=STALL_TIMEOUT,
    )
    _check(response, "put")


async def multipart_upload(
    client: httpx.AsyncClient,
    target: OssTarget,
    path: Path,
    part_size: int,
    concurrency: int,
    progress: Progress,
    cancelled: Cancelled,
    retries: int,
) -> None:
    size = path.stat().st_size
    response = await client.post(
        f"{target.url}?uploads", headers=target.headers("POST", "?uploads")
    )
    _check(response, "initiate multipart")
    match = re.search(r"<UploadId>(.*?)</UploadId>", response.text)
    if match is None:
        raise OssError("OSS initiate multipart returned no UploadId")
    upload_id = match.group(1)
    parts = [(index + 1, offset) for index, offset in enumerate(range(0, size, part_size))]
    etags: dict[int, str] = {}
    semaphore = asyncio.Semaphore(concurrency)

    async def upload_part(number: int, offset: int) -> None:
        length = min(part_size, size - offset)
        sub = f"?partNumber={number}&uploadId={upload_id}"
        async with semaphore:
            for attempt in range(retries + 1):
                sent = 0

                def track(n: int) -> None:
                    nonlocal sent
                    sent += n
                    progress(n)

                try:
                    part_response = await client.put(
                        f"{target.url}{sub}",
                        content=_file_chunks(path, offset, length, track, cancelled),
                        headers=target.headers("PUT", sub) | {"Content-Length": str(length)},
                        timeout=STALL_TIMEOUT,
                    )
                    _check(part_response, f"upload part {number}")
                    etags[number] = part_response.headers.get("ETag", "")
                    return
                except (httpx.HTTPError, OssError) as error:
                    progress(-sent)
                    if attempt >= retries:
                        raise
                    logger.warning("Retrying OSS part %d after error: %r", number, error)
                    await asyncio.sleep(1 + attempt)

    try:
        await asyncio.gather(*(upload_part(number, offset) for number, offset in parts))
    except BaseException:
        abort_sub = f"?uploadId={upload_id}"
        try:
            await client.delete(
                f"{target.url}{abort_sub}", headers=target.headers("DELETE", abort_sub)
            )
        except httpx.HTTPError:
            logger.warning("Failed to abort OSS multipart upload %s", upload_id)
        raise
    body = "".join(
        f"<Part><PartNumber>{n}</PartNumber><ETag>{escape(etags[n])}</ETag></Part>"
        for n, _ in parts
    )
    complete_sub = f"?uploadId={upload_id}"
    response = await client.post(
        f"{target.url}{complete_sub}",
        content=f"<CompleteMultipartUpload>{body}</CompleteMultipartUpload>".encode(),
        headers=target.headers("POST", complete_sub),
    )
    _check(response, "complete multipart")
