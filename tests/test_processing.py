import pandas as pd
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from process_overtakes import build_neutralized_intervals


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
