import pandas as pd
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from process_overtakes import (
    apply_true_overtake_tags,
    build_neutralized_intervals,
    exclusive_tag,
    grand_prix_name,
)


def _events(**kwargs) -> pd.DataFrame:
    base = {
        "date": pd.Timestamp("2025-03-16T12:10:00Z"),
        "overtaking_driver_number": 1,
        "overtaken_driver_number": 2,
        "lap_number": 5,
        "is_burst": False,
        "is_near_pit": False,
        "is_during_sc": False,
        "is_post_race_diagnostic": False,
    }
    base.update(kwargs)
    if not isinstance(base["date"], list):
        return pd.DataFrame([base])
    n = len(base["date"])
    rows = []
    for i in range(n):
        row = {}
        for k, v in base.items():
            row[k] = v[i] if isinstance(v, list) else v
        rows.append(row)
    return pd.DataFrame(rows)


def _laps(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows)


def test_chequered_flag_is_not_red_flag_start():
    rc = pd.DataFrame([
        {"date": "2025-03-16T14:20:00Z", "message": "CHEQUERED FLAG", "category": "Flag", "flag": "CHEQUERED"},
        {"date": "2025-03-16T14:21:00Z", "message": "RED FLAG", "category": "Flag", "flag": "RED"},
        {"date": "2025-03-16T14:51:00Z", "message": "GREEN FLAG", "category": "Flag", "flag": "GREEN"},
    ])
    intervals = build_neutralized_intervals(rc, pd.Timestamp("2025-03-16T15:00:00Z"))
    assert len(intervals) == 1
    assert intervals.iloc[0]["kind"] == "red_flag"
    assert intervals.iloc[0]["start"] == pd.Timestamp("2025-03-16T14:21:00Z")


def test_empty_race_control():
    intervals = build_neutralized_intervals(pd.DataFrame(), pd.Timestamp("2025-01-01T00:00:00Z"))
    assert list(intervals.columns) == ["kind", "start", "end"]
    assert intervals.empty


def test_lap1_burst_is_true_on_track():
    laps = _laps([
        {"driver_number": 1, "lap_number": 1, "date_start": "2025-03-16T12:00:00Z", "is_pit_out_lap": False},
        {"driver_number": 2, "lap_number": 1, "date_start": "2025-03-16T12:00:00Z", "is_pit_out_lap": False},
        {"driver_number": 1, "lap_number": 2, "date_start": "2025-03-16T12:04:00Z", "is_pit_out_lap": False},
        {"driver_number": 2, "lap_number": 2, "date_start": "2025-03-16T12:04:00Z", "is_pit_out_lap": False},
    ])
    events = _events(
        date=pd.Timestamp("2025-03-16T12:00:08Z"),
        lap_number=1,
        is_burst=True,
    )
    out = apply_true_overtake_tags(events, laps)
    assert out.iloc[0]["tag"] == "on_track"
    assert bool(out.iloc[0]["is_true_on_track"])
    assert bool(out.iloc[0]["is_burst"])
    assert bool(out.iloc[0]["is_lap1"])
    assert "burst" in out.iloc[0]["tag_all"]
    assert "lap1" in out.iloc[0]["tag_all"]


def test_pit_window_and_pit_out_are_not_true_on_track():
    laps = _laps([
        {"driver_number": 1, "lap_number": 12, "date_start": "2025-03-16T12:09:00Z", "is_pit_out_lap": True},
        {"driver_number": 2, "lap_number": 12, "date_start": "2025-03-16T12:09:00Z", "is_pit_out_lap": False},
        {"driver_number": 1, "lap_number": 20, "date_start": "2025-03-16T12:30:00Z", "is_pit_out_lap": False},
        {"driver_number": 2, "lap_number": 20, "date_start": "2025-03-16T12:30:00Z", "is_pit_out_lap": False},
    ])
    pit_out = apply_true_overtake_tags(_events(is_near_pit=False), laps)
    assert pit_out.iloc[0]["tag"] == "pit"
    assert not bool(pit_out.iloc[0]["is_true_on_track"])
    assert bool(pit_out.iloc[0]["is_pit_out"])

    near = apply_true_overtake_tags(_events(is_near_pit=True), laps.assign(is_pit_out_lap=False))
    assert near.iloc[0]["tag"] == "pit"
    assert not bool(near.iloc[0]["is_true_on_track"])


def test_retired_overtaken_is_not_true_on_track():
    laps = _laps([
        {"driver_number": 2, "lap_number": 8, "date_start": "2025-03-16T12:09:30Z", "is_pit_out_lap": False},
        {"driver_number": 1, "lap_number": 8, "date_start": "2025-03-16T12:09:30Z", "is_pit_out_lap": False},
        {"driver_number": 1, "lap_number": 9, "date_start": "2025-03-16T12:14:00Z", "is_pit_out_lap": False},
        {"driver_number": 3, "lap_number": 9, "date_start": "2025-03-16T12:14:00Z", "is_pit_out_lap": False},
    ])
    out = apply_true_overtake_tags(_events(date=pd.Timestamp("2025-03-16T12:10:00Z")), laps)
    assert out.iloc[0]["tag"] == "retired"
    assert not bool(out.iloc[0]["is_true_on_track"])


