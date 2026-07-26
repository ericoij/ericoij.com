const $ = (selector) => document.querySelector(selector);
const canvas = $("#wind-map");
const context = canvas.getContext("2d");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

$("#year").textContent = new Date().getFullYear();

const formatDate = (value) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZoneName: "short",
  }).format(new Date(value));

const formatObservation = (value) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));

function renderTable(stations) {
  $("#station-rows").innerHTML = stations
    .slice()
    .sort((a, b) => b.windSpeedMph - a.windSpeedMph)
    .map(
      (station) => `
        <tr>
          <td>
            <strong>${station.name}</strong>
            <span>${station.id}</span>
          </td>
          <td>${station.windSpeedMph.toFixed(1)} mph</td>
          <td>${Math.round(station.windDirectionDeg)}°</td>
          <td>${station.temperatureC.toFixed(1)} °C</td>
          <td>${station.relativeHumidityPct.toFixed(1)}%</td>
        </tr>`,
    )
    .join("");
}

function resizeCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const bounds = canvas.getBoundingClientRect();
  canvas.width = Math.round(bounds.width * ratio);
  canvas.height = Math.round(bounds.height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width: bounds.width, height: bounds.height };
}

function buildMap(data) {
  let size = resizeCanvas();
  const bounds = data.region;
  const inset = 28;
  const project = (lon, lat) => ({
    x: inset + ((lon - bounds.west) / (bounds.east - bounds.west)) * (size.width - inset * 2),
    y: inset + ((bounds.north - lat) / (bounds.north - bounds.south)) * (size.height - inset * 2),
  });

  const projectedStations = data.stations.map((station) => ({
    ...station,
    ...project(station.longitude, station.latitude),
  }));

  const fieldAt = (x, y) => {
    let u = 0;
    let v = 0;
    let weightTotal = 0;
    for (const station of projectedStations) {
      const dx = x - station.x;
      const dy = y - station.y;
      const weight = 1 / Math.max(dx * dx + dy * dy, 80);
      u += station.uMs * weight;
      v += station.vMs * weight;
      weightTotal += weight;
    }
    return { u: u / weightTotal, v: v / weightTotal };
  };

  const outline = [
    [-124.7, 48.4], [-123, 42], [-120, 38], [-117, 32.5], [-111, 31.4],
    [-106.5, 31.8], [-103, 29.2], [-97.2, 25.8], [-90, 29], [-82, 25.4],
    [-80, 32], [-75, 35], [-67, 44.5], [-71, 47], [-83, 46], [-89, 48],
    [-96, 49], [-110, 49], [-124.7, 48.4],
  ].map(([lon, lat]) => project(lon, lat));

  const particles = Array.from({ length: reducedMotion ? 110 : 320 }, () => ({
    x: Math.random() * size.width,
    y: Math.random() * size.height,
    age: Math.random() * 90,
  }));

  const reset = (particle) => {
    particle.x = Math.random() * size.width;
    particle.y = Math.random() * size.height;
    particle.age = 0;
  };

  const drawBackground = () => {
    context.fillStyle = "#102d27";
    context.fillRect(0, 0, size.width, size.height);
    context.beginPath();
    outline.forEach((point, index) =>
      index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y),
    );
    context.closePath();
    context.fillStyle = "rgba(233, 226, 202, 0.08)";
    context.fill();
    context.strokeStyle = "rgba(233, 226, 202, 0.4)";
    context.lineWidth = 1.25;
    context.stroke();
  };

  const drawStations = () => {
    for (const station of projectedStations) {
      const scale = 1.15;
      context.beginPath();
      context.moveTo(station.x, station.y);
      context.lineTo(station.x + station.uMs * scale, station.y - station.vMs * scale);
      context.strokeStyle = "#ff6b4a";
      context.lineWidth = 1.5;
      context.stroke();
      context.beginPath();
      context.arc(station.x, station.y, 2.5, 0, Math.PI * 2);
      context.fillStyle = "#e7ff62";
      context.fill();
    }
  };

  const draw = () => {
    drawBackground();
    context.lineCap = "round";
    for (const particle of particles) {
      const vector = fieldAt(particle.x, particle.y);
      const speed = Math.hypot(vector.u, vector.v);
      const multiplier = 0.12;
      const nextX = particle.x + vector.u * multiplier;
      const nextY = particle.y - vector.v * multiplier;
      context.beginPath();
      context.moveTo(particle.x, particle.y);
      context.lineTo(nextX, nextY);
      context.strokeStyle = `rgba(231, 255, 98, ${Math.min(0.7, 0.18 + speed / 75)})`;
      context.lineWidth = 0.8 + Math.min(speed / 35, 1.2);
      context.stroke();
      particle.x = nextX;
      particle.y = nextY;
      particle.age += 1;
      if (
        particle.age > 90 ||
        particle.x < 0 ||
        particle.x > size.width ||
        particle.y < 0 ||
        particle.y > size.height
      ) {
        reset(particle);
      }
    }
    drawStations();
    if (!reducedMotion) requestAnimationFrame(draw);
  };

  draw();
  if (reducedMotion) {
    for (let frame = 0; frame < 16; frame += 1) draw();
  }

  window.addEventListener(
    "resize",
    () => {
      size = resizeCanvas();
    },
    { passive: true },
  );
}

async function loadWeatherModel() {
  try {
    const response = await fetch("data/weather-model.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Weather data returned ${response.status}`);
    const data = await response.json();

    $("#data-status").textContent = "Latest NOAA sounding";
    $("#data-dot").classList.add("live");
    $("#mean-wind").textContent = `${data.summary.averageWindSpeedMph.toFixed(1)} mph`;
    $("#max-wind").textContent = `${data.summary.strongestWindSpeedMph.toFixed(1)} mph`;
    $("#observation-time").textContent = formatObservation(data.observationTime);
    $("#station-count").textContent = data.stations.length;
    $("#generated-time").textContent = formatDate(data.generatedAt);
    renderTable(data.stations);
    buildMap(data);
  } catch (error) {
    $("#data-status").textContent = "Data temporarily unavailable";
    $("#station-rows").innerHTML =
      '<tr><td colspan="5">The latest observation could not be loaded. Please check back shortly.</td></tr>';
    console.error(error);
  }
}

loadWeatherModel();
