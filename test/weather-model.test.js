const test = require("node:test");
const assert = require("node:assert/strict");

test("IGRA parser converts tenths of m/s without treating wind as knots", async () => {
  const { parseLatest500Hpa } = await import("../scripts/update-weather-model.mjs");
  const header = "#USM00072489 2026 07 25 12 1106  276 ncdc-nws           395681 -1197966";
  const level = "10  1456  50000  5913B  -78B  775    32   186   180 ";
  const observation = parseLatest500Hpa(`${header}\n${level}`, "Reno, NV");
  assert.equal(observation.windSpeedMs, 18);
  assert.equal(observation.windDirectionDeg, 186);
  assert.ok(Math.abs(observation.temperatureC - -7.8) < 0.001);
  assert.equal(observation.relativeHumidityPct, 77.5);
  assert.ok(Math.abs(observation.uMs - 1.8815) < 0.01);
  assert.ok(Math.abs(observation.vMs - 17.9014) < 0.01);
});
