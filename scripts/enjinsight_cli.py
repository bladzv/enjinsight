#!/usr/bin/env python3
"""
EnjinSight CLI — Python port of the EnjinSight web application.

Tools:
  1. Era Block Explorer        — real-time & historical era/session/block metrics
  2. Validator Reward Cadence  — missed-era detection for validators
  3. Pool Reward Cadence       — missed-era detection for nomination pools
  4. Historical Balance Viewer — archive-node balance history + CSV export
  5. Reward History Viewer     — per-era staking reward computation
  6. ENJ Infusion Checker      — ERC-20 ENJ infusion reads for Ethereum ERC-1155 tokens

Usage:
  python enjinsight_cli.py

Requirements:
  pip install requests websockets python-dotenv rich

Optional (encrypted export):
  pip install cryptography

Set SUBSCAN_API_KEY, ETHERSCAN_API_KEY, and optional ALCHEMY_ETH_RPC_URL in .env or
as environment variables.
"""

# ── Standard library ──────────────────────────────────────────────────────────
import argparse
import asyncio
import csv
import hashlib
import io
import json
import os
import re
import select
import ssl
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple
import urllib.error
import urllib.parse
import urllib.request
from urllib.parse import urlparse

# ── Third-party: required ─────────────────────────────────────────────────────
_missing = []
try:
    import requests
except ImportError:
    _missing.append("requests")

try:
    import websockets
    import websockets.exceptions
except ImportError:
    _missing.append("websockets")

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(*a, **k): pass  # graceful fallback

try:
    from rich.console import Console
    from rich.table import Table
    from rich.panel import Panel
    from rich.prompt import Prompt, IntPrompt, Confirm
    from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn
    from rich.text import Text
    HAS_RICH = True
    console = Console()
except ImportError:
    HAS_RICH = False
    console = None

# ── Third-party: optional (encryption) ───────────────────────────────────────
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes as crypto_hashes
    import base64 as _b64
    HAS_CRYPTO = True
except ImportError:
    HAS_CRYPTO = False

