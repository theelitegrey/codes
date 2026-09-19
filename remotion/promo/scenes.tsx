import React from "react";
import type { Brand } from "./brand.js";
import { Card, Counter, Eyebrow, Kinetic, Mark, clamp01, easeOut, easeInOut, prog } from "./ui.js";

type SceneProps = { brand: Brand; t: number; start: number; end: number; w: number; h: number };

/** ---------- shared chart primitives (hand-drawn, no external data) ---------- */
type C = [number, number, number, number];

function series(seed: number, n: number, shape: "chaos" | "sweep" | "trend"): C[] {
  let a = seed >>> 0;
  const rnd = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5);
  const out: C[] = [];
  let p = 100;
  const key = Math.floor(n * 0.62);
  for (let i = 0; i < n; i++) {
    const o = p;
    let c = p;
    if (shape === "chaos") c = o + rnd() * 3.2;
    else if (shape === "trend") c = o + 0.5 + rnd() * 1.1;
    else {
      if (i < key * 0.5) c = o + 0.75 + rnd() * 0.8;
      else if (i < key) c = o + rnd() * 0.9;
      else if (i === key) c = o - 0.6;
      else c = o - (1.05 + Math.abs(rnd()) * 0.9);
    }
    const hi = Math.max(o, c) + Math.abs(rnd()) * 0.8 + (shape === "sweep" && i === key ? 2.6 : 0);
    const lo = Math.min(o, c) - Math.abs(rnd()) * 0.8;
    out.push([o, hi, lo, c]);
    p = c;
  }
  return out;
}

const Candles: React.FC<{ brand: Brand; data: C[]; w: number; h: number; reveal: number; pad?: number }> = ({ brand, data, w, h, reveal, pad = 26 }) => {
  const n = data.length;
  const vals = data.flatMap((c) => [c[1], c[2]]);
  const min = Math.min(...vals) - 1;
  const max = Math.max(...vals) + 1;
  const x = (i: number) => pad + ((i + 0.5) / n) * (w - pad * 2);
  const y = (v: number) => pad + (h - pad * 2) * (1 - (v - min) / (max - min));
  const cw = Math.max(3, ((w - pad * 2) / n) * 0.6);
  const shown = Math.max(1, Math.ceil(n * clamp01(reveal)));
  return (
    <>
      {data.slice(0, shown).map((c, i) => {
        const up = c[3] >= c[0];
        const col = up ? brand.colors.up : brand.colors.down;
        return (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={y(c[1])} y2={y(c[2])} stroke={col} strokeWidth={2} />
            <rect x={x(i) - cw / 2} y={Math.min(y(c[0]), y(c[3]))} width={cw} height={Math.max(2, Math.abs(y(c[0]) - y(c[3])))} fill={col} rx={2} />
          </g>
        );
      })}
    </>
  );
};

