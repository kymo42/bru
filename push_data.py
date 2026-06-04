"""
push_data.py — Push locally-generated data.json to the live Worker.

Usage:
  export BRU_UPDATE_SECRET=<your-secret>
  export BRU_WORKER_URL=https://bru.lol    # optional, defaults to https://bru.lol
  python push_data.py
"""
import os, json, requests, sys

WORKER_URL = os.environ.get("BRU_WORKER_URL", "https://bru.lol")
SECRET = os.environ.get("BRU_UPDATE_SECRET", "")

if not SECRET:
    print("❌  BRU_UPDATE_SECRET env var not set. Aborting.")
    sys.exit(1)

with open("data.json") as f:
    payload = f.read()

resp = requests.put(
    f"{WORKER_URL}/api/data",
    data=payload,
    headers={
        "Content-Type": "application/json",
        "x-update-secret": SECRET,
    },
    timeout=20,
)
print(resp.status_code, resp.text)
