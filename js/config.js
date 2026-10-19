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
};