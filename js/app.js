// app.js: Connects page to other files.
 
const state = {
    busy: false,         // true while  search is running
    lastGeocodeAt: 0,    // when Nomatim was last queried for 1 second wait time
};
 
// Pause for milliseconds.
function wait(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}
 
// Show a message in red box under search bar
function showError(html) {
    const card = document.getElementById("error-card");
    card.innerHTML = html;
    card.hidden = false;
}
 
// Find the lowest and highest ground in a list of heights (null = no data).
function groundStats(elevations) {
    let lowest = null;
    let highest = null;
    let sum = 0;
    let count = 0;
    elevations.forEach(function (height, i) {
        if (height === null) return;
        if (lowest === null || height < elevations[lowest]) lowest = i;
        if (highest === null || height > elevations[highest]) highest = i;
        sum += height;
        count++;
    });
    if (count === 0) return null;
    return {
        lag: elevations[lowest], lagIndex: lowest,
        hag: elevations[highest], hagIndex: highest,
        mean: sum / count,
        count: count,
        missing: elevations.length - count,
    };
}
 
 
// Put plain text into element with this id
function setText(id, text) {
    document.getElementById(id).textContent = text;
}

// Show answer for one finished check (r) on page
function render(r) {
    const v = r.verdict;

    const card = document.getElementById("verdict");
    card.className = "card verdict tone-" + v.tone;

    setText("v-address", r.geo.matchedAddress);
    setText("v-badge", v.badge);
    setText("v-title", v.title);
    setText("v-found", v.found);
    setText("v-meaning", v.meaning);
    setText("v-next", v.next);

    renderStats(r);
    renderWarnings(r);

    document.getElementById("verdict").hidden = false;
    card.scrollIntoView({ behavior: "smooth", block: "start" });

    // Tabs under the answer
    const canDraw = r.verdict.diff != null;
    document.getElementById("tab-ground").hidden = !canDraw;
    document.getElementById("tab-tech").hidden = false;
    renderCharts(r);
    renderDetails(r);
    selectTab(canDraw ? "tab-ground" : "tab-map");
}

// The three numbers, only when we measured the ground
function renderStats(r) {
    const box = document.getElementById("v-stats");
    box.innerHTML = "";
    box.hidden = r.verdict.diff == null;
    if (box.hidden) return;

    const diff = r.verdict.diff;
    addStat(box, "Flood height", r.zone.bfe.toFixed(1) + " ft");
    addStat(box, "Lowest ground at the house", r.stats.lag.toFixed(1) + " ft");
    addStat(box, diff >= 0 ? "House is higher by" : "House is lower by", Math.abs(diff).toFixed(1) + " ft");
}

// Add one label + number pair to a <dl>
function addStat(box, label, value) {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    row.append(dt, dd);
    box.append(row);
}

// Bullet points for any extra cautions (usually none)
function renderWarnings(r) {
    const list = document.getElementById("v-warnings");
    list.innerHTML = "";
    r.verdict.warnings.forEach(function (text) {
        const li = document.createElement("li");
        li.textContent = text;
        list.append(li);
    });
}

// Progress list
const steps = {
    // Every step back to grey
    reset: function () {
        document.querySelectorAll("#steps li").forEach(function (li) {
            li.className = "";
            li.querySelector("small").textContent = "";
        });
    },
    // Mark one step
    set: function (name, status, detail) {
        const li = document.querySelector(`#steps li[data-step="${name}"]`);
        li.className = "is-" + status;
        li.querySelector("small").textContent = detail || "";
    },
};

