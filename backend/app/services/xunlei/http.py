"""HTTP transport for Xunlei endpoints.

Ports the network tweaks found while reversing xunlei-pan-cli 3.23.3:
- `custom_host_to_ip` pinning (api-pan.xunlei.com -> 101.91.143.206) while keeping
  TLS SNI/certificate verification on the original hostname;
- IPv4 only connections (several ISPs drop IPv6 routes to the API);
- bounded retries with backoff for transient network failures.
"""

import asyncio
import logging
from collections.abc import Mapping
from typing import Any

import httpx

from app.core.errors import AppError
from app.schemas.settings import NetworkSettings

logger = logging.getLogger(__name__)

JsonObject = dict[str, Any]
QueryParams = Mapping[str, str | int] | list[tuple[str, str]] | None

IDEMPOTENT_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "DELETE", "PUT", "PATCH"})
RETRY_STATUSES = frozenset({500, 502, 503, 504})


class XunleiApiError(AppError):
    """Error payload returned by Xunlei (`error`, `error_description`)."""

    def __init__(self, status: int, error: str, description: str) -> None:
        if status == 401 or error in {"unauthenticated", "invalid_grant", "invalid_token"}:
            super().__init__("auth_failed", 401, description or None)
        else:
            mapped = status if status in {400, 403, 404, 409, 429} else 502
            super().__init__("xunlei_error", mapped, description or error or None)
        self.remote_status = status
        self.remote_error = error


def build_client(settings: NetworkSettings, *, keepalive: bool = True) -> httpx.AsyncClient:
    """Build an HTTP client; `keepalive=False` opens a fresh connection per request.

    CDN and OSS nodes silently drop idle connections, and reusing one fails with
    "Server disconnected without sending a response", so bulk transfers skip pooling.
    """
    timeout = httpx.Timeout(settings.request_timeout, connect=settings.connect_timeout)
    # local_address forces IPv4 sockets, matching the reference client's HAS_IPV6=False.
    transport = httpx.AsyncHTTPTransport(
        verify=settings.verify_tls,
        local_address="0.0.0.0",
        proxy=settings.proxy or None,
        retries=0,
        limits=httpx.Limits(max_keepalive_connections=None if keepalive else 0),
    )
    return httpx.AsyncClient(
        timeout=timeout,
        transport=transport,
        follow_redirects=True,
        headers={"User-Agent": settings.api_user_agent},
    )


def pin_host(
    url: httpx.URL, overrides: Mapping[str, str]
) -> tuple[httpx.URL, dict[str, str], dict[str, str]]:
    """Rewrite the URL to a pinned IP. Returns (url, extra headers, request extensions)."""
    host = url.host
    ip = overrides.get(host)
    if not ip:
        return url, {}, {}
    host_header = host if url.port in (None, 443, 80) else f"{host}:{url.port}"
    return url.copy_with(host=ip), {"Host": host_header}, {"sni_hostname": host}


async def send_with_retry(
    client: httpx.AsyncClient,
    settings: NetworkSettings,
    method: str,
    url: str,
    *,
    params: QueryParams = None,
    json: object | None = None,
    headers: Mapping[str, str] | None = None,
    content: bytes | None = None,
) -> httpx.Response:
    target, pinned_headers, extensions = pin_host(httpx.URL(url), settings.host_overrides)
    merged_headers = {**pinned_headers, **(headers or {})}
    attempts = settings.max_retries + 1
    idempotent = method.upper() in IDEMPOTENT_METHODS
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            request = client.build_request(
                method,
                target,
                params=_query(params),
                json=json,
                headers=merged_headers,
                content=content,
                extensions=extensions,
            )
            response = await client.send(request)
            if response.status_code in RETRY_STATUSES and idempotent and attempt < attempts - 1:
                await response.aclose()
                await _backoff(settings, attempt)
                continue
            return response
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as error:
            # Nothing reached the server, so even non-idempotent calls are safe to retry.
            last_error = error
        except (httpx.ReadTimeout, httpx.ReadError, httpx.RemoteProtocolError) as error:
            last_error = error
            if not idempotent:
                logger.warning(
                    "Xunlei request lost after sending %s %s: %r",
                    method,
                    httpx.URL(url).path,
                    error,
                )
                break
        logger.warning(
            "Xunlei request failed (attempt %d/%d) %s %s: %r",
            attempt + 1,
            attempts,
            method,
            httpx.URL(url).path,
            last_error,
        )
        if attempt < attempts - 1:
            await _backoff(settings, attempt)
    raise AppError("xunlei_unreachable", 503) from last_error


def _query(params: QueryParams) -> httpx.QueryParams | None:
    if params is None:
        return None
    if isinstance(params, Mapping):
        return httpx.QueryParams(params)
    return httpx.QueryParams(tuple(params))


async def _backoff(settings: NetworkSettings, attempt: int) -> None:
    await asyncio.sleep(settings.retry_backoff * (2**attempt))


def decode_json(response: httpx.Response) -> JsonObject:
    if not response.content:
        return {}
    try:
        data = response.json()
    except ValueError:
        data = {}
    if not isinstance(data, dict):
        data = {"data": data}
    if response.status_code >= 400:
        raise XunleiApiError(
            response.status_code,
            str(data.get("error", "")),
            str(data.get("error_description", "") or data.get("message", "")),
        )
    return data
