/*
 * loma.js: fills in the LOMA paperwork and makes a PDF packet
 * Section A of FEMA's form MT-EZ is the homeowner's part
 * Section B is the surveyor's part (heights and map details)
 */
window.HG = window.HG || {};
HG.loma = {};

HG.loma.answers = function (r, form) {
  const g = r.geo;
  const m = r.mapInfo || {};
  const z = r.zone || {};
  const s = r.stats;

  // The legal description, whatever deed details the person typed
  const legal = [];
  if (form.lot) legal.push("Lot " + form.lot);
  if (form.block) legal.push("Block " + form.block);
  if (form.book || form.page) legal.push(`Deed Book ${form.book || "___"}, Page ${form.page || "___"}`);

  const fillWords = { no: "No", yes: "Yes", unsure: "Not sure (ask your surveyor)" };
  const isLot = form.target === "lot";
  let what = "The house";
  if (isLot) what = "The whole property (the land)";
  else if (form.year) what = `The house, built in ${form.year}`;

  const sectionA = [
    ["1. Has fill (dirt) been added to raise the ground?", fillWords[form.fill] || "No"],
    ["2. Legal description of the property", legal.join(", ") || "From your deed: lot and block, or deed book and page"],
    ["3. What should come off the high-risk map?", what],
    ["Your name", form.owner || ""],
    ["Mailing address", form.mailing || g.matchedAddress],
    ["Phone", form.phone || ""],
    ["Email", form.email || ""],
    ["Property address", g.street || g.matchedAddress],
    ["Town, county, ZIP", [g.town, g.county, g.zip].filter(Boolean).join(", ")],
  ];

  const sectionB = [
    ["Type of request", form.fill === "yes" ? "Fill was added: this is a LOMR-F, ask your surveyor" : "On natural ground (LOMA)"],
    ["Latitude, longitude", `${g.lat.toFixed(5)}, ${g.lon.toFixed(5)} (WGS 84, from the map)`],
    ["Community name", m.community || g.town || ""],
    ["Community number", m.communityId || "Look up at msc.fema.gov"],
    ["Flood map panel number", m.panel || "Look up at msc.fema.gov"],
    ["Flood map date", m.effectiveDate || ""],
    ["Flood zone", z.zone],
    ["Base Flood Elevation (BFE)", z.bfe != null ? `${z.bfe.toFixed(1)} ft` : "None on the map yet. FEMA works it out."],
    ["Where the BFE comes from", z.bfeSource || "FEMA flood map"],
    [isLot ? "Lowest ground on the lot" : "Lowest ground touching the house",
      s && !isLot ? `About ${s.lag.toFixed(1)} ft (our lidar estimate)` : "Surveyor measures"],
    ["Height system (datum)", "NAVD 88"],
    ["Surveyor's name, license, signature, seal", ""],
  ];

  return { sectionA, sectionB };
};


// The same three colours as the website: above, too close, below.
HG.loma.dotColor = function (e, bfe) {
  const band = LIDAR_MARGIN_FEET;   // 0.64 ft, from verdict.js
  if (e < bfe) return [192, 57, 43];         // red: below the flood line
  if (e < bfe + band) return [201, 138, 18];  // gold: too close to call
  return [46, 125, 50];                       // green: above the flood line
};

// Ground height walking around the house, as dots, with flood height dashed
HG.loma.drawProfile = function (doc, r, x, y, w, h) {
  const s = r.stats;
  const bfe = r.zone.bfe;
  const heights = r.elevations.filter((e) => e != null);
  const lo = Math.min(...heights, bfe) - 1;
  const hi = Math.max(...heights, bfe) + 1;
  const toY = (v) => y + h - ((v - lo) / (hi - lo)) * h;   // height -> page y
  const toX = (along) => x + (along / r.sampling.perimeterMeters) * w;

  doc.setDrawColor(200).setLineWidth(0.5).rect(x, y, w, h);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
  doc.text(`${hi.toFixed(1)} ft`, x - 4, y + 4, { align: "right" });
  doc.text(`${lo.toFixed(1)} ft`, x - 4, y + h, { align: "right" });

// The flood height dashed
  doc.setDrawColor(30, 90, 160).setLineWidth(1).setLineDashPattern([4, 3], 0);
  doc.line(x, toY(bfe), x + w, toY(bfe));
  doc.setLineDashPattern([], 0);
  doc.setTextColor(30, 90, 160).text(`Flood height ${bfe.toFixed(1)} ft`, x + w, toY(bfe) - 4, { align: "right" });

  // One dot per measurement point
  r.sampling.samples.forEach((p, i) => {
    const e = r.elevations[i];
    if (e == null) return;
    doc.setFillColor(...HG.loma.dotColor(e, bfe)).circle(toX(p.along), toY(e), 2.5, "F");
  });

  // A ring around the lowest point
  const low = r.sampling.samples[s.lagIndex];
  doc.setDrawColor(20).setLineWidth(1).circle(toX(low.along), toY(s.lag), 6, "S");
  doc.setTextColor(20);
};

