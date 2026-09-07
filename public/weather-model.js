const $ = (selector) => document.querySelector(selector);
const canvas = $("#wind-map");
const context = canvas?.getContext("2d");

$("#year").textContent = new Date().getFullYear();

const fmt = (value, options) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, options).format(date);
};

const formatDate = (value) =>
  fmt(value, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

const formatObservation = (value) =>
  fmt(value, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });

const formatNumber = (value, digits = 1) =>
  Number.isFinite(value) ? value.toFixed(digits) : "—";

function renderTable(stations) {
  $("#station-rows").innerHTML = stations
    .slice()
    .sort((a, b) => (b.windSpeedMph ?? -Infinity) - (a.windSpeedMph ?? -Infinity))
    .map((station) => `
      <tr>
        <td><strong>${station.name}</strong><span>${station.id}</span></td>
        <td>${formatObservation(station.observedAt)}</td>
        <td>${Number.isFinite(station.windDirectionDeg) ? `${Math.round(station.windDirectionDeg)}°` : "—"}</td>
        <td>${Number.isFinite(station.windSpeedMph) ? `${station.windSpeedMph.toFixed(1)} mph` : "—"}</td>
        <td>${Number.isFinite(station.temperatureC) ? `${station.temperatureC.toFixed(1)} °C` : "—"}</td>
        <td>${Number.isFinite(station.geopotentialHeightM) ? `${Math.round(station.geopotentialHeightM).toLocaleString()} m` : "—"}</td>
      </tr>`)
    .join("");
}

function resizeCanvas() {
  if (!canvas || !context) throw new Error("500 hPa canvas is unavailable");
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, rect.width || canvas.parentElement?.clientWidth || 960);
  const height = Math.max(420, rect.height || 620);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width, height };
}

