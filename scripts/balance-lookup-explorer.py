#!/usr/bin/env python3
"""
balance-lookup-explorer.py — Educational Enjin Balance Lookup

Walks through EVERY step of how this web app fetches a wallet balance:

  ① SS58 address  →  32-byte public key    (Base58 decode + prefix strip)
  ② Blake2b-128 hash of that public key
  ③ Assemble the full System.Account storage key
  ④ JSON-RPC: chain_getHeader   →  current block number
  ⑤ JSON-RPC: chain_getBlockHash →  32-byte block hash
  ⑥ JSON-RPC: state_getStorage  →  raw SCALE AccountInfo bytes
  ⑦ SCALE decode the bytes       →  free / reserved / frozen balances

All raw bytes, hex values, intermediate computations and decoded results
are printed so you can follow exactly what the web app does internally.

Requirements:
    pip install websockets
"""

import asyncio
import hashlib
import json
import ssl
import struct
import sys

try:
    import websockets
except ImportError:
    # Try adding the user-level site-packages path (common on macOS when using
    # the system Python + pip install --user)
    import site, importlib
    try:
        sys.path += site.getusersitepackages() if isinstance(site.getusersitepackages(), list) \
            else [site.getusersitepackages()]
        websockets = importlib.import_module("websockets")
    except Exception:
        print("\n  Missing dependency. Install it with:")
        print("      pip install websockets\n")
        sys.exit(1)

try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    # certifi not installed — fall back to the default context.
    # On macOS with a framework Python this may fail; run:
    #   pip install certifi
    _SSL_CTX = ssl.create_default_context()


# ═══════════════════════════════════════════════════════════════════════════════
#  CONSTANTS  (mirrors src/constants.js exactly)
# ═══════════════════════════════════════════════════════════════════════════════

NETWORKS = {
    "1": {
        "name":        "Enjin Matrixchain",
        "endpoint":    "wss://archive.matrix.blockchain.enjin.io",
        "prefix":      1110,
        "symbol":      "ENJ",
        "addr_prefix": "ef",
    },
    "2": {
        "name":        "Enjin Relaychain",
        "endpoint":    "wss://archive.relay.blockchain.enjin.io",
        "prefix":      2135,
        "symbol":      "ENJ",
        "addr_prefix": "en",
    },
}

# System.Account storage map prefix
# = twox128("System") ++ twox128("Account")   —— never changes
SYS_ACCT_PREFIX = "26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9"

PLANCK_PER_ENJ  = 10 ** 18          # 1 ENJ = 1_000_000_000_000_000_000 Planck
IS_NEW_LOGIC_BIT = 1 << 127         # MSB of a u128 — flags "new frozen format"

BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

RPC_TIMEOUT_S = 20   # seconds to wait for each RPC response


# ═══════════════════════════════════════════════════════════════════════════════
#  DISPLAY HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

W = 74   # banner width

def banner(title: str):
    print(f"\n{'═' * W}")
    print(f"  {title}")
    print(f"{'═' * W}")

def divider():
    print(f"  {'─' * (W - 2)}")

def step(msg: str):
    """Top-level step within a section."""
    print(f"\n  ▸ {msg}")

def note(msg: str):
    """Supporting detail line under a step."""
    print(f"      {msg}")

def kv(label: str, value):
    """Key-value pair, nicely aligned."""
    print(f"      {label:<26} {value}")

def planck_fmt(p: int) -> str:
    """Format a Planck integer as 'X.YYYY ENJ  (N Planck)'."""
    if p == 0:
        return "0 ENJ  (0 Planck)"
    whole = p // PLANCK_PER_ENJ
    frac  = p % PLANCK_PER_ENJ
    enj_str = f"{whole:,}.{frac:018d}".rstrip("0").rstrip(".")
    return f"{enj_str} ENJ  ({p:,} Planck)"


# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 1a — Base58 Decode
# ═══════════════════════════════════════════════════════════════════════════════