// Top-down view: the house outline and every measurement point. North is up.
HG.loma.drawPlan = function (doc, r, x, y, size) {
  const s = r.stats;
  const proj = makeProjection(r.geo.lat, r.geo.lon);   // from geometry.js
  const house = r.footprint.ring.map(proj.toXY);
  const dots = r.sampling.samples.map((p) => proj.toXY(p.lonlat));
  const all = house.concat(dots);

  // Find the edges of the drawing, then one scale so it fits in a square.
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const minX = Math.min(...xs), maxY = Math.max(...ys);
  const span = Math.max(Math.max(...xs) - minX, maxY - Math.min(...ys)) || 1;
  const k = (size - 20) / span;                  // points per meter
  const px = (p) => [x + 10 + (p[0] - minX) * k, y + 10 + (maxY - p[1]) * k];

  doc.setDrawColor(200).setLineWidth(0.5).rect(x, y, size, size);

  // House outline: a line from each corner to the next one
  doc.setDrawColor(60).setLineWidth(1.2);
  house.forEach((p, i) => {
    const a = px(p);
    const b = px(house[(i + 1) % house.length]);
    doc.line(a[0], a[1], b[0], b[1]);
  });

  dots.forEach((p, i) => {
    const e = r.elevations[i];
    if (e == null) return;
    const [cx, cy] = px(p);
    doc.setFillColor(...HG.loma.dotColor(e, r.zone.bfe)).circle(cx, cy, 2.5, "F");
  });
  const [lx, ly] = px(dots[s.lagIndex]);
  doc.setDrawColor(20).setLineWidth(1).circle(lx, ly, 6, "S");

  // Scale bar: 5 meters
  doc.setDrawColor(60).line(x + 10, y + size - 8, x + 10 + 5 * k, y + size - 8);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
  doc.text("5 m (16 ft)", x + 14 + 5 * k, y + size - 5);
  doc.text("North is up", x + size - 6, y + 14, { align: "right" });
  doc.setTextColor(20);
};


