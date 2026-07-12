import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintingMatches } from '../upload-paintings.js';

test('paintingMatches keeps only safe, unique painting images', () => {
  const analysis = (category, risk = 'low') => ({ category, privacy_risk: risk });
  const matches = paintingMatches([
    { id: 'painting', type: 'image', analysis: analysis('painting') },
    { id: 'photo', type: 'image', analysis: analysis('photography') },
    { id: 'private', type: 'image', analysis: analysis('painting', 'high') },
    { id: 'duplicate', type: 'image', duplicateOf: 'painting', analysis: analysis('painting') },
    { id: 'video', type: 'video', analysis: analysis('painting') }
  ]);
  assert.deepEqual(matches.map((item) => item.id), ['painting']);
});
