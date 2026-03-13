/**
 * Enjin Staking Reward Tracker — UI Prototype
 *
 * This file is a reference prototype accompanying the PRD:
 *   enjin_reward_tracker_PRD_v3.1.md
 *
 * It demonstrates the following design decisions:
 *   - Collapsible era rows with per-pool detail cards
 *   - Stake Factor gauge with progress bar and delta
 *   - Three-tab chart: Cumulative / Per-Era Gain / Stake Factor
 *   - Chart ↔ table hover and click sync
 *   - Per-pool summary cards with transparent SF breakdown
 *   - Formula strip explaining the computation
 *   - Step-by-step fetch log for transparency
 *
 * PRD features NOT implemented here (see PRD for full spec):
 *   - Entry mode selection screen (Wallet vs File Import)
 *   - Date / era range selector with presets
 *   - era_stat API call for authoritative block ranges
 *   - Export (JSON / CSV / XML)
 *   - AES-GCM encryption and password input
 *   - File import + decrypt + re-render
 *
 * Implementors are free to deviate from any visual or structural
 * decision shown here. This prototype is illustrative, not prescriptive.
 *
 * Dependencies (available in the target React environment):
 *   recharts — AreaChart, BarChart, LineChart and supporting components
 *   react    — useState, useCallback, useRef
 */

import { useState, useCallback, useRef } from "react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";

// ─── Constants ────────────────────────────────────────────────────────────────

const ENJIN_API  = "https://enjin.api.subscan.io";
const MATRIX_API = "https://matrix.api.subscan.io";
const PLANCKS    = 1e18;

// Distinct colors assigned per pool_id (pool_id % length)
const POOL_COLORS = [
  "#38bdf8","#f59e0b","#4ade80","#a78bfa",
  "#f87171","#34d399","#fb923c","#60a5fa"
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a raw Plancks string or decimal string to ENJ float */
const toENJ = v => {
  if (v == null) return 0;
  const s = String(v).replace(/,/g, "");
  if (s.includes(".")) return parseFloat(s) || 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n / PLANCKS;
};

/** Format a number with fixed decimal places */
const fmt = (n, d = 4) =>
  typeof n === "number"
    ? n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })
    : "—";

/** Format Stake Factor with 10 decimal places */
const fmtSF = n => (typeof n === "number" ? n.toFixed(10) : "—");

/** POST to a Subscan API endpoint */
const apiPost = async (base, path, body, key) => {
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": key },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${path}`);
  const j = await r.json();
  if (j.code !== 0) throw new Error(`API(${j.code}): ${j.message}`);
  return j.data;
};

/** Paginate a Subscan endpoint until all records are retrieved */
const fetchAll = async (base, path, extra, key, row = 100) => {
  let page = 0, out = [];
  while (true) {
    const d = await apiPost(base, path, { ...extra, page, row }, key);
    const b = d?.list ?? [];
    out = [...out, ...b];
    if (b.length < row) break;
    page++;
  }
  return out;
};

/**
 * Binary search a sorted [{t, b}] timeline for the balance active at timestamp t.
 * Returns 0 if t is before the first event (wallet not yet a member).
 */
const balAt = (tl, t) => {
  if (!tl.length || t < tl[0].t) return 0;
  let lo = 0, hi = tl.length - 1;
  while (lo < hi) {
    const m = Math.ceil((lo + hi) / 2);
    tl[m].t <= t ? (lo = m) : (hi = m - 1);
  }
  return tl[lo].b;
};

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Stake Factor Gauge
 * Shows the SF value, a delta badge, and a progress bar.
 * The bar maps SF 1.0–1.5 to 0–100%.
 * Implementors may choose a different visual — a numeric display
 * or sparkline is equally valid.
 */
const SFGauge = ({ sf, prevSf, color = "#38bdf8" }) => {
  const pct = Math.min(((sf - 1) / 0.5) * 100, 100);
  const delta = sf - (prevSf || sf);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontFamily: "'Courier New',monospace", fontSize: 13, color, fontWeight: 700 }}>
          {fmtSF(sf)}
        </span>
        {delta !== 0 && (
          <span style={{ fontSize: 10, color: delta > 0 ? "#4ade80" : "#f87171", fontFamily: "monospace" }}>
            {delta > 0 ? "+" : ""}{delta.toFixed(8)}
          </span>
        )}
      </div>
      <div style={{ height: 4, background: "#0d1f30", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`, borderRadius: 2,
          background: `linear-gradient(90deg,#1e3a5f,${color})`,
          transition: "width 0.6s ease"
        }} />
      </div>
    </div>
  );
};

