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
 
// Say the lowest ground in plain words, next to FEMA's flood height.
function showGround(r) {
    const box = document.getElementById("ground-result");
    const s = r.stats;
    if (s === null) {
        box.textContent = "USGS didn't send any ground heights for this spot. Try again in a minute.";
        return;
    }
    let text = `Lowest ground next to the house: ${s.lag.toFixed(1)} ft, from ${s.count} measurements.`;
    if (r.zone && r.zone.bfe != null) {
        const diff = s.lag - r.zone.bfe;
        const word = diff >= 0 ? "above" : "below";
        text += ` FEMA's flood height here is ${r.zone.bfe.toFixed(1)} ft, so the lowest ground is ${Math.abs(diff).toFixed(1)} ft ${word} it.`;
    }
    if (r.zone && r.zone.datum.includes("NGVD")) {
        text += " Careful: this flood map measures from the older NGVD 29 zero line, and lidar uses NAVD 88, so these two numbers can be off by about a foot.";
    }
    box.textContent = text;
}
 
// Full single search function: address to coordinates to pin.
async function run(address) {
    if (state.busy) return;
    state.busy = true;
    document.getElementById("search-btn").disabled = true;
    document.getElementById("error-card").hidden = true;
    HG.map.showZone(null);
    document.getElementById("zone-summary").textContent = "";
    document.getElementById("ground-result").textContent = "";
 
    try {
        // Nominatim rule: max one request per second.
        const since = Date.now() - state.lastGeocodeAt;
        if (since < 1100) await wait(1100 - since);
        state.lastGeocodeAt = Date.now();
 
        const geo = await HG.live.geocode(address);
        if (!geo) {
            showError("<p><b>We couldn't find that address in Massachusetts.</b> Try adding the town and \"MA\", for example: <i>1 Main Street, Concord, MA</i>.</p>");
            return;
        }
 
        HG.map.clear();
        HG.map.showPin(geo.lat, geo.lon, geo.matchedAddress);
 
        // Creates an object r with search results
        const r = { geo: geo, zone: null };
 
        // Ask FEMA which flood zone the pin lands in
        const zoneSummary = document.getElementById("zone-summary");
        zoneSummary.textContent = "Reading FEMA's flood map for this spot...";
        try {
            r.zone = await getFloodZone(geo.lon, geo.lat);
            HG.map.showZone(r.zone.polygon);
            const words = describeZone(r.zone);
            zoneSummary.textContent = `${words.title}. ${words.text}`;
        } catch (err) {
            console.error(err);
            zoneSummary.textContent = "FEMA's flood map didn't answer. It may be busy or down, so try again in a minute.";
        }
 
        // House outline
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
 
        // Measuring points around the house
        r.sampling = samplePerimeter(footprint.ring, HG.config.sampling);
 
        document.getElementById("ground-result").textContent = "Measuring the ground around the house...";
        const points = r.sampling.samples.map((s) => s.lonlat);
        r.elevations = await getElevations(points);
 
        r.stats = groundStats(r.elevations);
        HG.map.showSamples(r.sampling.samples, r.elevations, r.stats ? r.stats.lagIndex : -1);
        showGround(r);
    } catch (err) {
        console.error(err); // print the real error in the Console (F12)
        showError("<p><b>Something went wrong reaching the address service.</b> Check your internet connection and try again.</p>");
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