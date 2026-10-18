# What counts as an overtake?

STATS401 Final Project, Group 17. Chengzhi Sun, Tianyao Wang, Jietong Zhou.

The project asks what the OpenF1 overtakes feed actually counts across the 2023, 2024, and 2025 Formula 1 seasons. A row in the feed can be a pass on track, a pit stop, a retirement, a reshuffle behind a safety car, or a booking entry made after the chequered flag. Five D3 views let a reader change the definition and watch which conclusions survive.

## Deliverables and where to find them

| Deliverable | Location |
| --- | --- |
| Published site | https://jeromewang6066.github.io/stats401-FinalProject-Group17/ (served from `index.html`) |
| Source datasets | `data/raw/` (8 JSON files per session, plus `data/raw/_circuit_info/` and `data/manifests/race_sessions.json`) |
| Cleaned and processed datasets | `data/processed/` (6 CSV files; the main event table is `overtakes_tagged.csv`) |
| Data collection code | `src/fetch_openf1.py` |
| Data cleaning and analysis code | `src/process_overtakes.py` |
| Export code for the views | `src/export_frontend.py`, `src/export_lap_data.py`, `src/export_donut_data.py`, `src/build_track_map.py` |
| Tests | `tests/test_processing.py`, `tests/test_track_map.py` |
| Complete visualization source | `index.html`, `js/`, `css/style.css` |
| Final report | `final-report_1018.docx` |
| Poster | `stats401-group17-academic-poster-A1.pdf` |
| Additional documentation | `Dataset.md`, `proposal.md`, `processed-overtake-data.html`, `track-map-requirements.md`, this file |

Supporting files that are not part of the submission package: `final.html` keeps the five views but still carries the interim-check-in wording, and `final-report.docx` is an earlier draft of the report. `interim.html` is the archived interim page with four views.

## Pages in the repository

| File | Contents |
| --- | --- |
| `index.html` | The submitted site. Five views plus the narrative sections: questions, data, reading the set, limits, what to take from it, roles |
| `interim.html` | Interim check-in page with four views: network, lap chart, bump, track map |
| `final.html` | Same five views as `index.html` with the interim section headings |
| `processed-overtake-data.html` | Field notes on the tagged event table |
| `overtake-network.html` | Early standalone network prototype |

The live site needs no build step. `index.html` loads D3 v7 from a CDN and reads static JSON from `js/`.

To run it locally, serve the folder over HTTP so the scripts load:

```bash
python3 -m http.server 8766
```

Then open `http://127.0.0.1:8766/index.html`.

## Data

