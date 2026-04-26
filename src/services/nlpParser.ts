import { ProfileFilters } from "../types";

// Country name → ISO code map (covers all 65 countries in seed data)
const COUNTRY_MAP: Record<string, string> = {
    nigeria: "NG",
    niger: "NE",
    ghana: "GH",
    kenya: "KE",
    uganda: "UG",
    tanzania: "TZ",
    ethiopia: "ET",
    egypt: "EG",
    morocco: "MA",
    algeria: "DZ",
    tunisia: "TN",
    libya: "LY",
    sudan: "SD",
    somalia: "SO",
    senegal: "SN",
    mali: "ML",
    "burkina faso": "BF",
    "ivory coast": "CI",
    "cote d'ivoire": "CI",
    cameroon: "CM",
    angola: "AO",
    mozambique: "MZ",
    zambia: "ZM",
    zimbabwe: "ZW",
    malawi: "MW",
    madagascar: "MG",
    rwanda: "RW",
    burundi: "BI",
    "south africa": "ZA",
    namibia: "NA",
    botswana: "BW",
    lesotho: "LS",
    swaziland: "SZ",
    eswatini: "SZ",
    gabon: "GA",
    congo: "CG",
    "democratic republic of congo": "CD",
    "dr congo": "CD",
    drc: "CD",
    "central african republic": "CF",
    chad: "TD",
    togo: "TG",
    benin: "BJ",
    guinea: "GN",
    "guinea-bissau": "GW",
    "sierra leone": "SL",
    liberia: "LR",
    gambia: "GM",
    "cape verde": "CV",
    "sao tome": "ST",
    comoros: "KM",
    djibouti: "DJ",
    eritrea: "ER",
    "south sudan": "SS",
    mauritania: "MR",
    mauritius: "MU",
    seychelles: "SC",
    india: "IN",
    pakistan: "PK",
    bangladesh: "BD",
    france: "FR",
    germany: "DE",
    "united kingdom": "GB",
    uk: "GB",
    "great britain": "GB",
    spain: "ES",
    italy: "IT",
    portugal: "PT",
    brazil: "BR",
    usa: "US",
    "united states": "US",
    america: "US",
    canada: "CA",
    australia: "AU",
    china: "CN",
    japan: "JP",
    indonesia: "ID",
    philippines: "PH",
};

// Age group keywords
const AGE_GROUP_KEYWORDS: Record<string, string> = {
    child: "child",
    children: "child",
    kids: "child",
    kid: "child",
    teenager: "teenager",
    teenagers: "teenager",
    teen: "teenager",
    teens: "teenager",
    adolescent: "teenager",
    adult: "adult",
    adults: "adult",
    senior: "senior",
    seniors: "senior",
    elderly: "senior",
    elder: "senior",
    old: "senior",
};

// Gender keywords
const GENDER_KEYWORDS: Record<string, string> = {
    male: "male",
    males: "male",
    man: "male",
    men: "male",
    boy: "male",
    boys: "male",
    female: "female",
    females: "female",
    woman: "female",
    women: "female",
    girl: "female",
    girls: "female",
};

export interface ParsedQuery extends ProfileFilters {
    interpreted: boolean;
}

export function parseNaturalLanguageQuery(q: string): ParsedQuery {
    const query = q.toLowerCase().trim();
    const filters: ParsedQuery = { interpreted: false };

    if (!query) return filters;

    // ── Gender ───
    // Handle "male and female" or "both" → no gender filter
    const bothGenders =
        /\b(male and female|female and male|both genders?|all genders?)\b/.test(query);

    if (!bothGenders) {
        for (const [keyword, value] of Object.entries(GENDER_KEYWORDS)) {
            if (new RegExp(`\\b${keyword}\\b`).test(query)) {
                filters.gender = value;
                break;
            }
        }
    }

    // ── Age group ───
    for (const [keyword, value] of Object.entries(AGE_GROUP_KEYWORDS)) {
        if (new RegExp(`\\b${keyword}\\b`).test(query)) {
            filters.age_group = value;
            break;
        }
    }

    // ── "young" → ages 16–24 (parsing only, not a stored group) ───
    if (/\byoung\b/.test(query) && !filters.age_group) {
        filters.min_age = 16;
        filters.max_age = 24;
    }

    // ── Age expressions ──
    // "above X" / "over X" / "older than X"
    const aboveMatch = query.match(/\b(?:above|over|older than|greater than)\s+(\d+)\b/);
    if (aboveMatch) {
        filters.min_age = parseInt(aboveMatch[1]);
    }

    // "below X" / "under X" / "younger than X"
    const belowMatch = query.match(/\b(?:below|under|younger than|less than)\s+(\d+)\b/);
    if (belowMatch) {
        filters.max_age = parseInt(belowMatch[1]);
    }

    // "between X and Y"
    const betweenMatch = query.match(/\bbetween\s+(\d+)\s+and\s+(\d+)\b/);
    if (betweenMatch) {
        filters.min_age = parseInt(betweenMatch[1]);
        filters.max_age = parseInt(betweenMatch[2]);
    }

    // "aged X" / "age X"
    const agedMatch = query.match(/\baged?\s+(\d+)\b/);
    if (agedMatch) {
        filters.min_age = parseInt(agedMatch[1]);
        filters.max_age = parseInt(agedMatch[1]);
    }

    // ── Country ───
    // Check multi-word countries first (longer match wins)
    const sortedCountries = Object.keys(COUNTRY_MAP).sort((a, b) => b.length - a.length);

    for (const countryName of sortedCountries) {
        if (query.includes(countryName)) {
            filters.country_id = COUNTRY_MAP[countryName];
            break;
        }
    }

    // Also check if a 2-letter ISO code is directly mentioned e.g. "from NG"
    if (!filters.country_id) {
        const isoMatch = query.match(/\bfrom\s+([A-Z]{2})\b/i);
        if (isoMatch) {
            filters.country_id = isoMatch[1].toUpperCase();
        }
    }

    // ── Determine if query was interpretable ───
    const hasAnyFilter =
        filters.gender !== undefined ||
        filters.age_group !== undefined ||
        filters.country_id !== undefined ||
        filters.min_age !== undefined ||
        filters.max_age !== undefined;

    filters.interpreted = hasAnyFilter;

    return filters;
}