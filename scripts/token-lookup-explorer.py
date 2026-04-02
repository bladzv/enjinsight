#!/usr/bin/env python3
"""
token-lookup-explorer.py — Educational Enjin Token Lookup

Walks through EVERY step of how the web app discovers tokens a wallet holds.
Supports two chains with different token models:

─── Enjin Relaychain — sENJ nomination-pool shares ──────────────────────────
  ① Build the NominationPools.BondedPools storage-map prefix (32 bytes)
      twox128("NominationPools") ++ twox128("BondedPools")
  ② JSON-RPC: state_getKeysPaged  →  list every pool's storage key
  ③ Decode each raw key to extract the pool_id (u32 LE, last 4 bytes)
  ④ For each pool — build the MultiTokens.TokenAccounts storage key:
       twox128("MultiTokens") ++ twox128("TokenAccounts")
       ++ Blake2_128Concat(u128_le(collectionId=1))
       ++ Blake2_128Concat(u128_le(tokenId=pool_id))
       ++ Blake2_128Concat(pubkey)
  ⑤ JSON-RPC: state_getStorage  →  raw SCALE-compact bytes for member balance
  ⑥ SCALE compact-decode the balance (sENJ Planck)
  ⑦ For pools with non-zero balance — build MultiTokens.Tokens key to get
     total supply, then compute share % = your_balance / total_supply × 100

─── Enjin Matrixchain — NFTs & semi-fungible tokens (SFTs) ──────────────────
  ① Enumerate MultiTokens.Collections on-chain   (OR user supplies IDs)
       prefix = twox128("MultiTokens") ++ twox128("Collections")   (32 bytes)
  ② For each collection enumerate MultiTokens.Tokens via a per-collection
     prefix to discover all token IDs:
       prefix = twox128(MT) ++ twox128(Tokens) ++ B128C(u128_le(cid))  (64 bytes)
  ③ For each (collectionId, tokenId) — check MultiTokens.TokenAccounts:
       twox128(MT) ++ twox128(TokenAccounts)
       ++ Blake2_128Concat(u128_le(cid))
       ++ Blake2_128Concat(u128_le(tid))
       ++ Blake2_128Concat(pubkey)
  ④ SCALE compact-decode each balance and display non-zero results

All raw bytes, hex values, intermediate computations and decoded results
are printed so you can follow exactly what the web app does internally.

Requirements:
    pip install websockets certifi
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import ssl
import struct
import sys

try:
    import websockets
except ImportError:
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
    _SSL_CTX = ssl.create_default_context()


# ═══════════════════════════════════════════════════════════════════════════════
#  CONSTANTS  (mirrors src/constants.js and src/hooks/useRewardHistory.js)
# ═══════════════════════════════════════════════════════════════════════════════

NETWORKS = {
    "1": {
        "name":        "Enjin Matrixchain",
        "endpoint":    "wss://archive.matrix.blockchain.enjin.io",
        "prefix":      1110,
        "addr_prefix": "ef",
    },
    "2": {
        "name":        "Enjin Relaychain",
        "endpoint":    "wss://archive.relay.blockchain.enjin.io",
        "prefix":      2135,
        "addr_prefix": "en",
    },
}

COLLECTION_ID  = 1          # sENJ multi-token collection (always 1 on Enjin)
PLANCK_PER_ENJ = 10 ** 18   # 1 ENJ = 10^18 Planck
BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
RPC_TIMEOUT_S   = 20
KEYS_PAGE_SIZE  = 500       # pool keys fetched per state_getKeysPaged page


# ═══════════════════════════════════════════════════════════════════════════════
#  DISPLAY HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

W = 78

def banner(title: str):
    print(f"\n{'═' * W}")
    print(f"  {title}")
    print(f"{'═' * W}")

def divider():
    print(f"  {'─' * (W - 2)}")

def step(msg: str):
    print(f"\n  ▸ {msg}")

def note(msg: str):
    print(f"      {msg}")

def planck_fmt(p: int) -> str:
    if p == 0:
        return "0 sENJ  (0 Planck)"
    whole = p // PLANCK_PER_ENJ
    frac  = p % PLANCK_PER_ENJ
    enj_str = f"{whole:,}.{frac:018d}".rstrip("0").rstrip(".")
    return f"{enj_str} sENJ  ({p:,} Planck)"


# ═══════════════════════════════════════════════════════════════════════════════
#  HASHING PRIMITIVES
# ═══════════════════════════════════════════════════════════════════════════════

def xxh64(data: bytes, seed: int) -> int:
    """
    xxHash-64 implementation used by Substrate's twox128 storage hasher.

    twox128(text) = xxh64(text, seed=0) ++ xxh64(text, seed=1)   (little-endian each)

    This is the same algorithm embedded in src/utils/substrate.js' _xxh64().
    It is NOT a cryptographic hash — it is a fast, non-cryptographic hash used
    only for pallet/item names which are fixed trusted strings.
    """
    P1 = 0x9E3779B185EBCA87
    P2 = 0xC2B2AE3D27D4EB4F
    P3 = 0x165667B19E3779F9
    P4 = 0x85EBCA77C2B2AE63
    P5 = 0x27D4EB2F165667C5
    M  = 0xFFFFFFFFFFFFFFFF

    def lo(x):  return x & M
    def mul(a, b): return lo(a * b)
    def add(a, b): return lo(a + b)
    def rotl(x, r): return lo((x << r) | (x >> (64 - r)))

    n = len(data)
    p = 0
    s = seed & M

    if n >= 32:
        v1 = add(add(s, P1), P2)
        v2 = add(s, P2)
        v3 = s
        v4 = lo(s - P1)
        while p <= n - 32:
            for vi_idx, vi in enumerate([v1, v2, v3, v4]):
                lane = int.from_bytes(data[p:p+8], 'little')
                vi   = mul(rotl(add(vi, mul(lane, P2)), 31), P1)
                if vi_idx == 0: v1 = vi
                elif vi_idx == 1: v2 = vi
                elif vi_idx == 2: v3 = vi
                else: v4 = vi
                p += 8
        h = add(add(add(rotl(v1, 1), rotl(v2, 7)), rotl(v3, 12)), rotl(v4, 18))
        for vi in [v1, v2, v3, v4]:
            h = add(mul(lo(h ^ mul(rotl(mul(vi, P2), 31), P1)), P1), P4)
    else:
        h = add(s, P5)

    h = add(h, n)

    while p <= n - 8:
        lane = int.from_bytes(data[p:p+8], 'little')
        h = add(mul(rotl(lo(h ^ mul(rotl(mul(lane, P2), 31), P1)), 27), P1), P4)
        p += 8
    if p <= n - 4:
        lane = int.from_bytes(data[p:p+4], 'little')
        h = add(mul(rotl(lo(h ^ mul(lane, P1)), 23), P2), P3)
        p += 4
    while p < n:
        h = mul(rotl(lo(h ^ mul(data[p], P5)), 11), P1)
        p += 1

    h = mul(lo(h ^ (h >> 33)), P2)
    h = mul(lo(h ^ (h >> 29)), P3)
    return lo(h ^ (h >> 32))


def twox128(text: str) -> bytes:
    """
    Compute the 16-byte twox128 hash of a UTF-8 string.
    = xxh64(text, 0) ++ xxh64(text, 1)   (each stored little-endian)
    """
    b = text.encode("utf-8")
    h0 = xxh64(b, 0)
    h1 = xxh64(b, 1)
    return h0.to_bytes(8, 'little') + h1.to_bytes(8, 'little')


def blake2b_128_concat(key_bytes: bytes) -> bytes:
    """
    Blake2_128Concat hasher:  blake2b(key, 16 bytes) ++ key

    Used for ALL three map dimensions in MultiTokens.TokenAccounts:
      Blake2_128Concat(collectionId_u128_le)
      Blake2_128Concat(tokenId_u128_le)
      Blake2_128Concat(pubkey_32bytes)
    """
    h = hashlib.blake2b(key_bytes, digest_size=16).digest()
    return h + key_bytes


def u128_le(n: int) -> bytes:
    """Encode an integer as a u128 little-endian (16 bytes)."""
    return n.to_bytes(16, 'little')


# ═══════════════════════════════════════════════════════════════════════════════
#  SS58 / ADDRESS DECODE  (mirrors substrate.js ss58Decode)
# ═══════════════════════════════════════════════════════════════════════════════

def base58_decode_silent(s: str) -> bytes:
    """Base58-decode without printing (used internally by ss58_decode)."""
    n = 0
    for char in s:
        idx = BASE58_ALPHABET.find(char)
        if idx < 0:
            raise ValueError(f"Invalid Base58 character: '{char}'")
        n = n * 58 + idx
    result = []
    while n > 0:
        result.append(n & 0xFF)
        n >>= 8
    result.reverse()
    leading = len(s) - len(s.lstrip("1"))
    return bytes(leading) + bytes(result)


def ss58_decode_silent(address: str) -> bytes:
    """Decode an SS58 address to its raw 32-byte public key (no prints)."""
    raw     = base58_decode_silent(address)
    # Minimum: 1-byte prefix + 32-byte pubkey + 2-byte checksum = 35 bytes
    if len(raw) < 35:
        raise ValueError(
            f"Decoded address is only {len(raw)} bytes — SS58 requires at least 35 "
            "(1 prefix + 32 pubkey + 2 checksum). Invalid address?"
        )
    pfx_len = 2 if (raw[0] & 0x40) != 0 else 1
    pub     = raw[pfx_len : pfx_len + 32]
    if len(pub) != 32:
        raise ValueError(f"Public key is {len(pub)} bytes — expected 32.")
    # Verify the 2-byte SS58 checksum (blake2b-512 of the magic prefix + payload)
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

    Inverse of ss58_decode_silent:
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
#  STEP 1 — Build BondedPools prefix
# ═══════════════════════════════════════════════════════════════════════════════

def build_bonded_pools_prefix() -> str:
    """
    Build the 32-byte NominationPools.BondedPools storage prefix.

    This is the first 32 bytes shared by EVERY BondedPools entry in the trie.
    Passing this prefix to state_getKeysPaged returns all pool storage keys.

    Layout:
      twox128("NominationPools")  — 16 bytes
      twox128("BondedPools")      — 16 bytes
    """
    banner("STEP 1 — Build the NominationPools.BondedPools Storage Prefix")

    step("What is a storage prefix?")
    note("Substrate's storage trie organises map entries under a shared prefix:")
    note("  prefix         = twox128(pallet) ++ twox128(storage_item)")
    note("  full entry key = prefix ++ hasher(map_key)")
    note("")
    note("By querying just the prefix we can ask the node for ALL keys in that map")
    note("without knowing the individual pool IDs ahead of time.")

    step("Computing twox128('NominationPools'):")
    txt = "NominationPools"
    b   = txt.encode("utf-8")
    h0  = xxh64(b, 0)
    h1  = xxh64(b, 1)
    h0b = h0.to_bytes(8, 'little')
    h1b = h1.to_bytes(8, 'little')
    note(f"  Input (UTF-8)     : b'{txt}'")
    note(f"  xxh64(seed=0)     : {h0:#018x}  → LE bytes: {h0b.hex()}")
    note(f"  xxh64(seed=1)     : {h1:#018x}  → LE bytes: {h1b.hex()}")
    note(f"  twox128 result    : 0x{(h0b + h1b).hex()}  (16 bytes)")

    step("Computing twox128('BondedPools'):")
    txt2 = "BondedPools"
    b2   = txt2.encode("utf-8")
    h0b2 = xxh64(b2, 0).to_bytes(8, 'little')
    h1b2 = xxh64(b2, 1).to_bytes(8, 'little')
    note(f"  Input (UTF-8)     : b'{txt2}'")
    note(f"  twox128 result    : 0x{(h0b2 + h1b2).hex()}  (16 bytes)")

    prefix_bytes = twox128("NominationPools") + twox128("BondedPools")
    prefix_hex   = "0x" + prefix_bytes.hex()

    step("Assembling the prefix:")
    note(f"  twox128('NominationPools') = {prefix_bytes[:16].hex()}")
    note(f"  twox128('BondedPools')     = {prefix_bytes[16:].hex()}")
    note(f"  concatenated (32 bytes)    = {prefix_bytes.hex()}")
    divider()
    print(f"  BONDED POOLS PREFIX (32 bytes):")
    print(f"  {prefix_hex}")
    divider()

    return prefix_hex


# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 3 — Extract pool_id from a raw BondedPools storage key
# ═══════════════════════════════════════════════════════════════════════════════

def pool_id_from_key(key_hex: str) -> int | None:
    """
    Extract the pool_id (u32) from a full NominationPools.BondedPools storage key.

    Full key layout (44 bytes = 88 hex chars):
      bytes  0-15  twox128('NominationPools')   — 16 bytes
      bytes 16-31  twox128('BondedPools')        — 16 bytes
      bytes 32-39  twox64(pool_id)               — 8 bytes  ← non-transparent hash
      bytes 40-43  pool_id as u32 LE             — 4 bytes  ← raw value appended

    Substrate uses 'Twox64Concat' for NominationPools.BondedPools:
      Twox64Concat(pool_id) = xxh64(pool_id_le_bytes, seed=0) ++ pool_id_le_bytes

    The last 4 bytes are always the actual pool_id in little-endian byte order.
    """
    s = key_hex[2:] if key_hex.startswith("0x") else key_hex
    if len(s) < 88:
        return None
    # Last 4 bytes of the 44-byte key = pool_id u32 LE
    b = bytes.fromhex(s[80:88])
    return struct.unpack("<I", b)[0]


# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 4 — Build MultiTokens.TokenAccounts storage key
# ═══════════════════════════════════════════════════════════════════════════════

def build_token_account_key(collection_id: int, token_id: int, address: str, *,
                            verbose: bool = True) -> str:
    """
    Build the MultiTokens.TokenAccounts storage key for:
      TokenAccounts(collectionId: u128, tokenId: u128, account: AccountId32)

    This is a triple-nested storage map.  All three dimensions use
    Blake2_128Concat as the hasher.

    Key layout (144 bytes):
      twox128("MultiTokens")       — 16 bytes  (pallet)
      twox128("TokenAccounts")     — 16 bytes  (storage item)
      B128C(u128_le(collectionId)) — 32 bytes  (16-byte hash + 16-byte value)
      B128C(u128_le(tokenId))      — 32 bytes
      B128C(pubkey)                — 48 bytes  (16-byte hash + 32-byte pubkey)
    Total: 16+16+32+32+48 = 144 bytes

    verbose=False suppresses all output; useful for batch scanning many tokens.
    """
    # ── Compute all parts first (no I/O) ───────────────────────────────────────
    p_mt      = twox128("MultiTokens")
    p_ta      = twox128("TokenAccounts")
    cid_bytes = u128_le(collection_id)
    cid_hash  = hashlib.blake2b(cid_bytes, digest_size=16).digest()
    cid_part  = cid_hash + cid_bytes
    tid_bytes = u128_le(token_id)
    tid_hash  = hashlib.blake2b(tid_bytes, digest_size=16).digest()
    tid_part  = tid_hash + tid_bytes
    pub       = ss58_decode_silent(address)
    pub_hash  = hashlib.blake2b(pub, digest_size=16).digest()
    pub_part  = pub_hash + pub
    full      = p_mt + p_ta + cid_part + tid_part + pub_part
    key       = "0x" + full.hex()

    if verbose:
        banner(f"  Build MultiTokens.TokenAccounts key  (collection={collection_id}, tokenId={token_id})")

        step("MultiTokens.TokenAccounts is a triple-nested map:")
        note("  map key format: Blake2_128Concat(collectionId) ++ Blake2_128Concat(tokenId) ++ Blake2_128Concat(account)")
        note("")
        note("  Blake2_128Concat(x) = blake2b(x, digest_size=16) ++ x")
        note("  Each dimension is individually hashed and concatenated.")

        step("Part A — Pallet prefix:")
        note(f"  twox128('MultiTokens')   = {p_mt.hex()}")
        note(f"  twox128('TokenAccounts') = {p_ta.hex()}")

        step("Part B — Blake2_128Concat(collectionId as u128 LE):")
        note(f"  collectionId = {collection_id}")
        note(f"  as u128 LE (16 bytes) = {cid_bytes.hex()}")
        note(f"  blake2b_128(bytes)    = {cid_hash.hex()}  ← 16-byte hash")
        note(f"  concat (hash ++ val)  = {cid_part.hex()}  ← 32 bytes total")

        step("Part C — Blake2_128Concat(tokenId as u128 LE):")
        note(f"  tokenId = {token_id}")
        note(f"  as u128 LE (16 bytes) = {tid_bytes.hex()}")
        note(f"  blake2b_128(bytes)    = {tid_hash.hex()}  ← 16-byte hash")
        note(f"  concat (hash ++ val)  = {tid_part.hex()}  ← 32 bytes total")

        step("Part D — Blake2_128Concat(pubkey / AccountId32):")
        note(f"  pubkey (32 bytes)     = {pub.hex()}")
        note(f"  blake2b_128(pubkey)   = {pub_hash.hex()}  ← 16-byte hash")
        note(f"  concat (hash ++ pub)  = {pub_part.hex()}  ← 48 bytes total")

        step(f"Part E — Assemble all {len(full)} bytes:")
        note(f"  [0-15]   twox128('MultiTokens')   : {p_mt.hex()}")
        note(f"  [16-31]  twox128('TokenAccounts') : {p_ta.hex()}")
        note(f"  [32-63]  B128C(collectionId)      : {cid_part.hex()}")
        note(f"  [64-95]  B128C(tokenId)           : {tid_part.hex()}")
        note(f"  [96-143] B128C(pubkey)            : {pub_part.hex()}")
        divider()
        print(f"  TOKEN ACCOUNT KEY ({len(full)} bytes  =  {len(full)*2} hex chars):")
        print(f"  {key}")
        divider()

    return key


# ═══════════════════════════════════════════════════════════════════════════════
#  STEP 7 — Build MultiTokens.Tokens key (for total supply)
# ═══════════════════════════════════════════════════════════════════════════════

def build_tokens_key(collection_id: int, token_id: int) -> str:
    """
    Build the MultiTokens.Tokens storage key for:
      Tokens(collectionId: u128, tokenId: u128)

    Used to read the total circulating supply of sENJ shares for a pool.
    With the wallet's balance and this total supply we can compute share %.

    Key layout (96 bytes):
      twox128("MultiTokens") — 16 bytes
      twox128("Tokens")      — 16 bytes
      B128C(u128_le(collectionId)) — 32 bytes
      B128C(u128_le(tokenId))      — 32 bytes
    Total: 16+16+32+32 = 96 bytes
    """
    p_mt   = twox128("MultiTokens")
    p_tok  = twox128("Tokens")

    cid_bytes = u128_le(collection_id)
    cid_part  = hashlib.blake2b(cid_bytes, digest_size=16).digest() + cid_bytes
    tid_bytes = u128_le(token_id)
    tid_part  = hashlib.blake2b(tid_bytes, digest_size=16).digest() + tid_bytes

    full = p_mt + p_tok + cid_part + tid_part
    return "0x" + full.hex()


# ═══════════════════════════════════════════════════════════════════════════════
#  MATRIXCHAIN NFT HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def build_collections_prefix() -> str:
    """
    Build the 32-byte MultiTokens.Collections storage prefix.
    Passing this to state_getKeysPaged returns ALL collection storage keys,
    letting us enumerate every NFT/SFT collection without knowing their IDs.

    Layout:
      twox128("MultiTokens")  — 16 bytes
      twox128("Collections")  — 16 bytes

    Full per-collection key layout (64 bytes):
      [0-15]  twox128('MultiTokens')
      [16-31] twox128('Collections')
      [32-47] blake2b_128(u128_le(cid))  ← non-recoverable hash
      [48-63] collectionId as u128 LE    ← recoverable plain value
    """
    banner("STEP 1a — Build MultiTokens.Collections Prefix (enumerate all collections)")

    step("What is the Collections prefix?")
    note("  MultiTokens.Collections is a single storage map keyed by collectionId.")
    note("  By querying just the 32-byte pallet+item prefix we can ask the node for")
    note("  ALL collections without knowing any IDs ahead of time.")
    note("")
    note("  Full key layout (64 bytes):")
    note("    [0-15]  twox128('MultiTokens')             — pallet hash")
    note("    [16-31] twox128('Collections')             — item hash")
    note("    [32-47] blake2b_128(u128_le(collectionId)) — non-recoverable")
    note("    [48-63] collectionId as u128 LE            — recoverable ✓")

    p_mt   = twox128("MultiTokens")
    p_coll = twox128("Collections")

    step("Computing the prefix:")
    note(f"  twox128('MultiTokens')  = {p_mt.hex()}")
    note(f"  twox128('Collections')  = {p_coll.hex()}")

    prefix = "0x" + (p_mt + p_coll).hex()
    divider()
    print(f"  COLLECTIONS PREFIX (32 bytes): {prefix}")
    divider()
    return prefix


def collection_id_from_key(key_hex: str) -> int | None:
    """
    Extract the collectionId (u128) from a full MultiTokens.Collections key.

    Key layout: prefix(32B) + blake2b_128(cid_bytes)(16B) + cid_u128_le(16B)
    The last 16 bytes of each 64-byte key are the collectionId in LE byte order.
    """
    s = key_hex[2:] if key_hex.startswith("0x") else key_hex
    if len(s) < 128:          # 64 bytes minimum
        return None
    return int.from_bytes(bytes.fromhex(s[96:128]), 'little')  # bytes [48:64]


def build_tokens_prefix_for_collection(cid: int, *, verbose: bool = True) -> str:
    """
    Build the 64-byte MultiTokens.Tokens prefix scoped to one collection.
    Passing this to state_getKeysPaged enumerates every token ID in that
    collection without needing to know the IDs in advance.

    Layout:
      twox128("MultiTokens")       — 16 bytes
      twox128("Tokens")            — 16 bytes
      B128C(u128_le(collectionId)) — 32 bytes (hash + value)
    Total: 64 bytes

    Full per-token key layout (96 bytes):
      [0-15]  twox128('MultiTokens')
      [16-31] twox128('Tokens')
      [32-47] blake2b_128(u128_le(cid))  ← hash, non-recoverable
      [48-63] collectionId u128 LE       ← recoverable
      [64-79] blake2b_128(u128_le(tid))  ← hash, non-recoverable
      [80-95] tokenId u128 LE            ← recoverable ✓
    """
    p_mt   = twox128("MultiTokens")
    p_toks = twox128("Tokens")
    cid_b  = u128_le(cid)
    cid_h  = hashlib.blake2b(cid_b, digest_size=16).digest()
    cid_p  = cid_h + cid_b
    prefix = "0x" + (p_mt + p_toks + cid_p).hex()

    if verbose:
        banner(f"STEP 1b — Build MultiTokens.Tokens Prefix for Collection {cid}")
        step("This 64-byte prefix scopes state_getKeysPaged to only return token")
        note("keys that belong to this specific collection.")
        note("")
        note("  Full Tokens key layout (96 bytes):")
        note("    [0-15]  twox128('MultiTokens')")
        note("    [16-31] twox128('Tokens')")
        note("    [32-47] blake2b_128(u128_le(cid)) — hash (non-recoverable)")
        note("    [48-63] collectionId u128 LE       — recoverable")
        note("    [64-79] blake2b_128(u128_le(tid)) — hash (non-recoverable)")
        note("    [80-95] tokenId u128 LE            — recoverable ✓")
        note("")
        note("  The prefix covers bytes [0-63]; tokenId is read from bytes [80-95]")
        note("  of each key returned by state_getKeysPaged.")
        step(f"Computing 64-byte prefix for collection {cid}:")
        note(f"  twox128('MultiTokens') = {p_mt.hex()}")
        note(f"  twox128('Tokens')      = {p_toks.hex()}")
        note(f"  cid = {cid}  →  u128_le = {cid_b.hex()}")
        note(f"  blake2b_128(cid_bytes) = {cid_h.hex()}")
        note(f"  B128C(cid)             = {cid_p.hex()}  (32 bytes)")
        divider()
        print(f"  TOKENS PREFIX (64 bytes) for collection {cid}:")
        print(f"  {prefix}")
        divider()

    return prefix


def token_id_from_tokens_key(key_hex: str) -> int | None:
    """
    Extract the tokenId (u128) from a full MultiTokens.Tokens storage key.

    Key layout (96 bytes): prefix(64B) + blake2b_128(tid_bytes)(16B) + tid_u128_le(16B)
    The last 16 bytes of each 96-byte key are the tokenId in LE byte order.
    """
    s = key_hex[2:] if key_hex.startswith("0x") else key_hex
    if len(s) < 192:          # 96 bytes minimum
        return None
    return int.from_bytes(bytes.fromhex(s[160:192]), 'little')  # bytes [80:96]


def build_collection_key(collection_id: int) -> str:
    """
    Build the MultiTokens.Collections storage key for a specific collection.
    Collections(collectionId: u128)

    Key layout (64 bytes):
      twox128("MultiTokens")       — 16 bytes
      twox128("Collections")       — 16 bytes
      B128C(u128_le(collectionId)) — 32 bytes  (blake2b_128 hash + value)
    Total: 64 bytes
    """
    p_mt   = twox128("MultiTokens")
    p_coll = twox128("Collections")
    cid_b  = u128_le(collection_id)
    cid_p  = hashlib.blake2b(cid_b, digest_size=16).digest() + cid_b
    return "0x" + (p_mt + p_coll + cid_p).hex()


def collection_owner_pubkey(raw_hex: str) -> bytes | None:
    """
    Extract the owner's 32-byte public key from a SCALE-encoded
    MultiTokens::Collection storage value.

    In Enjin's pallet-multi-tokens the Collection struct is:
      struct Collection { owner: AccountId32, policy: ..., ... }
    The `owner` field is first, stored as a flat 32-byte value (not compact).
    So bytes [0:32] of the raw value are always the owner's public key.

    Returns None if the value is null/empty or shorter than 32 bytes.
    """
    if not raw_hex or raw_hex in (None, "0x", ""):
        return None
    try:
        raw = bytes.fromhex(raw_hex[2:] if raw_hex.startswith("0x") else raw_hex)
    except ValueError:
        return None
    if len(raw) < 32:
        return None
    return raw[:32]


# ═══════════════════════════════════════════════════════════════════════════════
#  SCALE COMPACT DECODE  (mirrors substrate.js decodeCompactFirst)
# ═══════════════════════════════════════════════════════════════════════════════

def decode_compact_first(hex_val: str, *, verbose: bool = False) -> int:
    """
    Decode the first SCALE compact-encoded integer from raw storage bytes.

    pallet-multi-tokens stores balances as compact integers:

      Mode bits (byte[0] & 0b11):
        0b00  single-byte:  value = byte[0] >> 2           (range 0–63)
        0b01  two-byte LE:  value = u16_le[0:2] >> 2       (range 64–16383)
        0b10  four-byte LE: value = u32_le[0:4] >> 2       (range up to ~1B)
        0b11  big-integer:  n = (byte[0] >> 2) + 4,        (very large amounts)
                            n bytes LE follow at [1..n]

    'Compact' means small values take fewer bytes — efficient on-chain storage.
    """
    if not hex_val or hex_val == "0x" or hex_val is None:
        return 0

    try:
        raw = bytes.fromhex(hex_val[2:] if hex_val.startswith("0x") else hex_val)
    except ValueError as exc:
        raise ValueError(f"Invalid hex in compact value: {exc}") from exc
    if not raw:
        return 0

    mode = raw[0] & 0b11

    _MODE_NAMES = {0: "single-byte mode", 1: "two-byte LE mode",
                   2: "four-byte LE mode", 3: "big-integer mode"}

    if verbose:
        step("SCALE compact-decode the raw storage value:")
        note(f"  Raw hex   : {hex_val[:66]}{'…' if len(hex_val) > 66 else ''}")
        note(f"  Byte 0    : 0x{raw[0]:02x}  =  {raw[0]:08b}")
        note(f"  Low 2 bits: 0b{mode:02b}  →  {_MODE_NAMES[mode]}")

    if mode == 0:
        value = raw[0] >> 2
        if verbose:
            note(f"  value = byte[0] >> 2 = {raw[0]} >> 2 = {value}")
    elif mode == 1:
        if len(raw) < 2:
            raise ValueError(
                f"Compact two-byte decode overflow: need 2 bytes, only {len(raw)} available"
            )
        u16 = (raw[0] | (raw[1] << 8)) & 0xFFFF
        value = u16 >> 2
        if verbose:
            note(f"  u16_le = 0x{u16:04x}  ({u16})")
            note(f"  value  = {u16} >> 2 = {value}")
    elif mode == 2:
        if len(raw) < 4:
            raise ValueError(
                f"Compact four-byte decode overflow: need 4 bytes, only {len(raw)} available"
            )
        u32 = struct.unpack("<I", raw[0:4])[0]
        value = u32 >> 2
        if verbose:
            note(f"  u32_le = 0x{u32:08x}  ({u32})")
            note(f"  value  = {u32} >> 2 = {value}")
    else:
        n = (raw[0] >> 2) + 4
        if 1 + n > len(raw):
            raise ValueError(
                f"Compact big-int decode overflow: header requires {n} byte(s) "
                f"but only {len(raw) - 1} available in raw value"
            )
        v = int.from_bytes(raw[1:1+n], 'little')
        value = v
        if verbose:
            note(f"  n = (0x{raw[0]:02x} >> 2) + 4 = {n} bytes")
            note(f"  value = {v}")

    if verbose:
        note(f"  Decoded value : {value}  ({planck_fmt(value)})")

    return value


# ═══════════════════════════════════════════════════════════════════════════════
#  JSON-RPC HELPER
# ═══════════════════════════════════════════════════════════════════════════════

async def rpc_call(ws, req_id: int, method: str, params: list, *, silent: bool = False):
    request = {
        "jsonrpc": "2.0",
        "id":      req_id,
        "method":  method,
        "params":  params,
    }

    if not silent:
        divider()
        print(f"  → SENDING (id={req_id}):")
        print()
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

    if not silent:
        print()
        print(f"  ← RECEIVED (id={req_id}):")
        print()
        # Truncate very long result arrays for readability
        display = dict(resp)
        if isinstance(display.get("result"), list) and len(display["result"]) > 6:
            display = dict(display)
            display["result"] = display["result"][:3] + [f"… ({len(resp['result'])} total) …"] + display["result"][-2:]
        for line in json.dumps(display, indent=4).splitlines():
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
#  SUMMARY TABLES
# ═══════════════════════════════════════════════════════════════════════════════

def print_nft_summary(network_name: str, address: str, head_block: int,
                      tokens: list, *, zero_balance_tokens: list | None = None):
    """
    Display a summary table of all NFT / multi-token balances found.
    tokens:               list of {"collection_id": int, "token_id": int, "balance": int}
    zero_balance_tokens:  optional list of tokens where an account entry exists
                          for this wallet but the free balance is 0 (e.g. tokens
                          minted and fully transferred to other wallets).
    """
    banner("FINAL RESULT SUMMARY")
    print(f"  Network      : {network_name}")
    print(f"  Address      : {address}")
    print(f"  Queried at   : block #{head_block:,}  (current chain head)")
    print()

    held = [t for t in tokens if t["balance"] > 0]
    zb   = zero_balance_tokens or []

    if not held and not zb:
        divider()
        print("  No NFT or multi-token balances found for this address.")
        print("  (The wallet owns no tokens in the scanned collection(s).)")
        divider()
        return

    from collections import defaultdict

    if held:
        by_cid = defaultdict(list)
        for t in held:
            by_cid[t["collection_id"]].append(t)

        divider()
        print(f"  TOKENS WITH BALANCE — {len(held)} token(s) across {len(by_cid)} collection(s).")
        print()
        print(f"  {'Collection ID':<16} {'Token ID':<20} {'Balance'}")
        print(f"  {'─'*14}  {'─'*18}  {'─'*24}")
        for cid in sorted(by_cid.keys()):
            for t in sorted(by_cid[cid], key=lambda x: x["token_id"]):
                bal = t["balance"]
                # Large balances are fungible-style (Planck); small are NFT counts
                bal_str = planck_fmt(bal) if bal >= PLANCK_PER_ENJ else f"{bal:,}"
                print(f"  {cid:<16} {t['token_id']:<20} {bal_str}")
        divider()
    else:
        divider()
        print("  No NFT or multi-token balances found for this address.")
        divider()

    if zb:
        zb_by_cid = defaultdict(list)
        for t in zb:
            zb_by_cid[t["collection_id"]].append(t)

        transferred = [t for t in zb if not t.get("account_exists", True)]
        existing_zb = [t for t in zb if t.get("account_exists", True)]

        print()
        print(f"  ZERO-BALANCE / TRANSFERRED-AWAY TOKENS — "
              f"{len(zb)} token(s) across {len(zb_by_cid)} collection(s).")
        if transferred:
            print(f"  ({len(transferred)} with no on-chain account entry — "
                  f"transferred away from an owned collection)")
        if existing_zb:
            print(f"  ({len(existing_zb)} with account entry present but balance = 0 — "
                  f"reserved/locked balance keeps entry alive)")
        print()
        print(f"  {'Collection ID':<16} {'Token ID':<20} {'Status'}")
        print(f"  {'─'*14}  {'─'*18}  {'─'*38}")
        for cid in sorted(zb_by_cid.keys()):
            for t in sorted(zb_by_cid[cid], key=lambda x: x["token_id"]):
                if t.get("account_exists", True):
                    status = "account entry exists, balance = 0"
                else:
                    status = "no account entry — transferred away (collection owner)"
                print(f"  {cid:<16} {t['token_id']:<20} {status}")
        divider()


def print_summary(network_name: str, address: str, head_block: int, pools: list):
    banner("FINAL RESULT SUMMARY")
    print(f"  Network      : {network_name}")
    print(f"  Address      : {address}")
    print(f"  Queried at   : block #{head_block:,}  (current chain head)")
    print()

    held = [p for p in pools if p["balance"] > 0]

    if not held:
        divider()
        print("  No sENJ token balance found in any nomination pool.")
        print("  (This wallet has not joined any pool, or it has no shares.)")
        divider()
        return

    divider()
    header = f"  {'Pool ID':<9} {'Your sENJ balance':<38} {'Total supply':<38} {'Share %'}"
    print(header)
    print(f"  {'─'*7}  {'─'*36}  {'─'*36}  {'─'*8}")
    for p in held:
        bal  = p["balance"]
        sup  = p["supply"]
        pct  = (bal / sup * 100) if sup > 0 else 0.0
        name = f"  (pool {p['id']})"
        print(f"  {p['id']:<9} {planck_fmt(bal):<38} {planck_fmt(sup):<38} {pct:.6f}%")
    divider()


# ═══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════════════════════

async def main():
    print()
    print("╔" + "═" * (W - 2) + "╗")
    print("║" + "  Enjin Token Lookup — Step-by-Step Educational Script".center(W - 2) + "║")
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

    network        = NETWORKS[choice]
    is_matrixchain = (choice == "1")

    print()
    address = input(f"Enter {network['name']} wallet address: ").strip()
    if not address:
        print("No address entered.  Exiting.")
        sys.exit(1)

    try:
        pub = ss58_decode_silent(address)
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

    # ── Matrixchain: ask scan mode before connecting ───────────────────────────
    specific_cids = []
    scan_mode     = "A"
    if is_matrixchain:
        print()
        print("  This is the Enjin Matrixchain.  The MultiTokens pallet holds NFTs and")
        print("  semi-fungible tokens (SFTs) across many collections.")
        print()
        print("  How would you like to scan?")
        print("  A) Enumerate ALL collections on-chain  (may be slow for large chains)")
        print("  B) Enter specific collection ID(s)     (faster, targeted)")
        print()
        while True:
            scan_mode = input("  Scan mode [A/B]: ").strip().upper()
            if scan_mode in ("A", "B"):
                break
            print("  Please enter A or B.")

        if scan_mode == "B":
            print()
            cid_input = input("  Collection ID(s), comma-separated: ").strip()
            try:
                specific_cids = [int(x.strip()) for x in cid_input.split(",")
                                 if x.strip()]
                if not specific_cids:
                    raise ValueError("No valid IDs entered.")
                if any(c < 0 or c > (2 ** 128 - 1) for c in specific_cids):
                    raise ValueError("Collection IDs must be in the range 0 to 2^128−1.")
            except ValueError as e:
                print(f"\n  Invalid input: {e}")
                sys.exit(1)
            print(f"  Will scan collection IDs: {specific_cids}")

        include_zero_balance = False
        print()
        print("  Would you also like to track tokens with zero balance?")
        print("  This covers two cases:")
        print("    1. TokenAccount entry exists on-chain with balance = 0")
        print("       (rare; occurs when reserved/locked balance keeps the entry alive)")
        print("    2. Wallet is the collection OWNER and a token has no account entry")
        print("       at all — the typical result of minting a token to yourself and")
        print("       then fully transferring it to another wallet (entry is deleted).")
        while True:
            inc = input("  Include 0-balance / transferred-away tokens? [y/N]: ").strip().lower()
            if inc in ("y", "yes"):
                include_zero_balance = True
                break
            elif inc in ("n", "no", ""):
                break
            print("  Please enter y or n.")

    # ── RPC verbosity: ask before connecting ──────────────────────────────────
    verbose_rpc = False
    print()
    print("  Show all RPC calls on the terminal?")
    print("  Y) Yes — print every → SENDING / ← RECEIVED pair  (may be very verbose)")
    print("  N) No  — show only the first call of each type     (default)")
    while True:
        vrpc = input("  Show all RPC calls? [y/N]: ").strip().lower()
        if vrpc in ("y", "yes"):
            verbose_rpc = True
            break
        elif vrpc in ("n", "no", ""):
            break
        print("  Please enter y or n.")

    print()
    print(f"  Network  : {network['name']}")
    print(f"  Address  : {address}")
    print(f"  Endpoint : {network['endpoint']}")

    req_id = [1]
    def next_id():
        i = req_id[0]; req_id[0] += 1; return i

    banner("STEP 2 — Open WebSocket & Get Current Block Hash")
    step(f"Connecting to: {network['endpoint']}")

    try:
        async with websockets.connect(network["endpoint"], ssl=_SSL_CTX) as ws:
            step("Connection established!")

            step("Fetching current finalized head block hash…")
            note("We pin all storage queries to this single block hash so every")
            note("balance figure is consistent at the same point in time.")

            header    = await rpc_call(ws, next_id(), "chain_getHeader", [])
            head_blk  = int(header["number"], 16)
            head_hash = await rpc_call(ws, next_id(), "chain_getBlockHash", [head_blk])
            step(f"Head block : #{head_blk:,}  ({header['number']})")
            step(f"Head hash  : {head_hash}")

            # ══════════════════════════════════════════════════════════════════
            #  MATRIXCHAIN — NFT / semi-fungible token flow
            # ══════════════════════════════════════════════════════════════════
            if is_matrixchain:

                # ── Step 1: Collect collection IDs to scan ────────────────────
                if scan_mode == "A":
                    coll_prefix = build_collections_prefix()

                    banner("STEP 3 — Enumerate All Collections via state_getKeysPaged")
                    step("Paginating MultiTokens.Collections keys…")
                    note(f"  Prefix    : {coll_prefix}")
                    note(f"  Page size : {KEYS_PAGE_SIZE}")
                    note(f"  ({'All pages shown in full.' if verbose_rpc else 'Full RPC detail shown for first page only.'})")

                    scan_cids = []
                    start_key = None
                    page      = 0
                    while True:
                        page += 1
                        params = [coll_prefix, KEYS_PAGE_SIZE]
                        if start_key:
                            params.append(start_key)
                        # state_getKeysPaged has no block-hash parameter; omit head_hash.
                        keys = await rpc_call(ws, next_id(), "state_getKeysPaged",
                                              params, silent=(page > 1 and not verbose_rpc))
                        if not isinstance(keys, list) or not keys:
                            break
                        for k in keys:
                            cid = collection_id_from_key(k)
                            if cid is not None:
                                scan_cids.append(cid)
                        step(f"Page {page}: {len(keys)} key(s) returned.")
                        if len(keys) < KEYS_PAGE_SIZE:
                            break
                        start_key = keys[-1]

                    scan_cids.sort()
                    note(f"  Total collections found: {len(scan_cids)}")
                    note(f"  IDs: {scan_cids[:20]}{'…' if len(scan_cids) > 20 else ''}")
                else:
                    scan_cids = specific_cids

                if not scan_cids:
                    print("\n  No collections to scan.  Exiting.")
                    sys.exit(0)

                # ── Step 2: Enumerate tokens per collection, check account ─────
                banner("STEP 4 — Enumerate Tokens & Check Account Balance per Collection")

                step("Strategy:")
                note("  MultiTokens.TokenAccounts is indexed (collectionId, tokenId, account).")
                note("  Since account is the THIRD dimension we cannot prefix-scan by account.")
                note("  Instead we:")
                note("    1. Enumerate all tokenIds in the collection via Tokens prefix scan")
                note("    2. For each tokenId query TokenAccounts(cid, tid, address)")
                note("")
                note("  Key construction detail is shown for the FIRST token found.")
                note(f"  Subsequent RPC calls {'are all shown in full (verbose mode).' if verbose_rpc else 'are silent to keep output manageable.'}")
                if len(scan_cids) > 5:
                    note(f"  Warning: scanning {len(scan_cids)} collections may take a while.")

                nft_results          = []
                zero_balance_results = []
                first_token_shown    = False
                wallet_pub           = ss58_decode_silent(address)

                for cid_idx, cid in enumerate(scan_cids):
                    show_verbose = (cid_idx == 0)
                    tok_prefix   = build_tokens_prefix_for_collection(cid, verbose=show_verbose)

                    if not show_verbose:
                        step(f"Collection {cid}: enumerating tokens…")

                    # Check if this wallet is the collection owner so we can track
                    # tokens that were transferred away (no TokenAccount entry at all).
                    wallet_owns_collection = False
                    if include_zero_balance:
                        raw_coll   = await rpc_call(ws, next_id(), "state_getStorage",
                                                    [build_collection_key(cid), head_hash],
                                                    silent=(not verbose_rpc))
                        owner_pub  = collection_owner_pubkey(raw_coll)
                        wallet_owns_collection = (owner_pub is not None and owner_pub == wallet_pub)
                        if wallet_owns_collection:
                            note(f"  Collection {cid}: wallet is the collection owner "
                                 f"— transferred-away tokens will be tracked.")

                    all_tids  = []
                    start_key = None
                    page      = 0
                    while True:
                        page += 1
                        params = [tok_prefix, KEYS_PAGE_SIZE]
                        if start_key:
                            params.append(start_key)
                        # state_getKeysPaged has no block-hash parameter; omit head_hash.
                        keys = await rpc_call(ws, next_id(), "state_getKeysPaged",
                                              params, silent=(not verbose_rpc))
                        if not isinstance(keys, list) or not keys:
                            break
                        for k in keys:
                            tid = token_id_from_tokens_key(k)
                            if tid is not None:
                                all_tids.append(tid)
                        if len(keys) < KEYS_PAGE_SIZE:
                            break
                        start_key = keys[-1]

                    if not all_tids:
                        note(f"  Collection {cid}: no tokens found — skipping.")
                        continue

                    note(f"  Collection {cid}: {len(all_tids)} token(s) found.  Checking account…")

                    for tid in all_tids:
                        show_key = (not first_token_shown)
                        key      = build_token_account_key(cid, tid, address,
                                                           verbose=show_key)
                        raw      = await rpc_call(ws, next_id(), "state_getStorage",
                                                  [key, head_hash], silent=(not show_key and not verbose_rpc))
                        if show_key:
                            first_token_shown = True

                        if raw is None or raw == "0x":
                            # The runtime deletes the TokenAccount entry when balance
                            # drops to 0 and no reserved/locked amount keeps it alive.
                            # We can still surface it if the wallet owns the collection.
                            if include_zero_balance and wallet_owns_collection:
                                zero_balance_results.append({
                                    "collection_id":  cid,
                                    "token_id":       tid,
                                    "balance":        0,
                                    "account_exists": False,   # entry deleted
                                })
                                if not show_key:
                                    note(f"  ○ collection={cid}  token={tid}  "
                                         f"balance=0  (no account entry — transferred away)")
                            continue

                        balance = decode_compact_first(raw, verbose=show_key)
                        if balance > 0:
                            nft_results.append({
                                "collection_id": cid,
                                "token_id":      tid,
                                "balance":       balance,
                            })
                            if not show_key:
                                note(f"  ✓ collection={cid}  token={tid}  balance={balance:,}")
                        elif include_zero_balance:
                            zero_balance_results.append({
                                "collection_id":  cid,
                                "token_id":       tid,
                                "balance":        0,
                                "account_exists": True,    # entry present, balance is 0
                            })
                            if not show_key:
                                note(f"  ○ collection={cid}  token={tid}  "
                                     f"balance=0  (account entry exists, reserved/locked)")

                print_nft_summary(network["name"], address, head_blk, nft_results,
                                  zero_balance_tokens=zero_balance_results)

            # ══════════════════════════════════════════════════════════════════
            #  RELAYCHAIN — sENJ nomination-pool shares flow
            # ══════════════════════════════════════════════════════════════════
            else:
                bonded_prefix = build_bonded_pools_prefix()

                banner("STEP 3 — Enumerate All Nomination Pool IDs via state_getKeysPaged")

                step("What is state_getKeysPaged?")
                note("The chain may have dozens or hundreds of pools.")
                note("state_getKeysPaged lets us walk the storage map page-by-page without")
                note("knowing the pool IDs ahead of time.")
                note("")
                note("Parameters:")
                note("  param 0: prefix     — only return keys that START with this prefix")
                note("  param 1: page_size  — max keys per response")
                note("  param 2: start_key  — last key from previous page (for pagination only)")
                note("")
                note("Note: state_getKeysPaged does NOT accept a block hash parameter.")
                note("It always reflects the latest state (or an implementation-specific")
                note("default). Use state_getStorage with a block hash to pin balance reads.")
                note("")
                note("The node returns up to page_size storage keys.")
                note("If the response has fewer than page_size entries we are on the last page.")

                all_pool_ids = []
                start_key    = None
                page         = 0

                while True:
                    page += 1
                    params = [bonded_prefix, KEYS_PAGE_SIZE]
                    if start_key:
                        params.append(start_key)
                    # NOTE: do NOT append head_hash here — state_getKeysPaged has no
                    # block-hash parameter.  Block pinning applies to state_getStorage only.

                    step(f"Fetching pool keys page {page} (up to {KEYS_PAGE_SIZE} per page)…")
                    keys = await rpc_call(ws, next_id(), "state_getKeysPaged", params)

                    if not isinstance(keys, list) or not keys:
                        note("  No (more) keys returned — enumeration complete.")
                        break

                    step(f"Received {len(keys)} key(s).  Extracting pool IDs from each key:")
                    note("")
                    note("  Key layout: [twox128 pallet (16B)] [twox128 item (16B)]")
                    note("              [twox64 hash of pool_id (8B)] [pool_id u32 LE (4B)]")
                    note("  Twox64Concat = xxh64(value_bytes, seed=0) ++ value_bytes")
                    note("  The last 4 bytes of every key ARE the pool_id in LE byte order.")
                    note("")

                    for i, k in enumerate(keys[:5]):
                        pid = pool_id_from_key(k)
                        try:
                            raw_key = bytes.fromhex(k[2:] if k.startswith("0x") else k)
                        except ValueError:
                            note(f"  key[{i}]: (malformed hex — skipping display)")
                            continue
                        note(f"  key[{i}]: {k[:20]}…{k[-8:]}")
                        if i == 0:
                            note(f"     [0-15]  pallet hash  : {raw_key[0:16].hex()}")
                            note(f"     [16-31] item hash    : {raw_key[16:32].hex()}")
                            note(f"     [32-39] twox64 hash  : {raw_key[32:40].hex()}")
                            note(f"     [40-43] pool_id LE   : {raw_key[40:44].hex()}  →  pool_id = {pid}")
                        else:
                            note(f"     pool_id bytes[40-43] : {raw_key[40:44].hex()}  →  pool_id = {pid}")

                    if len(keys) > 5:
                        note(f"  … ({len(keys) - 5} more keys, pool IDs extracted silently)")

                    for k in keys:
                        pid = pool_id_from_key(k)
                        if pid is not None and pid not in all_pool_ids:
                            all_pool_ids.append(pid)

                    if len(keys) < KEYS_PAGE_SIZE:
                        break
                    start_key = keys[-1]

                all_pool_ids.sort()
                step(f"Total pools discovered: {len(all_pool_ids)}")
                note(f"  Pool IDs: {all_pool_ids[:30]}{'…' if len(all_pool_ids) > 30 else ''}")

                banner("STEP 4 — Check sENJ Balance in Each Pool (MultiTokens.TokenAccounts)")

                step("What are sENJ tokens?")
                note("When you join a nomination pool on Enjin, the pool mints 'sENJ' shares")
                note("to represent your proportional ownership.  These are stored in the")
                note("MultiTokens pallet under collectionId=1, tokenId=<pool_id>.")
                note("")
                note("Checking all pools and filtering for non-zero balances…")
                note("(Key construction shown in full for the first pool only.)")

                pool_results = []

                for pool_idx, pool_id in enumerate(all_pool_ids):
                    show_verbose = (pool_idx == 0)
                    key = build_token_account_key(COLLECTION_ID, pool_id, address,
                                                  verbose=show_verbose)

                    step(f"Querying balance in pool #{pool_id} — state_getStorage…")
                    raw = await rpc_call(ws, next_id(), "state_getStorage",
                                        [key, head_hash])

                    if raw is None or raw == "0x":
                        note(f"  Result: null/0x → no sENJ balance in pool #{pool_id}  (skipping)")
                        pool_results.append({"id": pool_id, "balance": 0, "supply": 0})
                        continue

                    balance = decode_compact_first(raw, verbose=show_verbose)
                    note(f"  Balance in pool #{pool_id}: {planck_fmt(balance)}")

                    if balance > 0:
                        banner(f"STEP 5 — Fetch Total Pool Supply (MultiTokens.Tokens) for Pool #{pool_id}")

                        step("Purpose: to compute your share percentage we need the total sENJ supply.")
                        note("  share % = your_balance / total_supply × 100")
                        note("")
                        note("  MultiTokens.Tokens(collectionId, tokenId) stores the aggregate token info.")
                        note("  The total supply is the first compact-encoded value in the struct.")

                        tokens_key = build_tokens_key(COLLECTION_ID, pool_id)
                        step(f"MultiTokens.Tokens key (collection={COLLECTION_ID}, tokenId={pool_id}):")
                        note(f"  twox128('MultiTokens') ++ twox128('Tokens') ++ B128C(cid) ++ B128C(tid)")
                        note(f"  {tokens_key[:20]}…{tokens_key[-16:]}")

                        raw_supply = await rpc_call(ws, next_id(), "state_getStorage",
                                                    [tokens_key, head_hash])

                        if raw_supply and raw_supply != "0x":
                            supply = decode_compact_first(raw_supply, verbose=True)
                            pct    = balance / supply * 100 if supply > 0 else 0.0
                            step("Share computation:")
                            note(f"  your balance : {planck_fmt(balance)}")
                            note(f"  total supply : {planck_fmt(supply)}")
                            note(f"  share        : {balance} / {supply} × 100 = {pct:.6f}%")
                        else:
                            supply = 0
                            step("Total supply: not found (null/0x)")

                        pool_results.append({"id": pool_id, "balance": balance, "supply": supply})
                    else:
                        pool_results.append({"id": pool_id, "balance": 0, "supply": 0})

                print_summary(network["name"], address, head_blk, pool_results)

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
