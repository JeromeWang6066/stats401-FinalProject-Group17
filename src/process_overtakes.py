from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW_ROOT = ROOT / "data" / "raw"
OUT_ROOT = ROOT / "data" / "processed"

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
LOG = logging.getLogger("week3-process")

EXCLUSIVE_TAG_PRIORITY = (
    "formation",
    "post_race",
    "unlap_under_sc",
    "under_sc",
    "pit",
    "retired",
    "on_track",
)
TAG_ALL_FLAGS = (
    ("formation", "is_formation"),
    ("post_race", "is_post_race_diagnostic"),
    ("unlap_under_sc", "is_unlap_under_sc"),
    ("under_sc", "is_during_sc"),
    ("retired", "is_retired"),
    ("pit", "is_pit"),
    ("pit_out", "is_pit_out"),
    ("burst", "is_burst"),
    ("lap1", "is_lap1"),
    ("bounce", "is_bounce_8s"),
    ("pit_feed_missing", "pit_feed_missing"),
    ("on_track", "is_true_on_track"),
)

# circuit_short_name → familiar GP name for frontend filters.
GRAND_PRIX_BY_CIRCUIT = {
    "Austin": "Austin",
    "Baku": "Baku",
    "Catalunya": "Barcelona",
    "Hungaroring": "Hungary",
    "Imola": "Imola",
    "Interlagos": "Sao Paulo",
    "Jeddah": "Jeddah",
    "Las Vegas": "Las Vegas",
    "Lusail": "Qatar",
    "Melbourne": "Melbourne",
    "Mexico City": "Mexico City",
    "Miami": "Miami",
    "Monte Carlo": "Monaco",
    "Montreal": "Montreal",
    "Monza": "Monza",
    "Sakhir": "Bahrain",
    "Shanghai": "Shanghai",
    "Silverstone": "Silverstone",
    "Singapore": "Singapore",
    "Spa-Francorchamps": "Spa",
    "Spielberg": "Austria",
    "Suzuka": "Suzuka",
    "Yas Marina Circuit": "Abu Dhabi",
    "Zandvoort": "Zandvoort",
}


def load_json(path: Path) -> list | dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_meeting(year_dir: Path, meeting_key: int) -> dict:
    path = year_dir / "_meetings.json"
    if not path.exists():
        return {}
    for row in load_json(path):
        if int(row.get("meeting_key", -1)) == int(meeting_key):
            return row
    return {}


def grand_prix_name(
    circuit: str,
    meeting_name: str | None = None,
    location: str | None = None,
) -> str:
    if circuit in GRAND_PRIX_BY_CIRCUIT:
        return GRAND_PRIX_BY_CIRCUIT[circuit]
    if meeting_name:
        name = str(meeting_name).strip()
        if name.endswith(" Grand Prix"):
            name = name[: -len(" Grand Prix")].strip()
        if name:
            return name
    if location:
        return str(location).strip()
    return circuit or "Unknown"


