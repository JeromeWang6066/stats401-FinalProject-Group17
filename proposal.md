# STATS401 Final Group Project Proposal
## Group 17: What Counts as an Overtake?

Chengzhi Sun, Tianyao Wang, Jietong Zhou

## 1. Topic, Goals, and Questions

Formula 1 broadcasts treat the overtake count as a score for how good a race was. [OpenF1](https://openf1.org/docs/) publishes an `overtakes` feed that looks like that score, but a row can be an on-track pass, a pit-lane swap, or a post-race penalty, and rows can be missing. A start or restart can dump many position changes into one second.

The problem is what an OpenF1 overtake is across the 2023-2025 race seasons, and what remains after start bursts, pit-window swaps, and neutralized intervals come off. We treat position changes as a directed network over three seasons. A reader should switch the definition and see if the views still agree.

Visualization goals: a switchable definition; five views that share one filter and one selected event; a path from who, to when, to place change, to where, to whether a gap closed.

Audience: STATS401 reviewers, and F1 viewers told a season had many overtakes.

Questions: how much of the 2023-2025 feed sits in a start burst, a pit window, or a VSC / safety-car / red-flag interval; who is the net overtaking center after filtering, and whether edges pile into a few pairs; whether swaps cluster on lap number at starts and restarts; whether suspected true passes sit at particular corners; and whether a thick edge is a smooth close or a jump.

## 2. Dataset(s)

**Source.** OpenF1, unofficial timing API, free from 2023. https://openf1.org/docs/. https://api.openf1.org/v1/.

**Acquisition.** Python writes API JSON under `data/raw/`. We list every `session_type=Race` weekend in 2023-2025 via `meetings` and `sessions`, then pull `overtakes`, `drivers`, `pit`, `race_control`, `laps`, and `position` by `session_key`. Views 4 and 5 add `location` and `intervals`, cut per session.

**Processing.** Three tags on every race: `burst` (3+ swaps in one second), `near_pit` (either driver pitted within 90 seconds), `during_sc` (VSC / safety-car / red-flag window from `race_control`). The rest are `true_on_track`. Times map onto laps via `laps.date_start`. Join drivers on `driver_number`; year and circuit on `meeting_key` / `session_key`. Trap: `CHEQUERED FLAG` contains the letters `RED FLAG`.

**Size.** Three seasons, on the order of seventy races. Swap events should sit in the thousands, plus drivers, pits, race-control, position, and laps. `location` (~3.7 Hz) and `intervals` (~4 s) stay session-scoped.

**Attributes.** Overtaking and overtaken driver, timestamp, position; acronym and team colour; pit time; race-control flag and message; lap start; year and circuit; later, `location` x/y and `intervals` gap.

## 3. Analysis and Visualization Methods

Python 3 for fetch, joins, and tags. D3.js v7 for the charts. One HTML site, GitHub Pages.

Analysis is labeling plus aggregation: tag shares by season and circuit, then directed edge weights under each filter. Outliers are same-second bursts, pit-window jumps, and edges that vanish under a tighter filter.

Five techniques, different idioms, shared state: force-directed network; lap-number event strip; bump chart; spatial track map; short gap series. One path, not five separate charts.

User tasks: comparison under three definitions; trend identification of timing clusters; filtering by year, circuit, tag, and edge weight; exploration of a driver or pair; relationship discovery; outlier detection.

## 4. Visualization Sketches or References

1. **Overtake network.** Force-directed graph (the complex idiom). Reference: team-coloured driver networks in race-analytics write-ups. Shows whether 2023-2025 overtaking is a few rivalries or a smear after filtering.
2. **Lap-number event strip.** Jittered points with neutralization bands. Reference: sports event-strip plots, x as lap. Shows whether swaps cluster at starts and restarts across seasons.
3. **Bump chart.** Step lines of position against lap or race order. Reference: election bump charts. Checks whether a net overtaking center also gained places.
4. **Track map.** Spatial path from `location` x/y with event dots. Reference: FastF1 and MultiViewer circuit plots. Separates "early-lap cluster" from "Turn 1."
5. **Short gap series.** `intervals` around one selected swap. Reference: broadcast gap tape. A smooth close through zero looks like a pass; a step looks like bookkeeping.

## 5. Group Roles and Responsibilities

Members: Chengzhi Sun, Tianyao Wang, and Jietong Zhou.

Chengzhi Sun: data acquisition; data cleaning and processing; data analysis.

Tianyao Wang and Jietong Zhou: visualization design; D3.js implementation; interaction design; interface / web development.

All three: testing; documentation; presentation preparation. Every member should still understand the tags and the five-view story.

## 6. Interim Presentation Deliverables

We will open the GitHub Page and show:

- acquisition and cleaning: 2023-2025 race JSON (`overtakes`, `pit`, `race_control`, `laps`, `position`), tagging, notes on missing sessions;
- initial exploration: tag shares by year and circuit;
- refined questions and goals: the questions above, tightened if the counts force a change;
- designs, prototypes, and initial D3: three working views on the multi-race table (network, lap strip, bump), with year / circuit / definition filters; views 4 and 5 can still be wireframes;
- Dataset, Visualizations, Interaction plan, and Evaluation plan (ask classmates to find one true pass and one fake cluster, and note which filter they used).

## 7. Timeline and Milestones

| Week | Milestone | Tasks | Responsible Member(s) | Expected Output |
|---|---|---|---|---|
| Week 2 | Project Definition | Lock topic, goals, questions; this file; agree roles | All | `proposal.md` |
| Week 3 | Data Preparation | Pull 2023-2025 race endpoints; tagging; lap alignment | Chengzhi Sun | raw + tagged tables |
| Week 4 | Visualization Design | Freeze encodings; five-view mockups | Tianyao Wang, Jietong Zhou | design notes; page shell |
| Week 5 | Interim Prototype | Three D3 views on the multi-race table | Tianyao Wang, Jietong Zhou; Chengzhi Sun (dataset page) | GitHub Page |
| Week 6 | Implementation & Refinement | `location` slices; `intervals` drill-down; five interactions | Tianyao Wang, Jietong Zhou | five-view draft |
| Week 7 | Final Integration | Report (~1500 words), poster, Pages publish | All | site + report + poster + code |