def base58_decode(s: str) -> bytes:
    """
    Convert a Base58 string to bytes.

    Base58 encodes a big integer using 58 printable characters.
    We read each character's index in the alphabet and accumulate
    the value as:  n = n * 58 + char_index

    Then convert that big integer to bytes.
    """
    step("Base58-decode the address string character by character")
    note(f"Alphabet  : {BASE58_ALPHABET}")
    note(f"Length    : {len(s)} characters in the address")
    note("")
    note("Each character maps to an index 0-57.  We compute:")
    note("  n = 0")
    note("  for each char: n = n * 58 + index(char)")
    note("Then convert n (a big integer) to bytes.")

    n = 0
    for char in s:
        idx = BASE58_ALPHABET.find(char)
        if idx < 0:
            raise ValueError(f"Invalid Base58 character: '{char}' in address")
        n = n * 58 + idx

    # Convert big integer → bytes (big-endian)
    result = []
    while n > 0:
        result.append(n & 0xFF)
        n >>= 8
    result.reverse()

    # Each leading '1' in Base58 represents a zero byte
    leading_zeros = len(s) - len(s.lstrip("1"))
    decoded = bytes(leading_zeros) + bytes(result)

    note("")
    note(f"Result ({len(decoded)} bytes):")
    note(f"  0x{decoded.hex()}")

    return decoded


# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 1b — SS58 Decode (extract 32-byte public key)
# ═══════════════════════════════════════════════════════════════════════════════

def ss58_decode(address: str) -> bytes:
    """
    Decode an SS58 address to its raw 32-byte public key (AccountId32).

    SS58 byte layout after Base58-decoding:
      [ network prefix: 1 or 2 bytes ]
      [ public key:     32 bytes     ]
      [ checksum:       2 bytes      ]

    A 2-byte prefix is signalled by bit 6 (0x40) being set in byte 0.
    """
    banner("STEP 1 — Decode SS58 Address → 32-byte Public Key")

    step(f"Input: {address}")
    note("SS58 is Substrate's address format (similar to Bitcoin's Base58Check).")
    note("It wraps  [network_prefix][32-byte_pubkey][2-byte_checksum]  in Base58.")

    raw = base58_decode(address)

    # Minimum: 1-byte prefix + 32-byte pubkey + 2-byte checksum = 35 bytes
    if len(raw) < 35:
        raise ValueError(
            f"Decoded address is only {len(raw)} bytes — SS58 requires at least 35 "
            "(1 prefix + 32 pubkey + 2 checksum). Invalid address?"
        )

    # ── Prefix length ──────────────────────────────────────────────────────────
    step("Inspect byte 0 to determine prefix width")
    b0 = raw[0]
    note(f"Byte 0 = 0x{b0:02x}  =  {b0:08b} (binary)")
    note( "If bit 6 (value 0x40 = 0b01000000) is SET → 2-byte prefix  (prefix ≥ 64)")
    note( "If bit 6 is CLEAR                         → 1-byte prefix  (prefix  < 64)")

    is_two_byte = (b0 & 0x40) != 0

    if is_two_byte:
        note(f"Bit 6 is SET → 2-byte prefix")
        b1 = raw[1]
        # Substrate's "canary" two-byte prefix encoding/decoding formula:
        #   encoded_b0 = ((prefix & 0xFC) >> 2) | 0x40
        #   encoded_b1 = (prefix >> 8) | ((prefix & 0x03) << 6)
        # So to decode:
        #   prefix = ((b0 & 0x3F) << 2) | ((b1 & 0xC0) >> 6) | ((b1 & 0x3F) << 8)
        step("Decode 2-byte SS58 prefix (Substrate 'canary' encoding):")
        note(f"  byte 0 = 0x{b0:02x}  ({b0:08b})")
        note(f"  byte 1 = 0x{b1:02x}  ({b1:08b})")
        note( "")
        note( "  Formula:  prefix = ((b0 & 0x3F) << 2) | ((b1 & 0xC0) >> 6) | ((b1 & 0x3F) << 8)")
        part_a = (b0 & 0x3F) << 2
        part_b = (b1 & 0xC0) >> 6
        part_c = (b1 & 0x3F) << 8
        prefix = part_a | part_b | part_c
        note(f"  (0x{b0:02x} & 0x3F) << 2  =  {part_a:>5}  ← low 6 bits of b0, shifted left 2")
        note(f"  (0x{b1:02x} & 0xC0) >> 6  =  {part_b:>5}  ← high 2 bits of b1, shifted right 6")
        note(f"  (0x{b1:02x} & 0x3F) << 8  =  {part_c:>5}  ← low 6 bits of b1, shifted left 8")
        note(f"  OR together            =  {prefix}")
        pfx_len = 2
    else:
        note(f"Bit 6 is CLEAR → 1-byte prefix")
        prefix = b0
        pfx_len = 1

    note(f"")
    note(f"Decoded SS58 network prefix = {prefix}")

    # ── Public key ─────────────────────────────────────────────────────────────
    pub      = raw[pfx_len : pfx_len + 32]
    checksum = raw[pfx_len + 32 :]

    step("Split the decoded bytes into their three regions:")
    note(f"  bytes[0:{pfx_len}]           prefix   = 0x{raw[:pfx_len].hex()}  ({pfx_len} byte{'s' if pfx_len>1 else ''})")
    note(f"  bytes[{pfx_len}:{pfx_len+32}]  pubkey   = 0x{pub.hex()}")
    note(f"  bytes[{pfx_len+32}:]         checksum = 0x{checksum.hex()}  (2 bytes)")

    if len(pub) != 32:
        raise ValueError(f"Public key is {len(pub)} bytes — expected 32.  Invalid address?")

    step("Verify the 2-byte SS58 checksum:")
    note("  checksum = blake2b(b'SS58PRE' + prefix_bytes + pubkey, digest_size=64)[:2]")
    note("  The constant b'SS58PRE' is the Substrate-mandated magic prefix for SS58.")
    expected_checksum = hashlib.blake2b(b"SS58PRE" + raw[:-2], digest_size=64).digest()[:2]
    note(f"  Expected : 0x{expected_checksum.hex()}")
    note(f"  Got      : 0x{checksum.hex()}")
    if checksum != expected_checksum:
        raise ValueError(
            f"SS58 checksum mismatch (got {checksum.hex()}, expected {expected_checksum.hex()}). "
            "Wrong network prefix or corrupted address?"
        )
    note("  ✓ Checksum valid")

    step("Extracted 32-byte public key (AccountId32):")
    note(f"  0x{pub.hex()}")

    return pub


