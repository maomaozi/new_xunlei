"""Read the running engine's access token without joining its refresh-token chain."""

import base64
import hashlib
import json
import time
import uuid
from typing import Any

import httpx
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from app.core.errors import AppError


async def read_access_token(http: httpx.AsyncClient, port: int) -> dict[str, Any]:
    timestamp = int(time.time())
    key = hashlib.md5(f"xllite_fetch:{timestamp}".encode()).hexdigest().encode()
    payload = json.dumps(
        {"call_id": uuid.uuid4().hex, "type": "action.get_token", "data": "", "timeout": 5}
    ).encode()
    padder = padding.PKCS7(128).padder()
    plain = padder.update(payload) + padder.finalize()
    encryptor = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
    try:
        response = await http.post(
            f"http://127.0.0.1:{port}/fetch",
            params={"xllite_t": timestamp},
            content=base64.b64encode(encryptor.update(plain) + encryptor.finalize()),
            headers={"Content-Type": "text/plain"},
            timeout=8,
        )
        response.raise_for_status()
        decryptor = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
        plain = decryptor.update(base64.b64decode(response.content, validate=True))
        plain += decryptor.finalize()
        unpadder = padding.PKCS7(128).unpadder()
        result = json.loads(unpadder.update(plain) + unpadder.finalize())
        if not isinstance(result, dict) or result.get("ret") != 1:
            raise ValueError("Invalid engine token response")
        data = result.get("data")
        data = json.loads(data) if isinstance(data, str) else data
        if not isinstance(data, dict):
            raise ValueError("Invalid engine credential payload")
    except (httpx.HTTPError, ValueError, TypeError) as error:
        raise AppError("engine_unavailable", 503, "无法读取下载引擎的登录状态。") from error
    return data
