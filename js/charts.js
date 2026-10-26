// charts.js draws the ground height pictures with SVG
// Side view (HG.charts.profile) and top-down view (HG.charts.sitePlan)
window.HG = window.HG || {};
HG.charts = {};

// Make one SVG shape, give it its attributes, and put it inside `parent`
function svgEl(tag, attrs, parent) {
    
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const name in attrs) {
        node.setAttribute(name, attrs[name]);
    }
    parent.appendChild(node);
    return node;
}

// Same as svgEl(), but for text
function svgText(words, attrs, parent) {
    const node = svgEl("text", attrs, parent);
    node.textContent = words;
    return node;
}

// Scale to turn data (like 121.4 ft) into a screen position (like 87)
function makeScale(dataLow, dataHigh, screenLow, screenHigh) {
    return function (value) {
        const fraction = (value - dataLow) / (dataHigh - dataLow);
        return screenLow + fraction * (screenHigh - screenLow);
    };
}

// Which color group a ground height is in if the water reached `level`
function pointClass(height, level) {
    if (height == null) return "is-nodata";
    if (height < level) return "is-wet";
    if (height < level + LIDAR_MARGIN_FEET) return "is-edge";
    return "is-dry";
}

// Side view walk around the house and note ground
HG.charts.profile = function (svg, opts) {
    const samples = opts.samples;
    const heights = opts.elevations;
    const bfe = opts.bfe;
    const band = LIDAR_MARGIN_FEET;
    const FEET_PER_METER = 3.28084;

    svg.innerHTML = "";
    const W = 680, H = 280;
    const left = 56, right = 18, top = 18, bottom = 44;
    const floor = H - bottom;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    // How tall the chart is
    const good = heights.filter((h) => h != null);
    const low = Math.min(...good, bfe - band) - 0.5;
    const high = Math.max(...good, bfe + band) + 0.5;

    const x = makeScale(0, opts.perimeterMeters, left, W - right);
    const y = makeScale(low, high, floor, top);

    // Height lines, with  numbers on left
    const range = high - low;
    let step = 0.5;
    if (range > 4) step = 1;
    if (range > 8) step = 2;
    if (range > 16) step = 5;
    for (let h = Math.ceil(low / step) * step; h <= high; h += step) {
        svgEl("line", { x1: left, x2: W - right, y1: y(h), y2: y(h), class: "grid" }, svg);
        svgText(h.toFixed(1), { x: left - 8, y: y(h) + 4, class: "tick", "text-anchor": "end" }, svg);
    }

    // Distance numbers along the bottom every 50 feet
    const aroundFeet = opts.perimeterMeters * FEET_PER_METER;
    for (let ft = 0; ft <= aroundFeet; ft += 50) {
        svgText(String(ft), { x: x(ft / FEET_PER_METER), y: floor + 18, class: "tick", "text-anchor": "middle" }, svg);
    }
    svgText("Distance walked around the house (ft)", { x: (left + W - right) / 2, y: H - 6, class: "axis-title", "text-anchor": "middle" }, svg);
    svgText("Ground height (ft)", { x: 14, y: H / 2, class: "axis-title", "text-anchor": "middle", transform: `rotate(-90 14 ${H / 2})` }, svg);

    // Too close to call strip around the flood line
    svgEl("rect", { x: left, y: y(bfe + band), width: W - left - right, height: y(bfe - band) - y(bfe + band), class: "band" }, svg);

    // The water, ground covers it where it's higher
    const water = svgEl("rect", { x: left, y: floor, width: W - left - right, height: 0, class: "water" }, svg);
    // The ground: a line through every point filled in underneath
    const first = heights.findIndex((h) => h != null);
    const startY = y(heights[first]).toFixed(1);
    let line = `M${left},${startY}`;
    samples.forEach((s, i) => {
        if (heights[i] != null) {
            line += ` L${x(s.along).toFixed(1)},${y(heights[i]).toFixed(1)}`;
        }
    });
    line += ` L${W - right},${startY}`;
    svgEl("path", { d: `${line} L${W - right},${floor} L${left},${floor} Z`, class: "ground-fill" }, svg);
    svgEl("path", { d: line, class: "ground-line" }, svg);

    // FEMA's flood height: Dashed line with label
    svgEl("line", { x1: left, x2: W - right, y1: y(bfe), y2: y(bfe), class: "bfe-line" }, svg);
    svgText(`Flood height ${bfe.toFixed(1)} ft`, { x: W - right - 4, y: y(bfe) - 8, class: "bfe-label", "text-anchor": "end" }, svg);

    // One dot per point, lowest one is bigger
    const lag = opts.lagIndex;
    const dots = samples.map((s, i) => {
        if (heights[i] == null) return null;
        return svgEl("circle", { cx: x(s.along), cy: y(heights[i]), r: i === lag ? 6 : 3.5 }, svg);
    });

    // Name the lowest point next to dot under it
    const lx = x(samples[lag].along);
    const dotY = y(heights[lag]);
    let ly = Math.min(dotY + 20, floor - 6);
    if (Math.abs(ly - y(bfe)) < 14) ly = dotY - 12;
    const onRight = lx > W * 0.7;
    svgText(`Lowest point ${heights[lag].toFixed(1)} ft`, {
        x: onRight ? lx - 10 : lx + 10,
        y: ly,
        class: "lag-label",
        "text-anchor": onRight ? "end" : "start",
    }, svg);

    // Move the water to `level` and recolor the dots to match
    function setWater(level) {
        const waterTop = Math.max(top, Math.min(floor, y(level)));
        water.setAttribute("y", waterTop);
        water.setAttribute("height", floor - waterTop);
        dots.forEach((dot, i) => {
            if (dot === null) return;
            let cls = "dot " + pointClass(heights[i], level);
            if (i === lag) cls += " is-lag";
            dot.setAttribute("class", cls);
        });
    }

    setWater(bfe); // start with the water at FEMA's flood height
    return { setWater: setWater, low: low, high: high };
};

