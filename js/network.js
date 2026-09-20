window.OvertakeNetwork = (function () {
  let sim = null;

  function colorOf(driver, year) {
    if (!driver) return "#888888";
    if (year !== "all" && driver.years[year]) return "#" + driver.years[year].color;
    const keys = Object.keys(driver.years).sort();
    const last = keys[keys.length - 1];
    return last ? "#" + driver.years[last].color : "#888888";
  }

  function teamOf(driver, year) {
    if (!driver) return "";
    if (year !== "all" && driver.years[year]) return driver.years[year].team;
    const keys = Object.keys(driver.years).sort();
    const last = keys[keys.length - 1];
    return last ? driver.years[last].team : "";
  }

  function radiusOf(node) {
    return 8 + Math.sqrt(Math.max(node.net, 0));
  }

  function edgePoint(d, isSource) {
    const s = d.source;
    const t = d.target;
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const dist = Math.hypot(dx, dy) || 1;
    const pad = isSource ? radiusOf(s) : radiusOf(t);
    const ratio = pad / dist;
    if (isSource) return [s.x + dx * ratio, s.y + dy * ratio];
    return [t.x - dx * ratio, t.y - dy * ratio];
  }

  function weightT(weight, minCount, maxCount) {
    if (!(maxCount > minCount)) return 0.5;
    return (weight - minCount) / (maxCount - minCount);
  }

  function weightColor(t) {
    return d3.interpolateRgb("#5b5b66", "#e10600")(t);
  }

  function strokeWidthOf(t) {
    return 1.4 + t * 6.1;
  }

  function aggregate(data, state) {
    const yearOk = state.year === "all" ? null : +state.year;
    const directed = new Map();
    let eventCount = 0;
    for (const row of data.edges) {
      const [year, gp, tag, a, b, n] = row;
      if (yearOk != null && year !== yearOk) continue;
      if (!state.gps.has(gp)) continue;
      if (!state.tags.has(tag)) continue;
      const key = a + ">" + b;
      directed.set(key, (directed.get(key) || 0) + n);
      eventCount += n;
    }

    const pairs = new Map();
    directed.forEach((count, key) => {
      const [a, b] = key.split(">");
      const left = a < b ? a : b;
      const right = a < b ? b : a;
      const rec = pairs.get(left + "|" + right) || {
        left,
        right,
        source: left,
        target: right,
        forward: 0,
        back: 0,
        weight: 0,
      };
      if (a < b) rec.forward += count;
      else rec.back += count;
      rec.weight = rec.forward + rec.back;
      pairs.set(left + "|" + right, rec);
    });

    const allPairs = [...pairs.values()];
    const maxCount = d3.max(allPairs, (d) => d.weight) || 0;
    const kept = allPairs.filter((d) => d.weight >= state.minWeight);
    const ids = new Set();
    kept.forEach((d) => {
      ids.add(d.left);
      ids.add(d.right);
    });

    const totals = new Map();
    directed.forEach((count, key) => {
      const [a, b] = key.split(">");
      const recA = totals.get(a) || { out: 0, inn: 0 };
      recA.out += count;
      totals.set(a, recA);
      const recB = totals.get(b) || { out: 0, inn: 0 };
      recB.inn += count;
      totals.set(b, recB);
    });

    const nodes = [...ids].sort().map((id) => {
      const info = data.drivers[id];
      const rec = totals.get(id) || { out: 0, inn: 0 };
      return {
        id,
        out: rec.out,
        inn: rec.inn,
        net: rec.out - rec.inn,
        info,
        color: colorOf(info, state.year),
        team: teamOf(info, state.year),
      };
    });

    return { nodes, pairs: kept, maxWeight: maxCount, eventCount, pairCount: allPairs.length };
  }

  function raceResult(data, state, acronym) {
    if (state.year === "all" || state.gps.size !== 1) return null;
    const gp = [...state.gps][0];
    return data.sessionResults.find(
      (row) => row.year === +state.year && row.grandPrix === gp && row.acronym === acronym
    ) || null;
  }

  function standing(data, state, acronym) {
    if (state.year === "all" || state.gps.size <= 1) return null;
    return data.standings.find(
      (row) => row.year === +state.year && row.acronym === acronym
    ) || null;
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
    document.getElementById("tip").hidden = true;
  }

  function nodeTip(node, data, state) {
    const info = node.info || {};
    const race = raceResult(data, state, node.id);
    const rank = standing(data, state, node.id);
    const net = node.net > 0 ? "+" + node.net : String(node.net);
    let extra = "";
    if (race) {
      extra = `<p>Grid <strong>P${race.startPos}</strong> → finish <strong>P${race.endPos}</strong></p>`;
    } else if (rank) {
      extra = `<p>${rank.year} championship <strong>P${rank.position}</strong> · ${rank.points} pts</p>`;
    }
    return `
      <p class="tip-kicker">${node.team || ""}</p>
      <p class="tip-title">${node.id}</p>
      <p>${info.name || ""} · #${info.number || ""}</p>
      <p>Passes <strong>${node.out}</strong> · passed <strong>${node.inn}</strong> · net <strong>${net}</strong></p>
      ${extra}
    `;
  }

  function edgeTip(d) {
    return `
      <p class="tip-kicker">Pairing</p>
      <p class="tip-title">${d.left} and ${d.right}</p>
      <p>${d.left} → ${d.right}　<strong>${d.forward}</strong></p>
      <p>${d.right} → ${d.left}　<strong>${d.back}</strong></p>
      <p>Total <strong>${d.weight}</strong></p>
    `;
  }

  function render(el, data, state) {
    const width = el.clientWidth || 800;
    const height = el.clientHeight || 560;
    const graph = aggregate(data, state);
    el.innerHTML = "";
    if (sim) {
      sim.stop();
      sim = null;
    }

    const minShown = graph.pairs.length ? d3.min(graph.pairs, (d) => d.weight) : 0;
    const maxShown = graph.pairs.length ? d3.max(graph.pairs, (d) => d.weight) : 0;
    const status = document.getElementById("network-status");
    if (status) {
      const range = graph.pairs.length
        ? ` · stroke scaled to <em>${minShown}–${maxShown}</em>`
        : "";
      status.innerHTML = `Current filter: <em>${graph.eventCount.toLocaleString()}</em> swaps · <em>${graph.nodes.length}</em> drivers · <em>${graph.pairs.length}</em> edges${range}`;
    }
    const slider = document.getElementById("min-weight");
    const sliderLabel = document.getElementById("min-weight-label");
    if (slider) {
      slider.max = String(Math.max(state.minWeight, graph.maxWeight, 1));
      slider.value = String(state.minWeight);
      if (sliderLabel) sliderLabel.textContent = String(state.minWeight);
    }

    const svg = d3.select(el).append("svg").attr("width", width).attr("height", height);
    if (!graph.pairs.length) {
      svg.append("text")
        .attr("x", width / 2)
        .attr("y", height / 2)
        .attr("text-anchor", "middle")
        .attr("fill", "#9ca3af")
        .attr("font-size", 13)
        .text("No edges. Loosen the slider, change tags, or pick more grands prix.");
      hideTip();
      return graph;
    }

    graph.pairs.forEach((d) => {
      d.t = weightT(d.weight, minShown, maxShown);
      d.baseOpacity = 0.34 + 0.56 * d.t;
    });

    const hit = svg.append("g").attr("class", "hits");
    const link = svg.append("g")
      .selectAll("line.visible")
      .data(graph.pairs)
      .join("line")
      .attr("class", "visible")
      .attr("stroke", (d) => weightColor(d.t))
      .attr("stroke-width", (d) => strokeWidthOf(d.t))
      .attr("stroke-linecap", "round")
      .attr("opacity", (d) => d.baseOpacity);

    const hitLines = hit.selectAll("line")
      .data(graph.pairs)
      .join("line")
      .attr("stroke", "transparent")
      .attr("stroke-width", 14)
      .style("cursor", "pointer")
      .on("mouseenter", (event, d) => {
        highlight(d.left, d.right);
        fillTip(edgeTip(d));
        moveTip(event);
      })
      .on("mousemove", moveTip)
      .on("mouseleave", () => {
        highlight(null);
        hideTip();
      });

    const node = svg.append("g")
      .selectAll("circle")
      .data(graph.nodes)
      .join("circle")
      .attr("r", (d) => radiusOf(d))
      .attr("fill", (d) => d.color)
      .attr("stroke", "#07070a")
      .attr("stroke-width", 1.5)
      .style("cursor", "pointer")
      .on("mouseenter", (event, d) => {
        highlight(d.id);
        fillTip(nodeTip(d, data, state));
        moveTip(event);
      })
      .on("mousemove", moveTip)
      .on("mouseleave", () => {
        highlight(null);
        hideTip();
      })
      .call(
        d3.drag()
          .on("start", (event, d) => {
            hideTip();
            if (!event.active && sim) sim.alphaTarget(0.25).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active && sim) sim.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    const label = svg.append("g")
      .selectAll("text")
      .data(graph.nodes)
      .join("text")
      .attr("class", "network-label")
      .attr("text-anchor", "middle")
      .attr("dy", 18)
      .text((d) => d.id);

    function highlight(a, b) {
      const on = a != null;
      link.attr("opacity", (d) => {
        if (!on) return d.baseOpacity;
        const hitEdge = (d.left === a && d.right === b) || (d.right === a && d.left === b);
        const hitNode = b == null && (d.left === a || d.right === a);
        return hitEdge || hitNode ? 1 : 0.08;
      });
      node.attr("opacity", (d) => {
        if (!on) return 1;
        if (b == null) return d.id === a || graph.pairs.some((p) => (p.left === a || p.right === a) && (p.left === d.id || p.right === d.id)) ? 1 : 0.18;
        return d.id === a || d.id === b ? 1 : 0.18;
      });
      label.attr("opacity", (d) => {
        if (!on) return 1;
        if (b == null) return d.id === a ? 1 : 0.35;
        return d.id === a || d.id === b ? 1 : 0.35;
      });
    }

    const loose = state.minWeight <= 1;
    const dense = graph.pairs.length > 60;
    const sparse = graph.nodes.length <= 10 && graph.pairs.length <= 20;
    const pad = 28;
    const initR = Math.min(width, height) * (dense ? 0.34 : (sparse ? 0.22 : (loose ? 0.38 : 0.28)));
    graph.nodes.forEach((d, i) => {
      const angle = (i / graph.nodes.length) * Math.PI * 2 - Math.PI / 2;
      d.x = width / 2 + Math.cos(angle) * initR;
      d.y = height / 2 + Math.sin(angle) * initR;
    });

    function clamp(d) {
      const r = radiusOf(d) + 6;
      d.x = Math.max(pad, Math.min(width - pad, d.x));
      d.y = Math.max(r + 8, Math.min(height - pad - 10, d.y));
    }

    function tick() {
      graph.nodes.forEach(clamp);
      const place = (sel) => {
        sel
          .attr("x1", (d) => edgePoint(d, true)[0])
          .attr("y1", (d) => edgePoint(d, true)[1])
          .attr("x2", (d) => edgePoint(d, false)[0])
          .attr("y2", (d) => edgePoint(d, false)[1]);
      };
      place(link);
      place(hitLines);
      node.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
      label.attr("x", (d) => d.x).attr("y", (d) => d.y);
    }

    sim = d3.forceSimulation(graph.nodes)
      .force("link", d3.forceLink(graph.pairs).id((d) => d.id)
        .distance(dense ? 200 : (sparse ? 160 : (loose ? 148 : 92)))
        .strength(dense ? 0.06 : (loose ? 0.22 : 0.45)))
      .force("charge", d3.forceManyBody().strength(dense ? -520 : (sparse ? -280 : (loose ? -320 : -180))))
      .force("x", d3.forceX(width / 2).strength(dense ? 0.06 : (loose ? 0.03 : 0.08)))
      .force("y", d3.forceY(height / 2).strength(dense ? 0.06 : (loose ? 0.03 : 0.08)))
      .force("collide", d3.forceCollide().radius((d) => radiusOf(d) + (dense ? 40 : (sparse ? 32 : (loose ? 28 : 18)))).strength(0.9))
      .on("tick", tick);

    return graph;
  }

  return { render };
})();
