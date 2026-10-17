window.FocusFilter = (function () {
  const drivers = (window.APP_DATA && window.APP_DATA.drivers) || {};
  const byName = new Map();
  Object.keys(drivers).forEach((acronym) => {
    byName.set(acronym, acronym);
    const name = drivers[acronym] && drivers[acronym].name;
    if (name) byName.set(name, acronym);
  });

  let teamId = "";
  let driverId = "";
  let open = "";

  function teamNames() {
    const names = new Set();
    Object.keys(drivers).forEach((acronym) => {
      const years = (drivers[acronym] && drivers[acronym].years) || {};
      Object.keys(years).forEach((year) => {
        if (years[year].team) names.add(years[year].team);
      });
    });
    return [...names].sort();
  }

  function driverList() {
    return Object.keys(drivers)
      .sort()
      .map((acronym) => ({ id: acronym, name: drivers[acronym].name || acronym }));
  }

  function onRoster(acronym, team) {
    const years = (drivers[acronym] && drivers[acronym].years) || {};
    return Object.keys(years).some((year) => years[year].team === team);
  }

  function visibleDrivers() {
    const list = driverList();
    if (!teamId) return list;
    return list.filter((driver) => onRoster(driver.id, teamId));
  }

  function acronymOf(label) {
    if (!label) return "";
    return byName.get(label) || "";
  }

  function teamOf(acronym, year) {
    const info = drivers[acronym];
    if (!info || !info.years) return "";
    const season = info.years[year] || info.years[String(year)];
    return season ? season.team : "";
  }

  function get() {
    if (driverId) return { kind: "driver", id: driverId };
    if (teamId) return { kind: "team", id: teamId };
    return { kind: "all", id: "" };
  }

  function active() {
    return get().kind !== "all";
  }

  function hit(year, label) {
    if (!active()) return true;
    const acronym = acronymOf(label);
    if (!acronym) return false;
    const pick = get();
    if (pick.kind === "driver") return acronym === pick.id;
    return teamOf(acronym, year) === pick.id;
  }

  function pair(year, passing, passed) {
    if (!active()) return true;
    return hit(year, passing) || hit(year, passed);
  }

  function chip(label, chipKind, chipId, title) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = label;
    button.dataset.kind = chipKind;
    button.dataset.id = chipId;
    if (title) button.title = title;
    const on = chipKind === "team" ? chipId === teamId : chipId === driverId;
    button.classList.toggle("on", on);
    return button;
  }

  function paintTriggers() {
    const teamBtn = document.getElementById("focus-team-btn");
    const driverBtn = document.getElementById("focus-driver-btn");
    const teamValue = document.getElementById("focus-team-value");
    const driverValue = document.getElementById("focus-driver-value");
    if (!teamBtn || !driverBtn || !teamValue || !driverValue) return;
    teamValue.textContent = teamId || "All";
    driverValue.textContent = driverId || "All";
    driverValue.title = driverId && drivers[driverId] ? drivers[driverId].name || "" : "";
    teamBtn.classList.toggle("is-set", Boolean(teamId));
    driverBtn.classList.toggle("is-set", Boolean(driverId));
    teamBtn.setAttribute("aria-expanded", open === "team" ? "true" : "false");
    driverBtn.setAttribute("aria-expanded", open === "driver" ? "true" : "false");
  }

  function paintDrawer() {
    const drawer = document.getElementById("focus-drawer");
    if (!drawer) return;
    drawer.replaceChildren();
    drawer.hidden = !open;
    if (!open) return;
    if (open === "team") {
      drawer.append(
        chip("All", "team", ""),
        ...teamNames().map((name) => chip(name, "team", name)),
      );
      return;
    }
    drawer.append(
      chip("All", "driver", ""),
      ...visibleDrivers().map((driver) => chip(driver.id, "driver", driver.id, driver.name)),
    );
  }

  function paint() {
    paintTriggers();
    paintDrawer();
  }

  function choose(nextKind, nextId) {
    if (nextKind === "team") {
      teamId = nextId;
      if (driverId && teamId && !onRoster(driverId, teamId)) driverId = "";
    } else {
      driverId = nextId;
    }
    open = "";
    paint();
    redraw();
  }

  function toggle(which) {
    open = open === which ? "" : which;
    paint();
  }

  function onClick(event) {
    const trigger = event.target.closest(".focus-trigger");
    if (trigger) {
      toggle(trigger.dataset.drawer);
      return;
    }
    const button = event.target.closest("#focus-drawer button[data-kind]");
    if (!button) return;
    choose(button.dataset.kind, button.dataset.id || "");
  }

  function redraw() {
    const network = document.getElementById("network");
    const snap = window.AppState && window.AppState.get();
    if (window.OvertakeNetwork && network && snap) {
      window.OvertakeNetwork.render(network, window.APP_DATA, snap);
    }
    if (window.LapChart && window.LapChart.draw) window.LapChart.draw();
    const bump = document.getElementById("bump");
    if (window.RankBump && bump) window.RankBump.render(bump, window.APP_DATA);
    if (window.TrackMap && window.TrackMap.draw) window.TrackMap.draw();
    if (window.SessionMix && window.SessionMix.draw) window.SessionMix.draw();
  }

  const bar = document.getElementById("focus-bar");
  bar.addEventListener("click", onClick);
  document.addEventListener("click", (event) => {
    if (!open || bar.contains(event.target)) return;
    open = "";
    paint();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !open) return;
    open = "";
    paint();
  });
  paint();

  return { get, active, hit, pair };
})();