// Top-down view: the house outline at every point
HG.charts.sitePlan = function (svg, opts) {
    svg.innerHTML = "";
    const S = 300, pad = 34;
    const FEET_PER_METER = 3.28084;
    svg.setAttribute("viewBox", `0 0 ${S} ${S}`);

    // Turn longitude/latitude into meters
    const center = centroid(opts.ring);
    const proj = makeProjection(center[1], center[0]);
    const house = opts.ring.map(proj.toXY);
    const spots = opts.samples.map((s) => proj.toXY(s.lonlat));

    // Zoom to fit point farthest from middle
    let far = 1;
    house.concat(spots).forEach((p) => {
        far = Math.max(far, Math.abs(p[0]), Math.abs(p[1]));
    });
    const k = (S / 2 - pad) / far; // screen units per meter

    // flip y
    function toScreen(p) {
        return [S / 2 + p[0] * k, S / 2 - p[1] * k];
    }

    // The house
    const corners = house.map(toScreen).map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1));
    svgEl("polygon", { points: corners.join(" "), class: "plan-house" }, svg);

    // Points around it
    const dots = spots.map((p, i) => {
        const s = toScreen(p);
        return svgEl("circle", { cx: s[0], cy: s[1], r: i === opts.lagIndex ? 6 : 4 }, svg);
    });

    // North arrow, top right
    svgEl("path", { d: "M278,10 L285,30 L278,25 L271,30 Z", class: "north" }, svg);
    svgText("N", { x: 278, y: 44, class: "tick", "text-anchor": "middle" }, svg);

    // A 10-foot scale bar, bottom left
    const tenFeet = (10 / FEET_PER_METER) * k;
    svgEl("line", { x1: 16, x2: 16 + tenFeet, y1: S - 16, y2: S - 16, class: "scale-bar" }, svg);
    svgText("10 ft", { x: 22 + tenFeet, y: S - 12, class: "tick" }, svg);

    // Recolor every point for a flood at `level`
    function recolor(level) {
        dots.forEach((dot, i) => {
            let cls = "plan-dot " + pointClass(opts.elevations[i], level);
            if (i === opts.lagIndex) cls += " is-lag";
            dot.setAttribute("class", cls);
        });
    }

    recolor(opts.bfe); // start with the water at FEMA's flood height
    return { recolor: recolor };
};