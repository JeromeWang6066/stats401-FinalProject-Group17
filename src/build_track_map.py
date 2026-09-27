"""Place each session's overtakes on a track map and write js/track_data.js."""

from __future__ import annotations

import argparse
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd
import requests

from fetch_openf1 import get_json

ROOT = Path(__file__).resolve().parents[1]
RAW_ROOT = ROOT / "data" / "raw"
CSV_PATH = ROOT / "data" / "processed" / "overtakes_tagged.csv"
JS_OUT = ROOT / "js" / "track_data.js"
CIRCUIT_ROOT = RAW_ROOT / "_circuit_info"
CORNER_MAX_DISTANCE = 300.0
LOCATION_TIMEOUT = 180

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
LOG = logging.getLogger("track-map")


def choose_reference_lap(laps: list[dict]) -> dict | None:
    """Driver with the most timed non-pit laps, then a middle lap that has a following start."""
    starts: dict[int, dict[int, str]] = {}
    clean: dict[int, set[int]] = {}
    for row in laps:
        try:
            driver = int(row["driver_number"])
            lap_no = int(row["lap_number"])
        except (KeyError, TypeError, ValueError):
            continue
        if row.get("date_start"):
            starts.setdefault(driver, {})[lap_no] = row["date_start"]
        if row.get("is_pit_out_lap"):
            continue
        try:
            duration = float(row.get("lap_duration"))
        except (TypeError, ValueError):
            continue
        if duration <= 5 or lap_no < 1:
            continue
        clean.setdefault(driver, set()).add(lap_no)
    if not clean:
        return None
    driver = max(clean, key=lambda number: (len(clean[number]), -number))
    candidates = []
    for lap_no in sorted(clean[driver]):
        if lap_no <= 1:
            continue
        start = starts.get(driver, {}).get(lap_no)
        end = starts.get(driver, {}).get(lap_no + 1)
        if start and end:
            candidates.append(lap_no)
    if not candidates:
        return None
    lap_no = candidates[len(candidates) // 2]
    return {
        "driver_number": driver,
        "lap_number": lap_no,
        "start": starts[driver][lap_no],
        "end": starts[driver][lap_no + 1],
    }


def place_events(events: pd.DataFrame, locations: pd.DataFrame, tolerance_s: float = 1.0) -> pd.DataFrame:
    """Nearest location sample of the overtaking driver, within tolerance_s."""
    ev = events.copy().reset_index(drop=False).rename(columns={"index": "_row"})
    ev["date"] = pd.to_datetime(ev["date"], utc=True, errors="coerce")
    ev["overtaking_driver_number"] = pd.to_numeric(ev["overtaking_driver_number"], errors="coerce")
    ev["x"] = pd.NA
    ev["y"] = pd.NA
    if ev.empty or locations.empty:
        return ev.drop(columns=["_row"])
    locs = locations.copy()
    locs["date"] = pd.to_datetime(locs["date"], utc=True, errors="coerce")
    locs["driver_number"] = pd.to_numeric(locs["driver_number"], errors="coerce")
    locs = locs.dropna(subset=["date", "driver_number", "x", "y"])
    parts = []
    for driver, group in ev.groupby("overtaking_driver_number", sort=False):
        group = group.sort_values("date")
        loc = locs.loc[locs["driver_number"].eq(driver), ["date", "x", "y"]].sort_values("date")
        if loc.empty or group["date"].isna().all():
            parts.append(group)
            continue
        merged = pd.merge_asof(
            group.drop(columns=["x", "y"]),
            loc,
            on="date",
            direction="nearest",
            tolerance=pd.Timedelta(seconds=tolerance_s),
        )
        parts.append(merged)
    placed = pd.concat(parts, ignore_index=True).sort_values("_row")
    return placed.drop(columns=["_row"])


def project_to_polyline(centerline: list[list[float]], x: float, y: float) -> tuple[float, float]:
    best_dist = float("inf")
    best_arc = 0.0
    traveled = 0.0
    if len(centerline) < 2:
        return best_dist, best_arc
    for (ax, ay), (bx, by) in zip(centerline, centerline[1:]):
        dx, dy = bx - ax, by - ay
        length_sq = dx * dx + dy * dy
        if length_sq == 0:
            continue
        length = length_sq ** 0.5
        t = ((x - ax) * dx + (y - ay) * dy) / length_sq
        t = 0.0 if t < 0 else 1.0 if t > 1 else t
        px, py = ax + t * dx, ay + t * dy
        dist = ((x - px) ** 2 + (y - py) ** 2) ** 0.5
        if dist < best_dist:
            best_dist = dist
            best_arc = traveled + t * length
        traveled += length
    return best_dist, best_arc


def assign_corner(distance: float, arc: float, corners: list[dict], max_distance: float = CORNER_MAX_DISTANCE):
    if distance > max_distance or not corners:
        return None
    best = min(corners, key=lambda corner: abs(float(corner["length"]) - arc))
    return int(best["number"])


def arc_offset(centerline: list[list[float]], corners: list[dict]) -> float:
    """Shift our lap's arc length onto the circuit-info length scale."""
    deltas = []
    for corner in corners:
        dist, arc = project_to_polyline(centerline, float(corner["x"]), float(corner["y"]))
        if dist <= CORNER_MAX_DISTANCE:
            deltas.append(arc - float(corner["length"]))
    if not deltas:
        return 0.0
    deltas.sort()
    return deltas[len(deltas) // 2]


def corner_for_point(centerline, x, y, corners, offset) -> int | None:
    if x is None or y is None or pd.isna(x) or pd.isna(y):
        return None
    dist, arc = project_to_polyline(centerline, float(x), float(y))
    return assign_corner(dist, arc - offset, corners)


def _stamp(value) -> pd.Timestamp:
    return pd.Timestamp(value).tz_convert("UTC") if pd.Timestamp(value).tzinfo else pd.Timestamp(value, tz="UTC")


def api_time(value) -> str:
    return _stamp(value).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]


def slice_window(rows: list[dict], start, end) -> list[dict]:
    start_ts, end_ts = _stamp(start), _stamp(end)
    kept = []
    for row in rows:
        if row.get("x") is None or row.get("y") is None or not row.get("date"):
            continue
        when = _stamp(row["date"])
        if start_ts <= when < end_ts:
            kept.append(row)
    kept.sort(key=lambda row: row["date"])
    return kept


def centerline_xy(rows: list[dict]) -> list[list[float]]:
    points = []
    for row in rows:
        point = [round(float(row["x"]), 1), round(float(row["y"]), 1)]
        if not points or point != points[-1]:
            points.append(point)
    return points


def session_folders() -> dict[int, tuple[Path, dict]]:
    found = {}
    for path in RAW_ROOT.glob("*/*/session.json"):
        meta = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(meta, list):
            meta = meta[0]
        found[int(meta["session_key"])] = (path.parent, meta)
    return found


def load_meetings() -> dict[int, dict]:
    found = {}
    for path in RAW_ROOT.glob("*/_meetings.json"):
        for row in json.loads(path.read_text(encoding="utf-8")):
            found[int(row["meeting_key"])] = row
    return found


def circuit_cache_path(url: str) -> Path:
    tail = url.rstrip("/").split("/")
    return CIRCUIT_ROOT / f"{tail[-2]}_{tail[-1]}.json"


def load_circuit(http: requests.Session, meeting: dict | None) -> tuple[list[dict], float]:
    url = (meeting or {}).get("circuit_info_url")
    if not url:
        return [], 0.0
    path = circuit_cache_path(url)
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
    else:
        response = http.get(url, timeout=60)
        response.raise_for_status()
        payload = response.json()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    corners = []
    for row in payload.get("corners") or []:
        pos = row.get("trackPosition") or {}
        if pos.get("x") is None or pos.get("y") is None or row.get("length") is None:
            continue
        corners.append({
            "number": int(row["number"]),
            "x": round(float(pos["x"]), 1),
            "y": round(float(pos["y"]), 1),
            "length": round(float(row["length"]), 1),
        })
    rotation = float(payload.get("rotation") or 0)
    return corners, rotation


def save_compact(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def fetch_location(http: requests.Session, session_key: int, driver: int, start=None, end=None) -> list:
    params = {"session_key": session_key, "driver_number": int(driver)}
    if start is not None:
        params["date>"] = api_time(start)
    if end is not None:
        params["date<"] = api_time(end)
    payload = get_json(http, "location", params, timeout=LOCATION_TIMEOUT)
    if not isinstance(payload, list):
        raise RuntimeError(f"location session={session_key} driver={driver} returned {type(payload).__name__}")
    return payload


def load_driver_location(folder: Path, session_key: int, driver: int, overwrite: bool) -> list:
    path = folder / f"location_{int(driver)}.json"
    if path.exists() and not overwrite:
        return json.loads(path.read_text(encoding="utf-8"))
    try:
        with requests.Session() as http:
            http.headers.update({"Accept": "application/json", "User-Agent": "STATS401-Group17-track/1.0"})
            payload = fetch_location(http, session_key, driver)
    except RuntimeError:
        LOG.exception("location failed session=%s driver=%s", session_key, driver)
        return []
    save_compact(path, payload)
    LOG.info("location session=%s driver=%s rows=%d", session_key, driver, len(payload))
    return payload


def drop_location_cache(folder: Path) -> None:
    for path in folder.glob("location_*.json"):
        if path.stem[9:].isdigit():
            path.unlink()


def _bool(value) -> bool:
    return str(value).strip().lower() in {"1", "true", "t", "yes"}


def _int_or_none(value):
    try:
        if value is None or (isinstance(value, float) and pd.isna(value)) or str(value).strip() == "":
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def build_session(folder: Path, meta: dict, events: pd.DataFrame, meetings: dict, http, overwrite: bool) -> dict:
    session_key = int(meta["session_key"])
    laps = json.loads((folder / "laps.json").read_text(encoding="utf-8"))
    reference = choose_reference_lap(laps)
    meeting = meetings.get(int(meta["meeting_key"]))
    corners, rotation = load_circuit(http, meeting)
    drivers = sorted({
        int(float(number))
        for number in events["overtaking_driver_number"].dropna().tolist()
    })
    if reference and reference["driver_number"] not in drivers:
        drivers.append(reference["driver_number"])
    samples = []
    by_driver: dict[int, list] = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        loaded = pool.map(lambda driver: load_driver_location(folder, session_key, driver, overwrite), drivers)
        for driver, rows in zip(drivers, loaded):
            by_driver[driver] = rows
            samples.extend(rows)
    center_rows = []
    if reference:
        own = by_driver.get(reference["driver_number"], [])
        center_rows = slice_window(own, reference["start"], reference["end"])
        center_path = folder / "location_centerline.json"
        if len(center_rows) < 30:
            try:
                center_rows = slice_window(
                    fetch_location(http, session_key, reference["driver_number"], reference["start"], reference["end"]),
                    reference["start"],
                    reference["end"],
                )
            except RuntimeError:
                LOG.exception("centerline failed session=%s", session_key)
        if center_rows:
            save_compact(center_path, center_rows)
    line = centerline_xy(center_rows)
    offset = arc_offset(line, corners)
    placed = place_events(events, pd.DataFrame(samples)) if samples else events.copy()
    if "x" not in placed.columns:
        placed["x"] = pd.NA
        placed["y"] = pd.NA
    packed = []
    for row in placed.itertuples(index=False):
        x = None if pd.isna(row.x) else round(float(row.x), 1)
        y = None if pd.isna(row.y) else round(float(row.y), 1)
        packed.append([
            x,
            y,
            corner_for_point(line, x, y, corners, offset),
            _int_or_none(row.lap_number),
            row.tag,
            1 if _bool(row.is_lap1) else 0,
            1 if _bool(row.is_burst) else 0,
            1 if _bool(row.is_bounce_8s) else 0,
            row.overtaking_acronym or row.overtaking_full_name,
            row.overtaken_acronym or row.overtaken_full_name,
            _int_or_none(row.position),
        ])
    on_line = sum(1 for event in packed if event[2] is not None)
    placed_n = sum(1 for event in packed if event[0] is not None)
    LOG.info(
        "session=%s %s %s centerline=%d offset=%.0f placed=%d/%d on_corner=%d",
        session_key,
        meta.get("year"),
        meta.get("circuit_short_name"),
        len(line),
        offset,
        placed_n,
        len(packed),
        on_line,
    )
    return {
        "key": session_key,
        "year": int(events["year"].iloc[0]) if not events.empty else int(meta["year"]),
        "gp": str(events["grand_prix"].iloc[0]) if not events.empty else meta.get("circuit_short_name"),
        "type": str(events["session_name"].iloc[0]) if not events.empty else meta.get("session_name"),
        "rotation": rotation,
        "centerline": line,
        "corners": corners,
        "events": packed,
    }


def write_track_data(sessions: list[dict]) -> None:
    sessions = sorted(sessions, key=lambda item: (item["year"], item["gp"], item["type"] != "Race", item["key"]))
    JS_OUT.parent.mkdir(parents=True, exist_ok=True)
    JS_OUT.write_text(
        "window.TRACK_DATA = " + json.dumps(sessions, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    LOG.info("wrote %s (%d sessions)", JS_OUT, len(sessions))


def read_existing() -> dict[int, dict]:
    if not JS_OUT.exists():
        return {}
    text = JS_OUT.read_text(encoding="utf-8").split("=", 1)[1].strip().rstrip(";")
    return {int(row["key"]): row for row in json.loads(text)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session", type=int, nargs="*", default=None)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    folders = session_folders()
    meetings = load_meetings()
    frame = pd.read_csv(CSV_PATH)
    wanted = set(args.session) if args.session else set(folders)
    keys = sorted(key for key in folders if key in wanted)
    existing = read_existing()
    with requests.Session() as http:
        http.headers.update({"Accept": "application/json", "User-Agent": "STATS401-Group17-track/1.0"})
        for index, key in enumerate(keys, start=1):
            folder, meta = folders[key]
            if key in existing and not args.overwrite:
                LOG.info("skip %s/%s session %s", index, len(keys), key)
                drop_location_cache(folder)
                continue
            events = frame.loc[frame["session_key"].astype(int).eq(key)].copy()
            if events.empty:
                LOG.warning("no overtakes for session %s", key)
                continue
            try:
                existing[key] = build_session(folder, meta, events, meetings, http, args.overwrite)
            except Exception:
                LOG.exception("session %s failed", key)
                continue
            write_track_data(list(existing.values()))
            drop_location_cache(folder)


if __name__ == "__main__":
    main()