def _ss58_decode_quiet(address: str) -> bytes:
    """Decode an SS58 address to its 32-byte public key without printing anything."""
    n = 0
    for char in address:
        idx = BASE58_ALPHABET.find(char)
        if idx < 0:
            raise ValueError(f"Invalid Base58 character: '{char}'")
        n = n * 58 + idx
    result = []
    while n > 0:
        result.append(n & 0xFF)
        n >>= 8
    result.reverse()
    leading = len(address) - len(address.lstrip("1"))
    raw     = bytes(leading) + bytes(result)
    if len(raw) < 35:
        raise ValueError(
            f"Decoded address is only {len(raw)} bytes — SS58 requires at least 35 "
            "(1 prefix + 32 pubkey + 2 checksum). Invalid address?"
        )
    pfx_len  = 2 if (raw[0] & 0x40) != 0 else 1
    pub      = raw[pfx_len : pfx_len + 32]
    if len(pub) != 32:
        raise ValueError(f"Public key is {len(pub)} bytes — expected 32.")
    expected = hashlib.blake2b(b"SS58PRE" + raw[:-2], digest_size=64).digest()[:2]
    if raw[-2:] != expected:
        raise ValueError(
            f"SS58 checksum mismatch (got {raw[-2:].hex()}, expected {expected.hex()}). "
            "Wrong network prefix or corrupted address?"
        )
    return pub


