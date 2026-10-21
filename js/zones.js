// zones.js: turn FEMA zone codes into basic readable text

const HIGH_RISK_GROUPS = ["A", "AE", "AH", "A1-30"];
const COASTAL_GROUPS = ["V", "VE", "V1-30"];
const INSURANCE_RULE = "If your mortgage is federally backed, your lender has to make you buy flood insurance in this zone.";

function describeZone(zone) {
    const name = `Zone ${zone.zone}`;

    if (zone.group === "UNMAPPED" || zone.zone === "") {
        return {
            kind: "unmapped",
            title: "No flood map here",
            text: "FEMA's flood map has no information for this spot. Check that the pin is on the right property.",
        };
    }
    if (COASTAL_GROUPS.includes(zone.group)) {
        return {
            kind: "coastal",
            title: `${name}: coastal high-risk area`,
            text: `Ocean waves can add to the flooding here. ${INSURANCE_RULE} HighGround only checks inland flood zones, so it can't check this area.`,
        };
    }

    if (HIGH_RISK_GROUPS.includes(zone.group)) {
        if (zone.bfe == null && zone.zone === "A") {
            return {
                kind: "high-risk-no-bfe",
                title: `${name}: high-risk area, no flood height set`,
                text: `FEMA marks this area as high-risk, but never calculated how high a serious flood would reach. ${INSURANCE_RULE}`,
            };
        }
        if (zone.bfe == null) {
            return {
                kind: "high-risk-no-bfe",
                title: `${name}: high-risk area`,
                text: `FEMA has a flood height for this area, but we couldn't read it from the map. ${INSURANCE_RULE}`,
            };
        }
        return {
            kind: "high-risk",
            title: `${name}: high-risk area`,
            text: `FEMA expects a serious flood here to reach ${zone.bfe.toFixed(1)} feet above sea level. ${zone.bfeSource} ${INSURANCE_RULE}`,
        };
    }

    if (["X", "B", "C"].includes(zone.zone)) {
        const moderate = zone.subtype.includes("0.2");
        return {
            kind: "low-risk",
            title: moderate ? `${name}: moderate-risk area` : `${name}: low-risk area`,
            text: "This home is outside FEMA's high-risk flood zone, so your lender isn't required to make you buy flood insurance. It can still flood, so insurance is your choice.",
        };
    }
    if (zone.zone === "AO") {
        return {
            kind: "other",
            title: `${name}: high-risk area with shallow flooding`,
            text: `Here FEMA lists how deep the water would get (usually 1 to 3 feet) instead of a flood height, so there's nothing to compare the ground to. ${INSURANCE_RULE}`,
        };
    }
    if (zone.zone === "OPEN WATER") {
        return {
            kind: "other",
            title: "The pin is on water",
            text: "FEMA's map shows a river, lake or pond at this spot. Check that the pin is on a property.",
        };
    }
    if (zone.zone === "D") {
        return {
            kind: "other",
            title: "Zone D: flood risk never studied",
            text: "FEMA hasn't studied the flood risk here, so there's no flood height to compare against.",
        };
    }
    return {
        kind: "other",
        title: zone.sfha ? `${name}: high-risk area of a special kind` : name,
        text: "HighGround only checks Zones A, AE and AH, so it can't check this home.",
    };
}