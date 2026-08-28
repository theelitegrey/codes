# High-Probability Index Futures Playbook (MNQ / NQ / ES / MES)

> **Read this first — it matters more than the strategy.**
> No strategy has a 100% win rate. Anyone selling one is lying. Backtests below show
> realistic win rates of 55–75% *with strict filters*, and even those degrade in live
> trading due to slippage, fills, and regime change. If losing this money would be
> "life and death," **do not trade it**. Futures are leveraged instruments; day traders
> as a population lose money. Trade only risk capital, start on MES/MNQ (micros) or sim,
> and treat the risk-management section as the actual strategy — because it is.

---

## 1. Why "highest win rate" is the wrong target (and what to aim for instead)

What pays you is **expectancy**, not win rate:

```
Expectancy per trade = (WinRate × AvgWin) − (LossRate × AvgLoss)
```

- A 40% win rate with 3R winners is profitable. A 90% win rate with 1R winners and
  occasional −10R disasters (the classic "sell options / no stop" profile) blows up.
- With a 1:2 risk/reward you only need ~33% wins to break even. Chasing win rate by
  widening stops and shrinking targets *raises* win rate while *destroying* expectancy.
- Therefore this playbook maximizes win rate **only within setups that keep
  average loss ≤ average win**. That's the honest ceiling: ~60–75% on the best filtered
  setups, not 95%.

## 2. The two edges with the best documented stats on index futures

### Edge A — Opening Range Breakout (ORB), trend-filtered
The most-studied intraday edge on ES/NQ. Academic work by Zarattini, Barbon & Aziz
(SSRN 4729284) validated 5-minute ORB rigorously (on equities/QQQ: Sharpe 2.81,
net of costs). Public futures backtests report:

- 5-min ORB on ES: ~72–75% win rate, profit factor 1.6–2.5 (edgeful, 6-month sample)
- 15-min ORB: ~54–56% win rate at 1.6–1.8:1 reward/risk
- 30-min range continuation rate: ~64.6% on ES, ~67.0% on NQ
- Without a trend filter win rates drop toward 40%; with higher-timeframe trend +
  VWAP alignment they run ~55%+ with better R.

**Rules (long side; mirror for shorts):**
1. Mark the high/low of the first 15 minutes of RTH (9:30–9:45 ET).
2. Trade **only in the direction of the daily trend**: price above the daily 20-EMA
   *and* above VWAP → longs only. Below both → shorts only. Mixed → no trade.
3. Entry: 5-min close above the opening-range high.
4. Stop: opposite side of the opening range, or 1× 14-period ATR(5-min), whichever is tighter in $ risk.
5. Target 1: 1R — take half off, move stop to breakeven. Target 2: 2R or VWAP-trail.
6. One entry per direction per day. No trades after 11:30 ET. Flat by 15:55 ET always.
7. Skip days: FOMC, CPI, NFP mornings (trade only after the release settles, or not at all).

### Edge B — VWAP mean reversion, regime-filtered (the "high win rate" workhorse)
Reversion to VWAP is the highest-win-rate repeatable intraday setup on ES, **but only
on non-trend days**. Public backtests: 55–65% with ADX/news/session filters (~45%
unfiltered — trend days destroy it); band-touch reversion setups report 72–80% in
favorable regimes; one out-of-sample test: 72% wins over 83 trades, −10.2% max DD.

**Rules (long side; mirror for shorts):**
1. **Regime filter (non-negotiable):** ADX(14) on the 15-min chart < 20, and price has
   crossed VWAP at least twice today (proves rotation, not trend). If ADX ≥ 25: stand down.
2. Setup: price stretches to the **2nd standard-deviation VWAP band** below VWAP.
3. Trigger: 5-min bar closes back *inside* the bands (rejection), ideally with a volume spike.
4. Stop: 1.25× ATR(14, 5-min) beyond the extreme, **hard stop, always in the market**.
5. Target: VWAP itself. Nothing more. Greed converts this into a losing strategy.
6. Time window: 10:00–11:30 ET and 13:30–15:00 ET only (skip the open drive and the close).
7. Max 3 attempts/day. Two consecutive losses on this setup = the regime read is wrong = done for the day.

**Which to trade when:** run one decision at 9:45 ET — if the open drove strongly one
way with rising ADX, it's an ORB/trend day (Edge A). If the open is two-sided around
VWAP, it's a rotation day (Edge B). If unclear, no trades. "No trade" is a position.

## 3. Instrument selection

| | Tick | Tick $ | Typical day range | Use |
|---|---|---|---|---|
| MES | 0.25 | $1.25 | ~40–80 pts | Learning + small accounts |
| MNQ | 0.25 | $0.50 | ~200–400 pts | Learning NQ behavior |
| ES | 0.25 | $12.50 | same as MES | Only after ≥3 profitable months on micros |
| NQ | 0.25 | $5.00 | same as MNQ | Same — NQ is 10× MNQ risk |

Start on **MES**: it moves slower and is more forgiving of structure mistakes. MNQ's
small tick value is a trap — NQ's range means a "normal" stop is still large in dollars.

## 4. Risk management — the part that actually keeps you alive

1. **Per-trade risk: 1% of account maximum** (0.5% while learning). Size from the stop:
   `contracts = floor(account × 1% ÷ (stop_points × point_value))`. If that's < 1 micro
   contract, the account is too small for the trade — skip it.
2. **Daily loss limit: 2R (≈2%). Hard.** Hit it → platform flat, walk away. At 50% of the
   daily limit, cut size in half.
3. **Weekly circuit breaker: −5%** → no live trading until the following Monday; review journal.
4. Volatility-adjusted sizing: VIX < 15 → 1.5% risk cap; 15–20 → 1%; 20–30 → 0.75%; > 30 → 0.5%.
5. **Every entry has a stop in the market before the entry fills.** Mental stops are how
   accounts die on NQ.
6. Never average down. Never remove a stop. Never revenge-trade after the daily limit.
7. Flat overnight, always, until you have a full year of records.

## 5. Validation protocol (do this before risking a dollar)

1. Backtest both edges on ≥2 years of 5-min data for your instrument (see `backtest/`).
   Include commissions (~$1.24/side/micro round-turn varies by broker) and 1-tick slippage per side.
2. Demand: profit factor ≥ 1.3 after costs, max drawdown you could emotionally survive ×2.
3. Sim-trade the exact rules for 30 sessions. Rule violations count as strategy failures.
4. Go live on **1 MES** only after sim expectancy is positive. Scale by +1 micro per
   month of profitability, never after a winning day.
5. Journal every trade: setup, regime read, R result, rule violations. The journal — not
   the P&L — tells you whether the edge or the execution is failing.

## 6. Expectancy math for this playbook (realistic, after costs)

- Edge A at 55% wins, avg win 1.5R, avg loss 1R → E = 0.55×1.5 − 0.45×1 = **+0.375R/trade**
- Edge B at 65% wins, avg win 0.9R, avg loss 1R → E = 0.65×0.9 − 0.35×1 = **+0.235R/trade**
- At 1% risk and ~2 trades/day, that's a realistic expectation of low-single-digit %
  per month with discipline — not doubling accounts. Anyone promising more is selling something.

## 7. What will actually cause failure

In order of empirical likelihood: (1) breaking the daily loss limit, (2) trading Edge B
on a trend day because "it has the higher win rate," (3) oversizing MNQ/NQ because the
tick looks cheap, (4) moving stops, (5) trading the news candle. The strategy survives
losing trades by design; it does not survive rule violations.
