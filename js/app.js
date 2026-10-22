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

// Full single search function: address to coordinates to pin.
async function run(address) {
    if (state.busy) return;
    state.busy = true;
    document.getElementById("search-btn").disabled = true;
    document.getElementById("error-card").hidden = true;
    HG.map.showZone(null);
    document.getElementById("zone-summary").textContent = "";

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