from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from process_overtakes import (
    OUT_ROOT,
    RAW_ROOT,
    ROOT,
    build_neutralized_intervals,
    grand_prix_name,
    load_json,
    load_meeting,
)
from export_lap_data import main as export_lap_data

LOG = logging.getLogger("export-frontend")
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

YEARS = (2023, 2024, 2025)
STANDINGS_URL = "https://api.jolpi.ca/ergast/f1/{year}/driverStandings.json"
RACES_URL = "https://api.jolpi.ca/ergast/f1/{year}.json?limit=100"
ROUND_STANDINGS_URL = "https://api.jolpi.ca/ergast/f1/{year}/{round}/driverStandings.json"
JS_OUT = ROOT / "js" / "data.js"
STANDINGS_CSV = OUT_ROOT / "driver_standings.csv"
ROUND_STANDINGS_CSV = OUT_ROOT / "driver_standings_by_round.csv"
UA = "stats401-group17/1.0"
BAND_KIND = {"vsc": "VSC", "sc": "SC", "safety_car": "SC", "red_flag": "RED"}
MAX_RACE_POINTS = 80


def hex_color(value: object) -> str:
    text = str(value or "").strip().lstrip("#")
    return text.upper() if text else "888888"


def tagged_frame() -> pd.DataFrame:
    path = OUT_ROOT / "overtakes_tagged.csv"
    if not path.exists():
        raise SystemExit(f"missing {path}; run src/process_overtakes.py first")
    df = pd.read_csv(path)
    df = df.dropna(subset=["overtaking_acronym", "overtaken_acronym", "tag", "grand_prix"])
    df["year"] = df["year"].astype(int)
    return df


def build_drivers(df: pd.DataFrame) -> dict:
    drivers: dict[str, dict] = {}
    sides = (
        ("overtaking_acronym", "overtaking_full_name", "overtaking_driver_number", "overtaking_team", "overtaking_team_colour"),
        ("overtaken_acronym", "overtaken_full_name", "overtaken_driver_number", "overtaken_team", "overtaken_team_colour"),
    )
    for acr_col, name_col, num_col, team_col, color_col in sides:
        chunk = df[[acr_col, name_col, num_col, team_col, color_col, "year"]].rename(
            columns={
                acr_col: "acronym",
                name_col: "name",
                num_col: "number",
                team_col: "team",
                color_col: "color",
            }
        )
        for row in chunk.itertuples(index=False):
            acr = str(row.acronym)
            rec = drivers.setdefault(acr, {"name": str(row.name), "number": int(row.number), "years": {}})
            rec["name"] = str(row.name)
            rec["number"] = int(row.number)
            rec["years"][str(int(row.year))] = {
                "team": str(row.team) if pd.notna(row.team) else "",
                "color": hex_color(row.color),
            }
    return dict(sorted(drivers.items()))


def build_edges(df: pd.DataFrame) -> list[list]:
    g = (
        df.groupby(["year", "grand_prix", "tag", "overtaking_acronym", "overtaken_acronym"], dropna=False)
        .size()
        .reset_index(name="count")
        .sort_values(["year", "grand_prix", "tag", "overtaking_acronym", "overtaken_acronym"])
    )
    return [
        [int(r.year), str(r.grand_prix), str(r.tag), str(r.overtaking_acronym), str(r.overtaken_acronym), int(r.count)]
        for r in g.itertuples(index=False)
    ]


def build_gps(df: pd.DataFrame) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for year, group in df.groupby("year"):
        out[str(int(year))] = sorted(group["grand_prix"].astype(str).unique())
    return out


def fetch_json(url: str) -> dict:
    req = Request(url, headers={"User-Agent": UA})
    with urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def session_gp(folder: Path, meta: dict) -> str:
    meeting = load_meeting(folder.parent, int(meta["meeting_key"]))
    circuit = meta.get("circuit_short_name") or meta.get("location") or "Unknown"
    return grand_prix_name(circuit, meeting.get("meeting_name"), meta.get("location") or meeting.get("location"))


