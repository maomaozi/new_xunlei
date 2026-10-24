"""Local authentication of the xunlei-pan-cli engine (reversed from 3.23.3).

- `.drive/26ebb6810d1737970457e6a91cdbd3d2` holds the HMAC secret of the engine's local JWTs,
  AES-128-ECB encrypted with a fixed key (`svctoken.initTokenSecret`).
- JWT claims are `{"key": <scope>, "sub": <scope>, exp, iat, nbf}` signed with HS256
  (`svctoken.VerifyToken`). Local control routes accept scope `LocalToken` in the
  `LocalToken: LocalToken <jwt>` header; the full device/drive API accepts scope `UIAuth` in
  the `pan-auth` header and then asks the launcher to confirm it.
- The launcher answers `GET /launcher/auth` with `{"key": StaticKey(<pan-auth>)}` where
  `StaticKey` is an MD5 over the token interleaved with constants (`utils.StaticKey`).
"""

import base64
import hashlib
import hmac
import json
import time
from pathlib import Path

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

SECRET_FILE = "26ebb6810d1737970457e6a91cdbd3d2"
SECRET_KEY = b"08e8a6fbfba6fbd6"
LOCAL_SCOPE = "LocalToken"
UI_SCOPE = "UIAuth"

_STATIC_PARTS = (
    "-----BEGIN RSA PUBLIC KEY-----\nauthor: amaze\n\n"
    "MIGJAoGBAN6cY2gglwaKVpA6Tdws35nqSGLfAdOZkISXMSrzkMOmdJJa42YoqnE8\nvlhfCo8",
    "Objz+UQkdSbzzx3RkQCmUaN",
    "Y/WLVJ3tShXRrOmK71c3VB4BCf7YM9CP/A\nAldX3ldCwDy/QwvQyA/",
    "+N3vr2dqLYEb7Kqb20",
    "OMIoqAE3X",
    "m6hHFRAgMBAAE=\n-----",
    "jwenlndbvdijlakfjbioelkafjlksdjfkasncjkksd",
    "jkakldjgaiofnewljkladflkgjasdlf",
    "asdfaglkrlmfkojsldfjgklsd",
    "agjioehhfmkndbiuhfgwekjalkjgldfialkgjfld",
)


def read_secret(drive_dir: Path) -> bytes | None:
    """Decrypt the engine's JWT secret; None until the engine has created it."""
    try:
        data = (drive_dir / SECRET_FILE).read_bytes()
    except OSError:
        return None
    if not data or len(data) % 16:
        return None
    decryptor = Cipher(algorithms.AES(SECRET_KEY), modes.ECB()).decryptor()
    plain = decryptor.update(data) + decryptor.finalize()
    pad = plain[-1]
    if 1 <= pad <= 16 and plain.endswith(bytes([pad]) * pad):
        plain = plain[:-pad]
    return plain or None


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def sign_token(secret: bytes, scope: str, ttl: int = 3600, now: float | None = None) -> str:
    issued = int(now if now is not None else time.time())
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    claims = {"key": scope, "sub": scope, "exp": issued + ttl, "iat": issued, "nbf": issued}
    payload = f"{header}.{_b64(json.dumps(claims, separators=(',', ':')).encode())}"
    signature = hmac.new(secret, payload.encode(), hashlib.sha256).digest()
    return f"{payload}.{_b64(signature)}"


def static_key(token: str) -> str:
    """`utils.StaticKey`: md5("" + t + c0..c6 + t + c7 + c8 + t + c9 + t)."""
    p = _STATIC_PARTS
    text = token + "".join(p[:7]) + token + p[7] + p[8] + token + p[9] + token
    return hashlib.md5(text.encode()).hexdigest()
