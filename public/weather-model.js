const $ = (selector) => document.querySelector(selector);
const canvas = $("#wind-map");
const context = canvas.getContext("2d");

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

const formatNumber = (value, digits = 1, fallback = "—") =>
  Number.isFinite(value) ? value.toFixed(digits) : fallback;

function renderTable(stations) {
  $("#station-rows").innerHTML = stations
    .slice()
    .sort((a, b) => (b.windSpeedMph ?? -Infinity) - (a.windSpeedMph ?? -Infinity))
    .map(
      (station) => `
        <tr>
          <td>
            <strong>${station.name}</strong>
            <span>${station.id}</span>
          </td>
          <td>${station.observedAt ? formatObservation(station.observedAt) : "—"}</td>
          <td>${Number.isFinite(station.windDirectionDeg) ? `${Math.round(station.windDirectionDeg)}°` : "—"}</td>
          <td>${Number.isFinite(station.windSpeedMph) ? `${station.windSpeedMph.toFixed(1)} mph` : "—"}</td>
          <td>${Number.isFinite(station.temperatureC) ? `${station.temperatureC.toFixed(1)} °C` : "—"}</td>
          <td>${Number.isFinite(station.geopotentialHeightM) ? `${Math.round(station.geopotentialHeightM).toLocaleString()} m` : "—"}</td>
        </tr>`,
    )
    .join("");
}

function resizeCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const bounds = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(bounds.width * ratio));
  canvas.height = Math.max(1, Math.round(bounds.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width: bounds.width, height: bounds.height };
}

