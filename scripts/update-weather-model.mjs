import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import AdmZip from "adm-zip";

const DATA_DIRECTORY = "https://www.ncei.noaa.gov/pub/data/igra/data/data-y2d/";
const OUTPUT_PATH = path.resolve("public/data/weather-model.json");

export const STATIONS = [
  ["USM00072786", "Spokane, WA"], ["USM00072489", "Reno, NV"],
  ["USM00072381", "Edwards AFB, CA"], ["USM00072293", "San Diego, CA"],
  ["USM00072681", "Boise, ID"], ["USM00072572", "Salt Lake City, UT"],
  ["USM00072672", "Riverton, WY"], ["USM00072768", "Glasgow, MT"],
  ["USM00072365", "Albuquerque, NM"], ["USM00072662", "Rapid City, SD"],
  ["USM00072562", "North Platte, NE"], ["USM00072357", "Norman, OK"],
  ["USM00072249", "Fort Worth, TX"], ["USM00072649", "Chanhassen, MN"],
  ["USM00072645", "Green Bay, WI"], ["USM00072230", "Birmingham, AL"],
  ["USM00072206", "Jacksonville, FL"], ["USM00072318", "Blacksburg, VA"],
  ["USM00072520", "Pittsburgh, PA"]
];

const numberAt = (line, start, end) => Number(line.slice(start, end).trim());
const valid = (value) => Number.isFinite(value) && value > -8888;

export function parseLatest500Hpa(text, fallbackName = "") {
  let sounding = null;
  let latest = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#")) {
      const year = numberAt(line, 13, 17);
      const month = numberAt(line, 18, 20);
      const day = numberAt(line, 21, 23);
      const hour = numberAt(line, 24, 26);
      sounding = {
        id: line.slice(1, 12).trim(),
        name: fallbackName,
        observedAt: new Date(Date.UTC(year, month - 1, day, hour)).toISOString(),
        latitude: numberAt(line, 55, 62) / 10000,
        longitude: numberAt(line, 63, 71) / 10000
      };
      continue;
    }
    if (!sounding || line.length < 51 || numberAt(line, 9, 15) !== 50000) continue;
    const geopotentialHeightM = numberAt(line, 16, 21);
    const temperatureRaw = numberAt(line, 22, 27);
    const humidityRaw = numberAt(line, 28, 33);
    const windDirectionDeg = numberAt(line, 40, 45);
    const windSpeedRaw = numberAt(line, 46, 51);
    if (!valid(windDirectionDeg) || !valid(windSpeedRaw)) continue;

    // IGRA WSPD is tenths of m/s, not knots.
    const windSpeedMs = windSpeedRaw * 0.1;
    const radians = windDirectionDeg * Math.PI / 180;
    const candidate = {
      ...sounding,
      geopotentialHeightM: valid(geopotentialHeightM) ? geopotentialHeightM : null,
      temperatureC: valid(temperatureRaw) ? temperatureRaw * 0.1 : null,
      relativeHumidityPct: valid(humidityRaw) ? humidityRaw * 0.1 : null,
      windDirectionDeg,
      windSpeedMs,
      windSpeedMph: windSpeedMs * 2.236936,
      uMs: -windSpeedMs * Math.sin(radians),
      vMs: -windSpeedMs * Math.cos(radians)
    };
    if (!latest || candidate.observedAt > latest.observedAt) latest = candidate;
  }
  return latest;
}

async function fetchBuffer(url) {
  const response = await fetch(url, { headers: { "User-Agent": "ericoij-upper-air-lab/1.0" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function findArchiveName(indexHtml, id) {
  const match = indexHtml.match(new RegExp(`${id}-data-[^"<>]+?\\.txt\\.zip`, "i"));
  if (!match) throw new Error(`No current NOAA archive found for ${id}`);
  return match[0];
}

async function loadStation(indexHtml, [id, name]) {
  const archiveName = findArchiveName(indexHtml, id);
  const zip = new AdmZip(await fetchBuffer(`${DATA_DIRECTORY}${archiveName}`));
  const entry = zip.getEntries().find((item) => !item.isDirectory && item.entryName.endsWith(".txt"));
  if (!entry) throw new Error(`No sounding text found in ${archiveName}`);
  const observation = parseLatest500Hpa(entry.getData().toString("utf8"), name);
  if (!observation) throw new Error(`No valid 500 hPa observation found for ${id}`);
  return observation;
}

export async function updateWeatherModel() {
  const indexResponse = await fetch(DATA_DIRECTORY, { headers: { "User-Agent": "ericoij-upper-air-lab/1.0" } });
  if (!indexResponse.ok) throw new Error(`Unable to read NOAA archive index: ${indexResponse.status}`);
  const indexHtml = await indexResponse.text();
  const results = await Promise.allSettled(STATIONS.map((station) => loadStation(indexHtml, station)));
  const stations = results.filter((result) => result.status === "fulfilled")
    .map((result) => result.value).sort((a, b) => b.windSpeedMs - a.windSpeedMs);
  const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason.message);
  if (stations.length < 10) throw new Error(`Only ${stations.length} stations returned valid data: ${errors.join("; ")}`);

  const strongest = stations[0];
  const averageWindSpeedMs = stations.reduce((sum, station) => sum + station.windSpeedMs, 0) / stations.length;
  const payload = {
    generatedAt: new Date().toISOString(),
    observationTime: stations.reduce((latest, station) => station.observedAt > latest ? station.observedAt : latest, stations[0].observedAt),
    pressureLevelHpa: 500,
    region: { north: 50, south: 30, west: -120, east: -80 },
    source: {
      name: "NOAA NCEI Integrated Global Radiosonde Archive v2.2",
      url: "https://www.ncei.noaa.gov/products/weather-balloon/integrated-global-radiosonde-archive",
      cadence: "Updated daily after the 00Z and 12Z sounding cycles"
    },
    corrections: {
      inputWindScale: "IGRA WSPD × 0.1 = m/s",
      vectorFormula: "u = −speed·sin(direction), v = −speed·cos(direction)",
      integrationFormula: "state(t+Δt) = state(t) + tendency·Δt"
    },
    summary: {
      stationCount: stations.length,
      averageWindSpeedMs,
      averageWindSpeedMph: averageWindSpeedMs * 2.236936,
      strongestStation: strongest.name,
      strongestWindSpeedMs: strongest.windSpeedMs,
      strongestWindSpeedMph: strongest.windSpeedMph
    },
    stations,
    warnings: errors
  };
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Updated ${OUTPUT_PATH} with ${stations.length} stations from ${payload.observationTime}`);
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  updateWeatherModel().catch((error) => { console.error(error); process.exitCode = 1; });
}