// Full single search function: address to coordinates to pin.
async function run(address) {
    if (state.busy) return;
    state.busy = true;
    document.getElementById("search-btn").disabled = true;
    document.getElementById("error-card").hidden = true;
    showMapOnly();
    steps.reset();
    document.getElementById("pipeline").hidden = false;
    HG.map.showZone(null);
    document.getElementById("zone-summary").textContent = "";
    
    
    //document.getElementById("ground-result").textContent = "";
 
    try {
        // Nominatim rule: max one request per second.
        steps.set("geocode", "working");
        const since = Date.now() - state.lastGeocodeAt;
        if (since < 1100) await wait(1100 - since);
        state.lastGeocodeAt = Date.now();
 
        const geo = await HG.live.geocode(address);
        if (!geo) {
            steps.set("geocode", "error", "Not found");
            showError("<p><b>We couldn't find that address in Massachusetts.</b> Try adding the town and \"MA\", for example: <i>1 Main Street, Concord, MA</i>.</p>");
            return;
        }
        steps.set("geocode", "done");
 
        HG.map.clear();
        HG.map.showPin(geo.lat, geo.lon, geo.matchedAddress);
 
        // Creates an object r with search results
        const r = { geo: geo, zone: null };
 
        // Ask FEMA which flood zone the pin lands in
        const zoneSummary = document.getElementById("zone-summary");
        zoneSummary.textContent = "Reading FEMA's flood map for this spot...";
        try {
            steps.set("zone", "working");
            r.zone = await getFloodZone(geo.lon, geo.lat);
            steps.set("zone", "done");
            HG.map.showZone(r.zone.polygon);
            const words = describeZone(r.zone);
            zoneSummary.textContent = `${words.title}. ${words.text}`;
        } catch (err) {
            steps.set("zone", "error", "FEMA didn't answer");
            console.error(err);
            zoneSummary.textContent = "FEMA's flood map didn't answer. It may be busy or down, so try again in a minute.";
        }
 
        // House outline
        steps.set("footprint", "working");
        let footprint = null;
        try {
            footprint = await getFootprint(geo.lon, geo.lat);
        } catch (err) {
            console.error(err);
        }
 
        if (footprint === null) {
            const radius = HG.config.sampling.fallbackRadiusMeters;
            footprint = {
                ring: circleRing(geo.lon, geo.lat, radius),
                source: "Estimated circle (no building outline found)",
                note: `We measured a ${radius} m circle around the pin instead.`,
                estimated: true,
            };
        }
        r.footprint = footprint;
        HG.map.showFootprint(footprint.ring);
        steps.set("footprint", "done");
 
        // Measuring points around the house
        steps.set("elevation", "working");
        r.sampling = samplePerimeter(footprint.ring, HG.config.sampling);
 
        //document.getElementById("ground-result").textContent = "Measuring the ground around the house...";
        const points = r.sampling.samples.map((s) => s.lonlat);
        r.elevations = await getElevations(points);
 
        r.stats = groundStats(r.elevations);
        steps.set("elevation", r.stats ? "done" : "error");
        HG.map.showSamples(r.sampling.samples, r.elevations, r.stats ? r.stats.lagIndex : -1);
        //showGround(r);
        // the answer (new)
        steps.set("verdict", "working");
        r.verdict = HG.verdict.decide(r.zone, r.stats);
        if (r.footprint.estimated && r.stats) {
            r.verdict.warnings.push("We couldn't find this building's outline, so we measured in a circle around the map pin. Check on the map that the pin is on your house.");
        }
        state.result = r;
        steps.set("verdict", "done");
        document.getElementById("pipeline").hidden = true;
        render(r);
    } catch (err) {
        console.error(err);
        const running = document.querySelector("#steps li.is-working");
        if (running) running.className = "is-error";
        showError("<p><b>One of the government map services didn't answer.</b> It may be down or busy. Try again in a minute. The red dot shows which step failed.</p>");
    } finally {
        state.busy = false;
        document.getElementById("search-btn").disabled = false;
    }
}


// Show one tab's panel and hide others
function selectTab(tabId) {
    document.querySelectorAll(".tabs button").forEach((tab) => {
        const isThisOne = tab.id === tabId;
        tab.setAttribute("aria-selected", isThisOne);
        const panel = document.getElementById(tab.getAttribute("aria-controls"));
        panel.hidden = !isThisOne;
    });
    // Ask to measure size of hidden maps
    if (tabId === "tab-map") HG.map.refit();
}
// Make every tab button call selectTab when clicked
function initTabs() {
    document.querySelectorAll(".tabs button").forEach((tab) => {
        tab.addEventListener("click", () => selectTab(tab.id));
    });
}

// Before an answer show only the map, so people can explore
function showMapOnly() {
    document.getElementById("results").hidden = false;
    document.getElementById("verdict").hidden = true;
    document.getElementById("tab-ground").hidden = true;
    document.getElementById("tab-tech").hidden = true;
    selectTab("tab-map");
}

