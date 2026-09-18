## 1. Dataset

### Raw Dataset

We use historical Formula 1 Race-session data from the OpenF1 API, covering the 2023–2025 seasons. For each race, we collected **overtake events, driver information, pit stops, race-control messages, lap timing, and car positions**. The overtake records provide the main event information, while the other datasets provide contextual information for determining whether an event represents a genuine on-track pass. Raw data are stored separately by season, circuit, and session to preserve the original records.

### Processed Dataset and Data Cleaning

We combined the raw data into an event-level dataset, `overtakes_tagged.csv`, with additional driver, team, timing, lap, and contextual information. The main processing steps are:

1. **Driver enrichment:** Joined overtake records with driver information to add driver names, abbreviations, teams, and team colors.

2. **Burst detection:** Grouped events by second within each race and flagged seconds containing at least three overtakes as `burst`, capturing rapid position exchanges.

3. **Pit-window detection:** Compared overtake times with pit-stop times for both drivers. Events within ±90 seconds of a relevant pit stop were tagged as `near_pit`.

4. **Neutralized periods:** Parsed race-control messages to identify Safety Car, VSC, and red-flag periods. Overtakes within these intervals were tagged as `during_sc`.

5. **Post-race events:** Identified events occurring at or after the chequered flag as `post_race_diagnostic` to separate possible post-race bookkeeping from on-track events.

6. **Lap alignment:** Matched each overtake with its corresponding lap using lap-start timestamps.

The processed dataset retains both the individual classification indicators and a combined tag, allowing overlapping conditions to be examined while providing a consistent dataset for subsequent analysis and visualization.