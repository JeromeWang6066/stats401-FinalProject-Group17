window.AppState = (function () {
  const TAGS = [
    { id: "on_track", label: "True pass" },
    { id: "pit", label: "Pit" },
    { id: "retired", label: "Retired" },
    { id: "under_sc", label: "Neutralized" },
    { id: "unlap_under_sc", label: "Unlapping" },
    { id: "formation", label: "Formation" },
    { id: "post_race", label: "Post-race" },
  ];

  let data = null;
  let year = 2025;
  let gps = new Set();
  let tags = new Set(["on_track"]);
  let minWeight = 2;
  const listeners = [];

  function gpsForYear(y) {
    if (y === "all") {
      const all = new Set();
      Object.keys(data.gps).forEach((key) => {
        data.gps[key].forEach((name) => all.add(name));
      });
      return [...all].sort();
    }
    return (data.gps[String(y)] || []).slice();
  }

  function snapshot() {
    return {
      year,
      gps: new Set(gps),
      tags: new Set(tags),
      minWeight,
    };
  }

  function emit() {
    const next = snapshot();
    listeners.forEach((fn) => fn(next));
  }

  return {
    TAGS,
    init(payload) {
      data = payload;
      year = 2025;
      gps = new Set(gpsForYear(year));
      tags = new Set(["on_track"]);
      minWeight = 2;
      return this;
    },
    subscribe(fn) {
      listeners.push(fn);
    },
    get: snapshot,
    gpsForYear,
    setYear(next) {
      year = next === "all" ? "all" : +next;
      gps = new Set(gpsForYear(year));
      emit();
    },
    setGps(names) {
      gps = new Set(names);
      emit();
    },
    toggleGp(name) {
      if (gps.has(name)) gps.delete(name);
      else gps.add(name);
      emit();
    },
    selectAllGps() {
      gps = new Set(gpsForYear(year));
      emit();
    },
    clearGps() {
      gps = new Set();
      emit();
    },
    toggleTag(id) {
      if (tags.has(id)) tags.delete(id);
      else tags.add(id);
      emit();
    },
    setMinWeight(value) {
      minWeight = Math.max(1, +value || 1);
      emit();
    },
  };
})();
