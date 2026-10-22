// config.js: every web address and setting in the application.

window.HG = window.HG || {};

HG.config = {
    // Box Massachusetts (west, north, east, south) to limit the address search.
    maViewbox: "-73.55,42.92,-69.85,41.18",

    // Web addresses of services data is pulled from.
    endpoints: {
        nominatim: "https://nominatim.openstreetmap.org/search",
    },

    // Map's background pictures.
    tiles: {
        streets: {
            url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            attribution: "&copy; OpenStreetMap contributors",
        },
    },

    // Measurements to outline around the house
    sampling: {
        offsetMeters: 1.0,        // measure 1 m outside walls
        spacingMeters: 2.0,       // one measurement every 2 m around the shape
        maxPoints: 80,            // limit max points requested from USGS
        fallbackRadiusMeters: 9,  // measure a circle with this radius if no outline found
        buildingSearchMeters: 35, // how far from dropped pin to search for a building
    },
};