/** Colored pill label for a pool ID */
const PoolBadge = ({ id }) => (
  <span style={{
    background: `${POOL_COLORS[id % POOL_COLORS.length]}22`,
    border: `1px solid ${POOL_COLORS[id % POOL_COLORS.length]}55`,
    color: POOL_COLORS[id % POOL_COLORS.length],
    borderRadius: 4, fontSize: 10, fontWeight: 700,
    padding: "1px 6px", letterSpacing: "0.05em", fontFamily: "monospace"
  }}>
    Pool #{id}
  </span>
);

/**
 * Collapsible era table row.
 *
 * Collapsed: shows all summary columns inline.
 * Expanded: reveals a Stake Factor detail panel + per-pool breakdown cards.
 *
 * Design reference only — implementors may use accordions, modals,
 * side panels, or any other pattern for the expanded detail.
 */
const EraRow = ({ row, isOpen, onToggle, highlighted, onHover }) => (
  <>
    <tr
      onClick={onToggle}
      onMouseEnter={onHover}
      style={{
        borderBottom: isOpen ? "none" : "1px solid #0c1520",
        cursor: "pointer",
        background: highlighted ? "#0a1e30" : isOpen ? "#0d1f33" : "transparent",
        transition: "background 0.15s"
      }}
    >
      {/* Expand indicator */}
      <td style={{ padding: "9px 8px 9px 14px", width: 24 }}>
        <div style={{
          width: 16, height: 16, borderRadius: 3,
          background: "#0d1f30", border: "1px solid #1e3a5f",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#38bdf8", fontSize: 10, transition: "transform 0.2s",
          transform: isOpen ? "rotate(90deg)" : "rotate(0deg)"
        }}>▶</div>
      </td>
      <td style={{ padding: "9px 10px", color: "#7dd3fc", fontFamily: "monospace", fontSize: 12, whiteSpace: "nowrap" }}>
        {row.date}
      </td>
      <td style={{ padding: "9px 10px", color: "#94a3b8", fontFamily: "monospace", fontSize: 12 }}>
        {row.era}
      </td>
      <td style={{ padding: "9px 10px", color: "#334155", fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap" }}>
        {row.start_block?.toLocaleString()}–{row.end_block?.toLocaleString()}
      </td>
      <td style={{ padding: "9px 10px", minWidth: 160 }}>
        <SFGauge sf={row.stake_factor_after} prevSf={row.stake_factor_before} color={POOL_COLORS[0]} />
      </td>
      <td style={{ padding: "9px 10px", color: "#64748b", fontFamily: "monospace", fontSize: 11 }}>
        +{row.delta_sf?.toFixed(10)}
      </td>
      <td style={{ padding: "9px 10px", color: "#a78bfa", fontFamily: "monospace", fontSize: 12 }}>
        {fmt(row.active_senj, 4)}
      </td>
      <td style={{ padding: "9px 10px", color: "#4ade80", fontFamily: "monospace", fontSize: 13, fontWeight: 700 }}>
        +{fmt(row.per_era_gain, 6)}
      </td>
      <td style={{ padding: "9px 10px", color: "#f59e0b", fontFamily: "monospace", fontSize: 13, fontWeight: 700 }}>
        {fmt(row.total_enj_equiv, 4)}
      </td>
      <td style={{ padding: "9px 10px", color: "#e2e8f0", fontFamily: "monospace", fontSize: 12 }}>
        {fmt(row.cumulative, 6)}
      </td>
    </tr>

    {/* Expanded detail */}
    {isOpen && (
      <tr style={{ background: "#070e18", borderBottom: "1px solid #1e3a5f" }}>
        <td colSpan={10} style={{ padding: "0 14px 14px 46px" }}>

          {/* Stake Factor detail panel */}
          <div style={{
            background: "#0a1628", border: "1px solid #1d4ed855", borderRadius: 8,
            padding: "10px 16px", marginBottom: 12, marginTop: 10,
            display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16
          }}>
            {[
              ["Stake Factor Before", fmtSF(row.stake_factor_before), "#64748b"],
              ["Stake Factor After",  fmtSF(row.stake_factor_after),  "#38bdf8"],
              ["ΔStake Factor",       `+${row.delta_sf?.toFixed(10)}`, "#4ade80"],
              ["Interpretation",      `Every 1 sENJ = ${fmtSF(row.stake_factor_after)} ENJ`, "#94a3b8"],
            ].map(([l, v, c]) => (
              <div key={l}>
                <div style={{ fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{l}</div>
                <div style={{ fontSize: 11, color: c, fontFamily: "monospace", wordBreak: "break-all" }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Per-pool breakdown cards */}
          {row.pools?.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                Pool Breakdown — {row.pools.length} active pool{row.pools.length > 1 ? "s" : ""}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 8 }}>
                {row.pools.map(p => (
                  <div key={p.pool_id} style={{
                    background: "#0c1828",
                    border: `1px solid ${POOL_COLORS[p.pool_id % POOL_COLORS.length]}33`,
                    borderRadius: 8, padding: "12px 14px"
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <PoolBadge id={p.pool_id} />
                      <span style={{ fontSize: 10, color: "#334155", fontFamily: "monospace" }}>
                        {(p.pct * 100)?.toFixed(1)}% of total gain
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      {[
                        ["sENJ Balance (era)", fmt(p.active_senj, 6),          "#a78bfa"],
                        ["Pool SF After",      fmtSF(p.sf_after),               POOL_COLORS[p.pool_id % POOL_COLORS.length]],
                        ["Pool Bonded ENJ",    fmt(p.bonded_after, 4),          "#94a3b8"],
                        ["Pool ΔSF",           `+${p.delta_sf?.toFixed(10)}`,   "#4ade80"],
                        ["Era Gain (ENJ)",     `+${fmt(p.gain, 6)}`,            "#4ade80"],
                        ["ENJ Equiv.",         fmt(p.equiv, 6),                 "#f59e0b"],
                      ].map(([l, v, c]) => (
                        <div key={l}>
                          <div style={{ fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{l}</div>
                          <div style={{ fontSize: 11, color: c, fontFamily: "monospace", wordBreak: "break-all" }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </td>
      </tr>
    )}
  </>
);

/** Chart tooltip showing era detail on hover */
const ChartTooltip = ({ active, payload, label, chartData }) => {
  if (!active || !payload?.length) return null;
  const row = chartData?.find(d => d.date === label);
  return (
    <div style={{
      background: "#080f18", border: "1px solid #1e3a5f", borderRadius: 10,
      padding: "12px 16px", fontFamily: "monospace", fontSize: 11, minWidth: 220,
      boxShadow: "0 8px 32px #000a"
    }}>
      <div style={{ color: "#7dd3fc", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{label}</div>
      {row && (
        <>
          <div style={{ color: "#334155", marginBottom: 6, fontSize: 10 }}>
            Era {row.era} · Blocks {row.start_block?.toLocaleString()}–{row.end_block?.toLocaleString()}
          </div>
          <div style={{ borderTop: "1px solid #1e3a5f", paddingTop: 8, marginBottom: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
              {[
                ["SF After",  fmtSF(row.stake_factor_after),       "#38bdf8"],
                ["ΔSF",       `+${row.delta_sf?.toFixed(8)}`,       "#4ade80"],
                ["sENJ",      fmt(row.active_senj, 4),              "#a78bfa"],
                ["Era Gain",  `+${fmt(row.per_era_gain, 6)} ENJ`,   "#4ade80"],
              ].map(([l, v, c]) => (
                <div key={l}>
                  <span style={{ color: "#334155" }}>{l}: </span>
                  <span style={{ color: c }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
          {row.pools?.length > 1 && (
            <div style={{ borderTop: "1px solid #1e3a5f", paddingTop: 8 }}>
              {row.pools.map(p => (
                <div key={p.pool_id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ color: POOL_COLORS[p.pool_id % POOL_COLORS.length] }}>Pool #{p.pool_id}</span>
                  <span style={{ color: "#f59e0b" }}>+{fmt(p.gain, 6)}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ borderTop: "1px solid #1e3a5f", paddingTop: 8, marginTop: 4 }}>
            <span style={{ color: "#64748b" }}>Total ENJ Equiv: </span>
            <span style={{ color: "#f59e0b", fontWeight: 700 }}>{fmt(row.total_enj_equiv, 6)}</span>
          </div>
        </>
      )}
    </div>
  );
};

/** Scrollable fetch log displayed during computation */
const Log = ({ entries }) => (
  <div style={{
    background: "#080f18", border: "1px solid #1e3a5f", borderRadius: 10,
    padding: "12px 16px", maxHeight: 180, overflowY: "auto",
    fontFamily: "monospace", fontSize: 11, lineHeight: 1.8
  }}>
    {entries.map((e, i) => (
      <div key={i} style={{
        display: "flex", gap: 8,
        color: e.s === "err" ? "#f87171" : e.s === "ok" ? "#4ade80" : "#475569"
      }}>
        <span style={{ flexShrink: 0, color: e.s === "err" ? "#f87171" : e.s === "ok" ? "#4ade80" : "#1e6fbf" }}>
          {e.s === "err" ? "✗" : e.s === "ok" ? "✓" : "›"}
        </span>
        {e.msg}
      </div>
    ))}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function EnjinTracker() {
  const [wallet,       setWallet]       = useState("");
  const [apiKey,       setApiKey]       = useState("");
  const [loading,      setLoading]      = useState(false);
  const [log,          setLog]          = useState([]);
  const [tableData,    setTableData]    = useState([]);
  const [poolSummaries,setPoolSummaries]= useState([]);
  const [err,          setErr]          = useState(null);
  const [chartTab,     setChartTab]     = useState("cumulative");
  const [openRows,     setOpenRows]     = useState(new Set());
  const [highlightedDate, setHighlightedDate] = useState(null);
  const tableRef = useRef(null);

  const push = useCallback((msg, s = "info") => setLog(p => [...p, { msg, s }]), []);

  const toggleRow = (date) => {
    setOpenRows(prev => {
      const n = new Set(prev);
      n.has(date) ? n.delete(date) : n.add(date);
      return n;
    });
    setHighlightedDate(date);
  };

  // ── Main computation ───────────────────────────────────────────────────────
  const run = async () => {
    if (!wallet.trim() || !apiKey.trim()) { setErr("Enter wallet address and API key."); return; }
    setLoading(true); setErr(null); setLog([]); setTableData([]); setPoolSummaries([]); setOpenRows(new Set());

    try {
      // Step A1 — All pools
      push("Step A1 — Fetching all nomination pools…");
      const allPools = await fetchAll(ENJIN_API, "/api/scan/nomination_pool/pools", {}, apiKey);
      push(`Found ${allPools.length} nomination pools`);

      // Step A2 — Which pools does this wallet have sENJ in?
      push("Step A2 — Scanning wallet sENJ balances…");
      const walletPools = [];
      for (const pool of allPools) {
        try {
          const d = await apiPost(MATRIX_API, "/api/scan/enjin/multitoken/holder_balance",
            { collection_id: "1", token_id: String(pool.pool_id), account: wallet.trim() }, apiKey);
          const bal = toENJ(d?.balance ?? d?.free ?? "0");
          if (bal > 0) walletPools.push({ ...pool, currentSENJ: bal });
        } catch { /* not a member of this pool */ }
      }
      if (!walletPools.length) throw new Error("No sENJ balance found for this wallet.");
      push(`Member of ${walletPools.length} pool(s): ${walletPools.map(p => `#${p.pool_id}`).join(", ")}`);

      // Steps A3–A8 per pool
      // NOTE: Step A3 (era_stat for authoritative block ranges) is not called in this
      // prototype. Block ranges are approximated. The full implementation must call
      // era_stat per the PRD to populate exact era numbers and block ranges.
      const poolData = [];
      for (const pool of walletPools) {
        const color = POOL_COLORS[pool.pool_id % POOL_COLORS.length];

        // Step A5 — Pool info (SF anchor)
        push(`Pool #${pool.pool_id} — Step A5: Fetching pool info…`);
        const info = await apiPost(ENJIN_API, "/api/scan/nomination_pool/pool", { pool_id: pool.pool_id }, apiKey);
        const curBonded = toENJ(info?.bonded_total ?? info?.total_bonded ?? info?.bonded ?? "0");
        const totalSENJ = toENJ(info?.points ?? info?.total_points ?? "0");
        const currentSF = totalSENJ > 0 ? curBonded / totalSENJ : 1;
        push(`  Bonded=${fmt(curBonded, 2)} ENJ · sENJ supply=${fmt(totalSENJ, 2)} · Current SF=${currentSF.toFixed(10)}`);

        // Step A4 — Pool stash reward history
        push(`Pool #${pool.pool_id} — Step A4: Fetching reward history…`);
        const rewards = await fetchAll(ENJIN_API, "/api/scan/account/reward_slash",
          { address: pool.stash, is_stash: true, category: "Reward" }, apiKey);
        rewards.sort((a, b) => a.block_num - b.block_num);
        push(`  ${rewards.length} reward events found`);
        if (!rewards.length) continue;

        // Step A5b — Reconstruct SF per era backwards from current
        const amounts = rewards.map(r => toENJ(r.amount));
        const totalAfter = new Array(rewards.length).fill(0);
        for (let i = rewards.length - 2; i >= 0; i--)
          totalAfter[i] = totalAfter[i + 1] + amounts[i + 1];

        const eraRecords = rewards.map((r, i) => {
          const bondedAfter  = curBonded - totalAfter[i];
          const bondedBefore = bondedAfter - amounts[i];
          return {
            timestamp:    r.block_timestamp,
            block_num:    r.block_num,
            sfAfter:      totalSENJ > 0 ? bondedAfter  / totalSENJ : 1,
            sfBefore:     totalSENJ > 0 ? bondedBefore / totalSENJ : 1,
            deltaSF:      totalSENJ > 0 ? amounts[i]   / totalSENJ : 0,
            bondedAfter,  bondedBefore,
            eraReward:    amounts[i]
          };
        });

        // Step A6 — Wallet sENJ activity history
        push(`Pool #${pool.pool_id} — Step A6: Fetching wallet sENJ activity…`);
        const acts = await fetchAll(MATRIX_API, "/api/scan/enjin/multitoken/activities",
          { collection_id: "1", token_id: String(pool.pool_id), account: wallet.trim() }, apiKey);
        acts.sort((a, b) => a.block_timestamp - b.block_timestamp);
        push(`  ${acts.length} sENJ activity event(s) found`);

        // Step A7 — Build balance timeline
        let bal = 0;
        const timeline = [];
        for (const a of acts) {
          const amt  = toENJ(a.amount ?? "0");
          const recv = (a.type ?? "").toLowerCase() === "mint" || a.to === wallet.trim();
          bal = Math.max(0, recv ? bal + amt : bal - amt);
          timeline.push({ t: a.block_timestamp, b: bal });
        }
        if (!timeline.length) {
          push(`  ⚠ No activity found — using current balance as constant approximation`);
          timeline.push({ t: 0, b: pool.currentSENJ });
        }

        poolData.push({ pool_id: pool.pool_id, currentSENJ: pool.currentSENJ, currentSF, curBonded, totalSENJ, color, eraRecords, timeline, stash: pool.stash, totalGain: 0 });
      }

      if (!poolData.length) throw new Error("No reward data found.");

      // Steps A8 + A9 — Compute per-era gain and aggregate by date
      const dayMap = {};
      for (const pd of poolData) {
        for (const era of pd.eraRecords) {
          const activeSENJ = balAt(pd.timeline, era.timestamp);
          if (activeSENJ <= 0) continue;
          const gain  = activeSENJ * era.deltaSF;
          const equiv = activeSENJ * era.sfAfter;
          pd.totalGain += gain;

          const d   = new Date(era.timestamp * 1000);
          const key = d.toISOString().slice(0, 10);
          const lbl = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

          if (!dayMap[key]) dayMap[key] = {
            date: lbl, dateKey: key, ts: era.timestamp * 1000,
            era: null, start_block: null, end_block: null,
            active_senj: 0, per_era_gain: 0, total_enj_equiv: 0,
            stake_factor_before: era.sfBefore, stake_factor_after: era.sfAfter, delta_sf: era.deltaSF,
            _maxBonded: 0, pools: []
          };

          const day = dayMap[key];
          day.active_senj     += activeSENJ;
          day.per_era_gain    += gain;
          day.total_enj_equiv += equiv;

          if (era.bondedAfter > day._maxBonded) {
            day._maxBonded          = era.bondedAfter;
            day.stake_factor_before = era.sfBefore;
            day.stake_factor_after  = era.sfAfter;
            day.delta_sf            = era.deltaSF;
          }

          day.pools.push({
            pool_id: pd.pool_id, active_senj: activeSENJ,
            sf_after: era.sfAfter, sf_before: era.sfBefore, delta_sf: era.deltaSF,
            bonded_after: era.bondedAfter, gain, equiv, color: pd.color, pct: 0
          });
        }
      }

      const sorted = Object.values(dayMap).sort((a, b) => a.ts - b.ts);
      let cumul = 0;
      sorted.forEach((d, i) => {
        cumul += d.per_era_gain;
        d.cumulative = cumul;
        d.era        = d.era || i + 1;           // approximate — use era_stat in production
        d.start_block = i * 14400;               // approximate — use era_stat in production
        d.end_block   = (i + 1) * 14400 - 1;    // approximate — use era_stat in production
        if (d.per_era_gain > 0) d.pools.forEach(p => p.pct = p.gain / d.per_era_gain);
      });

      setTableData(sorted);
      setPoolSummaries(poolData.map(pd => ({
        pool_id: pd.pool_id, color: pd.color,
        currentSENJ: pd.currentSENJ, currentSF: pd.currentSF,
        currentEquiv: pd.currentSENJ * pd.currentSF,
        totalGain: pd.totalGain, stash: pd.stash,
        totalSENJ: pd.totalSENJ, curBonded: pd.curBonded
      })));
      push("Computation complete.", "ok");

    } catch (e) { setErr(e.message); push(e.message, "err"); }
    finally { setLoading(false); }
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  const totalEquiv = poolSummaries.reduce((s, p) => s + p.currentEquiv, 0);
  const totalGain  = poolSummaries.reduce((s, p) => s + p.totalGain, 0);
  const allPoolIds = [...new Set(tableData.flatMap(d => d.pools.map(p => p.pool_id)))];
  const sfChartData = tableData.map(d => ({
    date: d.date,
    ...Object.fromEntries(d.pools.map(p => [`pool_${p.pool_id}`, p.sf_after]))
  }));

  // ── Style helpers ──────────────────────────────────────────────────────────
  const card = {
    background: "linear-gradient(135deg,#0c1420,#0e1a2e)",
    border: "1px solid #1a3050", borderRadius: 14, padding: "20px 24px"
  };
  const inp = {
    background: "#060c16", border: "1px solid #1a3050", borderRadius: 8,
    color: "#cbd5e1", fontSize: 13, fontFamily: "'Courier New',monospace",
    padding: "10px 14px", width: "100%", outline: "none", boxSizing: "border-box"
  };
  const tabBtn = (active, color = "#0ea5e9") => ({
    background: active ? `${color}22` : "transparent",
    border: `1px solid ${active ? color : "#1a3050"}`,
    borderRadius: 6, color: active ? color : "#475569",
    cursor: "pointer", fontSize: 11, fontWeight: 700,
    padding: "5px 14px", letterSpacing: "0.04em", transition: "all .2s", whiteSpace: "nowrap"
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: "#040911", minHeight: "100vh", color: "#e2e8f0", fontFamily: "'Trebuchet MS',system-ui,sans-serif", padding: "24px 18px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <div style={{ width: 42, height: 42, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg,#0ea5e9,#6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>⬡</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, letterSpacing: "-0.02em", background: "linear-gradient(90deg,#e2e8f0,#7dd3fc)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Enjin Staking Reward Tracker
            </h1>
            <p style={{ margin: 0, fontSize: 11, color: "#334155", letterSpacing: "0.04em" }}>
              TRANCHE-ACCURATE · PER-ERA ENJ EQUIVALENT GROWTH · NOMINATION POOL MEMBERS
            </p>
          </div>
        </div>

        {/* Formula strip */}
        <div style={{ background: "#070e1a", border: "1px solid #1d4ed840", borderRadius: 10, padding: "10px 18px", marginBottom: 20, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", fontSize: 12, fontFamily: "'Courier New',monospace" }}>
          {[
            ["ENJ Equiv =","#1e3a5f"], ["sENJ(era)","#a78bfa"], ["×","#1e3a5f"],
            ["Stake Factor(era)","#38bdf8"], ["│","#0f1a2a"], ["Stake Factor =","#1e3a5f"],
            ["Pool Bonded ENJ","#f59e0b"], ["÷","#1e3a5f"], ["Total sENJ Supply","#4ade80"],
            ["│","#0f1a2a"], ["ΔSF per era =","#1e3a5f"], ["Era Reward","#f59e0b"],
            ["÷","#1e3a5f"], ["Total sENJ Supply","#4ade80"]
          ].map(([t, c], i) => <span key={i} style={{ color: c }}>{t}</span>)}
        </div>

        {/* Inputs */}
        <div style={{ ...card, marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, alignItems: "end" }}>
            <div>
              <label style={{ display: "block", fontSize: 10, color: "#334155", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.1em" }}>Relaychain Wallet Address</label>
              <input style={inp} placeholder="en1abc…xyz" value={wallet} onChange={e => setWallet(e.target.value)} disabled={loading} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 10, color: "#334155", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.1em" }}>Subscan API Key</label>
              <input style={inp} type="password" placeholder="X-API-Key" value={apiKey} onChange={e => setApiKey(e.target.value)} disabled={loading} />
            </div>
            <button onClick={run} disabled={loading} style={{ background: loading ? "#1a3050" : "linear-gradient(90deg,#0ea5e9,#6366f1)", border: "none", borderRadius: 9, color: loading ? "#475569" : "#fff", cursor: loading ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 800, padding: "11px 28px", letterSpacing: "0.04em", whiteSpace: "nowrap", boxShadow: loading ? "none" : "0 0 24px #0ea5e940" }}>
              {loading ? "Computing…" : "Compute"}
            </button>
          </div>
          {err && <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: "#1c0a0a", border: "1px solid #7f1d1d", color: "#f87171", fontSize: 11, fontFamily: "monospace" }}>✗ {err}</div>}
        </div>

        {log.length > 0 && <div style={{ marginBottom: 20 }}><Log entries={log} /></div>}

        {/* Pool summary cards */}
        {poolSummaries.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 12 }}>
              {[
                ["Total ENJ Equivalent", fmt(totalEquiv, 4), "ENJ (all pools)", "#f59e0b"],
                ["Total Tracked Gain", `+${fmt(totalGain, 6)}`, "ENJ earned", "#4ade80"],
                ["Eras Tracked", tableData.length, "eras (days)", "#38bdf8"],
              ].map(([l, v, u, c]) => (
                <div key={l} style={{ ...card, textAlign: "center", padding: "16px" }}>
                  <div style={{ fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>{l}</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: c, fontFamily: "'Courier New',monospace" }}>{v}</div>
                  <div style={{ fontSize: 10, color: "#334155", marginTop: 2 }}>{u}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(poolSummaries.length, 4)},1fr)`, gap: 10 }}>
              {poolSummaries.map(p => (
                <div key={p.pool_id} style={{ background: "#0c1828", border: `1px solid ${p.color}33`, borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <PoolBadge id={p.pool_id} />
                    <span style={{ fontSize: 9, color: "#334155", fontFamily: "monospace" }}>{p.stash?.slice(0, 8)}…</span>
                  </div>
                  <div style={{ background: "#07111e", borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
                    <div style={{ fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Current Stake Factor</div>
                    <SFGauge sf={p.currentSF} color={p.color} />
                    <div style={{ marginTop: 6, fontSize: 9, color: "#334155" }}>1 sENJ = <span style={{ color: p.color, fontFamily: "monospace" }}>{fmtSF(p.currentSF)}</span> ENJ</div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[
                      ["sENJ Balance", fmt(p.currentSENJ, 4), "#a78bfa"],
                      ["ENJ Equiv.",   fmt(p.currentEquiv, 4), "#f59e0b"],
                      ["Pool Bonded",  fmt(p.curBonded, 2), "#94a3b8"],
                      ["sENJ Supply",  fmt(p.totalSENJ, 2), "#94a3b8"],
                    ].map(([l, v, c]) => (
                      <div key={l}>
                        <div style={{ fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{l}</div>
                        <div style={{ fontSize: 11, color: c, fontFamily: "monospace" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chart */}
        {tableData.length > 0 && (
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>ENJ Equivalent Over Time</div>
                <div style={{ fontSize: 10, color: "#334155", marginTop: 2 }}>Hover or click any point for detailed era breakdown</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[["cumulative","Cumulative","#0ea5e9"],["per_era","Per-Era Gain","#f59e0b"],["sf","Stake Factor","#38bdf8"]].map(([v, l, c]) => (
                  <button key={v} style={tabBtn(chartTab === v, c)} onClick={() => setChartTab(v)}>{l}</button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              {chartTab === "cumulative" ? (
                <AreaChart data={tableData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}
                  onMouseMove={e => e?.activeLabel && setHighlightedDate(e.activeLabel)}
                  onClick={e => e?.activeLabel && toggleRow(e.activeLabel)}>
                  <defs>
                    <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#0ea5e9" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a3050" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "#334155", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "#334155", fontSize: 10, fontFamily: "monospace" }} tickLine={false} axisLine={false} tickFormatter={v => v.toFixed(1)} />
                  <Tooltip content={<ChartTooltip chartData={tableData} />} />
                  <Area type="monotone" dataKey="total_enj_equiv" name="ENJ Equiv." stroke="#0ea5e9" strokeWidth={2} fill="url(#cg)" />
                </AreaChart>
              ) : chartTab === "per_era" ? (
                <BarChart data={tableData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}
                  onMouseMove={e => e?.activeLabel && setHighlightedDate(e.activeLabel)}
                  onClick={e => e?.activeLabel && toggleRow(e.activeLabel)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a3050" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "#334155", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "#334155", fontSize: 10, fontFamily: "monospace" }} tickLine={false} axisLine={false} tickFormatter={v => v.toFixed(4)} />
                  <Tooltip content={<ChartTooltip chartData={tableData} />} />
                  {allPoolIds.length > 1
                    ? allPoolIds.map(id => (
                        <Bar key={id} dataKey={d => d.pools.find(p => p.pool_id === id)?.gain || 0}
                          name={`Pool #${id}`} stackId="a" fill={POOL_COLORS[id % POOL_COLORS.length]} opacity={0.85} radius={[2, 2, 0, 0]} />
                      ))
                    : <Bar dataKey="per_era_gain" name="Per-Era Gain" fill="#f59e0b" opacity={0.85} radius={[3, 3, 0, 0]} />
                  }
                  {allPoolIds.length > 1 && <Legend />}
                </BarChart>
              ) : (
                <LineChart data={sfChartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}
                  onMouseMove={e => e?.activeLabel && setHighlightedDate(e.activeLabel)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a3050" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "#334155", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "#334155", fontSize: 10, fontFamily: "monospace" }} tickLine={false} axisLine={false} tickFormatter={v => v.toFixed(6)} domain={["auto", "auto"]} />
                  <Tooltip formatter={(v, name) => [fmtSF(v), name]} contentStyle={{ background: "#080f18", border: "1px solid #1e3a5f", borderRadius: 8, fontFamily: "monospace", fontSize: 11 }} />
                  {allPoolIds.map(id => (
                    <Line key={id} type="monotone" dataKey={`pool_${id}`} name={`Pool #${id} SF`} stroke={POOL_COLORS[id % POOL_COLORS.length]} strokeWidth={2} dot={false} />
                  ))}
                  {allPoolIds.length > 1 && <Legend />}
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        )}

        {/* Collapsible table */}
        {tableData.length > 0 && (
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid #1a3050", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>Era-by-Era Breakdown</div>
                <div style={{ fontSize: 10, color: "#334155", marginTop: 2 }}>Click any row to expand pool details · Click again to collapse</div>
              </div>
              <div style={{ fontSize: 10, color: "#1e3a5f", fontFamily: "monospace" }}>{tableData.length} eras · {openRows.size} expanded</div>
            </div>
            <div style={{ overflowX: "auto" }} ref={tableRef}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1a3050" }}>
                    <th style={{ width: 24 }} />
                    {[["Date","#7dd3fc"],["Era","#94a3b8"],["Block Range","#334155"],["Stake Factor ▸","#38bdf8"],["ΔStake Factor","#4ade80"],["Active sENJ","#a78bfa"],["Per-Era Gain","#4ade80"],["ENJ Equiv.","#f59e0b"],["Cumulative","#e2e8f0"]].map(([h, c]) => (
                      <th key={h} style={{ textAlign: "left", padding: "10px 10px", color: c, fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...tableData].reverse().map(row => (
                    <EraRow
                      key={row.dateKey}
                      row={row}
                      isOpen={openRows.has(row.date)}
                      onToggle={() => toggleRow(row.date)}
                      highlighted={highlightedDate === row.date}
                      onHover={() => setHighlightedDate(row.date)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ marginTop: 14, textAlign: "center", fontSize: 10, color: "#0f1f30", lineHeight: 1.8 }}>
          Stake Factor reconstructed backwards from current pool state ·
          sENJ balance per era sourced from on-chain mint/burn activity history ·
          Block ranges approximated in prototype — use era_stat in production
        </div>
      </div>
    </div>
  );
}