def _offer_install_missing(pkgs: list) -> None:
    """Detect pip, print install instructions, and optionally install missing packages."""
    ver = f"Python {sys.version.split()[0]}"
    print(f"\n{'='*60}")
    print("EnjinSight CLI — Missing Dependencies")
    print(f"{'='*60}")
    print(ver)
    print(f"\nMissing required packages: {', '.join(pkgs)}")

    # Detect available pip binary
    pip_cmd: Optional[list] = None
    candidates = [
        ["pip3"],
        ["pip"],
        [sys.executable, "-m", "pip"],
        [f"python{sys.version_info.major}.{sys.version_info.minor}", "-m", "pip"],
        [f"python{sys.version_info.major}", "-m", "pip"],
    ]
    for cmd in candidates:
        try:
            r = subprocess.run(cmd + ["--version"], capture_output=True, text=True, timeout=5)
            if r.returncode == 0:
                pip_cmd = cmd
                print(f"\nDetected: {' '.join(cmd + ['--version'])} → {r.stdout.strip()}")
                break
        except Exception:
            continue

    install_line = f"pip install {' '.join(pkgs)}"
    print(f"\nInstall command: {install_line}")

    if pip_cmd:
        try:
            answer = input("\nInstall missing packages now? [y/N]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            answer = ""
        if answer in ("y", "yes"):
            full_cmd = pip_cmd + ["install"] + pkgs
            print(f"\nRunning: {' '.join(full_cmd)}")
            try:
                proc = subprocess.run(full_cmd, timeout=180)
                if proc.returncode == 0:
                    print("\nInstallation complete. Please restart the script.")
                else:
                    print("\nInstallation failed. Please install manually.")
            except Exception as exc:
                print(f"\nInstallation error: {exc}")
        else:
            print("\nRun the install command above and then restart the script.")
    else:
        print("\nCould not detect pip. Please install the packages manually.")
    sys.exit(1)


if _missing:
    # Non-interactive runs (systemd timers) must never reach the install prompt:
    # it waits on stdin, and a timer unit has no TTY. argv is available here,
    # long before main() parses it, so gate on the raw flag.
    if "--non-interactive" in sys.argv or "-h" in sys.argv or "--help" in sys.argv:
        sys.stderr.write(
            "enjinsight_cli: missing required packages: " + ", ".join(_missing) + "\n"
            "Install them first:  pip install " + " ".join(_missing) + "\n"
        )
        sys.exit(2)
    _offer_install_missing(_missing)

# ── Load environment ──────────────────────────────────────────────────────────
load_dotenv(Path(__file__).parent.parent / ".env")
load_dotenv(Path(__file__).parent / ".env")

# ════════════════════════════════════════════════════════════════════════════════
# CONSTANTS
# ════════════════════════════════════════════════════════════════════════════════

SUBSCAN_BASE = "https://enjin.api.subscan.io"
EXPLORER_BASE = "https://enjin.subscan.io"
GITHUB_URL = "https://github.com/bladzv/enjinsight"
ETHERSCAN_API_URL = "https://api.etherscan.io/v2/api"
ETHERSCAN_CHAIN_ID = "1"
ETHERSCAN_NFT_BASE = "https://etherscan.io/nft"

ENDPOINTS = {
    "validators":      "/api/scan/staking/validators",
    "nominators":      "/api/scan/staking/nominators",
    "eraStat":         "/api/scan/staking/era_stat",
    "pools":           "/api/scan/nomination_pool/pools",
    "voted":           "/api/scan/staking/voted",
    "rewardSlash":     "/api/v2/scan/account/reward_slash",
    "extrinsics":      "/api/v2/scan/extrinsics",
    "extrinsicParams": "/api/scan/extrinsic/params",
    "events":          "/api/v2/scan/events",
}
ALLOWED_PATHS: Set[str] = set(ENDPOINTS.values())

ENJIN_NETWORKS = [
    {"key": "matrixchain",   "label": "Enjin Matrixchain",  "endpoint": "wss://archive.matrix.blockchain.enjin.io",  "ss58": 1110},
    {"key": "relaychain",    "label": "Enjin Relaychain",   "endpoint": "wss://archive.relay.blockchain.enjin.io",   "ss58": 2135, "era_csv": True},
    {"key": "canary-matrix", "label": "Canary Matrixchain", "endpoint": "wss://archive.matrix.canary.enjin.io",      "ss58": 9030},
    {"key": "canary-relay",  "label": "Canary Relaychain",  "endpoint": "wss://archive.relay.canary.enjin.io",       "ss58": 69,   "era_csv": True},
]
LIVE_RPC_WSS    = "wss://rpc.relay.blockchain.enjin.io"
ARCHIVE_WSS     = "wss://archive.relay.blockchain.enjin.io"

PLANCK_PER_ENJ   = 10 ** 18

# The web app's scan-range ceiling (MAX_ERA_COUNT in src/constants.js). The CLI
# allows more, but a scan wider than this cannot be reproduced in the app for a
# side-by-side cross-check, so a batch run says so rather than silently diverging.
MAX_WEB_ERA_COUNT = 7
COLLECTION_ID    = 1          # sENJ multi-token collection
ERAS_PER_YEAR    = 365
EVENT_SCAN_AFTER = 40         # blocks after era boundary to scan for rewards
CONSECUTIVE_MISS_THRESHOLD = 3

API_DELAY_MS   = 1.0          # seconds between Subscan requests
MAX_RETRIES    = 5
REQUEST_TIMEOUT = 15          # seconds
POOLS_PAGE_SIZE = 100         # the pools endpoint is not row-capped; verified 100 works
# Subscan's free plan caps `row` at 25 on most endpoints and answers a larger
# request with HTTP 403 {"message": "row_limit_exceeded"} — NOT a 400, and not an
# auth error, so it is easy to misread as a bad API key. Verified 2026-09-06:
# nominators, reward_slash and extrinsics all reject row=100 and accept row=25.
# Every endpoint using this constant must therefore paginate.
SUBSCAN_MAX_ROW  = 25
REWARD_SLASH_ROW = SUBSCAN_MAX_ROW
NOMINATORS_ROW   = SUBSCAN_MAX_ROW
MAX_RPC_CALLS    = 2000

SYS_ACCT_PREFIX = bytes.fromhex(
    "26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9"
)
STAKING_ACTIVE_ERA_KEY = "0x5f3e4907f716ac89b6347d15ececedca487df464e44a534ba6b0cbb32407b587"
TIMESTAMP_NOW_KEY      = "0xf0c365c3cf59d671eb72da0e7a4113c49f1f0515f462cdcf84e0f1d6045dfcbb"

ENJIN_ERC1155_CONTRACT = "0xfaafdc07907ff5120a76b34b731b278c38d6043c"
TYPE_DATA_SELECTOR = "4341963e"
ETH_PUBLIC_RPC_ENDPOINTS = [
    ("PublicNode", "https://ethereum-rpc.publicnode.com"),
    ("LlamaRPC", "https://eth.llamarpc.com"),
    ("Ankr", "https://rpc.ankr.com/eth"),
]
ETHERSCAN_PAGE_SIZE = 1000
ETHERSCAN_MAX_PAGES = 25
ETHERSCAN_DELAY_SEC = 0.35

# ════════════════════════════════════════════════════════════════════════════════
# DISPLAY HELPERS
# ════════════════════════════════════════════════════════════════════════════════

# ════════════════════════════════════════════════════════════════════════════════
# BATCH (NON-INTERACTIVE) MODE
# ════════════════════════════════════════════════════════════════════════════════

# Set by main() when --non-interactive is passed. In batch mode every prompt
# helper raises instead of blocking on stdin: under systemd there is no TTY, so
# a stray prompt would hang the timer unit forever rather than fail. Failing
# loudly in the journal is the only acceptable behaviour there.
_BATCH_MODE = False


class BatchPromptError(RuntimeError):
    """An interactive prompt was reached while running non-interactively."""


def _batch_guard(prompt: str) -> None:
    if _BATCH_MODE:
        raise BatchPromptError(f"interactive prompt in non-interactive mode: {prompt!r}")


def cprint(msg: str, style: str = "") -> None:
    if HAS_RICH:
        console.print(msg, style=style)
    else:
        print(msg)

def cprint_panel(title: str, content: str, style: str = "bold cyan") -> None:
    if HAS_RICH:
        console.print(Panel(content, title=title, border_style=style))
    else:
        print(f"\n{'='*60}\n{title}\n{'='*60}\n{content}\n")

def log_line(level: str, msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    level_styles = {"INFO": "cyan", "OK": "green", "WARN": "yellow", "ERR": "red", "DONE": "bold green"}
    if HAS_RICH:
        style = level_styles.get(level.upper(), "")
        console.print(f"[dim]{ts}[/dim] [{style}]{level:4}[/{style}] {msg}")
    else:
        print(f"{ts} {level:4} {msg}")

def ask(prompt: str, default: str = "") -> str:
    _batch_guard(prompt)
    if HAS_RICH:
        return Prompt.ask(prompt, default=default) if default else Prompt.ask(prompt)
    val = input(f"{prompt}{' [' + default + ']' if default else ''}: ").strip()
    return val or default

def ask_int(prompt: str, default: int = 0, min_val: int = 0, max_val: int = 10**9) -> int:
    _batch_guard(prompt)
    while True:
        raw = ask(prompt, str(default))
        try:
            n = int(raw)
            if min_val <= n <= max_val:
                return n
            cprint(f"  Enter a number between {min_val} and {max_val}.", "yellow")
        except ValueError:
            cprint("  Invalid number.", "yellow")

def confirm(prompt: str, default: bool = False) -> bool:
    _batch_guard(prompt)
    if HAS_RICH:
        return Confirm.ask(prompt, default=default)
    raw = input(f"{prompt} [{'Y/n' if default else 'y/N'}]: ").strip().lower()
    if not raw:
        return default
    return raw in ("y", "yes")

def fmt_enj(planck: int, decimals: int = 4) -> str:
    if planck < 0:
        planck = 0
    whole = planck // PLANCK_PER_ENJ
    frac  = str(planck % PLANCK_PER_ENJ).zfill(18)[:decimals]
    whole_str = f"{whole:,}"
    return f"{whole_str}.{frac} ENJ"

def truncate_addr(addr: str, start: int = 8, end: int = 6) -> str:
    if not addr:
        return "—"
    clean = re.sub(r"[^a-zA-Z0-9]", "", addr)
    if len(clean) <= start + end + 3:
        return clean
    return f"{clean[:start]}…{clean[-end:]}"

def truncate_token_id(token_id: str, start: int = 8, end: int = 6) -> str:
    clean = str(token_id or "").strip()
    if len(clean) <= start + end + 3:
        return clean
    return f"{clean[:start]}…{clean[-end:]}"

def parse_commission(raw) -> float:
    try:
        n = int(str(raw))
        return round(n / 1e7, 2) if n else 0.0
    except Exception:
        return 0.0

def safe_int(v, fallback: int = 0) -> int:
    try:
        return int(str(v))
    except Exception:
        return fallback

def now_ts() -> str:
    return datetime.now().strftime("%H:%M:%S")

def ms_to_utc(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

def validate_eth_address(addr: str) -> str:
    clean = (addr or "").strip()
    if not re.fullmatch(r"0x[a-fA-F0-9]{40}", clean):
        raise ValueError("Ethereum address must be 0x-prefixed and 40 hex bytes.")
    return clean

def normalize_infusion_token_id(value: str) -> str:
    clean = (value or "").strip()
    if not clean:
        return ""
    try:
        parsed = urlparse(clean)
        parts = [p for p in parsed.path.split("/") if p]
        if (
            parsed.hostname
            and parsed.hostname.lower().replace("www.", "") == "etherscan.io"
            and len(parts) >= 3
            and parts[0].lower() == "nft"
            and parts[1].lower() == ENJIN_ERC1155_CONTRACT.lower()
        ):
            return parts[-1].replace("_", "")
    except Exception:
        pass
    return clean.replace("_", "")

def validate_infusion_token_id(token_id: str) -> int:
    clean = normalize_infusion_token_id(token_id)
    if not clean:
        raise ValueError("Token ID is required.")
    if not re.fullmatch(r"\d+", clean):
        raise ValueError("Token ID must contain digits only, or be a matching Etherscan NFT URL.")
    parsed = int(clean)
    if parsed > (1 << 256) - 1:
        raise ValueError("Token ID is larger than uint256.")
    return parsed

def encode_uint256(value: int) -> str:
    return f"{value:x}".rjust(64, "0")

def build_type_data_call(token_id: int) -> str:
    return "0x" + TYPE_DATA_SELECTOR + encode_uint256(token_id)

def parse_uint256_words(hex_data: str) -> List[int]:
    if not hex_data or hex_data == "0x":
        raise ValueError("The contract returned no data.")
    payload = hex_data[2:] if hex_data.startswith("0x") else hex_data
    if len(payload) < 64 * 4:
        raise ValueError("The contract returned an unexpected response.")
    return [int(payload[i * 64:(i + 1) * 64], 16) for i in range(4)]

def etherscan_token_url(token_id: str) -> str:
    return f"{ETHERSCAN_NFT_BASE}/{ENJIN_ERC1155_CONTRACT}/{token_id}"

# ════════════════════════════════════════════════════════════════════════════════
# CRYPTO / SUBSTRATE UTILITIES
# ════════════════════════════════════════════════════════════════════════════════

# ── xxHash64 (pure Python) ────────────────────────────────────────────────────

def _xxh64(data: bytes, seed: int) -> int:
    P1 = 11400714785074694791
    P2 = 14029467366897019727
    P3 =  1609587929392839161
    P4 =  9650029242287828579
    P5 =  2870177450012600261
    M  = (1 << 64) - 1

    def u64(x):            return x & M
    def mul(a, b):         return u64(a * b)
    def add(a, b):         return u64(a + b)
    def rotl(x, r):        return u64((x << r) | (x >> (64 - r)))
    def rnd(acc, inp):     return mul(rotl(add(acc, mul(inp, P2)), 31), P1)
    def merge(acc, val):   return add(mul(u64(acc ^ rnd(0, val)), P1), P4)

    n = len(data)
    p = 0
    if n >= 32:
        v1 = add(add(seed, P1), P2)
        v2 = add(seed, P2)
        v3 = seed
        v4 = u64(seed - P1)
        while p <= n - 32:
            v1 = rnd(v1, int.from_bytes(data[p:p+8], "little")); p += 8
            v2 = rnd(v2, int.from_bytes(data[p:p+8], "little")); p += 8
            v3 = rnd(v3, int.from_bytes(data[p:p+8], "little")); p += 8
            v4 = rnd(v4, int.from_bytes(data[p:p+8], "little")); p += 8
        h = add(add(add(rotl(v1, 1), rotl(v2, 7)), rotl(v3, 12)), rotl(v4, 18))
        h = merge(merge(merge(merge(h, v1), v2), v3), v4)
    else:
        h = add(seed, P5)

    h = add(h, n)
    while p <= n - 8:
        h = add(mul(rotl(u64(h ^ rnd(0, int.from_bytes(data[p:p+8], "little"))), 27), P1), P4); p += 8
    if p <= n - 4:
        h = add(mul(rotl(u64(h ^ mul(int.from_bytes(data[p:p+4], "little"), P1)), 23), P2), P3); p += 4
    while p < n:
        h = mul(rotl(u64(h ^ mul(data[p], P5)), 11), P1); p += 1

    h = mul(u64(h ^ (h >> 33)), P2)
    h = mul(u64(h ^ (h >> 29)), P3)
    return u64(h ^ (h >> 32))

def twox128(text: str) -> bytes:
    b = text.encode()
    h0 = _xxh64(b, 0)
    h1 = _xxh64(b, 1)
    return h0.to_bytes(8, "little") + h1.to_bytes(8, "little")

def storage_key(pallet: str, item: str) -> str:
    return "0x" + twox128(pallet).hex() + twox128(item).hex()

# ── BLAKE2b wrappers ──────────────────────────────────────────────────────────

def blake2b_128(data: bytes) -> bytes:
    return hashlib.blake2b(data, digest_size=16).digest()

def blake2b_256(data: bytes) -> bytes:
    return hashlib.blake2b(data, digest_size=32).digest()

# ── Base58 ────────────────────────────────────────────────────────────────────

_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

def base58_decode(s: str) -> bytes:
    n = 0
    for c in s:
        idx = _B58.find(c)
        if idx < 0:
            raise ValueError(f"Invalid base58 character: '{c}'")
        n = n * 58 + idx
    result = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    pad = len(s) - len(s.lstrip("1"))
    return b"\x00" * pad + result

# ── SS58 ──────────────────────────────────────────────────────────────────────

def ss58_decode(addr: str) -> bytes:
    """Decode SS58 address → raw 32-byte public key. Raises on invalid input."""
    if not addr or len(addr) < 25 or len(addr) > 50:
        raise ValueError("Address length out of range (expected 25–50 chars).")
    d = base58_decode(addr)
    pfx_len = 2 if (d[0] & 0x40) != 0 else 1
    pub = d[pfx_len: pfx_len + 32]
    if len(pub) != 32:
        raise ValueError("Invalid SS58 address (wrong public key length).")
    return pub

def validate_address(addr: str) -> str:
    """Validate SS58 address; return it stripped or raise ValueError."""
    addr = addr.strip()
    ss58_decode(addr)  # raises on invalid
    return addr

# ── Storage key builders ──────────────────────────────────────────────────────

def build_storage_key(addr: str) -> str:
    """System.Account storage key: prefix + blake2b_128(pub) + pub."""
    pub  = ss58_decode(addr)
    h16  = blake2b_128(pub)
    return "0x" + SYS_ACCT_PREFIX.hex() + h16.hex() + pub.hex()

def _b128concat(key_bytes: bytes) -> bytes:
    """Blake2_128Concat: blake2b-128(key) ++ key."""
    return blake2b_128(key_bytes) + key_bytes

def _u128le(n: int) -> bytes:
    return n.to_bytes(16, "little")

def build_token_account_key(collection_id: int, token_id: int, addr: str) -> str:
    """MultiTokens.TokenAccounts(collectionId, tokenId, account) storage key."""
    pub = ss58_decode(addr)
    k1  = _b128concat(_u128le(collection_id))
    k2  = _b128concat(_u128le(token_id))
    k3  = _b128concat(pub)
    prefix = twox128("MultiTokens") + twox128("TokenAccounts")
    return "0x" + (prefix + k1 + k2 + k3).hex()

def build_token_key(collection_id: int, token_id: int) -> str:
    """MultiTokens.Tokens(collectionId, tokenId) storage key."""
    k1 = _b128concat(_u128le(collection_id))
    k2 = _b128concat(_u128le(token_id))
    prefix = twox128("MultiTokens") + twox128("Tokens")
    return "0x" + (prefix + k1 + k2).hex()

def build_bonded_pools_prefix() -> str:
    """NominationPools.BondedPools storage prefix (32 bytes)."""
    return "0x" + twox128("NominationPools").hex() + twox128("BondedPools").hex()

def pool_id_from_bonded_pools_key(key_hex: str) -> Optional[int]:
    """Extract pool_id (u32 LE) from a full BondedPools storage key."""
    s = key_hex[2:] if key_hex.startswith("0x") else key_hex
    if len(s) < 88:
        return None
    raw = bytes.fromhex(s[80:88])
    return int.from_bytes(raw, "little")

NOMINATION_POOLS_PALLET_ID = b"py/nopls"   # runtime constant NominationPools.PalletId
POOL_ACCOUNT_BONDED = 1                    # sub-account holding the actively staked ENJ

def compute_pool_bonded_account_id(pool_id: int, index: int = POOL_ACCOUNT_BONDED) -> str:
    """
    Derive a nomination-pool sub-account (AccountId32 hex) from pool_id.

    Mirrors Substrate's PalletId::into_sub_account, which uses TrailingZeroInput: the seed
    bytes are written into a 32-byte buffer and the remainder is ZERO-PADDED, never hashed.

        b"modl" + b"py/nopls" + index(u8) + pool_id(u32 LE) + 15 zero bytes

    Previously this hashed a 17-byte seed with the wrong PalletId (b"py/nopo\x00") and index 0,
    so Staking.Ledger lookups silently returned empty and active stake was always 0.
    """
    out = bytearray(32)
    pre = b"modl" + NOMINATION_POOLS_PALLET_ID + bytes([index & 0xFF]) \
        + (pool_id & 0xFFFFFFFF).to_bytes(4, "little")
    out[0:len(pre)] = pre
    return bytes(out).hex()

def build_staking_ledger_key(account_id_hex: str) -> str:
    """Staking.Ledger(accountId) storage key."""
    id_bytes = bytes.fromhex(account_id_hex)
    hashed   = _b128concat(id_bytes)
    prefix   = twox128("Staking") + twox128("Ledger")
    return "0x" + (prefix + hashed).hex()

# ── SCALE decoders ────────────────────────────────────────────────────────────

def _from_hex(h: str) -> bytes:
    s = h[2:] if h.startswith("0x") else h
    if not s:
        return b""
    return bytes.fromhex(s)

def decode_compact_first(hex_str: Optional[str]) -> int:
    """Decode first SCALE compact-encoded integer from a raw storage hex value."""
    if not hex_str or hex_str in ("0x", "0x0"):
        return 0
    b = _from_hex(hex_str)
    if not b:
        return 0
    mode = b[0] & 0b11
    if mode == 0:
        return b[0] >> 2
    elif mode == 1:
        return (int.from_bytes(b[0:2], "little")) >> 2
    elif mode == 2:
        return (int.from_bytes(b[0:4], "little")) >> 2
    else:
        n = (b[0] >> 2) + 4
        return int.from_bytes(b[1:1+n], "little")

def decode_compact_at(b: bytes, offset: int) -> Tuple[int, int]:
    """Decode SCALE compact int at byte offset. Returns (value, next_offset)."""
    mode = b[offset] & 0b11
    if mode == 0:
        return (b[offset] >> 2), offset + 1
    elif mode == 1:
        return (int.from_bytes(b[offset:offset+2], "little") >> 2), offset + 2
    elif mode == 2:
        return (int.from_bytes(b[offset:offset+4], "little") >> 2), offset + 4
    else:
        n = (b[offset] >> 2) + 4
        return int.from_bytes(b[offset+1:offset+1+n], "little"), offset + 1 + n

def decode_account_info(hex_str: Optional[str]) -> Dict[str, Any]:
    """SCALE-decode System.Account raw storage → {nonce, free, reserved, miscFrozen, feeFrozen}."""
    zero = {"nonce": 0, "free": 0, "reserved": 0, "miscFrozen": 0, "feeFrozen": 0}
    if not hex_str or hex_str in ("0x", None):
        return zero
    b = _from_hex(hex_str)
    if len(b) < 48:
        return zero
    o = 0
    def u32():
        nonlocal o
        v = int.from_bytes(b[o:o+4], "little")
        o += 4
        return v
    def u128():
        nonlocal o
        v = int.from_bytes(b[o:o+16], "little")
        o += 16
        return v
    nonce = u32()
    u32()  # consumers
    u32()  # sufficients
    if len(b) >= 80:
        u32()  # providers (new format)
    free       = u128()
    reserved   = u128()
    misc_frozen = u128()
    fee_frozen  = u128()
    IS_NEW_LOGIC_BIT = 1 << 127
    new_format = bool(fee_frozen & IS_NEW_LOGIC_BIT)
    if new_format:
        fee_frozen = 0
    return {"nonce": nonce, "free": free, "reserved": reserved,
            "miscFrozen": misc_frozen, "feeFrozen": fee_frozen}

def decode_active_era(hex_str: Optional[str]) -> Optional[int]:
    """Decode Staking.ActiveEra → era index (u32)."""
    if not hex_str or hex_str in ("0x", None):
        return None
    b = _from_hex(hex_str)
    if len(b) >= 5 and b[0] == 0x01:
        v = int.from_bytes(b[1:5], "little")
        if v < 1_000_000:
            return v
    if len(b) >= 4:
        v = int.from_bytes(b[0:4], "little")
        if v < 1_000_000:
            return v
    return None

def decode_u32(hex_str: Optional[str]) -> Optional[int]:
    if not hex_str:
        return None
    b = _from_hex(hex_str)
    return int.from_bytes(b[0:4], "little") if len(b) >= 4 else None

def decode_timestamp_ms(hex_str: Optional[str]) -> Optional[int]:
    """Decode Timestamp.Now (u64 LE) → milliseconds since epoch."""
    if not hex_str or hex_str == "0x":
        return None
    b = _from_hex(hex_str)
    if len(b) < 8:
        return None
    return int.from_bytes(b[0:8], "little")

def decode_staking_ledger_active(hex_str: Optional[str]) -> int:
    """Decode Staking.Ledger → active field (SCALE compact u128)."""
    if not hex_str or hex_str in ("0x", None):
        return 0
    b = _from_hex(hex_str)
    if len(b) < 34:
        return 0
    try:
        _, next_off = decode_compact_at(b, 32)   # skip stash(32), decode total
        value, _    = decode_compact_at(b, next_off)   # decode active
        return value
    except Exception:
        return 0

# ── WebSocket endpoint validation ─────────────────────────────────────────────

def validate_ws_endpoint(ep: str) -> str:
    """Validate WS endpoint — only wss:// (or ws://) accepted. Raises on invalid."""
    ep = ep.strip()
    try:
        u = urlparse(ep)
    except Exception:
        raise ValueError("Not a valid URL.")
    if u.scheme not in ("wss", "ws"):
        raise ValueError(f"Endpoint must use wss:// or ws://. Got '{u.scheme}://'")
    if not u.hostname:
        raise ValueError("Endpoint has no hostname.")
    return ep


def _is_ssl_error(exc: BaseException) -> bool:
    """Return True if exc is or wraps an SSL certificate verification error."""
    seen: Set[int] = set()
    cur: Optional[BaseException] = exc
    while cur is not None and id(cur) not in seen:
        seen.add(id(cur))
        if isinstance(cur, (ssl.SSLCertVerificationError, ssl.SSLError)):
            return True
        if "CERTIFICATE_VERIFY_FAILED" in str(cur):
            return True
        cur = getattr(cur, "__cause__", None) or getattr(cur, "__context__", None)
    return False


def _ssl_context_noverify() -> ssl.SSLContext:
    """Build an SSL context that skips certificate verification (use only as fallback)."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx

# ════════════════════════════════════════════════════════════════════════════════
# SUBSCAN HTTP CLIENT
# ════════════════════════════════════════════════════════════════════════════════

class SubscanClient:
    """Rate-limited, retrying Subscan HTTP client. API key is injected server-side."""

    def __init__(self, api_key: str):
        if not api_key:
            raise ValueError("SUBSCAN_API_KEY is not set. Add it to .env or environment.")
        self._api_key = api_key
        self._session = requests.Session()
        self._session.headers.update({
            "Content-Type": "application/json",
            "Accept":       "application/json",
            "X-API-Key":    api_key,
        })
        self._last_req   = 0.0
        self._ssl_warned = False   # True once we've fallen back to verify=False
        # Informational: every real HTTP request, retries included. Reported in
        # the scan summary so the free tier's 20,000/day quota stays visible.
        self.request_count = 0

    def _rate_limit(self) -> None:
        self.request_count += 1
        elapsed = time.time() - self._last_req
        if elapsed < API_DELAY_MS:
            time.sleep(API_DELAY_MS - elapsed)
        self._last_req = time.time()

    def post(self, path: str, body: dict, retries: int = MAX_RETRIES) -> dict:
        """POST to a whitelisted Subscan path. Returns data dict (code==0)."""
        if path not in ALLOWED_PATHS:
            raise ValueError(f"Path '{path}' is not in the allowlist.")
        url = SUBSCAN_BASE + path
        body_json = json.dumps(body)   # serialise once; no injection possible

        for attempt in range(1, retries + 1):
            self._rate_limit()
            try:
                resp = self._session.post(url, data=body_json, timeout=REQUEST_TIMEOUT)
            except requests.exceptions.SSLError as e:
                if not self._ssl_warned and _is_ssl_error(e):
                    log_line("WARN", "SSL certificate verification failed — retrying without cert check.")
                    cprint("[yellow]SSL error: certificate could not be verified.[/yellow]")
                    cprint("[yellow]On macOS run 'Install Certificates' in your Python folder, or: pip install certifi[/yellow]")
                    cprint("[yellow]Falling back to unverified SSL for this session.[/yellow]")
                    self._session.verify = False
                    self._ssl_warned = True
                    self._rate_limit()
                    try:
                        resp = self._session.post(url, data=body_json, timeout=REQUEST_TIMEOUT)
                    except requests.exceptions.RequestException as e2:
                        if attempt < retries:
                            time.sleep(min(2 ** attempt, 30))
                            continue
                        raise RuntimeError(f"Network error after SSL fallback: {e2}")
                else:
                    raise RuntimeError(f"SSL error: {e}")
            except requests.exceptions.Timeout:
                if attempt < retries:
                    time.sleep(min(2 ** attempt, 30))
                    continue
                raise RuntimeError("Request timed out.")
            except requests.exceptions.RequestException as e:
                if attempt < retries:
                    time.sleep(min(2 ** attempt, 30))
                    continue
                raise RuntimeError(f"Network error: {e}")

            if resp.status_code == 429:
                wait = int(resp.headers.get("retry-after", 2 ** attempt))
                time.sleep(wait)
                continue

            if resp.status_code in (500, 502, 503, 504) and attempt < retries:
                time.sleep(2 ** attempt)
                continue

            if not resp.ok:
                raise RuntimeError(f"HTTP {resp.status_code} from Subscan.")

            ct = resp.headers.get("content-type", "")
            if "application/json" not in ct:
                raise RuntimeError("Unexpected response format.")

            try:
                data = resp.json()
            except Exception:
                raise RuntimeError("Failed to parse Subscan response.")

            if data.get("code") != 0:
                raise RuntimeError(
                    f"Subscan error (code {data.get('code')}): {data.get('message', '')}"
                )
            return data

        raise RuntimeError("Retries exhausted contacting Subscan.")

    def probe(self, path: str) -> dict:
        """Probe an endpoint with empty body; returns {ok, status, error}."""
        self.request_count += 1
        if path not in ALLOWED_PATHS:
            return {"ok": False, "error": "Path not in allowlist"}
        url = SUBSCAN_BASE + path
        try:
            resp = self._session.post(url, data="{}", timeout=REQUEST_TIMEOUT)
            if resp.status_code in (401, 403):
                return {"ok": False, "status": resp.status_code, "error": f"HTTP {resp.status_code} — API key may be invalid"}
            if resp.status_code == 404:
                return {"ok": False, "status": 404, "error": "HTTP 404 — endpoint not found"}
            if resp.ok:
                return {"ok": True, "status": resp.status_code, "error": None}
            try:
                d = resp.json()
                if resp.status_code == 400 and d.get("code") == 400:
                    return {"ok": True, "status": 400, "error": None}
            except Exception:
                pass
            return {"ok": False, "status": resp.status_code, "error": f"HTTP {resp.status_code}"}
        except Exception as e:
            return {"ok": False, "status": None, "error": str(e)}

    # ── Typed helpers ─────────────────────────────────────────────────────────

    def fetch_validators(self) -> List[dict]:
        data = self.post(ENDPOINTS["validators"], {"order": "desc", "order_field": "bonded_total"})
        return data.get("data", {}).get("list") or []

    def fetch_paged(self, path: str, body: dict, row: int = SUBSCAN_MAX_ROW,
                    max_pages: int = 400) -> List[dict]:
        """Walk every page of a list endpoint.

        Stops on a short page or once `count` is reached; max_pages is a guard
        against a runaway loop burning the 20,000/day request quota.
        """
        out: List[dict] = []
        for page in range(max_pages):
            data = self.post(path, {**body, "page": page, "row": row})
            lst = data.get("data", {}).get("list") or []
            out.extend(lst)
            if len(lst) < row:
                break
            total = data.get("data", {}).get("count")
            if total is not None and len(out) >= total:
                break
        return out

    def fetch_nominators(self, address: str) -> List[dict]:
        return self.fetch_paged(
            ENDPOINTS["nominators"],
            {"address": address, "order": "desc", "order_field": "bonded"},
            row=NOMINATORS_ROW)

    def fetch_era_stat(self, address: str, row: int) -> List[dict]:
        data = self.post(ENDPOINTS["eraStat"], {"address": address, "row": row, "page": 0})
        return data.get("data", {}).get("list") or []

    def fetch_all_pools(self, on_page=None) -> List[dict]:
        all_pools, page = [], 0
        while True:
            data = self.post(ENDPOINTS["pools"],
                             {"multi_state": ["Open", "Blocked"], "page": page, "row": POOLS_PAGE_SIZE})
            lst   = data.get("data", {}).get("list") or []
            total = data.get("data", {}).get("count")
            all_pools.extend(lst)
            if on_page:
                on_page(page, len(lst))
            if len(lst) < POOLS_PAGE_SIZE:
                break
            if total is not None and len(all_pools) >= total:
                break
            page += 1
        return all_pools

    def fetch_voted(self, address: str) -> List[dict]:
        data = self.post(ENDPOINTS["voted"], {"address": address})
        return data.get("data", {}).get("list") or []

    def fetch_reward_slash(self, address: str, block_range: str) -> List[dict]:
        return self.fetch_paged(
            ENDPOINTS["rewardSlash"],
            {"address": address, "is_stash": True, "category": "Reward",
             "block_range": block_range},
            row=REWARD_SLASH_ROW)

    def fetch_historical_pool_ids(self, address: str, on_page=None) -> Set[int]:
        pool_ids: Set[int] = set()
        page, row = 0, SUBSCAN_MAX_ROW   # row>25 is rejected with 403 row_limit_exceeded
        allowed_calls = {"bond", "unbond", "withdraw_unbonded", "withdraw_unbonded_kill"}
        while True:
            data = self.post(ENDPOINTS["extrinsics"],
                             {"row": row, "signed": "signed",
                              "module_call": [{"module": "nominationpools", "call": ""}],
                              "address": address, "page": page})
            records = data.get("data", {}).get("extrinsics") or []
            if not records:
                break
            # Enrich with params
            indices = [r["extrinsic_index"] for r in records if r.get("extrinsic_index")]
            if indices:
                try:
                    pr = self.post(ENDPOINTS["extrinsicParams"], {"extrinsic_index": indices})
                    arr = pr.get("data") if isinstance(pr.get("data"), list) else []
                    by_idx = {item["extrinsic_index"]: item.get("params", [])
                              for item in arr if item.get("extrinsic_index")}
                    for rec in records:
                        if rec.get("extrinsic_index") in by_idx:
                            rec["_params"] = by_idx[rec["extrinsic_index"]]
                except Exception:
                    pass
            for rec in records:
                call = str(rec.get("call_module_function") or rec.get("call_name") or "").lower()
                if call and call not in allowed_calls:
                    continue
                params = rec.get("_params") or rec.get("params") or []
                if isinstance(params, str):
                    try:
                        params = json.loads(params)
                    except Exception:
                        params = []
                if isinstance(params, list):
                    for p in params:
                        if isinstance(p, dict) and p.get("name") == "pool_id":
                            try:
                                pool_ids.add(int(p["value"]))
                            except Exception:
                                pass
            if on_page:
                on_page(page, len(records))
            if len(records) < row:
                break
            page += 1
        return pool_ids

    def fetch_events_in_range(self, block_range: str) -> List[dict]:
        all_events, page = [], 0
        while True:
            # row>25 is rejected with 403 row_limit_exceeded on the free plan.
            data = self.post(ENDPOINTS["events"],
                             {"block_range": block_range, "page": page, "row": SUBSCAN_MAX_ROW})
            evts = data.get("data", {}).get("events") or []
            all_events.extend(evts)
            if len(evts) < SUBSCAN_MAX_ROW:
                break
            page += 1
        return all_events


class EthereumInfusionClient:
    """Ethereum/Etherscan client for ERC-20 ENJ infusion reads."""

    def __init__(self, etherscan_api_key: str = "", alchemy_rpc_url: str = ""):
        self.etherscan_api_key = (etherscan_api_key or "").strip()
        self.alchemy_rpc_url = (alchemy_rpc_url or "").strip()
        self._session = requests.Session()
        self._session.headers.update({"Accept": "application/json"})
        self._last_etherscan_req = 0.0

    def _take_etherscan_token(self) -> None:
        elapsed = time.time() - self._last_etherscan_req
        if elapsed < ETHERSCAN_DELAY_SEC:
            time.sleep(ETHERSCAN_DELAY_SEC - elapsed)
        self._last_etherscan_req = time.time()

    def etherscan_api(self, params: Dict[str, str], allow_no_transactions: bool = False) -> dict:
        if not self.etherscan_api_key:
            raise RuntimeError("ETHERSCAN_API_KEY is not configured.")

        self._take_etherscan_token()
        merged = {"chainid": ETHERSCAN_CHAIN_ID, **params, "apikey": self.etherscan_api_key}
        try:
            resp = self._session.get(ETHERSCAN_API_URL, params=merged, timeout=REQUEST_TIMEOUT)
        except requests.exceptions.RequestException as e:
            raise RuntimeError(f"Etherscan request failed: {e}")

        if not resp.ok:
            raise RuntimeError(f"Etherscan API returned HTTP {resp.status_code}.")

        try:
            body = resp.json()
        except Exception:
            raise RuntimeError("Etherscan returned an invalid JSON response.")

        if (
            body.get("status") == "0"
            and allow_no_transactions
            and re.search(r"no transactions found", str(body.get("result") or body.get("message") or ""), re.I)
        ):
            return {**body, "result": []}

        if body.get("status") == "0":
            raise RuntimeError(str(body.get("result") or body.get("message") or "Etherscan API returned an error."))
        if body.get("error"):
            err = body["error"]
            raise RuntimeError(str(err.get("message") if isinstance(err, dict) else err))
        return body

    def _rpc_call(self, label: str, url: str, data: str) -> Tuple[str, str]:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_call",
            "params": [{"to": ENJIN_ERC1155_CONTRACT, "data": data}, "latest"],
        }
        try:
            resp = self._session.post(
                url,
                headers={"Content-Type": "application/json", "Accept": "application/json"},
                data=json.dumps(payload),
                timeout=12,
            )
        except requests.exceptions.RequestException as e:
            raise RuntimeError(str(e))

        try:
            body = resp.json()
        except Exception:
            body = {}

        if not resp.ok:
            raise RuntimeError(str(body.get("error") or f"HTTP {resp.status_code}"))
        if body.get("error"):
            err = body["error"]
            raise RuntimeError(str(err.get("message") if isinstance(err, dict) else err))

        result = body.get("result") or ""
        if not result:
            raise RuntimeError("RPC returned an empty result.")
        return label, result

    def _etherscan_eth_call(self, data: str) -> Tuple[str, str]:
        body = self.etherscan_api({
            "module": "proxy",
            "action": "eth_call",
            "to": ENJIN_ERC1155_CONTRACT,
            "data": data,
            "tag": "latest",
        })
        result = body.get("result") or ""
        if not result:
            raise RuntimeError("Etherscan returned an empty eth_call result.")
        return "Etherscan", result

    def read_infusion(self, token_id: int) -> Tuple[int, str]:
        data = build_type_data_call(token_id)
        errors: List[str] = []

        if self.alchemy_rpc_url:
            try:
                parsed = urlparse(self.alchemy_rpc_url)
                if parsed.scheme != "https":
                    raise RuntimeError("ALCHEMY_ETH_RPC_URL must use https.")
                log_line("INFO", "Querying Alchemy")
                provider, result = self._rpc_call("Alchemy", self.alchemy_rpc_url, data)
                words = parse_uint256_words(result)
                return words[3], provider
            except Exception as e:
                errors.append(f"Alchemy: {e}")
                log_line("WARN", f"Alchemy: {e}")

        if self.etherscan_api_key:
            try:
                log_line("INFO", "Querying Etherscan")
                provider, result = self._etherscan_eth_call(data)
                words = parse_uint256_words(result)
                return words[3], provider
            except Exception as e:
                errors.append(f"Etherscan: {e}")
                log_line("WARN", f"Etherscan: {e}")

        for label, url in ETH_PUBLIC_RPC_ENDPOINTS:
            try:
                log_line("INFO", f"Querying {label}")
                provider, result = self._rpc_call(label, url, data)
                words = parse_uint256_words(result)
                return words[3], provider
            except Exception as e:
                errors.append(f"{label}: {e}")
                log_line("WARN", f"{label}: {e}")

        raise RuntimeError(f"All RPC endpoints failed. {' | '.join(errors)}")

    def fetch_current_wallet_tokens(self, owner: str) -> List[dict]:
        validate_eth_address(owner)
        balances: Dict[str, dict] = {}
        last_token_name = ""
        last_token_symbol = ""

        for page in range(1, ETHERSCAN_MAX_PAGES + 1):
            body = self.etherscan_api(
                {
                    "module": "account",
                    "action": "token1155tx",
                    "contractaddress": ENJIN_ERC1155_CONTRACT,
                    "address": owner,
                    "page": str(page),
                    "offset": str(ETHERSCAN_PAGE_SIZE),
                    "startblock": "0",
                    "endblock": "9999999999",
                    "sort": "asc",
                },
                allow_no_transactions=True,
            )
            transfers = body.get("result") if isinstance(body.get("result"), list) else []
            log_line("INFO", f"Etherscan transfer page {page}: {len(transfers)} row(s)")
            if not transfers:
                break

            for transfer in transfers:
                token_id = str(transfer.get("tokenID") or transfer.get("tokenId") or "").strip()
                if not re.fullmatch(r"\d+", token_id):
                    continue

                last_token_name = transfer.get("tokenName") or last_token_name
                last_token_symbol = transfer.get("tokenSymbol") or last_token_symbol
                current = balances.get(token_id) or {
                    "quantity": 0,
                    "tokenName": transfer.get("tokenName") or "",
                    "tokenSymbol": transfer.get("tokenSymbol") or "",
                }
                value = safe_int(transfer.get("tokenValue") or 1, 1)
                sender = str(transfer.get("from") or "").lower()
                recipient = str(transfer.get("to") or "").lower()
                normalized_owner = owner.lower()

                if sender == normalized_owner:
                    current["quantity"] -= value
                if recipient == normalized_owner:
                    current["quantity"] += value
                current["tokenName"] = transfer.get("tokenName") or current["tokenName"]
                current["tokenSymbol"] = transfer.get("tokenSymbol") or current["tokenSymbol"]
                balances[token_id] = current

            if len(transfers) < ETHERSCAN_PAGE_SIZE:
                break
            if page == ETHERSCAN_MAX_PAGES:
                raise RuntimeError(
                    f"Wallet transfer history exceeds {ETHERSCAN_MAX_PAGES * ETHERSCAN_PAGE_SIZE} rows; "
                    "unable to compute a complete current token list."
                )

        tokens = []
        for token_id, balance in balances.items():
            if balance["quantity"] <= 0:
                continue
            label = balance.get("tokenName") or balance.get("tokenSymbol") or last_token_name or last_token_symbol
            tokens.append({
                "tokenId": token_id,
                "name": f"{label} #{token_id}" if label else f"Token {truncate_token_id(token_id, 5, 5)}",
                "quantity": balance["quantity"],
                "owner": owner,
                "contractAddress": ENJIN_ERC1155_CONTRACT,
            })
        tokens.sort(key=lambda item: int(item["tokenId"]))
        return tokens

# ════════════════════════════════════════════════════════════════════════════════
# ASYNC WEBSOCKET RPC CLIENT
# ════════════════════════════════════════════════════════════════════════════════

class SubstrateRPC:
    """Async WebSocket JSON-RPC 2.0 client with concurrency semaphore."""

    def __init__(self, endpoint: str, concurrency: int = 3,
                 call_timeout: float = 15.0, connect_timeout: float = 10.0):
        self.endpoint        = endpoint
        self.call_timeout    = call_timeout
        self.connect_timeout = connect_timeout
        self._ws             = None
        self._pending: Dict[int, asyncio.Future] = {}
        self._id             = 0
        self._dead           = False
        self._sem            = asyncio.Semaphore(concurrency)
        self._recv_task      = None

    async def connect(self) -> None:
        for attempt in (1, 2):
            try:
                kwargs = {}
                if attempt == 2:
                    kwargs["ssl"] = _ssl_context_noverify()
                self._ws = await asyncio.wait_for(
                    websockets.connect(self.endpoint, ping_interval=20, ping_timeout=10, **kwargs),
                    timeout=self.connect_timeout,
                )
                if attempt == 2:
                    log_line("WARN", "Connected without SSL certificate verification.")
                break
            except Exception as e:
                if attempt == 1 and _is_ssl_error(e):
                    log_line("WARN", "SSL certificate verification failed — retrying without cert check.")
                    cprint("[yellow]SSL error: certificate could not be verified.[/yellow]")
                    cprint("[yellow]On macOS run 'Install Certificates' in your Python folder, or: pip install certifi[/yellow]")
                    cprint("[yellow]Falling back to unverified SSL for this session.[/yellow]")
                else:
                    raise
        self._recv_task = asyncio.create_task(self._receiver())

    async def _receiver(self) -> None:
        try:
            async for raw in self._ws:
                try:
                    parsed = json.loads(raw)
                    msgs = parsed if isinstance(parsed, list) else [parsed]
                    for m in msgs:
                        mid = m.get("id")
                        if mid is not None and mid in self._pending:
                            fut = self._pending.pop(mid)
                            if not fut.done():
                                if "error" in m:
                                    err = m["error"]
                                    fut.set_exception(Exception(
                                        str(err.get("message", "RPC error")) if isinstance(err, dict) else str(err)
                                    ))
                                else:
                                    fut.set_result(m.get("result"))
                except Exception:
                    pass
        except Exception:
            err = Exception("Connection closed")
            for fut in list(self._pending.values()):
                if not fut.done():
                    fut.set_exception(err)
            self._pending.clear()

    async def call(self, method: str, params: Optional[list] = None) -> Any:
        async with self._sem:
            return await self._raw_call(method, params or [])

    async def _raw_call(self, method: str, params: list) -> Any:
        if self._dead or not self._ws:
            raise Exception("Cancelled")
        self._id += 1
        mid = self._id
        loop = asyncio.get_event_loop()
        fut  = loop.create_future()
        self._pending[mid] = fut
        msg = json.dumps({"jsonrpc": "2.0", "id": mid, "method": method, "params": params})
        await self._ws.send(msg)
        try:
            return await asyncio.wait_for(asyncio.shield(fut), timeout=self.call_timeout)
        except asyncio.TimeoutError:
            self._pending.pop(mid, None)
            if not fut.done():
                fut.cancel()
            raise Exception(f"Timeout: {method}")

    def cancel(self) -> None:
        self._dead = True
        err = Exception("Cancelled")
        for fut in list(self._pending.values()):
            if not fut.done():
                fut.set_exception(err)
        self._pending.clear()

    async def close(self) -> None:
        self.cancel()
        if self._recv_task:
            self._recv_task.cancel()
            try:
                await self._recv_task
            except (Exception, asyncio.CancelledError):
                pass
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass

def run_async(coro):
    """Run an async coroutine from sync context."""
    return asyncio.run(coro)

# ════════════════════════════════════════════════════════════════════════════════
# STOP LISTENER
# ════════════════════════════════════════════════════════════════════════════════

_stop_event = threading.Event()


def _stdin_listener_thread() -> None:
    """Background thread: polls stdin every 0.25 s so it never blocks the main thread."""
    try:
        while not _stop_event.is_set():
            try:
                ready, _, _ = select.select([sys.stdin], [], [], 0.25)
            except (ValueError, OSError):
                break  # stdin closed
            if _stop_event.is_set():  # re-check after possibly waiting in select
                break
            if not ready:
                continue
            line = sys.stdin.readline()
            if not line:  # EOF
                break
            if line.strip().lower() in ("q", "quit", "s", "stop", "x"):
                _stop_event.set()
                break
    except Exception:
        pass


def start_stop_listener() -> None:
    """Arm the stop listener and print the usage hint to the user.

    No-op in batch mode: the listener blocks on stdin, which under systemd is
    /dev/null (or closed), and the hint would be noise in the journal.
    """
    _stop_event.clear()
    if _BATCH_MODE:
        return
    threading.Thread(target=_stdin_listener_thread, daemon=True).start()
    if HAS_RICH:
        console.print("[dim]  → Type [bold]q[/bold] + Enter at any time to stop the scan early.[/dim]")
    else:
        print("  → Type 'q' + Enter to stop the scan.")

# ════════════════════════════════════════════════════════════════════════════════
# ERA REFERENCE CSV
# ════════════════════════════════════════════════════════════════════════════════

def load_era_csv(csv_path: Optional[Path] = None) -> Dict[int, dict]:
    """Load relay-era-reference.csv → dict keyed by era number."""
    if csv_path is None:
        csv_path = Path(__file__).parent.parent / "public" / "relay-era-reference.csv"
    cache: Dict[int, dict] = {}
    if not csv_path.exists():
        return cache
    try:
        with open(csv_path, newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    era = int(row["era"])
                    sb  = int(row["start_block"]) if row.get("start_block") else None
                    eb_raw = row.get("end_block", "")
                    eb  = int(eb_raw) if eb_raw and eb_raw.strip() else None
                    cache[era] = {
                        "startBlock":     sb,
                        "endBlock":       eb,
                        "startBlockHash": row.get("start_block_hash") or None,
                        "startDateUtc":   row.get("start_datetime_utc") or None,
                        "endDateUtc":     row.get("end_datetime_utc") or None,
                    }
                except Exception:
                    continue
    except Exception:
        pass
    return cache

# ════════════════════════════════════════════════════════════════════════════════
# ERA BLOCK BINARY SEARCH (async helper)
# ════════════════════════════════════════════════════════════════════════════════

async def binary_search_era_start(rpc: SubstrateRPC, target_era: int,
                                   chain_head: int, era_key: str) -> Optional[int]:
    lo, hi, result = 1, chain_head, None
    while lo <= hi:
        mid = (lo + hi) // 2
        bh  = await rpc.call("chain_getBlockHash", [mid])
        if not bh or re.match(r"^0x0+$", bh):
            lo = mid + 1
            continue
        raw = await rpc.call("state_getStorage", [era_key, bh])
        era = decode_active_era(raw)
        if era is None:
            lo = mid + 1
        elif era < target_era:
            lo = mid + 1
        elif era > target_era:
            hi = mid - 1
        else:
            result = mid
            hi = mid - 1
    if result is None:
        return None
    # Walk left to exact first block
    while result > 1:
        pbh = await rpc.call("chain_getBlockHash", [result - 1])
        if not pbh:
            break
        pv = await rpc.call("state_getStorage", [era_key, pbh])
        if decode_active_era(pv) != target_era:
            break
        result -= 1
    return result

# ════════════════════════════════════════════════════════════════════════════════
# EXPORT FORMAT HELPERS
# ════════════════════════════════════════════════════════════════════════════════

# ════════════════════════════════════════════════════════════════════════════════
# SCAN EXPORT — the web app's import envelope
# ════════════════════════════════════════════════════════════════════════════════
#
# Replicates src/utils/scanExport.js + scanEnvelope.js so a scan written here
# loads in the web app's Staking Cadence -> Import tab. The rules that bite:
#
#  - Every Planck value is a DECIMAL STRING. The importer runs each through
#    parseBigInt, which accepts only /^\+?\d+$/ — an int would serialise fine but
#    a suffixed or signed value would be rejected. planck_str() enforces this.
#  - Era arrays are de-duplicated and sorted NEWEST FIRST (intArray in
#    scanExport.js).
#  - meta.filter is OMITTED entirely rather than written as null, so an
#    unfiltered export is byte-identical to one written by the web app.
#  - Validator exports OMIT missedEras: enrichValidators recomputes it on import,
#    and persisting it would hide a disagreement between the two.
#  - Pool exports DO store missedEras, and omit eraValidatorBreakdown, which the
#    web app rebuilds from completedEras.

CLI_VERSION = "1.0.0"

SCAN_TOOL_ID = "enjinsight"
SCAN_SCHEMA_VERSION = 1
SCAN_SCHEMAS = {
    "validator": "staking-cadence-validator",
    "pool":      "staking-cadence-pool",
}
_FILENAME_STEMS = {
    SCAN_SCHEMAS["validator"]: "enjin_staking_validator",
    SCAN_SCHEMAS["pool"]:      "enjin_staking_pool",
}


def default_scan_filename(schema: str) -> str:
    stem = _FILENAME_STEMS.get(schema, "enjin_scan")
    return f"{stem}_{int(time.time())}.json"


def _era_array(vals) -> List[int]:
    """De-duplicated integer era array, newest first (intArray in scanExport.js)."""
    seen = set()
    for v in vals or []:
        n = safe_int(v)
        if n:
            seen.add(n)
    return sorted(seen, reverse=True)


def _envelope_header(schema: str) -> dict:
    if schema not in _FILENAME_STEMS:
        raise ValueError(f"Unknown scan schema: {schema}")
    return {
        "tool":          SCAN_TOOL_ID,
        "schema":        schema,
        "schemaVersion": SCAN_SCHEMA_VERSION,
        # Informational only and ungated by the importer (scanEnvelope.js:78), so
        # the web app's provenance banner names the tool that wrote the file.
        "appVersion":    f"enjinsight-cli@{CLI_VERSION}",
        "exportedAt":    datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") +
                         f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z",
    }


def build_validator_envelope(result: dict) -> dict:
    rows = []
    for v in result["validators"]:
        rows.append({
            "address":         str(v.get("address") or ""),
            "display":         str(v.get("display") or ""),
            "commission":      float(v.get("commission") or 0),
            "bondedTotal":     planck_str(v.get("bondedTotal")),
            "countNominators": safe_int(v.get("countNominators")),
            "isActive":        bool(v.get("isActive")),
            "fetchStatus":     str(v.get("fetchStatus") or "done"),
            "lastError":       (str(v["lastError"]) if v.get("lastError") else None),
            "nominators": ([
                {"address": str(n.get("address") or ""),
                 "display": str(n.get("display") or ""),
                 "bonded":  planck_str(n.get("bonded"))}
                for n in v["nominators"]
            ] if isinstance(v.get("nominators"), list) else None),
            "eraStat": ([
                {"era":            safe_int(e.get("era")),
                 "reward":         planck_str(e.get("reward")),
                 "validatorStake": planck_str(e.get("validatorStake")),
                 "nominatorStake": planck_str(e.get("nominatorStake")),
                 "startBlock":     safe_int(e.get("startBlock")),
                 "endBlock":       safe_int(e.get("endBlock")),
                 "rewardPoint":    safe_int(e.get("rewardPoint")),
                 "blocksProduced": safe_int(e.get("blocksProduced"))}
                for e in v["eraStat"]
            ] if isinstance(v.get("eraStat"), list) else None),
        })
    env = _envelope_header(SCAN_SCHEMAS["validator"])
    env["meta"] = {
        "requestedEraCount": safe_int(result.get("era_count")),
        "validatorCount":    len(rows),
    }
    env["data"] = {"validators": rows}
    return env


def build_pool_envelope(result: dict) -> dict:
    rows = []
    for p in result["pools"]:
        rows.append({
            "poolId":        safe_int(p.get("poolId")),
            "metadata":      str(p.get("metadata") or ""),
            "state":         str(p.get("state") or ""),
            "stashAddress":  str(p.get("stashAddress") or ""),
            "stashDisplay":  str(p.get("stashDisplay") or ""),
            "rewardAddress": str(p.get("rewardAddress") or ""),
            "rewardDisplay": str(p.get("rewardDisplay") or ""),
            "memberCount":   safe_int(p.get("memberCount")),
            "totalBonded":   planck_str(p.get("totalBonded")),
            "commission":    float(p.get("commission") or 0),
            "fetchStatus":   str(p.get("fetchStatus") or "done"),
            "nominatedValidators": ([
                {"address":       str(v.get("address") or ""),
                 "display":       str(v.get("display") or ""),
                 "bonded":        planck_str(v.get("bonded")),
                 "isActive":      bool(v.get("isActive")),
                 "fetchStatus":   str(v.get("fetchStatus") or "done"),
                 "retryAttempts": safe_int(v.get("retryAttempts")),
                 "lastError":     (str(v["lastError"]) if v.get("lastError") else None)}
                for v in p["nominatedValidators"]
            ] if isinstance(p.get("nominatedValidators"), list) else None),
            "eraRewards": ([
                {"era":            safe_int(r.get("era")),
                 "amount":         planck_str(r.get("amount")),
                 "blockTimestamp": safe_int(r.get("blockTimestamp")),
                 "eventIndex":     str(r.get("eventIndex") or ""),
                 "validatorStash": str(r.get("validatorStash") or "")}
                for r in p["eraRewards"]
            ] if isinstance(p.get("eraRewards"), list) else None),
            "missedEras": _era_array(p.get("missedEras")),
        })
    completed = _era_array(result.get("completed_eras"))
    prov = result.get("provisional_era")
    env = _envelope_header(SCAN_SCHEMAS["pool"])
    env["meta"] = {
        "requestedEraCount":  safe_int(result.get("era_count")),
        "provisionalEra":     (safe_int(prov) if prov is not None else None),
        "completedEras":      completed,
        "latestCompletedEra": safe_int(result.get("latest_completed")),
        "poolCount":          len(rows),
    }
    env["data"] = {"pools": rows}
    return env


def build_scan_envelope(result: dict) -> dict:
    if result.get("mode") == "validator":
        return build_validator_envelope(result)
    if result.get("mode") == "pool":
        return build_pool_envelope(result)
    raise ValueError(f"Cannot build an envelope for mode {result.get('mode')!r}")


def write_scan_json(result: dict, path: str) -> str:
    """Write the web-app import envelope for a scan result. Returns the path."""
    env = build_scan_envelope(result)
    # indent=2 + ensure_ascii=False matches JSON.stringify(env, null, 2).
    text = json.dumps(env, indent=2, ensure_ascii=False)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    log_line("OK", f"Exported to {path} ({len(text.encode('utf-8'))} bytes)")
    return path


def ask_scan_export_format(legacy: Tuple[str, ...] = ("csv",)) -> str:
    """Choose a scan export format. JSON is the web app's import envelope."""
    opts = ["json"] + list(legacy)
    labels = {
        "json": "JSON  — EnjinSight scan export (re-importable in the web app)",
        "csv":  "CSV   — comma-separated, spreadsheet-compatible",
        "xml":  "XML   — tagged markup",
    }
    cprint("\n[bold]Export format:[/bold]")
    for i, o in enumerate(opts, 1):
        cprint(f"  {i}. {labels[o]}")
    return opts[ask_int("Format", default=1, min_val=1, max_val=len(opts)) - 1]


def ask_export_format() -> str:
    """Prompt the user to choose an export format. Returns 'csv', 'json', or 'xml'."""
    cprint("\n[bold]Export format:[/bold]")
    cprint("  1. CSV   — comma-separated, spreadsheet-compatible")
    cprint("  2. JSON  — structured, machine-readable")
    cprint("  3. XML   — tagged markup")
    fmt_choice = ask_int("Format", default=1, min_val=1, max_val=3)
    return {1: "csv", 2: "json", 3: "xml"}[fmt_choice]


def _xml_escape(v: str) -> str:
    return (str(v)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&apos;"))


def export_balance_records(records: List[dict], addr: str, start_block: int, end_block: int,
                            fmt: str, endpoint: str = "") -> None:
    """Export balance records in the format expected by the web app's Balance Viewer import."""
    base  = f"balance_{addr[:8]}_{start_block}-{end_block}"
    fname = ask("Filename", f"{base}.{fmt}")
    now   = datetime.now(timezone.utc).isoformat()

    # Convert a record to the canonical field set the web app parses
    def to_row(r: dict) -> dict:
        return {
            "block":         r["block"],
            "blockHash":     r.get("blockHash", ""),
            "free":          str(r["free"]),
            "reserved":      str(r["reserved"]),
            "miscFrozen":    str(r["miscFrozen"]),
            "feeFrozen":     str(r["feeFrozen"]),
            "nonce":         r.get("nonce", 0),
            "newFormat":     r.get("newFormat", False),
            "free_enj":      r["free"]       / PLANCK_PER_ENJ,
            "reserved_enj":  r["reserved"]   / PLANCK_PER_ENJ,
            "miscFrozen_enj":r["miscFrozen"] / PLANCK_PER_ENJ,
            "feeFrozen_enj": r["feeFrozen"]  / PLANCK_PER_ENJ,
        }

    HEADERS = ["block", "blockHash", "free", "reserved", "miscFrozen", "feeFrozen",
               "nonce", "newFormat", "free_enj", "reserved_enj", "miscFrozen_enj", "feeFrozen_enj"]

    try:
        if fmt == "csv":
            esc = lambda v: f'"{str(v).replace(chr(34), chr(34)+chr(34))}"'
            comments = [
                "# enjin_balance_export",
                f"# endpoint: {endpoint}",
                f"# address: {addr}",
                f"# exportedAt: {now}",
            ]
            lines = [
                *comments,
                ",".join(HEADERS),
                *[",".join(esc(to_row(r)[k]) for k in HEADERS) for r in records],
            ]
            with open(fname, "w", encoding="utf-8", newline="\r\n") as f:
                f.write("\r\n".join(lines))
        elif fmt == "json":
            export_obj = {
                "_rpcConfig": {"endpoint": endpoint, "address": addr, "exportedAt": now},
                "records": [to_row(r) for r in records],
            }
            with open(fname, "w", encoding="utf-8") as f:
                json.dump(export_obj, f, indent=2)
        elif fmt == "xml":
            ex = _xml_escape
            rpc_xml = (
                "  <rpcConfig>\n"
                f"    <endpoint>{ex(endpoint)}</endpoint>\n"
                f"    <address>{ex(addr)}</address>\n"
                f"    <exportedAt>{ex(now)}</exportedAt>\n"
                "  </rpcConfig>"
            )
            rows = "\n".join(
                "  <record>\n"
                + "\n".join(f"    <{k}>{ex(str(to_row(r)[k]))}</{k}>" for k in HEADERS)
                + "\n  </record>"
                for r in records
            )
            with open(fname, "w", encoding="utf-8") as f:
                f.write(f'<?xml version="1.0" encoding="UTF-8"?>\n<enjinBalanceHistory>\n{rpc_xml}\n{rows}\n</enjinBalanceHistory>')
        log_line("OK", f"Exported {len(records)} records to {fname}")
    except Exception as e:
        log_line("ERR", f"Export failed: {e}")


def export_reward_records(results: List[dict], addr: str, start_era: int, end_era: int,
                           fmt: str) -> None:
    """Export reward history records in the format expected by the web app's Reward History import."""
    base  = f"rewards_{addr[:8]}_{start_era}-{end_era}"
    fname = ask("Filename", f"{base}.{fmt}")
    now   = datetime.now(timezone.utc).isoformat()

    # Column names must exactly match what parseRewardImport() reads from the web app
    HEADERS = ["era", "pool_id", "pool_label", "era_start_block", "era_date_utc",
               "member_senj", "pool_supply_senj", "reinvested_enj", "reward_enj",
               "cumulative_enj", "apy_pct", "rolling_apy_pct"]

    def to_row(r: dict) -> dict:
        date_utc = (r.get("startDateUtc") or "")
        # The web app expects a date-only (YYYY-MM-DD) or ISO string → slice to 10
        if date_utc and len(date_utc) > 10:
            date_utc = date_utc[:10]
        return {
            "era":             r["era"],
            "pool_id":         r["poolId"],
            "pool_label":      r["poolLabel"],
            "era_start_block": r.get("eraStartBlock", ""),
            "era_date_utc":    date_utc,
            "member_senj":     str(r["memberBalance"]),    # planck
            "pool_supply_senj":str(r["poolSupply"]),       # planck
            "reinvested_enj":  str(r["reinvested"]),       # planck
            "reward_enj":      str(r["reward"]),           # planck
            "cumulative_enj":  str(r["accumulated"]),      # planck
            "apy_pct":         f"{r['apy']:.4f}",
            "rolling_apy_pct": "",
        }

    try:
        if fmt == "csv":
            esc = lambda v: f'"{str(v).replace(chr(34), chr(34)+chr(34))}"'
            comments = [
                "# enjin_reward_history_export",
                f"# address: {addr}",
                f"# exportedAt: {now}",
            ]
            lines = [
                *comments,
                ",".join(HEADERS),
                *[",".join(esc(to_row(r)[k]) for k in HEADERS) for r in results],
            ]
            with open(fname, "w", encoding="utf-8", newline="\r\n") as f:
                f.write("\r\n".join(lines))
        elif fmt == "json":
            export_obj = {
                "_meta": {"address": addr, "exportedAt": now},
                "records": [to_row(r) for r in results],
            }
            with open(fname, "w", encoding="utf-8") as f:
                json.dump(export_obj, f, indent=2)
        elif fmt == "xml":
            ex = _xml_escape
            meta_xml = (
                "  <meta>\n"
                f"    <address>{ex(addr)}</address>\n"
                f"    <exportedAt>{ex(now)}</exportedAt>\n"
                "  </meta>"
            )
            rows = "\n".join(
                "  <record>\n"
                + "\n".join(f"    <{k}>{ex(str(to_row(r)[k]))}</{k}>" for k in HEADERS)
                + "\n  </record>"
                for r in results
            )
            with open(fname, "w", encoding="utf-8") as f:
                f.write(f'<?xml version="1.0" encoding="UTF-8"?>\n<enjinRewardHistory>\n{meta_xml}\n{rows}\n</enjinRewardHistory>')
        log_line("OK", f"Exported {len(results)} records to {fname}")
    except Exception as e:
        log_line("ERR", f"Export failed: {e}")


def _resolve_era_blocks(era_csv: Dict[int, dict], start_era: int, end_era: int
                        ) -> Tuple[Optional[int], Optional[int]]:
    """Resolve (start_block, end_block) from era CSV for the given era range."""
    start_row = era_csv.get(start_era, {})
    end_row   = era_csv.get(end_era, {})
    sb = start_row.get("startBlock")
    eb = end_row.get("endBlock") or (end_row.get("startBlock", 0) + 14399 if end_row.get("startBlock") else None)
    return sb, eb


def _find_era_for_date_str(era_csv: Dict[int, dict], date_str: str, end_of_day: bool = False
                           ) -> Optional[int]:
    """Find the era whose startDateUtc is closest to (but not after) the given YYYY-MM-DD string."""
    try:
        target_dt = datetime.fromisoformat(date_str)
    except ValueError:
        return None
    best_era: Optional[int] = None
    for era, row in sorted(era_csv.items()):
        utc_str = row.get("startDateUtc") or ""
        if not utc_str:
            continue
        try:
            # Format: "2024-08-12 12:34:56 UTC"
            clean = utc_str.replace(" UTC", "").replace("UTC", "").strip()
            era_dt = datetime.fromisoformat(clean)
        except ValueError:
            continue
        if end_of_day:
            from datetime import timedelta
            cmp_dt = target_dt + timedelta(days=1)
        else:
            cmp_dt = target_dt
        if era_dt <= cmp_dt:
            best_era = era
    return best_era


# ════════════════════════════════════════════════════════════════════════════════
# ANALYSIS HELPERS
# ════════════════════════════════════════════════════════════════════════════════

def compute_missed_eras(era_stat: List[dict], latest_era: int, era_count: int) -> List[int]:
    expected = set(range(latest_era - era_count + 1, latest_era + 1))
    received = {safe_int(e.get("era")) for e in era_stat}
    return sorted(expected - received, reverse=True)

def compute_pool_missed_eras(era_rewards: List[dict], latest_era: int, era_count: int) -> List[int]:
    expected = set(range(latest_era - era_count + 1, latest_era + 1))
    received = {safe_int(r.get("era")) for r in era_rewards}
    return sorted(expected - received, reverse=True)

def get_severity(missed: int) -> str:
    if missed == 0:   return "none"
    if missed <= 2:   return "low"
    if missed <= 5:   return "medium"
    return "high"

def find_consecutive_groups(missed_eras: List[int]) -> List[List[int]]:
    if not missed_eras:
        return []
    srt = sorted(missed_eras, reverse=True)
    groups, group = [], [srt[0]]
    for i in range(1, len(srt)):
        if srt[i-1] - srt[i] == 1:
            group.append(srt[i])
        else:
            if len(group) >= CONSECUTIVE_MISS_THRESHOLD:
                groups.append(group)
            group = [srt[i]]
    if len(group) >= CONSECUTIVE_MISS_THRESHOLD:
        groups.append(group)
    return groups

class ScanError(RuntimeError):
    """A scan could not be completed. Carries a message fit for a log line."""


def planck_str(v) -> str:
    """Subscan Planck amount -> a decimal string of digits only.

    Mirrors the web app's `BigInt(String(x).replace(/[^0-9]/g, '') || '0')`
    (useValidatorChecker.js:291). The web app's importer runs every Planck field
    through `parseBigInt`, which rejects anything but /^\\+?\\d+$/ — so a value
    carrying a unit suffix, a sign or a decimal point must be stripped here or
    the export will not import.
    """
    digits = "".join(ch for ch in str(v if v is not None else "0") if ch.isdigit())
    return digits or "0"


def count_unique_blocks(raw) -> int:
    """Distinct blocks produced in an era, from Subscan's `block_produced`.

    Matches countUniqueBlocks in useValidatorChecker.js:363 — the field arrives
    as either a list or a delimited string depending on the endpoint version.
    """
    if not raw:
        return 0
    if isinstance(raw, (list, tuple, set)):
        return len({str(x) for x in raw})
    if isinstance(raw, str):
        return len({part.strip() for part in re.split(r"[,\s]+", raw) if part.strip()})
    return 0


def determine_active(v: dict) -> bool:
    raw = v.get("status") or v.get("is_active") or v.get("active") or ""
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, int):
        return raw == 1
    s = str(raw).lower().strip()
    if s in ("active", "validating", "validator", "1"):
        return True
    if s in ("inactive", "disabled", "chilled", "0"):
        return False
    if safe_int(v.get("rank_validator")) > 0:
        return True
    if safe_int(v.get("latest_mining")) > 0:
        return True
    return False

# ════════════════════════════════════════════════════════════════════════════════
# TOOL 1: ERA BLOCK EXPLORER
# ════════════════════════════════════════════════════════════════════════════════

STAKING_CANDIDATES = ["Staking","EnjinStaking","ParachainStaking","RelayStaking","PoAStaking"]
STAKING_ERA_ITEMS  = ["ActiveEra","CurrentEra","active_era","current_era"]
SESSION_CANDIDATES = ["Session","EnjinSession","ParachainSession"]
SESSION_IDX_ITEMS  = ["CurrentIndex","current_index","Index"]

async def _era_explorer_main(archive_wss: str, live_wss: str, era_csv: Dict[int, dict]) -> None:
    cprint("\n[bold cyan]Connecting to archive node to discover chain state…[/bold cyan]")

    rpc = SubstrateRPC(archive_wss, concurrency=3)
    await rpc.connect()
    log_line("OK", f"Connected to archive: {archive_wss}")

    # Discover staking/session keys
    era_key     = None
    session_key = None
    current_era = None
    current_session = None

    for pallet in STAKING_CANDIDATES:
        if era_key:
            break
        for item in STAKING_ERA_ITEMS:
            key = storage_key(pallet, item)
            try:
                raw = await rpc.call("state_getStorage", [key])
                if raw:
                    era_val = decode_active_era(raw)
                    if era_val is not None:
                        era_key     = key
                        current_era = era_val
                        log_line("OK", f"Staking: {pallet}.{item}  era={era_val}")
                        break
            except Exception:
                pass

    for pallet in SESSION_CANDIDATES:
        if session_key:
            break
        for item in SESSION_IDX_ITEMS:
            key = storage_key(pallet, item)
            try:
                raw = await rpc.call("state_getStorage", [key])
                if raw:
                    v = decode_u32(raw)
                    if v is not None:
                        session_key     = key
                        current_session = v
                        log_line("OK", f"Session: {pallet}.{item}  session={v}")
                        break
            except Exception:
                pass

    # Get chain head
    hdr = await rpc.call("chain_getHeader", [])
    chain_head = int(hdr["number"], 16) if hdr and hdr.get("number") else 0
    log_line("INFO", f"Chain head: {chain_head:,}")

    # Binary search era start block
    era_start_block = None
    if era_key and current_era is not None:
        # Check CSV first
        csv_row = era_csv.get(current_era)
        if csv_row and csv_row.get("startBlock"):
            era_start_block = csv_row["startBlock"]
            log_line("OK", f"Era {current_era} start block (CSV): {era_start_block:,}")
        else:
            log_line("INFO", f"Binary-searching era {current_era} start block…")
            era_start_block = await binary_search_era_start(rpc, current_era, chain_head, era_key)
            if era_start_block:
                log_line("OK", f"Era {current_era} start block: {era_start_block:,}")
            else:
                log_line("WARN", "Era start block not found via binary search.")

    await rpc.close()

    # Display current state
    if HAS_RICH:
        table = Table(title="Current Chain State", border_style="cyan")
        table.add_column("Field", style="bold")
        table.add_column("Value")
        table.add_row("Archive Node", archive_wss)
        table.add_row("Current Era", str(current_era) if current_era is not None else "—")
        table.add_row("Current Session", str(current_session) if current_session is not None else "—")
        table.add_row("Chain Head", f"{chain_head:,}")
        table.add_row("Era Start Block", f"{era_start_block:,}" if era_start_block else "—")
        if era_start_block and chain_head:
            progress = chain_head - era_start_block
            table.add_row("Blocks into Era", f"{progress:,}")
        console.print(table)
    else:
        print(f"\nEra: {current_era}  Session: {current_session}  Head: {chain_head:,}  Era Start: {era_start_block}")

    # Historical lookup
    while True:
        cprint("\n[bold]Options:[/bold]")
        cprint("  1. Look up a specific era")
        cprint("  2. Return to main menu")
        choice = ask("Choice", "2")
        if choice == "1":
            era_num = ask_int("Era number", default=current_era or 1000, min_val=1)
            csv_row = era_csv.get(era_num)
            if csv_row and csv_row.get("startBlock"):
                row = csv_row
                src = "CSV"
            else:
                log_line("INFO", f"Era {era_num} not in CSV — querying archive node…")
                rpc2 = SubstrateRPC(archive_wss, concurrency=3)
                await rpc2.connect()
                sb = await binary_search_era_start(rpc2, era_num, chain_head, era_key) if era_key else None
                bh_val = None
                ts_val = None
                if sb:
                    bh_val = await rpc2.call("chain_getBlockHash", [sb])
                    ts_raw = await rpc2.call("state_getStorage", [TIMESTAMP_NOW_KEY, bh_val]) if bh_val else None
                    ts_ms  = decode_timestamp_ms(ts_raw)
                    ts_val = ms_to_utc(ts_ms) if ts_ms else None
                await rpc2.close()
                row = {"startBlock": sb, "startBlockHash": bh_val, "startDateUtc": ts_val, "endBlock": None}
                src = "RPC"

            if HAS_RICH:
                t2 = Table(title=f"Era {era_num} (source: {src})", border_style="green")
                t2.add_column("Field", style="bold")
                t2.add_column("Value")
                t2.add_row("Start Block", str(row.get("startBlock") or "—"))
                t2.add_row("End Block",   str(row.get("endBlock") or "—"))
                t2.add_row("Start Hash",  str(row.get("startBlockHash") or "—"))
                t2.add_row("Start Date",  str(row.get("startDateUtc") or "—"))
                t2.add_row("End Date",    str(row.get("endDateUtc") or "—"))
                console.print(t2)
            else:
                print(f"\nEra {era_num}: start={row.get('startBlock')}  end={row.get('endBlock')}  date={row.get('startDateUtc')}")
        else:
            break

async def era_explorer_async(era_csv: Dict[int, dict]) -> None:
    cprint("\n[bold cyan]── Era Block Explorer ──[/bold cyan]")
    cprint(f"Archive node: {ARCHIVE_WSS}")
    cprint(f"Live node:    {LIVE_RPC_WSS}")
    await _era_explorer_main(ARCHIVE_WSS, LIVE_RPC_WSS, era_csv)

def tool_era_explorer(era_csv: Dict[int, dict]) -> None:
    run_async(era_explorer_async(era_csv))

# ════════════════════════════════════════════════════════════════════════════════
# TOOL 2: VALIDATOR REWARD CADENCE
# ════════════════════════════════════════════════════════════════════════════════

def scan_validators(subscan: SubscanClient, era_count: int, limit: Optional[int] = None) -> dict:
    """Run the validator cadence scan.

    Contains no prompts and no rendering, so the interactive menu and the
    non-interactive runner share exactly one implementation of the scan.

    @raises ScanError when the scan cannot produce a result at all.
    """
    # Step 0: probe endpoints
    log_line("INFO", "Probing Subscan endpoints…")
    failed = []
    for key in ("validators", "nominators", "eraStat"):
        result = subscan.probe(ENDPOINTS[key])
        if result["ok"]:
            log_line("OK", f"{key}: reachable")
        else:
            log_line("ERR", f"{key}: {result['error']}")
            failed.append(key)
    if failed:
        raise ScanError(
            f"Subscan endpoint(s) unreachable: {', '.join(failed)}. Check SUBSCAN_API_KEY.")

    start_stop_listener()

    # Step 1: validator list. Deliberately a single page — fetch_validators does
    # not paginate, and the web app does not either, so both scan the same set.
    log_line("INFO", "Fetching validator list…")
    try:
        raw_vals = subscan.fetch_validators()
    except Exception as e:
        raise ScanError(f"Failed to fetch validators: {e}") from e
    if not raw_vals:
        raise ScanError("No validators returned by Subscan.")

    validators = []
    for v in raw_vals:
        addr = str(
            v.get("stash_account_display", {}).get("address") or
            v.get("account_display", {}).get("address") or
            v.get("stash") or ""
        )
        if not addr:
            continue
        validators.append({
            "address":         addr,
            "display":         str(v.get("stash_account_display", {}).get("display") or ""),
            "commission":      parse_commission(v.get("validator_prefs_value")),
            "bondedTotal":     planck_str(v.get("bonded_total")),
            "countNominators": safe_int(v.get("count_nominators")),
            "isActive":        determine_active(v),
            "fetchStatus":     "pending",
            "lastError":       None,
            "nominators":      None,
            "eraStat":         None,
            "missedEras":      [],
        })
    if limit:
        validators = validators[:limit]
        log_line("INFO", f"--limit {limit}: truncated to {len(validators)} validator(s).")
    log_line("OK", f"Found {len(validators)} validators.")

    stopped = False

    # Step 2: nominators (sequential, rate-limited)
    log_line("INFO", f"Fetching nominators for {len(validators)} validators…")
    for i, v in enumerate(validators):
        if _stop_event.is_set():
            log_line("WARN", "Scan stopped early by user.")
            stopped = True
            break
        try:
            lst = subscan.fetch_nominators(v["address"])
            v["nominators"] = [
                {"address": str(n.get("account_display", {}).get("address") or ""),
                 "display": str(n.get("account_display", {}).get("display") or ""),
                 "bonded":  planck_str(n.get("bonded"))}
                for n in lst
            ]
            log_line("OK", f"[{i+1}/{len(validators)}] {v['display'] or truncate_addr(v['address'])}: {len(v['nominators'])} nominator(s)")
        except Exception as e:
            log_line("WARN", f"[{i+1}/{len(validators)}] Nominators failed for {truncate_addr(v['address'])}: {e}")
            v["nominators"] = []

    # Step 3: era stats
    log_line("INFO", f"Fetching era stats (last {era_count} eras) for {len(validators)} validators…")
    for i, v in enumerate(validators):
        if _stop_event.is_set():
            log_line("WARN", "Scan stopped early by user.")
            stopped = True
            break
        try:
            lst = subscan.fetch_era_stat(v["address"], era_count)
            v["eraStat"] = [
                {"era":            safe_int(e.get("era")),
                 "reward":         planck_str(e.get("validator_reward_total") or e.get("reward")),
                 "validatorStake": planck_str(e.get("validator_stash_amount")),
                 "nominatorStake": planck_str(e.get("nominator_stash_amount")),
                 "rewardPoint":    safe_int(e.get("reward_point")),
                 "blocksProduced": count_unique_blocks(e.get("block_produced")),
                 "startBlock":     safe_int(e.get("start_block_num")),
                 "endBlock":       safe_int(e.get("end_block_num"))}
                for e in lst
            ]
            v["fetchStatus"] = "done"
            log_line("OK", f"[{i+1}/{len(validators)}] {v['display'] or truncate_addr(v['address'])}: {len(v['eraStat'])} era(s)")
        except Exception as e:
            v["eraStat"] = []
            v["fetchStatus"] = "failed"
            v["lastError"] = str(e)
            log_line("WARN", f"[{i+1}/{len(validators)}] Era stat failed for {truncate_addr(v['address'])}: {e}")

    # Compute missed eras
    all_eras = [e["era"] for v in validators for e in (v["eraStat"] or [])]
    latest_era = max(all_eras) if all_eras else 0
    if latest_era:
        for v in validators:
            if v["eraStat"]:
                v["missedEras"] = compute_missed_eras(v["eraStat"], latest_era, era_count)

    return {
        "mode":        "validator",
        "validators":  validators,
        "era_count":   era_count,
        "latest_era":  latest_era,
        "stopped":     stopped,
    }


def _render_validators(result: dict) -> None:
    """Print the validator scan result. Unchanged from the original layout."""
    validators = result["validators"]
    latest_era = result["latest_era"]

    cprint(f"\n[bold green]── Results (latest era: {latest_era}) ──[/bold green]")
    if HAS_RICH:
        t = Table(title="Validator Summary", border_style="cyan", show_lines=True)
        t.add_column("Validator",   style="bold", max_width=30)
        t.add_column("Active",      justify="center")
        t.add_column("Commission",  justify="right")
        t.add_column("Nominators",  justify="right")
        t.add_column("Missed Eras", justify="center")
        t.add_column("Severity",    justify="center")
        for v in validators:
            missed = len(v["missedEras"])
            sev    = get_severity(missed)
            sev_color = {"none": "green", "low": "yellow", "medium": "orange3", "high": "red"}.get(sev, "white")
            nom_count = len(v["nominators"]) if v["nominators"] is not None else "?"
            t.add_row(
                v["display"] or truncate_addr(v["address"]),
                "✓" if v["isActive"] else "✗",
                f"{v['commission']:.2f}%",
                str(nom_count),
                str(missed) if missed else "—",
                f"[{sev_color}]{sev}[/{sev_color}]",
            )
        console.print(t)
    else:
        print(f"\n{'Validator':<30} {'Active':^6} {'Comm':>6} {'Noms':>5} {'Missed':>6} {'Sev'}")
        for v in validators:
            missed = len(v["missedEras"])
            print(f"{(v['display'] or truncate_addr(v['address'])):<30} "
                  f"{'Y' if v['isActive'] else 'N':^6} {v['commission']:>6.2f}% "
                  f"{len(v['nominators'] or []):>5} {missed:>6} {get_severity(missed)}")

    # Details for validators with misses
    missed_vals = [v for v in validators if v["missedEras"]]
    if missed_vals:
        cprint(f"\n[yellow]── Validators with missed eras ({len(missed_vals)}) ──[/yellow]")
        for v in missed_vals:
            groups = find_consecutive_groups(v["missedEras"])
            desc   = f"Missed: {sorted(v['missedEras'])}"
            if groups:
                desc += f"  ({len(groups)} consecutive streak(s))"
            log_line("WARN", f"{v['display'] or truncate_addr(v['address'])}: {desc}")


def tool_validator_checker(subscan: SubscanClient) -> None:
    cprint("\n[bold cyan]── Validator Reward Cadence ──[/bold cyan]")
    era_count = ask_int("How many recent eras to check?", default=2, min_val=1, max_val=100)

    try:
        result = scan_validators(subscan, era_count)
    except ScanError as e:
        cprint(f"[red]{e}[/red]")
        return

    _render_validators(result)

    validators = result["validators"]
    if validators and confirm("\nExport results?", default=False):
        fmt = ask_scan_export_format()
        if fmt == "json":
            write_scan_json(result, ask("Filename", default_scan_filename(SCAN_SCHEMAS["validator"])))
        else:
            _export_validators_csv(validators, era_count, result["latest_era"])


def _export_validators_csv(validators: List[dict], era_count: int, latest_era: int) -> None:
    fname = ask("Filename", f"validators_{latest_era}.csv")
    try:
        with open(fname, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["address", "display", "active", "commission_pct", "nominator_count",
                        "missed_era_count", "missed_eras", "severity"])
            for v in validators:
                missed = v["missedEras"]
                w.writerow([
                    v["address"], v["display"], "yes" if v["isActive"] else "no",
                    v["commission"], len(v["nominators"] or []),
                    len(missed), ";".join(str(e) for e in sorted(missed)), get_severity(len(missed)),
                ])
        log_line("OK", f"Exported to {fname}")
    except Exception as e:
        log_line("ERR", f"Export failed: {e}")

# ════════════════════════════════════════════════════════════════════════════════
# TOOL 3: POOL REWARD CADENCE
# ════════════════════════════════════════════════════════════════════════════════

import random

def scan_pools(subscan: SubscanClient, era_count: int, limit: Optional[int] = None) -> dict:
    """Run the nomination-pool cadence scan.

    Contains no prompts and no rendering, so the interactive menu and the
    non-interactive runner share exactly one implementation of the scan.

    @raises ScanError when the scan cannot produce a result at all.
    """
    # Step 0: probe endpoints
    log_line("INFO", "Probing Subscan endpoints…")
    failed = []
    for key in ("pools", "voted", "rewardSlash"):
        result = subscan.probe(ENDPOINTS[key])
        if result["ok"]:
            log_line("OK", f"{key}: reachable")
        else:
            log_line("ERR", f"{key}: {result['error']}")
            failed.append(key)
    if failed:
        raise ScanError(
            f"Subscan endpoint(s) unreachable: {', '.join(failed)}. Check SUBSCAN_API_KEY.")

    start_stop_listener()

    # Step 1: pools
    log_line("INFO", "Fetching nomination pools…")
    try:
        raw_pools = subscan.fetch_all_pools(
            on_page=lambda pg, cnt: log_line("INFO", f"Pools page {pg}: {cnt} pool(s)"))
    except Exception as e:
        raise ScanError(f"Failed to fetch pools: {e}") from e
    if not raw_pools:
        raise ScanError("No nomination pools returned by Subscan.")

    pools = []
    for p in raw_pools:
        addr = str(p.get("pool_account", {}).get("address") or "")
        if not addr:
            continue
        pools.append({
            "poolId":        safe_int(p.get("pool_id")),
            "metadata":      str(p.get("metadata") or ""),
            "state":         str(p.get("state") or "Unknown"),
            "stashAddress":  addr,
            "stashDisplay":  str(p.get("pool_account", {}).get("display") or ""),
            "rewardAddress": str(p.get("pool_reward_account", {}).get("address") or ""),
            "rewardDisplay": str(p.get("pool_reward_account", {}).get("display") or ""),
            "memberCount":   safe_int(p.get("member_count")),
            "totalBonded":   planck_str(p.get("total_bonded")),
            "commission":    parse_commission(p.get("commission")),
            "fetchStatus":   "pending",
            "nominatedValidators": None,
            "eraRewards":    None,
            "missedEras":    [],
        })
    if limit:
        pools = pools[:limit]
        log_line("INFO", f"--limit {limit}: truncated to {len(pools)} pool(s).")
    log_line("OK", f"Found {len(pools)} pool(s).")

    stopped = False

    # Step 2: nominated validators
    log_line("INFO", "Fetching nominated validators for each pool…")
    all_validators: List[dict] = []

    for i, p in enumerate(pools):
        if _stop_event.is_set():
            log_line("WARN", "Scan stopped early by user.")
            stopped = True
            break
        try:
            lst = subscan.fetch_voted(p["stashAddress"])
            validators = []
            for v in lst:
                vdisp_obj = v.get("stash_account_display", {}) or {}
                vaddr = str(vdisp_obj.get("address") or "")
                parent = vdisp_obj.get("parent")
                if parent:
                    vdisp = f"{parent.get('display', '')} / {parent.get('sub_symbol', '')}".strip(" /")
                else:
                    vdisp = str(vdisp_obj.get("display") or "")
                validators.append({
                    "address":       vaddr,
                    "display":       vdisp,
                    "bonded":        planck_str(v.get("bonded")),
                    "isActive":      v.get("active") is True or ("active" not in v and not str(v.get("status") or "")),
                    "fetchStatus":   "done",
                    "retryAttempts": 0,
                    "lastError":     None,
                })
            p["nominatedValidators"] = validators
            for v in validators:
                if v["address"]:
                    all_validators.append(v)
            log_line("OK", f"[{i+1}/{len(pools)}] Pool #{p['poolId']}: {len(validators)} validator(s)")
        except Exception as e:
            log_line("WARN", f"[{i+1}/{len(pools)}] Pool #{p['poolId']}: voted fetch failed — {e}")
            p["nominatedValidators"] = []
            p["fetchStatus"] = "error"

    # Deduplicate validators
    seen: Set[str] = set()
    unique_validators = []
    for v in all_validators:
        if v["address"] not in seen:
            seen.add(v["address"])
            unique_validators.append(v)

    # Step 3: Resolve era block ranges via consensus.
    # NOTE: the cadence scan resolves era block ranges from Subscan era_stat
    # alone — it needs neither the era reference CSV nor an archive node. Several
    # validators are sampled and their era -> {start,end} maps must agree before
    # the map is trusted.
    log_line("INFO", f"Resolving era block ranges ({len(unique_validators)} unique validators)…")
    rows_needed = era_count + 1
    consensus_map: Optional[Dict[int, dict]] = None
    current_era = 0

    random.shuffle(unique_validators)
    sample_size = 3
    max_rounds  = max(1, (len(unique_validators) + sample_size - 1) // sample_size)
    used_idx    = 0

    for rnd_num in range(max_rounds):
        if consensus_map:
            break
        sample = unique_validators[used_idx:used_idx + sample_size]
        used_idx += sample_size
        if not sample:
            break

        era_maps: List[Dict[int, dict]] = []
        log_line("INFO", f"Consensus round {rnd_num+1}: sampling {len(sample)} validator(s)…")
        for v in sample:
            try:
                lst = subscan.fetch_era_stat(v["address"], rows_needed)
                m: Dict[int, dict] = {}
                for e in lst:
                    era = safe_int(e.get("era"))
                    if era > 0:
                        m[era] = {"start": safe_int(e.get("start_block_num")),
                                  "end":   safe_int(e.get("end_block_num"))}
                if m:
                    era_maps.append(m)
                    log_line("OK", f"{v['display'] or truncate_addr(v['address'])}: {len(m)} era(s)")
            except Exception as e:
                log_line("WARN", f"{truncate_addr(v['address'])}: era stat failed — {e}")

        if not era_maps:
            continue

        # Check consensus
        ref = era_maps[0]
        mismatch = False
        for era_num, ref_range in ref.items():
            for other in era_maps[1:]:
                if era_num in other and (other[era_num]["start"] != ref_range["start"] or
                                         other[era_num]["end"] != ref_range["end"]):
                    mismatch = True
                    log_line("WARN", f"Block range mismatch at era {era_num}. Trying next set…")
                    break
            if mismatch:
                break
        if not mismatch:
            consensus_map = ref
            log_line("OK", f"Consensus achieved: {len(ref)} era(s) mapped.")

    if not consensus_map:
        raise ScanError("Failed to establish era block range consensus.")

    current_era = max(consensus_map.keys())
    current_era_range = consensus_map.get(current_era)
    del consensus_map[current_era]

    completed_eras = sorted(consensus_map.keys(), reverse=True)[:era_count]
    completed_era_set = set(completed_eras)
    for era in list(consensus_map.keys()):
        if era not in completed_era_set:
            del consensus_map[era]

    latest_completed = completed_eras[0] if completed_eras else 0

    # The newest "completed" era is provisional: rewards for era N are paid
    # during era N+1, and for this era N+1 *is* the current era — an unfinished
    # window. A pool with no reward found there may simply not have been paid
    # yet, so it must be labelled rather than reported as a hard miss.
    provisional_era = None
    if completed_eras and (latest_completed + 1) == current_era:
        provisional_era = latest_completed
        log_line("WARN",
                 f"Era {provisional_era} is PROVISIONAL — its payout window "
                 f"(era {current_era}) is still open. Missing rewards there may "
                 f"not yet have been paid.")

    log_line("OK", f"Completed eras to check: {sorted(completed_eras)}")

    # Step 4: Confirm rewards
    log_line("INFO", f"Checking rewards for {len(pools)} pools × {len(completed_eras)} eras…")
    for i, p in enumerate(pools):
        if _stop_event.is_set():
            log_line("WARN", "Scan stopped early by user.")
            stopped = True
            break
        label = f"Pool #{p['poolId']}" + (f" — {p['metadata']}" if p["metadata"] else "")
        try:
            all_rewards: List[dict] = []
            for era in completed_eras:
                payout_range = consensus_map.get(era + 1) or current_era_range
                if not payout_range:
                    continue
                block_range = f"{payout_range['start']}-{payout_range['end']}"
                try:
                    reward_list = subscan.fetch_reward_slash(p["stashAddress"], block_range)
                    for r in reward_list:
                        all_rewards.append({
                            "era":            safe_int(r.get("era")),
                            "amount":         planck_str(r.get("amount")),
                            "blockTimestamp": safe_int(r.get("block_timestamp")),
                            "eventIndex":     str(r.get("event_index") or ""),
                            "validatorStash": str(r.get("validator_stash") or ""),
                        })
                    log_line("INFO", f"  Era {era}: {len(reward_list)} reward event(s)")
                except Exception as e:
                    log_line("WARN", f"  Era {era}: reward fetch failed — {e}")

            p["eraRewards"]  = all_rewards
            p["missedEras"]  = compute_pool_missed_eras(all_rewards, latest_completed, len(completed_eras))
            p["fetchStatus"] = "done"
            missed = len(p["missedEras"])
            if missed:
                note = ""
                if provisional_era is not None and provisional_era in p["missedEras"]:
                    note = f" (era {provisional_era} is provisional)"
                log_line("WARN", f"[{i+1}/{len(pools)}] {label}: {missed} missed era(s) — {sorted(p['missedEras'])}{note}")
            else:
                log_line("OK",   f"[{i+1}/{len(pools)}] {label}: all {len(completed_eras)} eras rewarded")
        except Exception as e:
            log_line("ERR", f"[{i+1}/{len(pools)}] {label}: {e}")
            p["eraRewards"] = []
            p["missedEras"] = []
            p["fetchStatus"] = "error"

    return {
        "mode":              "pool",
        "pools":             pools,
        "era_count":         era_count,
        "completed_eras":    sorted(completed_eras, reverse=True),
        "latest_completed":  latest_completed,
        "provisional_era":   provisional_era,
        "current_era":       current_era,
        "stopped":           stopped,
    }


def _render_pools(result: dict) -> None:
    """Print the pool scan result. Unchanged from the original layout."""
    pools            = result["pools"]
    latest_completed = result["latest_completed"]
    provisional_era  = result.get("provisional_era")

    cprint(f"\n[bold green]── Pool Results (latest completed era: {latest_completed}) ──[/bold green]")
    if provisional_era is not None:
        cprint(f"[yellow]⚠ Era {provisional_era} is PROVISIONAL — its payout window "
               f"(era {result['current_era']}) is still open. Pools shown as missing "
               f"that era may simply not have been paid yet.[/yellow]")
    if HAS_RICH:
        t = Table(title="Pool Summary", border_style="cyan", show_lines=True)
        t.add_column("Pool",       style="bold", max_width=30)
        t.add_column("Members",    justify="right")
        t.add_column("Commission", justify="right")
        t.add_column("Missed",     justify="center")
        t.add_column("Severity",   justify="center")
        for p in pools:
            missed = len(p["missedEras"])
            sev    = get_severity(missed)
            sev_color = {"none": "green", "low": "yellow", "medium": "orange3", "high": "red"}.get(sev, "white")
            pool_label = (p["metadata"] or f"Pool #{p['poolId']}")[:28]
            t.add_row(
                f"#{p['poolId']} {pool_label}",
                str(p["memberCount"]),
                f"{p['commission']:.2f}%",
                str(missed) if missed else "—",
                f"[{sev_color}]{sev}[/{sev_color}]",
            )
        console.print(t)
    else:
        print(f"\n{'Pool':<32} {'Members':>7} {'Comm':>6} {'Missed':>6} {'Sev'}")
        for p in pools:
            missed = len(p["missedEras"])
            label  = f"#{p['poolId']} {(p['metadata'] or '')[:20]}"
            print(f"{label:<32} {p['memberCount']:>7} {p['commission']:>6.2f}% {missed:>6} {get_severity(missed)}")


def tool_pool_checker(subscan: SubscanClient) -> None:
    cprint("\n[bold cyan]── Pool Reward Cadence ──[/bold cyan]")
    era_count = ask_int("How many recent completed eras to check?", default=2, min_val=1, max_val=100)

    try:
        result = scan_pools(subscan, era_count)
    except ScanError as e:
        cprint(f"[red]{e}[/red]")
        return

    _render_pools(result)

    pools = result["pools"]
    if pools and confirm("\nExport results?", default=False):
        fmt = ask_scan_export_format(("csv", "xml"))
        if fmt == "json":
            write_scan_json(result, ask("Filename", default_scan_filename(SCAN_SCHEMAS["pool"])))
        else:
            _export_pools(pools, result["latest_completed"], fmt)


def _export_pools(pools: List[dict], latest_era: int, fmt: str = "csv") -> None:
    fname = ask("Filename", f"pools_{latest_era}.{fmt}")
    HEADERS = ["pool_id", "name", "stash_address", "member_count",
               "commission_pct", "missed_era_count", "missed_eras", "severity"]

    def row_values(p: dict) -> list:
        missed = p["missedEras"]
        return [p["poolId"], p["metadata"], p["stashAddress"], p["memberCount"],
                p["commission"], len(missed), ";".join(str(e) for e in sorted(missed)),
                get_severity(len(missed))]

    try:
        if fmt == "csv":
            with open(fname, "w", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                w.writerow(HEADERS)
                for p in pools:
                    w.writerow(row_values(p))
        elif fmt == "json":
            obj_list = [dict(zip(HEADERS, row_values(p))) for p in pools]
            with open(fname, "w", encoding="utf-8") as f:
                json.dump({"_meta": {"exportedAt": datetime.now(timezone.utc).isoformat()},
                           "records": obj_list}, f, indent=2)
        elif fmt == "xml":
            lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<poolResults>']
            for p in pools:
                rv = row_values(p)
                lines.append('  <pool>')
                for k, v in zip(HEADERS, rv):
                    lines.append(f'    <{k}>{_xml_escape(str(v))}</{k}>')
                lines.append('  </pool>')
            lines.append('</poolResults>')
            with open(fname, "w", encoding="utf-8") as f:
                f.write("\n".join(lines))
        log_line("OK", f"Exported to {fname}")
    except Exception as e:
        log_line("ERR", f"Export failed: {e}")


# Keep legacy name for backward compat
def _export_pools_csv(pools: List[dict], latest_era: int) -> None:
    _export_pools(pools, latest_era, "csv")

# ════════════════════════════════════════════════════════════════════════════════
# TOOL 4: HISTORICAL BALANCE VIEWER
# ════════════════════════════════════════════════════════════════════════════════

async def _balance_query(endpoint: str, address: str, start_block: int,
                          end_block: int, step: int, era_csv: Dict[int, dict]) -> List[dict]:
    total_blocks = [(b) for b in range(start_block, end_block + 1, step)]
    if not total_blocks or total_blocks[-1] != end_block:
        total_blocks.append(end_block)

    if len(total_blocks) > MAX_RPC_CALLS:
        raise ValueError(
            f"Query would require {len(total_blocks):,} RPC calls (max {MAX_RPC_CALLS:,}). "
            "Increase step or narrow the range."
        )

    stor_key = build_storage_key(address)
    log_line("INFO", f"Storage key: {stor_key[:18]}…{stor_key[-8:]}")
    log_line("INFO", f"Planned queries: {len(total_blocks):,} (concurrency: 3)")

    # Build era hash map for fast lookups
    era_hash_map: Dict[int, str] = {}
    for row in era_csv.values():
        sb   = row.get("startBlock")
        bh   = row.get("startBlockHash")
        if sb and bh and re.match(r"^0x[0-9a-f]{64}$", bh, re.I):
            era_hash_map[sb] = bh

    rpc = SubstrateRPC(endpoint, concurrency=3)
    await rpc.connect()
    log_line("OK", "Connected to archive node.")

    results = [None] * len(total_blocks)

    async def query_block(blk: int, idx: int) -> None:
        if _stop_event.is_set():
            return
        try:
            bh = era_hash_map.get(blk) or await rpc.call("chain_getBlockHash", [blk])
            if not bh or not re.match(r"^0x[0-9a-f]{64}$", bh) or re.match(r"^0x0{64}$", bh):
                log_line("WARN", f"Block #{blk:,}: no valid hash")
                results[idx] = {"block": blk, "blockHash": "", "free": 0, "reserved": 0,
                                 "miscFrozen": 0, "feeFrozen": 0, "nonce": 0}
                return
            raw = await rpc.call("state_getStorage", [stor_key, bh])
            if not raw or raw == "0x":
                log_line("WARN", f"Block #{blk:,}: no account data")
                results[idx] = {"block": blk, "blockHash": bh, "free": 0, "reserved": 0,
                                 "miscFrozen": 0, "feeFrozen": 0, "nonce": 0}
            else:
                dec = decode_account_info(raw)
                results[idx] = {"block": blk, "blockHash": bh, **dec}
                log_line("INFO", f"Block #{blk:,} → free={fmt_enj(dec['free'])} res={fmt_enj(dec['reserved'])}")
        except Exception as e:
            if "Cancelled" in str(e):
                return
            log_line("WARN", f"Block #{blk:,}: RPC error — {e}")
            results[idx] = {"block": blk, "blockHash": "", "free": 0, "reserved": 0,
                             "miscFrozen": 0, "feeFrozen": 0, "nonce": 0}

    try:
        await asyncio.gather(*[query_block(blk, i) for i, blk in enumerate(total_blocks)])
    except asyncio.CancelledError:
        pass  # partial results are still valid
    finally:
        await rpc.close()

    sorted_results = sorted([r for r in results if r], key=lambda r: r["block"])
    if _stop_event.is_set():
        log_line("WARN", f"Scan stopped — {len(sorted_results):,} partial record(s) available.")
    else:
        log_line("OK", f"Fetch complete — {len(sorted_results):,} records")
    return sorted_results

def tool_balance_explorer(era_csv: Dict[int, dict]) -> None:
    cprint("\n[bold cyan]── Historical Balance Viewer ──[/bold cyan]")

    # Network selection
    cprint("\nAvailable networks:")
    for i, net in enumerate(ENJIN_NETWORKS):
        cprint(f"  {i+1}. {net['label']} ({net['endpoint']})")
    cprint(f"  {len(ENJIN_NETWORKS)+1}. Custom endpoint")

    net_choice = ask_int("Select network", default=1, min_val=1, max_val=len(ENJIN_NETWORKS)+1)
    if net_choice <= len(ENJIN_NETWORKS):
        endpoint = ENJIN_NETWORKS[net_choice-1]["endpoint"]
    else:
        endpoint = ask("WebSocket endpoint (wss://…)")
    try:
        endpoint = validate_ws_endpoint(endpoint)
    except ValueError as e:
        cprint(f"[red]Invalid endpoint: {e}[/red]"); return

    address = ask("SS58 wallet address")
    try:
        validate_address(address)
    except ValueError as e:
        cprint(f"[red]Invalid address: {e}[/red]"); return

    # ── Range mode selection ─────────────────────────────────────────────────
    net = ENJIN_NETWORKS[net_choice - 1] if net_choice <= len(ENJIN_NETWORKS) else None
    supports_era_csv = net is not None and net.get("era_csv", False)

    cprint("\n[bold]Query range mode:[/bold]")
    cprint("  1. Block Range  — exact block numbers")
    if supports_era_csv:
        cprint("  2. Era Range    — resolve from staking era numbers")
        cprint("  3. Date Range   — pick dates, the app resolves blocks")
        range_max = 3
    else:
        cprint("  [dim]2. Era Range    (not available for this network)[/dim]")
        cprint("  [dim]3. Date Range   (not available for this network)[/dim]")
        range_max = 1
    range_mode = ask_int("Range mode", default=1, min_val=1, max_val=range_max)

    start_block: int = 1
    end_block: int = 100

    if range_mode == 1:
        # Block range
        start_block = ask_int("Start block number", default=1, min_val=0)
        end_block   = ask_int("End block number",   default=start_block + 100, min_val=start_block)
        step        = ask_int("Step (every N blocks)", default=1, min_val=1)
    elif range_mode == 2:
        # Era range
        latest_era_num = max(era_csv.keys()) if era_csv else 1000
        start_era_num = ask_int("Start era", default=max(1, latest_era_num - 9), min_val=1)
        end_era_num   = ask_int("End era",   default=latest_era_num, min_val=start_era_num)
        era_step      = ask_int("Step (every N eras)", default=1, min_val=1)
        sb, eb = _resolve_era_blocks(era_csv, start_era_num, end_era_num)
        if not sb or not eb:
            cprint(f"[red]Era {start_era_num}–{end_era_num} not found in era CSV. "
                   "Try block range mode or use a Relaychain network.[/red]")
            return
        start_block, end_block = sb, eb
        # Convert era step to approximate block step (1 era ≈ 14400 blocks)
        step = max(1, era_step * 14400)
        log_line("INFO", f"Era {start_era_num}–{end_era_num} → blocks {start_block:,}–{end_block:,}, step={step:,}")
    elif range_mode == 3:
        # Date range
        start_date = ask("Start date (YYYY-MM-DD)")
        end_date   = ask("End date   (YYYY-MM-DD)")
        day_step   = ask_int("Step (every N days)", default=1, min_val=1)
        start_era_for_date = _find_era_for_date_str(era_csv, start_date)
        end_era_for_date   = _find_era_for_date_str(era_csv, end_date, end_of_day=True)
        if start_era_for_date is None or end_era_for_date is None:
            cprint("[red]Could not resolve date range from ERA CSV. "
                   "Check the date format or use block range mode.[/red]")
            return
        sb, eb = _resolve_era_blocks(era_csv, start_era_for_date, end_era_for_date)
        if not sb or not eb:
            cprint("[red]Could not resolve block range from era CSV.[/red]")
            return
        start_block, end_block = sb, eb
        step = max(1, day_step * 14400)
        log_line("INFO", f"Date {start_date}–{end_date} → era {start_era_for_date}–{end_era_for_date} "
                         f"→ blocks {start_block:,}–{end_block:,}, step={step:,}")
    else:
        return  # should not happen

    log_line("INFO", f"Endpoint: {endpoint}")
    log_line("INFO", f"Address:  {address}")
    log_line("INFO", f"Range:    {start_block:,} → {end_block:,}, step={step:,}")

    start_stop_listener()
    try:
        records = run_async(_balance_query(endpoint, address, start_block, end_block, step, era_csv))
    except ValueError as e:
        cprint(f"[red]{e}[/red]"); return
    except Exception as e:
        log_line("ERR", f"Query failed: {e}"); return

    if not records:
        log_line("WARN", "No records returned."); return

    # Display
    if HAS_RICH:
        t = Table(title=f"Balance History — {truncate_addr(address)}", border_style="cyan", show_lines=True)
        t.add_column("Block",      justify="right")
        t.add_column("Free",       justify="right")
        t.add_column("Reserved",   justify="right")
        t.add_column("MiscFrozen", justify="right")
        t.add_column("FeeFrozen",  justify="right")
        for r in records:
            t.add_row(
                f"{r['block']:,}",
                fmt_enj(r["free"]),
                fmt_enj(r["reserved"]),
                fmt_enj(r["miscFrozen"]),
                fmt_enj(r["feeFrozen"]),
            )
        console.print(t)
    else:
        print(f"\n{'Block':>12} {'Free':>22} {'Reserved':>22} {'MiscFrozen':>22}")
        for r in records:
            print(f"{r['block']:>12,} {fmt_enj(r['free']):>22} {fmt_enj(r['reserved']):>22} {fmt_enj(r['miscFrozen']):>22}")

    _stop_event.set()  # disarm the scan listener before prompting

    if records and confirm("\nExport balance data?", default=False):
        fmt = ask_export_format()
        export_balance_records(records, address, start_block, end_block, fmt, endpoint=endpoint)

# ════════════════════════════════════════════════════════════════════════════════
# TOOL 5: REWARD HISTORY VIEWER
# ════════════════════════════════════════════════════════════════════════════════

async def _reward_history_run(address: str, start_era: int, end_era: int,
                               endpoint: str, include_history: bool,
                               subscan: SubscanClient,
                               era_csv: Dict[int, dict]) -> List[dict]:
    # Phase 0: pool names from Subscan
    log_line("INFO", "─── Phase 0: Fetching pool names ───")
    pool_name_map: Dict[int, str] = {}
    try:
        raw_pools = subscan.fetch_all_pools(
            on_page=lambda pg, cnt: log_line("INFO", f"Pool names page {pg}: {cnt}"))
        for p in raw_pools:
            pid  = safe_int(p.get("pool_id"))
            name = str(p.get("metadata") or "").strip()
            if pid > 0 and name:
                pool_name_map[pid] = name
        log_line("OK", f"{len(pool_name_map)} named pool(s).")
    except Exception as e:
        log_line("WARN", f"Pool name fetch failed: {e}")

    # Phase 1: Connect to archive
    log_line("INFO", f"─── Phase 1: Connecting to {endpoint} ───")
    rpc = SubstrateRPC(endpoint, concurrency=3)
    await rpc.connect()
    log_line("OK", "Archive node connected.")

    # Clamp end_era to current active era
    head_hash  = await rpc.call("chain_getFinalizedHead", [])
    head_hdr   = await rpc.call("chain_getHeader", [head_hash])
    chain_head = int(head_hdr["number"], 16) if head_hdr and head_hdr.get("number") else 0
    era_raw    = await rpc.call("state_getStorage", [STAKING_ACTIVE_ERA_KEY, head_hash])
    current_era = decode_active_era(era_raw)
    if current_era is not None and end_era > current_era:
        log_line("WARN", f"endEra clamped {end_era} → {current_era}")
        end_era = current_era

    # Resolve era boundaries
    log_line("INFO", "Resolving era boundaries…")
    local_cache: Dict[int, dict] = {k: dict(v) for k, v in era_csv.items()}
    missing_starts = [e for e in range(start_era, end_era + 2)
                      if not local_cache.get(e, {}).get("startBlock")]
    if missing_starts:
        log_line("WARN", f"{len(missing_starts)} era(s) missing from CSV — binary-searching…")
    for era in missing_starts:
        if current_era is not None and era > current_era + 1:
            continue
        prev_row = local_cache.get(era - 1, {})
        lo_hint  = prev_row.get("startBlock") or 1
        sb = await binary_search_era_start(rpc, era, chain_head, STAKING_ACTIVE_ERA_KEY)
        if sb:
            local_cache[era] = local_cache.get(era) or {}
            local_cache[era]["startBlock"] = sb
            bh = await rpc.call("chain_getBlockHash", [sb])
            local_cache[era]["startBlockHash"] = bh
            log_line("INFO", f"Era {era}: start block {sb:,}")
            if era > 1:
                local_cache.setdefault(era - 1, {})
                if not local_cache[era - 1].get("endBlock"):
                    local_cache[era - 1]["endBlock"] = sb - 1

    # Finalize endBlock for each era
    for era in range(start_era, end_era + 1):
        row = local_cache.get(era, {})
        sb  = row.get("startBlock")
        eb  = row.get("endBlock")
        if sb and not eb:
            next_sb = local_cache.get(era + 1, {}).get("startBlock")
            if next_sb:
                local_cache[era]["endBlock"] = next_sb - 1

    # Phase 2: Enumerate bonded pools from chain
    log_line("INFO", "─── Phase 2: Enumerating bonded pools ───")
    prefix   = build_bonded_pools_prefix()
    pool_ids_chain: List[int] = []
    start_key = None
    page_size = 500
    while True:
        params = [prefix, page_size] + ([start_key] if start_key else [])
        keys = await rpc.call("state_getKeysPaged", params)
        if not keys:
            break
        for k in keys:
            pid = pool_id_from_bonded_pools_key(k)
            if pid is not None:
                pool_ids_chain.append(pid)
        if len(keys) < page_size:
            break
        start_key = keys[-1]

    log_line("OK", f"Chain reports {len(pool_ids_chain)} bonded pool(s).")
    all_pools = [{"poolId": pid, "metadata": pool_name_map.get(pid, "")}
                 for pid in pool_ids_chain]

    # Discover member pools (check sENJ balance at head)
    log_line("INFO", f"Checking sENJ balance in {len(all_pools)} pool(s) at chain head…")
    member_pools: List[dict] = []
    for pool in all_pools:
        key = build_token_account_key(COLLECTION_ID, pool["poolId"], address)
        try:
            raw = await rpc.call("state_getStorage", [key, head_hash])
            bal = decode_compact_first(raw)
            if bal > 0:
                member_pools.append(pool)
                log_line("OK", f"Pool #{pool['poolId']} ({pool['metadata'] or 'unnamed'}): member")
        except Exception as e:
            log_line("WARN", f"Pool #{pool['poolId']}: balance check failed — {e}")

    if not member_pools and not include_history:
        log_line("WARN", "No active sENJ balance. Enable 'include history' to scan past pools.")
        await rpc.close()
        return []

    # Optional: historical pools from Subscan extrinsics
    if include_history:
        log_line("INFO", "─── Phase 2.5: Fetching historical pool interactions ───")
        try:
            hist_ids = subscan.fetch_historical_pool_ids(
                address, on_page=lambda pg, cnt: log_line("INFO", f"Extrinsics page {pg+1}: {cnt}"))
            added = 0
            for pid in hist_ids:
                if not any(p["poolId"] == pid for p in member_pools):
                    found = next((p for p in all_pools if p["poolId"] == pid), None)
                    if found:
                        member_pools.append(found)
                    else:
                        member_pools.append({"poolId": pid, "metadata": pool_name_map.get(pid, "")})
                    added += 1
            log_line("OK", f"Historical: {added} additional pool(s) (total: {len(member_pools)})")
        except Exception as e:
            log_line("WARN", f"Historical fetch failed: {e}")

    # Phase 3: Query era balances
    log_line("INFO", f"─── Phase 3: Querying balances ({end_era - start_era + 1} eras × {len(member_pools)} pools) ───")
    era_pool_data: List[dict] = []

    for era in range(start_era, end_era + 1):
        if _stop_event.is_set():
            log_line("WARN", "Scan stopped early by user.")
            break
        row = local_cache.get(era, {})
        era_start_block  = row.get("startBlock")
        era_end_block    = row.get("endBlock")
        era_end_boundary = (era_end_block + 1) if era_end_block else local_cache.get(era + 1, {}).get("startBlock")

        if not era_start_block or not era_end_boundary:
            log_line("WARN", f"Era {era}: missing boundary blocks — skipping.")
            continue

        block_hash = row.get("startBlockHash")
        if not block_hash:
            try:
                block_hash = await rpc.call("chain_getBlockHash", [era_start_block])
            except Exception as e:
                log_line("WARN", f"Era {era}: failed to get block hash — {e}")

        if not block_hash:
            log_line("WARN", f"Era {era}: no block hash — skipping.")
            continue

        for pool in member_pools:
            member_balance = 0
            try:
                key = build_token_account_key(COLLECTION_ID, pool["poolId"], address)
                raw = await rpc.call("state_getStorage", [key, block_hash])
                member_balance = decode_compact_first(raw)
            except Exception as e:
                log_line("WARN", f"Era {era} Pool #{pool['poolId']}: balance error — {e}")

            pool_supply = 0
            if member_balance > 0:
                try:
                    key = build_token_key(COLLECTION_ID, pool["poolId"])
                    raw = await rpc.call("state_getStorage", [key, block_hash])
                    pool_supply = decode_compact_first(raw)
                except Exception as e:
                    log_line("WARN", f"Era {era} Pool #{pool['poolId']}: supply error — {e}")

            active_stake = 0
            if member_balance > 0 and pool_supply > 0:
                try:
                    bonded_id_hex = compute_pool_bonded_account_id(pool["poolId"])
                    ledger_key    = build_staking_ledger_key(bonded_id_hex)
                    ledger_raw    = await rpc.call("state_getStorage", [ledger_key, block_hash])
                    active_stake  = decode_staking_ledger_active(ledger_raw)
                except Exception:
                    pass

            if member_balance > 0 and pool_supply > 0:
                era_pool_data.append({
                    "era":             era,
                    "pool":            pool,
                    "memberBalance":   member_balance,
                    "poolSupply":      pool_supply,
                    "activeStake":     active_stake,
                    "blockHash":       block_hash,
                    "eraStartBlock":   era_start_block,
                    "eraEndBlock":     era_end_block,
                    "eraEndBoundary":  era_end_boundary,
                    "startDateUtc":    row.get("startDateUtc"),
                })
                log_line("INFO", f"Era {era} Pool #{pool['poolId']}: "
                         f"member {fmt_enj(member_balance)} / supply {fmt_enj(pool_supply)} sENJ")
            else:
                log_line("INFO", f"Era {era} Pool #{pool['poolId']}: not a member at era start.")

    await rpc.close()

    # Phase 4: Scan reward events (Subscan events API)
    log_line("INFO", f"─── Phase 4: Scanning reward events for {len(era_pool_data)} pairs ───")
    results: List[dict] = []
    accumulated_by_pool: Dict[int, int] = {}

    for item in era_pool_data:
        if _stop_event.is_set():
            log_line("WARN", "Scan stopped early by user.")
            break
        era        = item["era"]
        pool       = item["pool"]
        mem_bal    = item["memberBalance"]
        pool_sup   = item["poolSupply"]
        act_stake  = item["activeStake"]
        event_start = item["eraEndBoundary"]
        event_end   = event_start + EVENT_SCAN_AFTER
        block_range = f"{event_start}-{event_end}"

        reinvested = _find_reinvested_subscan(subscan, pool["poolId"], era, block_range)

        if reinvested == 0:
            log_line("INFO", f"Era {era} Pool #{pool['poolId']}: no reward events in {block_range}")
            continue

        reward = (mem_bal * reinvested) // pool_sup if pool_sup else 0

        apy_denom    = act_stake if act_stake > 0 else pool_sup
        per_era_gain = reinvested / apy_denom if apy_denom else 0
        ratio        = 1 + per_era_gain
        apy          = (ratio ** ERAS_PER_YEAR - 1) * 100

        accumulated_by_pool[pool["poolId"]] = accumulated_by_pool.get(pool["poolId"], 0) + reward
        pool_label = f"#{pool['poolId']}" + (f" — {pool['metadata']}" if pool["metadata"] else "")

        results.append({
            "era":           era,
            "poolId":        pool["poolId"],
            "poolLabel":     pool_label,
            "memberBalance": mem_bal,
            "poolSupply":    pool_sup,
            "activeStake":   act_stake,
            "reinvested":    reinvested,
            "reward":        reward,
            "accumulated":   accumulated_by_pool[pool["poolId"]],
            "apy":           apy,
            "eraStartBlock": item["eraStartBlock"],
            "startDateUtc":  item["startDateUtc"],
        })
        log_line("OK", f"Era {era} Pool #{pool['poolId']}: reward {fmt_enj(reward)} (APY ~{apy:.2f}%)")

    return results

def _find_reinvested_subscan(subscan: SubscanClient, pool_id: int, era: int,
                              block_range: str) -> int:
    """Scan Subscan events in block_range for NominationPools reward events."""
    try:
        events = subscan.fetch_events_in_range(block_range)
    except Exception as e:
        log_line("WARN", f"Events fetch failed for era {era} pool #{pool_id}: {e}")
        return 0

    def norm(k): return str(k or "").lower().replace(r"[^a-z0-9]", "")
    def parse_params(raw):
        if not raw: return []
        if isinstance(raw, (list, dict)): return raw
        if isinstance(raw, str):
            try: return json.loads(raw)
            except Exception: return []
        return []
    def extract(params, names, fallback=None):
        wanted = {n.lower().replace("_","") for n in names}
        if isinstance(params, list):
            for item in params:
                if isinstance(item, dict):
                    k = str(item.get("name") or item.get("key") or "").lower().replace("_","")
                    if k in wanted:
                        return item.get("value")
            if fallback is not None and len(params) > fallback:
                item = params[fallback]
                return item.get("value") if isinstance(item, dict) else item
        if isinstance(params, dict):
            for k, v in params.items():
                if k.lower().replace("_","") in wanted:
                    return v
        return None

    def to_int(v):
        if v is None: return None
        try: return int(str(v).replace(",","").replace(" ",""))
        except Exception: return None
    def to_bigint(v):
        if v is None: return 0
        try: return int(str(v).replace(",","").replace(" ",""))
        except Exception: return 0

    total = 0
    total_offset = 0

    for ev in sorted(events, key=lambda e: safe_int(e.get("block_num") or e.get("block_height"))):
        name = str(ev.get("event_id") or ev.get("event_name") or "").strip().lower()
        is_era_processed = (name == "erarewardsprocessed")
        is_reward_paid   = (name == "rewardpaid")
        if not is_era_processed and not is_reward_paid:
            continue

        params = parse_params(ev.get("params"))
        ev_pool = to_int(extract(params, ["pool_id", "poolId"], 0))
        ev_era  = to_int(extract(params, ["era", "era_index", "eraIndex"], 1))
        if ev_pool is None or ev_era is None or ev_pool != pool_id:
            continue

        if is_era_processed and ev_era == era:
            raw_amt = extract(params, ["reinvested"], 2)
            return to_bigint(raw_amt)

        if is_reward_paid:
            reward  = to_bigint(extract(params, ["reward"], 3))
            comm_raw = extract(params, ["commission"], 4)
            comm_amt = 0
            if comm_raw is not None:
                if isinstance(comm_raw, dict):
                    comm_amt = to_bigint(comm_raw.get("amount"))
                else:
                    comm_amt = to_bigint(comm_raw)
            # Net of commission — only this amount actually compounds into the pool.
            # See docs/nomination_pool_reward_accounting_fix.md.
            s = max(reward - comm_amt, 0)
            if ev_era == era:
                total += s
            elif ev_era == era + 1:
                total_offset += s

    return total if total > 0 else total_offset

def tool_reward_history(subscan: SubscanClient, era_csv: Dict[int, dict]) -> None:
    cprint("\n[bold cyan]── Reward History Viewer ──[/bold cyan]")
    cprint(f"CSV eras loaded: {len(era_csv)}")

    address = ask("SS58 wallet address (Relaychain)")
    try:
        validate_address(address)
    except ValueError as e:
        cprint(f"[red]Invalid address: {e}[/red]"); return

    latest_csv_era = max(era_csv.keys()) if era_csv else 1000

    # ── Range mode ────────────────────────────────────────────────────────────
    cprint("\n[bold]Query range mode:[/bold]")
    cprint("  1. Era Range   — specify exact start/end era numbers")
    cprint("  2. Date Range  — pick dates, the app estimates eras")
    range_mode = ask_int("Range mode", default=1, min_val=1, max_val=2)

    if range_mode == 1:
        start_era = ask_int("Start era", default=max(1, latest_csv_era - 9), min_val=1)
        end_era   = ask_int("End era",   default=latest_csv_era, min_val=start_era)
    else:
        start_date = ask("Start date (YYYY-MM-DD)")
        end_date   = ask("End date   (YYYY-MM-DD)")
        start_era  = _find_era_for_date_str(era_csv, start_date)
        end_era    = _find_era_for_date_str(era_csv, end_date, end_of_day=True)
        if start_era is None or end_era is None:
            cprint("[red]Could not resolve dates to eras. "
                   "Check the date format (YYYY-MM-DD) and ensure dates are within the era CSV range.[/red]")
            return
        log_line("INFO", f"Date {start_date}–{end_date} → era {start_era}–{end_era}")

    endpoint      = ask("Archive WSS endpoint", ARCHIVE_WSS)
    try:
        endpoint = validate_ws_endpoint(endpoint)
    except ValueError as e:
        cprint(f"[red]{e}[/red]"); return

    include_history = confirm("Include past pool interactions (slower)?", default=False)

    log_line("INFO", f"Computing rewards for {address[:12]}… era {start_era}–{end_era}")

    start_stop_listener()
    try:
        results = run_async(_reward_history_run(
            address, start_era, end_era, endpoint,
            include_history, subscan, era_csv))
    except Exception as e:
        log_line("ERR", f"Failed: {e}"); return

    if not results:
        log_line("WARN", "No reward records found."); return

    total_reward = sum(r["reward"] for r in results)
    cprint(f"\n[bold green]── Results ({len(results)} records, total {fmt_enj(total_reward)}) ──[/bold green]")

    if HAS_RICH:
        t = Table(title="Reward History", border_style="cyan", show_lines=True)
        t.add_column("Era",        justify="right")
        t.add_column("Pool",       max_width=25)
        t.add_column("Member Bal", justify="right")
        t.add_column("Reinvested", justify="right")
        t.add_column("Reward",     justify="right")
        t.add_column("Accum.",     justify="right")
        t.add_column("APY",        justify="right")
        t.add_column("Era Date",   max_width=20)
        for r in results:
            t.add_row(
                str(r["era"]),
                r["poolLabel"][:25],
                fmt_enj(r["memberBalance"], 2),
                fmt_enj(r["reinvested"], 4),
                fmt_enj(r["reward"], 6),
                fmt_enj(r["accumulated"], 6),
                f"{r['apy']:.2f}%",
                str(r.get("startDateUtc") or "—")[:19],
            )
        console.print(t)
    else:
        print(f"\n{'Era':>5} {'Pool':<20} {'Reward':>22} {'APY':>8}")
        for r in results:
            print(f"{r['era']:>5} {r['poolLabel']:<20} {fmt_enj(r['reward']):>22} {r['apy']:>7.2f}%")
        print(f"\nTotal reward: {fmt_enj(total_reward)}")

    if results and confirm("\nExport results?", default=False):
        fmt = ask_export_format()
        export_reward_records(results, address, start_era, end_era, fmt)

# ════════════════════════════════════════════════════════════════════════════════
# TOOL 6: ENJ INFUSION CHECKER
# ════════════════════════════════════════════════════════════════════════════════

def export_infusion_records(records: List[dict], owner: str, fmt: str) -> None:
    base = f"infusions_{owner[:10] if owner else 'token'}"
    fname = ask("Filename", f"{base}.{fmt}")
    now = datetime.now(timezone.utc).isoformat()
    HEADERS = ["token_id", "token_name", "quantity", "enj_infusion", "raw_enj_infusion",
               "provider", "status", "error", "etherscan_url"]

    def to_row(r: dict) -> dict:
        return {
            "token_id": r.get("tokenId", ""),
            "token_name": r.get("name", ""),
            "quantity": r.get("quantity", ""),
            "enj_infusion": r.get("amount", ""),
            "raw_enj_infusion": r.get("raw", ""),
            "provider": r.get("provider", ""),
            "status": "failed" if r.get("error") else "ok",
            "error": r.get("errorMessage", ""),
            "etherscan_url": etherscan_token_url(str(r.get("tokenId", ""))) if r.get("tokenId") else "",
        }

    try:
        if fmt == "csv":
            with open(fname, "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=HEADERS)
                w.writeheader()
                for r in records:
                    w.writerow(to_row(r))
        elif fmt == "json":
            with open(fname, "w", encoding="utf-8") as f:
                json.dump({
                    "_meta": {
                        "owner": owner,
                        "contractAddress": ENJIN_ERC1155_CONTRACT,
                        "exportedAt": now,
                    },
                    "records": [to_row(r) for r in records],
                }, f, indent=2)
        elif fmt == "xml":
            ex = _xml_escape
            rows = []
            for r in records:
                row = to_row(r)
                rows.append("  <token>\n" + "\n".join(
                    f"    <{k}>{ex(str(row[k]))}</{k}>" for k in HEADERS
                ) + "\n  </token>")
            meta = (
                "  <meta>\n"
                f"    <owner>{ex(owner)}</owner>\n"
                f"    <contractAddress>{ex(ENJIN_ERC1155_CONTRACT)}</contractAddress>\n"
                f"    <exportedAt>{ex(now)}</exportedAt>\n"
                "  </meta>"
            )
            with open(fname, "w", encoding="utf-8") as f:
                f.write('<?xml version="1.0" encoding="UTF-8"?>\n<enjinInfusions>\n'
                        + meta + "\n" + "\n".join(rows) + "\n</enjinInfusions>")
        log_line("OK", f"Exported {len(records)} infusion record(s) to {fname}")
    except Exception as e:
        log_line("ERR", f"Export failed: {e}")


def _display_infusion_records(records: List[dict], title: str) -> None:
    if HAS_RICH:
        t = Table(title=title, border_style="cyan", show_lines=True)
        t.add_column("Token ID", style="bold cyan", max_width=18)
        t.add_column("Token Name", max_width=32)
        t.add_column("Qty", justify="right")
        t.add_column("ENJ Infusion", justify="right")
        t.add_column("Raw", justify="right", max_width=20)
        t.add_column("Provider", justify="center")
        t.add_column("Status", justify="center")
        for r in records:
            status = "[red]failed[/red]" if r.get("error") else "[green]ok[/green]"
            t.add_row(
                truncate_token_id(str(r.get("tokenId", ""))),
                str(r.get("name") or "—"),
                str(r.get("quantity") or "—"),
                str(r.get("amount") or "—"),
                truncate_token_id(str(r.get("raw") or "—"), 10, 8),
                str(r.get("provider") or "—"),
                status,
            )
        console.print(t)
    else:
        print(f"\n{title}")
        print(f"{'Token ID':<20} {'Name':<30} {'Qty':>6} {'Infusion':>22} {'Provider':<12} {'Status'}")
        for r in records:
            print(f"{truncate_token_id(str(r.get('tokenId', ''))):<20} "
                  f"{str(r.get('name') or '—')[:30]:<30} "
                  f"{str(r.get('quantity') or '—'):>6} "
                  f"{str(r.get('amount') or '—'):>22} "
                  f"{str(r.get('provider') or '—'):<12} "
                  f"{'failed' if r.get('error') else 'ok'}")


def tool_infusion_checker() -> None:
    cprint("\n[bold cyan]── ENJ Infusion Checker ──[/bold cyan]")
    cprint("Ethereum ERC-1155 assets")
    cprint("ERC-20 ENJ is different from native ENJ on the Enjin Blockchain.")
    cprint(f"Contract: {ENJIN_ERC1155_CONTRACT}")
    cprint("RPC: Alchemy/Etherscan, then public Ethereum RPC fallbacks")
    cprint("[dim]Wallet token lists can be incomplete. If a token is missing, use Token ID scan with its Etherscan NFT URL or token ID.[/dim]")

    etherscan_key = os.environ.get("ETHERSCAN_API_KEY", "").strip()
    alchemy_rpc_url = os.environ.get("ALCHEMY_ETH_RPC_URL", "").strip()
    if not etherscan_key:
        cprint("[yellow]Warning: ETHERSCAN_API_KEY is not set. Wallet scans and Etherscan fallback will be unavailable.[/yellow]")
    if alchemy_rpc_url:
        cprint("[dim]Alchemy RPC configured.[/dim]")

    client = EthereumInfusionClient(etherscan_key, alchemy_rpc_url)

    cprint("\n[bold]Scan mode:[/bold]")
    cprint("  1. Token ID / Etherscan NFT URL")
    cprint("  2. Wallet bulk scan")
    mode = ask_int("Mode", default=1, min_val=1, max_val=2)

    if mode == 1:
        raw_input = ask("Token ID or Etherscan NFT URL")
        try:
            token_id = validate_infusion_token_id(raw_input)
        except ValueError as e:
            cprint(f"[red]{e}[/red]"); return

        log_line("INFO", f"Token scan: tokenId={token_id}")
        log_line("INFO", "Method: typeData(uint256)")
        try:
            raw, provider = client.read_infusion(token_id)
        except Exception as e:
            log_line("ERR", f"Token scan failed: {e}")
            return

        amount = fmt_enj(raw, 8)
        record = {
            "tokenId": str(token_id),
            "name": f"Token {truncate_token_id(str(token_id), 5, 5)}",
            "quantity": "",
            "amount": amount,
            "raw": str(raw),
            "provider": provider,
        }
        log_line("OK", f"Infusion: {amount} (raw={raw}) via {provider}")
        _display_infusion_records([record], "Token Infusion")
        cprint(f"Etherscan: {etherscan_token_url(str(token_id))}")
        return

    if not etherscan_key:
        cprint("[red]ETHERSCAN_API_KEY is required for wallet bulk scans.[/red]")
        return

    wallet = ask("Ethereum wallet address")
    try:
        wallet = validate_eth_address(wallet)
    except ValueError as e:
        cprint(f"[red]{e}[/red]"); return

    log_line("INFO", f"Wallet scan: {wallet}")
    log_line("INFO", "Fetching wallet ERC-1155 transfer history from Etherscan.")
    try:
        tokens = client.fetch_current_wallet_tokens(wallet)
    except Exception as e:
        log_line("ERR", f"Wallet token discovery failed: {e}")
        return

    if not tokens:
        log_line("WARN", "No matching current token IDs found.")
        return

    log_line("OK", f"Found {len(tokens)} current token ID(s).")
    start_stop_listener()
    records: List[dict] = []
    total_raw = 0
    failed = 0

    for idx, token in enumerate(tokens, start=1):
        if _stop_event.is_set():
            log_line("WARN", "Wallet scan stopped early by user.")
            break

        token_id = token["tokenId"]
        log_line("INFO", f"[{idx}/{len(tokens)}] Token {truncate_token_id(token_id)}: reading infusion.")
        try:
            raw, provider = client.read_infusion(int(token_id))
            total_raw += raw
            records.append({
                **token,
                "amount": fmt_enj(raw, 8),
                "raw": str(raw),
                "provider": provider,
                "error": False,
                "errorMessage": "",
            })
            log_line("OK", f"Token {truncate_token_id(token_id)}: {fmt_enj(raw, 8)} via {provider}")
            log_line("INFO", f"Running total: {fmt_enj(total_raw, 8)} (raw={total_raw})")
        except Exception as e:
            failed += 1
            records.append({
                **token,
                "amount": "Failed",
                "raw": "",
                "provider": "",
                "error": True,
                "errorMessage": str(e),
            })
            log_line("ERR", f"Token {truncate_token_id(token_id)} failed: {e}")

    _stop_event.set()

    cprint(f"\n[bold green]── Wallet Infusion Total: {fmt_enj(total_raw, 8)} ──[/bold green]")
    cprint(f"Raw total: {total_raw}")
    if failed:
        cprint(f"[yellow]{failed} token read{'s' if failed != 1 else ''} failed. See logs above for provider details.[/yellow]")
    _display_infusion_records(records, "Wallet Token Infusions")

    if records and confirm("\nExport infusion results?", default=False):
        fmt = ask_export_format()
        export_infusion_records(records, wallet, fmt)

# ════════════════════════════════════════════════════════════════════════════════
# STAKING CADENCE (unified entry point)
# ════════════════════════════════════════════════════════════════════════════════

def tool_staking_cadence(subscan: SubscanClient) -> None:
    cprint("\n[bold cyan]── Staking Reward Cadence ──[/bold cyan]")
    cprint("  1. Validator cadence")
    cprint("  2. Nomination pool cadence")
    mode = ask_int("Scan mode", default=1, min_val=1, max_val=2)
    if mode == 1:
        tool_validator_checker(subscan)
    else:
        tool_pool_checker(subscan)


# ════════════════════════════════════════════════════════════════════════════════
# ABOUT / INFO
# ════════════════════════════════════════════════════════════════════════════════

# ════════════════════════════════════════════════════════════════════════════════
# SLACK DELIVERY
# ════════════════════════════════════════════════════════════════════════════════
#
# stdlib urllib only — no new dependency, so the CLI stays a single-file download.
# Slack answers logical failures with HTTP 200 and {"ok": false}, so every
# response is checked for `ok` rather than status alone.

SLACK_API = "https://slack.com/api/"


def _slack_call(method: str, token: str, *, form: Optional[dict] = None,
                payload: Optional[dict] = None) -> dict:
    if form is not None:
        body = urllib.parse.urlencode(form).encode("utf-8")
        ctype = "application/x-www-form-urlencoded"
    else:
        body = json.dumps(payload or {}).encode("utf-8")
        ctype = "application/json; charset=utf-8"
    req = urllib.request.Request(
        SLACK_API + method, data=body, method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": ctype},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not data.get("ok"):
        raise RuntimeError(f"Slack {method} failed: {data.get('error') or data}")
    return data


def slack_post(token: str, channel: str, text: str,
               file_path: Optional[str] = None, title: str = "") -> None:
    """Post a summary to Slack, optionally with a file attached.

    Without a file this is one chat.postMessage. With one it is Slack's external
    upload flow: reserve a URL, POST the bytes to it, then complete the upload
    with the channel and comment — which posts the message itself, so no separate
    chat.postMessage is needed.
    """
    if not file_path:
        _slack_call("chat.postMessage", token, payload={"channel": channel, "text": text})
        return

    raw = Path(file_path).read_bytes()
    # Slack validates this against the bytes it receives. The export contains
    # non-ASCII, so a character count would be rejected.
    upload = _slack_call("files.getUploadURLExternal", token, form={
        "filename": os.path.basename(file_path),
        "length":   len(raw),
    })

    # The upload URL is pre-signed: no Authorization header, and POST (not PUT).
    put = urllib.request.Request(
        upload["upload_url"], data=raw, method="POST",
        headers={"Content-Type": "application/octet-stream"},
    )
    with urllib.request.urlopen(put, timeout=120) as resp:
        if resp.status >= 300:
            raise RuntimeError(f"Slack file upload failed: HTTP {resp.status}")

    _slack_call("files.completeUploadExternal", token, payload={
        "files":           [{"id": upload["file_id"], "title": title or os.path.basename(file_path)}],
        "channel_id":      channel,
        "initial_comment": text,
    })


# ════════════════════════════════════════════════════════════════════════════════
# SUMMARY FORMATTING
# ════════════════════════════════════════════════════════════════════════════════
#
# Severity buckets are deliberately NOT reported. get_severity() returns 'low'
# for 1-2 misses and find_consecutive_groups() needs CONSECUTIVE_MISS_THRESHOLD
# misses before a streak exists — so on a 1-era scan every record is 'none' or
# 'low' and the critical band can never fire. Reporting it would be reporting a
# constant. Counts and names carry the actual information.

_MAX_NAMED_GAPS = 15


def _fmt_duration(seconds: float) -> str:
    m, sec = divmod(int(seconds), 60)
    return f"{m}m {sec:02d}s" if m else f"{sec}s"


def _gap_list(names: List[str]) -> str:
    if len(names) <= _MAX_NAMED_GAPS:
        return ", ".join(names)
    shown = ", ".join(names[:_MAX_NAMED_GAPS])
    return f"{shown}, +{len(names) - _MAX_NAMED_GAPS} more"


def format_validator_summary(result: dict, elapsed: float, requests_used: int,
                             attached: bool) -> str:
    vals = result["validators"]
    errors = [v for v in vals if v.get("fetchStatus") in ("error", "failed")]
    gaps   = [v for v in vals if v.get("missedEras")]
    clean  = [v for v in vals if v.get("eraStat") and not v.get("missedEras")
              and v.get("fetchStatus") not in ("error", "failed")]
    era_c  = result["era_count"]

    lines = [
        f"Staking Cadence — validator mode — era {result['latest_era']} "
        f"({era_c} era{'s' if era_c != 1 else ''})",
        f"Scanned {len(vals)} · clean {len(clean)} · gaps {len(gaps)} · errors {len(errors)}",
    ]
    if gaps:
        names = [f"{v['display'] or truncate_addr(v['address'])}" for v in gaps]
        eras = sorted({e for v in gaps for e in v["missedEras"]}, reverse=True)
        label = f"era {eras[0]}" if len(eras) == 1 else f"eras {eras}"
        lines.append(f"Missed {label}: {_gap_list(names)}")
    else:
        lines.append("No missed eras.")
    if result.get("stopped"):
        lines.append("⚠ Scan was stopped early — results are partial.")
    lines.append(f"{requests_used} Subscan requests · {_fmt_duration(elapsed)} · "
                 + ("full scan attached" if attached else "export written to disk"))
    return "\n".join(lines)


def format_pool_summary(result: dict, elapsed: float, requests_used: int,
                        attached: bool) -> str:
    pools  = result["pools"]
    errors = [p for p in pools if p.get("fetchStatus") == "error"]
    gaps   = [p for p in pools if p.get("missedEras")]
    rewarded = [p for p in pools if not p.get("missedEras") and p.get("fetchStatus") != "error"]
    era_c  = result["era_count"]
    prov   = result.get("provisional_era")

    lines = [
        f"Staking Cadence — pool mode — era {result['latest_completed']} "
        f"({era_c} era{'s' if era_c != 1 else ''})",
        f"{len(pools)} pools · rewarded {len(rewarded)} · gaps {len(gaps)} · errors {len(errors)}",
    ]
    if prov is not None:
        lines.append(f"⚠ Era {prov} is PROVISIONAL — payout window "
                     f"(era {result['current_era']}) is still open")
    if gaps:
        names = [f"Pool #{p['poolId']}" + (f" {p['metadata'][:24]}" if p["metadata"] else "")
                 for p in gaps]
        lines.append(f"Missed: {_gap_list(names)}")
    else:
        lines.append("No missed eras.")
    if result.get("stopped"):
        lines.append("⚠ Scan was stopped early — results are partial.")
    lines.append(f"{requests_used} Subscan requests · {_fmt_duration(elapsed)} · "
                 + ("full scan attached" if attached else "export written to disk"))
    return "\n".join(lines)


# ════════════════════════════════════════════════════════════════════════════════
# BATCH RUNNER
# ════════════════════════════════════════════════════════════════════════════════

def _env_str(name: str, default: str = "") -> str:
    return (os.environ.get(name) or "").strip() or default


def _env_int(name: str, default: int) -> int:
    raw = _env_str(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        log_line("WARN", f"{name}={raw!r} is not an integer — using {default}.")
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = _env_str(name).lower()
    if not raw:
        return default
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    log_line("WARN", f"{name}={raw!r} is not a boolean — using {default}.")
    return default


def resolve_batch_config(args) -> dict:
    """Config precedence: CLI flag -> .env -> built-in default."""
    modes_raw = args.mode or _env_str("CADENCE_MODES", "validator,pool")
    if modes_raw == "both":
        modes = ["validator", "pool"]
    else:
        modes = [m.strip().lower() for m in modes_raw.split(",") if m.strip()]
    bad = [m for m in modes if m not in ("validator", "pool")]
    if bad or not modes:
        raise SystemExit(
            f"Invalid mode(s): {', '.join(bad) or '(none given)'}. "
            "Use 'validator', 'pool', 'both', or a comma-separated list.")

    eras = args.eras if args.eras is not None else _env_int("CADENCE_ERA_COUNT", 1)
    if eras < 1:
        log_line("WARN", f"--eras {eras} is below 1 — using 1.")
        eras = 1
    elif eras > 100:
        log_line("WARN", f"--eras {eras} exceeds the CLI maximum of 100 — using 100.")
        eras = 100
    if eras > MAX_WEB_ERA_COUNT:
        log_line("WARN", f"--eras {eras} exceeds the web app's {MAX_WEB_ERA_COUNT}-era cap; "
                         "the export will still import, but the app cannot produce a "
                         "comparable scan for cross-checking.")

    attach = _env_bool("SLACK_ATTACH_EXPORT", True)
    if args.no_attach:
        attach = False

    return {
        "modes":         modes,
        "eras":          eras,
        "export":        args.export or "json",
        "out_dir":       args.out or _env_str("CADENCE_OUT_DIR", "./scan-output"),
        "keep_days":     _env_int("CADENCE_KEEP_DAYS", 30),
        "limit":         args.limit,
        "dry_run":       args.dry_run,
        "slack_enabled": (not args.dry_run) and (not args.no_slack),
        "slack_token":   _env_str("SLACK_BOT_TOKEN"),
        "slack_channel": args.slack_channel or _env_str("SLACK_CHANNEL_ID"),
        "slack_attach":  attach,
        "notify_fail":   _env_bool("SLACK_NOTIFY_ON_FAILURE", True),
    }


def prune_old_exports(out_dir: str, keep_days: int) -> None:
    if keep_days <= 0:
        return
    cutoff = time.time() - keep_days * 86400
    removed = 0
    try:
        for f in Path(out_dir).glob("enjin_staking_*"):
            if f.is_file() and f.stat().st_mtime < cutoff:
                f.unlink()
                removed += 1
    except Exception as e:
        log_line("WARN", f"Could not prune {out_dir}: {e}")
        return
    if removed:
        log_line("OK", f"Pruned {removed} export(s) older than {keep_days} day(s).")


def _run_one_mode(mode: str, subscan: SubscanClient, cfg: dict) -> bool:
    """Scan one mode, write its export, post it. Returns True on success.

    Each mode is fully independent: the export is written and posted before the
    next mode starts, so a failure in the second does not cost you the first.
    """
    # Plain text, not rich markup: batch output goes to the journal, where a
    # missing `rich` would print the markup tags verbatim.
    log_line("INFO", f"── Staking Cadence: {mode} mode ──")
    started = time.time()
    before  = subscan.request_count

    try:
        if mode == "validator":
            result = scan_validators(subscan, cfg["eras"], limit=cfg["limit"])
            schema = SCAN_SCHEMAS["validator"]
        else:
            result = scan_pools(subscan, cfg["eras"], limit=cfg["limit"])
            schema = SCAN_SCHEMAS["pool"]
    except ScanError as e:
        log_line("ERR", f"{mode} scan failed: {e}")
        if cfg["slack_enabled"] and cfg["notify_fail"]:
            _try_slack(cfg, f"❌ Staking Cadence — {mode} mode failed: {e}")
        return False

    elapsed  = time.time() - started
    requests_used = subscan.request_count - before

    # Export is always written to disk, even when it is not attached to Slack —
    # the local copy is the durable archive (Slack's free plan hides files after
    # 90 days) and the file you drag into the web app's Import tab.
    path = None
    if cfg["export"] != "none":
        os.makedirs(cfg["out_dir"], exist_ok=True)
        path = os.path.join(cfg["out_dir"], default_scan_filename(schema))
        try:
            write_scan_json(result, path)
        except Exception as e:
            log_line("ERR", f"Failed to write export: {e}")
            path = None

    attach  = bool(path) and cfg["slack_attach"]
    summary = (format_validator_summary if mode == "validator" else format_pool_summary)(
        result, elapsed, requests_used, attach)

    for line in summary.split("\n"):
        log_line("DONE", line)

    if not cfg["slack_enabled"]:
        return True
    return _try_slack(cfg, summary, path if attach else None,
                      title=f"Staking Cadence — {mode} mode")


def _try_slack(cfg: dict, text: str, file_path: Optional[str] = None,
               title: str = "") -> bool:
    if not cfg["slack_token"] or not cfg["slack_channel"]:
        log_line("WARN", "SLACK_BOT_TOKEN or SLACK_CHANNEL_ID is unset — skipping Slack.")
        return False
    try:
        slack_post(cfg["slack_token"], cfg["slack_channel"], text, file_path, title)
        log_line("OK", "Posted to Slack." + (" (with attachment)" if file_path else ""))
        return True
    except Exception as e:
        log_line("ERR", f"Slack delivery failed: {e}")
        return False


def run_batch(args) -> int:
    """Non-interactive entry point. Returns a process exit code."""
    cfg = resolve_batch_config(args)

    api_key = _env_str("SUBSCAN_API_KEY")
    if not api_key:
        log_line("ERR", "SUBSCAN_API_KEY is not set — cannot run a Subscan scan.")
        if cfg["slack_enabled"] and cfg["notify_fail"]:
            _try_slack(cfg, "❌ Staking Cadence scan aborted: SUBSCAN_API_KEY is not set.")
        return 2
    subscan = SubscanClient(api_key)

    log_line("INFO", f"Batch run: modes={','.join(cfg['modes'])} eras={cfg['eras']} "
                     f"export={cfg['export']} out={cfg['out_dir']} "
                     f"slack={'on' if cfg['slack_enabled'] else 'off'} "
                     f"attach={'yes' if cfg['slack_attach'] else 'no'}")

    ok = True
    for mode in cfg["modes"]:
        if not _run_one_mode(mode, subscan, cfg):
            ok = False

    if cfg["export"] != "none":
        prune_old_exports(cfg["out_dir"], cfg["keep_days"])

    log_line("DONE" if ok else "ERR",
             f"Batch run finished ({subscan.request_count} Subscan requests total).")
    return 0 if ok else 1


def show_about() -> None:
    content = f"""[bold]EnjinSight[/bold] — Enjin Blockchain monitoring tools (read-only, no wallet required)

[bold cyan]Tools available:[/bold cyan]
  1. Era Block Explorer        Real-time era/session/block metrics + historical era lookup
  2. Staking Reward Cadence    Missed-era detection for validators and nomination pools
  3. Historical Balance Viewer Archive-node balance history with multi-format export
  4. Reward History Viewer     Per-era staking reward computation
  5. ENJ Infusion Checker      ERC-20 ENJ infusion lookup for Ethereum ERC-1155 tokens

[bold cyan]Network:[/bold cyan]
  Enjin Relaychain            wss://rpc.relay.blockchain.enjin.io
  Enjin Archive Node          wss://archive.relay.blockchain.enjin.io
  Enjin Matrixchain Archive   wss://archive.matrix.blockchain.enjin.io
  Canary Relaychain Archive   wss://archive.relay.canary.enjin.io
  Ethereum Mainnet            Etherscan / optional Alchemy / public RPC fallbacks
  Subscan Explorer            {EXPLORER_BASE}

[bold cyan]Links:[/bold cyan]
  GitHub     {GITHUB_URL}
  README     {GITHUB_URL}/blob/main/README.md
  Subscan    {EXPLORER_BASE}

[bold cyan]Disclaimer:[/bold cyan]
  EnjinSight is a third-party, community-built tool. Information displayed is derived from publicly available on-chain data and is provided for research and reference purposes only. It does not constitute financial, accounting, tax, or legal advice, and should not be relied upon as a definitive or complete record. Always verify any information against your own primary records before making operational, accounting, tax, or other material decisions.

[bold cyan]Scheduled / non-interactive use:[/bold cyan]
  Staking Cadence can run unattended and post its results to Slack with the scan
  export attached, for a daily cron or systemd timer:

    enjinsight_cli.py --non-interactive --mode both --eras 1 --export json

  --export json writes the EnjinSight scan envelope, which loads in the web app's
  Staking Cadence -> Import tab. Run --help for every flag; anything not passed
  falls back to .env. Setup guide: deploy/README.md

[bold cyan]Security:[/bold cyan]
  - API key read from environment (never hard-coded)
  - Subscan and Etherscan API keys read from environment
  - WS endpoints validated (wss:// only for production)
  - All addresses validated via SS58 decode before use
  - Ethereum wallet addresses and token IDs validated before use
  - No user input reaches eval or shell execution
"""
    if HAS_RICH:
        console.print(Panel(content, title="About EnjinSight CLI", border_style="cyan"))
    else:
        print("\nEnjinSight CLI\n" + "="*60)
        print(f"GitHub: {GITHUB_URL}")
        print(f"README: {GITHUB_URL}/blob/main/README.md")
        print(f"Subscan: {EXPLORER_BASE}")
        print("\nDisclaimer: EnjinSight is unofficial third-party tooling and is not developed")
        print("by or affiliated with the Enjin development team. Treat data as a research aid.")

# ════════════════════════════════════════════════════════════════════════════════
# MAIN MENU
# ════════════════════════════════════════════════════════════════════════════════

def build_arg_parser() -> argparse.ArgumentParser:
    """Batch-mode arguments.

    With no arguments at all the CLI behaves exactly as it always has: the
    interactive menu. Every flag below is inert unless --non-interactive is given.
    """
    ap = argparse.ArgumentParser(
        prog="enjinsight_cli.py",
        description="EnjinSight CLI — Enjin Blockchain monitoring (read-only). "
                    "Run with no arguments for the interactive menu.",
        epilog="Example: enjinsight_cli.py --non-interactive --tool staking-cadence "
               "--mode both --eras 1 --export json --out ./scan-output",
    )
    ap.add_argument("--non-interactive", action="store_true",
                    help="run without prompts (for cron/systemd); required for every flag below")
    ap.add_argument("--tool", default="staking-cadence", choices=["staking-cadence"],
                    help="which tool to run (default: staking-cadence)")
    ap.add_argument("--mode", default=None,
                    help="validator, pool, both, or a comma-separated list "
                         "(default: $CADENCE_MODES, else validator,pool)")
    ap.add_argument("--eras", type=int, default=None,
                    help="recent eras to scan (default: $CADENCE_ERA_COUNT, else 1)")
    ap.add_argument("--export", default=None, choices=["json", "none"],
                    help="json writes the web app's import envelope (default: json)")
    ap.add_argument("--out", default=None,
                    help="output directory (default: $CADENCE_OUT_DIR, else ./scan-output)")
    ap.add_argument("--limit", type=int, default=None,
                    help="scan only the first N validators/pools — for fast smoke tests")
    ap.add_argument("--no-slack", action="store_true", help="skip Slack delivery")
    ap.add_argument("--no-attach", action="store_true",
                    help="post the summary without attaching the export")
    ap.add_argument("--slack-channel", default=None,
                    help="override $SLACK_CHANNEL_ID (useful for a test channel)")
    ap.add_argument("--dry-run", action="store_true",
                    help="write export files but post nothing to Slack")
    return ap


def main() -> None:
    global _BATCH_MODE
    args = build_arg_parser().parse_args()
    if args.non_interactive:
        _BATCH_MODE = True
        sys.exit(run_batch(args))

    if HAS_RICH:
        console.print(Panel(
            "[bold cyan]EnjinSight CLI[/bold cyan]\n"
            "Enjin Blockchain monitoring — read-only, no wallet required",
            border_style="cyan",
        ))
    else:
        print("\n" + "="*60)
        print("EnjinSight CLI — Enjin Blockchain monitoring")
        print("="*60)

    # Load API key
    api_key = os.environ.get("SUBSCAN_API_KEY", "").strip()
    if not api_key:
        cprint("[yellow]Warning: SUBSCAN_API_KEY not set. Subscan tools will fail.[/yellow]")
        cprint("Set it in .env or as an environment variable.")
    if not os.environ.get("ETHERSCAN_API_KEY", "").strip():
        cprint("[yellow]Warning: ETHERSCAN_API_KEY not set. ENJ Infusion wallet scans and Etherscan fallback will be unavailable.[/yellow]")

    # Init clients
    subscan: Optional[SubscanClient] = None
    if api_key:
        try:
            subscan = SubscanClient(api_key)
        except ValueError as e:
            cprint(f"[red]{e}[/red]")

    # Load era CSV
    era_csv = load_era_csv()
    if era_csv:
        cprint(f"[dim]Era reference CSV: {len(era_csv)} eras loaded[/dim]")
    else:
        cprint("[yellow]Era reference CSV not found — some features may be slower.[/yellow]")

    while True:
        cprint("\n[bold]Main Menu:[/bold]")
        cprint("  1. Era Block Explorer")
        cprint("  2. Staking Reward Cadence")
        cprint("  3. Historical Balance Viewer")
        cprint("  4. Reward History Viewer")
        cprint("  5. ENJ Infusion Checker")
        cprint("  6. About / Info")
        cprint("  0. Exit")

        choice = ask("Select tool", "0")

        if choice == "1":
            tool_era_explorer(era_csv)
        elif choice == "2":
            if not subscan:
                cprint("[red]SUBSCAN_API_KEY required for this tool.[/red]"); continue
            tool_staking_cadence(subscan)
        elif choice == "3":
            tool_balance_explorer(era_csv)
        elif choice == "4":
            if not subscan:
                cprint("[red]SUBSCAN_API_KEY required for this tool.[/red]"); continue
            tool_reward_history(subscan, era_csv)
        elif choice == "5":
            tool_infusion_checker()
        elif choice == "6":
            show_about()
        elif choice == "0":
            cprint("\n[dim]Goodbye.[/dim]")
            break
        else:
            cprint("[yellow]Invalid choice.[/yellow]")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        cprint("\n[dim]Interrupted.[/dim]")
        sys.exit(0)