// Ground-height pictures and slider
function renderCharts(r) {
    if (r.verdict.diff == null) return; // no ground vs flood comparison

    const bfe = r.zone.bfe;
    const lag = r.stats.lagIndex;

    const profile = HG.charts.profile(document.getElementById("profile"), {
        samples: r.sampling.samples,
        elevations: r.elevations,
        bfe: bfe,
        lagIndex: lag,
        perimeterMeters: r.sampling.perimeterMeters,
    });

    const plan = HG.charts.sitePlan(document.getElementById("siteplan"), {
    ring: r.footprint.ring,
    samples: r.sampling.samples,
    elevations: r.elevations,
    lagIndex: lag,
    bfe: bfe,
    });

    // Slider covers chart's whole height
    const slider = document.getElementById("water");
    slider.min = profile.low.toFixed(1);
    slider.max = profile.high.toFixed(1);
    slider.value = bfe.toFixed(1);

    function update() {
        const level = Number(slider.value);
        profile.setWater(level);
        plan.recolor(level);
        HG.map.recolor(r.elevations, level, lag);
        document.getElementById("water-out").textContent = `${level.toFixed(1)} ft`;

        // Say it in words
        const wet = r.elevations.filter((h) => h != null && h < level).length;
        const diff = level - bfe;
        let where = "At FEMA's flood height";
        if (diff >= 0.05) where = `${diff.toFixed(1)} ft above FEMA's flood height`;
        if (diff <= -0.05) where = `${(-diff).toFixed(1)} ft below FEMA's flood height`;
        let words = `${where}, ${wet} of ${r.stats.count} points around the house would be under water.`;
        if (wet === 0) words = `${where}, the water stays below every point around the house.`;
        document.getElementById("water-readout").textContent = words;
    }

    slider.oninput = update;
    document.getElementById("water-reset").onclick = function () {
        slider.value = bfe.toFixed(1);
        update();
    };
    update();
}
 
// Add one row to a table
function addRow(table, cells) {
    const row = table.insertRow();
    cells.forEach((words) => {
        row.insertCell().textContent = words;
    });
    return row;
}
// Fill the Details tab for one finished check
function renderDetails(r) {
    const z = r.zone || { zone: "No answer from FEMA", bfe: null };
    const s = r.stats;
    const table = document.getElementById("details");
    table.innerHTML = "";

    addRow(table, ["Matched address", r.geo.matchedAddress]);
    addRow(table, ["Coordinates", `${r.geo.lat.toFixed(6)}, ${r.geo.lon.toFixed(6)}`]);
    addRow(table, ["Flood zone", z.zone]);
    addRow(table, ["Base Flood Elevation (BFE)", z.bfe != null ? `${z.bfe.toFixed(1)} ft ${z.datum}` : "None published"]);
    addRow(table, ["Where the BFE came from", z.bfeSource || "None"]);
    addRow(table, ["Building outline", r.footprint ? r.footprint.source : "None"]);

    if (s) {
        const spacing = HG.config.sampling.spacingMeters;
        const offset = HG.config.sampling.offsetMeters;
        addRow(table, ["Measurement points", `${s.count}, about ${spacing} m apart, ${offset} m outside the walls`]);
        addRow(table, ["Lowest Adjacent Grade (LAG)", `${s.lag.toFixed(2)} ft (point ${s.lagIndex + 1})`]);
        if (z.bfe != null) addRow(table, ["Difference (LAG minus BFE)", `${(s.lag - z.bfe).toFixed(2)} ft`]);
        addRow(table, ["Lidar accuracy (95%)", `plus or minus ${LIDAR_MARGIN_FEET} ft`]);
    }

    // Every point, one row each
    const box = document.getElementById("points-box");
    const points = document.getElementById("point-table");
    points.innerHTML = "";
    box.hidden = !s;
    if (!s) return;

    addRow(points.createTHead(), ["#", "Wall", "Latitude", "Longitude", "Ground (ft)", "vs flood (ft)"]);
    const body = points.createTBody();
    r.sampling.samples.forEach((p, i) => {
        const h = r.elevations[i];
        const row = addRow(body, [
            i + 1,
            p.wall,
            p.lonlat[1].toFixed(6),
            p.lonlat[0].toFixed(6),
            h == null ? "no data" : h.toFixed(2),
            h == null || z.bfe == null ? "" : (h - z.bfe).toFixed(2),
        ]);
        if (i === s.lagIndex) row.className = "is-lag-row";
    });
}


function init() {
    HG.map.init("map");
    initTabs();
    showMapOnly();
 
    document.getElementById("search-form").addEventListener("submit", function (e) {
        e.preventDefault(); // stop the page from reloading
        const address = document.getElementById("address").value.trim();
        if (!address) return;
        run(address);
    });
}
 
// Run init once after whole page is read.
document.addEventListener("DOMContentLoaded", init);