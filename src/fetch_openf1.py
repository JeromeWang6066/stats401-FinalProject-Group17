from __future__ import annotations
import argparse
import json
import logging
import re
import time
from collections import deque
from pathlib import Path
from typing import Any

import requests

BASE_URL = "https://api.openf1.org/v1"
DEFAULT_YEARS = [2023, 2024, 2025]
ENDPOINTS = ["overtakes", "drivers", "pit", "race_control", "laps", "position"]
MIN_REQUEST_INTERVAL = 2.2
_last_request_time = 0.0
ROOT = Path(__file__).resolve().parents[1]
RAW_ROOT = ROOT / "data" / "raw"
MANIFEST_ROOT = ROOT / "data" / "manifests"

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
LOG = logging.getLogger("week3-fetch")


def safe_name(text: str) -> str:
    text = re.sub(r"[^A-Za-z0-9._-]+", "_", text.strip())
    return text.strip("_") or "unknown"


class RateLimiter:
    """Respect OpenF1 free-tier limits: <=3 req/s and <=30 req/min."""
    def __init__(self, min_interval: float = 2.1, max_per_minute: int = 29) -> None:
        self.min_interval = min_interval
        self.max_per_minute = max_per_minute
        self.last_request = 0.0
        self.recent: deque[float] = deque()

    def wait(self) -> None:
        now = time.monotonic()
        if self.recent:
            while self.recent and now - self.recent[0] >= 60:
                self.recent.popleft()
        if len(self.recent) >= self.max_per_minute:
            sleep_for = 60 - (now - self.recent[0]) + 0.05
            if sleep_for > 0:
                time.sleep(sleep_for)
            now = time.monotonic()
            while self.recent and now - self.recent[0] >= 60:
                self.recent.popleft()
        gap = now - self.last_request
        if gap < self.min_interval:
            time.sleep(self.min_interval - gap)
        stamp = time.monotonic()
        self.recent.append(stamp)
        self.last_request = stamp


LIMITER = RateLimiter()


def get_json(session, endpoint, params, retries=5):
    global _last_request_time
    url = f"{BASE_URL}/{endpoint}"
    last_error = None
    for attempt in range(retries):
        # Global rate limiter:
        # OpenF1 free tier allows up to 30 requests/minute.
        elapsed = time.monotonic() - _last_request_time
        if elapsed < MIN_REQUEST_INTERVAL:
            time.sleep(MIN_REQUEST_INTERVAL - elapsed)
        try:
            r = session.get(
                url,
                params=params,
                timeout=60,
            )
            _last_request_time = time.monotonic()
            if r.status_code == 404:
                print(
                    f"WARNING: {r.url} returned 404; "
                    f"treating this endpoint as unavailable."
                )
                return []
            if r.status_code == 429:
                wait = max(
                    10,
                    30 * (attempt + 1)
                )
                print(
                    f"WARNING: {r.url} returned 429 "
                    f"(rate limited); sleeping {wait}s..."
                )
                time.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            last_error = e
            if attempt < retries - 1:
                wait = min(60, 2 ** attempt)
                print(
                    f"WARNING: {r.url} failed ({e}); "
                    f"retrying in {wait}s"
                )
                time.sleep(wait)
    raise RuntimeError(
        f"OpenF1 request failed: "
        f"{endpoint} {params}: {last_error}"
    )

def save_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def fetch_year(session: requests.Session, year: int, overwrite: bool = False) -> list[dict[str, Any]]:
    meetings = get_json(session, "meetings", {"year": year})
    save_json(RAW_ROOT / str(year) / "_meetings.json", meetings)

    sessions = get_json(session, "sessions", {"year": year, "session_type": "Race"})
    # Keep only Race sessions explicitly; the API filter should already do this,
    # but the second check protects against future API changes.
    races = [x for x in sessions if x.get("session_type") == "Race" and not x.get("is_cancelled", False)]
    save_json(RAW_ROOT / str(year) / "_race_sessions.json", races)

    # Useful for checking that the expected meetings/sessions were discovered.
    meeting_keys = {m.get("meeting_key") for m in meetings}
    races = [r for r in races if r.get("meeting_key") in meeting_keys]
    LOG.info("%s: %d meetings, %d Race sessions", year, len(meetings), len(races))

    for meta in races:
        session_key = meta["session_key"]
        meeting_key = meta["meeting_key"]
        circuit = safe_name(meta.get("circuit_short_name") or meta.get("location") or f"meeting_{meeting_key}")
        folder = RAW_ROOT / str(year) / f"{circuit}_{session_key}"
        folder.mkdir(parents=True, exist_ok=True)
        save_json(folder / "session.json", meta)

        for endpoint in ENDPOINTS:
            out = folder / f"{endpoint}.json"
            if out.exists() and not overwrite:
                LOG.info("skip %s / %s (already exists)", session_key, endpoint)
                continue
            payload = get_json(session, endpoint, {"session_key": session_key})
            save_json(out, payload)
            LOG.info("fetched %-12s session=%s rows=%d", endpoint, session_key, len(payload))

    return races


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", nargs="+", type=int, default=DEFAULT_YEARS)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    all_races: list[dict[str, Any]] = []
    with requests.Session() as http:
        http.headers.update({"Accept": "application/json", "User-Agent": "STATS401-Group15-Week3/1.0"})
        for year in args.years:
            all_races.extend(fetch_year(http, year, overwrite=args.overwrite))

    MANIFEST_ROOT.mkdir(parents=True, exist_ok=True)
    all_races.sort(key=lambda x: x.get("date_start", ""))
    save_json(MANIFEST_ROOT / "race_sessions.json", all_races)
    LOG.info("done: %d Race sessions in manifest", len(all_races))


if __name__ == "__main__":
    main()
