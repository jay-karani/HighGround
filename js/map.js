window.HG = window.HG || {};
HG.map = {};

let leafletMap = null;   // Leaflet map once its made.
let pinLayer = null;     // Holds pin for later clearing.

// Turn box with id into map of Massachusetts.
HG.map.init = function (elementId) {
    if (typeof L === "undefined") {
        document.getElementById(elementId).innerHTML = "<p>The map could not load. Are you offline?</p>";
        return;
    }

    leafletMap = L.map(elementId, { scrollWheelZoom: false }).setView([42.3, -71.8], 8);

    const t = HG.config.tiles.streets;
    L.tileLayer(t.url, { maxZoom: 19, attribution: t.attribution }).addTo(leafletMap);

    pinLayer = L.layerGroup().addTo(leafletMap);

    // Allow zoom only after clicking on map.
    leafletMap.on("click", function () {
        leafletMap.scrollWheelZoom.enable();
    });
};

// Remove the old pin before new search
HG.map.clear = function () {
    if (!leafletMap) return;
    pinLayer.clearLayers();
};

// Put a pin at said spot, label it, and zoom in
HG.map.showPin = function (lat, lon, label) {
    if (!leafletMap) return;
    L.circleMarker([lat, lon], { radius: 6, className: "pin" })
        .bindTooltip(label)
        .addTo(pinLayer);
    leafletMap.setView([lat, lon], 18);
};

// Flood zone shape
let zoneLayer = null; // initial flood zone shape on map

// Shade in FEMA's flood zone on map, HG.map.showZone(null) removes the old one.
HG.map.showZone = function (rings) {
    if (!leafletMap) return;
    if (zoneLayer) {
        zoneLayer.remove();
        zoneLayer = null;
    }
    if (!rings) return;

    // FEMA gives [longitude, latitude], Leaflet needs [latitude, longitude]
    const latLngRings = rings.map((ring) => ring.map(([lon, lat]) => [lat, lon]));
    zoneLayer = L.polygon(latLngRings, { className: "zone-poly", interactive: false }).addTo(leafletMap);
    zoneLayer.bringToBack(); // keep pin on top
};


// Draw the house outline and zoom the map to fit
HG.map.showFootprint = function (ring) {
    if (!leafletMap) return;
    const latLngs = ring.map(([lon, lat]) => [lat, lon]);
    const outline = L.polygon(latLngs, { className: "footprint-poly" }).addTo(pinLayer);
    leafletMap.fitBounds(outline.getBounds(), { padding: [60, 60], maxZoom: 19 });
};