def iter_race_sessions():
    folders = sorted(p for p in RAW_ROOT.glob("*/[!_]*_*/") if (p / "session.json").exists())
    rows = []
    for folder in folders:
        meta = load_json(folder / "session.json")
        if isinstance(meta, list):
            meta = meta[0]
        if str(meta.get("session_name") or "") != "Race":
            continue
        start = pd.to_datetime(meta.get("date_start"), utc=True, errors="coerce")
        rows.append({
            "folder": folder,
            "meta": meta,
            "year": int(meta["year"]),
            "grandPrix": session_gp(folder, meta),
            "date": start,
        })
    rows.sort(key=lambda row: (row["year"], row["date"] if pd.notna(row["date"]) else pd.Timestamp.max.tz_localize("UTC")))
    by_year: dict[int, int] = {}
    for row in rows:
        by_year[row["year"]] = by_year.get(row["year"], 0) + 1
        row["round"] = by_year[row["year"]]
    return rows


def build_rounds(sessions: list[dict]) -> list[dict]:
    out = []
    for row in sessions:
        date = row["date"]
        out.append({
            "year": row["year"],
            "round": row["round"],
            "grandPrix": row["grandPrix"],
            "date": "" if pd.isna(date) else date.strftime("%Y-%m-%d"),
        })
    return out


