"""Export per-session exclusive tag counts for the composition donut."""

from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "processed" / "overtakes_tagged.csv"
JS_OUT = ROOT / "js" / "donut_data.js"

TAGS = (
    "on_track",
    "pit",
    "retired",
    "under_sc",
    "unlap_under_sc",
    "formation",
    "post_race",
)


def truthy(value: str) -> bool:
    return str(value).strip().lower() in {"true", "1", "yes"}


def build() -> list[dict]:
    groups: dict[str, dict] = {}
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            key = row["session_key"]
            group = groups.get(key)
            if group is None:
                group = {
                    "key": int(key),
                    "year": int(row["year"]),
                    "gp": row["grand_prix"],
                    "type": row["session_name"],
                    "n": 0,
                    "pitFeedMissing": False,
                    "counts": {tag: 0 for tag in TAGS},
                    "onTrack": {"n": 0, "lap1": 0, "burst": 0, "bounce": 0, "rest": 0},
                }
                groups[key] = group
            group["n"] += 1
            group["pitFeedMissing"] = group["pitFeedMissing"] or truthy(row["pit_feed_missing"])
            tag = row["tag"]
            if tag in group["counts"]:
                group["counts"][tag] += 1
            if tag != "on_track":
                continue
            flags = group["onTrack"]
            flags["n"] += 1
            lap1 = truthy(row["is_lap1"])
            burst = truthy(row["is_burst"])
            bounce = truthy(row["is_bounce_8s"])
            if lap1:
                flags["lap1"] += 1
            if burst:
                flags["burst"] += 1
            if bounce:
                flags["bounce"] += 1
            if not (lap1 or burst or bounce):
                flags["rest"] += 1
    return sorted(groups.values(), key=lambda item: (item["year"], item["gp"], item["type"] != "Race", item["key"]))


def main() -> None:
    payload = build()
    JS_OUT.write_text(
        "window.DONUT_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    missing = sum(1 for row in payload if row["pitFeedMissing"])
    print(f"wrote {JS_OUT} ({len(payload)} sessions, {missing} without a pit feed)")


if __name__ == "__main__":
    main()
