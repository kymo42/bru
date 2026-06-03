"""Push data.json to the live worker via the /api/data endpoint."""
import json, requests

with open("data.json") as f:
    payload = f.read()

resp = requests.put(
    "https://bru.lol/api/data",
    data=payload,
    headers={
        "Content-Type": "application/json",
        "x-update-secret": "REDACTED_SECRET",
    },
    timeout=20,
)
print(resp.status_code, resp.text)
