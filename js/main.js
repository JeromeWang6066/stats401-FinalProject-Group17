(function () {
  const data = window.APP_DATA;
  if (!data) {
    document.body.insertAdjacentHTML("afterbegin", "<p>Missing js/data.js. Run python3 src/export_frontend.py first.</p>");
    return;
  }

  const state = window.AppState.init(data);
  const yearBar = document.getElementById("year-seg");
  const tagBar = document.getElementById("tag-chips");
  const gpToggle = document.getElementById("gp-toggle");
  const gpMenu = document.getElementById("gp-menu");
  const gpList = document.getElementById("gp-list");
  const networkEl = document.getElementById("network");
  const bumpEl = document.getElementById("bump");
  const slider = document.getElementById("min-weight");

  function paintYears() {
    const current = state.get().year;
    yearBar.querySelectorAll("button").forEach((btn) => {
      const value = btn.dataset.year === "all" ? "all" : +btn.dataset.year;
      btn.classList.toggle("on", value === current);
    });
  }

  function paintTags() {
    const selected = state.get().tags;
    tagBar.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("on", selected.has(btn.dataset.tag));
    });
  }

  function paintGps() {
    const snap = state.get();
    const names = state.gpsForYear(snap.year);
    gpList.innerHTML = names.map((name) => {
      const checked = snap.gps.has(name) ? "checked" : "";
      return `<label><input type="checkbox" value="${name}" ${checked} />${name}</label>`;
    }).join("");
    const n = snap.gps.size;
    gpToggle.textContent = n === names.length && n > 0 ? `Grand Prix · all ${n}` : `Grand Prix · ${n}`;
  }

  function render() {
    paintYears();
    paintTags();
    paintGps();
    window.OvertakeNetwork.render(networkEl, data, state.get());
  }

  yearBar.addEventListener("click", (event) => {
    const btn = event.target.closest("button");
    if (!btn) return;
    state.setYear(btn.dataset.year);
  });

  tagBar.innerHTML = window.AppState.TAGS.map(
    (tag) => `<button type="button" class="chip" data-tag="${tag.id}">${tag.label}</button>`
  ).join("");
  tagBar.addEventListener("click", (event) => {
    const btn = event.target.closest("button");
    if (!btn) return;
    state.toggleTag(btn.dataset.tag);
  });

  gpToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    gpMenu.classList.toggle("open");
  });
  gpMenu.addEventListener("click", (event) => event.stopPropagation());
  gpMenu.addEventListener("change", (event) => {
    const box = event.target;
    if (box.type !== "checkbox") return;
    const chosen = [...gpList.querySelectorAll("input:checked")].map((el) => el.value);
    state.setGps(chosen);
  });
  document.getElementById("gp-all").addEventListener("click", () => state.selectAllGps());
  document.getElementById("gp-none").addEventListener("click", () => state.clearGps());
  document.addEventListener("click", () => gpMenu.classList.remove("open"));

  slider.addEventListener("input", (event) => {
    document.getElementById("min-weight-label").textContent = event.target.value;
    state.setMinWeight(event.target.value);
  });

  state.subscribe(render);
  if (window.LapChart) window.LapChart.init();
  if (window.RankBump && bumpEl) window.RankBump.render(bumpEl, data);
  window.addEventListener("resize", () => {
    window.OvertakeNetwork.render(networkEl, data, state.get());
    if (window.RankBump && bumpEl) window.RankBump.render(bumpEl, data);
  });
  render();
})();
