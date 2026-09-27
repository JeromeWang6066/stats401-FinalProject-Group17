import pandas as pd
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from build_track_map import (
    arc_offset,
    assign_corner,
    choose_reference_lap,
    corner_for_point,
    place_events,
    project_to_polyline,
)


def _lap(driver, lap, start, duration=80.0, pit=False):
    return {
        "driver_number": driver,
        "lap_number": lap,
        "date_start": start,
        "lap_duration": duration,
        "is_pit_out_lap": pit,
    }


def test_reference_lap_skips_lap1_and_picks_the_busiest_driver():
    laps = []
    for lap, start in ((1, "2024-11-03T16:00:00Z"), (2, "2024-11-03T16:02:00Z"), (3, "2024-11-03T16:03:20Z")):
        laps.append(_lap(10, lap, start))
    for lap in range(1, 7):
        laps.append(_lap(11, lap, f"2024-11-03T16:{lap:02d}:00Z"))
    laps.append(_lap(11, 7, "2024-11-03T16:08:00Z", pit=True, duration=None))
    chosen = choose_reference_lap(laps)
    assert chosen["driver_number"] == 11
    assert chosen["lap_number"] == 4
    assert chosen["start"].endswith("16:04:00Z")
    assert chosen["end"].endswith("16:05:00Z")


def test_reference_lap_needs_the_next_start():
    laps = [
        _lap(1, 2, "2024-11-03T16:02:00Z"),
        _lap(1, 3, None),
    ]
    assert choose_reference_lap(laps) is None


def test_place_events_uses_the_overtaking_driver_within_one_second():
    base = pd.Timestamp("2024-11-03T16:00:00Z")
    events = pd.DataFrame([
        {"date": base + pd.Timedelta(seconds=0.15), "overtaking_driver_number": 1},
        {"date": base + pd.Timedelta(seconds=5), "overtaking_driver_number": 1},
        {"date": base + pd.Timedelta(seconds=0.15), "overtaking_driver_number": 2},
    ])
    locations = pd.DataFrame([
        {"date": base, "driver_number": 1, "x": 0, "y": 0},
        {"date": base + pd.Timedelta(seconds=0.2), "driver_number": 1, "x": 5, "y": 1},
        {"date": base + pd.Timedelta(seconds=0.15), "driver_number": 2, "x": 100, "y": 100},
    ])
    placed = place_events(events, locations)
    assert placed["x"].fillna(-1).tolist() == [5, -1, 100]
    assert placed.iloc[0]["y"] == 1


def test_project_and_corner_assignment():
    line = [[0, 0], [10, 0], [10, 10]]
    dist, arc = project_to_polyline(line, 5, 3)
    assert dist == 3
    assert arc == 5
    dist, arc = project_to_polyline(line, 10, 5)
    assert dist == 0
    assert arc == 15
    corners = [{"number": 1, "length": 0}, {"number": 2, "length": 10}]
    assert assign_corner(0, 9, corners) == 2
    assert assign_corner(500, 9, corners) is None


def test_arc_offset_lines_up_corner_lengths():
    line = [[i, 0] for i in range(0, 101, 10)]
    corners = [{"number": 1, "x": 50, "y": 0, "length": 40}]
    assert arc_offset(line, corners) == 10
    assert corner_for_point(line, 50, 0, corners, arc_offset(line, corners)) == 1
    assert corner_for_point(line, 50, 400, corners, 10) is None
