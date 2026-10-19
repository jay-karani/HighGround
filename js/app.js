// app.js: connects page to the other files.

function init() {
    HG.map.init("map");
}

// Run init once the whole page has been read.
document.addEventListener("DOMContentLoaded", init);