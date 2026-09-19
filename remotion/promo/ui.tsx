import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Brand } from "./brand.js";

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const prog = (t: number, a: number, b: number) => (b <= a ? (t >= b ? 1 : 0) : clamp01((t - a) / (b - a)));
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Spring-in helper driven by absolute seconds. */
export const useSpringAt = (at: number, cfg: { damping?: number; mass?: number } = {}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - Math.round(at * fps), fps, config: { damping: cfg.damping ?? 16, mass: cfg.mass ?? 0.6 } });
};

/** Premium dark stage: vignette, grid, scanline sheen, accent bloom. */
export const Stage: React.FC<{ brand: Brand; t: number; intensity?: number }> = ({ brand, t, intensity = 1 }) => {
  const drift = (t * 8) % 120;
  return (
    <div style={{ position: "absolute", inset: 0, background: brand.colors.bg, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(90% 55% at 50% 12%, ${brand.colors.accent}1F 0%, transparent 60%), radial-gradient(70% 45% at 85% 70%, ${brand.colors.accent2}18 0%, transparent 65%)`, opacity: intensity }} />
      <div style={{ position: "absolute", inset: -120, backgroundImage: `linear-gradient(${brand.colors.line}66 1px, transparent 1px), linear-gradient(90deg, ${brand.colors.line}66 1px, transparent 1px)`, backgroundSize: "120px 120px", transform: `translate(${-drift}px, ${-drift * 0.5}px)`, opacity: 0.5 * intensity, maskImage: "radial-gradient(75% 60% at 50% 40%, black 0%, transparent 85%)", WebkitMaskImage: "radial-gradient(75% 60% at 50% 40%, black 0%, transparent 85%)" }} />
      <div style={{ position: "absolute", inset: 0, boxShadow: `inset 0 0 300px 80px ${brand.colors.bg}` }} />
    </div>
  );
};

/** Corner brand frame + progress rail. */
export const BrandFrame: React.FC<{ brand: Brand; t: number; duration: number }> = ({ brand, t, duration }) => {
  const p = clamp01(t / duration);
  return (
    <>
      <div style={{ position: "absolute", top: 54, left: 48, display: "flex", alignItems: "center", gap: 12 }}>
        <Mark brand={brand} size={34} />
        <div style={{ lineHeight: 1 }}>
          <div style={{ fontFamily: brand.font, fontWeight: 900, fontSize: 26, letterSpacing: 4, color: brand.colors.fg }}>{brand.name}</div>
          <div style={{ fontFamily: brand.font, fontWeight: 600, fontSize: 11, letterSpacing: 5, color: brand.colors.muted, marginTop: 3 }}>{brand.sub}</div>
        </div>
      </div>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: `${brand.colors.line}` }}>
        <div style={{ height: "100%", width: `${p * 100}%`, background: `linear-gradient(90deg, ${brand.colors.accent}, ${brand.colors.accent2})`, boxShadow: `0 0 18px ${brand.colors.accent}` }} />
      </div>
    </>
  );
};

/** Angular Stryker-style mark: a hard forward chevron stack. */
export const Mark: React.FC<{ brand: Brand; size?: number }> = ({ brand, size = 40 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" style={{ display: "block" }}>
    <defs>
      <linearGradient id="mk" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={brand.colors.accent} />
        <stop offset="100%" stopColor={brand.colors.accent2} />
      </linearGradient>
    </defs>
    <path d="M4 30 L16 6 L24 6 L12 30 Z" fill="url(#mk)" />
    <path d="M18 30 L30 6 L38 6 L26 30 Z" fill="url(#mk)" opacity={0.55} />
  </svg>
);

/** Eyebrow label with a leading accent bar. */
export const Eyebrow: React.FC<{ brand: Brand; text: string; at: number; t: number }> = ({ brand, text, at, t }) => {
  const p = easeOut(prog(t, at, at + 0.35));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, opacity: p, transform: `translateX(${(1 - p) * -24}px)` }}>
      <div style={{ width: 28, height: 4, background: brand.colors.accent, boxShadow: `0 0 14px ${brand.colors.accent}` }} />
      <div style={{ fontFamily: brand.font, fontWeight: 800, fontSize: 20, letterSpacing: 5, color: brand.colors.accent, textTransform: "uppercase" }}>{text}</div>
    </div>
  );
};

/** Big kinetic headline: words rise and settle, accent words glow. */
export const Kinetic: React.FC<{ brand: Brand; text: string; at: number; t: number; size?: number; accentWords?: string[]; align?: "left" | "center" }> = ({ brand, text, at, t, size = 92, accentWords = [], align = "left" }) => {
  const words = text.split(/\s+/);
  const acc = new Set(accentWords.map((w) => w.toUpperCase()));
  return (
    <div style={{ display: "flex", flexWrap: "wrap", columnGap: Math.round(size * 0.26), rowGap: Math.round(size * 0.08), justifyContent: align === "center" ? "center" : "flex-start" }}>
      {words.map((w, i) => {
        const p = easeOut(prog(t, at + i * 0.07, at + i * 0.07 + 0.42));
        const isAcc = acc.has(w.replace(/[^A-Za-z0-9]/g, "").toUpperCase());
        return (
          <span key={i} style={{ display: "inline-block", opacity: p, transform: `translateY(${(1 - p) * 42}px)`, fontFamily: brand.font, fontWeight: 900, fontSize: size, lineHeight: 1.02, letterSpacing: -1.5, color: isAcc ? brand.colors.accent : brand.colors.fg, textShadow: isAcc ? `0 0 34px ${brand.colors.accent}88` : "none" }}>
            {w}
          </span>
        );
      })}
    </div>
  );
};

/** Glass card used for modules, features, journal rows. */
export const Card: React.FC<{ brand: Brand; children: React.ReactNode; at: number; t: number; index?: number; style?: React.CSSProperties; active?: boolean }> = ({ brand, children, at, t, index = 0, style, active }) => {
  const p = easeOut(prog(t, at + index * 0.09, at + index * 0.09 + 0.4));
  return (
    <div
      style={{
        background: active ? `linear-gradient(180deg, ${brand.colors.accent}22, ${brand.colors.panel})` : brand.colors.panel,
        border: `1px solid ${active ? brand.colors.accent : brand.colors.line}`,
        borderRadius: 18,
        padding: "18px 22px",
        opacity: p,
        transform: `translateY(${(1 - p) * 26}px) scale(${0.96 + 0.04 * p})`,
        boxShadow: active ? `0 0 40px ${brand.colors.accent}33` : "0 12px 40px rgba(0,0,0,0.45)",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Animated counter with optional prefix/suffix. */
export const Counter: React.FC<{ brand: Brand; to: number; at: number; t: number; prefix?: string; suffix?: string; decimals?: number; size?: number; color?: string }> = ({ brand, to, at, t, prefix = "", suffix = "", decimals = 0, size = 96, color }) => {
  const p = easeOut(prog(t, at, at + 0.9));
  return (
    <span style={{ fontFamily: brand.mono, fontWeight: 800, fontSize: size, color: color ?? brand.colors.fg, letterSpacing: -2, fontVariantNumeric: "tabular-nums" }}>
      {prefix}
      {(to * p).toFixed(decimals)}
      {suffix}
    </span>
  );
};

export const Divider: React.FC<{ brand: Brand }> = ({ brand }) => <div style={{ height: 1, background: brand.colors.line, width: "100%" }} />;

export const interp = interpolate;
