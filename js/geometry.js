// geometry.js: Math to turn map angles in degrees into meters

const METERS_PER_DEGREE_LAT = 111080; // at Massachusetts, roughly 42 degrees north, compensating for equator constant value of ~110540
const METERS_PER_DEGREE_LON_AT_EQUATOR = 111320;

// Make a converter centered on lat0, lon0, that spot becomes [0, 0]
function makeProjection(lat0, lon0) {
    const kx = METERS_PER_DEGREE_LON_AT_EQUATOR * Math.cos(lat0 * Math.PI / 180);
    const ky = METERS_PER_DEGREE_LAT;
    return {
        toXY: ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky],
        toLonLat: ([x, y]) => [lon0 + x / kx, lat0 + y / ky],
    };
}

// Simple distance formula between two [x, y] points.
function distance([x1, y1], [x2, y2]) {
    return Math.hypot(x2 - x1, y2 - y1);
}

// Shortest distance from a point p to the line segment through points a and b
function distanceToSegment(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    let t = 0;
    if (lengthSquared > 0) {
        t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared;
    }
    t = Math.max(0, Math.min(1, t)); // stay between a and b
    return distance(p, [a[0] + t * dx, a[1] + t * dy]);
}

// Shortest distance from point p to a polyline of many points
function distanceToPolyline(p, line) {
    let bestGuess = Infinity;
    for (let i = 0; i < line.length - 1; i++) {
        bestGuess = Math.min(bestGuess, distanceToSegment(p, line[i], line[i + 1]));
    }
    return bestGuess;
}


// Walking around house outline

// Drop the repeated last corner of the shape meant to signify completion from map server
function openRing(ring) {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) {
    return ring.slice(0, -1);
  }
  return ring.slice();
}

// Average the corners to estimate the center of a shape
function centroid(ring) {
  let sumX = 0;
  let sumY = 0;
  ring.forEach(([x, y]) => {
    sumX += x;
    sumY += y;
  });
  return [sumX / ring.length, sumY / ring.length];
}

// Make a circle of corners around the pin if no outline found
function circleRing(lon, lat, radiusMeters) {
  const projection = makeProjection(lat, lon);
  const ring = [];
  for (let i = 0; i < 24; i++) {
    const angle = (2 * Math.PI * i) / 24;
    ring.push(projection.toLonLat([Math.cos(angle) * radiusMeters, Math.sin(angle) * radiusMeters]));
  }
  return ring;
}