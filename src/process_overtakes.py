from __future__ import annotations
import json
import logging
from pathlib import Path
from typing import Iterable
import pandas as pd
ROOT = Path(__file__).resolve().parents[1]
RAW_ROOT = ROOT / "data" / "raw"
OUT_ROOT = ROOT / "data" / "processed"
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
LOG = logging.getLogger("week3-process")
def load_json(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))
def frame(payload: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(payload)
def make_session_meta(folder: Path) -> dict:
    return load_json(folder / "session.json")[0] if isinstance(load_json(folder / "session.json"), list) else load_json(folder / "session.json")
def nearest_pit_within(times: pd.Series, event_time: pd.Timestamp, threshold_s: int = 90) -> bool:
    if times.empty or pd.isna(event_time):
        return False
    ns = times.astype("int64").to_numpy()
    target = event_time.value
    import numpy as np
    i = int(np.searchsorted(ns, target))
    candidates = []
    if i < len(ns):
        candidates.append(abs(ns[i] - target))
    if i > 0:
        candidates.append(abs(ns[i - 1] - target))
    return bool(candidates and min(candidates) <= threshold_s * 1_000_000_000)
def build_neutralized_intervals(rc: pd.DataFrame, session_end: pd.Timestamp | None) -> pd.DataFrame:
    if rc.empty:
        return pd.DataFrame(columns=["kind", "start", "end"])
    rc = rc.copy()
    rc["date"] = pd.to_datetime(rc["date"], utc=True, errors="coerce")
    rc = rc.dropna(subset=["date"]).sort_values("date")
    states: dict[str, pd.Timestamp | None] = {"vsc": None, "sc": None, "red_flag": None}
    intervals: list[tuple[str, pd.Timestamp, pd.Timestamp]] = []
    def add(kind: str, start: pd.Timestamp, end: pd.Timestamp) -> None:
        if end > start:
            intervals.append((kind, start, end))
    for row in rc.itertuples(index=False):
        msg = str(getattr(row, "message", "") or "").upper().strip()
        category = str(getattr(row, "category", "") or "").upper().strip()
        flag = str(getattr(row, "flag", "") or "").upper().strip()
        t = row.date
        is_vsc_start = "VIRTUAL SAFETY CAR" in msg and ("DEPLOY" in msg or "DEPLOYED" in msg)
        is_vsc_end = "VIRTUAL SAFETY CAR" in msg and ("ENDING" in msg or "ENDED" in msg)
        if is_vsc_start and states["vsc"] is None:
            states["vsc"] = t
        elif is_vsc_end and states["vsc"] is not None:
            add("vsc", states["vsc"], t)
            states["vsc"] = None
        is_sc_start = ("SAFETY CAR" in msg and "DEPLOY" in msg) or (category == "SAFETYCAR" and "IN THIS LAP" not in msg)
        is_sc_end = "SAFETY CAR" in msg and ("IN THIS LAP" in msg or "ENDING" in msg)
        if is_sc_start and states["sc"] is None:
            states["sc"] = t
        elif is_sc_end and states["sc"] is not None:
            add("safety_car", states["sc"], t)
            states["sc"] = None
        is_red_start = "RED FLAG" in msg and "CHEQUERED FLAG" not in msg
        is_red_end = (
            "GREEN FLAG" in msg
            or "GREEN LIGHT" in msg
            or "SESSION WILL RESUME" in msg
            or "SESSION RESUMED" in msg
        )
        if is_red_start and states["red_flag"] is None:
            states["red_flag"] = t
        elif is_red_end and states["red_flag"] is not None:
            add("red_flag", states["red_flag"], t)
            states["red_flag"] = None
    end_default = session_end if session_end is not None else pd.Timestamp.max.tz_localize("UTC")
    for kind, start in states.items():
        if start is not None:
            add(kind, start, end_default)
    if not intervals:
        return pd.DataFrame(columns=["kind", "start", "end"])
    return pd.DataFrame(intervals, columns=["kind", "start", "end"])
def mark_in_intervals(times: pd.Series, intervals: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    during = pd.Series(False, index=times.index)
    kind = pd.Series("", index=times.index, dtype="string")
    for row in intervals.itertuples(index=False):
        mask = times.ge(row.start) & times.le(row.end)
        during = during | mask
        kind.loc[mask] = row.kind
    return during, kind
def align_laps(overtakes: pd.DataFrame, laps: pd.DataFrame) -> pd.DataFrame:
    if overtakes.empty:
        return overtakes
    if laps.empty or "date_start" not in laps.columns:
        overtakes["lap_number"] = pd.NA
        overtakes["lap_alignment"] = "unavailable"
        return overtakes
    x = overtakes.sort_values("date").copy()
    lap = laps[["date_start", "lap_number"]].copy()
    lap["date_start"] = pd.to_datetime(lap["date_start"], utc=True, errors="coerce")
    lap = lap.dropna(subset=["date_start", "lap_number"])
    # date_start is approximate and duplicated for drivers; use the earliest start
    # time in each lap as the session-level lap boundary.
    lap = lap.groupby("lap_number", as_index=False)["date_start"].min().sort_values("date_start")
    x["date"] = pd.to_datetime(x["date"], utc=True, errors="coerce")
    x = pd.merge_asof(
        x,
        lap.rename(columns={"date_start": "lap_start_global"}),
        left_on="date",
        right_on="lap_start_global",
        direction="backward",
        tolerance=pd.Timedelta("5min"),
    )
    x["lap_alignment"] = x["lap_start_global"].notna().map({True: "matched", False: "unavailable"})
    return x
def process_session(folder: Path) -> pd.DataFrame:
    meta = load_json(folder / "session.json")
    if isinstance(meta, list):
        meta = meta[0]
    year = int(meta["year"])
    meeting_key = meta["meeting_key"]
    session_key = meta["session_key"]
    circuit = meta.get("circuit_short_name") or meta.get("location") or "Unknown"
    overtakes = frame(load_json(folder / "overtakes.json"))
    if overtakes.empty:
        return pd.DataFrame()
    drivers = frame(load_json(folder / "drivers.json"))
    pits = frame(load_json(folder / "pit.json"))
    rc = frame(load_json(folder / "race_control.json"))
    laps = frame(load_json(folder / "laps.json"))
    overtakes["date"] = pd.to_datetime(overtakes["date"], utc=True, errors="coerce")
    overtakes = overtakes.dropna(subset=["date"]).copy()
    overtakes["year"] = year
    overtakes["circuit"] = circuit
    overtakes["meeting_key"] = meeting_key
    overtakes["session_key"] = session_key
    dcols = [c for c in ["driver_number", "name_acronym", "team_name", "team_colour", "full_name"] if c in drivers.columns]
    d = drivers[dcols].drop_duplicates("driver_number") if dcols else pd.DataFrame()
    if not d.empty:
        d1 = d.rename(columns={
            "driver_number": "overtaking_driver_number",
            "name_acronym": "overtaking_acronym",
            "team_name": "overtaking_team",
            "team_colour": "overtaking_team_colour",
            "full_name": "overtaking_full_name",
        })
        d2 = d.rename(columns={
            "driver_number": "overtaken_driver_number",
            "name_acronym": "overtaken_acronym",
            "team_name": "overtaken_team",
            "team_colour": "overtaken_team_colour",
            "full_name": "overtaken_full_name",
        })
        overtakes = overtakes.merge(d1, on="overtaking_driver_number", how="left")
        overtakes = overtakes.merge(d2, on="overtaken_driver_number", how="left")
    overtakes["second_bucket"] = overtakes["date"].dt.floor("s")
    counts = overtakes.groupby(["session_key", "second_bucket"], dropna=False).size().rename("events_in_second")
    overtakes = overtakes.join(counts, on=["session_key", "second_bucket"])
    overtakes["is_burst"] = overtakes["events_in_second"].ge(3)
    pits["date"] = pd.to_datetime(pits.get("date"), utc=True, errors="coerce") if "date" in pits.columns else pd.NaT
    pit_times = {}
    if not pits.empty and "driver_number" in pits.columns:
        for driver_no, group in pits.dropna(subset=["date"]).groupby("driver_number"):
            pit_times[int(driver_no)] = group["date"].sort_values().reset_index(drop=True)
    overtakes["is_near_pit"] = [
        nearest_pit_within(pit_times.get(int(a), pd.Series(dtype="datetime64[ns, UTC]")), t)
        or nearest_pit_within(pit_times.get(int(b), pd.Series(dtype="datetime64[ns, UTC]")), t)
        for a, b, t in zip(
            overtakes["overtaking_driver_number"],
            overtakes["overtaken_driver_number"],
            overtakes["date"],
        )
    ]
    race_end = pd.to_datetime(meta.get("date_end"), utc=True, errors="coerce") if meta.get("date_end") else None
    intervals = build_neutralized_intervals(rc, race_end)
    during_sc, neutral_kind = mark_in_intervals(overtakes["date"], intervals)
    overtakes["is_during_sc"] = during_sc
    overtakes["neutralized_kind"] = neutral_kind
    checkered_times = []
    if not rc.empty:
        rc["date"] = pd.to_datetime(rc["date"], utc=True, errors="coerce")
        msg = rc["message"].fillna("").astype(str).str.upper() if "message" in rc.columns else pd.Series([], dtype=str)
        checkered_times = rc.loc[msg.str.contains("CHEQUERED FLAG", regex=False), "date"].dropna().tolist()
    chequered_at = min(checkered_times) if checkered_times else pd.NaT
    overtakes["is_post_race_diagnostic"] = overtakes["date"].ge(chequered_at) if pd.notna(chequered_at) else False
    overtakes = align_laps(overtakes, laps)
    overtakes["is_candidate_true_on_track"] = ~(
        overtakes["is_burst"] | overtakes["is_near_pit"] | overtakes["is_during_sc"] | overtakes["is_post_race_diagnostic"]
    )
    overtakes["tag"] = "true_on_track"
    overtakes.loc[overtakes["is_during_sc"], "tag"] = "during_sc"
    overtakes.loc[overtakes["is_near_pit"], "tag"] = "near_pit"
    overtakes.loc[overtakes["is_burst"], "tag"] = "burst"
    overtakes["tag_all"] = overtakes.apply(
        lambda r: "|".join([
            x for x, flag in [
                ("burst", r["is_burst"]),
                ("near_pit", r["is_near_pit"]),
                ("during_sc", r["is_during_sc"]),
                ("post_race", r["is_post_race_diagnostic"]),
            ] if bool(flag)
        ]) or "true_on_track",
        axis=1,
    )
    return overtakes

def main() -> None:
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    session_folders = sorted((p for p in RAW_ROOT.glob("*/[!_]*_*/") if (p / "session.json").exists()))
    if not session_folders:
        raise SystemExit("No raw sessions found. Run src/fetch_openf1.py first.")
    pieces = []
    for folder in session_folders:
        try:
            x = process_session(folder)
            if not x.empty:
                pieces.append(x)
            LOG.info("processed %s: %d overtake rows", folder.name, len(x))
        except Exception:
            LOG.exception("failed session %s", folder)
            raise
    df = pd.concat(pieces, ignore_index=True)
    df = df.sort_values(["year", "circuit", "date", "overtaking_driver_number", "overtaken_driver_number"]).reset_index(drop=True)
    bool_cols = [c for c in df.columns if c.startswith("is_")]
    for c in bool_cols:
        df[c] = df[c].astype(bool)
    df.to_csv(OUT_ROOT / "overtakes_tagged.csv", index=False)
    tags = (
        df.groupby("year", as_index=False)
          .agg(events=("session_key", "size"), burst=("is_burst", "sum"), near_pit=("is_near_pit", "sum"), during_sc=("is_during_sc", "sum"), post_race=("is_post_race_diagnostic", "sum"), clean_candidate=("is_candidate_true_on_track", "sum"))
    )
    for col in ["burst", "near_pit", "during_sc", "post_race", "clean_candidate"]:
        tags[f"{col}_share"] = tags[col] / tags["events"]
    tags.to_csv(OUT_ROOT / "tag_summary_by_year.csv", index=False)
    by_circuit = (
        df.groupby(["year", "circuit"], as_index=False)
          .agg(events=("session_key", "size"), burst=("is_burst", "sum"), near_pit=("is_near_pit", "sum"), during_sc=("is_during_sc", "sum"), post_race=("is_post_race_diagnostic", "sum"), clean_candidate=("is_candidate_true_on_track", "sum"))
    )
    for col in ["burst", "near_pit", "during_sc", "post_race", "clean_candidate"]:
        by_circuit[f"{col}_share"] = by_circuit[col] / by_circuit["events"]
    by_circuit.to_csv(OUT_ROOT / "tag_summary_by_circuit.csv", index=False)
    edge = (
        df.groupby(["year", "circuit", "overtaking_driver_number", "overtaken_driver_number", "overtaking_acronym", "overtaken_acronym"], dropna=False)
          .agg(events=("session_key", "size"), clean_events=("is_candidate_true_on_track", "sum"))
          .reset_index()
    )
    edge.to_csv(OUT_ROOT / "edge_summary.csv", index=False)
    LOG.info("saved %d total events", len(df))
if __name__ == "__main__":
    main()
