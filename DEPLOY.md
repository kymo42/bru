# Deployment Guide

## Prerequisites

- Cloudflare account with `bru.lol` zone active
- `wrangler` CLI installed and authenticated
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set

## 1. Create KV Namespace

```bash
wrangler kv namespace create BRU_DATA
```

Copy the returned `id` and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "BRU_DATA"
id = "YOUR_KV_ID_HERE"
```

## 2. Set the Update Secret

```bash
wrangler secret put UPDATE_SECRET
# Enter a strong random string when prompted
# Store this same string as GitHub secret: BRU_UPDATE_SECRET
```

## 3. Deploy Worker

```bash
wrangler deploy
```

## 4. Run Initial Data Load

```bash
pip install requests yfinance
export BRU_UPDATE_SECRET=your_secret
export BRU_WORKER_URL=https://bru.lol
python data_refresh.py
```

## 5. GitHub Actions Setup

In your GitHub repo settings:
- **Secret**: `BRU_UPDATE_SECRET` = same secret as above
- **Variable**: `BRU_WORKER_URL` = `https://bru.lol`
- **Secret**: `CLOUDFLARE_API_TOKEN` = your CF API token (for future wrangler deploys from CI)

The workflow runs every Monday at 2am UTC automatically.
To trigger manually: Actions → Weekly Data Refresh → Run workflow.

## Updating the Worker Code

```bash
wrangler deploy
```

Done — Cloudflare handles routing via the `[[routes]]` in wrangler.toml.