function buildMap(data) {
  let resizeTimer;

  const drawMap = () => {
    const size = resizeCanvas();
    if (size.width < 10 || size.height < 10) return;

    // Full contiguous-U.S. domain. The old 120W–80W / 30N–50N box clipped
    // the West Coast, Gulf Coast, Florida, and much of the Northeast.
    const bounds = { north: 50, south: 24, west: -125, east: -66.5 };
    const inset = 38;
    const plotWidth = size.width - inset * 2;
    const plotHeight = size.height - inset * 2;

    const project = (lon, lat) => ({
      x: inset + ((lon - bounds.west) / (bounds.east - bounds.west)) * plotWidth,
      y: inset + ((bounds.north - lat) / (bounds.north - bounds.south)) * plotHeight,
    });

    const stations = data.stations.filter(
      (station) =>
        Number.isFinite(station.latitude) &&
        Number.isFinite(station.longitude) &&
        Number.isFinite(station.uMs) &&
        Number.isFinite(station.vMs),
    );
    if (!stations.length) throw new Error("No mappable 500 hPa observations were found");

    const projectedStations = stations.map((station) => ({
      ...station,
      ...project(station.longitude, station.latitude),
    }));
    const heightStations = projectedStations.filter((station) => Number.isFinite(station.geopotentialHeightM));

    const outlineCoords = [
      [-124.7, 48.4], [-124.3, 46.0], [-124.1, 43.0], [-124.2, 40.0],
      [-122.7, 37.5], [-120.0, 34.7], [-117.1, 32.5], [-114.7, 32.7],
      [-111.0, 31.3], [-106.5, 31.8], [-103.0, 29.7], [-97.2, 25.8],
      [-90.0, 29.0], [-85.0, 29.8], [-81.2, 25.2], [-80.0, 29.0],
      [-80.0, 32.0], [-77.0, 35.5], [-75.0, 38.5], [-74.0, 40.5],
      [-70.0, 42.0], [-67.0, 44.7], [-70.0, 47.0], [-83.0, 46.0],
      [-89.0, 48.0], [-96.0, 49.0], [-110.0, 49.0], [-124.7, 48.4],
    ];
    const outline = outlineCoords.map(([lon, lat]) => project(lon, lat));

    const traceOutline = () => {
      context.beginPath();
      outline.forEach((point, index) =>
        index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y),
      );
      context.closePath();
    };

    const heightAt = (x, y) => {
      if (!heightStations.length) return null;
      let total = 0;
      let weightTotal = 0;
      for (const station of heightStations) {
        const dx = x - station.x;
        const dy = y - station.y;
        const weight = 1 / Math.max(dx * dx + dy * dy, 220);
        total += station.geopotentialHeightM * weight;
        weightTotal += weight;
      }
      return weightTotal ? total / weightTotal : null;
    };

    context.clearRect(0, 0, size.width, size.height);
    context.fillStyle = "#102d27";
    context.fillRect(0, 0, size.width, size.height);

    // Geographic graticule makes the plot unmistakably a map even before
    // station data are drawn.
    context.save();
    traceOutline();
    context.clip();
    context.strokeStyle = "rgba(233, 226, 202, 0.12)";
    context.lineWidth = 1;
    for (let lon = -120; lon <= -70; lon += 10) {
      const top = project(lon, bounds.north);
      const bottom = project(lon, bounds.south);
      context.beginPath();
      context.moveTo(top.x, top.y);
      context.lineTo(bottom.x, bottom.y);
      context.stroke();
    }
    for (let lat = 25; lat <= 50; lat += 5) {
      const left = project(bounds.west, lat);
      const right = project(bounds.east, lat);
      context.beginPath();
      context.moveTo(left.x, left.y);
      context.lineTo(right.x, right.y);
      context.stroke();
    }

    // Interpolate geopotential height directly from the downloaded sounding
    // observations. This is intentionally simple IDW analysis, not a forecast.
    if (heightStations.length >= 3) {
      const heights = heightStations.map((station) => station.geopotentialHeightM);
      const minHeight = Math.min(...heights);
      const maxHeight = Math.max(...heights);
      const cell = Math.max(10, Math.min(20, size.width / 70));
      for (let y = inset; y < size.height - inset; y += cell) {
        for (let x = inset; x < size.width - inset; x += cell) {
          const height = heightAt(x + cell / 2, y + cell / 2);
          if (!Number.isFinite(height)) continue;
          const span = Math.max(1, maxHeight - minHeight);
          const normalized = (height - minHeight) / span;
          const alpha = 0.05 + normalized * 0.20;
          context.fillStyle = `rgba(135, 182, 255, ${alpha})`;
          context.fillRect(x, y, cell + 1, cell + 1);
        }
      }

      // Draw simple 60 m geopotential-height contours using marching-edge
      // interpolation across a coarse analysis grid.
      const cols = 44;
      const rows = 24;
      const grid = Array.from({ length: rows + 1 }, (_, row) =>
        Array.from({ length: cols + 1 }, (_, col) => {
          const x = inset + (col / cols) * plotWidth;
          const y = inset + (row / rows) * plotHeight;
          return { x, y, value: heightAt(x, y) };
        }),
      );
      const firstContour = Math.ceil(minHeight / 60) * 60;
      const lastContour = Math.floor(maxHeight / 60) * 60;

      const crossing = (a, b, level) => {
        if (!Number.isFinite(a.value) || !Number.isFinite(b.value) || a.value === b.value) return null;
        if ((a.value - level) * (b.value - level) > 0) return null;
        const t = (level - a.value) / (b.value - a.value);
        if (t < 0 || t > 1) return null;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      };

      context.strokeStyle = "rgba(231, 255, 98, 0.58)";
      context.lineWidth = 1.15;
      for (let level = firstContour; level <= lastContour; level += 60) {
        for (let row = 0; row < rows; row += 1) {
          for (let col = 0; col < cols; col += 1) {
            const tl = grid[row][col];
            const tr = grid[row][col + 1];
            const br = grid[row + 1][col + 1];
            const bl = grid[row + 1][col];
            const points = [
              crossing(tl, tr, level),
              crossing(tr, br, level),
              crossing(br, bl, level),
              crossing(bl, tl, level),
            ].filter(Boolean);
            if (points.length < 2) continue;
            context.beginPath();
            context.moveTo(points[0].x, points[0].y);
            context.lineTo(points[1].x, points[1].y);
            context.stroke();
            if (points.length === 4) {
              context.beginPath();
              context.moveTo(points[2].x, points[2].y);
              context.lineTo(points[3].x, points[3].y);
              context.stroke();
            }
          }
        }
      }
    }
    context.restore();

    // Coastline / national outline on top of the analysis.
    traceOutline();
    context.fillStyle = "rgba(233, 226, 202, 0.025)";
    context.fill();
    context.strokeStyle = "rgba(243, 240, 232, 0.72)";
    context.lineWidth = 1.5;
    context.stroke();

    // Longitude / latitude labels.
    context.fillStyle = "rgba(243, 240, 232, 0.48)";
    context.font = '10px "DM Mono", monospace';
    context.textAlign = "center";
    for (let lon = -120; lon <= -70; lon += 10) {
      const point = project(lon, bounds.south);
      context.fillText(`${Math.abs(lon)}°W`, point.x, size.height - 12);
    }
    context.textAlign = "right";
    for (let lat = 25; lat <= 50; lat += 5) {
      const point = project(bounds.west, lat);
      context.fillText(`${lat}°N`, inset - 7, point.y + 3);
    }

    // Plot each downloaded station as an observed wind vector. The adjacent
    // three-digit number is the 500 hPa geopotential height in decameters.
    context.lineCap = "round";
    for (const station of projectedStations) {
      const vectorScale = 1.45;
      const endX = station.x + station.uMs * vectorScale;
      const endY = station.y - station.vMs * vectorScale;
      context.beginPath();
      context.moveTo(station.x, station.y);
      context.lineTo(endX, endY);
      context.strokeStyle = "#ff6b4a";
      context.lineWidth = 1.7;
      context.stroke();

      const angle = Math.atan2(endY - station.y, endX - station.x);
      const arrowSize = 5;
      context.beginPath();
      context.moveTo(endX, endY);
      context.lineTo(endX - Math.cos(angle - 0.55) * arrowSize, endY - Math.sin(angle - 0.55) * arrowSize);
      context.moveTo(endX, endY);
      context.lineTo(endX - Math.cos(angle + 0.55) * arrowSize, endY - Math.sin(angle + 0.55) * arrowSize);
      context.stroke();

      context.beginPath();
      context.arc(station.x, station.y, 3, 0, Math.PI * 2);
      context.fillStyle = "#e7ff62";
      context.fill();

      const heightDam = Number.isFinite(station.geopotentialHeightM)
        ? Math.round(station.geopotentialHeightM / 10)
        : null;
      const shortName = station.name.split(",")[0];
      context.textAlign = "left";
      context.font = '600 10px "DM Mono", monospace';
      context.fillStyle = "#f3f0e8";
      context.fillText(shortName, station.x + 6, station.y - 8);
      context.font = '10px "DM Mono", monospace';
      context.fillStyle = "#e7ff62";
      context.fillText(heightDam ? `${heightDam} dam` : "height —", station.x + 6, station.y + 5);
    }
  };

  drawMap();
  window.addEventListener(
    "resize",
    () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(drawMap, 120);
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
    $("#data-dot").classList.add("is-live");
    $("#mean-wind").textContent = `${formatNumber(data.summary.averageWindSpeedMph)} mph`;
    $("#max-wind").textContent = `${formatNumber(data.summary.strongestWindSpeedMph)} mph`;
    $("#observation-time").textContent = formatObservation(data.observationTime);
    $("#station-count").textContent = `Across ${data.stations.length} stations`;
    $("#generated-time").textContent = formatDate(data.generatedAt);

    buildMap(data);
    renderTable(data.stations);
  } catch (error) {
    $("#data-status").textContent = "Data temporarily unavailable";
    $("#station-rows").innerHTML =
      '<tr><td colspan="6">The latest observation could not be loaded. Please check back shortly.</td></tr>';
    console.error(error);
  }
}

loadWeatherModel();
