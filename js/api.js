// api.js: All functions that call external APIs, like Nominatim for geocoding.


// Return what touches this point on any ArcGIS layer.
function pointQuery (lon, lat) {
    return {
        geometry: `${lon},${lat}`,
        geometryType: "esriGeometryPoint",
        inSR: 4326,
        spatialRel: "esriSpatialRelIntersects",
        returnGeometry: false,
        f: "json",
    };
}

// Ask ArcGIS map server question and return its answer as an object
async function queryArcgis(url, params) {
    const fullUrl = `${url}?${new URLSearchParams(params)}`;
    const response = await fetch(fullUrl);
    if (!response.ok) {
        throw new Error(`Map server answered with error ${response.status}`);
    }
    const data = await response.json();
    if (data.error) {
        throw new Error(`Map server error: ${data.error.message}`);
    }
    return data;
}

// Find flood zone of coordinates and the height of Base Flood Elevation BFE if any
async function getFloodZone(lon, lat) {
    const params = pointQuery(lon, lat);
    params.outFields = "FLD_ZONE,ZONE_SUBTY,STATIC_BFE,V_DATUM,SFHA_TF";
    params.returnGeometry = true;
    params.outSR = 4326;
    params.maxAllowableOffset = 0.00002;

    const data = await queryArcgis(`${FEMA_NFHL_URL}/${FEMA_ZONES_LAYER}/query`, params);
    return data;
}


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

// FEMA Flood Maps
// FEMA's National Flood Hazard Layer (NFHL) Constant Data
const FEMA_NFHL_URL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer";
const FEMA_ZONES_LAYER = 28;     // flood zone shapes
const FEMA_BFE_LINES_LAYER = 16; // lines across rivers, labeled with the flood height
const NO_BFE = -9999;            // FEMA's code for "no flood height set here"