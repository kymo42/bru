# bru.lol — Australian Financial Stress Tracker

A real-time tracker of Australian household financial stress, using the pawn shop industry, payday lending, and personal insolvency data as economic indicators.

**Live site:** [bru.lol](https://bru.lol)

## The Thesis

When people are under financial stress, they progressively resort to more expensive and exploitative credit products. By tracking these industries — from BNPL at the mild end through to pawnbroking and bankruptcy at the severe end — we get a leading/coincident indicator of economic pain that mainstream metrics often miss or lag.

## The Desperation Scale

| Level | Category | APR | Exploitability |
|-------|----------|-----|----------------|
| 1 💳 | Big bank credit cards / mortgages | 6–20% | Low |
| 2 📦 | BNPL (Afterpay, Zip, Humm) | 0% on-time / 30–60% w/ fees | Medium |
| 3 ⏰ | Salary advance / EWA (BeforePay) | ~130% effective | Medium-High |
| 4 🏦 | Fintech personal loans (Wisr, Plenti) | 8–25% | Medium |
| 5 💵 | Payday / SACC (Nimble, Cash Converters) | 48–400%+ effective | High |
| 6 🏪 | Pawnbroking (Cash Converters, Max Cash) | 60–200%+ | High |
| 7 📺 | Rent-to-own (Radio Rentals / Thorn) | 60–300%+ | Very High |
| 8 📞 | Debt collection (Credit Corp, CLH) | N/A | Extreme |
| 9 ⚖️ | Personal insolvency (AFSA) | N/A | High (admin fees) |

## Data Sources

- **RBA D2** — Personal credit aggregates (monthly CSV, free)
- **AFSA** — Personal insolvency statistics (quarterly, free)
- **ASX:CCV** — Cash Converters half-yearly results
- **ASX:CCP** — Credit Corp (debt collection) results
- **IBISWorld** — Pawnbroking industry data (AU industry report OD4522)
- **ASIC** — SACC loan volume reports

## Architecture

```
GitHub Actions (weekly)
  └── data_refresh.py
        ├── Fetches RBA CSV
        ├── Fetches ASX prices via yfinance
        └── PUTs JSON → Cloudflare Worker /api/data

Cloudflare Worker (bru.lol)
  ├── GET /          → HTML dashboard (reads from KV)
  ├── GET /api/data  → Raw JSON
  └── PUT /api/data  → Update KV (requires secret)
```

## Running Locally

```bash
pip install requests yfinance
python data_refresh.py
```

Generates `data.json`. To push to the worker:

```bash
export BRU_UPDATE_SECRET=your_secret
export BRU_WORKER_URL=https://bru.lol
python data_refresh.py
```

## Deployment

See [DEPLOY.md](DEPLOY.md) for Cloudflare Workers setup.

## Adding New Metrics

Edit `DESPERATION_SCALE` and `STRESS_LEVELS` in `data_refresh.py`. The dashboard auto-renders whatever's in the payload. For new live data sources, add a `fetch_*()` function and include the result in `build_payload()`.

---

*Not financial advice. For research and economic analysis purposes.*
