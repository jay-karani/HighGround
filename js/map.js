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