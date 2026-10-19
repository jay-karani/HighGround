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