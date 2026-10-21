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

// Old maps number zones A1 to A30, V1 to V30; Treat each set as one group.
function zoneGroup(zone) {
    const letter = zone.charAt(0);
    const number = Number(zone.slice(1));
    if ((letter === "A" || letter === "V") && number >= 1 && number <= 30) {
        return `${letter}1-30`;
    }
    return zone;
}

// Find flood zone of coordinates and the height of Base Flood Elevation BFE if any
async function getFloodZone(lon, lat) {
    const params = pointQuery(lon, lat);
    params.outFields = "FLD_ZONE,ZONE_SUBTY,STATIC_BFE,V_DATUM,SFHA_TF";
    params.returnGeometry = true;
    params.outSR = 4326;
    params.maxAllowableOffset = 0.00002;

    const data = await queryArcgis(`${FEMA_NFHL_URL}/${FEMA_ZONES_LAYER}/query`, params);
    
    const features = data.features || [];

    if (features.length === 0) {
        return { zone: "UNMAPPED", group: "UNMAPPED", subtype: "", sfha: false, datum: "", bfe: null, bfeSource: null, polygon: null };
    }

    // Border case touching two zones, choose one with higher risk
    const feature = features.find((f) => f.attributes.SFHA_TF === "T") || features[0];
    const a = feature.attributes;
    const zone = (a.FLD_ZONE || "").trim();

    const result = {
        zone: zone,
        group: zoneGroup(zone),
        subtype: a.ZONE_SUBTY || "",
        sfha: a.SFHA_TF === "T",
        datum: a.V_DATUM || "",
        bfe: null,
        bfeSource: null,
        polygon: feature.geometry ? feature.geometry.rings : null,
    };

    if (a.STATIC_BFE != null && a.STATIC_BFE !== NO_BFE) {
        result.bfe = a.STATIC_BFE;
        result.bfeSource = "FEMA set this height for the whole zone.";
    } else if (result.group === "AE" || result.group === "A1-30" || result.group === "AH") {
        try {
            const estimate = await bfeFromLines(lon, lat);
            if (estimate) {
                result.bfe = estimate.bfe;
                result.bfeSource = estimate.note;
            }
        } catch (err) {
            console.warn("Couldn't read FEMA's flood height lines", err);
        }
    }
    return result;
}

// Near rivers, FEMA draws lines labeled with flood height instead of typical zone marking
// Use inverse distance weighting to estimate BFE from nearby lines
async function bfeFromLines(lon, lat) {
    const params = pointQuery(lon, lat);
    params.distance = 600;
    params.units = "esriSRUnit_Meter";
    params.outFields = "ELEV";
    params.returnGeometry = true;
    params.outSR = 4326;

    const data = await queryArcgis(`${FEMA_NFHL_URL}/${FEMA_BFE_LINES_LAYER}/query`, params);
    const features = data.features || [];
        const projection = makeProjection(lat, lon); // the pin becomes [0, 0]
    const lines = [];
    features.forEach((f) => {
        if (!f.geometry || !f.geometry.paths || !(f.attributes.ELEV > 0)) return;
        const path = f.geometry.paths[0].map(projection.toXY);
        lines.push({ elev: f.attributes.ELEV, dist: distanceToPolyline([0, 0], path) });
    });
    if (lines.length === 0) return null;
        lines.sort((a, b) => a.dist - b.dist);
    const first = lines[0];
    const second = lines.find((line) => line.elev !== first.elev);

    if (!second || first.dist < 1) {
        return { bfe: first.elev, note: `We took it from FEMA's nearest flood height line, ${Math.round(first.dist)} m away.` };
    }
    const w1 = 1 / first.dist;
    const w2 = 1 / second.dist;
    const bfe = (first.elev * w1 + second.elev * w2) / (w1 + w2);
    return {
        bfe: Math.round(bfe * 10) / 10,
        note: `We estimated it from FEMA's two nearest flood height lines: ${first.elev} ft (${Math.round(first.dist)} m away) and ${second.elev} ft (${Math.round(second.dist)} m away).`,
    };
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