def downsample_xy(points: list[list], max_points: int = MAX_RACE_POINTS) -> list[list]:
    if len(points) <= max_points:
        return points
    step = max(1, (len(points) - 1) // (max_points - 1))
    kept = [points[i] for i in range(0, len(points), step)]
    if kept[-1] != points[-1]:
        kept.append(points[-1])
    return kept


def lap_timeline(laps: pd.DataFrame) -> tuple[list[tuple[int, pd.Timestamp, float]], int]:
    if laps.empty or "date_start" not in laps.columns or "lap_number" not in laps.columns:
        return [], 1
    df = laps.copy()
    df["date_start"] = pd.to_datetime(df["date_start"], utc=True, errors="coerce")
    df["lap_number"] = pd.to_numeric(df["lap_number"], errors="coerce")
    if "lap_duration" in df.columns:
        df["lap_duration"] = pd.to_numeric(df["lap_duration"], errors="coerce")
    else:
        df["lap_duration"] = pd.NA
    df = df.dropna(subset=["date_start", "lap_number"])
    if df.empty:
        return [], 1
    grouped = df.groupby("lap_number", as_index=True).agg(start=("date_start", "min"), dur=("lap_duration", "median"))
    grouped = grouped.sort_values("start")
    timeline = []
    for lap_no, rec in grouped.iterrows():
        dur = float(rec.dur) if pd.notna(rec.dur) and rec.dur > 5 else 90.0
        timeline.append((int(lap_no), rec.start, dur))
    max_lap = max(item[0] for item in timeline)
    return timeline, max_lap


def progress_of(timeline: list[tuple[int, pd.Timestamp, float]], times: pd.Series) -> list[float]:
    if not timeline:
        return [1.0] * len(times)
    starts = np.array([item[1].value for item in timeline], dtype=np.int64)
    laps = np.array([item[0] for item in timeline], dtype=float)
    durs = np.array([item[2] for item in timeline], dtype=float)
    values = pd.to_datetime(times, utc=True, errors="coerce").astype("int64").to_numpy()
    idx = np.searchsorted(starts, values, side="right") - 1
    out = np.ones(len(times), dtype=float)
    valid = idx >= 0
    take = idx[valid]
    elapsed = (values[valid] - starts[take]) / 1_000_000_000
    frac = np.clip(elapsed / durs[take], 0.0, 0.999)
    out[valid] = np.round(laps[take] + frac, 3)
    return out.tolist()


def build_race_bump(sessions: list[dict]) -> dict:
    payload: dict[str, dict] = {}
    for row in sessions:
        folder = row["folder"]
        meta = row["meta"]
        key = f"{row['year']}|{row['grandPrix']}"
        pos_path = folder / "position.json"
        laps_path = folder / "laps.json"
        if not pos_path.exists():
            LOG.warning("no position.json in %s", folder.name)
            continue
        pos = pd.DataFrame(load_json(pos_path) or [])
        if pos.empty or "driver_number" not in pos.columns or "date" not in pos.columns or "position" not in pos.columns:
            continue
        pos["date"] = pd.to_datetime(pos["date"], utc=True, errors="coerce")
        pos["driver_number"] = pd.to_numeric(pos["driver_number"], errors="coerce")
        pos["position"] = pd.to_numeric(pos["position"], errors="coerce")
        pos = pos.dropna(subset=["date", "driver_number", "position"]).sort_values("date")
        if pos.empty:
            continue
        laps = pd.DataFrame(load_json(laps_path) or []) if laps_path.exists() else pd.DataFrame()
        timeline, max_lap = lap_timeline(laps)
        pos["progress"] = progress_of(timeline, pos["date"])
        numbers = acronym_map(folder)
        series: dict[str, list[list]] = {}
        for driver_no, chunk in pos.groupby("driver_number"):
            acr = numbers.get(int(driver_no))
            if not acr:
                continue
            points = [[float(p), int(pos_n)] for p, pos_n in zip(chunk["progress"], chunk["position"])]
            points.sort(key=lambda item: item[0])
            if points and points[-1][0] < max_lap:
                points.append([float(max_lap), points[-1][1]])
            series[acr] = downsample_xy(points)
        bands = []
        rc_path = folder / "race_control.json"
        if rc_path.exists() and timeline:
            rc = pd.DataFrame(load_json(rc_path) or [])
            end = pd.to_datetime(meta.get("date_end"), utc=True, errors="coerce")
            intervals = build_neutralized_intervals(rc, end if pd.notna(end) else None)
            for item in intervals.itertuples(index=False):
                kind = BAND_KIND.get(str(item.kind), str(item.kind).upper())
                start_p = progress_of(timeline, pd.Series([item.start]))[0]
                end_p = progress_of(timeline, pd.Series([item.end]))[0]
                bands.append([kind, float(start_p), float(max(end_p, start_p + 0.25))])
        payload[key] = {"maxLap": int(max_lap), "bands": bands, "series": series}
        LOG.info("race bump %s drivers=%d", key, len(series))
    return payload


def fetch_jolpica_races(year: int) -> list[dict]:
    payload = fetch_json(RACES_URL.format(year=year))
    races = payload["MRData"]["RaceTable"]["Races"]
    rows = []
    for item in races:
        rows.append({
            "year": year,
            "round": int(item["round"]),
            "date": str(item.get("date") or ""),
            "raceName": str(item.get("raceName") or ""),
        })
    rows.sort(key=lambda r: r["round"])
    return rows


def match_rounds(our: list[dict], theirs: list[dict]) -> list[tuple[int, str]]:
    """Return Jolpica (round, grandPrix) pairs aligned to our calendar."""
    if len(our) == len(theirs):
        return [(item["round"], ours["grandPrix"]) for ours, item in zip(our, theirs)]
    LOG.warning("round count mismatch year=%s ours=%d jolpica=%d", our[0]["year"] if our else "?", len(our), len(theirs))
    used = set()
    paired = []
    for ours in our:
        best = None
        best_delta = None
        our_date = str(ours["date"].date()) if pd.notna(ours["date"]) else ""
        for i, item in enumerate(theirs):
            if i in used:
                continue
            delta = abs(pd.Timestamp(item["date"]) - pd.Timestamp(our_date)).days if item["date"] and our_date else 999
            if best is None or delta < best_delta:
                best = i
                best_delta = delta
        if best is None:
            continue
        used.add(best)
        paired.append((theirs[best]["round"], ours["grandPrix"]))
    return paired


def fetch_round_standings_year(year: int, pairs: list[tuple[int, str]]) -> list[dict]:
    rows = []
    for round_no, gp in pairs:
        url = ROUND_STANDINGS_URL.format(year=year, round=round_no)
        try:
            payload = fetch_json(url)
            lists = payload["MRData"]["StandingsTable"]["StandingsLists"]
        except Exception as exc:
            LOG.warning("standings fetch failed %s R%s %s: %s", year, round_no, gp, exc)
            continue
        if not lists:
            LOG.warning("empty standings %s R%s %s", year, round_no, gp)
            continue
        for item in lists[0].get("DriverStandings") or []:
            pos = item.get("position") or item.get("positionText")
            code = (item.get("Driver") or {}).get("code")
            if pos in (None, "", "-") or not code:
                continue
            rows.append({
                "year": year,
                "round": round_no,
                "grandPrix": gp,
                "acronym": str(code),
                "position": int(pos),
                "points": float(item.get("points") or 0),
            })
        LOG.info("fetched standings %s %s (%s)", year, gp, round_no)
    return rows


def load_round_standings(sessions: list[dict]) -> list[dict]:
    existing: list[dict] = []
    have_years: set[int] = set()
    if ROUND_STANDINGS_CSV.exists():
        df = pd.read_csv(ROUND_STANDINGS_CSV)
        existing = [
            {
                "year": int(r.year),
                "round": int(r.round),
                "grandPrix": str(r.grandPrix),
                "acronym": str(r.acronym),
                "position": int(r.position),
                "points": float(r.points),
            }
            for r in df.itertuples(index=False)
        ]
        have_years = {row["year"] for row in existing}
        LOG.info("round standings from %s (%d rows, years=%s)", ROUND_STANDINGS_CSV, len(existing), sorted(have_years))
    rows = list(existing)
    missing = [year for year in YEARS if year not in have_years]
    for year in missing:
        ours = [s for s in sessions if s["year"] == year]
        theirs = fetch_jolpica_races(year)
        pairs = match_rounds(ours, theirs)
        LOG.info("matching %s: ours=%d jolpica=%d pairs=%d", year, len(ours), len(theirs), len(pairs))
        part = fetch_round_standings_year(year, pairs)
        rows.extend(part)
        pd.DataFrame(rows).to_csv(ROUND_STANDINGS_CSV, index=False)
        LOG.info("wrote %s after %s (%d rows)", ROUND_STANDINGS_CSV, year, len(rows))
    return rows


def build_champ_bump(sessions: list[dict], round_rows: list[dict]) -> dict:
    order = {}
    for row in sessions:
        order.setdefault(row["year"], []).append(row["grandPrix"])
    by_year: dict[str, dict] = {}
    for year, gps in order.items():
        series: dict[str, list[list]] = {}
        for rec in round_rows:
            if rec["year"] != year:
                continue
            try:
                idx = gps.index(rec["grandPrix"])
            except ValueError:
                continue
            series.setdefault(rec["acronym"], []).append([idx, rec["position"], rec["points"]])
        for acr, points in series.items():
            points.sort(key=lambda item: item[0])
        by_year[str(year)] = {"rounds": gps, "series": series}
    return by_year


def acronym_map(folder: Path) -> dict[int, str]:
    payload = load_json(folder / "drivers.json")
    out = {}
    for row in payload:
        try:
            out[int(row["driver_number"])] = str(row["name_acronym"])
        except (KeyError, TypeError, ValueError):
            continue
    return out


def build_session_results() -> list[dict]:
    rows = []
    folders = sorted(p for p in RAW_ROOT.glob("*/[!_]*_*/") if (p / "session.json").exists())
    for folder in folders:
        meta = load_json(folder / "session.json")
        if isinstance(meta, list):
            meta = meta[0]
        name = str(meta.get("session_name") or meta.get("session_type") or "")
        if name != "Race":
            continue
        pos_path = folder / "position.json"
        if not pos_path.exists():
            LOG.warning("no position.json in %s", folder.name)
            continue
        payload = load_json(pos_path)
        if not payload:
            continue
        pos = pd.DataFrame(payload)
        if "driver_number" not in pos.columns or "date" not in pos.columns or "position" not in pos.columns:
            continue
        pos["date"] = pd.to_datetime(pos["date"], utc=True, errors="coerce")
        pos = pos.dropna(subset=["date", "driver_number", "position"])
        if pos.empty:
            continue
        pos["driver_number"] = pos["driver_number"].astype(int)
        pos["position"] = pos["position"].astype(int)
        pos = pos.sort_values("date")
        first = pos.groupby("driver_number", as_index=False).first()
        last = pos.groupby("driver_number", as_index=False).last()
        numbers = acronym_map(folder)
        gp = session_gp(folder, meta)
        year = int(meta["year"])
        for driver_no in sorted(set(first["driver_number"]).intersection(last["driver_number"])):
            acr = numbers.get(int(driver_no))
            if not acr:
                continue
            start = int(first.loc[first["driver_number"] == driver_no, "position"].iloc[0])
            end = int(last.loc[last["driver_number"] == driver_no, "position"].iloc[0])
            rows.append({
                "year": year,
                "grandPrix": gp,
                "acronym": acr,
                "startPos": start,
                "endPos": end,
            })
    rows.sort(key=lambda r: (r["year"], r["grandPrix"], r["acronym"]))
    return rows


def fetch_standings_year(year: int) -> list[dict]:
    url = STANDINGS_URL.format(year=year)
    req = Request(url, headers={"User-Agent": "stats401-group17/1.0"})
    with urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    lists = payload["MRData"]["StandingsTable"]["StandingsLists"]
    if not lists:
        raise RuntimeError(f"empty standings for {year}")
    rows = []
    for item in lists[0]["DriverStandings"]:
        rows.append({
            "year": year,
            "acronym": item["Driver"]["code"],
            "position": int(item["position"]),
            "points": float(item["points"]),
        })
    return rows


def load_standings() -> list[dict]:
    if STANDINGS_CSV.exists():
        df = pd.read_csv(STANDINGS_CSV)
        LOG.info("standings from %s (%d rows)", STANDINGS_CSV, len(df))
        return [
            {"year": int(r.year), "acronym": str(r.acronym), "position": int(r.position), "points": float(r.points)}
            for r in df.itertuples(index=False)
        ]
    rows = []
    for year in YEARS:
        part = fetch_standings_year(year)
        LOG.info("fetched %d standings for %d", len(part), year)
        rows.extend(part)
    pd.DataFrame(rows).to_csv(STANDINGS_CSV, index=False)
    LOG.info("wrote %s", STANDINGS_CSV)
    return rows


def build_meta(df: pd.DataFrame) -> dict:
    n = len(df)
    on_track = int(df["tag"].eq("on_track").sum())
    pit = int(df["tag"].eq("pit").sum())
    sessions = int(df["session_key"].nunique())
    races = int(df.loc[df["session_name"].eq("Race"), "session_key"].nunique())
    sprints = int(df.loc[df["session_name"].eq("Sprint"), "session_key"].nunique())
    return {
        "events": n,
        "onTrack": on_track,
        "onTrackShare": round(on_track / n, 4) if n else 0,
        "pit": pit,
        "sessions": sessions,
        "races": races,
        "sprints": sprints,
        "drivers": int(pd.concat([df["overtaking_acronym"], df["overtaken_acronym"]]).nunique()),
        "grandPrix": int(df["grand_prix"].nunique()),
    }


def main() -> None:
    df = tagged_frame()
    sessions = iter_race_sessions()
    round_rows = load_round_standings(sessions)
    payload = {
        "meta": build_meta(df),
        "drivers": build_drivers(df),
        "edges": build_edges(df),
        "gps": build_gps(df),
        "rounds": build_rounds(sessions),
        "sessionResults": build_session_results(),
        "standings": load_standings(),
        "champBump": build_champ_bump(sessions, round_rows),
        "raceBump": build_race_bump(sessions),
    }
    JS_OUT.parent.mkdir(parents=True, exist_ok=True)
    body = "window.APP_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    JS_OUT.write_text(body, encoding="utf-8")
    export_lap_data()
    LOG.info(
        "wrote %s (edges=%d, drivers=%d, results=%d, standings=%d, rounds=%d, raceBump=%d)",
        JS_OUT,
        len(payload["edges"]),
        len(payload["drivers"]),
        len(payload["sessionResults"]),
        len(payload["standings"]),
        len(payload["rounds"]),
        len(payload["raceBump"]),
    )


if __name__ == "__main__":
    main()