def frame(payload: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(payload)


def nearest_pit_within(times: pd.Series, event_time: pd.Timestamp, threshold_s: int = 90) -> bool:
    if times.empty or pd.isna(event_time):
        return False
    ns = times.astype("int64").to_numpy()
    target = event_time.value
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
        overtakes = overtakes.copy()
        overtakes["lap_number"] = pd.NA
        overtakes["lap_start_global"] = pd.NaT
        overtakes["lap_alignment"] = "unavailable"
        return overtakes
    x = overtakes.sort_values("date").copy()
    lap = laps[["date_start", "lap_number"]].copy()
    lap["date_start"] = pd.to_datetime(lap["date_start"], utc=True, errors="coerce")
    lap["lap_number"] = pd.to_numeric(lap["lap_number"], errors="coerce")
    lap = lap.dropna(subset=["date_start", "lap_number"])
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


def mark_bounce_pairs(frame: pd.DataFrame, window_s: float = 8) -> pd.Series:
    mask = pd.Series(False, index=frame.index)
    if frame.empty:
        return mask
    dates = frame["date"].to_numpy()
    ot = frame["overtaking_driver_number"].to_numpy()
    od = frame["overtaken_driver_number"].to_numpy()
    idx = frame.index.to_numpy()
    order = np.argsort(dates)
    dates, ot, od, idx = dates[order], ot[order], od[order], idx[order]
    n = len(dates)
    for i in range(n):
        t1 = dates[i]
        j = i + 1
        while j < n:
            dt = (dates[j] - t1) / np.timedelta64(1, "s")
            if dt > window_s:
                break
            if ot[i] == od[j] and od[i] == ot[j]:
                mask.loc[idx[i]] = True
                mask.loc[idx[j]] = True
            j += 1
    return mask


def _asof_driver_laps(overtakes: pd.DataFrame, laps: pd.DataFrame, driver_col: str, prefix: str) -> pd.DataFrame:
    out = overtakes.copy()
    out[f"{prefix}_lap"] = np.nan
    out[f"{prefix}_pit_out"] = False
    if laps.empty or overtakes.empty:
        return out
    left = overtakes.reset_index()[["index", "date", driver_col]].rename(columns={driver_col: "driver_number"})
    left["driver_number"] = pd.to_numeric(left["driver_number"], errors="coerce")
    right = laps.copy()
    right["date_start"] = pd.to_datetime(right["date_start"], utc=True, errors="coerce")
    right["driver_number"] = pd.to_numeric(right["driver_number"], errors="coerce")
    right["lap_number"] = pd.to_numeric(right["lap_number"], errors="coerce")
    if "is_pit_out_lap" not in right.columns:
        right["is_pit_out_lap"] = False
    right = right.dropna(subset=["date_start", "driver_number", "lap_number"])
    left = left.dropna(subset=["date", "driver_number"])
    if right.empty or left.empty:
        return out
    merged = pd.merge_asof(
        left.sort_values("date"),
        right.sort_values("date_start")[["driver_number", "date_start", "lap_number", "is_pit_out_lap"]],
        left_on="date",
        right_on="date_start",
        by="driver_number",
        direction="backward",
    ).set_index("index")
    out.loc[merged.index, f"{prefix}_lap"] = merged["lap_number"]
    pit_out = merged["is_pit_out_lap"].astype("boolean").fillna(False).astype(bool)
    out.loc[merged.index, f"{prefix}_pit_out"] = pit_out.to_numpy()
    return out


def attach_per_driver_laps(overtakes: pd.DataFrame, laps: pd.DataFrame) -> pd.DataFrame:
    out = _asof_driver_laps(overtakes, laps, "overtaking_driver_number", "ot")
    out = _asof_driver_laps(out, laps, "overtaken_driver_number", "od")
    out["is_pit_out"] = out["ot_pit_out"].fillna(False).astype(bool) | out["od_pit_out"].fillna(False).astype(bool)
    out["lap_delta"] = out["ot_lap"] - out["od_lap"]
    return out


def mark_formation(overtakes: pd.DataFrame, laps: pd.DataFrame) -> pd.Series:
    false = pd.Series(False, index=overtakes.index)
    if overtakes.empty or laps.empty or "date_start" not in laps.columns:
        return false
    lap = laps.copy()
    lap["date_start"] = pd.to_datetime(lap["date_start"], utc=True, errors="coerce")
    lap["lap_number"] = pd.to_numeric(lap["lap_number"], errors="coerce")
    starts = lap.loc[lap["lap_number"].eq(1), "date_start"].dropna()
    if starts.empty:
        return false
    return overtakes["date"].lt(starts.min())


def mark_retired(overtakes: pd.DataFrame, laps: pd.DataFrame, continue_after_s: float = 180) -> pd.Series:
    false = pd.Series(False, index=overtakes.index)
    if overtakes.empty or laps.empty or "date_start" not in laps.columns:
        return false
    lap = laps.copy()
    lap["date_start"] = pd.to_datetime(lap["date_start"], utc=True, errors="coerce")
    lap["driver_number"] = pd.to_numeric(lap["driver_number"], errors="coerce")
    lap = lap.dropna(subset=["date_start", "driver_number"])
    if lap.empty:
        return false
    later_exists = []
    overtaken_has_later = []
    horizon = pd.to_timedelta(continue_after_s, unit="s")
    for t, drv in zip(overtakes["date"], overtakes["overtaken_driver_number"]):
        if pd.isna(t) or pd.isna(drv):
            later_exists.append(False)
            overtaken_has_later.append(True)
            continue
        later_exists.append(bool((lap["date_start"] > t + horizon).any()))
        overtaken_has_later.append(bool(lap.loc[lap["driver_number"].eq(int(drv)), "date_start"].gt(t).any()))
    return pd.Series(later_exists, index=overtakes.index) & ~pd.Series(overtaken_has_later, index=overtakes.index)


def exclusive_tag(df: pd.DataFrame) -> pd.Series:
    tag = pd.Series("on_track", index=df.index, dtype="object")
    assigned = pd.Series(False, index=df.index)
    checks = (
        ("formation", df.get("is_formation", False)),
        ("post_race", df.get("is_post_race_diagnostic", False)),
        ("unlap_under_sc", df.get("is_unlap_under_sc", False)),
        ("under_sc", df.get("is_during_sc", False)),
        ("pit", df.get("is_pit", False)),
        ("retired", df.get("is_retired", False)),
    )
    for name, mask in checks:
        mask = mask.fillna(False).astype(bool) if isinstance(mask, pd.Series) else pd.Series(bool(mask), index=df.index)
        take = mask & ~assigned
        tag.loc[take] = name
        assigned |= take
    return tag


def compose_tag_all(df: pd.DataFrame) -> pd.Series:
    rows = []
    for _, row in df.iterrows():
        parts = [name for name, col in TAG_ALL_FLAGS if bool(row.get(col, False))]
        rows.append("|".join(parts) if parts else str(row.get("tag", "on_track")))
    return pd.Series(rows, index=df.index, dtype="string")


def apply_true_overtake_tags(overtakes: pd.DataFrame, laps: pd.DataFrame) -> pd.DataFrame:
    """Assign exclusive tag / overlapping flags. Caller must already set burst, near_pit, during_sc, post_race."""
    out = attach_per_driver_laps(overtakes, laps)
    out["is_formation"] = mark_formation(out, laps)
    out["is_retired"] = mark_retired(out, laps)
    out["is_bounce_8s"] = mark_bounce_pairs(out)
    out["is_lap1"] = pd.to_numeric(out.get("lap_number"), errors="coerce").eq(1)
    out["is_unlap_under_sc"] = out["is_during_sc"].fillna(False).astype(bool) & out["lap_delta"].abs().ge(1)
    out["is_pit"] = out["is_near_pit"].fillna(False).astype(bool) | out["is_pit_out"].fillna(False).astype(bool)
    out["tag"] = exclusive_tag(out)
    out["is_true_on_track"] = out["tag"].eq("on_track")
    out["is_candidate_true_on_track"] = out["is_true_on_track"]
    out["tag_all"] = compose_tag_all(out)
    return out


def process_session(folder: Path) -> pd.DataFrame:
    meta = load_json(folder / "session.json")
    if isinstance(meta, list):
        meta = meta[0]
    year = int(meta["year"])
    meeting_key = meta["meeting_key"]
    session_key = meta["session_key"]
    circuit = meta.get("circuit_short_name") or meta.get("location") or "Unknown"
    meeting = load_meeting(folder.parent, meeting_key)
    gp = grand_prix_name(
        circuit,
        meeting.get("meeting_name"),
        meta.get("location") or meeting.get("location"),
    )
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
    overtakes["grand_prix"] = gp
    overtakes["session_name"] = meta.get("session_name") or meta.get("session_type") or "Race"
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
    pit_feed_missing = pits.empty or "driver_number" not in pits.columns or "date" not in pits.columns
    overtakes["pit_feed_missing"] = pit_feed_missing
    if pit_feed_missing:
        overtakes["is_near_pit"] = False
    else:
        pits = pits.copy()
        pits["date"] = pd.to_datetime(pits["date"], utc=True, errors="coerce")
        pit_times = {}
        for driver_no, group in pits.dropna(subset=["date"]).groupby("driver_number"):
            pit_times[int(driver_no)] = group["date"].sort_values().reset_index(drop=True)
        empty = pd.Series(dtype="datetime64[ns, UTC]")
        overtakes["is_near_pit"] = [
            nearest_pit_within(pit_times.get(int(a), empty), t)
            or nearest_pit_within(pit_times.get(int(b), empty), t)
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
        rc = rc.copy()
        rc["date"] = pd.to_datetime(rc["date"], utc=True, errors="coerce")
        msg = rc["message"].fillna("").astype(str).str.upper() if "message" in rc.columns else pd.Series([], dtype=str)
        checkered_times = rc.loc[msg.str.contains("CHEQUERED FLAG", regex=False), "date"].dropna().tolist()
    chequered_at = min(checkered_times) if checkered_times else pd.NaT
    overtakes["is_post_race_diagnostic"] = overtakes["date"].ge(chequered_at) if pd.notna(chequered_at) else False
    overtakes = align_laps(overtakes, laps)
    return apply_true_overtake_tags(overtakes, laps)


def _summarize(df: pd.DataFrame, by: list[str]) -> pd.DataFrame:
    out = df.groupby(by, as_index=False).agg(
        events=("session_key", "size"),
        on_track=("is_true_on_track", "sum"),
        formation=("is_formation", "sum"),
        post_race=("is_post_race_diagnostic", "sum"),
        unlap_under_sc=("is_unlap_under_sc", "sum"),
        under_sc=("is_during_sc", "sum"),
        pit=("is_pit", "sum"),
        retired=("is_retired", "sum"),
        burst=("is_burst", "sum"),
        lap1=("is_lap1", "sum"),
        bounce=("is_bounce_8s", "sum"),
    )
    exclusive_counts = (
        df.groupby(by + ["tag"], dropna=False)
        .size()
        .unstack("tag", fill_value=0)
        .reset_index()
    )
    for name in EXCLUSIVE_TAG_PRIORITY:
        col = f"tag_{name}"
        if name in exclusive_counts.columns:
            exclusive_counts = exclusive_counts.rename(columns={name: col})
        else:
            exclusive_counts[col] = 0
    keep = by + [f"tag_{name}" for name in EXCLUSIVE_TAG_PRIORITY]
    out = out.merge(exclusive_counts[keep], on=by, how="left")
    out["on_track_share"] = out["on_track"] / out["events"]
    return out


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
    df = df.sort_values(["year", "grand_prix", "circuit", "date", "overtaking_driver_number", "overtaken_driver_number"]).reset_index(drop=True)
    bool_cols = [c for c in df.columns if c.startswith("is_") or c == "pit_feed_missing"]
    for c in bool_cols:
        df[c] = df[c].fillna(False).astype(bool)
    df.to_csv(OUT_ROOT / "overtakes_tagged.csv", index=False)
    _summarize(df, ["year"]).to_csv(OUT_ROOT / "tag_summary_by_year.csv", index=False)
    _summarize(df, ["year", "grand_prix", "circuit"]).to_csv(OUT_ROOT / "tag_summary_by_circuit.csv", index=False)
    edge = (
        df.groupby(
            ["year", "grand_prix", "circuit", "overtaking_driver_number", "overtaken_driver_number", "overtaking_acronym", "overtaken_acronym"],
            dropna=False,
        )
        .agg(events=("session_key", "size"), clean_events=("is_true_on_track", "sum"))
        .reset_index()
    )
    edge.to_csv(OUT_ROOT / "edge_summary.csv", index=False)
    LOG.info("saved %d total events; on_track=%d", len(df), int(df["is_true_on_track"].sum()))


if __name__ == "__main__":
    main()
