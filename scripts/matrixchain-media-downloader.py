#!/usr/bin/env python3
"""
matrixchain-media-downloader.py — Enjin Matrixchain Collection & Token Media Downloader

Downloads all collection and token media for a given Matrixchain wallet address.

Pipeline:
  Step 1  (Subscan)   Paginate /api/scan/multiTokens/list → filter owner client-side
  Step 2  (Subscan)   /api/scan/multiTokens/info → extract "uri" from attributes
  Step 3  (HTTP)      Fetch metadata JSON → extract media URL(s) → download
  Step 4  (RPC)       state_getKeysPaged on MultiTokens.Tokens(cid) → ALL token IDs
                      (including 0-balance / never-held tokens — impossible via Subscan)
  Step 5  (Subscan+)  /api/scan/multiTokens/items → pre-fetch metadata per token;
                      fall back to RPC MultiTokens.TokenAttributes for any gaps
  Step 6  (HTTP)      Fetch metadata JSON → extract media URL(s) → download

Output structure:
  <output_dir>/
    <address>/
      collections/
        <collection_id>/
          metadata.json
          media.<ext>
      tokens/
        <collection_id>/
          <token_id>/
            metadata.json
            media.<ext>

Usage:
    python matrixchain-media-downloader.py [ADDRESS] [options]

    Examples:
        python matrixchain-media-downloader.py ef1ABC...
        python matrixchain-media-downloader.py ef1ABC... --dry-run
        python matrixchain-media-downloader.py ef1ABC... --max-tokens 50
        python matrixchain-media-downloader.py ef1ABC... --collections-only
        python matrixchain-media-downloader.py ef1ABC... --attr-key uri --attr-key metadata

Requirements:
    pip install websockets certifi

Environment (.env loaded automatically from the script's own directory, or shell):
    SUBSCAN_API_KEY         Subscan API key (required)
    MATRIX_SUBSCAN_HOST     Subscan hostname  (default: matrix.api.subscan.io)
    MATRIX_RPC_ENDPOINT     Matrixchain archive WS (default: wss://archive.matrix.blockchain.enjin.io)
    IPFS_GATEWAY            IPFS HTTP gateway  (default: https://ipfs.io/ipfs/)
    OUTPUT_DIR              Root output dir    (default: <script_dir>/output)

Confirmed Subscan endpoints (matrix.api.subscan.io):
    POST /api/scan/multiTokens/list    — all collections (no server-side owner filter)
    POST /api/scan/multiTokens/info    — one collection; returns attributes[] with uri
    POST /api/scan/multiTokens/items   — paginated tokens for a collection (+ metadata)
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import http.client
import json
import mimetypes
import os
import ssl
import struct
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

# ── dotenv: auto-load from script dir, then walk up to repo root ──────────────

_SCRIPT_DIR = Path(__file__).parent.resolve()


def _load_dotenv_file(path: Path) -> None:
    """Minimal .env parser — no third-party packages required.

    Handles:  KEY=value  KEY="value"  KEY='value'  # comments  blank lines
    Sets variables into os.environ (override=True semantics).
    """
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        # Strip inline comment (outside quotes)
        if val and val[0] not in ('"', "'"):
            val = val.partition(" #")[0].partition("\t#")[0].strip()
        # Strip matching surrounding quotes
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
            val = val[1:-1]
        if key:
            os.environ[key] = val


# Walk up from the script's directory until a .env file is found.
_env_candidate = _SCRIPT_DIR
while True:
    _dotenv_path = _env_candidate / ".env"
    if _dotenv_path.exists():
        _load_dotenv_file(_dotenv_path)
        break
    _parent = _env_candidate.parent
    if _parent == _env_candidate:       # reached filesystem root — give up
        break
    _env_candidate = _parent
del _env_candidate, _dotenv_path

# ── Optional dependencies ──────────────────────────────────────────────────────

try:
    import websockets
except ImportError:
    print("ERROR: 'websockets' package not found.  Install: pip install websockets")
    sys.exit(1)

try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CTX = ssl.create_default_context()

# ── Configuration ──────────────────────────────────────────────────────────────

MATRIX_RPC_ENDPOINT = os.getenv(
    "MATRIX_RPC_ENDPOINT", "wss://archive.matrix.blockchain.enjin.io"
)
MATRIX_SUBSCAN_HOST = os.getenv("MATRIX_SUBSCAN_HOST", "matrix.api.subscan.io")
SUBSCAN_API_KEY     = os.getenv("SUBSCAN_API_KEY", "")
IPFS_GATEWAY        = os.getenv("IPFS_GATEWAY", "https://ipfs.io/ipfs/").rstrip("/") + "/"
OUTPUT_DIR_DEFAULT  = os.getenv("OUTPUT_DIR", str(_SCRIPT_DIR / "output"))

MATRIX_SS58_PREFIX  = 1110
BASE58_ALPHABET     = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
KEYS_PAGE_SIZE      = 500        # keys per state_getKeysPaged page
SUBSCAN_ROW         = 100        # results per Subscan page
SUBSCAN_MAX_RETRIES = 3
SUBSCAN_RETRY_DELAY = 5
SUBSCAN_INTER_REQ   = 0.35       # seconds between Subscan calls (avoid 429)
RPC_TIMEOUT_S       = 30
HTTP_TIMEOUT_S      = 30

W = 78   # banner width


# ══════════════════════════════════════════════════════════════════════════════
#  DISPLAY
# ══════════════════════════════════════════════════════════════════════════════

def header(title: str):
    print(f"\n{'═' * W}\n  {title}\n{'═' * W}")

def section(msg: str):
    print(f"\n  ▸ {msg}")

def info(msg: str):
    print(f"      {msg}")

def ok(msg: str):
    print(f"      ✓  {msg}")

def warn(msg: str):
    print(f"      ⚠  {msg}")

def fail(msg: str):
    print(f"      ✗  {msg}", file=sys.stderr)


# ══════════════════════════════════════════════════════════════════════════════
#  HASHING PRIMITIVES  (mirrors src/utils/substrate.js)
# ══════════════════════════════════════════════════════════════════════════════

def _xxh64(data: bytes, seed: int) -> int:
    P1=0x9E3779B185EBCA87; P2=0xC2B2AE3D27D4EB4F; P3=0x165667B19E3779F9
    P4=0x85EBCA77C2B2AE63; P5=0x27D4EB2F165667C5; M=0xFFFFFFFFFFFFFFFF
    lo=lambda x:x&M; mul=lambda a,b:lo(a*b); add=lambda a,b:lo(a+b)
    rotl=lambda x,r:lo((x<<r)|(x>>(64-r)))
    n=len(data); p=0; s=seed&M
    if n>=32:
        v1=add(add(s,P1),P2); v2=add(s,P2); v3=s; v4=lo(s-P1)
        while p<=n-32:
            for vi_i,vi in enumerate([v1,v2,v3,v4]):
                lane=int.from_bytes(data[p:p+8],"little")
                vi=mul(rotl(add(vi,mul(lane,P2)),31),P1)
                if vi_i==0: v1=vi
                elif vi_i==1: v2=vi
                elif vi_i==2: v3=vi
                else: v4=vi
                p+=8
        h=add(add(add(rotl(v1,1),rotl(v2,7)),rotl(v3,12)),rotl(v4,18))
        for vi in [v1,v2,v3,v4]:
            h=add(mul(lo(h^mul(rotl(mul(vi,P2),31),P1)),P1),P4)
    else:
        h=add(s,P5)
    h=add(h,n)
    while p<=n-8:
        lane=int.from_bytes(data[p:p+8],"little")
        h=add(mul(rotl(lo(h^mul(rotl(mul(lane,P2),31),P1)),27),P1),P4); p+=8
    if p<=n-4:
        lane=int.from_bytes(data[p:p+4],"little")
        h=add(mul(rotl(lo(h^mul(lane,P1)),23),P2),P3); p+=4
    while p<n:
        h=mul(rotl(lo(h^mul(data[p],P5)),11),P1); p+=1
    h=mul(lo(h^(h>>33)),P2); h=mul(lo(h^(h>>29)),P3)
    return lo(h^(h>>32))


def _twox128(text: str) -> bytes:
    b = text.encode("utf-8")
    return _xxh64(b,0).to_bytes(8,"little") + _xxh64(b,1).to_bytes(8,"little")


def _b128concat(key_bytes: bytes) -> bytes:
    return hashlib.blake2b(key_bytes, digest_size=16).digest() + key_bytes


def _u128_le(n: int) -> bytes:
    return n.to_bytes(16, "little")


def _scale_encode_bytes(b: bytes) -> bytes:
    """SCALE-encode a byte vector: compact(len) ++ raw bytes."""
    n = len(b)
    if n < 64:          return bytes([n << 2]) + b
    if n < (1 << 14):  return struct.pack("<H", (n << 2) | 0b01) + b
    if n < (1 << 30):  return struct.pack("<I", (n << 2) | 0b10) + b
    raise ValueError(f"Cannot compact-encode length {n}")


# ══════════════════════════════════════════════════════════════════════════════
#  SS58  (mirrors substrate.js ss58Decode / ss58Encode)
# ══════════════════════════════════════════════════════════════════════════════

def _b58_decode(s: str) -> bytes:
    n = 0
    for c in s:
        i = BASE58_ALPHABET.find(c)
        if i < 0: raise ValueError(f"Invalid Base58 char: {c!r}")
        n = n * 58 + i
    result = []
    while n > 0: result.append(n & 0xFF); n >>= 8
    result.reverse()
    leading = len(s) - len(s.lstrip("1"))
    return bytes(leading) + bytes(result)


def ss58_decode(address: str) -> bytes:
    raw = _b58_decode(address)
    if len(raw) < 35:
        raise ValueError(f"Address too short ({len(raw)} bytes)")
    pfx_len = 2 if (raw[0] & 0x40) else 1
    pub = raw[pfx_len : pfx_len + 32]
    expected = hashlib.blake2b(b"SS58PRE" + raw[:-2], digest_size=64).digest()[:2]
    if raw[-2:] != expected:
        raise ValueError("SS58 checksum mismatch")
    return pub


def ss58_encode(pub: bytes, prefix: int) -> str:
    if prefix < 64:
        pfx = bytes([prefix])
    else:
        pfx = bytes([((prefix >> 2) & 0x3F) | 0x40,
                     ((prefix & 0x03) << 6) | ((prefix >> 8) & 0x3F)])
    payload  = pfx + pub
    checksum = hashlib.blake2b(b"SS58PRE" + payload, digest_size=64).digest()[:2]
    raw = payload + checksum
    n = int.from_bytes(raw, "big")
    chars = []
    while n > 0: n, r = divmod(n, 58); chars.append(BASE58_ALPHABET[r])
    chars.reverse()
    leading = len(raw) - len(raw.lstrip(b"\x00"))
    return "1" * leading + "".join(chars)


# ══════════════════════════════════════════════════════════════════════════════
#  STORAGE KEY BUILDERS  (for RPC fallback on token attributes)
# ══════════════════════════════════════════════════════════════════════════════

def build_collection_attr_key(cid: int, attr_key: bytes = b"uri") -> str:
    """
    MultiTokens.CollectionAttributes(cid, attr_key) — 84-byte storage key.
      twox128("MultiTokens")             [16]
      twox128("CollectionAttributes")    [16]
      Blake2_128Concat(u128_le(cid))     [32]
      Blake2_128Concat(scale(attr_key))  [16 + 1 + len(attr_key)]
    """
    return "0x" + (
        _twox128("MultiTokens")
        + _twox128("CollectionAttributes")
        + _b128concat(_u128_le(cid))
        + _b128concat(_scale_encode_bytes(attr_key))
    ).hex()


def build_token_attr_key(cid: int, tid: int, attr_key: bytes = b"uri") -> str:
    """
    MultiTokens.TokenAttributes(cid, tid, attr_key) — 116-byte storage key.
      twox128("MultiTokens")             [16]
      twox128("TokenAttributes")         [16]
      Blake2_128Concat(u128_le(cid))     [32]
      Blake2_128Concat(u128_le(tid))     [32]
      Blake2_128Concat(scale(attr_key))  [16 + 1 + len(attr_key)]
    """
    return "0x" + (
        _twox128("MultiTokens")
        + _twox128("TokenAttributes")
        + _b128concat(_u128_le(cid))
        + _b128concat(_u128_le(tid))
        + _b128concat(_scale_encode_bytes(attr_key))
    ).hex()


def build_tokens_prefix_for_collection(cid: int) -> str:
    """
    64-byte prefix for all MultiTokens.Tokens(cid, *).
    Pass to state_getKeysPaged — enumerates every token ID in the collection,
    including those with 0 supply, which Subscan /items may omit.
    """
    return "0x" + (
        _twox128("MultiTokens")
        + _twox128("Tokens")
        + _b128concat(_u128_le(cid))
    ).hex()


def token_id_from_tokens_key(key_hex: str) -> int | None:
    """Extract tokenId from bytes [80:96] of a 96-byte MultiTokens.Tokens key."""
    s = key_hex[2:] if key_hex.startswith("0x") else key_hex
    if len(s) < 192: return None
    return int.from_bytes(bytes.fromhex(s[160:192]), "little")


# ══════════════════════════════════════════════════════════════════════════════
#  SCALE ATTRIBUTE VALUE DECODER  (RPC fallback)
# ══════════════════════════════════════════════════════════════════════════════

def decode_attr_uri(raw_hex: str | None) -> str | None:
    """
    Decode a URI from a SCALE-encoded pallet-multi-tokens Attribute value.

    Attribute { value: BoundedVec<u8>, deposit: Balance, ... }
    The 'value' field is first: compact(len) + UTF-8 bytes.
    """
    if not raw_hex or raw_hex in (None, "0x", ""):
        return None
    try:
        raw = bytes.fromhex(raw_hex[2:] if raw_hex.startswith("0x") else raw_hex)
    except ValueError:
        return None
    if not raw:
        return None
    mode = raw[0] & 0b11
    if   mode == 0: length, offset = raw[0] >> 2, 1
    elif mode == 1: length, offset = struct.unpack("<H", raw[0:2])[0] >> 2, 2
    elif mode == 2: length, offset = struct.unpack("<I", raw[0:4])[0] >> 2, 4
    else:
        n = (raw[0] >> 2) + 4
        if 1 + n > len(raw): return None
        length, offset = int.from_bytes(raw[1:1+n], "little"), 1 + n
    if offset + length > len(raw):
        return None
    try:
        uri = raw[offset : offset + length].decode("utf-8").strip()
        return uri if uri else None
    except UnicodeDecodeError:
        return None


# ══════════════════════════════════════════════════════════════════════════════
#  SUBSCAN API  (Steps 1, 2, 5)
# ══════════════════════════════════════════════════════════════════════════════

def _subscan_post(path: str, body: dict,
                  retries: int = SUBSCAN_MAX_RETRIES) -> dict | None:
    """POST to matrix.api.subscan.io and return response['data'], or None."""
    payload = json.dumps(body).encode()
    headers = {"Content-Type": "application/json", "X-API-Key": SUBSCAN_API_KEY}
    for attempt in range(retries):
        conn = None
        try:
            conn = http.client.HTTPSConnection(
                MATRIX_SUBSCAN_HOST, timeout=HTTP_TIMEOUT_S, context=_SSL_CTX
            )
            conn.request("POST", path, payload, headers)
            resp = conn.getresponse()
            if resp.status == 429:
                wait = int(resp.getheader("Retry-After", SUBSCAN_RETRY_DELAY))
                info(f"Rate limited — waiting {wait}s…")
                time.sleep(wait)
                continue
            if resp.status != 200:
                fail(f"HTTP {resp.status} from {path}")
                return None
            data = json.loads(resp.read().decode())
            if data.get("code") != 0:
                fail(f"Subscan error {data.get('code')}: {data.get('message','?')}")
                return None
            return data.get("data")
        except Exception as exc:
            fail(f"Subscan request failed (attempt {attempt+1}/{retries}): {exc}")
            if attempt < retries - 1:
                time.sleep(SUBSCAN_RETRY_DELAY)
        finally:
            if conn: conn.close()
    return None


def fetch_collections_by_owner(address: str) -> list[int]:
    """
    Step 1 — Find all collection IDs where owner.address == address.

    The Subscan /list endpoint does not support server-side owner filtering,
    so we paginate the full collection list and filter client-side.
    As of testing, matrix.api.subscan.io has ~2 400 total collections
    (~24 pages at row=100), which completes in under 15 seconds.
    """
    header("STEP 1 — Find Collections Owned by Address  (Subscan)")
    section(f"Address : {address}")
    section(f"Host    : {MATRIX_SUBSCAN_HOST}")
    section("Paginating /api/scan/multiTokens/list (filter by owner client-side)…")

    address_lower   = address.lower()
    collection_ids: list[int] = []
    page            = 0
    total_from_api  = None

    while True:
        time.sleep(SUBSCAN_INTER_REQ)
        data = _subscan_post("/api/scan/multiTokens/list", {"page": page, "row": SUBSCAN_ROW})
        if data is None:
            fail("Subscan /list failed — cannot continue.")
            break

        if total_from_api is None:
            total_from_api = data.get("count", 0)
            pages_needed   = (total_from_api + SUBSCAN_ROW - 1) // SUBSCAN_ROW
            info(f"Total collections on chain: {total_from_api}  ({pages_needed} pages to scan)")

        items = data.get("list") or []
        matched_this_page = 0

        for item in items:
            owner_block = item.get("owner") or {}
            # owner field may be a dict {"address": "ef..."} or a plain string
            if isinstance(owner_block, dict):
                owner_addr = (owner_block.get("address") or "").lower()
            else:
                owner_addr = str(owner_block).lower()

            if owner_addr == address_lower:
                raw_cid = item.get("collection_id") or item.get("id")
                if raw_cid is not None:
                    try:
                        collection_ids.append(int(raw_cid))
                        matched_this_page += 1
                    except (ValueError, TypeError):
                        pass

        info(f"Page {page:3d}: {len(items):3d} items, "
             f"{matched_this_page} matched "
             f"(running total: {len(collection_ids)})")

        fetched_so_far = (page + 1) * SUBSCAN_ROW
        if not items or len(items) < SUBSCAN_ROW or fetched_so_far >= (total_from_api or 0):
            break
        page += 1

    collection_ids = sorted(set(collection_ids))
    if collection_ids:
        ok(f"Found {len(collection_ids)} collection(s) owned by this address: "
           f"{collection_ids}")
    else:
        warn("No collections found for this address.")
    return collection_ids


def fetch_collection_uri(cid: int, attr_keys: list[bytes]) -> str | None:
    """
    Step 2 — Fetch the metadata URI for a collection via Subscan /info.

    /info returns an 'attributes' array of {"key": ..., "val": ...} objects.
    We look for an attribute whose key matches any of attr_keys (decoded as UTF-8).
    Falls back to metadata.image if no URI attribute is found.
    """
    time.sleep(SUBSCAN_INTER_REQ)
    data = _subscan_post("/api/scan/multiTokens/info", {"collection_id": str(cid)})
    if not data:
        return None

    attr_key_strs = [k.decode("utf-8", errors="replace") for k in attr_keys]

    for attr in (data.get("attributes") or []):
        key = str(attr.get("key") or "").strip()
        if key in attr_key_strs:
            val = str(attr.get("val") or "").strip()
            if val:
                return val

    # Fallback: use pre-fetched metadata.image from Subscan's own index
    meta = data.get("metadata") or {}
    for field in ("external_url", "image", "animation_url"):
        v = meta.get(field)
        if v:
            info(f"No '{attr_key_strs[0]}' attribute — using metadata.{field} from Subscan index")
            return str(v)

    return None


def fetch_all_token_metadata_subscan(cid: int) -> dict[int, dict]:
    """
    Step 5 helper — Pre-load all token metadata from Subscan /items.

    Returns a dict mapping token_id (int) → metadata (dict), e.g.:
        {25: {"name": "…", "image": "ipfs://…"}, …}

    Used as a fast-path lookup before falling back to RPC attribute queries.
    Note: /items may not list tokens with 0 supply — those are found via RPC
    key enumeration in Step 4 and will simply have no entry in this dict.
    """
    result: dict[int, dict] = {}
    page = 0
    while True:
        time.sleep(SUBSCAN_INTER_REQ)
        data = _subscan_post("/api/scan/multiTokens/items",
                             {"collection_id": str(cid), "page": page, "row": SUBSCAN_ROW})
        if not data:
            break
        items = data.get("list") or []
        for item in items:
            raw_tid = item.get("item_id") or item.get("token_id")
            meta    = item.get("metadata") or {}
            if raw_tid is not None:
                try:
                    result[int(raw_tid)] = meta
                except (ValueError, TypeError):
                    pass
        total = data.get("count", 0)
        fetched = (page + 1) * SUBSCAN_ROW
        if not items or len(items) < SUBSCAN_ROW or fetched >= total:
            break
        page += 1
    return result


# ══════════════════════════════════════════════════════════════════════════════
#  JSON-RPC HELPER  (Step 4 key enumeration + Step 5 attribute fallback)
# ══════════════════════════════════════════════════════════════════════════════

async def rpc_call(ws, req_id: int, method: str, params: list) -> object:
    req = {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}
    await asyncio.wait_for(ws.send(json.dumps(req)), timeout=RPC_TIMEOUT_S)
    raw  = await asyncio.wait_for(ws.recv(), timeout=RPC_TIMEOUT_S)
    resp = json.loads(raw)
    if resp.get("id") != req_id:
        raise RuntimeError(f"RPC id mismatch: sent {req_id}, got {resp.get('id')}")
    if "error" in resp:
        raise RuntimeError(f"RPC error on {method!r}: {resp['error']}")
    return resp.get("result")


class ReconnectingRPC:
    """
    Thin wrapper around a websockets connection that transparently reconnects
    on ConnectionClosed and retries the failed call.  Each instance maintains
    its own monotonic request-id counter.
    """

    def __init__(self, endpoint: str, ssl_ctx):
        self._endpoint = endpoint
        self._ssl_ctx  = ssl_ctx
        self._ws       = None
        self._req_id   = 0

    async def _connect(self):
        self._ws = await websockets.connect(self._endpoint, ssl=self._ssl_ctx)

    async def call(self, method: str, params: list, *, retries: int = 3) -> object:
        for attempt in range(retries):
            try:
                if self._ws is None:
                    await self._connect()
                self._req_id += 1
                return await rpc_call(self._ws, self._req_id, method, params)
            except (websockets.exceptions.ConnectionClosed, ConnectionResetError):
                self._ws = None
                if attempt == retries - 1:
                    raise
                await asyncio.sleep(1)

    async def close(self):
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None


async def get_all_keys_paged(prefix: str) -> list[str]:
    """
    Paginate state_getKeysPaged for a storage prefix, reconnecting if the
    server closes the WebSocket mid-scan (common on archive nodes for large
    key sets).  Resumes from the last received key so no data is lost.

    Note: no block-hash parameter — reflects current (or near-current) state.
    Use state_getStorage with an explicit hash for consistent value reads.
    """
    keys: list[str] = []
    start_key: str | None = None
    req_id = 0

    while True:                         # outer loop: reconnect on close
        try:
            async with websockets.connect(MATRIX_RPC_ENDPOINT, ssl=_SSL_CTX) as ws:
                while True:             # inner loop: paginate pages
                    req_id += 1
                    params = [prefix, KEYS_PAGE_SIZE]
                    if start_key:
                        params.append(start_key)
                    page_keys = await rpc_call(ws, req_id, "state_getKeysPaged", params)
                    if not isinstance(page_keys, list) or not page_keys:
                        return keys
                    keys.extend(page_keys)
                    if len(page_keys) < KEYS_PAGE_SIZE:
                        return keys
                    start_key = page_keys[-1]
        except websockets.exceptions.ConnectionClosed:
            info(f"  WebSocket closed during key scan — reconnecting "
                 f"(have {len(keys)} keys so far, resuming from last)…")
            await asyncio.sleep(1)


# ══════════════════════════════════════════════════════════════════════════════
#  MEDIA / METADATA HELPERS  (Steps 3 & 6)
# ══════════════════════════════════════════════════════════════════════════════

def resolve_uri(uri: str) -> str:
    if uri.startswith("ipfs://"):   return IPFS_GATEWAY + uri[7:]
    if uri.startswith("ar://"):     return f"https://arweave.net/{uri[5:]}"
    return uri


def apply_id_template(uri: str, cid: int, tid: int) -> str:
    """
    Replace the ERC-1155 {id} placeholder with <collection_id>-<token_id>.

    The Enjin Platform sometimes sets a collection-level metadata URI that
    is a template rather than a concrete URL, e.g.:
        ipfs://Qm…/{id}.json
    For each token the placeholder is expanded to the composite identifier
    used on Enjin Matrixchain: "<collection_id>-<token_id>".
    """
    return uri.replace("{id}", f"{cid}-{tid}")


def _fetch_bytes(url: str) -> tuple[bytes, str] | tuple[None, None]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "EnjinSight/1.0"})
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S, context=_SSL_CTX) as r:
            ct = r.getheader("Content-Type", "").split(";")[0].strip()
            return r.read(), ct
    except Exception as exc:
        fail(f"HTTP fetch failed: {exc}")
        return None, None


_CT_EXT = {
    "image/png":".png","image/jpeg":".jpg","image/gif":".gif",
    "image/webp":".webp","image/svg+xml":".svg","image/avif":".avif",
    "video/mp4":".mp4","video/webm":".webm","video/quicktime":".mov",
    "audio/mpeg":".mp3","audio/wav":".wav","audio/ogg":".ogg",
    "model/gltf-binary":".glb","model/gltf+json":".gltf",
    "application/octet-stream":".bin","application/json":".json",
}


def _guess_ext(url: str, ct: str) -> str:
    _, ext = os.path.splitext(urllib.parse.urlparse(url).path)
    if ext: return ext.lower()
    return _CT_EXT.get(ct) or mimetypes.guess_extension(ct) or ".bin"


def extract_media_urls(metadata: dict) -> list[str]:
    """Extract all media URLs from a parsed metadata dict (multiple standard formats)."""
    urls: list[str] = []
    seen: set[str]  = set()
    def add(u):
        if u and u not in seen: urls.append(u); seen.add(u)
    for m in (metadata.get("media") or []):           # Enjin format
        if isinstance(m, dict): add(m.get("url") or m.get("uri") or m.get("src"))
    add(metadata.get("image") or metadata.get("image_url"))
    add(metadata.get("animation_url") or metadata.get("animation"))
    add(metadata.get("video_url"))
    return urls


def process_metadata_uri(uri: str, dest_dir: Path, file_prefix: str,
                         label: str = "") -> int:
    """
    Fetch the metadata JSON at uri, write <file_prefix>.json, download media.

    Files are saved flat inside dest_dir:
        <file_prefix>.json          — metadata
        <file_prefix>.<ext>         — primary media
        <file_prefix>_1.<ext>       — second media asset (if any)
        <file_prefix>_2.<ext>       — third, etc.

    Returns the number of media files saved.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    url = resolve_uri(uri)
    info(f"{label}metadata → {url}")
    body, ct = _fetch_bytes(url)
    if body is None: return 0

    try:
        metadata = json.loads(body)
    except Exception:
        warn(f"{label}Not JSON — saving as {file_prefix}.bin")
        (dest_dir / f"{file_prefix}.bin").write_bytes(body)
        return 0

    with open(dest_dir / f"{file_prefix}.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)

    media_urls = extract_media_urls(metadata)
    if not media_urls:
        warn(f"{label}No media URLs in metadata (keys: {list(metadata.keys())[:8]})")
        return 0

    downloaded = 0
    for idx, murl in enumerate(media_urls):
        murl_https = resolve_uri(murl)
        info(f"{label}media[{idx}] → {murl_https}")
        mdata, mct = _fetch_bytes(murl_https)
        if mdata is None: continue
        suffix   = f"_{idx}" if idx > 0 else ""
        filename = f"{file_prefix}{suffix}{_guess_ext(murl_https, mct)}"
        (dest_dir / filename).write_bytes(mdata)
        ok(f"{label}saved {filename}  ({len(mdata)/1024:.1f} KB)")
        downloaded += 1
    return downloaded


def process_subscan_metadata(meta: dict, dest_dir: Path, file_prefix: str,
                              label: str = "") -> int:
    """
    Like process_metadata_uri but starts from a pre-parsed metadata dict
    already returned by Subscan (no URI fetch needed).
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    with open(dest_dir / f"{file_prefix}.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    media_urls = extract_media_urls(meta)
    if not media_urls:
        warn(f"{label}No media URLs in Subscan metadata")
        return 0

    downloaded = 0
    for idx, murl in enumerate(media_urls):
        murl_https = resolve_uri(murl)
        info(f"{label}media[{idx}] → {murl_https}")
        mdata, mct = _fetch_bytes(murl_https)
        if mdata is None: continue
        suffix   = f"_{idx}" if idx > 0 else ""
        filename = f"{file_prefix}{suffix}{_guess_ext(murl_https, mct)}"
        (dest_dir / filename).write_bytes(mdata)
        ok(f"{label}saved {filename}  ({len(mdata)/1024:.1f} KB)")
        downloaded += 1
    return downloaded


# ══════════════════════════════════════════════════════════════════════════════
#  MAIN PIPELINE
# ══════════════════════════════════════════════════════════════════════════════

async def run(
    address:          str,
    output_dir:       Path,
    attr_keys:        list[bytes],
    max_tokens:       int | None,
    collections_only: bool,
    dry_run:          bool,
):
    # ── Step 1 ─────────────────────────────────────────────────────────────────
    collection_ids = fetch_collections_by_owner(address)
    if not collection_ids:
        print("\nNo collections found — nothing to download.")
        return

    # Single flat folder named after the wallet address
    addr_dir = output_dir / address
    addr_dir.mkdir(parents=True, exist_ok=True)
    stats    = dict(coll_with_media=0, tokens_found=0,
                    tokens_with_media=0, files=0)

    # ── Steps 2-3: collection metadata ────────────────────────────────────────
    header("STEPS 2–3 — Collection Metadata URI → Download Media  (Subscan + HTTP)")

    coll_uris: dict[int, str | None] = {}
    for cid in collection_ids:
        section(f"Collection {cid}")
        uri = fetch_collection_uri(cid, attr_keys)
        coll_uris[cid] = uri
        if not uri:
            warn(f"No metadata URI found for collection {cid}")
        elif "{id}" in uri:
            info(f"URI: {uri}")
            info("Template URI detected — {id} will be expanded per token as <cid>-<tid>")
        else:
            info(f"URI: {uri}")
            if dry_run:
                info(f"[dry-run] would save {cid}.json + {cid}.<ext>")
            else:
                n = process_metadata_uri(uri, addr_dir, file_prefix=str(cid),
                                         label=f"[coll {cid}] ")
                if n: stats["coll_with_media"] += 1; stats["files"] += n

    if collections_only:
        _print_summary(collection_ids, stats, addr_dir, dry_run)
        return

    # ── Steps 4-6: enumerate tokens + download media ───────────────────────────
    header("STEPS 4–6 — Token Enumeration (RPC) + Metadata (Subscan+RPC) + Download")
    section(f"Connecting to archive node: {MATRIX_RPC_ENDPOINT}")

    rpc = ReconnectingRPC(MATRIX_RPC_ENDPOINT, _SSL_CTX)
    try:
        chain_hdr = await rpc.call("chain_getHeader", [])
        head_blk  = int(chain_hdr["number"], 16)
        head_hash = await rpc.call("chain_getBlockHash", [head_blk])
        ok(f"Connected — head block #{head_blk:,}  ({head_hash[:18]}…)")

        for cid in collection_ids:
            section(f"Collection {cid} — token enumeration")

            # Step 4: RPC key scan — finds ALL token IDs regardless of supply/balance.
            # get_all_keys_paged opens its own connection and reconnects on close.
            tok_prefix = build_tokens_prefix_for_collection(cid)
            info("state_getKeysPaged on MultiTokens.Tokens prefix…")
            all_tok_keys = await get_all_keys_paged(tok_prefix)
            token_ids = sorted(
                tid for k in all_tok_keys
                if (tid := token_id_from_tokens_key(k)) is not None
            )
            total_toks = len(token_ids)
            stats["tokens_found"] += total_toks

            # Step 5a: Subscan /items → pre-load metadata dict (fast lookup)
            info(f"Found {total_toks} token(s) on-chain. Pre-loading metadata from Subscan…")
            subscan_meta: dict[int, dict] = fetch_all_token_metadata_subscan(cid)
            info(f"Subscan returned metadata for {len(subscan_meta)} token(s)")

            if max_tokens is not None and total_toks > max_tokens:
                info(f"Limiting to first {max_tokens} tokens (--max-tokens)")
                token_ids = token_ids[:max_tokens]

            # Steps 5-6: resolve URI and download for each token
            coll_uri_template = coll_uris.get(cid)
            for tid in token_ids:
                tok_label = f"[coll {cid} / tok {tid}] "

                tok_prefix = f"{cid}-{tid}"   # flat filename prefix for this token

                # Priority 0: collection URI is a template — expand {id} → <cid>-<tid>
                if coll_uri_template and "{id}" in coll_uri_template:
                    tok_uri = apply_id_template(coll_uri_template, cid, tid)
                    info(f"token {tid}: template URI → {tok_uri}")
                    if dry_run:
                        info(f"[dry-run] would save {tok_prefix}.json + {tok_prefix}.<ext>")
                        stats["tokens_with_media"] += 1
                    else:
                        n = process_metadata_uri(tok_uri, addr_dir,
                                                 file_prefix=tok_prefix, label=tok_label)
                        if n: stats["tokens_with_media"] += 1; stats["files"] += n
                    continue

                # Priority 1: Subscan metadata already has image URL directly
                if tid in subscan_meta:
                    meta = subscan_meta[tid]
                    media_urls = extract_media_urls(meta)
                    if media_urls:
                        info(f"token {tid}: metadata from Subscan index")
                        if dry_run:
                            info(f"[dry-run] would save {tok_prefix}.json + {tok_prefix}.<ext>")
                            stats["tokens_with_media"] += 1
                        else:
                            n = process_subscan_metadata(meta, addr_dir,
                                                         file_prefix=tok_prefix, label=tok_label)
                            if n: stats["tokens_with_media"] += 1; stats["files"] += n
                        continue

                # Priority 2: RPC TokenAttributes fallback (reconnects transparently)
                tok_uri: str | None = None
                for attr_key in attr_keys:
                    raw = await rpc.call("state_getStorage",
                                         [build_token_attr_key(cid, tid, attr_key), head_hash])
                    tok_uri = decode_attr_uri(raw)
                    if tok_uri: break

                if not tok_uri:
                    # No metadata found via any path — skip silently (common for 0-supply tokens)
                    continue

                info(f"token {tid}: URI from RPC → {tok_uri}")
                if dry_run:
                    info(f"[dry-run] would save {tok_prefix}.json + {tok_prefix}.<ext>")
                    stats["tokens_with_media"] += 1
                else:
                    n = process_metadata_uri(tok_uri, addr_dir,
                                             file_prefix=tok_prefix, label=tok_label)
                    if n: stats["tokens_with_media"] += 1; stats["files"] += n

    finally:
        await rpc.close()

    _print_summary(collection_ids, stats, addr_dir, dry_run)


def _print_summary(collection_ids, stats, addr_dir, dry_run):
    header("SUMMARY")
    print(f"  Collections processed     : {len(collection_ids)}")
    print(f"  Collections with media    : {stats['coll_with_media']}")
    print(f"  Total tokens on-chain     : {stats['tokens_found']}")
    print(f"  Tokens with media         : {stats['tokens_with_media']}")
    if not dry_run:
        print(f"  Media files downloaded    : {stats['files']}")
        print(f"  Output folder             : {addr_dir.resolve()}")
    else:
        print(f"  (dry-run — no files written)")


# ══════════════════════════════════════════════════════════════════════════════
#  ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════

def main():
    global MATRIX_RPC_ENDPOINT, MATRIX_SUBSCAN_HOST, SUBSCAN_API_KEY, \
           IPFS_GATEWAY, OUTPUT_DIR_DEFAULT

    # .env is auto-loaded at import time from the script's directory — nothing to do here.

    parser = argparse.ArgumentParser(
        description="Download collection and token media for an Enjin Matrixchain wallet.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python matrixchain-media-downloader.py ef1ABC...
  python matrixchain-media-downloader.py ef1ABC... --dry-run
  python matrixchain-media-downloader.py ef1ABC... --max-tokens 50
  python matrixchain-media-downloader.py ef1ABC... --collections-only
  python matrixchain-media-downloader.py ef1ABC... --attr-key uri --attr-key metadata
        """,
    )
    parser.add_argument("address", nargs="?",
                        help="Matrixchain wallet address (starts with 'ef')")
    parser.add_argument("--attr-key", action="append", default=[], metavar="KEY",
                        help="Attribute key for metadata URI (default: uri). "
                             "Repeat for fallback order.")
    parser.add_argument("--max-tokens", type=int, default=None, metavar="N",
                        help="Max tokens to process per collection.")
    parser.add_argument("--collections-only", action="store_true",
                        help="Skip token enumeration; process collections only.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print URIs without downloading files.")
    parser.add_argument("--output-dir", default=OUTPUT_DIR_DEFAULT, metavar="DIR")
    args = parser.parse_args()

    address = args.address
    if not address:
        try:
            address = input("Enter Matrixchain wallet address (ef…): ").strip()
        except (KeyboardInterrupt, EOFError):
            print(); sys.exit(0)
    if not address:
        print("No address provided."); sys.exit(1)

    try:
        pub = ss58_decode(address)
    except Exception as exc:
        print(f"Invalid address: {exc}"); sys.exit(1)

    if not address.startswith("ef"):
        converted = ss58_encode(pub, MATRIX_SS58_PREFIX)
        print(f"Warning: address does not start with 'ef'. Converted: {converted}")
        ans = input("Use converted address? [Y/n]: ").strip().lower()
        if ans not in ("n", "no"):
            address = converted
            print(f"Using: {address}")

    attr_keys: list[bytes] = [k.encode() for k in args.attr_key] if args.attr_key else [b"uri"]

    if not SUBSCAN_API_KEY:
        print("Warning: SUBSCAN_API_KEY not set — Subscan requests may fail.\n")

    print(f"\n{'═' * W}")
    print(f"  Enjin Matrixchain Collection & Token Media Downloader")
    print(f"{'═' * W}")
    print(f"  Address         : {address}")
    print(f"  Subscan host    : {MATRIX_SUBSCAN_HOST}")
    print(f"  RPC endpoint    : {MATRIX_RPC_ENDPOINT}")
    print(f"  IPFS gateway    : {IPFS_GATEWAY}")
    print(f"  Attribute key(s): {[k.decode() for k in attr_keys]}")
    print(f"  Output dir      : {args.output_dir}")
    if args.dry_run:          print(f"  Mode            : DRY RUN")
    if args.max_tokens:       print(f"  Max tokens/coll : {args.max_tokens}")
    if args.collections_only: print(f"  Scope           : collections only")

    try:
        asyncio.run(run(
            address          = address,
            output_dir       = Path(args.output_dir),
            attr_keys        = attr_keys,
            max_tokens       = args.max_tokens,
            collections_only = args.collections_only,
            dry_run          = args.dry_run,
        ))
    except KeyboardInterrupt:
        print("\n\n  Interrupted."); sys.exit(0)


if __name__ == "__main__":
    main()
