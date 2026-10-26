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

    document.getElementById("results").hidden = false;
    card.scrollIntoView({ behavior: "smooth", block: "start" });
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
    document.getElementById("results").hidden = true;
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
 
function init() {
    HG.map.init("map");
 
    document.getElementById("search-form").addEventListener("submit", function (e) {
        e.preventDefault(); // stop the page from reloading
        const address = document.getElementById("address").value.trim();
        if (!address) return;
        run(address);
    });
}
 
// Run init once after whole page is read.
document.addEventListener("DOMContentLoaded", init);