def test_unlap_under_safety_car():
    laps = _laps([
        {"driver_number": 1, "lap_number": 20, "date_start": "2025-03-16T12:09:00Z", "is_pit_out_lap": False},
        {"driver_number": 2, "lap_number": 19, "date_start": "2025-03-16T12:09:10Z", "is_pit_out_lap": False},
        {"driver_number": 1, "lap_number": 21, "date_start": "2025-03-16T12:14:00Z", "is_pit_out_lap": False},
        {"driver_number": 2, "lap_number": 20, "date_start": "2025-03-16T12:14:20Z", "is_pit_out_lap": False},
    ])
    out = apply_true_overtake_tags(_events(is_during_sc=True), laps)
    assert out.iloc[0]["tag"] == "unlap_under_sc"
    assert not bool(out.iloc[0]["is_true_on_track"])
    assert bool(out.iloc[0]["is_unlap_under_sc"])


def test_post_race_and_formation():
    laps = _laps([
        {"driver_number": 1, "lap_number": 1, "date_start": "2025-03-16T12:00:00Z", "is_pit_out_lap": False},
        {"driver_number": 2, "lap_number": 1, "date_start": "2025-03-16T12:00:00Z", "is_pit_out_lap": False},
        {"driver_number": 1, "lap_number": 2, "date_start": "2025-03-16T12:04:00Z", "is_pit_out_lap": False},
        {"driver_number": 2, "lap_number": 2, "date_start": "2025-03-16T12:04:00Z", "is_pit_out_lap": False},
    ])
    formation = apply_true_overtake_tags(
        _events(date=pd.Timestamp("2025-03-16T11:58:00Z"), lap_number=pd.NA),
        laps,
    )
    assert formation.iloc[0]["tag"] == "formation"
    assert not bool(formation.iloc[0]["is_true_on_track"])

    post = apply_true_overtake_tags(
        _events(date=pd.Timestamp("2025-03-16T12:10:00Z"), is_post_race_diagnostic=True),
        laps,
    )
    assert post.iloc[0]["tag"] == "post_race"
    assert not bool(post.iloc[0]["is_true_on_track"])


def test_bounce_stays_on_track_when_otherwise_clean():
    laps = _laps([
        {"driver_number": 1, "lap_number": 8, "date_start": "2025-03-16T12:09:00Z", "is_pit_out_lap": False},
        {"driver_number": 2, "lap_number": 8, "date_start": "2025-03-16T12:09:00Z", "is_pit_out_lap": False},
        {"driver_number": 1, "lap_number": 20, "date_start": "2025-03-16T12:40:00Z", "is_pit_out_lap": False},
        {"driver_number": 2, "lap_number": 20, "date_start": "2025-03-16T12:40:00Z", "is_pit_out_lap": False},
    ])
    events = _events(
        date=[pd.Timestamp("2025-03-16T12:10:00Z"), pd.Timestamp("2025-03-16T12:10:04Z")],
        overtaking_driver_number=[1, 2],
        overtaken_driver_number=[2, 1],
        lap_number=8,
    )
    out = apply_true_overtake_tags(events, laps)
    assert list(out["tag"]) == ["on_track", "on_track"]
    assert out["is_bounce_8s"].all()
    assert out["is_true_on_track"].all()


def test_grand_prix_name_uses_familiar_labels():
    assert grand_prix_name("Monte Carlo") == "Monaco"
    assert grand_prix_name("Shanghai") == "Shanghai"
    assert grand_prix_name("Miami") == "Miami"
    assert grand_prix_name("Catalunya") == "Barcelona"
    assert grand_prix_name("Sakhir") == "Bahrain"
    assert grand_prix_name("Yas Marina Circuit") == "Abu Dhabi"
    assert grand_prix_name("Spa-Francorchamps") == "Spa"
    assert grand_prix_name("Lusail") == "Qatar"
    assert grand_prix_name("New Circuit", meeting_name="Foo Grand Prix") == "Foo"
    assert grand_prix_name("New Circuit", location="Bar") == "Bar"


def test_exclusive_tag_priority():
    df = pd.DataFrame({
        "is_formation": [True, False, False, False, False, False],
        "is_post_race_diagnostic": [True, True, False, False, False, False],
        "is_unlap_under_sc": [False, False, True, False, False, False],
        "is_during_sc": [False, False, True, True, False, False],
        "is_pit": [False, False, False, False, True, False],
        "is_retired": [False, False, False, False, True, True],
    })
    assert list(exclusive_tag(df)) == [
        "formation",
        "post_race",
        "unlap_under_sc",
        "under_sc",
        "pit",
        "retired",
    ]
