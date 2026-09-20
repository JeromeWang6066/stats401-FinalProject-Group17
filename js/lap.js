window.LapChart = (function () {
  const sessions = window.LAP_DATA || [];
  const bandColors = { VSC: "#eab308", SC: "#f97316", RED: "#e10600" };
  const labels = {
    on_track: "True on-track pass", pit: "Pit-related", retired: "Retirement",
    under_sc: "Neutralized period", unlap_under_sc: "Unlapping under Safety Car",
    formation: "Formation", post_race: "Post-race",
  };
  let year = 2025;
  let gp = "";
  let sessionKey = "";

  function optionsForYear() {
    return sessions.filter((row) => row.year === year);
  }

  function selected() {
    return sessions.find((row) => String(row.key) === sessionKey);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  function showTip(event, item, source) {
    const tip = document.getElementById("tip");
    const [lap, date, passing, passed, position, tag] = item;
    const time = date ? date.replace("T", " ").replace(/(\.\d+)?\+00:00$/, " UTC") : "Unknown";
    tip.innerHTML = `<p class="tip-kicker">${source} · Lap ${lap}</p>` +
      `<div class="tip-title">${escapeHtml(passing)} → ${escapeHtml(passed)}</div>` +
      `<p>Position after swap: <strong>${position == null ? "Unknown" : "P" + position}</strong></p>` +
      `<p>Time: <strong>${escapeHtml(time)}</strong></p>` +
      `<p>Classification: <strong>${escapeHtml(labels[tag] || tag)}</strong></p>`;
    tip.hidden = false;
    moveTip(event);
  }

  function moveTip(event) {
    const tip = document.getElementById("tip");
    if (tip.hidden) return;
    const pad = 14;
    const box = tip.getBoundingClientRect();
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    if (x + box.width > window.innerWidth - 8) x = event.clientX - box.width - pad;
    if (y + box.height > window.innerHeight - 8) y = event.clientY - box.height - pad;
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = Math.max(8, y) + "px";
  }

  function hideTip() {
    document.getElementById("tip").hidden = true;
  }

  function draw() {
    const row = selected();
    const chart = document.getElementById("lap-chart");
    const status = document.getElementById("lap-status");
    chart.replaceChildren();
    hideTip();
    if (!row) {
      status.textContent = "No session data is available for this selection.";
      return;
    }

    const perLap = Array.from({ length: row.maxLap }, () => []);
    row.events.forEach((item) => {
      if (item[0] >= 1 && item[0] <= row.maxLap) perLap[item[0] - 1].push(item);
    });
    const peak = Math.max(1, ...perLap.map((items) => items.length));
    const cell = 5;
    const pitch = 6;
    const slot = 18;
    const left = 58;
    const top = 30;
    const bottom = 52;
    const width = left + row.maxLap * slot + 18;
    const height = top + peak * pitch + bottom;
    const baseline = height - bottom;
    const x = (lap) => left + (lap - 1) * slot;
    const y = (count) => baseline - count * pitch;

    const svg = d3.select(chart).append("svg")
      .attr("width", width).attr("height", height)
      .attr("role", "img")
      .attr("aria-label", `Raw and cleaned position swaps by lap for ${year} ${row.gp} ${row.type}`);

    svg.append("g").attr("class", "lap-bands").selectAll("rect")
      .data(row.bands || []).join("rect")
      .attr("x", (band) => x(band[1]))
      .attr("y", top)
      .attr("width", (band) => Math.max(3, (band[2] - band[1]) * slot))
      .attr("height", baseline - top)
      .attr("fill", (band) => bandColors[band[0]] || "#52525b")
      .attr("opacity", 0.22);

    const tickStep = peak > 100 ? 25 : peak > 40 ? 10 : peak > 15 ? 5 : 2;
    const yTicks = d3.range(0, peak + 1, tickStep);
    if (yTicks[yTicks.length - 1] !== peak) yTicks.push(peak);
    svg.append("g").attr("class", "lap-grid").selectAll("line")
      .data(yTicks.filter((tick) => tick > 0)).join("line")
      .attr("x1", left - 5).attr("x2", width - 18)
      .attr("y1", (tick) => y(tick)).attr("y2", (tick) => y(tick));

    const squares = [];
    perLap.forEach((items, index) => {
      items.forEach((item, level) => squares.push({ item, lap: index + 1, level, clean: false }));
      items.filter((item) => item[5] === "on_track")
        .forEach((item, level) => squares.push({ item, lap: index + 1, level, clean: true }));
    });
    svg.append("g").selectAll("rect").data(squares).join("rect")
      .attr("class", (item) => item.clean ? "lap-square clean" : "lap-square raw")
      .attr("x", (item) => x(item.lap) + (item.clean ? 7 : 0))
      .attr("y", (item) => y(item.level + 1))
      .attr("width", cell).attr("height", cell)
      .on("pointerenter", (event, item) => showTip(event, item.item, item.clean ? "Cleaned pass" : "Raw record"))
      .on("pointermove", moveTip).on("pointerleave", hideTip);

    const axis = (group) => group.attr("class", "axis")
      .attr("font-family", "Inter, ui-sans-serif, system-ui, sans-serif")
      .attr("font-size", 10)
      .call((g) => {
        g.selectAll("text").attr("fill", "#9ca3af");
        g.selectAll("line").attr("stroke", "#3f3f4a");
        g.select(".domain").attr("stroke", "#3f3f4a");
      });
    axis(svg.append("g").attr("transform", `translate(${left - 7},0)`)
      .call(d3.axisLeft(d3.scaleLinear().domain([0, peak]).range([baseline, y(peak)])).tickValues(yTicks)));
    const lapStep = row.maxLap > 45 ? 5 : row.maxLap > 20 ? 2 : 1;
    const lapTicks = d3.range(1, row.maxLap + 1).filter((lap) => lap === 1 || lap % lapStep === 0 || lap === row.maxLap);
    axis(svg.append("g").attr("transform", `translate(0,${baseline + 5})`)
      .call(d3.axisBottom(d3.scaleLinear().domain([1, row.maxLap]).range([x(1) + 6, x(row.maxLap) + 6]))
        .tickValues(lapTicks).tickFormat((lap) => String(lap))));
    svg.append("text").attr("class", "lap-axis-title")
      .attr("x", (left + width) / 2).attr("y", height - 5).attr("text-anchor", "middle").text("Lap");
    svg.append("text").attr("class", "lap-axis-title")
      .attr("transform", `translate(13,${(top + baseline) / 2}) rotate(-90)`)
      .attr("text-anchor", "middle").text("Position swaps");

    const cleanCount = row.events.filter((event) => event[5] === "on_track").length;
    status.textContent = `${row.type} · ${row.events.length} raw swaps · ${cleanCount} true passes · ` +
      `Missing lap: ${row.missingRaw} raw, ${row.missingClean} cleaned (excluded from bars).`;
  }

  function paint() {
    document.querySelectorAll("#lap-year button").forEach((button) => {
      button.classList.toggle("on", Number(button.dataset.year) === year);
    });
    const gpSelect = document.getElementById("lap-gp");
    const names = [...new Set(optionsForYear().map((row) => row.gp))].sort();
    if (!names.includes(gp)) gp = names[0] || "";
    gpSelect.replaceChildren(...names.map((name) => new Option(name, name)));
    gpSelect.value = gp;
    const sessionSelect = document.getElementById("lap-session");
    const choices = optionsForYear().filter((row) => row.gp === gp)
      .sort((a, b) => (a.type === "Race" ? -1 : 1) - (b.type === "Race" ? -1 : 1));
    if (!choices.some((row) => String(row.key) === sessionKey)) sessionKey = choices.length ? String(choices[0].key) : "";
    sessionSelect.replaceChildren(...choices.map((row) => new Option(row.type, String(row.key))));
    sessionSelect.value = sessionKey;
    draw();
  }

  function init() {
    document.getElementById("lap-year").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-year]");
      if (!button) return;
      year = Number(button.dataset.year);
      gp = "";
      sessionKey = "";
      paint();
    });
    document.getElementById("lap-gp").addEventListener("change", (event) => {
      gp = event.target.value;
      sessionKey = "";
      paint();
    });
    document.getElementById("lap-session").addEventListener("change", (event) => {
      sessionKey = event.target.value;
      draw();
    });
    paint();
  }

  return { init };
})();
