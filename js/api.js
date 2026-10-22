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


// house outline and ground heights
const MASSGIS_BUILDINGS_URL = "https://services1.arcgis.com/hGdibHYSPO59RG1h/ArcGIS/rest/services/Building_Structures/FeatureServer/0";

const USGS_EPQS_URL = "https://epqs.nationalmap.gov/v1/json";

// Ask MassGIS for buildings at pin
// Look only for the building the pin is sitting on
async function findBuildings(lon, lat, searchMeters) {
  const params = pointQuery(lon, lat);
  params.outFields = "*";
  params.returnGeometry = true;
  params.outSR = 4326;
  if (searchMeters > 0) {
    params.distance = searchMeters;
    params.units = "esriSRUnit_Meter";
  }

  const data = await queryArcgis(`${MASSGIS_BUILDINGS_URL}/query`, params);
  const features = data.features || [];
  return features.filter((f) => f.geometry && f.geometry.rings);
}

// Outline of the house at the pin or null if no building is detected nearby
async function getFootprint(lon, lat) {
  // Checks if pin is already sitting on building
  let buildings = await findBuildings(lon, lat, 0);
  const pinInside = buildings.length > 0;

  // Checks close by buildings if pin is not on one
  if (!pinInside) {
    buildings = await findBuildings(lon, lat, HG.config.sampling.buildingSearchMeters);
  }
  if (buildings.length === 0) return null;
  // Pick building with closest middle point to pin
  const projection = makeProjection(lat, lon); // the pin becomes new reference [0, 0]
  let best = null;
  buildings.forEach((b) => {
    const ring = openRing(b.geometry.rings[0]);
    const dist = distance([0, 0], projection.toXY(centroid(ring)));
    if (best === null || dist < best.dist) {
      best = { dist: dist, ring: ring };
    }
  });
  return {
    ring: best.ring,
    pinInside: pinInside,
    source: "MassGIS Building Structures",
    note: pinInside ? "The pin is on this building." : `Nearest building, ${Math.round(best.dist)} m from the pin.`,
  };
}

// Ground height at a single [lon, lat] point in feet. null if USGS has no answer
async function elevationAt([lon, lat]) {
  const params = new URLSearchParams({ x: lon, y: lat, wkid: 4326, units: "Feet", includeDate: false });
try {
    const response = await fetch(`${USGS_EPQS_URL}?${params}`);
    if (!response.ok) return null;
    const data = await response.json();
        const feet = parseFloat(data.value);
    if (isNaN(feet) || feet < -1000) return null; // -1000000 means no data found
    return feet;
} catch (err) {
    return null;
  }
}

const USGS_SAMPLES_URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples";
const FEET_PER_METER = 3.28084;

// Ground heights for ALL points in ONE request. USGS answers in METERS.
async function elevationsBatch(points) {
  const body = new URLSearchParams({
    geometry: JSON.stringify({ points: points, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryMultipoint",
    returnFirstValueOnly: true,
    f: "json",
  });
  const response = await fetch(USGS_SAMPLES_URL, { method: "POST", body: body });
  if (!response.ok) throw new Error(`USGS answered with error ${response.status}`);
  const data = await response.json();
  if (!data.samples) throw new Error("USGS sent no samples");
    const heights = points.map(() => null);
    data.samples.forEach((s) => {
        const meters = parseFloat(s.value);
        if (!isNaN(meters) && meters > -1000) {
            heights[s.locationId] = meters * FEET_PER_METER;
        }
    });
  return heights;
}

// Ground heights for multiple points, 8 at a time in the same order as backup if AIO request fails
async function getElevations(points) {
    try {
        return await elevationsBatch(points);
    } catch (err) {
    console.warn("Fast USGS service failed, asking one point at a time instead.", err);
    }
    const heights = [];
    for (let i = 0; i < points.length; i += 8) {
        const group = points.slice(i, i + 8);
        const answers = await Promise.all(group.map(elevationAt));
        heights.push(...answers);
    }
  return heights;
}