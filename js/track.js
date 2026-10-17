window.TrackMap = (function () {
  const sessions = window.TRACK_DATA || [];
  const lockedKey = "9636";
  const tags = [
    ["on_track", "True pass", "#e14545"],
    ["pit", "Pit", "#9295a2"],
    ["retired", "Retired", "#d6d3d1"],
    ["under_sc", "Neutralized", "#eab308"],
    ["unlap_under_sc", "Unlapping", "#f97316"],
    ["formation", "Formation", "#67e8f9"],
    ["post_race", "Post-race", "#c084fc"],
  ];
  const tagLabel = Object.fromEntries(tags.map(([id, label]) => [id, label]));
  const selected = new Set(["on_track"]);
  let year = 2025;
  let gp = "";
  let sessionKey = "";
  let lap1Only = false;
  let lapPick = null;

  function optionsForYear() {
    return sessions.filter((row) => row.year === year);
  }

  function current() {
    return sessions.find((row) => String(row.key) === sessionKey);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
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

  function showTip(event, item) {
    const tip = document.getElementById("tip");
    const lap = item[3] == null ? "Unknown" : item[3];
    const corner = item[2] == null ? "Off the racing line" : "Turn " + item[2];
    const flags = [item[5] ? "Lap 1" : "", item[6] ? "Burst" : "", item[7] ? "Bounce" : ""].filter(Boolean).join(" · ");
    tip.innerHTML = `<p class="tip-kicker">${escapeHtml(corner)} · Lap ${lap}</p>` +
      `<div class="tip-title">${escapeHtml(item[8])} → ${escapeHtml(item[9])}</div>` +
      `<p>Position after swap: <strong>${item[10] == null ? "Unknown" : "P" + item[10]}</strong></p>` +
      `<p>Classification: <strong>${escapeHtml(tagLabel[item[4]] || item[4])}</strong></p>` +
      (flags ? `<p>${escapeHtml(flags)}</p>` : "");
    tip.hidden = false;
    moveTip(event);
  }

  // Extra pose after the MultiViewer rotation, matched to the Formula 1
  // circuit-map posters (formula1.com "Circuit maps 16x9"). turn is degrees
  // counter-clockwise in the y-up frame; mirrorY flips top and bottom.
  const orient = {
    "Abu Dhabi": { turn: 0, mirrorY: true },
    Austin: { turn: 0, mirrorY: true },
    Austria: { turn: 0, mirrorY: true },
    Bahrain: { turn: 0, mirrorY: true },
    Baku: { turn: 0, mirrorY: false },
    Barcelona: { turn: 0, mirrorY: true },
    Hungary: { turn: 90, mirrorY: true },
    Imola: { turn: 0, mirrorY: true },
    Jeddah: { turn: 0, mirrorY: true },
    "Las Vegas": { turn: 0, mirrorY: true },
    Melbourne: { turn: 0, mirrorY: true },
    "Mexico City": { turn: 0, mirrorY: true },
    Miami: { turn: 0, mirrorY: true },
    Monaco: { turn: 0, mirrorY: true },
    Montreal: { turn: 0, mirrorY: true },
    Monza: { turn: 0, mirrorY: true },
    Qatar: { turn: 0, mirrorY: true },
    "Sao Paulo": { turn: 0, mirrorY: true },
    Shanghai: { turn: 0, mirrorY: true },
    Silverstone: { turn: 0, mirrorY: true },
    Singapore: { turn: 0, mirrorY: true },
    Spa: { turn: 0, mirrorY: true },
    Suzuka: { turn: 0, mirrorY: false },
    Zandvoort: { turn: 0, mirrorY: true },
  };

  function heading(a, b) {
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  }

  function turnAngle(a, b) {
    let turn = Math.abs(a - b) % (Math.PI * 2);
    if (turn > Math.PI) turn = Math.PI * 2 - turn;
    return turn;
  }

  // One racing lap is cut at the start line, so the first and last samples
  // sit a short distance apart on the straight. Join them when that chord
  // continues the racing line.
  function closeLoop(line) {
    if (line.length < 4) return line;
    const steps = [];
    for (let i = 1; i < line.length; i++) {
      steps.push(Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    }
    steps.sort((left, right) => left - right);
    const median = steps[Math.floor(steps.length / 2)] || 1;
    const end = line[line.length - 1];
    const gap = Math.hypot(line[0][0] - end[0], line[0][1] - end[1]);
    if (gap <= median * 1.2 || gap > median * 10) return line;
    const into = turnAngle(heading(line[line.length - 2], end), heading(end, line[0]));
    const out = turnAngle(heading(end, line[0]), heading(line[0], line[1]));
    if (into > Math.PI / 3 || out > Math.PI / 3) return line;
    return line.concat([line[0]]);
  }

  function arcLength(line) {
    const cumulative = [0];
    for (let i = 1; i < line.length; i++) {
      cumulative.push(cumulative[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    }
    const closed = line.length > 2
      && line[0][0] === line[line.length - 1][0]
      && line[0][1] === line[line.length - 1][1];
    return { cumulative, total: cumulative[cumulative.length - 1], closed };
  }

  function projectArc(line, cumulative, px, py) {
    let best = Infinity;
    let bestS = 0;
    for (let i = 1; i < line.length; i++) {
      const ax = line[i - 1][0];
      const ay = line[i - 1][1];
      const bx = line[i][0];
      const by = line[i][1];
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSq = dx * dx + dy * dy;
      if (!lengthSq) continue;
      let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dist = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (dist < best) {
        best = dist;
        bestS = cumulative[i - 1] + t * Math.sqrt(lengthSq);
      }
    }
    return bestS;
  }

  function pointAtArc(line, cumulative, s) {
    let lo = 1;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < s) lo = mid + 1;
      else hi = mid;
    }
    const span = cumulative[lo] - cumulative[lo - 1] || 1;
    const t = (s - cumulative[lo - 1]) / span;
    return [
      line[lo - 1][0] + (line[lo][0] - line[lo - 1][0]) * t,
      line[lo - 1][1] + (line[lo][1] - line[lo - 1][1]) * t,
    ];
  }

  function paintAlongTrack(density, line, points, width, height, radius, inv) {
    if (line.length < 2) return;
    const { cumulative, total, closed } = arcLength(line);
    if (!total) return;
    const step = 2;
    const samples = [];
    for (let s = 0; s <= total; s += step) {
      const point = pointAtArc(line, cumulative, Math.min(s, total));
      samples.push({ s, x: point[0], y: point[1], value: 0 });
    }
    points.forEach((point) => {
      const origin = projectArc(line, cumulative, point[0], point[1]);
      samples.forEach((sample) => {
        let distance = Math.abs(sample.s - origin);
        if (closed) distance = Math.min(distance, total - distance);
        if (distance > radius) return;
        sample.value += Math.exp(-distance * distance * inv);
      });
    });
    const stamp = 20;
    samples.forEach((sample) => {
      if (!sample.value) return;
      const x0 = Math.max(0, Math.floor(sample.x - stamp));
      const x1 = Math.min(width - 1, Math.ceil(sample.x + stamp));
      const y0 = Math.max(0, Math.floor(sample.y - stamp));
      const y1 = Math.min(height - 1, Math.ceil(sample.y + stamp));
      for (let row = y0; row <= y1; row++) {
        const dy = row - sample.y;
        for (let col = x0; col <= x1; col++) {
          const dx = col - sample.x;
          if (dx * dx + dy * dy > stamp * stamp) continue;
          const index = row * width + col;
          if (sample.value > density[index]) density[index] = sample.value;
        }
      }
    });
  }

  function drawHeat(g, screenLine, points, width, height, ribbon) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#ffffff";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 6;
    ctx.lineWidth = ribbon;
    ctx.beginPath();
    screenLine.forEach((point, index) => {
      if (index) ctx.lineTo(point[0], point[1]);
      else ctx.moveTo(point[0], point[1]);
    });
    ctx.stroke();
    const mask = ctx.getImageData(0, 0, width, height).data;

    const density = new Float32Array(width * height);
    const radius = 110;
    const sigma = 42;
    const inv = 1 / (2 * sigma * sigma);
    if (!document.getElementById("track-lap")) {
      const radiusSq = radius * radius;
      points.forEach((point) => {
        const px = point[0];
        const py = point[1];
        const x0 = Math.max(0, Math.floor(px - radius));
        const x1 = Math.min(width - 1, Math.ceil(px + radius));
        const y0 = Math.max(0, Math.floor(py - radius));
        const y1 = Math.min(height - 1, Math.ceil(py + radius));
        for (let row = y0; row <= y1; row++) {
          const dy = row - py;
          for (let col = x0; col <= x1; col++) {
            const dx = col - px;
            const distSq = dx * dx + dy * dy;
            if (distSq > radiusSq) continue;
            density[row * width + col] += Math.exp(-distSq * inv);
          }
        }
      });
    } else {
      paintAlongTrack(density, screenLine, points, width, height, radius, inv);
    }

    let max = 0;
    for (let i = 0; i < density.length; i++) {
      if (density[i] > max) max = density[i];
    }
    const image = ctx.createImageData(width, height);
    const pixels = image.data;
    const deep = 0x8b;
    for (let i = 0; i < density.length; i++) {
      const alpha = mask[i * 4 + 3];
      if (!alpha) continue;
      const t = max > 0 ? Math.sqrt(density[i] / max) : 0;
      const p = i * 4;
      pixels[p] = 255 + (deep - 255) * t;
      pixels[p + 1] = 255 * (1 - t);
      pixels[p + 2] = 255 * (1 - t);
      pixels[p + 3] = alpha;
    }
    ctx.putImageData(image, 0, 0);
    g.append("image")
      .attr("class", "track-heat")
      .attr("href", canvas.toDataURL())
      .attr("width", width)
      .attr("height", height);
  }

  function lineClearance(line, px, py) {
    let best = Infinity;
    for (let i = 1; i < line.length; i++) {
      const ax = line[i - 1][0];
      const ay = line[i - 1][1];
      const bx = line[i][0];
      const by = line[i][1];
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSq = dx * dx + dy * dy;
      if (!lengthSq) continue;
      let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
    }
    return best;
  }

  function placeBeside(line, px, py, minClear) {
    let area = 0;
    for (let i = 1; i < line.length; i++) {
      area += line[i - 1][0] * line[i][1] - line[i][0] * line[i - 1][1];
    }
    const clockwise = area > 0;
    let nearest = Infinity;
    let nx = 0;
    let ny = -1;
    for (let i = 1; i < line.length; i++) {
      const ax = line[i - 1][0];
      const ay = line[i - 1][1];
      const bx = line[i][0];
      const by = line[i][1];
      const dx = bx - ax;
      const dy = by - ay;
      const length = Math.hypot(dx, dy);
      if (!length) continue;
      let t = ((px - ax) * dx + (py - ay) * dy) / (length * length);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dist = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (dist >= nearest) continue;
      nearest = dist;
      nx = (clockwise ? dy : -dy) / length;
      ny = (clockwise ? -dx : dx) / length;
    }
    let fallback = [px + nx * minClear, py + ny * minClear];
    let fallbackScore = -Infinity;
    for (let radius = 18; radius <= 34; radius += 2) {
      let found = null;
      for (let step = 0; step < 16; step++) {
        const angle = step / 16 * Math.PI * 2;
        const x = px + Math.cos(angle) * radius;
        const y = py + Math.sin(angle) * radius;
        const clear = lineClearance(line, x, y);
        const align = Math.cos(angle) * nx + Math.sin(angle) * ny;
        if (clear >= minClear && (!found || align > found.align)) found = { x, y, align };
        const score = clear + align * 6;
        if (score > fallbackScore) {
          fallbackScore = score;
          fallback = [x, y];
        }
      }
      if (found) return [found.x, found.y];
    }
    return fallback;
  }

  function drawFinish(g, line, x, y, span, clear) {
    if (line.length < 2) return;
    const closed = line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1];
    const from = closed ? line[line.length - 2] : line[line.length - 1];
    const to = closed ? line[line.length - 1] : line[0];
    const ax = x(from[0]);
    const ay = y(from[1]);
    const bx = x(to[0]);
    const by = y(to[1]);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy) || 1;
    const tx = dx / length;
    const ty = dy / length;
    const nx = -ty;
    const ny = tx;
    const angle = Math.atan2(ty, tx) * 180 / Math.PI;
    if (clear) {
      const cell = span / 4;
      const cols = 4;
      const rows = 4;
      const mark = g.append("g")
        .attr("class", "track-finish")
        .attr("transform", "translate(" + mx + "," + my + ") rotate(" + angle + ")");
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          mark.append("rect")
            .attr("x", (col - cols / 2) * cell)
            .attr("y", (row - rows / 2) * cell)
            .attr("width", cell + 0.4)
            .attr("height", cell + 0.4)
            .attr("fill", (row + col) % 2 ? "#111111" : "#ffffff");
        }
      }
      return [mx, my];
    }
    const along = Math.max(6, span * 0.16);
    const cols = 6;
    const rows = 2;
    const cellW = span / cols;
    const cellH = along / rows;
    const mark = g.append("g").attr("class", "track-finish");
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const ox = (col + 0.5) * cellW - span / 2;
        const oy = (row + 0.5) * cellH - along / 2;
        mark.append("rect")
          .attr("x", -cellW / 2)
          .attr("y", -cellH / 2)
          .attr("width", cellW + 0.6)
          .attr("height", cellH + 0.6)
          .attr("fill", (row + col) % 2 ? "#111111" : "#f5f5f5")
          .attr("transform", "translate(" + (mx + nx * ox + tx * oy) + "," + (my + ny * ox + ty * oy) + ") rotate(" + angle + ")");
      }
    }
    return [mx, my];
  }

  function screenPoint(x, y, rotation, pose) {
    const angle = (rotation || 0) * Math.PI / 180;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    let sx = x * c - y * s;
    let sy = -(x * s + y * c);
    const turn = pose && pose.turn ? pose.turn : 0;
    if (turn) {
      const extra = turn * Math.PI / 180;
      const ca = Math.cos(extra);
      const sa = Math.sin(extra);
      const nx = sx * ca - sy * sa;
      const ny = sx * sa + sy * ca;
      sx = nx;
      sy = ny;
    }
    if (pose && pose.mirrorY) sy = -sy;
    return [sx, sy];
  }

  function tally(list) {
    return {
      n: list.length,
      lap1: list.filter((item) => item[5] === 1).length,
      turn1: list.filter((item) => item[2] === 1).length,
      unplaced: list.filter((item) => item[0] == null).length,
    };
  }

  function lastLap(row) {
    let max = 1;
    row.events.forEach((item) => {
      if (item[3] != null && item[3] > max) max = item[3];
    });
    return max;
  }

  function visibleEvents(row) {
    return row.events.filter((item) => {
      if (!selected.has(item[4])) return false;
      if (lap1Only && item[5] !== 1) return false;
      if (lapPick != null && item[3] !== lapPick) return false;
      if (window.FocusFilter && window.FocusFilter.active() && !window.FocusFilter.pair(row.year, item[8], item[9])) return false;
      return true;
    });
  }

  function draw() {
    const chart = document.getElementById("track-chart");
    const status = document.getElementById("track-status");
    if (!chart || !status) return;
    chart.replaceChildren();
    hideTip();
    const row = current();
    if (!row) {
      status.textContent = "No track map for this selection yet.";
      return;
    }
    const shown = visibleEvents(row);
    const all = tally(row.events);
    const now = tally(shown);
    const lapNote = lapPick == null ? "" : `lap ${lapPick} · `;
    status.textContent = `Showing ${now.n} of ${all.n} swaps · ${lapNote}lap 1 ${now.lap1} · turn 1 ${now.turn1} · unplaced ${now.unplaced}`;
    const title = document.getElementById("track-title");
    if (title) title.textContent = `4. Track map · ${row.year} ${row.gp} ${row.type}`;
    if (!row.centerline.length) {
      return;
    }

    const width = Math.max(1, Math.round(chart.clientWidth || 800));
    const height = Math.max(1, Math.round(chart.clientHeight || 520));
    const rotation = row.rotation || 0;
    const pose = orient[row.gp] || { turn: 0, mirrorY: false };
    const line = closeLoop(row.centerline.map((point) => screenPoint(point[0], point[1], rotation, pose)));
    const corners = (row.corners || []).map((corner) => ({
      ...corner,
      xy: screenPoint(corner.x, corner.y, rotation, pose),
    }));
    const dots = shown.filter((item) => item[0] != null).map((item) => ({
      item,
      xy: screenPoint(item[0], item[1], rotation, pose),
    }));
    const xs = line.map((point) => point[0]).concat(corners.map((corner) => corner.xy[0]));
    const ys = line.map((point) => point[1]).concat(corners.map((corner) => corner.xy[1]));
    const pad = 52;
    const x = d3.scaleLinear().domain(d3.extent(xs)).range([pad, width - pad]);
    const y = d3.scaleLinear().domain(d3.extent(ys)).range([height - pad, pad]);
    const finalPage = !!document.getElementById("track-lap");
    const stroke = finalPage ? 9 : 12;
    const ribbon = !finalPage ? 26 : (row.gp === "Baku" || row.gp === "Jeddah" ? 9 : 15);
    const half = stroke / 2;
    const svg = d3.select(chart).append("svg").attr("viewBox", `0 0 ${width} ${height}`);
    const g = svg.append("g");
    svg.call(d3.zoom().scaleExtent([1, 16]).on("zoom", (event) => {
      g.attr("transform", event.transform);
      hideTip();
    }));
    const screenLine = line.map((point) => [x(point[0]), y(point[1])]);
    g.append("path").attr("class", "track-line")
      .style("stroke-width", stroke + "px")
      .attr("d", d3.line().x((point) => x(point[0])).y((point) => y(point[1]))(line));
    drawHeat(
      g,
      screenLine,
      dots.map((dot) => [x(dot.xy[0]), y(dot.xy[1])]),
      width,
      height,
      ribbon
    );
    const finishSpan = finalPage ? ribbon : stroke;
    const finishAt = drawFinish(g, line, x, y, finishSpan, finalPage);
    const labelPad = half + 12;
    const cx = d3.mean(line, (point) => x(point[0]));
    const cy = d3.mean(line, (point) => y(point[1]));
    const labelAt = (px, py) => {
      if (finalPage) return placeBeside(screenLine, px, py, 28);
      const len = Math.hypot(px - cx, py - cy) || 1;
      return [px + ((px - cx) / len) * labelPad, py + ((py - cy) / len) * labelPad];
    };
    g.selectAll("text.track-corner").data(corners).join("text")
      .attr("class", "track-corner")
      .attr("x", (corner) => labelAt(x(corner.xy[0]), y(corner.xy[1]))[0])
      .attr("y", (corner) => labelAt(x(corner.xy[0]), y(corner.xy[1]))[1])
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .text((corner) => corner.number);
    if (finalPage && finishAt) {
      const flagAt = placeBeside(screenLine, finishAt[0], finishAt[1], 32);
      g.append("text")
        .attr("class", "track-corner")
        .attr("x", flagAt[0])
        .attr("y", flagAt[1])
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .style("font-size", "16px")
        .text("🏁");
    }

    const color = Object.fromEntries(tags.map((tag) => [tag[0], tag[2]]));
    g.selectAll("circle.track-dot").data(dots).join("circle")
      .attr("class", "track-dot")
      .attr("cx", (dot) => x(dot.xy[0]))
      .attr("cy", (dot) => y(dot.xy[1]))
      .attr("r", 4.5)
      .attr("fill", (dot) => color[dot.item[4]] || "#fff")
      .attr("stroke", (dot) => (document.getElementById("track-lap1") && dot.item[5] ? "#fff" : "none"))
      .attr("stroke-width", (dot) => (document.getElementById("track-lap1") && dot.item[5] ? 1.2 : 0))
      .on("mousemove", (event, dot) => showTip(event, dot.item))
      .on("mouseleave", hideTip);
  }

  function paint() {
    document.querySelectorAll("#track-tags button").forEach((button) => {
      const on = button.dataset.tag === "all" ? selected.size === tags.length
        : button.dataset.tag === "none" ? selected.size === 0
        : selected.has(button.dataset.tag);
      button.classList.toggle("on", on);
    });
    const lapInput = document.getElementById("track-lap");
    const lapLabel = document.getElementById("track-lap-label");
    const lapAll = document.getElementById("track-lap-all");
    if (lapInput) {
      const row = current();
      lapInput.max = row ? lastLap(row) : 1;
      if (lapPick != null) lapInput.value = lapPick;
      if (lapLabel) lapLabel.textContent = "Lap " + (lapPick == null ? lapInput.value : lapPick);
      if (lapAll) lapAll.classList.toggle("on", lapPick == null);
    }
    const lap1Button = document.getElementById("track-lap1");
    if (lap1Button) lap1Button.classList.toggle("on", lap1Only);
    const yearBar = document.getElementById("track-year");
    if (!yearBar) {
      sessionKey = lockedKey;
      draw();
      return;
    }
    yearBar.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("on", Number(button.dataset.year) === year);
    });
    const names = [...new Set(optionsForYear().map((row) => row.gp))].sort();
    if (!names.includes(gp)) gp = names[0] || "";
    const gpSelect = document.getElementById("track-gp");
    gpSelect.replaceChildren(...names.map((name) => new Option(name, name)));
    gpSelect.value = gp;
    const choices = optionsForYear().filter((row) => row.gp === gp)
      .sort((a, b) => (a.type === "Race" ? -1 : 1) - (b.type === "Race" ? -1 : 1));
    if (!choices.some((row) => String(row.key) === sessionKey)) sessionKey = choices.length ? String(choices[0].key) : "";
    const sessionSelect = document.getElementById("track-session");
    sessionSelect.replaceChildren(...choices.map((row) => new Option(row.type, String(row.key))));
    sessionSelect.value = sessionKey;
    draw();
  }

  function init() {
    const tagBar = document.getElementById("track-tags");
    const legend = document.getElementById("track-legend");
    if (!tagBar || !legend) return;
    const allButton = document.getElementById("track-lap") ? `<button type="button" class="chip" data-tag="all">All</button><button type="button" class="chip" data-tag="none">None</button>` : "";
    tagBar.innerHTML = allButton + tags.map(([id, label]) => `<button type="button" class="chip" data-tag="${id}">${label}</button>`).join("");
    const lap1Note = document.getElementById("track-lap1") ? "<span>White ring = lap 1</span>" : "";
    legend.innerHTML = tags.map(([, label, color]) => `<span><i class="track-swatch" style="background:${color}"></i>${label}</span>`).join("") +
      "<span><i class=\"track-heat-swatch\"></i>Fewer → more overtakes</span><span><i class=\"track-finish-swatch\"></i>Finish line</span>" + lap1Note;
    const yearBar = document.getElementById("track-year");
    if (yearBar) {
      if (document.getElementById("track-lap")) {
        const locked = sessions.find((row) => String(row.key) === lockedKey);
        if (locked) {
          year = locked.year;
          gp = locked.gp;
          sessionKey = lockedKey;
        }
      }
      yearBar.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-year]");
        if (!button) return;
        year = Number(button.dataset.year);
        gp = "";
        sessionKey = "";
        lapPick = null;
        const lapInput = document.getElementById("track-lap");
        if (lapInput) lapInput.value = "1";
        paint();
      });
      document.getElementById("track-gp").addEventListener("change", (event) => {
        gp = event.target.value;
        sessionKey = "";
        lapPick = null;
        const lapInput = document.getElementById("track-lap");
        if (lapInput) lapInput.value = "1";
        paint();
      });
      document.getElementById("track-session").addEventListener("change", (event) => {
        sessionKey = event.target.value;
        lapPick = null;
        const lapInput = document.getElementById("track-lap");
        if (lapInput) lapInput.value = "1";
        paint();
      });
    } else {
      const locked = sessions.find((row) => String(row.key) === lockedKey);
      if (locked) {
        year = locked.year;
        gp = locked.gp;
        sessionKey = lockedKey;
      }
    }
    tagBar.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-tag]");
      if (!button) return;
      if (button.dataset.tag === "all") tags.forEach(([id]) => selected.add(id));
      else if (button.dataset.tag === "none") selected.clear();
      else if (selected.has(button.dataset.tag)) selected.delete(button.dataset.tag);
      else selected.add(button.dataset.tag);
      paint();
    });
    const lap1Button = document.getElementById("track-lap1");
    if (lap1Button) {
      lap1Button.addEventListener("click", () => {
        lap1Only = !lap1Only;
        paint();
      });
    }
    const lapInput = document.getElementById("track-lap");
    if (lapInput) {
      lapInput.addEventListener("input", () => {
        lapPick = Number(lapInput.value);
        paint();
      });
    }
    const lapAll = document.getElementById("track-lap-all");
    if (lapAll) {
      lapAll.addEventListener("click", () => {
        lapPick = null;
        paint();
      });
    }
    paint();
  }

  return { init, draw };
})();
