// api.js: All functions that call external APIs, like Nominatim for geocoding.

window.HG = window.HG || {};
HG.live = {};

// Address provided in format { lat, lon, matchedAddress, state, source }, or null if not found in MA
HG.live.geocode = async function (address) {
    const params = new URLSearchParams({
        q: address,
        format: "json",
        limit: 1,
        countrycodes: "us",
        addressdetails: 1,
        viewbox: HG.config.maViewbox,
        bounded: 1,
    });

    const response = await fetch(HG.config.endpoints.nominatim + "?" + params);
    if (!response.ok) {
        throw new Error("Nominatim answered with error " + response.status);
    }
    const data = await response.json();

    const r = data[0];
    if (!r) return null;
    if (r.address.state !== "Massachusetts") return null;

    return {
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        matchedAddress: r.display_name,
        state: "MA",
        source: "OpenStreetMap Nominatim",
    };
};