def ss58_encode(pub: bytes, prefix: int) -> str:
    """
    Encode a 32-byte public key as an SS58 address for the given network prefix.

    Inverse of _ss58_decode_quiet:
      1. Encode the prefix (1 byte if < 64, else 2-byte canary encoding)
      2. Compute checksum: blake2b(b"SS58PRE" + prefix_bytes + pub, digest_size=64)[:2]
      3. Base58-encode (prefix_bytes + pub + checksum)
    """
    if prefix < 64:
        prefix_bytes = bytes([prefix])
    else:
        # 2-byte canary encoding for prefixes 64–16383
        b0 = ((prefix >> 2) & 0x3F) | 0x40
        b1 = ((prefix & 0x03) << 6) | ((prefix >> 8) & 0x3F)
        prefix_bytes = bytes([b0, b1])
    payload  = prefix_bytes + pub
    checksum = hashlib.blake2b(b"SS58PRE" + payload, digest_size=64).digest()[:2]
    raw      = payload + checksum
    n        = int.from_bytes(raw, 'big')
    chars    = []
    while n > 0:
        n, r = divmod(n, 58)
        chars.append(BASE58_ALPHABET[r])
    chars.reverse()
    leading = len(raw) - len(raw.lstrip(b'\x00'))
    return '1' * leading + ''.join(chars)


# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 2 — Blake2b-128 Hash
# ═══════════════════════════════════════════════════════════════════════════════

def blake2b_128(pub: bytes) -> bytes:
    """
    Hash the public key with Blake2b at 128-bit (16-byte) digest size.

    Substrate uses the 'Blake2_128Concat' storage hasher for System.Account:
      Blake2_128Concat(key) = blake2b(key, digest_size=16) ++ key

    Purpose of the hash:
      • Prevents enumeration of storage keys from sequential pubkeys
      • 16 bytes is enough to make grinding infeasible
      • Appending the raw key ('Concat' part) lets nodes verify the map key
    """
    banner("STEP 2 — Hash the Public Key with Blake2b-128")

    step("Why do we hash the key before using it in storage?")
    note("Substrate storage map keys are hashed to prevent enumeration attacks.")
    note("System.Account uses the 'Blake2_128Concat' hasher, which means:")
    note("  storageKey_suffix = blake2b(pubkey, digest_size=16) ++ pubkey")
    note("                      └──── 16 bytes ─────────────────┘   └─ 32 bytes ─┘")
    note("  The raw pubkey is appended so the node can recover the key from the storage suffix.")

    step(f"Input — raw public key ({len(pub)} bytes):")
    note(f"  0x{pub.hex()}")

    h = hashlib.blake2b(pub, digest_size=16).digest()

    step(f"blake2b(pubkey, digest_size=16)  →  hash output ({len(h)} bytes):")
    note(f"  0x{h.hex()}")

    step("Blake2_128Concat result  =  hash ++ raw pubkey:")
    note(f"  hash   : 0x{h.hex()}  ({len(h)} bytes)")
    note(f"  pubkey : 0x{pub.hex()}  ({len(pub)} bytes)")
    note(f"  concat : 0x{(h + pub).hex()}")
    note(f"           └──────── {len(h)+len(pub)} bytes total ────────────────────────────────────┘")

    return h   # caller assembles the full key


# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 3 — Assemble the Full Storage Key
# ═══════════════════════════════════════════════════════════════════════════════

def build_storage_key(address: str) -> str:
    """
    Build the Substrate storage key for System.Account[address].

    Key layout (80 bytes = 160 hex chars):
      twox128("System")   (16 bytes)
      twox128("Account")  (16 bytes)
      blake2b_128(pubkey) (16 bytes)  ← Blake2_128Concat hasher: hash part
      pubkey              (32 bytes)  ← Blake2_128Concat hasher: raw key part
    """
    pub = ss58_decode(address)
    h16 = blake2b_128(pub)

    banner("STEP 3 — Assemble the Full Substrate Storage Key")

    step("Every Substrate storage item has a key built from three parts:")
    note("  [ twox128(pallet_name) ][ twox128(storage_item_name) ][ hashed_map_key ]")
    note("  └──────── 16 bytes ──────┘└──────────── 16 bytes ─────────────────────┘")
    note("  These are concated together, then used as a Patricia Merkle Trie lookup key.")

    step("Part 1 — Pallet prefix (constant, pre-computed, never changes):")
    note(f"  SYS_ACCT_PREFIX = 0x{SYS_ACCT_PREFIX}")
    note(f"    twox128('System')  = {SYS_ACCT_PREFIX[:32]}   ← first 16 bytes")
    note(f"    twox128('Account') = {SYS_ACCT_PREFIX[32:]}   ← next  16 bytes")
    note( "")
    note( "  twox128 is a very fast non-cryptographic hash (safe for trusted inputs like")
    note( "  pallet/item names).  It is used here because the key is known and fixed.")

    step("Part 2 — Hashed account key (Blake2_128Concat):")
    note(f"  blake2b_128(pubkey) = 0x{h16.hex()}   ← 16-byte hash")
    note(f"  raw pubkey          = 0x{pub.hex()}")
    note(f"  concatenated        = 0x{(h16 + pub).hex()}")

    full_key = "0x" + SYS_ACCT_PREFIX + h16.hex() + pub.hex()

    step("Part 3 — Final storage key (concatenate all three parts):")
    note(f"  0x")
    note(f"  + {SYS_ACCT_PREFIX}")
    note(f"    └── twox128 pallet prefix (32 hex = 16 bytes)")
    note(f"  + {h16.hex()}")
    note(f"    └── blake2b_128(pubkey)  (32 hex = 16 bytes)")
    note(f"  + {pub.hex()}")
    note(f"    └── raw pubkey          (64 hex = 32 bytes)")

    divider()
    print(f"  FINAL STORAGE KEY ({(len(full_key)-2)//2} bytes  =  {len(full_key)-2} hex chars):")
    print(f"")
    print(f"  {full_key}")
    divider()

    return full_key


# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 4-6 — JSON-RPC Helper
# ═══════════════════════════════════════════════════════════════════════════════

async def rpc_call(ws, req_id: int, method: str, params: list):
    """
    Send one JSON-RPC 2.0 request over WebSocket and return result.
    Prints the full request and response so you can see exactly what is sent.
    """
    request = {
        "jsonrpc": "2.0",
        "id":      req_id,
        "method":  method,
        "params":  params,
    }

    divider()
    print(f"  → SENDING (id={req_id}):")
    print()
    # Pretty-print the request, indented under the divider
    for line in json.dumps(request, indent=4).splitlines():
        print(f"    {line}")

    await asyncio.wait_for(ws.send(json.dumps(request)), timeout=RPC_TIMEOUT_S)
    raw_resp = await asyncio.wait_for(ws.recv(), timeout=RPC_TIMEOUT_S)
    try:
        resp = json.loads(raw_resp)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"Node returned invalid JSON on method {method!r}: {exc}"
        ) from exc

    if resp.get("id") != req_id:
        raise RuntimeError(
            f"RPC response id mismatch: sent {req_id!r}, got {resp.get('id')!r} "
            f"(method={method!r})"
        )

    print()
    print(f"  ← RECEIVED (id={req_id}):")
    print()
    for line in json.dumps(resp, indent=4).splitlines():
        print(f"    {line}")
    divider()

    if "error" in resp:
        raise RuntimeError(f"RPC error on '{method}': {resp['error']}")

    if "result" not in resp:
        raise RuntimeError(
            f"RPC response missing 'result' field (method={method!r}): "
            f"keys present: {list(resp.keys())}"
        )

    return resp["result"]


# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 7 — Decode SCALE-encoded AccountInfo
# ═══════════════════════════════════════════════════════════════════════════════

