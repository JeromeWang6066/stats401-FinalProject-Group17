window.SessionMix = (function () {
  const TAGS = [
    ["on_track", "True pass", "#e14545", "Both cars swap on track during a live race. Lap 1, bursts, and bounce-backs still count."],
    ["pit", "Pit", "#9295a2", "Either car is within 90 seconds of a pit stop, or the swap is a pit exit."],
    ["retired", "Retired", "#d6d3d1", "The overtaken car stops being timed, so the cars behind inherit the place."],
    ["under_sc", "Neutralized", "#eab308", "The swap falls inside a VSC, safety-car, or red-flag window."],
    ["unlap_under_sc", "Unlapping", "#f97316", "A car unlaps itself during a neutralized window."],
    ["formation", "Formation", "#67e8f9", "The swap is on the formation lap, before the start."],
    ["post_race", "Post-race", "#c084fc", "The swap is recorded after the chequered flag."],
  ];
  const ALL_IDS = TAGS.map(([id]) => id);
  const DEFAULT_KEY = "9636";
  const OUTER = 112;
  const INNER = OUTER * 0.55;

  let year = 2024;
  let gp = "";
  let sessionKey = DEFAULT_KEY;
  let scope = "session";
  let selected = "";
  let expanded = false;
  let syncing = false;
  let drawToken = 0;

  function reduceMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function sessions() {
    return window.DONUT_DATA || [];
  }

  function seasonTotal(nextYear) {
    const rows = sessions().filter((row) => row.year === nextYear);
    if (!rows.length) return null;
    const counts = {};
    TAGS.forEach(([id]) => { counts[id] = 0; });
    const onTrack = { n: 0, lap1: 0, burst: 0, bounce: 0, rest: 0 };
    let n = 0;
    let missing = 0;
    rows.forEach((row) => {
      n += row.n;
      if (row.pitFeedMissing) missing += 1;
      TAGS.forEach(([id]) => { counts[id] += row.counts[id] || 0; });
      onTrack.n += row.onTrack.n;
      onTrack.lap1 += row.onTrack.lap1;
      onTrack.burst += row.onTrack.burst;
      onTrack.bounce += row.onTrack.bounce;
      onTrack.rest += row.onTrack.rest;
    });
    const races = rows.filter((row) => row.type === "Race").length;
    return {
      year: nextYear,
      gp: "",
      type: "Season",
      n,
      counts,
      onTrack,
      pitFeedMissing: missing > 0,
      pitFeedMissingCount: missing,
      races,
      sprints: rows.length - races,
    };
  }

  function current() {
    if (scope === "season") return seasonTotal(year);
    return sessions().find((row) => String(row.key) === sessionKey);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  function shareText(count, total) {
    if (!total) return "—";
    return (count / total * 100).toFixed(1) + "%";
  }

  function labelFill(color) {
    const hex = color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.72 ? "#1a1a1a" : "#fff";
  }

  function hideTip() {
    const tip = document.getElementById("tip");
    if (tip) tip.hidden = true;
  }

  function moveTip(event) {
    const tip = document.getElementById("tip");
    if (!tip || tip.hidden) return;
    const pad = 14;
    const box = tip.getBoundingClientRect();
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    if (x + box.width > window.innerWidth - 8) x = event.clientX - box.width - pad;
    if (y + box.height > window.innerHeight - 8) y = event.clientY - box.height - pad;
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = Math.max(8, y) + "px";
  }

  function showTip(event, html) {
    const tip = document.getElementById("tip");
    if (!tip) return;
    tip.innerHTML = html;
    tip.hidden = false;
    moveTip(event);
  }

  function tagTip(tag, count, total) {
    const where = scope === "season" ? "of this season" : "of this session";
    return `<p class="tip-kicker">${escapeHtml(shareText(count, total))} ${where}</p>` +
      `<div class="tip-title">${escapeHtml(tag[1])}</div>` +
      `<p>${count} swaps</p>` +
      `<p>${escapeHtml(tag[3])}</p>`;
  }

  function choicesFor(nextYear, nextGp) {
    return sessions()
      .filter((row) => row.year === nextYear && row.gp === nextGp)
      .sort((a, b) => (a.type === "Race" ? -1 : 1) - (b.type === "Race" ? -1 : 1));
  }

  function paintControls() {
    document.querySelectorAll("#mix-year button").forEach((button) => {
      button.classList.toggle("on", Number(button.dataset.year) === year);
    });
    document.querySelectorAll("#mix-scope button").forEach((button) => {
      button.classList.toggle("on", button.dataset.scope === scope);
    });
    const picks = document.getElementById("mix-picks");
    if (picks) picks.hidden = scope === "season";
    const names = [...new Set(sessions().filter((row) => row.year === year).map((row) => row.gp))].sort();
    if (scope === "session" && !names.includes(gp)) gp = names[0] || "";
    const gpSelect = document.getElementById("mix-gp");
    gpSelect.replaceChildren(...names.map((name) => new Option(name, name)));
    gpSelect.value = gp;
    const choices = choicesFor(year, gp);
    if (scope === "session" && !choices.some((row) => String(row.key) === sessionKey)) {
      sessionKey = choices.length ? String(choices[0].key) : "";
    }
    const sessionSelect = document.getElementById("mix-session");
    sessionSelect.replaceChildren(...choices.map((row) => new Option(row.type, String(row.key))));
    sessionSelect.value = sessionKey;
  }

  function drawTable(row) {
    const body = document.querySelector("#mix-table tbody");
    body.replaceChildren();
    TAGS.forEach((tag) => {
      const count = row.counts[tag[0]] || 0;
      const tr = document.createElement("tr");
      if (tag[0] === selected) tr.classList.add("mix-on");
      tr.innerHTML = `<td><i class="mix-swatch" style="background:${tag[2]}"></i>${tag[1]}</td>` +
        `<td class="num">${count}</td><td class="num">${shareText(count, row.n)}</td>`;
      tr.addEventListener("click", () => selectTag(tag[0]));
      tr.addEventListener("mouseenter", (event) => showTip(event, tagTip(tag, count, row.n)));
      tr.addEventListener("mousemove", moveTip);
      tr.addEventListener("mouseleave", hideTip);
      body.appendChild(tr);
    });
  }

  function drawRing(svg, row, sweep) {
    const slices = TAGS
      .map((tag) => ({ id: tag[0], label: tag[1], color: tag[2], about: tag[3], count: row.counts[tag[0]] || 0 }))
      .filter((slice) => slice.count > 0);
    const pie = d3.pie().value((slice) => slice.count).sort(null);
    const arc = d3.arc().innerRadius(INNER).outerRadius(OUTER);
    const drawn = pie(slices);
    const root = svg.append("g").attr("transform", "translate(150,150)");

    function shift(d) {
      if (d.data.id !== selected) return [0, 0];
      const mid = (d.startAngle + d.endAngle) / 2;
      return [Math.sin(mid) * 8, -Math.cos(mid) * 8];
    }

    const play = sweep && !reduceMotion();
    const paths = root.selectAll("path")
      .data(drawn)
      .join("path")
      .attr("d", (d) => arc(play ? { startAngle: d.startAngle, endAngle: d.startAngle } : d))
      .attr("fill", (d) => d.data.color)
      .attr("stroke", (d) => (d.data.id === selected ? "#fff" : "none"))
      .attr("stroke-width", (d) => (d.data.id === selected ? 2 : 0))
      .attr("transform", (d) => {
        if (play) return "translate(0,0)";
        const [x, y] = shift(d);
        return `translate(${x},${y})`;
      })
      .style("cursor", "pointer");
    if (play) {
      paths.transition()
        .duration(780)
        .ease(d3.easeCubicOut)
        .attrTween("d", (d) => {
          const interp = d3.interpolate({ startAngle: d.startAngle, endAngle: d.startAngle }, d);
          return (t) => arc(interp(t));
        })
        .attr("transform", (d) => {
          const [x, y] = shift(d);
          return `translate(${x},${y})`;
        });
    }
    paths
      .on("click", (event, d) => {
        event.stopPropagation();
        selectTag(d.data.id);
      })
      .on("mouseenter", (event, d) => showTip(event, tagTip(
        [d.data.id, d.data.label, d.data.color, d.data.about],
        d.data.count,
        row.n
      )))
      .on("mousemove", moveTip)
      .on("mouseleave", hideTip);

    const labels = root.selectAll("text.mix-pct")
      .data(drawn.filter((d) => row.n && d.data.count / row.n >= 0.08))
      .join("text")
      .attr("class", "mix-pct")
      .attr("x", (d) => arc.centroid(d)[0] + shift(d)[0])
      .attr("y", (d) => arc.centroid(d)[1] + shift(d)[1])
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("fill", (d) => labelFill(d.data.color))
      .attr("font-size", 11)
      .attr("font-weight", 600)
      .attr("opacity", play ? 0 : 1)
      .style("pointer-events", "none")
      .text((d) => shareText(d.data.count, row.n));
    if (play) labels.transition().delay(460).duration(280).attr("opacity", 1);

    const hole = root.append("g").attr("class", "mix-blank").attr("opacity", play ? 0 : 1);
    if (play) hole.transition().delay(180).duration(360).attr("opacity", 1);
    hole.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "-0.15em")
      .attr("fill", "#f5f5f5")
      .attr("font-size", 28)
      .attr("font-weight", 700)
      .text(row.n);
    hole.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "1.45em")
      .attr("fill", "#9ca3af")
      .attr("font-size", 12)
      .text(shareText(row.counts.on_track, row.n) + " true passes");
  }

  function drawFlags(svg, row, grow) {
    const flags = row.onTrack;
    const items = [
      ["Lap 1", flags.lap1],
      ["Same-second burst", flags.burst],
      ["8-second bounce", flags.bounce],
    ];
    const width = 250;
    svg.append("text")
      .attr("x", 16)
      .attr("y", 28)
      .attr("fill", "#f5f5f5")
      .attr("font-size", 14)
      .attr("font-weight", 600)
      .text(`${flags.n} true passes`);
    items.forEach((item, index) => {
      const y = 58 + index * 58;
      const span = flags.n ? (item[1] / flags.n) * width : 0;
      svg.append("text")
        .attr("x", 16)
        .attr("y", y)
        .attr("fill", "#9ca3af")
        .attr("font-size", 12)
        .text(`${item[0]} · ${item[1]} · ${shareText(item[1], flags.n)} of true passes`);
      svg.append("rect")
        .attr("x", 16)
        .attr("y", y + 8)
        .attr("width", width)
        .attr("height", 10)
        .attr("rx", 5)
        .attr("fill", "#2a2a33");
      const bar = svg.append("rect")
        .attr("x", 16)
        .attr("y", y + 8)
        .attr("width", grow ? 0 : (item[1] ? Math.max(span, 2) : 0))
        .attr("height", 10)
        .attr("rx", 5)
        .attr("fill", "#e14545");
      if (grow) {
        bar.transition()
          .delay(90 + index * 80)
          .duration(420)
          .ease(d3.easeCubicOut)
          .attr("width", item[1] ? Math.max(span, 2) : 0);
      }
    });
    svg.append("text")
      .attr("x", 16)
      .attr("y", 246)
      .attr("fill", "#f5f5f5")
      .attr("font-size", 12)
      .text(`None of these flags: ${flags.rest}`);
  }

  function mountChart(row, mode) {
    const host = document.getElementById("mix-chart");
    host.replaceChildren();
    const svg = d3.select(host).append("svg")
      .attr("viewBox", "0 0 300 300")
      .style("font-family", "Inter, ui-sans-serif, system-ui, sans-serif");
    svg.append("rect")
      .attr("class", "mix-blank")
      .attr("width", 300)
      .attr("height", 300)
      .attr("fill", "transparent");
    if (expanded) drawFlags(svg, row, mode === "expand" && !reduceMotion());
    else drawRing(svg, row, mode === "sweep");
    svg.on("click", (event) => {
      if (!expanded) return;
      const blank = event.target === svg.node()
        || event.target.classList.contains("mix-blank")
        || (event.target.closest && event.target.closest(".mix-blank"));
      if (!blank) return;
      expanded = false;
      draw("sweep");
    });
  }

  function expandRing(row, token) {
    const arc = d3.arc().innerRadius(INNER).outerRadius(OUTER);
    const paths = d3.select("#mix-chart").selectAll("path");
    let left = paths.size();
    d3.select("#mix-chart").selectAll("text").transition().duration(240).style("opacity", 0);
    paths.transition()
      .duration(680)
      .ease(d3.easeCubicInOut)
      .attr("transform", "translate(0,0)")
      .attrTween("d", (d) => {
        const target = d.data.id === "on_track"
          ? { startAngle: d.startAngle, endAngle: d.startAngle + Math.PI * 2 }
          : { startAngle: d.startAngle, endAngle: d.startAngle };
        const interp = d3.interpolate({ startAngle: d.startAngle, endAngle: d.endAngle }, target);
        return (t) => arc(interp(t));
      })
      .on("end", () => {
        left -= 1;
        if (left > 0 || token !== drawToken) return;
        mountChart(row, "expand");
      });
  }

  function draw(mode) {
    drawToken += 1;
    const token = drawToken;
    const row = current();
    const status = document.getElementById("mix-status");
    const note = document.getElementById("mix-note");
    const host = document.getElementById("mix-chart");
    hideTip();
    if (!row) {
      host.replaceChildren();
      status.textContent = "No session data is available for this selection.";
      note.textContent = "";
      document.querySelector("#mix-table tbody").replaceChildren();
      return;
    }
    const where = row.type === "Season"
      ? `${row.year} season · ${row.races} races${row.sprints ? ` and ${row.sprints} sprints` : ""}`
      : `${row.year} ${row.gp} ${row.type}`;
    let line = `${where} · ${row.n} swaps · ${shareText(row.counts.on_track, row.n)} true passes`;
    if (row.type === "Season" && row.pitFeedMissingCount) {
      const sessionsMissing = row.pitFeedMissingCount === 1 ? "1 session has" : `${row.pitFeedMissingCount} sessions have`;
      line += `. ${sessionsMissing} no pit feed, so the pit share may be low and the true-pass share may be high.`;
    } else if (row.pitFeedMissing) {
      line += ". This session has no pit feed, so the pit share may be low and the true-pass share may be high.";
    }
    status.textContent = line;
    note.textContent = expanded
      ? "Lap 1, same-second bursts, and 8-second bounce-backs can overlap, so the three bars can add up to more than the true-pass count. Click the empty chart to return to the ring."
      : "Counts of zero stay in the table and are not drawn. Labels appear on a slice only when it is at least 8%.";
    drawTable(row);
    if (mode === "expand" && !reduceMotion() && row.counts.on_track > 0 && host.querySelector("path")) {
      expandRing(row, token);
      return;
    }
    mountChart(row, mode);
  }

  function sameIds(currentIds, ids) {
    if (currentIds.size !== ids.length) return false;
    return ids.every((id) => currentIds.has(id));
  }

  function syncYear(barId, nextYear) {
    const button = document.querySelector(`#${barId} button[data-year="${nextYear}"]`);
    if (button && !button.classList.contains("on")) button.click();
  }

  function syncSelect(id, value) {
    const select = document.getElementById(id);
    if (!select || select.value === String(value)) return;
    select.value = String(value);
    if (select.value !== String(value)) return;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function syncLap(row) {
    syncYear("lap-year", row.year);
    syncSelect("lap-gp", row.gp);
    syncSelect("lap-session", row.key);
  }

  function syncTrack(row) {
    syncYear("track-year", row.year);
    syncSelect("track-gp", row.gp);
    syncSelect("track-session", row.key);
  }

  function syncBump(row) {
    syncYear("bump-year", row.year);
    if (row.type === "Season") {
      const seasonButton = document.querySelector('#bump-scope button[data-scope="season"]');
      if (seasonButton && !seasonButton.classList.contains("on")) seasonButton.click();
      return;
    }
    const raceButton = document.querySelector('#bump-scope button[data-scope="race"]');
    if (raceButton && !raceButton.classList.contains("on")) raceButton.click();
    syncSelect("bump-race", row.gp);
  }

  function syncNetworkScope(row) {
    const state = window.AppState;
    if (!state) return;
    if (row.type === "Season") {
      if (String(state.get().year) !== String(row.year)) state.setYear(row.year);
      const names = state.gpsForYear(row.year);
      const gps = state.get().gps;
      if (gps.size !== names.length || names.some((name) => !gps.has(name))) state.selectAllGps();
      return;
    }
    if (String(state.get().year) !== String(row.year)) state.setYear(row.year);
    const gps = state.get().gps;
    if (gps.size !== 1 || !gps.has(row.gp)) state.setGps([row.gp]);
  }

  function syncNetworkTags(ids) {
    const state = window.AppState;
    if (!state) return;
    const wanted = new Set(ids);
    const currentTags = state.get().tags;
    if (sameIds(currentTags, ids)) return;
    TAGS.forEach(([id]) => {
      if (currentTags.has(id) !== wanted.has(id)) state.toggleTag(id);
    });
  }

  function syncTrackTags(ids) {
    const bar = document.getElementById("track-tags");
    if (!bar) return;
    const currentTags = new Set([...bar.querySelectorAll("button[data-tag].on")]
      .map((button) => button.dataset.tag)
      .filter((id) => id !== "all" && id !== "none"));
    if (sameIds(currentTags, ids)) return;
    if (ids.length === TAGS.length) {
      const all = bar.querySelector('[data-tag="all"]');
      if (all) all.click();
      return;
    }
    const none = bar.querySelector('[data-tag="none"]');
    if (none) none.click();
    ids.forEach((id) => {
      const button = bar.querySelector(`[data-tag="${id}"]`);
      if (button) button.click();
    });
  }

  function pushSession(row, source) {
    syncing = true;
    try {
      if (row.type !== "Season") {
        if (source !== "lap") syncLap(row);
        if (source !== "track") syncTrack(row);
      }
      syncNetworkScope(row);
      syncBump(row);
    } finally {
      syncing = false;
    }
  }

  function pushTags(ids) {
    const row = current();
    syncing = true;
    try {
      if (row) syncNetworkScope(row);
      syncNetworkTags(ids);
      syncTrackTags(ids);
    } finally {
      syncing = false;
    }
  }

  function useSeason(nextYear) {
    const had = !!selected;
    year = nextYear;
    selected = "";
    expanded = false;
    paintControls();
    draw("sweep");
    const row = current();
    if (row) pushSession(row, "mix");
    if (had) pushTags(ALL_IDS);
  }

  function useSession(nextYear, nextGp, nextKey, source) {
    const had = !!selected;
    year = nextYear;
    gp = nextGp || "";
    sessionKey = nextKey || "";
    selected = "";
    expanded = false;
    paintControls();
    draw("sweep");
    const row = current();
    if (!row) return;
    pushSession(row, source);
    if (had) pushTags(ALL_IDS);
  }

  function adopt(sourceSelect, source) {
    if (syncing || scope === "season") return;
    const key = document.getElementById(sourceSelect).value;
    if (!key || key === sessionKey) return;
    const row = sessions().find((item) => String(item.key) === key);
    if (!row) return;
    useSession(row.year, row.gp, String(row.key), source);
  }

  function selectTag(id) {
    if (id === "on_track" && selected === "on_track" && expanded) {
      expanded = false;
      draw("sweep");
      return;
    }
    if (id !== "on_track" && selected === id) {
      selected = "";
      expanded = false;
      draw();
      pushTags(ALL_IDS);
      return;
    }
    const opening = id === "on_track";
    selected = id;
    expanded = opening;
    draw(opening ? "expand" : undefined);
    pushTags([id]);
  }

  function showAllTags() {
    const reopen = expanded;
    selected = "";
    expanded = false;
    draw(reopen ? "sweep" : undefined);
    pushTags(ALL_IDS);
  }

  function init() {
    if (!document.getElementById("mix-chart")) return;
    const starter = sessions().find((row) => String(row.key) === DEFAULT_KEY) || sessions()[0];
    if (starter) {
      year = starter.year;
      gp = starter.gp;
      sessionKey = String(starter.key);
    }
    document.getElementById("mix-year").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-year]");
      if (!button || Number(button.dataset.year) === year) return;
      if (scope === "season") useSeason(Number(button.dataset.year));
      else useSession(Number(button.dataset.year), "", "", "mix");
    });
    document.getElementById("mix-scope").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-scope]");
      if (!button || button.dataset.scope === scope) return;
      const had = !!selected;
      scope = button.dataset.scope;
      selected = "";
      expanded = false;
      paintControls();
      draw("sweep");
      const row = current();
      if (row) pushSession(row, "mix");
      if (had) pushTags(ALL_IDS);
    });
    document.getElementById("mix-gp").addEventListener("change", (event) => {
      useSession(year, event.target.value, "", "mix");
    });
    document.getElementById("mix-session").addEventListener("change", (event) => {
      const row = sessions().find((item) => String(item.key) === event.target.value);
      if (!row) return;
      useSession(row.year, row.gp, String(row.key), "mix");
    });
    document.getElementById("mix-all").addEventListener("click", showAllTags);
    document.getElementById("lap-year").addEventListener("click", () => adopt("lap-session", "lap"));
    document.getElementById("lap-gp").addEventListener("change", () => adopt("lap-session", "lap"));
    document.getElementById("lap-session").addEventListener("change", () => adopt("lap-session", "lap"));
    document.getElementById("track-year").addEventListener("click", () => adopt("track-session", "track"));
    document.getElementById("track-gp").addEventListener("change", () => adopt("track-session", "track"));
    document.getElementById("track-session").addEventListener("change", () => adopt("track-session", "track"));
    window.addEventListener("resize", () => draw());
    paintControls();
    draw("sweep");
    const row = current();
    if (row) pushSession(row, "mix");
  }

  init();
  return { draw };
})();
