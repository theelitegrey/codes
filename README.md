# codes

Trading playbook and tooling for MNQ / NQ / ES / MES index futures.

- **[STRATEGY.md](STRATEGY.md)** — the full playbook: two documented edges
  (trend-filtered Opening Range Breakout, regime-filtered VWAP mean reversion),
  instrument selection, risk management, and a validation protocol. Read the
  warning at the top first.
- **[backtest/backtest.py](backtest/backtest.py)** — backtester that implements
  both edges exactly as written, with commissions and slippage modeled. Feed it
  2+ years of 5-minute OHLCV data before trading a single contract:

  ```bash
  pip install -r backtest/requirements.txt
  python backtest/backtest.py your_5min_data.csv --instrument MES --edge both
  ```

Nothing here is financial advice, and no strategy wins every trade. Do not
trade money you cannot afford to lose.
