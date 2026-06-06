"""
data_refresh.py — Weekly data fetcher for bru.lol
Pulls live data from RBA, AFSA, Yahoo Finance (via yfinance)
and PUTs it to the Cloudflare Worker KV via the /api/data endpoint.

Run: python data_refresh.py
Env vars needed:
  BRU_UPDATE_SECRET  — secret matching the Worker's UPDATE_SECRET binding
  BRU_WORKER_URL     — e.g. https://bru.lol  (or workers.dev URL)
"""

import os, re, json, sys, requests
from datetime import datetime, timezone
from pathlib import Path

# ── Config ─────────────────────────────────────────────────────────
WORKER_URL = os.environ.get("BRU_WORKER_URL", "https://bru.lol")
UPDATE_SECRET = os.environ.get("BRU_UPDATE_SECRET", "")
HEADERS = {"User-Agent": "Mozilla/5.0 (bru.lol data refresher)"}


# ── Desperation Scale (static — updated by editing this file) ──────
DESPERATION_SCALE = [
    {
        "level": 1, "emoji": "💳", "label": "Big Bank Credit Cards / Mortgages",
        "typical_apr": "~6–20% p.a.",
        "exploitability": "LOW — competitive, regulated, credit-checked",
        "economic_signal": "Baseline. Rising balances = confidence OR early stress.",
        "data_proxy": "RBA D2: housing credit",
        "rises_in_stress": False,
    },
    {
        "level": 2, "emoji": "📦", "label": "Buy Now Pay Later (BNPL)",
        "typical_apr": "0% on-time / ~30–60% effective if fees triggered",
        "exploitability": "MEDIUM — late fees, encourages overspending",
        "economic_signal": "Rising BNPL use = cash-flow squeeze, payment deferral.",
        "data_proxy": "ASX:ZIP revenue + bad debt ratio",
        "rises_in_stress": True,
        "notes": "BNPL peaked 2021–22 then fell as regulation tightened. ZIP bad debts rose sharply 2022–23.",
    },
    {
        "level": 3, "emoji": "⏰", "label": "Salary Advance / Earned Wage Access",
        "typical_apr": "~5% flat fee → ~130% effective APR annualised",
        "exploitability": "MEDIUM-HIGH — targets paycheque-to-paycheque workers",
        "economic_signal": "Rising demand = workers can't bridge gap to payday.",
        "data_proxy": "ASX:B4P active customers (quarterly)",
        "rises_in_stress": True,
        "notes": "BeforePay (B4P) listed ASX 2022. MyPayNow faced ASIC scrutiny 2021 for unlicensed credit.",
    },
    {
        "level": 4, "emoji": "🏦", "label": "Non-Bank Personal Loans (Fintech)",
        "typical_apr": "8–25% p.a. (risk-based pricing)",
        "exploitability": "MEDIUM — cheaper than payday but costly at high risk tiers",
        "economic_signal": "Rising demand + falling approvals = tightening stress.",
        "data_proxy": "ASX:WZR (Wisr) + ASX:PLT (Plenti) loan books + arrears",
        "rises_in_stress": True,
    },
    {
        "level": 5, "emoji": "💵", "label": "Payday / SACC Loans",
        "typical_apr": "NCCP cap: 20% estab + 4%/mo = 48%+ p.a. min; ~400%+ on 2-week loan",
        "exploitability": "HIGH — maximum legal rate, targets credit-impaired",
        "economic_signal": "Rising originations = significant financial stress.",
        "data_proxy": "ASX:CCV Australian loan book growth (half-yearly)",
        "rises_in_stress": True,
        "notes": "ASIC reported ~1.77M SACCs originated p.a. (2016–17 data, latest published).",
    },
    {
        "level": 6, "emoji": "🎰", "label": "Poker Machines (Pubs & Clubs)",
        "typical_apr": "N/A — avg net loss ~$1,200–$1,500 per adult p.a. in NSW/VIC",
        "exploitability": "VERY HIGH — continuous play, near-miss psychology, direct debit from welfare",
        "economic_signal": "Rising net losses = households diverting essential funds to gambling.",
        "data_proxy": "ASX:ALG (Ainsworth) + ASX:TGR (Tabcorp) venue exposure; NSW/VIC monthly net loss stats",
        "rises_in_stress": True,
        "notes": "Multi-pub operators (e.g., Australian Venue Co, HTP, Stellar) hold ~60% of NSW/VIC pokie licenses. Structural demand remains high despite cost-of-living pressures.",
    },
    {
        "level": 7, "emoji": "🏪", "label": "Pawnbroking",
        "typical_apr": "Effective 60–200%+ (varies by state)",
        "exploitability": "HIGH — lose your asset if you can't repay; no credit check",
        "economic_signal": "↑ pawn activity = last resort before crisis. Industry $655M, 841 businesses.",
        "data_proxy": "ASX:CCV pawn volumes + ASIC credit licence count + ABS ANZSIC 6229",
        "rises_in_stress": True,
        "notes": "Cash Converters loan book +20% FY2023. CEO cited 'broader cross-section' of society (AFR Oct 2023).",
    },
    {
        "level": 8, "emoji": "📺", "label": "Rent-to-Own / Consumer Leases",
        "typical_apr": "60–300%+ effective (e.g. $400 TV → $1,500+ in lease payments)",
        "exploitability": "VERY HIGH — targets Centrelink recipients, direct debits welfare payments",
        "economic_signal": "Growing lease volumes = unable to save for essentials.",
        "data_proxy": "ASX:TGA (Thorn/Radio Rentals) lease book",
        "rises_in_stress": True,
        "notes": "Radio Rentals downsized significantly post-2019 after ASIC enforcement action for unconscionable conduct.",
    },
    {
        "level": 9, "emoji": "📞", "label": "Debt Collection / Distressed Debt",
        "typical_apr": "N/A — delinquent/charged-off debts",
        "exploitability": "EXTREME — collection on already-distressed people",
        "economic_signal": "Rising PDL volumes = wave of defaults upstream. Lags by 12–18 months.",
        "data_proxy": "ASX:CCP PDL acquisitions + collection rates (half-yearly)",
        "rises_in_stress": True,
        "notes": "Credit Corp record PDL acquisitions FY2022–23 as banks sold COVID-deferred debt portfolios.",
    },
    {
        "level": 10, "emoji": "⚖️", "label": "Personal Insolvency",
        "typical_apr": "N/A — terminal event",
        "exploitability": "HIGH — debt agreement admin fees can consume large % of repayments",
        "economic_signal": "FY2024: 12,447 (+15.3% YoY). Part IX Debt Agreements growing fastest. Lags 6–24 months.",
        "data_proxy": "AFSA quarterly stats: afsa.gov.au/about-us/statistics-and-insights",
        "rises_in_stress": True,
        "notes": "Lagging indicator — 6–24 months behind the inciting financial stress.",
    },
]

