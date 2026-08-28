"""Backtester for the two edges in STRATEGY.md (ORB trend-follow, VWAP reversion).

Usage:
    python backtest.py data.csv --instrument MES [--edge orb|vwap|both]

Data: 5-minute OHLCV bars in a CSV with columns:
    datetime, open, high, low, close, volume
`datetime` must be US/Eastern (or UTC with --utc); regular trading hours are
filtered internally (09:30-16:00 ET). Sources: Databento, FirstRate Data,
TradingView export, IBKR, etc.

Costs are modeled per side (commission + 1 tick slippage). Results print win
rate, profit factor, expectancy in R, and max drawdown. Past results, real or
simulated, do not guarantee future performance.
"""

import argparse
import sys

import numpy as np
import pandas as pd

SPECS = {  # point value, tick size, round-turn commission per contract ($)
    "MES": dict(point=5.0, tick=0.25, commission=1.24),
    "MNQ": dict(point=2.0, tick=0.25, commission=1.24),
    "ES": dict(point=50.0, tick=0.25, commission=2.50),
    "NQ": dict(point=20.0, tick=0.25, commission=2.50),
}

RISK_PCT = 0.01          # 1% of account per trade
ACCOUNT = 10_000.0       # sizing reference; results are reported in R regardless
MAX_DAILY_LOSS_R = 2.0   # hard daily stop from STRATEGY.md


def load_bars(path: str, utc: bool = False) -> pd.DataFrame:
    df = pd.read_csv(path)
    df.columns = [c.strip().lower() for c in df.columns]
    ts = pd.to_datetime(df["datetime"], utc=utc)
    if utc:
        ts = ts.dt.tz_convert("US/Eastern")
    df.index = ts.dt.tz_localize(None) if ts.dt.tz is not None else ts
    df = df[["open", "high", "low", "close", "volume"]].sort_index()
    df = df.between_time("09:30", "15:55")
    return df


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    prev_close = df["close"].shift()
    tr = pd.concat(
        [df["high"] - df["low"],
         (df["high"] - prev_close).abs(),
         (df["low"] - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False).mean()


def adx_15m(df: pd.DataFrame, n: int = 14) -> pd.Series:
    """ADX(14) on 15-minute resampled bars, forward-filled onto the 5-min index."""
    m = df.resample("15min").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last"}
    ).dropna()
    up = m["high"].diff()
    dn = -m["low"].diff()
    plus_dm = np.where((up > dn) & (up > 0), up, 0.0)
    minus_dm = np.where((dn > up) & (dn > 0), dn, 0.0)
    tr = pd.concat(
        [m["high"] - m["low"],
         (m["high"] - m["close"].shift()).abs(),
         (m["low"] - m["close"].shift()).abs()],
        axis=1,
    ).max(axis=1)
    atr_s = tr.ewm(alpha=1 / n, adjust=False).mean()
    pdi = 100 * pd.Series(plus_dm, index=m.index).ewm(alpha=1 / n, adjust=False).mean() / atr_s
    mdi = 100 * pd.Series(minus_dm, index=m.index).ewm(alpha=1 / n, adjust=False).mean() / atr_s
    dx = 100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan)
    return dx.ewm(alpha=1 / n, adjust=False).mean().reindex(df.index, method="ffill")


