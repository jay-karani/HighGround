// verdict.js: Compares two results for plain english answer.
// Just screener based on what the data suggests, doesn't give a definitive answer

window.HG = window.HG || {};
HG.verdict = {};

// Lidar margin of error, USGS Quality Level 2 lidar can be off by around 0.33ft
// To achieve 95% confidence: 1.96 x 0.33 = about 0.64 ft, any gaps smaller are too close to tell
const LIDAR_MARGIN_FEET = 0.64;

// Turn feet to text. ex: 1.27 becomes 1.3 feet. -0.4 becomes 0.4 feet (above/below based on sign)
function feetText(n) {
    return Math.abs(n).toFixed(1) + " feet";
}

// What a LOMA does for the homeowner
const LOMA_PAYOFF = "your home could be taken off the high-risk map for free, and your mortgage lender would no longer be required to make you buy flood insurance";

// Pick one answer, answer is an object with 8 parts
// zone = the FEMA result, s = ground stats or null
function pickAnswer(zone, s) {
    // Places app can't or doesn't need to check
    if (!zone) {
        return {
            level: "no-data", badge: "Can't check", tone: "neutral", canApply: false,
            title: "FEMA's flood map didn't answer",
            found: "We found your home, but FEMA's flood map didn't send an answer.",
            meaning: "Without the flood zone we can't tell where your home's flood levels stand.",
            next: "Try again in a minute. FEMA's map service is sometimes busy.",
        };
    }
    if (zone.group === "UNMAPPED") {
        return {
            level: "no-data", badge: "Can't check", tone: "neutral", canApply: false,
            title: "There's no flood map for this spot",
            found: "FEMA's flood map has no information here.",
            meaning: "The area may not be mapped, or the address may have landed in the wrong place.",
            next: "Check the pin on the map. If it's on the wrong house, try the address again with the town name.",
        };
    }

    if (COASTAL_GROUPS.includes(zone.group)) {
        return {
            level: "out-of-scope", badge: "Can't check", tone: "neutral", canApply: false,
            title: "Coastal homes can't be checked here",
            found: `This home is in a coastal high-risk zone (Zone ${zone.zone}), where waves add to the flooding.`,
            meaning: "FEMA doesn't accept this kind of ground measurement near the coast, so HighGround can't provide a conclusive answer.",
            next: "A licensed land surveyor or engineer can tell you whether a map change is possible.",
        };
    }
    if (["X", "B", "C"].includes(zone.zone)) {
        return {
            level: "not-needed", badge: "Not needed", tone: "good", canApply: false,
            title: "Your home isn't in a high-risk flood zone",
            found: `FEMA's map puts this home in Zone ${zone.zone}, a lower-risk area.`,
            meaning: "Your mortgage lender isn't required to make you buy flood insurance here, so there's nothing to fix.",
            next: "No action needed.",
        };
    }

    if (!HIGH_RISK_GROUPS.includes(zone.group)) {
        return {
            level: "out-of-scope", badge: "Can't check", tone: "neutral", canApply: false,
            title: "This kind of flood zone can't be checked here",
            found: `This home is in Zone ${zone.zone}, which doesn't come with a flood height for us to compare the ground to.`,
            meaning: "Without a flood height, HighGround can't tell whether your home sits above the flood line.",
            next: "A licensed land surveyor or engineer can tell you whether a map change is possible.",
        };
    }

    if (zone.bfe == null && zone.zone === "A") {
        return {
            level: "needs-bfe", badge: "Maybe", tone: "maybe", canApply: true,
            title: "High-risk zone, but FEMA never set a flood height",
            found: "FEMA's map marks this area as high-risk, but doesn't say how high a serious flood would reach.",
            meaning: `You can still apply. FEMA works out the flood height as part of its review, and if your home is above it, ${LOMA_PAYOFF}.`,
            next: "Bring this result to a licensed land surveyor and ask about a LOMA.",
        };
    }
    if (zone.bfe == null) {
        return {
            level: "no-data", badge: "Can't check", tone: "neutral", canApply: false,
            title: "We couldn't read the flood height here",
            found: `This home is in Zone ${zone.zone}, which has a flood height, but we couldn't read it at your spot.`,
            meaning: "Without the flood height we can't compare it to the ground.",
            next: "A licensed land surveyor can look up the flood height on FEMA's printed map.",
        };
    }
    if (!s) {
        return {
            level: "no-data", badge: "Can't check", tone: "neutral", canApply: false,
            title: "We couldn't measure the ground here",
            found: "We found the flood zone, but the ground measurements came back empty.",
            meaning: "Without them we can't compare your property to the flood height.",
            next: "Try again later. If it keeps happening, a surveyor can measure it directly.",
        };
    }

    // comparison
    const diff = s.lag - zone.bfe;
    const side = diff >= 0 ? "above" : "below";
    const found = `The lowest ground touching your property is about ${feetText(diff)} ${side} the height FEMA expects a serious flood to reach.`;

    if (diff >= LIDAR_MARGIN_FEET) {
        return {
            level: "strong", badge: "Likely yes", tone: "good", canApply: true, diff,
            title: "Your home may be higher than the flood line",
            found,
            meaning: `That's a clear gap, so ${LOMA_PAYOFF}.`,
            next: "Bring this result to a licensed land surveyor. They confirm the height, then you send it to FEMA.",
        };
    }
    if (diff > -LIDAR_MARGIN_FEET) {
        return {
            level: "close", badge: "Maybe", tone: "maybe", canApply: true, diff,
            title: "Too close to call",
            found,
            meaning: `That's within our measurement's margin of error (about ${LIDAR_MARGIN_FEET.toFixed(1)} feet). If a surveyor finds your home is above the flood height, ${LOMA_PAYOFF}.`,
            next: "Have a licensed land surveyor measure it. Only a survey can settle a result this close.",
        };
    }
    return {
        level: "unlikely", badge: "Likely no", tone: "bad", canApply: false, diff,
        title: "Your home is likely lower than the flood line",
        found,
        meaning: "FEMA's map is probably right about this home, so a free map correction is unlikely to work.",
        next: "Ask your insurance agent about other ways to lower the cost, like raising heating equipment or adding flood vents.",
    };
}

// Pick answer and add warnings, one function called from app.js
HG.verdict.decide = function (zone, s) {
    const v = pickAnswer(zone, s);
    v.warnings = [];
    if (zone && zone.datum && zone.datum.includes("NGVD")) {
        v.warnings.push("This flood map measures heights from an older starting point than the ground data. They can differ by up to about a foot here, so treat this result with extra caution.");
    }
    return v;
};