function buildMap(data) {
  let resizeTimer;

  const draw = () => {
    const { width, height } = resizeCanvas();
    const bounds = { north: 50, south: 24, west: -125, east: -66.5 };
    const inset = { top: 28, right: 28, bottom: 42, left: 52 };
    const plotWidth = width - inset.left - inset.right;
    const plotHeight = height - inset.top - inset.bottom;

    const project = (lon, lat) => ({
      x: inset.left + ((lon - bounds.west) / (bounds.east - bounds.west)) * plotWidth,
      y: inset.top + ((bounds.north - lat) / (bounds.north - bounds.south)) * plotHeight,
    });

    const stations = (data.stations || []).filter((station) =>
      Number.isFinite(station.latitude) &&
      Number.isFinite(station.longitude) &&
      Number.isFinite(station.uMs) &&
      Number.isFinite(station.vMs),
    );
    if (!stations.length) throw new Error("Downloaded data contains no mappable 500 hPa stations");

    const plotted = stations.map((station) => ({
      ...station,
      ...project(station.longitude, station.latitude),
    }));
    const heights = plotted.filter((station) => Number.isFinite(station.geopotentialHeightM));

    const conus = [
      [-124.7,48.4],[-124.2,42],[-122.5,38],[-120,34.7],[-117.1,32.5],
      [-111,31.3],[-106.5,31.8],[-103,29.7],[-97.2,25.8],[-90,29],
      [-85,29.8],[-81.2,25.2],[-80,32],[-77,35.5],[-75,39],[-74,40.5],
      [-70,42],[-67,44.7],[-70,47],[-83,46],[-89,48],[-96,49],[-110,49],[-124.7,48.4],
    ].map(([lon, lat]) => project(lon, lat));

    const traceConus = () => {
      context.beginPath();
      conus.forEach((point, i) => i ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
      context.closePath();
    };

    const heightAt = (x, y) => {
      if (!heights.length) return null;
      let value = 0;
      let totalWeight = 0;
      for (const station of heights) {
        const dx = x - station.x;
        const dy = y - station.y;
        const weight = 1 / Math.max(dx * dx + dy * dy, 180);
        value += station.geopotentialHeightM * weight;
        totalWeight += weight;
      }
      return totalWeight ? value / totalWeight : null;
    };

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#102d27";
    context.fillRect(0, 0, width, height);

    if (heights.length >= 3) {
      const observedHeights = heights.map((station) => station.geopotentialHeightM);
      const minHeight = Math.min(...observedHeights);
      const maxHeight = Math.max(...observedHeights);
      const span = Math.max(1, maxHeight - minHeight);
      const cell = 14;
      context.save();
      traceConus();
      context.clip();
      for (let y = inset.top; y < height - inset.bottom; y += cell) {
        for (let x = inset.left; x < width - inset.right; x += cell) {
          const h = heightAt(x + cell / 2, y + cell / 2);
          if (!Number.isFinite(h)) continue;
          const t = (h - minHeight) / span;
          context.fillStyle = `rgba(135, 182, 255, ${0.08 + t * 0.24})`;
          context.fillRect(x, y, cell + 1, cell + 1);
        }
      }
      context.restore();
    }

    context.strokeStyle = "rgba(243,240,232,.14)";
    context.lineWidth = 1;
    for (let lon = -120; lon <= -70; lon += 10) {
      const a = project(lon, bounds.north);
      const b = project(lon, bounds.south);
      context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
    }
    for (let lat = 25; lat <= 50; lat += 5) {
      const a = project(bounds.west, lat);
      const b = project(bounds.east, lat);
      context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
    }

    traceConus();
    context.fillStyle = "rgba(243,240,232,.025)";
    context.fill();
    context.strokeStyle = "rgba(243,240,232,.78)";
    context.lineWidth = 1.5;
    context.stroke();

    context.fillStyle = "rgba(243,240,232,.55)";
    context.font = '10px "DM Mono", monospace';
    context.textAlign = "center";
    for (let lon = -120; lon <= -70; lon += 10) {
      const p = project(lon, bounds.south);
      context.fillText(`${Math.abs(lon)}°W`, p.x, height - 14);
    }
    context.textAlign = "right";
    for (let lat = 25; lat <= 50; lat += 5) {
      const p = project(bounds.west, lat);
      context.fillText(`${lat}°N`, inset.left - 8, p.y + 3);
    }

    for (const station of plotted) {
      const scale = 1.5;
      const endX = station.x + station.uMs * scale;
      const endY = station.y - station.vMs * scale;
      context.strokeStyle = "#ff6b4a";
      context.lineWidth = 1.7;
      context.beginPath(); context.moveTo(station.x, station.y); context.lineTo(endX, endY); context.stroke();

      const angle = Math.atan2(endY - station.y, endX - station.x);
      const head = 5;
      context.beginPath();
      context.moveTo(endX, endY);
      context.lineTo(endX - Math.cos(angle - .55) * head, endY - Math.sin(angle - .55) * head);
      context.moveTo(endX, endY);
      context.lineTo(endX - Math.cos(angle + .55) * head, endY - Math.sin(angle + .55) * head);
      context.stroke();

      context.fillStyle = "#e7ff62";
      context.beginPath(); context.arc(station.x, station.y, 3, 0, Math.PI * 2); context.fill();

      const name = (station.name || station.id || "station").split(",")[0];
      const dam = Number.isFinite(station.geopotentialHeightM)
        ? `${Math.round(station.geopotentialHeightM / 10)} dam`
        : "—";
      context.textAlign = "left";
      context.font = '600 10px "DM Mono", monospace';
      context.fillStyle = "#f3f0e8";
      context.fillText(name, station.x + 6, station.y - 7);
      context.font = '10px "DM Mono", monospace';
      context.fillStyle = "#e7ff62";
      context.fillText(dam, station.x + 6, station.y + 6);
    }
  };

  draw();
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(draw, 120);
  }, { passive: true });
}

async function loadWeatherModel() {
  try {
    const response = await fetch("data/weather-model.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Weather data returned ${response.status}`);
    const data = await response.json();

    $("#data-status").textContent = "Latest NOAA sounding";
    $("#data-dot").classList.add("is-live");
    $("#mean-wind").textContent = `${formatNumber(data.summary?.averageWindSpeedMph)} mph`;
    $("#max-wind").textContent = `${formatNumber(data.summary?.strongestWindSpeedMph)} mph`;
    $("#observation-time").textContent = formatObservation(data.observationTime);
    $("#station-count").textContent = `Across ${(data.stations || []).length} stations`;

    buildMap(data);
    renderTable(data.stations || []);
    $("#generated-time").textContent = formatDate(data.generatedAt);
  } catch (error) {
    $("#data-status").textContent = "Data temporarily unavailable";
    $("#station-rows").innerHTML = '<tr><td colspan="6">The latest observation could not be loaded. Please check back shortly.</td></tr>';
    if (context && canvas) {
      const { width, height } = resizeCanvas();
      context.fillStyle = "#102d27";
      context.fillRect(0, 0, width, height);
      context.fillStyle = "#f3f0e8";
      context.font = '14px "DM Mono", monospace';
      context.fillText("500 hPa map unavailable — see console for details", 30, 50);
    }
    console.error(error);
  }
}

loadWeatherModel();