def session_vwap(day: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """Anchored VWAP and its running std dev (volume-weighted) for one session."""
    tp = (day["high"] + day["low"] + day["close"]) / 3
    cum_v = day["volume"].cumsum().replace(0, np.nan)
    vwap = (tp * day["volume"]).cumsum() / cum_v
    var = ((tp - vwap) ** 2 * day["volume"]).cumsum() / cum_v
    return vwap, np.sqrt(var)


def daily_ema20(df: pd.DataFrame) -> pd.Series:
    daily_close = df["close"].resample("1D").last().dropna()
    ema = daily_close.ewm(span=20, adjust=False).mean().shift(1)  # yesterday's EMA: no lookahead
    return ema.reindex(df.index.normalize()).set_axis(df.index)


class Tally:
    def __init__(self, name: str):
        self.name = name
        self.r: list[float] = []

    def add(self, r_result: float):
        self.r.append(r_result)

    def report(self) -> str:
        if not self.r:
            return f"{self.name}: no trades"
        r = np.array(self.r)
        wins, losses = r[r > 0], r[r <= 0]
        pf = wins.sum() / -losses.sum() if losses.sum() < 0 else float("inf")
        equity = r.cumsum()
        dd = (equity - np.maximum.accumulate(equity)).min()
        return (
            f"{self.name}: {len(r)} trades | win rate {len(wins) / len(r):.1%} | "
            f"profit factor {pf:.2f} | expectancy {r.mean():+.3f}R | "
            f"total {r.sum():+.1f}R | max drawdown {dd:.1f}R"
        )


def simulate_trade(day: pd.DataFrame, i: int, side: int, stop_pts: float,
                   target_r: float, cost_r: float, be_after_1r: bool) -> float:
    """Walk bars forward from entry at bar i's close; return result in R (after costs)."""
    entry = day["close"].iloc[i]
    stop = entry - side * stop_pts
    target = entry + side * stop_pts * target_r
    realized = 0.0
    half_off = False
    for j in range(i + 1, len(day)):
        bar = day.iloc[j]
        # Conservative: assume the stop is hit first when both levels fall in one bar.
        if (side == 1 and bar["low"] <= stop) or (side == -1 and bar["high"] >= stop):
            r = side * (stop - entry) / stop_pts
            return realized + r * (0.5 if half_off else 1.0) - cost_r
        if not half_off and be_after_1r and (
            (side == 1 and bar["high"] >= entry + side * stop_pts)
            or (side == -1 and bar["low"] <= entry + side * stop_pts)
        ):
            realized += 0.5  # bank half at 1R, stop to breakeven
            stop = entry
            half_off = True
            continue
        if (side == 1 and bar["high"] >= target) or (side == -1 and bar["low"] <= target):
            return realized + target_r * (0.5 if half_off else 1.0) - cost_r
    exit_px = day["close"].iloc[-1]  # 15:55 flat rule
    r = side * (exit_px - entry) / stop_pts
    return realized + r * (0.5 if half_off else 1.0) - cost_r


def run(df: pd.DataFrame, spec: dict, edges: str) -> None:
    df = df.copy()
    df["atr"] = atr(df)
    df["adx"] = adx_15m(df)
    df["ema20d"] = daily_ema20(df)
    orb_tally, vwap_tally = Tally("ORB (Edge A)"), Tally("VWAP reversion (Edge B)")

    for _, day in df.groupby(df.index.normalize()):
        if len(day) < 20:
            continue
        day = day.copy()
        day["vwap"], day["vsd"] = session_vwap(day)
        day_r = 0.0  # running R for the daily loss limit
        or_high = day["high"].iloc[:3].max()  # first 15 min = three 5-min bars
        or_low = day["low"].iloc[:3].min()

        # --- Edge A: one ORB attempt, 9:45-11:30, trend-filtered ---
        if edges in ("orb", "both"):
            for i in range(3, len(day)):
                t = day.index[i].time()
                if t > pd.Timestamp("11:30").time():
                    break
                bar = day.iloc[i]
                if pd.isna(bar["ema20d"]) or pd.isna(bar["atr"]):
                    continue
                long_ok = bar["close"] > or_high and bar["close"] > bar["ema20d"] and bar["close"] > bar["vwap"]
                short_ok = bar["close"] < or_low and bar["close"] < bar["ema20d"] and bar["close"] < bar["vwap"]
                if not (long_ok or short_ok):
                    continue
                side = 1 if long_ok else -1
                range_stop = (bar["close"] - or_low) if side == 1 else (or_high - bar["close"])
                stop_pts = min(range_stop, bar["atr"])
                if stop_pts <= spec["tick"]:
                    continue
                # commission + 1 tick slippage per side, expressed as a fraction of 1R
                cost_r = (spec["commission"] / spec["point"] + 2 * spec["tick"]) / stop_pts
                r = simulate_trade(day, i, side, stop_pts, 2.0, cost_r, be_after_1r=True)
                orb_tally.add(r)
                day_r += r
                break  # one entry per day

        # --- Edge B: up to 3 reversion attempts, rotation days only ---
        if edges in ("vwap", "both"):
            attempts, consec_losses = 0, 0
            for i in range(4, len(day)):
                if day_r <= -MAX_DAILY_LOSS_R or attempts >= 3 or consec_losses >= 2:
                    break
                t = day.index[i].time()
                in_window = (
                    pd.Timestamp("10:00").time() <= t <= pd.Timestamp("11:30").time()
                    or pd.Timestamp("13:30").time() <= t <= pd.Timestamp("15:00").time()
                )
                bar = day.iloc[i]
                if not in_window or pd.isna(bar["adx"]) or bar["adx"] >= 20 or pd.isna(bar["vsd"]):
                    continue
                crossings = (np.sign(day["close"].iloc[:i] - day["vwap"].iloc[:i]).diff() != 0).sum()
                if crossings < 2:
                    continue
                prev = day.iloc[i - 1]
                lo_band = bar["vwap"] - 2 * bar["vsd"]
                hi_band = bar["vwap"] + 2 * bar["vsd"]
                long_sig = prev["low"] <= (prev["vwap"] - 2 * prev["vsd"]) and bar["close"] > lo_band
                short_sig = prev["high"] >= (prev["vwap"] + 2 * prev["vsd"]) and bar["close"] < hi_band
                if not (long_sig or short_sig):
                    continue
                side = 1 if long_sig else -1
                extreme = prev["low"] if side == 1 else prev["high"]
                stop_pts = abs(bar["close"] - extreme) + 1.25 * bar["atr"]
                target_pts = abs(bar["vwap"] - bar["close"])
                if stop_pts <= spec["tick"] or target_pts <= spec["tick"]:
                    continue
                cost_r = (spec["commission"] / spec["point"] + 2 * spec["tick"]) / stop_pts
                r = simulate_trade(day, i, side, stop_pts, target_pts / stop_pts, cost_r, be_after_1r=False)
                vwap_tally.add(r)
                day_r += r
                attempts += 1
                consec_losses = consec_losses + 1 if r < 0 else 0

    print(f"Instrument: point ${spec['point']}, tick {spec['tick']}, "
          f"commission ${spec['commission']}/rt | risk {RISK_PCT:.0%} of ${ACCOUNT:,.0f}")
    if edges in ("orb", "both"):
        print(orb_tally.report())
    if edges in ("vwap", "both"):
        print(vwap_tally.report())
    print("\nReminder: results include modeled costs but not gaps, halts, or news slippage.")
    print("Validate out-of-sample and on sim before risking money (STRATEGY.md §5).")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("csv", help="5-min OHLCV CSV (datetime,open,high,low,close,volume)")
    p.add_argument("--instrument", default="MES", choices=sorted(SPECS))
    p.add_argument("--edge", default="both", choices=["orb", "vwap", "both"])
    p.add_argument("--utc", action="store_true", help="timestamps are UTC (converted to ET)")
    args = p.parse_args()
    df = load_bars(args.csv, utc=args.utc)
    if df.empty:
        print("No RTH bars found in the file — check the datetime column/timezone.", file=sys.stderr)
        return 1
    run(df, SPECS[args.instrument], args.edge)
    return 0


if __name__ == "__main__":
    sys.exit(main())
