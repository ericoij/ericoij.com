import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOptions, rankSelection } from '../select-best.js';

test('parseOptions validates shortlist and scan settings', () => {
  const options = parseOptions(['--batch', '10', '--minimum-score=80', '--top', '25', '--scan-limit', '100', '--review-limit', '50', '--output', 'custom-selection.json']);
  assert.equal(options.batch, 10);
  assert.equal(options.minimumScore, 80);
  assert.equal(options.top, 25);
  assert.equal(options.scanLimit, 100);
  assert.equal(options.reviewLimit, 50);
  assert.match(options.output, /custom-selection\.json$/);
  assert.throws(() => parseOptions(['--batch', '0']), /batch/);
  assert.throws(() => parseOptions(['--scan-limit', '-1']), /scan-limit/);
  assert.throws(() => parseOptions(['--review-limit', '-1']), /review-limit/);
});

test('rankSelection excludes duplicates, high-risk items, and weak scores', () => {
  const analysis = (share, story = 50, risk = 'low') => ({ share_score: share, story_score: story, privacy_risk: risk, title: 'Photo', category: 'people', reason: 'Reason', tags: [] });
  const ranked = rankSelection([
    { id: 'best', path: 'best.jpg', analysis: analysis(92, 80) },
    { id: 'weak', path: 'weak.jpg', analysis: analysis(60) },
    { id: 'private', path: 'private.jpg', analysis: analysis(99, 90, 'high') },
    { id: 'duplicate', path: 'duplicate.jpg', duplicateOf: 'best', analysis: analysis(95) }
  ], 72);
  assert.deepEqual(ranked.map((item) => item.id), ['best']);
  assert.equal(ranked[0].rank, 1);
});