def decode_account_info(hex_val):
    """
    Decode the raw hex bytes returned by state_getStorage into AccountInfo fields.

    AccountInfo SCALE layout — all integers are little-endian (LE):

      NEW header (total ≥ 80 bytes):
        [0x00–0x03]  nonce        u32  (4 bytes LE)
        [0x04–0x07]  consumers    u32  (4 bytes LE)
        [0x08–0x0B]  providers    u32  (4 bytes LE)
        [0x0C–0x0F]  sufficients  u32  (4 bytes LE)
        [0x10–0x1F]  free         u128 (16 bytes LE)
        [0x20–0x2F]  reserved     u128 (16 bytes LE)
        [0x30–0x3F]  misc_frozen  u128 (16 bytes LE)
        [0x40–0x4F]  field4       u128 (16 bytes LE)  ← fee_frozen OR flags

      OLD header (total < 80 bytes — 3 u32s instead of 4):
        offsets shift down by 4 bytes from 'free' onward.

    field4 interpretation (IS_NEW_LOGIC_BIT = 2^127):
      If bit 127 of field4 is SET  → new format; field4 is a flags bitfield, fee_frozen = 0
      If bit 127 of field4 is CLEAR → legacy;    field4 IS the fee_frozen amount
    """
    banner("STEP 7 — Decode the Raw SCALE Bytes into AccountInfo Fields")

    if not hex_val or hex_val == "0x":
        step("Response is null / '0x'")
        note("This means the account does not exist on this network yet.")
        note("(It has never received any tokens, so no storage slot has been allocated.)")
        return None

    step("Raw hex value as returned by state_getStorage:")
    note(f"{hex_val}")

    try:
        raw = bytes.fromhex(hex_val[2:] if hex_val.startswith("0x") else hex_val)
    except ValueError as exc:
        raise RuntimeError(f"Invalid hex in state_getStorage response: {exc}") from exc

    step(f"Converted to a {len(raw)}-byte array for parsing")
    note("SCALE encoding rules applied here:")
    note("  • All integers are stored in LITTLE-ENDIAN byte order")
    note("  • u32  = 4 bytes  — read with struct.unpack('<I', ...)")
    note("  • u128 = 16 bytes — read as two u64s: lo | (hi << 64)")

    is_new_header = len(raw) >= 80
    step("Determine AccountInfo header variant (affects field offsets):")
    note(f"  Total bytes = {len(raw)}")
    if is_new_header:
        note("  ≥ 80 bytes → 4-field header: nonce + consumers + providers + sufficients")
    else:
        note("  < 80 bytes → 3-field header: nonce + consumers + sufficients  (no providers)")

    # ── Byte-offset tracker ────────────────────────────────────────────────────
    off = [0]

    def read_u32():
        start = off[0]
        if start + 4 > len(raw):
            raise ValueError(
                f"Truncated AccountInfo: need 4 bytes at offset {start}, "
                f"only {len(raw) - start} available"
            )
        chunk = raw[start : start + 4]
        val   = struct.unpack("<I", chunk)[0]
        off[0] += 4
        return chunk, val

    def read_u128():
        start = off[0]
        if start + 16 > len(raw):
            raise ValueError(
                f"Truncated AccountInfo: need 16 bytes at offset {start}, "
                f"only {len(raw) - start} available"
            )
        chunk = raw[start : start + 16]
        lo, hi = struct.unpack("<QQ", chunk)
        val = lo | (hi << 64)
        off[0] += 16
        return chunk, val

    # ── Print field table ──────────────────────────────────────────────────────
    step("Parsing each field:")
    note("")
    COL = f"  {'Byte range':<14} {'Field':<14} {'Raw bytes (little-endian)':<34}  Decoded"
    note(COL[6:])   # strip leading spaces so it aligns under 'note' indent
    print(f"      {'─'*14} {'─'*14} {'─'*34}  {'─'*24}")

    def print_row(name, chunk, val):
        end = off[0] - 1
        start_b = off[0] - len(chunk)
        marker = f"[0x{start_b:02x}–0x{end:02x}]"
        print(f"      {marker:<14} {name:<14} {chunk.hex():<34}  {val}")

    chunk, nonce = read_u32()
    print_row("nonce", chunk, nonce)

    chunk, consumers = read_u32()
    print_row("consumers", chunk, consumers)

    if is_new_header:
        chunk, providers = read_u32()
        print_row("providers", chunk, providers)

        chunk, sufficients = read_u32()
        print_row("sufficients", chunk, sufficients)
    else:
        providers = None
        chunk, sufficients = read_u32()
        print_row("sufficients", chunk, sufficients)
        print(f"      {'(no providers)':<14} {'─':<14} {'─':<34}  (3-field header)")

    chunk, free = read_u128()
    print_row("free", chunk, free)

    chunk, reserved = read_u128()
    print_row("reserved", chunk, reserved)

    chunk, misc_frozen = read_u128()
    print_row("misc_frozen", chunk, misc_frozen)

    chunk, field4 = read_u128()
    print_row("field4", chunk, field4)

    # ── IS_NEW_LOGIC_BIT check ─────────────────────────────────────────────────
    new_format = (field4 & IS_NEW_LOGIC_BIT) != 0

    step("Interpret field4 — check IS_NEW_LOGIC_BIT (bit 127 of the u128):")
    note(f"  IS_NEW_LOGIC_BIT = 2^127  (= 1 followed by 127 zeros in binary)")
    note(f"  field4           = {field4}")
    note(f"  field4 >> 127    = {field4 >> 127}   ← this is 1 if bit 127 is set, 0 if not")

    if new_format:
        note("  Bit 127 is SET → new frozen-flags format")
        note("    field4 is a bitfield where each bit represents a different freeze reason.")
        note("    It is NOT a plain ENJ amount.  fee_frozen is treated as 0.")
        fee_frozen = 0
    else:
        note("  Bit 127 is CLEAR → legacy format")
        note("    field4 IS the fee_frozen balance (an ENJ amount in Planck).")
        fee_frozen = field4

    # ── Planck → ENJ conversion ────────────────────────────────────────────────
    step(f"Convert Planck values to ENJ  (divide by 10^18 = {PLANCK_PER_ENJ:,}):")
    note(f"  free         : {planck_fmt(free)}")
    note(f"  reserved     : {planck_fmt(reserved)}")
    note(f"  misc_frozen  : {planck_fmt(misc_frozen)}")
    note(f"  fee_frozen   : {planck_fmt(fee_frozen)}")

    return {
        "nonce":       nonce,
        "consumers":   consumers,
        "providers":   providers,
        "sufficients": sufficients,
        "free":        free,
        "reserved":    reserved,
        "misc_frozen": misc_frozen,
        "fee_frozen":  fee_frozen,
        "new_format":  new_format,
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  FINAL SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════

def print_summary(network_name, address, block, block_hash, info):
    banner("FINAL RESULT SUMMARY")
    kv("Network",    network_name)
    kv("Address",    address)
    kv("Block",      f"#{block:,}")
    kv("Block hash", f"{block_hash[:20]}…{block_hash[-8:]}")
    print()
    divider()
    if not info:
        print("  Account not found — no tokens on this network.")
        divider()
        return
    print(f"  {'Free balance':<20} {planck_fmt(info['free'])}")
    print(f"  {'Reserved':<20} {planck_fmt(info['reserved'])}")
    print(f"  {'Misc frozen':<20} {planck_fmt(info['misc_frozen'])}")
    print(f"  {'Fee frozen':<20} {planck_fmt(info['fee_frozen'])}")
    print()
    print(f"  {'Nonce':<20} {info['nonce']}  (number of transactions sent)")
    print(f"  {'new_format flag':<20} {info['new_format']}")
    divider()


# ═══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════════════════════

async def main():
    print()
    print("╔" + "═" * (W - 2) + "╗")
    print("║" + "  Enjin Balance Explorer — Step-by-Step Educational Script".center(W - 2) + "║")
    print("╚" + "═" * (W - 2) + "╝")

    print("\nAvailable networks:")
    for k, v in NETWORKS.items():
        print(f"  {k}) {v['name']}")
        print(f"     SS58 prefix : {v['prefix']}")
        print(f"     Archive node: {v['endpoint']}")
        print()

    while True:
        choice = input("Choose network [1/2]: ").strip()
        if choice in NETWORKS:
            break
        print("  Please enter 1 or 2.")

    network = NETWORKS[choice]
    print()
    address = input(f"Enter {network['name']} wallet address: ").strip()
    if not address:
        print("No address entered.  Exiting.")
        sys.exit(1)

    try:
        pub = _ss58_decode_quiet(address)
    except Exception as e:
        print(f"\n  Invalid address: {e}")
        sys.exit(1)

    # Validate the address belongs to the selected network
    expected_prefix = network["addr_prefix"]
    if not address.startswith(expected_prefix):
        other = next(
            (v for v in NETWORKS.values()
             if v["addr_prefix"] != expected_prefix
             and address.startswith(v["addr_prefix"])),
            None,
        )
        wrong_name = other["name"] if other else "another network"
        print(f"\n  Error: This address looks like a {wrong_name} address "
              f"(starts with '{address[:2]}'), not a {network['name']} address "
              f"(expected addresses start with '{expected_prefix}').")
        converted = ss58_encode(pub, network["prefix"])
        print(f"\n  Converted address for {network['name']}:")
        print(f"  {converted}")
        print()
        while True:
            ans = input("  Proceed with the converted address? [Y/n]: ").strip().lower()
            if ans in ("y", "yes", ""):
                address = converted
                print(f"  Using: {address}")
                print()
                break
            elif ans in ("n", "no"):
                print("  Exiting.")
                sys.exit(1)
            else:
                print("  Please enter y or n.")

    print()
    print(f"  Network  : {network['name']}")
    print(f"  Address  : {address}")
    print(f"  Endpoint : {network['endpoint']}")

    # ── Steps 1-3: pure local computation — no network needed ──────────────────
    try:
        storage_key = build_storage_key(address)
    except Exception as e:
        print(f"\n  Error building storage key: {e}")
        sys.exit(1)

    # ── Steps 4-6: open WebSocket and fire RPC calls ───────────────────────────
    banner("STEP 4 — Open WebSocket Connection to the Archive Node")
    step(f"Connecting to: {network['endpoint']}")
    note("Why WebSocket? Substrate nodes use JSON-RPC over WebSocket (ws:// or wss://).")
    note("An archive node is required — it retains ALL historical chain state,")
    note("unlike a regular full node which only keeps the last few thousand blocks.")

    try:
        async with websockets.connect(network["endpoint"], ssl=_SSL_CTX) as ws:
            step("Connection established!")

            # RPC 1: chain_getHeader
            banner("STEP 5 — JSON-RPC Call 1 of 3: chain_getHeader")
            step("Purpose: get the latest block header so we know the current block number.")
            note("The 'number' field in the response is a hex string, e.g. '0x1a2b3c'.")

            header = await rpc_call(ws, 1, "chain_getHeader", [])
            block_number = int(header["number"], 16)
            step(f"Decoded: {header['number']} (hex) → {block_number:,} (decimal)")

            # RPC 2: chain_getBlockHash
            banner("STEP 6 — JSON-RPC Call 2 of 3: chain_getBlockHash")
            step(f"Purpose: get the 32-byte hash of block #{block_number:,}.")
            note("state_getStorage requires a block hash to query state at a specific point")
            note("in time.  Without it, some nodes return current state (non-deterministic).")
            note(f"We are querying the latest block: #{block_number:,}.")

            block_hash = await rpc_call(ws, 2, "chain_getBlockHash", [block_number])
            step(f"Block hash: {block_hash}")
            note(f"  This is a 32-byte Blake2b-256 hash of the block header  ({len(block_hash)-2} hex chars).")

            # RPC 3: state_getStorage
            banner("STEP 6b — JSON-RPC Call 3 of 3: state_getStorage")
            step("Purpose: fetch the raw on-chain storage bytes for this account.")
            note(f"  Param 0 (storageKey):")
            note(f"    {storage_key[:20]}…{storage_key[-12:]}  ← built in Steps 1–3")
            note(f"  Param 1 (blockHash):")
            note(f"    {block_hash[:20]}…{block_hash[-12:]}  ← from Step 6")
            note("")
            note("The archive node does:")
            note("  1. Look up the state root for blockHash")
            note("  2. Walk the Patricia Merkle Trie from that root")
            note("  3. Return the raw bytes stored at storageKey, or null if not found")

            raw_value = await rpc_call(ws, 3, "state_getStorage", [storage_key, block_hash])

            if raw_value and raw_value != "0x":
                step(f"Received {(len(raw_value)-2)//2} bytes of raw SCALE-encoded data.")
            else:
                step("Received null / '0x' — account not found at this block.")

            # ── Step 7: decode ─────────────────────────────────────────────────
            info = decode_account_info(raw_value)

            # ── Summary ────────────────────────────────────────────────────────
            print_summary(network["name"], address, block_number, block_hash, info)

    except websockets.exceptions.InvalidURI:
        print(f"\n  Error: Invalid WebSocket URI: {network['endpoint']}")
        sys.exit(1)
    except (OSError, websockets.exceptions.WebSocketException) as e:
        print(f"\n  Connection failed: {e}")
        print(f"  Check your internet connection and that the archive node is reachable.")
        sys.exit(1)
    except asyncio.TimeoutError:
        print("\n  Timed out waiting for a response from the node.")
        sys.exit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\nInterrupted by user.")
    except Exception as e:
        print(f"\n  Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