/** ---------- 1. HOOK: two failed challenges, then a pass ---------- */
export const HookScene: React.FC<SceneProps> = ({ brand, t, start, w, h }) => {
  const cards = [
    { label: "CHALLENGE 01", state: "FAILED", color: brand.colors.down, at: start + 0.5 },
    { label: "CHALLENGE 02", state: "FAILED", color: brand.colors.down, at: start + 0.9 },
    { label: "CHALLENGE 03", state: "PASSED", color: brand.colors.up, at: start + 1.5 },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, padding: "118px 56px 208px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <Eyebrow brand={brand} text="Prop firm reality" at={start + 0.15} t={t} />
      <div style={{ marginTop: 26 }}>
        <Kinetic brand={brand} text="I FAILED TWICE." at={start + 0.35} t={t} size={104} />
        <div style={{ height: 8 }} />
        <Kinetic brand={brand} text="THEN I PASSED." at={start + 1.35} t={t} size={104} accentWords={["PASSED."]} />
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 44 }}>
        {cards.map((c, i) => {
          const p = easeOut(prog(t, c.at, c.at + 0.4));
          const stamp = easeOut(prog(t, c.at + 0.2, c.at + 0.55));
          return (
            <div key={i} style={{ flex: 1, background: brand.colors.panel, border: `1px solid ${c.color}55`, borderRadius: 16, padding: "16px 14px", opacity: p, transform: `translateY(${(1 - p) * 28}px)` }}>
              <div style={{ fontFamily: brand.mono, fontSize: 15, letterSpacing: 2, color: brand.colors.muted }}>{c.label}</div>
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: 5, background: c.color, boxShadow: `0 0 12px ${c.color}` }} />
                <span style={{ fontFamily: brand.font, fontWeight: 900, fontSize: 30, color: c.color, letterSpacing: 1, transform: `scale(${0.8 + 0.2 * stamp})`, display: "inline-block" }}>{c.state}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** ---------- 2. PROBLEM: no process — random setups, scattered entries ---------- */
export const ProblemScene: React.FC<SceneProps> = ({ brand, t, start, w, h }) => {
  const reveal = prog(t, start + 0.2, start + 2.4);
  const data = series(7, 46, "chaos");
  const cw = w - 112;
  const ch = 400;
  const tags = ["BREAKOUT?", "REVERSAL?", "NEWS PLAY?", "SCALP?", "REVENGE"];
  return (
    <div style={{ position: "absolute", inset: 0, padding: "118px 56px 208px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <Eyebrow brand={brand} text="The real problem" at={start + 0.1} t={t} />
      <div style={{ marginTop: 22 }}>
        <Kinetic brand={brand} text="NO PROCESS." at={start + 0.3} t={t} size={96} accentWords={["NO"]} />
      </div>
      <div style={{ position: "relative", marginTop: 30, width: cw, height: ch, background: brand.colors.bgElevated, border: `1px solid ${brand.colors.line}`, borderRadius: 20, overflow: "hidden" }}>
        <svg width={cw} height={ch}>
          <Candles brand={brand} data={data} w={cw} h={ch} reveal={reveal} />
          {[0.18, 0.34, 0.52, 0.68, 0.84].map((f, i) => {
            const at = start + 0.9 + i * 0.28;
            const p = easeOut(prog(t, at, at + 0.3));
            if (p <= 0) return null;
            const cx = 40 + f * (cw - 80);
            const cy = 90 + ((i * 97) % 220);
            return (
              <g key={i} opacity={p}>
                <line x1={cx - 16} y1={cy - 16} x2={cx + 16} y2={cy + 16} stroke={brand.colors.down} strokeWidth={5} strokeLinecap="round" />
                <line x1={cx + 16} y1={cy - 16} x2={cx - 16} y2={cy + 16} stroke={brand.colors.down} strokeWidth={5} strokeLinecap="round" />
              </g>
            );
          })}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexWrap: "wrap", alignContent: "flex-start", gap: 10, padding: 18 }}>
          {tags.map((tag, i) => {
            const at = start + 1.1 + i * 0.3;
            const p = easeOut(prog(t, at, at + 0.25));
            const wob = Math.sin((t - at) * 7) * 2;
            return (
              <span key={i} style={{ opacity: p, transform: `translateY(${(1 - p) * 14}px) rotate(${wob}deg)`, fontFamily: brand.mono, fontSize: 19, letterSpacing: 1, color: brand.colors.down, border: `1px solid ${brand.colors.down}66`, borderRadius: 8, padding: "5px 11px", background: "#00000066" }}>
                {tag}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/** ---------- 3. SOLUTION: the Academy module grid ---------- */
export const SolutionScene: React.FC<SceneProps> = ({ brand, t, start, w, h }) => {
  const modules = ["01 · MARKET STRUCTURE", "02 · LIQUIDITY", "03 · FAIR VALUE GAPS", "04 · SETUP CHECKLIST", "05 · RISK MODEL", "06 · TRADE JOURNAL"];
  return (
    <div style={{ position: "absolute", inset: 0, padding: "118px 56px 208px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <Eyebrow brand={brand} text="Stryker Academy" at={start + 0.1} t={t} />
      <div style={{ marginTop: 22 }}>
        <Kinetic brand={brand} text="A REPEATABLE PROCESS" at={start + 0.3} t={t} size={78} accentWords={["REPEATABLE"]} />
      </div>
      {/* UI chrome */}
      <div style={{ marginTop: 28, background: brand.colors.bgElevated, border: `1px solid ${brand.colors.line}`, borderRadius: 20, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: `1px solid ${brand.colors.line}`, background: brand.colors.panel }}>
          <Mark brand={brand} size={20} />
          <span style={{ fontFamily: brand.font, fontWeight: 800, fontSize: 16, letterSpacing: 3, color: brand.colors.fg }}>CURRICULUM</span>
          <span style={{ marginLeft: "auto", fontFamily: brand.mono, fontSize: 14, color: brand.colors.muted }}>MODULE 6 OF 6</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: 16 }}>
          {modules.map((m, i) => {
            const at = start + 0.9 + i * 0.16;
            const done = prog(t, at + 0.35, at + 0.9);
            return (
              <Card key={i} brand={brand} at={at} t={t} index={0} active={done > 0.5} style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${done > 0.5 ? brand.colors.accent : brand.colors.line}`, display: "flex", alignItems: "center", justifyContent: "center", background: done > 0.5 ? brand.colors.accent : "transparent" }}>
                    {done > 0.5 && (
                      <svg width={13} height={13} viewBox="0 0 12 12">
                        <path d="M2 6.5 L5 9.5 L10 3" fill="none" stroke="#04070C" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={14} strokeDashoffset={14 * (1 - easeOut(done))} />
                      </svg>
                    )}
                  </div>
                  <span style={{ fontFamily: brand.mono, fontSize: 17, letterSpacing: 0.6, color: brand.colors.fg }}>{m}</span>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/** ---------- 4. FEATURES: the five things, as spoken ---------- */
export const FeaturesScene: React.FC<SceneProps> = ({ brand, t, start, end, w, h }) => {
  const items = [
    { k: "MARKET STRUCTURE", d: "Highs, lows, shifts", at: 15.82 },
    { k: "LIQUIDITY + FVG", d: "Where price is drawn", at: 16.78 },
    { k: "SETUP CHECKLIST", d: "Take it or skip it", at: 18.58 },
    { k: "RISK RULES", d: "Fixed % per trade", at: 19.74 },
    { k: "TRADE JOURNAL", d: "Scores every execution", at: 20.86 },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, padding: "118px 56px 208px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <Eyebrow brand={brand} text="What's inside" at={start + 0.1} t={t} />
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
        {items.map((it, i) => {
          const active = t >= it.at - 0.1 && t < (items[i + 1]?.at ?? end);
          const p = easeOut(prog(t, it.at - 0.25, it.at + 0.25));
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, background: active ? `linear-gradient(90deg, ${brand.colors.accent}26, ${brand.colors.panel} 60%)` : brand.colors.panel, border: `1px solid ${active ? brand.colors.accent : brand.colors.line}`, borderRadius: 16, padding: "16px 18px", opacity: p, transform: `translateX(${(1 - p) * -30}px) scale(${active ? 1.02 : 1})`, boxShadow: active ? `0 0 36px ${brand.colors.accent}30` : "none" }}>
              <span style={{ fontFamily: brand.mono, fontSize: 16, color: active ? brand.colors.accent : brand.colors.muted, width: 34 }}>{String(i + 1).padStart(2, "0")}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: brand.font, fontWeight: 900, fontSize: 34, letterSpacing: 0.5, color: brand.colors.fg }}>{it.k}</div>
                <div style={{ fontFamily: brand.font, fontWeight: 500, fontSize: 19, color: brand.colors.muted, marginTop: 2 }}>{it.d}</div>
              </div>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: active ? brand.colors.accent : brand.colors.line, boxShadow: active ? `0 0 14px ${brand.colors.accent}` : "none" }} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** ---------- 5. HOW: liquidity marked, sweep, entry, journal row ---------- */
export const HowScene: React.FC<SceneProps> = ({ brand, t, start, w, h }) => {
  const cw = w - 112;
  const ch = 430;
  const data = series(21, 44, "sweep");
  const key = Math.floor(44 * 0.62);
  const vals = data.flatMap((c) => [c[1], c[2]]);
  const min = Math.min(...vals) - 1;
  const max = Math.max(...vals) + 1;
  const pad = 26;
  const X = (i: number) => pad + ((i + 0.5) / 44) * (cw - pad * 2);
  const Y = (v: number) => pad + (ch - pad * 2) * (1 - (v - min) / (max - min));
  const level = Math.max(...data.slice(0, key).map((c) => c[1]));
  const markP = easeOut(prog(t, 25.4, 26.1));   // "marked liquidity"
  const sweepP = easeOut(prog(t, 26.9, 27.5));  // "sweep"
  const entryP = easeOut(prog(t, 27.8, 28.5));  // "took only my setup"
  const logP = easeOut(prog(t, 28.9, 29.6));    // "logged it"
  return (
    <div style={{ position: "absolute", inset: 0, padding: "118px 56px 208px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <Eyebrow brand={brand} text="How he traded it" at={start + 0.1} t={t} />
      <div style={{ position: "relative", marginTop: 20, width: cw, height: ch, background: brand.colors.bgElevated, border: `1px solid ${brand.colors.line}`, borderRadius: 20, overflow: "hidden" }}>
        <svg width={cw} height={ch}>
          <Candles brand={brand} data={data} w={cw} h={ch} reveal={prog(t, start, start + 1.6)} />
          {markP > 0 && (
            <g opacity={markP}>
              <line x1={pad} x2={pad + (cw - pad * 2) * markP} y1={Y(level)} y2={Y(level)} stroke={brand.colors.warn} strokeWidth={3} strokeDasharray="12 8" />
              <rect x={cw - 170} y={Y(level) - 17} width={150} height={34} rx={8} fill={brand.colors.warn} />
              <text x={cw - 95} y={Y(level) + 7} textAnchor="middle" fontFamily={brand.font} fontWeight={900} fontSize={17} fill="#06080C">LIQUIDITY</text>
            </g>
          )}
          {sweepP > 0 && (
            <g opacity={sweepP}>
              <circle cx={X(key)} cy={Y(data[key][1])} r={16 + 44 * (1 - sweepP)} fill="none" stroke={brand.colors.down} strokeWidth={3} opacity={1 - sweepP} />
              <circle cx={X(key)} cy={Y(data[key][1])} r={14} fill="none" stroke={brand.colors.down} strokeWidth={3} />
              <rect x={X(key) - 52} y={Y(data[key][1]) - 62} width={104} height={32} rx={8} fill={brand.colors.down} />
              <text x={X(key)} y={Y(data[key][1]) - 40} textAnchor="middle" fontFamily={brand.font} fontWeight={900} fontSize={17} fill="#fff">SWEEP</text>
            </g>
          )}
          {entryP > 0 && (
            <g opacity={entryP}>
              <rect x={X(key + 2)} y={Y(level)} width={(cw - pad - X(key + 2)) * entryP} height={Math.max(2, Y(min + 2) - Y(level))} fill={brand.colors.up} opacity={0.14} />
              <line x1={X(key + 2)} x2={cw - pad} y1={Y(data[key + 2][3])} y2={Y(data[key + 2][3])} stroke={brand.colors.accent} strokeWidth={3} />
              <text x={X(key + 2) + 10} y={Y(data[key + 2][3]) - 10} fontFamily={brand.mono} fontWeight={800} fontSize={17} fill={brand.colors.accent}>ENTRY</text>
            </g>
          )}
        </svg>
      </div>
      {/* journal row */}
      <div style={{ marginTop: 16, opacity: logP, transform: `translateY(${(1 - logP) * 18}px)`, background: brand.colors.panel, border: `1px solid ${brand.colors.line}`, borderRadius: 16, padding: "14px 18px", display: "flex", alignItems: "center", gap: 18 }}>
        <span style={{ fontFamily: brand.mono, fontSize: 16, color: brand.colors.muted }}>JOURNAL</span>
        <span style={{ fontFamily: brand.font, fontWeight: 800, fontSize: 22, color: brand.colors.fg }}>Sweep → reclaim</span>
        <span style={{ marginLeft: "auto", fontFamily: brand.mono, fontSize: 17, color: brand.colors.muted }}>RULES MET</span>
        <span style={{ fontFamily: brand.mono, fontWeight: 800, fontSize: 26, color: brand.colors.up }}>{Math.round(5 * logP)}/5</span>
      </div>
    </div>
  );
};

/** ---------- 6. CHALLENGE: progress to target, drawdown held ---------- */
export const ChallengeScene: React.FC<SceneProps> = ({ brand, t, start, w, h }) => {
  const p = easeInOut(prog(t, start + 0.3, start + 3.6));
  const rows = [
    { k: "PROFIT TARGET", v: `${Math.round(100 * p)}%`, col: brand.colors.up },
    { k: "MAX DRAWDOWN", v: "HELD", col: brand.colors.accent },
    { k: "RISK / TRADE", v: "FIXED", col: brand.colors.fg },
    { k: "REVENGE TRADES", v: "0", col: brand.colors.fg },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, padding: "118px 56px 208px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <Eyebrow brand={brand} text="The challenge" at={start + 0.1} t={t} />
      <div style={{ marginTop: 22 }}>
        <Kinetic brand={brand} text="SAME PROCESS." at={start + 0.3} t={t} size={88} accentWords={["SAME"]} />
      </div>
      <div style={{ marginTop: 30, background: brand.colors.bgElevated, border: `1px solid ${brand.colors.line}`, borderRadius: 20, padding: 22 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{ fontFamily: brand.font, fontWeight: 800, fontSize: 20, letterSpacing: 3, color: brand.colors.muted }}>CHALLENGE PROGRESS</span>
          <Counter brand={brand} to={100} at={start + 0.3} t={t} suffix="%" size={48} color={brand.colors.up} />
        </div>
        <div style={{ marginTop: 14, height: 22, borderRadius: 11, background: brand.colors.line, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${p * 100}%`, background: `linear-gradient(90deg, ${brand.colors.accent}, ${brand.colors.up})`, boxShadow: `0 0 26px ${brand.colors.up}99` }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 20 }}>
          {rows.map((r, i) => (
            <Card key={i} brand={brand} at={start + 0.8} t={t} index={i} style={{ padding: "12px 14px" }}>
              <div style={{ fontFamily: brand.mono, fontSize: 14, letterSpacing: 1.5, color: brand.colors.muted }}>{r.k}</div>
              <div style={{ fontFamily: brand.font, fontWeight: 900, fontSize: 28, color: r.col, marginTop: 4 }}>{r.v}</div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

/** ---------- 7. RESULTS: passed stamp + payout ---------- */
export const ResultsScene: React.FC<SceneProps> = ({ brand, t, start, w, h }) => {
  const stamp = easeOut(prog(t, 35.0, 35.5));
  const pay = easeOut(prog(t, 36.3, 36.9));
  const flash = 1 - clamp01((t - 35.0) / 0.35);
  return (
    <div style={{ position: "absolute", inset: 0, padding: "118px 56px 208px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      {flash > 0 && <div style={{ position: "absolute", inset: 0, background: brand.colors.fg, opacity: flash * 0.5 }} />}
      <div style={{ transform: `scale(${0.85 + 0.15 * stamp}) rotate(${(1 - stamp) * -6}deg)`, opacity: stamp, border: `6px solid ${brand.colors.up}`, borderRadius: 20, padding: "22px 26px", display: "inline-block", boxShadow: `0 0 60px ${brand.colors.up}55` }}>
        <span style={{ fontFamily: brand.font, fontWeight: 900, fontSize: 86, letterSpacing: -1, color: brand.colors.up, lineHeight: 1 }}>PASSED THE<br />CHALLENGE</span>
      </div>
      <div style={{ marginTop: 34, opacity: pay, transform: `translateY(${(1 - pay) * 26}px)`, background: brand.colors.panel, border: `1px solid ${brand.colors.accent}`, borderRadius: 20, padding: "20px 24px", display: "flex", alignItems: "center", gap: 18, boxShadow: `0 0 50px ${brand.colors.accent}33` }}>
        <Mark brand={brand} size={40} />
        <div>
          <div style={{ fontFamily: brand.mono, fontSize: 15, letterSpacing: 2.5, color: brand.colors.muted }}>PAYOUT STATUS</div>
          <div style={{ fontFamily: brand.font, fontWeight: 900, fontSize: 44, color: brand.colors.fg, lineHeight: 1.05 }}>CLEARED</div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontFamily: brand.mono, fontSize: 15, letterSpacing: 2, color: brand.colors.muted }}>FUNDED</div>
          <div style={{ fontFamily: brand.mono, fontWeight: 800, fontSize: 30, color: brand.colors.up }}>ACTIVE</div>
        </div>
      </div>
    </div>
  );
};

/** ---------- 8. CTA: brand lockup ---------- */
export const CtaScene: React.FC<SceneProps> = ({ brand, t, start, end, w, h }) => {
  const p = easeOut(prog(t, start + 0.1, start + 0.7));
  const line = easeOut(prog(t, start + 0.5, start + 1.2));
  const words = brand.tagline.replace(/\.$/, "").split(". ");
  const out = easeOut(prog(t, end - 1.1, end - 0.25));
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingBottom: 208 }}>
      <div style={{ transform: `scale(${0.9 + 0.1 * p}) translateY(${(1 - p) * 20}px)`, opacity: p, display: "flex", alignItems: "center", gap: 18 }}>
        <Mark brand={brand} size={92} />
        <div style={{ lineHeight: 1 }}>
          <div style={{ fontFamily: brand.font, fontWeight: 900, fontSize: 82, letterSpacing: 6, color: brand.colors.fg }}>{brand.name}</div>
          <div style={{ fontFamily: brand.font, fontWeight: 700, fontSize: 22, letterSpacing: 11, color: brand.colors.accent, marginTop: 8 }}>{brand.sub}</div>
        </div>
      </div>
      <div style={{ width: 520 * line, height: 3, background: `linear-gradient(90deg, transparent, ${brand.colors.accent}, transparent)`, marginTop: 28 }} />
      <div style={{ display: "flex", gap: 26, marginTop: 26 }}>
        {words.map((wd, i) => {
          const wp = easeOut(prog(t, start + 0.8 + i * 0.22, start + 1.15 + i * 0.22));
          return (
            <span key={i} style={{ fontFamily: brand.font, fontWeight: 800, fontSize: 36, letterSpacing: 2, color: brand.colors.fg, opacity: wp, transform: `translateY(${(1 - wp) * 16}px)` }}>
              {wd.toUpperCase()}
            </span>
          );
        })}
      </div>
      <div style={{ marginTop: 34, fontFamily: brand.mono, fontSize: 26, letterSpacing: 3, color: brand.colors.accent, opacity: easeOut(prog(t, start + 1.6, start + 2.1)) }}>{brand.url}</div>
      {/* final branded sweep */}
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(105deg, transparent 40%, ${brand.colors.accent}22 50%, transparent 60%)`, transform: `translateX(${(out - 0.5) * 2400}px)`, opacity: out > 0 && out < 1 ? 1 : 0 }} />
    </div>
  );
};

export const SCENES: Record<string, React.FC<SceneProps>> = {
  hook: HookScene,
  problem: ProblemScene,
  solution: SolutionScene,
  features: FeaturesScene,
  how: HowScene,
  challenge: ChallengeScene,
  results: ResultsScene,
  cta: CtaScene,
};
