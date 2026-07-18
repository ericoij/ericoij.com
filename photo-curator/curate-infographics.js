import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tif', '.tiff', '.avif']);

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    topic: { type: 'string' },
    visual_score: { type: 'integer', minimum: 0, maximum: 100 },
    readability_score: { type: 'integer', minimum: 0, maximum: 100 },
    usefulness_score: { type: 'integer', minimum: 0, maximum: 100 },
    publish_score: { type: 'integer', minimum: 0, maximum: 100 },
    factual_risk: { type: 'string', enum: ['low', 'medium', 'high'] },
    recommended: { type: 'boolean' },
    summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    issues: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    verification_notes: { type: 'array', items: { type: 'string' }, maxItems: 6 }
  },
  required: [
    'title', 'topic', 'visual_score', 'readability_score', 'usefulness_score',
    'publish_score', 'factual_risk', 'recommended', 'summary', 'strengths',
    'issues', 'verification_notes'
  ]
};

function parseArguments(argv) {
  const result = {
    source: path.join(process.env.USERPROFILE || '', 'Downloads'),
    output: path.join('data', 'infographic-curation.json'),
    model: 'gemma3:4b',
    ollama: 'http://127.0.0.1:11434'
  };
  for (let index = 0; index < argv.length; index++) {
    if (!argv[index].startsWith('--')) continue;
    const [key, inline] = argv[index].slice(2).split('=', 2);
    const value = inline ?? argv[++index];
    if (!(key in result)) throw new Error(`Unknown option: --${key}`);
    result[key] = value;
  }
  return result;
}

async function listImages(directory) {
  return (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(directory, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function reviewImage(filePath, options) {
  const original = await fs.readFile(filePath);
  const image = await sharp(original)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  const prompt = `You are the senior editor for a public creative-studio portfolio. Review this infographic as a finished editorial design.
Assess visual hierarchy, typography, text legibility, spelling, coherence, usefulness, obvious AI artifacts, and whether it feels polished enough to publish.
Treat factual accuracy cautiously: identify claims that require human or source verification. Medical, health, historical, and prescriptive claims have elevated risk. Do not claim that a fact is verified from the image alone.
Use 50 for ordinary, 70 for good, 85 for excellent, and 95 only for exceptional work. Set recommended true only when publish_score is at least 75 and no visible issue seriously undermines the piece.
The filename is ${path.basename(filePath)}. Return only the requested structured result.`;
  const response = await fetch(`${options.ollama.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: options.model,
      messages: [{ role: 'user', content: prompt, images: [image.toString('base64')] }],
      format: REVIEW_SCHEMA,
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

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const files = await listImages(path.resolve(options.source));
  const seen = new Map();
  const results = [];

  for (const [index, filePath] of files.entries()) {
    const data = await fs.readFile(filePath);
    const checksum = crypto.createHash('sha256').update(data).digest('hex');
    if (seen.has(checksum)) {
      results.push({ file: filePath, checksum, duplicateOf: seen.get(checksum) });
      console.log(`[${index + 1}/${files.length}] Duplicate: ${path.basename(filePath)}`);
      continue;
    }
    seen.set(checksum, filePath);
    console.log(`[${index + 1}/${files.length}] Reviewing: ${path.basename(filePath)}`);
    const review = await reviewImage(filePath, options);
    results.push({ file: filePath, checksum, review });
    console.log(`  ${review.publish_score}/100 — ${review.recommended ? 'recommended' : 'hold'}`);
  }

  const ranked = results
    .filter((item) => item.review)
    .sort((a, b) => b.review.publish_score - a.review.publish_score);
  const output = path.resolve(options.output);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify({
    createdAt: new Date().toISOString(),
    model: options.model,
    totalFiles: files.length,
    uniqueFiles: ranked.length,
    ranked
  }, null, 2));
  console.log(`Saved ${ranked.length} unique reviews to ${output}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
