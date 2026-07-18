import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function parseOptions(argv) {
  const options = {
    url: 'http://127.0.0.1:4317',
    batch: 25,
    minimumScore: 72,
    top: 0,
    scanLimit: 0,
    output: path.join(__dirname, 'data', 'best-selection.json')
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    const [key, inline] = argument.slice(2).split('=', 2);
    const value = inline ?? argv[++index];
    if (key === 'url') options.url = value.replace(/\/$/, '');
    else if (key === 'batch') options.batch = Number(value);
    else if (key === 'minimum-score') options.minimumScore = Number(value);
    else if (key === 'top') options.top = Number(value);
    else if (key === 'scan-limit') options.scanLimit = Number(value);
    else if (key === 'output') options.output = path.resolve(value);
    else if (key === 'skip-scan') options.skipScan = value !== 'false';
    else throw new Error(`Unknown option: --${key}`);
  }
  if (!Number.isInteger(options.batch) || options.batch < 1 || options.batch > 500) throw new Error('--batch must be an integer from 1 to 500');
  if (!Number.isFinite(options.minimumScore) || options.minimumScore < 0 || options.minimumScore > 100) throw new Error('--minimum-score must be from 0 to 100');
  if (!Number.isInteger(options.top) || options.top < 0) throw new Error('--top must be zero or a positive integer');
  if (!Number.isInteger(options.scanLimit) || options.scanLimit < 0) throw new Error('--scan-limit must be zero or a positive integer');
  return options;
}

async function api(baseUrl, route, options) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `${route} returned ${response.status}`);
  return body;
}

async function waitForIdle(baseUrl) {
  while (true) {
    const status = await api(baseUrl, '/api/status');
    const progress = status.total ? ` ${status.completed}/${status.total}` : '';
    process.stdout.write(`\r${status.message}${progress}`.padEnd(100));
    if (!status.task) {
      process.stdout.write('\n');
      if (status.error) throw new Error(status.error);
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

export function rankSelection(items, minimumScore, top = 0) {
  let ranked = items
    .filter((item) => !item.duplicateOf && item.analysis && item.analysis.privacy_risk !== 'high')
    .filter((item) => item.analysis.share_score >= minimumScore)
    .sort((a, b) => b.analysis.share_score - a.analysis.share_score || b.analysis.story_score - a.analysis.story_score)
    .map((item, index) => ({
      rank: index + 1,
      id: item.id,
      path: item.path,
      capturedAt: item.capturedAt,
      title: item.analysis.title,
      category: item.analysis.category,
      shareScore: item.analysis.share_score,
      storyScore: item.analysis.story_score,
      privacyRisk: item.analysis.privacy_risk,
      reason: item.analysis.reason,
      tags: item.analysis.tags
    }));
  if (top > 0) ranked = ranked.slice(0, top).map((item, index) => ({ ...item, rank: index + 1 }));
  return ranked;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  await api(options.url, '/api/status');

  if (!options.skipScan) {
    console.log(options.scanLimit > 0
      ? `Scanning the first ${options.scanLimit} items in the five-year library...`
      : 'Scanning the complete five-year library...');
    await api(options.url, '/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(options.scanLimit > 0 ? { limit: options.scanLimit } : {})
    });
    await waitForIdle(options.url);
  }

  while (true) {
    const items = await api(options.url, '/api/items');
    const remaining = items.filter((item) => !item.duplicateOf && !item.analysis).length;
    if (remaining === 0) break;
    const batch = Math.min(options.batch, remaining);
    console.log(`Evaluating ${batch} photos (${remaining} remaining)...`);
    await api(options.url, '/api/curate', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit: batch })
    });
    await waitForIdle(options.url);
  }

  const items = await api(options.url, '/api/items');
  const selection = rankSelection(items, options.minimumScore, options.top);
  const output = options.output;
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify({
    createdAt: new Date().toISOString(),
    minimumScore: options.minimumScore,
    totalReviewed: items.length,
    selected: selection.length,
    photos: selection
  }, null, 2));
  console.log(`Selected ${selection.length} of ${items.length} items.`);
  console.log(`Shortlist saved to ${output}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Selection stopped: ${error.message}`); process.exitCode = 1; });
}