HG.loma.buildPdf = function (r, form) {
  if (!window.jspdf) throw new Error("The PDF tool didn't load. Check your internet and reload the page.");
  const doc = new window.jspdf.jsPDF({ unit: "pt", format: "letter" });
  const W = 612;   // page width
  const M = 54;    // margin (3/4 inch)
  const a = HG.loma.answers(r, form);
  const v = r.verdict;
  const today = new Date().toLocaleDateString();
  let y = 0;       // where the next line goes from top

  function header() {
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(110);
    doc.text(`HighGround LOMA packet, made ${today}`, M, 30);
    doc.text("Not an official FEMA document", W - M, 30, { align: "right" });
    doc.setTextColor(20);
    y = 64;
  }
  function newPage() {
    doc.addPage();
    header();
  }
  function room(h) {
    if (y + h > 740) newPage();   // start new page
  }
  function title(t) {
    room(40);
    doc.setFont("helvetica", "bold").setFontSize(20).text(t, M, y);
    y += 26;
  }
  function heading(t) {
    room(34);
    y += 8;
    doc.setFont("helvetica", "bold").setFontSize(13).text(t, M, y);
    y += 18;
  }
  function para(t, size = 10.5) {
    doc.setFont("helvetica", "normal").setFontSize(size);
    const lines = doc.splitTextToSize(t, W - 2 * M);   // wrap to the page width
    room(lines.length * size * 1.35);
    doc.text(lines, M, y);
    y += lines.length * size * 1.35 + 6;
  }
  function table(rows) {
    rows.forEach(([label, value]) => {
      doc.setFontSize(10.5);
      const left = doc.splitTextToSize(label, 190);
      const right = doc.splitTextToSize(value || "______________________________", W - 2 * M - 210);
      const h = Math.max(left.length, right.length) * 14 + 8;
      room(h);
      doc.setDrawColor(220).setLineWidth(0.5).line(M, y - 10, W - M, y - 10);
      doc.setFont("helvetica", "normal").setTextColor(90).text(left, M, y);
      doc.setFont("helvetica", "bold").setTextColor(20).text(right, M + 210, y);
      y += h;
    });
  }
  function numbered(list) {
    list.forEach((t, i) => {
      doc.setFont("helvetica", "normal").setFontSize(10.5);
      const lines = doc.splitTextToSize(t, W - 2 * M - 22);
      room(lines.length * 14 + 6);
      doc.setFont("helvetica", "bold").text(`${i + 1}.`, M, y);
      doc.setFont("helvetica", "normal").text(lines, M + 22, y);
      y += lines.length * 14 + 6;
    });
  }

  header();
  title("Your LOMA packet");
  para(r.geo.matchedAddress, 13);
  heading(`Result: ${v.badge}. ${v.title}`);
  para(`What we found: ${v.found}`);
  para(`What it means for you: ${v.meaning}`);
  heading("How to finish your application");
  const plan = [
    "Hire a Massachusetts licensed land surveyor. Give them this packet. They measure the ground at your house and sign Section B of FEMA's form. Page 3 shows where our data says the ground is lowest.",
    "Fill in FEMA's form MT-EZ using the answers on page 2. Apply online with FEMA's Online LOMC tool, or print the form from fema.gov (search \"MT-EZ\").",
    "Add a copy of your recorded deed (or plat map) that shows the book and page number, and a map showing where the property is.",
    "Send it to FEMA. A LOMA review is free. FEMA mails you a letter with its decision.",
    "If FEMA takes your home off the high-risk map, send a copy of the letter to your mortgage lender and your insurance agent.",
    ];
    if (form.fill === "yes") {
        plan.splice(1, 0, "Because dirt was added to raise the ground, FEMA treats this as a different request (a LOMR-F) that uses a different form and may have a fee. Ask your surveyor which form to use.");
    }
    numbered(plan);
    para("HighGround is a screening tool. Our heights come from airplane laser scans by the U.S. Geological Survey and are accurate to about 0.6 feet. Only a licensed surveyor's measurement can go in your application, and only FEMA can change the map.", 9);

    newPage();
    title("Answers for FEMA form MT-EZ");
    heading("Section A: your part");
    table(a.sectionA);
    para("Sign and date the form yourself. Check every answer against the current form on fema.gov.", 9);
    heading("Section B: your surveyor's part");
    para("Your surveyor measures and signs this part. Our numbers are a head start, not a replacement.", 9);
    table(a.sectionB);

if (r.verdict.diff != null) {
    const s = r.stats;
    const diff = s.lag - r.zone.bfe;
    newPage();
    title("Ground height around the house");
    table([
      ["Flood height (BFE)", `${r.zone.bfe.toFixed(1)} ft`],
      ["Lowest ground touching the house", `${s.lag.toFixed(1)} ft (ringed below)`],
      ["Difference", `${Math.abs(diff).toFixed(1)} ft ${diff >= 0 ? "above" : "below"} the flood height`],
      ["How we measured", `${s.count} points about 1 m outside the walls, from USGS bare-earth lidar (NAVD 88).`],
    ]);
    heading("Walking around the house");
    para("Each dot is one measurement point. The dashed line is the flood height.", 9);
    HG.loma.drawProfile(doc, r, M + 40, y, W - 2 * M - 40, 150);
    y += 170;
    room(240);
    heading("Seen from above");
    HG.loma.drawPlan(doc, r, M, y, 220);
    y += 230;
}

    return doc.output("blob");
};

/* Save file */
HG.loma.download = function (r, form) {
  const blob = HG.loma.buildPdf(r, form);
  const name = "LOMA-packet-" + (r.geo.street || "my-home").replace(/[^a-z0-9]+/gi, "-") + ".pdf";
  HG.report.saveFile(name, blob);
};