# ── Stress levels (manually curated, updated as data comes in) ─────
STRESS_LEVELS = [
    {"level": 1, "emoji": "💳", "label": "Bank credit / mortgages", "trend": "stable",
     "status": "Stable", "detail": "Mortgage arrears elevated but not crisis levels (RBA Oct 2024)"},
    {"level": 2, "emoji": "📦", "label": "BNPL", "trend": "stable",
     "status": "Stable", "detail": "Afterpay flat post-peak. ZIP volumes recovering but bad debts elevated."},
    {"level": 3, "emoji": "⏰", "label": "Salary advance / EWA", "trend": "rising",
     "status": "Rising ↑", "detail": "BeforePay active customers growing YoY. MyPayNow stable."},
    {"level": 4, "emoji": "🏦", "label": "Fintech personal loans", "trend": "rising",
     "status": "Rising ↑", "detail": "Wisr + Plenti loan books growing but arrears ticking up."},
    {"level": 5, "emoji": "💵", "label": "Payday / SACC", "trend": "rising",
     "status": "Rising ↑", "detail": "CCV Australian loan book +20% FY2023, +15% FY2024."},
    {"level": 6, "emoji": "🎰", "label": "Poker Machines (Pubs/Clubs)", "trend": "rising",
     "status": "Rising ↑", "detail": "NSW/VIC net losses remain elevated. Multi-pub operators (AVC, HTP) drive structural venue demand."},
    {"level": 7, "emoji": "🏪", "label": "Pawnbroking", "trend": "rising",
     "status": "Rising ↑", "detail": "CCV revenue +38% over 3 years. CEO signals broader demand base."},
    {"level": 8, "emoji": "📺", "label": "Rent-to-own", "trend": "falling",
     "status": "Declining ↓", "detail": "Radio Rentals contracted after ASIC action. Market shrinking."},
    {"level": 9, "emoji": "📞", "label": "Debt collection", "trend": "rising",
     "status": "Rising ↑", "detail": "CCP PDL acquisitions at record. Lagging indicator — still rising."},
    {"level": 10, "emoji": "⚖️", "label": "Personal insolvency", "trend": "rising",
     "status": "Rising ↑ (+15.3%)", "detail": "AFSA FY2024: 12,447 total. Part IX Debt Agreements leading growth."},
]


# ── Data fetchers ──────────────────────────────────────────────────

def fetch_rba_personal_credit():
    url = "https://www.rba.gov.au/statistics/tables/csv/d2-data.csv"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        text = resp.text.lstrip("\ufeff")
        lines = text.splitlines()
        title_row = lines[1] if len(lines) > 1 else ""
        parts = title_row.split(",")
        col_idx = 21  # fallback confirmed
        for j, p in enumerate(parts):
            if "Credit; Other personal" in p and "Seasonally" not in p:
                col_idx = j
                break
        data = []
        for line in lines:
            parts_d = line.strip().split(",")
            if len(parts_d) <= col_idx:
                continue
            date_str = parts_d[0].strip()
            val_str = parts_d[col_idx].strip()
            if re.match(r"\d{2}/\d{2}/\d{4}", date_str) and val_str:
                try:
                    data.append([date_str, float(val_str)])
                except ValueError:
                    pass
        return data[-36:]  # last 3 years
    except Exception as e:
        print(f"  ⚠️  RBA fetch error: {e}")
        return []


