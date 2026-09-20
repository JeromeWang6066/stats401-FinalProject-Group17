window.RankBump = (function () {
  const local = {
    year: 2025,
    scope: "season",
    gp: "",
    range: "all",
    teams: new Set(),
    drivers: new Set(),
  };
  let inited = false;
  let last = null;

  const BAND_FILL = { VSC: "#eab308", SC: "#f97316", RED: "#e10600" };

  function colorOf(driver, year) {
    if (!driver) return "#888888";
    if (year !== "all" && driver.years[year]) return "#" + driver.years[year].color;
    const keys = Object.keys(driver.years || {}).sort();
    const lastYear = keys[keys.length - 1];
    return lastYear ? "#" + driver.years[lastYear].color : "#888888";
  }

  function teamOf(driver, year) {
    if (!driver) return "";
    if (year !== "all" && driver.years[year]) return driver.years[year].team;
    const keys = Object.keys(driver.years || {}).sort();
    const lastYear = keys[keys.length - 1];
    return lastYear ? driver.years[lastYear].team : "";
  }

  function fillTip(html) {
    const el = document.getElementById("tip");
    el.innerHTML = html;
    el.hidden = false;
  }

  function moveTip(event) {
    const el = document.getElementById("tip");
    if (el.hidden) return;
    const pad = 14;
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    const box = el.getBoundingClientRect();
    if (x + box.width > window.innerWidth - 8) x = event.clientX - box.width - pad;
    if (y + box.height > window.innerHeight - 8) y = event.clientY - box.height - pad;
    el.style.left = Math.max(8, x) + "px";
    el.style.top = Math.max(8, y) + "px";
  }

  function hideTip() {
    const el = document.getElementById("tip");
    if (el) el.hidden = true;
  }

  function styleAxis(g) {
    g.attr("class", "axis")
      .attr("font-family", "Inter, ui-sans-serif, system-ui, sans-serif")
      .attr("font-size", 10);
    g.selectAll("text").attr("fill", "#9ca3af");
    g.selectAll("line").attr("stroke", "#3f3f4a");
    g.select(".domain").attr("stroke", "#3f3f4a");
  }

  function atX(points, xVal) {
    let chosen = points[0];
    for (let i = 0; i < points.length; i += 1) {
      if (points[i].x <= xVal) chosen = points[i];
      else break;
    }
    return chosen;
  }

  function roundsForYear(data, year) {
    const pack = (data.champBump || {})[String(year)];
    if (pack && pack.rounds && pack.rounds.length) return pack.rounds.slice();
    return (data.rounds || [])
      .filter((row) => row.year === year)
      .map((row) => row.grandPrix);
  }

  function modeOf() {
    if (local.scope === "race") {
      return { kind: "race", year: local.year, gp: local.gp };
    }
    return { kind: "season", year: local.year };
  }

  function seasonSeries(data) {
    const pack = (data.champBump || {})[String(local.year)];
    if (!pack) return { kind: "season", rounds: [], rows: [] };
    const rounds = pack.rounds.slice();
    const rows = Object.keys(pack.series).sort().map((id) => {
      const info = data.drivers[id];
      const points = (pack.series[id] || [])
        .map((item) => ({
          x: item[0],
          position: item[1],
          points: item[2],
          gp: rounds[item[0]],
        }))
        .filter((item) => item.gp)
        .sort((a, b) => a.x - b.x);
      return {
        id,
        info,
        team: teamOf(info, local.year),
        color: colorOf(info, local.year),
        points,
      };
    }).filter((row) => row.points.length);
    return { kind: "season", rounds, rows };
  }

  function raceSeries(data, gp) {
    const pack = (data.raceBump || {})[local.year + "|" + gp];
    if (!pack) return { kind: "race", gp, maxLap: 1, bands: [], rows: [] };
    const rows = Object.keys(pack.series).sort().map((id) => {
      const info = data.drivers[id];
      const points = (pack.series[id] || []).map((item) => ({
        x: item[0],
        position: item[1],
        lap: Math.max(1, Math.floor(item[0])),
      }));
      return {
        id,
        info,
        team: teamOf(info, local.year),
        color: colorOf(info, local.year),
        points,
      };
    }).filter((row) => row.points.length);
    return {
      kind: "race",
      gp,
      maxLap: pack.maxLap || 1,
      bands: pack.bands || [],
      rows,
    };
  }

  function lastOf(row) {
    return row.points[row.points.length - 1];
  }

  function applyLocal(chart) {
    let rows = chart.rows;
    if (local.range === "points") {
      rows = rows.filter((row) => {
        const end = lastOf(row);
        if (chart.kind === "season") return (end.points || 0) > 0;
        return end.position <= 10;
      });
    } else if (local.range === "top5") {
      rows = rows.filter((row) => lastOf(row).position <= 5);
    } else if (local.range === "top10") {
      rows = rows.filter((row) => lastOf(row).position <= 10);
    }
    if (local.teams.size) {
      rows = rows.filter((row) => local.teams.has(row.team));
    }
    if (local.drivers.size) {
      rows = rows.filter((row) => local.drivers.has(row.id));
    }
    return rows;
  }

  function emptyChart(el, message) {
    const width = el.clientWidth || 800;
    const height = el.clientHeight || 420;
    el.innerHTML = "";
    const svg = d3.select(el).append("svg").attr("width", width).attr("height", height);
    svg.append("text")
      .attr("x", width / 2)
      .attr("y", height / 2)
      .attr("text-anchor", "middle")
      .attr("fill", "#9ca3af")
      .attr("font-size", 13)
      .text(message);
  }

  function tipHtml(row, point, chart) {
    const name = (row.info && row.info.name) || row.id;
    const where = chart.kind === "race"
      ? `Lap ${point.lap}`
      : (point.gp || "");
    const extra = chart.kind === "season" && point.points != null
      ? ` · ${point.points} pts`
      : "";
    return `
      <p class="tip-kicker">${row.team || ""}</p>
      <p class="tip-title">${row.id}</p>
      <p>${name}</p>
      <p>${where} · rank <strong>P${point.position}</strong>${extra}</p>
    `;
  }

  function paintMenus(chart) {
    const teamList = document.getElementById("bump-team-list");
    const driverList = document.getElementById("bump-driver-list");
    if (!teamList || !driverList) return;
    const teams = [...new Set(chart.rows.map((row) => row.team).filter(Boolean))].sort();
    const drivers = chart.rows.map((row) => row.id);
    teamList.innerHTML = teams.map((name) => {
      const checked = local.teams.has(name) ? "checked" : "";
      return `<label><input type="checkbox" value="${name}" ${checked} />${name}</label>`;
    }).join("");
    driverList.innerHTML = drivers.map((id) => {
      const checked = local.drivers.has(id) ? "checked" : "";
      return `<label><input type="checkbox" value="${id}" ${checked} />${id}</label>`;
    }).join("");
    const teamToggle = document.getElementById("bump-team-toggle");
    const driverToggle = document.getElementById("bump-driver-toggle");
    if (teamToggle) {
      teamToggle.textContent = local.teams.size ? `Teams · ${local.teams.size}` : "Teams";
    }
    if (driverToggle) {
      driverToggle.textContent = local.drivers.size ? `Drivers · ${local.drivers.size}` : "Drivers";
    }
    document.querySelectorAll("#bump-range button").forEach((btn) => {
      btn.classList.toggle("on", btn.dataset.range === local.range);
    });
  }

  function paintScope(data) {
    document.querySelectorAll("#bump-year button").forEach((btn) => {
      btn.classList.toggle("on", +btn.dataset.year === local.year);
    });
    document.querySelectorAll("#bump-scope button").forEach((btn) => {
      btn.classList.toggle("on", btn.dataset.scope === local.scope);
    });
    const wrap = document.getElementById("bump-race-wrap");
    const select = document.getElementById("bump-race");
    const rounds = roundsForYear(data, local.year);
    if (!local.gp || !rounds.includes(local.gp)) local.gp = rounds[0] || "";
    if (select) {
      select.innerHTML = rounds.map((gp) => {
        const selected = gp === local.gp ? "selected" : "";
        return `<option value="${gp}" ${selected}>${gp}</option>`;
      }).join("");
    }
    if (wrap) wrap.hidden = local.scope !== "race";
  }

  function draw() {
    if (!last) return;
    const { el, data } = last;
    const why = document.getElementById("bump-why");
    const status = document.getElementById("bump-status");
    const legend = document.getElementById("bump-legend");
    hideTip();
    paintScope(data);
    const mode = modeOf();

    const chart = mode.kind === "race"
      ? raceSeries(data, mode.gp)
      : seasonSeries(data);
    const teamNames = new Set(chart.rows.map((row) => row.team));
    const driverIds = new Set(chart.rows.map((row) => row.id));
    local.teams = new Set([...local.teams].filter((name) => teamNames.has(name)));
    local.drivers = new Set([...local.drivers].filter((id) => driverIds.has(id)));
    paintMenus(chart);
    const visible = applyLocal(chart);

    if (mode.kind === "race") {
      if (why) {
        why.textContent = `${mode.year} ${mode.gp}: x is race lap. OpenF1 position only records a row when rank changes, so the lines are steps. Bands are VSC / safety car / red flag. Hover for driver, lap, and rank then.`;
      }
      if (legend) legend.hidden = false;
    } else {
      if (why) {
        why.textContent = `${mode.year} championship: x is calendar order of rounds (sprint points included). P1 is at the top. Hover for driver, current round, and rank then.`;
      }
      if (legend) legend.hidden = true;
    }

    if (mode.kind === "race" && !mode.gp) {
      if (status) status.textContent = "";
      emptyChart(el, "No race sessions for this year.");
      return;
    }
    if (mode.kind === "race" && !((data.raceBump || {})[mode.year + "|" + mode.gp])) {
      if (status) status.textContent = "";
      emptyChart(el, "No position series for this Grand Prix.");
      return;
    }
    if (chart.kind === "season" && !chart.rounds.length) {
      if (status) status.textContent = "";
      emptyChart(el, "No championship series for this year.");
      return;
    }
    if (!visible.length) {
      if (status) status.textContent = `Current filter: 0 / ${chart.rows.length} drivers`;
      emptyChart(el, "No drivers. Change the range, or pick teams / drivers.");
      return;
    }

    if (status) {
      const head = chart.kind === "race"
        ? `${mode.year} ${mode.gp} · ${chart.maxLap} laps`
        : `${mode.year} championship · ${chart.rounds.length} rounds`;
      status.innerHTML = `${head} · showing <em>${visible.length}</em> / ${chart.rows.length} drivers`;
    }

    const width = el.clientWidth || 800;
    const height = el.clientHeight || 420;
    const isSeason = chart.kind === "season";
    const margin = {
      top: 16,
      right: 52,
      bottom: isSeason ? 64 : 28,
      left: 36,
    };
    el.innerHTML = "";
    const svg = d3.select(el).append("svg").attr("width", width).attr("height", height);

    const x = isSeason
      ? d3.scaleLinear().domain([-0.15, Math.max(chart.rounds.length - 1, 0) + 0.15]).range([margin.left, width - margin.right])
      : d3.scaleLinear().domain([1, chart.maxLap]).range([margin.left, width - margin.right]);
    const maxPos = Math.max(5, d3.max(visible, (row) => d3.max(row.points, (p) => p.position)) || 20);
    const y = d3.scaleLinear().domain([1, maxPos]).range([margin.top, height - margin.bottom]);
    const line = d3.line()
      .x((d) => x(d.x))
      .y((d) => y(d.position))
      .curve(d3.curveStepAfter);

    if (!isSeason) {
      svg.append("g")
        .selectAll("rect")
        .data(chart.bands)
        .join("rect")
        .attr("x", (d) => x(d[1]))
        .attr("width", (d) => Math.max(3, x(d[2]) - x(d[1])))
        .attr("y", margin.top)
        .attr("height", height - margin.top - margin.bottom)
        .attr("fill", (d) => BAND_FILL[d[0]] || "#52525b")
        .attr("opacity", 0.22);
      svg.append("g")
        .selectAll("text")
        .data(chart.bands)
        .join("text")
        .attr("x", (d) => x(d[1]) + 4)
        .attr("y", margin.top + 12)
        .attr("fill", "#9ca3af")
        .attr("font-size", 10)
        .text((d) => d[0]);
    }

    const yTicks = [1, 5, 10, 15, 20].filter((v) => v <= maxPos);
    if (!yTicks.includes(maxPos) && maxPos > 20) yTicks.push(maxPos);
    styleAxis(
      svg.append("g")
        .attr("transform", `translate(${margin.left},0)`)
        .call(d3.axisLeft(y).tickValues(yTicks).tickFormat((d) => "P" + d))
    );

    const xAxis = svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`);
    if (isSeason) {
      const step = chart.rounds.length > 14 ? 2 : 1;
      const ticks = d3.range(0, chart.rounds.length).filter((i) => i % step === 0 || i === chart.rounds.length - 1);
      styleAxis(xAxis.call(d3.axisBottom(x).tickValues(ticks).tickFormat((i) => chart.rounds[i] || "")));
      xAxis.selectAll("text")
        .attr("transform", "rotate(-40)")
        .attr("text-anchor", "end")
        .attr("dx", "-0.4em")
        .attr("dy", "0.35em");
    } else {
      styleAxis(xAxis.call(d3.axisBottom(x).ticks(8).tickFormat((d) => "L" + Math.round(d))));
    }

    const paths = svg.append("g")
      .selectAll("path.bump-line")
      .data(visible)
      .join("path")
      .attr("class", "bump-line")
      .attr("fill", "none")
      .attr("stroke", (d) => d.color)
      .attr("stroke-width", 2.2)
      .attr("stroke-linejoin", "round")
      .attr("opacity", 0.72)
      .attr("d", (d) => (d.points.length > 1 ? line(d.points) : null));

    svg.append("g")
      .selectAll("circle.bump-dot")
      .data(visible.filter((d) => d.points.length === 1))
      .join("circle")
      .attr("class", "bump-dot")
      .attr("cx", (d) => x(d.points[0].x))
      .attr("cy", (d) => y(d.points[0].position))
      .attr("r", 3.5)
      .attr("fill", (d) => d.color)
      .attr("opacity", 0.72);

    const labels = svg.append("g")
      .selectAll("text.bump-label")
      .data(visible)
      .join("text")
      .attr("class", "bump-label")
      .attr("x", (d) => x(lastOf(d).x) + 6)
      .attr("y", (d) => y(lastOf(d).position) + 4)
      .attr("fill", (d) => d.color)
      .attr("font-size", 11)
      .attr("font-weight", 600)
      .attr("font-family", "Inter, ui-sans-serif, system-ui, sans-serif")
      .text((d) => d.id);

    function highlight(id, event, row) {
      const on = id != null;
      paths.attr("opacity", (d) => {
        if (!on) return 0.72;
        return d.id === id ? 1 : 0.1;
      }).attr("stroke-width", (d) => (on && d.id === id ? 3.2 : 2.2));
      labels.attr("opacity", (d) => {
        if (!on) return 1;
        return d.id === id ? 1 : 0.2;
      });
      svg.selectAll("circle.bump-dot").attr("opacity", (d) => {
        if (!on) return 0.72;
        return d.id === id ? 1 : 0.1;
      });
      if (on && row && event) {
        const [mx] = d3.pointer(event, svg.node());
        const xVal = x.invert(mx);
        fillTip(tipHtml(row, atX(row.points, xVal), chart));
        moveTip(event);
      } else {
        hideTip();
      }
    }

    const hits = svg.append("g");
    hits.selectAll("path")
      .data(visible.filter((d) => d.points.length > 1))
      .join("path")
      .attr("d", (d) => line(d.points))
      .attr("fill", "none")
      .attr("stroke", "transparent")
      .attr("stroke-width", 14)
      .style("cursor", "pointer")
      .on("mouseenter", (event, d) => highlight(d.id, event, d))
      .on("mousemove", (event, d) => highlight(d.id, event, d))
      .on("mouseleave", () => highlight(null));
    hits.selectAll("circle")
      .data(visible.filter((d) => d.points.length === 1))
      .join("circle")
      .attr("cx", (d) => x(d.points[0].x))
      .attr("cy", (d) => y(d.points[0].position))
      .attr("r", 10)
      .attr("fill", "transparent")
      .style("cursor", "pointer")
      .on("mouseenter", (event, d) => highlight(d.id, event, d))
      .on("mousemove", (event, d) => highlight(d.id, event, d))
      .on("mouseleave", () => highlight(null));
  }

  function closeMenus() {
    document.getElementById("bump-team-menu")?.classList.remove("open");
    document.getElementById("bump-driver-menu")?.classList.remove("open");
  }

  function init() {
    if (inited) return;
    inited = true;
    const rangeBar = document.getElementById("bump-range");
    if (rangeBar) {
      rangeBar.addEventListener("click", (event) => {
        const btn = event.target.closest("button");
        if (!btn) return;
        local.range = btn.dataset.range;
        draw();
      });
    }
    document.getElementById("bump-year")?.addEventListener("click", (event) => {
      const btn = event.target.closest("button");
      if (!btn) return;
      local.year = +btn.dataset.year;
      draw();
    });
    document.getElementById("bump-scope")?.addEventListener("click", (event) => {
      const btn = event.target.closest("button");
      if (!btn) return;
      local.scope = btn.dataset.scope;
      draw();
    });
    document.getElementById("bump-race")?.addEventListener("change", (event) => {
      local.gp = event.target.value;
      local.scope = "race";
      draw();
    });
    const teamToggle = document.getElementById("bump-team-toggle");
    const teamMenu = document.getElementById("bump-team-menu");
    const driverToggle = document.getElementById("bump-driver-toggle");
    const driverMenu = document.getElementById("bump-driver-menu");
    teamToggle?.addEventListener("click", (event) => {
      event.stopPropagation();
      driverMenu?.classList.remove("open");
      teamMenu?.classList.toggle("open");
    });
    driverToggle?.addEventListener("click", (event) => {
      event.stopPropagation();
      teamMenu?.classList.remove("open");
      driverMenu?.classList.toggle("open");
    });
    teamMenu?.addEventListener("click", (event) => event.stopPropagation());
    driverMenu?.addEventListener("click", (event) => event.stopPropagation());
    teamMenu?.addEventListener("change", (event) => {
      if (event.target.type !== "checkbox") return;
      const chosen = [...teamMenu.querySelectorAll("input:checked")].map((box) => box.value);
      local.teams = new Set(chosen);
      draw();
    });
    driverMenu?.addEventListener("change", (event) => {
      if (event.target.type !== "checkbox") return;
      const chosen = [...driverMenu.querySelectorAll("input:checked")].map((box) => box.value);
      local.drivers = new Set(chosen);
      draw();
    });
    document.getElementById("bump-team-none")?.addEventListener("click", () => {
      local.teams = new Set();
      draw();
    });
    document.getElementById("bump-driver-none")?.addEventListener("click", () => {
      local.drivers = new Set();
      draw();
    });
    document.addEventListener("click", closeMenus);
  }

  function render(el, data) {
    init();
    last = { el, data };
    draw();
  }

  return { render };
})();