Source: [OpenF1](https://openf1.org/docs/), the unofficial timing API that has been free since 2023 (`https://api.openf1.org/v1`).

`src/fetch_openf1.py` enumerates every session with `session_type=Race` in the requested seasons and writes one folder per session under `data/raw/<year>/<circuit>_<session_key>/`. Each folder holds `session.json`, `overtakes.json`, `drivers.json`, `pit.json`, `race_control.json`, `laps.json`, `position.json`, and `location_centerline.json`. The meeting list is written to `data/manifests/race_sessions.json`.

The tracked copy covers 88 sessions: 70 races and 18 sprints across 24 grands prix. Total size is about 79 MB. Standings come from Jolpica in `src/export_frontend.py`, and corner data come from each meeting's `circuit_info_url`, cached under `data/raw/_circuit_info/`.

The pipeline converts timestamps to UTC and drops rows whose event time cannot be parsed: 19,322 raw rows become 19,303 timestamped events. Each row is joined to the driver table twice, once for the overtaking car and once for the overtaken car.

Lap assignment matches each event to the most recent lap start, using the earliest start across drivers and a five minute tolerance. That covers 19,133 events (99.1%). The other 170 keep no lap and are excluded from the lap bars.

## How a row is tagged

Four flags mark conditions that make a swap unlikely to be a plain pass:

- `burst`: at least three overtakes in the same second of one session.
- `near_pit`: either driver pitted within 90 seconds of the event.
- `during_sc`: the event falls inside a virtual safety car, safety car, or red flag interval built from race control messages.
- `post_race_diagnostic`: the event is at or after the chequered flag.

The parser needed three text cases handled explicitly. The chequered flag string contains the substring `RED FLAG`, so a naive test would start a red flag at the end of the race. Every virtual safety car message contains `SAFETY CAR`, so a substring test would open a safety car that never happened. A red flag is closed by a green flag, a green light, or a message that the race will resume, and a red flag start closes any open virtual safety car or safety car. Each case has a test.

Every row then receives one exclusive tag, applied in this order: `formation`, `post_race`, `unlap_under_sc`, `under_sc`, `pit`, `retired`, `on_track`. The order matters because the flags overlap and the composition ring needs slices that add to 100%. Same-second bursts stay inside `on_track` and remain available as a separate flag, because a burst on the opening lap is usually genuine passing. The overlapping flags are also kept as a `tag_all` string.

Tag totals in `overtakes_tagged.csv`:

| Tag | Rows | Share |
| --- | --- | --- |
| `pit` | 8,909 | 46.2% |
| `on_track` | 8,351 | 43.3% |
| `under_sc` | 934 | 4.8% |
| `retired` | 740 | 3.8% |
| `post_race` | 297 | 1.5% |
| `formation` | 65 | 0.3% |
| `unlap_under_sc` | 7 | 0.04% |

Stricter variants of the same definition are available in the processed table: a rule that also demoted bursts leaves 5,701 candidates (29.5%). `Dataset.md` describes the earlier version of this rule.

## Rebuilding the data

Python 3 with `pandas`, `numpy`, and `requests`. Run the steps from the repository root in this order.

```bash
pip install pandas numpy requests pytest

python3 src/fetch_openf1.py --years 2023 2024 2025
python3 src/process_overtakes.py
python3 src/export_frontend.py
python3 src/export_donut_data.py
python3 src/build_track_map.py
```

What each step writes:

| Script | Output |
| --- | --- |
| `fetch_openf1.py` | `data/raw/`, `data/manifests/race_sessions.json` |
| `process_overtakes.py` | `data/processed/overtakes_tagged.csv` and the three summary CSVs |
| `export_frontend.py` | `js/data.js`, `js/lap_data.js` (it calls the lap exporter) |
| `export_donut_data.py` | `js/donut_data.js` |
| `build_track_map.py` | `js/track_data.js`, and circuit info under `data/raw/_circuit_info/` |

`fetch_openf1.py` respects the free tier limit with a minimum interval between requests, so a full refetch takes a long time. `process_overtakes.py` rebuilds every session. `build_track_map.py` accepts `--session`, `--overwrite`, and uses cached circuit info when it exists.

`export_frontend.py` queries Jolpica for driver standings, so that step needs network access. The others read local files.

Note on dependencies: `.gitignore` currently lists `requirements.txt` and `run_data_extraction.sh`, and neither file is in the repository. The install line above is the dependency list.

## The five views

1. **Who passes whom.** Force-directed network. Nodes are drivers, sized by net overtakes and coloured by team. Edges are pairs, with width and colour scaled to the pairs currently drawn. Filters: season, one or many grands prix, swap type, minimum exchange count. In 2024 the view holds 2,551 passes over 230 pairs at the default threshold of two.
2. **When the swaps happen.** Squares on a lap axis for one race or sprint, with raw and true-pass counts on separate rows and bands for each neutralized period. Hover gives the two drivers, lap, position, and tag.
3. **Did they gain places?** Bump chart. Season championship rank after each round, or one race with laps on the x-axis. Range controls for all, points, top five, and top ten. In 2024 Hamilton had the largest net at 51 and finished seventh with no rank change; Gasly was minus 10 and gained eight places.
4. **Where on the circuit.** One racing lap from `location` samples with each swap placed at the overtaking car's coordinates. Corner numbers separate an early-lap cluster from turn 1. Tag chips, a lap slider, zoom and pan.
5. **What share is a pass.** Ring of the seven tags for a session or a season, with the swap count and pass share in the centre. Clicking a slice applies that tag to the network and the map. The pass slice swaps in lap-one, burst, and bounce counts. Changing the session moves the other four views onto that race.

A Team and Driver selection under the navigation applies to all five views at once. Team names resolve against the year of each chart, so AlphaTauri and RB stay separate, as do Alfa Romeo and Kick Sauber. A driver list opened after a team is selected shows only drivers who raced under that name in the three seasons.

## Tests

```bash
python3 -m pytest tests -q
```

19 tests: 14 cover the race control parser and the tagging rules, 5 cover the track map geometry.

## Known limits

The exclusive tag discards overlap, so a swap inside a pit window that is also a same-second burst appears only in the pit slice. Under a team or driver selection the ring drops swaps without a lap number and does not expand the burst categories. Edge width is relative to the marks on screen, so a heavy edge in a one-race filter does not represent the same count as a heavy edge across a season. Lap assignment uses a global lap start, which can shift a lap number after a red-flag restart.

The lap chart and the bump chart disagree on a small number of intervals, for two reasons. Times before the first recorded lap of a session are pinned to lap 1 on the bump but clamped to the first lap present in `laps.json` on the lap chart, which shows up in the 2025 Miami virtual safety car period and the 2024 Suzuka red flag. The bump also enforces a minimum band width of 0.25 laps, so a short period can look wider there than on the lap chart. Both are display differences, not differences in the tagged data.

No classroom evaluation of the site has been run.

`js/donut_data.js` and `js/track_data.js` were exported before the neutralized-period fix. Rebuilding them with `export_donut_data.py` and `build_track_map.py` brings the 2024 Sao Paulo ring from 74 to 105 on-track swaps, which is the figure the report quotes.

## Roles

Chengzhi Sun built the acquisition pipeline, the tagging logic, the neutralized-period parser, and the tests, and produced the processed tables. Tianyao Wang built the network and the bump chart. Jietong Zhou built the lap chart and the composition ring. Wang and Zhou built the track map together, along with the shared team and driver selection. All three tested the site and prepared the report, poster, and presentation.
