"""Export per-event lap data for the interactive raw/clean comparison chart."""

from __future__ import annotations

import csv
import json
from bisect import bisect_right
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "processed" / "overtakes_tagged.csv"
RAW_ROOT = ROOT / "data" / "raw"
JS_OUT = ROOT / "js" / "lap_data.js"


def timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def lap_timeline(folder: Path) -> tuple[list[tuple[int, datetime, float]], int]:
    starts: dict[int, list[datetime]] = defaultdict(list)
    durations: dict[int, list[float]] = defaultdict(list)
    for row in json.loads((folder / "laps.json").read_text(encoding="utf-8")):
        start = timestamp(row.get("date_start"))
        try:
            lap = int(row["lap_number"])
        except (KeyError, TypeError, ValueError):
            continue
        if start is None or lap < 1:
            continue
        starts[lap].append(start)
        try:
            duration = float(row["lap_duration"])
            if duration > 5:
                durations[lap].append(duration)
        except (KeyError, TypeError, ValueError):
            pass
    timeline = [(lap, min(times), median(durations[lap]) if durations[lap] else 90.0)
                for lap, times in starts.items()]
    timeline.sort(key=lambda item: item[1])
    return timeline, max(starts, default=0)


def progress(timeline: list[tuple[int, datetime, float]], when: datetime) -> float:
    if not timeline:
        return 1.0
    index = max(0, bisect_right([row[1] for row in timeline], when) - 1)
    lap, start, duration = timeline[index]
    fraction = max(0.0, min(0.999, (when - start).total_seconds() / duration))
    return round(lap + fraction, 3)


def neutralized_intervals(folder: Path, end: datetime | None) -> list[tuple[str, datetime, datetime]]:
    path = folder / "race_control.json"
    if not path.exists():
        return []
    rows = json.loads(path.read_text(encoding="utf-8"))
    dated = [(t, row) for row in rows if (t := timestamp(row.get("date"))) is not None]
    dated.sort(key=lambda item: item[0])
    active: dict[str, datetime | None] = {"VSC": None, "SC": None, "RED": None}
    intervals = []
    for when, row in dated:
        message = str(row.get("message") or "").upper().strip()
        category = str(row.get("category") or "").upper().strip()
        vsc_start = "VIRTUAL SAFETY CAR" in message and "DEPLOY" in message
        vsc_end = "VIRTUAL SAFETY CAR" in message and ("ENDING" in message or "ENDED" in message)
        sc_start = ("SAFETY CAR" in message and "DEPLOY" in message) or (category == "SAFETYCAR" and "IN THIS LAP" not in message)
        sc_end = "SAFETY CAR" in message and ("IN THIS LAP" in message or "ENDING" in message)
        red_start = "RED FLAG" in message and "CHEQUERED FLAG" not in message
        red_end = any(part in message for part in ("GREEN FLAG", "GREEN LIGHT", "SESSION WILL RESUME", "SESSION RESUMED"))
        for kind, starts, stops in (("VSC", vsc_start, vsc_end), ("SC", sc_start, sc_end), ("RED", red_start, red_end)):
            if starts and active[kind] is None:
                active[kind] = when
            elif stops and active[kind] is not None:
                if when > active[kind]:
                    intervals.append((kind, active[kind], when))
                active[kind] = None
    if end is not None:
        intervals.extend((kind, start, end) for kind, start in active.items() if start is not None and end > start)
    return intervals


def build_lap_data() -> list[dict]:
    folders = {}
    for path in RAW_ROOT.glob("*/*/session.json"):
        meta = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(meta, list):
            meta = meta[0]
        folders[str(meta["session_key"])] = (path.parent, meta)

    groups: dict[str, dict] = {}
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            key = row["session_key"]
            group = groups.setdefault(key, {
                "key": int(key), "year": int(row["year"]), "gp": row["grand_prix"],
                "type": row["session_name"], "events": [], "missingRaw": 0, "missingClean": 0,
            })
            try:
                lap = int(float(row["lap_number"]))
                if lap < 1:
                    raise ValueError
            except (TypeError, ValueError):
                group["missingRaw"] += 1
                group["missingClean"] += row["tag"] == "on_track"
                continue
            group["events"].append([
                lap, row["date"], row["overtaking_full_name"] or row["overtaking_acronym"],
                row["overtaken_full_name"] or row["overtaken_acronym"],
                int(float(row["position"])) if row["position"] else None, row["tag"],
            ])

    output = []
    for key, group in groups.items():
        folder, meta = folders[key]
        timeline, max_lap = lap_timeline(folder)
        max_lap = max(max_lap, max((event[0] for event in group["events"]), default=1))
        end = timestamp(meta.get("date_end"))
        group["maxLap"] = max_lap
        group["bands"] = [
            [kind, max(1, min(max_lap + 1, progress(timeline, start))),
             max(1, min(max_lap + 1, progress(timeline, stop)))]
            for kind, start, stop in neutralized_intervals(folder, end)
        ] if timeline else []
        group["events"].sort(key=lambda event: (event[0], event[1]))
        output.append(group)
    return sorted(output, key=lambda item: (item["year"], item["gp"], item["type"], item["key"]))


def main() -> None:
    payload = build_lap_data()
    JS_OUT.write_text("window.LAP_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"wrote {JS_OUT} ({len(payload)} sessions)")


if __name__ == "__main__":
    main()