def fetch_asx_price(ticker):
    """Fetch ASX stock price via yfinance."""
    try:
        import yfinance as yf
        t = yf.Ticker(f"{ticker}.AX")
        hist = t.history(period="5d")
        if not hist.empty:
            return round(float(hist["Close"].iloc[-1]), 3)
    except Exception as e:
        print(f"  ⚠️  yfinance {ticker} error: {e}")
    return None


def fetch_afsa_insolvency():
    """Returns known AFSA data — update manually each quarter."""
    return {
        "FY2024_total": 12447,
        "FY2024_yoy_pct": 15.3,
        "FY2023_total": 10799,
        "trend": "rising",
        "source": "https://www.afsa.gov.au/about-us/statistics-and-insights",
        "note": "Part IX Debt Agreements leading growth in FY2024.",
        "last_checked": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    }


# ── Main ────────────────────────────────────────────────────────────

def build_payload():
    print("📊 Fetching RBA personal credit...")
    rba = fetch_rba_personal_credit()
    rba_latest = rba[-1] if rba else None
    rba_12mo_val = None
    if len(rba) >= 13:
        rba_12mo_val = round(rba[-1][1] - rba[-13][1], 2)

    print("🏦 Fetching ASX:CCV price...")
    ccv_price = fetch_asx_price("CCV")

    print("📞 Fetching ASX:CCP price...")
    ccp_price = fetch_asx_price("CCP")

    print("⚖️  Loading AFSA insolvency data...")
    insolvency = fetch_afsa_insolvency()

    # Compute overall stress level (simple heuristic)
    rising_count = sum(1 for s in STRESS_LEVELS if s["trend"] == "rising")
    overall = min(10, max(1, rising_count + 1))

    payload = {
        "last_updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "overall_stress_level": overall,
        "rba_personal_credit": rba,
        "rba_12mo_change": rba_12mo_val,
        "ccv_price": ccv_price,
        "ccp_price": ccp_price,
        "pokie_static": {
            "nsw_annual_net_loss": "~$4.5B+",
            "vic_annual_net_loss": "~$3.2B+",
            "major_operators": "Australian Venue Co (AVC), HTP, Stellar Group",
            "market_share": "~60% of NSW/VIC pokie licenses held by multi-pub operators",
        },
        "ccv_static": {
            "revenue_fy2024": 310,
            "revenue_fy2023": 296,
            "stores_au": 165,
            "loan_book_growth_fy23_pct": 20,
        },
        "insolvency": insolvency,
        "stress_levels": STRESS_LEVELS,
        "desperation_scale": DESPERATION_SCALE,
    }
    return payload


def push_to_worker(payload):
    if not UPDATE_SECRET:
        print("⚠️  BRU_UPDATE_SECRET not set — saving to data.json only")
        return False
    url = f"{WORKER_URL}/api/data"
    try:
        resp = requests.put(
            url,
            data=json.dumps(payload),
            headers={
                "Content-Type": "application/json",
                "x-update-secret": UPDATE_SECRET,
            },
            timeout=30,
        )
        if resp.status_code == 200:
            print(f"✅ Data pushed to {url}")
            return True
        else:
            print(f"❌ Push failed: {resp.status_code} {resp.text[:200]}")
            return False
    except Exception as e:
        print(f"❌ Push error: {e}")
        return False


if __name__ == "__main__":
    print("=" * 60)
    print("  bru.lol data refresh")
    print(f"  {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    payload = build_payload()

    # Always save locally
    out = Path(__file__).parent / "data.json"
    with open(out, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"✅ Saved to {out}")

    # Push to worker if secret is set
    pushed = push_to_worker(payload)

    # Print summary
    print("\n📋 Summary:")
    rba = payload["rba_personal_credit"]
    if rba:
        print(f"  RBA Other Personal Credit: ${rba[-1][1]}B ({rba[-1][0]})")
        if payload["rba_12mo_change"] is not None:
            print(f"  12mo change: {payload['rba_12mo_change']:+.1f}B")
    print(f"  CCV price: ${payload['ccv_price'] or 'N/A'}")
    print(f"  CCP price: ${payload['ccp_price'] or 'N/A'}")
    print(f"  Pokies: {payload['pokie_static']['nsw_annual_net_loss']} NSW net loss")
    print(f"  Insolvencies FY2024: {payload['insolvency']['FY2024_total']:,} (+{payload['insolvency']['FY2024_yoy_pct']}%)")
    print(f"  Overall stress: {payload['overall_stress_level']}/10")
    print("=" * 60)
