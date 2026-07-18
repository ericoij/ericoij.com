import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    is_physical_painting: { type: 'boolean' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    reason: { type: 'string' }
  },
  required: ['is_physical_painting', 'confidence', 'reason']
};

const DETAILS_SCHEMA = {
  type: 'object',
  properties: {
    likely_personal_artwork_photo: { type: 'boolean' },
    full_artwork_visible: { type: 'boolean' },
    people_present: { type: 'boolean' },
    capture_quality: { type: 'string', enum: ['poor', 'documentary', 'good', 'portfolio_ready'] },
    suggested_title: { type: 'string' },
    medium_guess: { type: 'string' },
    visual_description: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    issues: { type: 'array', items: { type: 'string' }, maxItems: 5 }
  },
  required: [
    'likely_personal_artwork_photo', 'full_artwork_visible',
    'people_present', 'capture_quality',
    'suggested_title', 'medium_guess', 'visual_description', 'evidence', 'issues'
  ]
};

function parseArguments(argv) {
  const result = {
    data: 'data-iphone', output: '', model: 'gemma3:4b',
    ollama: 'http://127.0.0.1:11434', limit: 100,
    dates: '', dateWindowHours: 36
  };
  for (let index = 0; index < argv.length; index++) {
    if (!argv[index].startsWith('--')) continue;
    const [key, inline] = argv[index].slice(2).split('=', 2);
    const value = inline ?? argv[++index];
    if (key === 'date-window-hours') result.dateWindowHours = Number(value);
    else if (key in result) result[key] = value;
    else throw new Error(`Unknown option: --${key}`);
  }
  result.limit = Number(result.limit);
  result.dateWindowHours = Number(result.dateWindowHours);
  if (!Number.isInteger(result.limit) || result.limit < 0) throw new Error('--limit must be zero or a positive integer');
  if (!Number.isFinite(result.dateWindowHours) || result.dateWindowHours < 0) throw new Error('--date-window-hours must be zero or greater');
  return result;
}

async function readJson(filePath, fallback) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function callOllama(image, prompt, schema, options) {
  const response = await fetch(`${options.ollama.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: options.model,
      messages: [{ role: 'user', content: prompt, images: [image] }],
      format: schema,
      stream: false,
      think: false,
      keep_alive: '30m',
      options: { temperature: 0 }
    }),
    signal: AbortSignal.timeout(300_000)
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
  const body = await response.json();
  return JSON.parse(body.message.content);
}

async function reviewThumbnail(thumbnailPath, item, options) {
  const image = (await sharp(thumbnailPath)
    .rotate()
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer()).toString('base64');
  const verification = await callOllama(image, `Decide whether this image visibly contains a tangible physical painting on canvas, paper, or board.

Most archive images are ordinary photographs and must be false. Food, sunsets, clouds, people, concerts, screens, posters, diagrams, murals, advertisements, and painterly-looking photographs are false unless a distinct physical painted artwork with visible boundaries or brush texture occupies a meaningful part of the image. Return true only with direct visual evidence of a physical painting. The filename is ${item.relativePath}.`, VERIFY_SCHEMA, options);
  const base = {
    is_physical_painting: verification.is_physical_painting,
    verification_confidence: verification.confidence,
    verification_reason: verification.reason,
    evaluatedAt: new Date().toISOString(),
    model: options.model
  };
  if (!verification.is_physical_painting) return base;

  const details = await callOllama(image, `This image has been verified as containing a physical painting. Describe the tangible artwork and assess the photograph for private portfolio curation.

likely_personal_artwork_photo means the capture context resembles a home or working studio rather than a museum, commercial gallery, or public display. It does not establish who created the work. Assess whether the full artwork is visible and whether glare, perspective, clutter, blur, people, or cropping limits portfolio use. Never infer Eric's authorship; that requires human confirmation. The filename is ${item.relativePath}.`, DETAILS_SCHEMA, options);
  return { ...base, ...details };
}

async function writeSummary(catalog, analysisDirectory, output, options) {
  const candidates = [];
  let reviewed = 0;
  for (const item of catalog) {
    const review = await readJson(path.join(analysisDirectory, `${item.id}.json`), null);
    if (!review) continue;
    reviewed++;
    if (!review.is_physical_painting || review.verification_confidence !== 'high') continue;
    candidates.push({
      id: item.id, path: item.path, relativePath: item.relativePath,
      capturedAt: item.capturedAt, technicalScore: item.technicalScore,
      ...review, authorshipConfirmed: false
    });
  }
  const qualityRank = { poor: 0, documentary: 1, good: 2, portfolio_ready: 3 };
  candidates.sort((a, b) =>
    Number(b.likely_personal_artwork_photo) - Number(a.likely_personal_artwork_photo) ||
    qualityRank[b.capture_quality] - qualityRank[a.capture_quality]
  );
  const portfolioCandidates = candidates.filter((candidate) =>
    candidate.likely_personal_artwork_photo && candidate.full_artwork_visible
  );
  await fs.writeFile(output, JSON.stringify({
    createdAt: new Date().toISOString(), model: options.model,
    classifierVersion: 3, catalogItems: catalog.length,
    reviewed, candidateCount: candidates.length,
    portfolioCandidateCount: portfolioCandidates.length,
    needsHumanAuthorshipConfirmation: true,
    portfolioCandidates,
    candidates
  }, null, 2));
  return { reviewed, candidates, portfolioCandidates };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const dataDirectory = path.resolve(options.data);
  const catalog = await readJson(path.join(dataDirectory, 'catalog.json'), []);
  const thumbnailDirectory = path.join(dataDirectory, 'thumbs');
  const analysisDirectory = path.join(dataDirectory, 'painting-analysis-v3');
  const output = path.resolve(options.output || path.join(dataDirectory, 'painting-curation.json'));
  await fs.mkdir(analysisDirectory, { recursive: true });

  const focusDates = String(options.dates || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Date.parse(`${value}T12:00:00Z`));
  if (focusDates.some(Number.isNaN)) throw new Error('--dates must be comma-separated YYYY-MM-DD values');
  const dateWindow = options.dateWindowHours * 60 * 60 * 1000;

  const queue = [];
  for (const item of catalog
    .filter((entry) => !entry.duplicateOf)
    .filter((entry) => focusDates.length === 0 || focusDates.some((date) => Math.abs(Date.parse(entry.capturedAt) - date) <= dateWindow))
    .sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)))) {
    const cached = await readJson(path.join(analysisDirectory, `${item.id}.json`), null);
    if (!cached) queue.push(item);
    if (options.limit > 0 && queue.length >= options.limit) break;
  }

  for (const [index, item] of queue.entries()) {
    console.log(`[${index + 1}/${queue.length}] ${item.relativePath}`);
    const review = await reviewThumbnail(path.join(thumbnailDirectory, `${item.id}.jpg`), item, options);
    await fs.writeFile(path.join(analysisDirectory, `${item.id}.json`), JSON.stringify(review, null, 2));
    if (review.is_physical_painting) {
      console.log(`  painting (${review.verification_confidence}) — ${review.suggested_title}`);
    }
  }

  const summary = await writeSummary(catalog, analysisDirectory, output, options);
  console.log(`Reviewed ${summary.reviewed} of ${catalog.length}; found ${summary.candidates.length} painting candidates (${summary.portfolioCandidates.length} full-artwork photos).`);
  console.log(`Saved ${output}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
