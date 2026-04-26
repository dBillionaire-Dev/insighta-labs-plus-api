import axios from "axios";
import {
  GenderizeResponse,
  AgifyResponse,
  NationalizeResponse,
  AggregatedData,
} from "../types";

const GENDERIZE_URL = "https://api.genderize.io";
const AGIFY_URL = "https://api.agify.io";
const NATIONALIZE_URL = "https://api.nationalize.io";

function classifyAgeGroup(age: number): string {
  if (age <= 12) return "child";
  if (age <= 19) return "teenager";
  if (age <= 59) return "adult";
  return "senior";
}

export async function aggregateName(name: string): Promise<AggregatedData> {
  // Call all three APIs in parallel
  const [genderRes, agifyRes, nationalizeRes] = await Promise.all([
    axios
      .get<GenderizeResponse>(`${GENDERIZE_URL}?name=${encodeURIComponent(name)}`)
      .catch(() => {
        throw new ExternalApiError("Genderize");
      }),
    axios
      .get<AgifyResponse>(`${AGIFY_URL}?name=${encodeURIComponent(name)}`)
      .catch(() => {
        throw new ExternalApiError("Agify");
      }),
    axios
      .get<NationalizeResponse>(
        `${NATIONALIZE_URL}?name=${encodeURIComponent(name)}`
      )
      .catch(() => {
        throw new ExternalApiError("Nationalize");
      }),
  ]);

  // Validate Genderize
  const genderData = genderRes.data;
  if (!genderData.gender || !genderData.count || genderData.count === 0) {
    throw new ExternalApiError("Genderize");
  }

  // Validate Agify
  const agifyData = agifyRes.data;
  if (agifyData.age === null || agifyData.age === undefined) {
    throw new ExternalApiError("Agify");
  }

  // Validate Nationalize
  const nationalizeData = nationalizeRes.data;
  if (!nationalizeData.country || nationalizeData.country.length === 0) {
    throw new ExternalApiError("Nationalize");
  }

  // Pick country with highest probability
  const topCountry = nationalizeData.country.reduce((a, b) =>
    a.probability >= b.probability ? a : b
  );

  return {
    gender: genderData.gender,
    gender_probability: genderData.probability,
    sample_size: genderData.count,
    age: agifyData.age,
    age_group: classifyAgeGroup(agifyData.age),
    country_id: topCountry.country_id,
    country_probability: topCountry.probability,
  };
}

export class ExternalApiError extends Error {
  public readonly apiName: string;
  constructor(apiName: string) {
    super(`${apiName} returned an invalid response`);
    this.apiName = apiName;
    this.name = "ExternalApiError";
  }
}
