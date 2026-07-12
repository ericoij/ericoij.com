import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clamp, differenceHash, mediaDate, technicalScore, visualMetrics } from '../server.js';

test('clamp keeps scores between bounds', () => {
  assert.equal(clamp(-3), 0);
  assert.equal(clamp(55), 55);
  assert.equal(clamp(120), 100);
});

test('technicalScore rewards balanced, detailed, high-resolution media', () => {
  const strong = technicalScore({ edge: 20, contrast: 55, brightness: 128, saturation: 35 }, 4032, 3024);
  const weak = technicalScore({ edge: 2, contrast: 8, brightness: 245, saturation: 2 }, 640, 480);
  assert.ok(strong > weak);
  assert.ok(strong >= 70);
});

test('visualMetrics detects a flat image', () => {
  const data = Buffer.from([128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128]);
  const metrics = visualMetrics(data, { width: 2, height: 2, channels: 3 });
  assert.equal(metrics.brightness, 128);
  assert.equal(metrics.contrast, 0);
  assert.equal(metrics.edge, 0);
});

test('differenceHash is deterministic and fixed-width', () => {
  const data = Buffer.from(Array.from({ length: 72 }, (_, index) => index));
  const first = differenceHash(data, 9, 8);
  const second = differenceHash(data, 9, 8);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{16}$/);
});

test('mediaDate reads dated folders and camera filenames', () => {
  assert.equal(mediaDate('C:\\Photos\\2024\\07\\image.jpg').toISOString(), '2024-07-31T00:00:00.000Z');
  assert.equal(mediaDate('C:\\Photos\\20230719_120000.jpg').toISOString(), '2023-07-19T00:00:00.000Z');
  assert.equal(mediaDate('image.jpg', new Date('2022-02-03T12:00:00Z')).toISOString(), '2022-02-03T12:00:00.000Z');
});
