import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import heicConvert from 'heic-convert';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tif', '.tiff', '.avif']);
const VIDEO_EXTENSIONS = new Set(['.mov', '.mp4', '.m4v', '.avi']);
const DECISIONS = new Set(['love', 'maybe', 'no', 'unreviewed']);

export function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function technicalScore(metrics, width, height) {
  const megapixels = Math.max(0.01, (Number(width) * Number(height)) / 1_000_000);
  const sharpness = clamp((metrics.edge / 24) * 100);
  const contrast = clamp((metrics.contrast / 62) * 100);
  const exposure = clamp(100 - Math.abs(metrics.brightness - 128) * 0.78);
  const resolution = clamp(Math.log2(megapixels + 1) * 28);
  return Math.round(sharpness * 0.34 + contrast * 0.24 + exposure * 0.22 + resolution * 0.20);
}

export function visualMetrics(data, info) {
  const channels = info.channels;
  const pixels = info.width * info.height;
  let light = 0;
  let lightSquared = 0;
  let saturation = 0;
  let edge = 0;
  const grayscale = new Uint8Array(pixels);

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const pixel = y * info.width + x;
      const index = pixel * channels;
      const r = data[index];
      const g = data[index + 1] ?? r;
      const b = data[index + 2] ?? r;
      const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      grayscale[pixel] = value;
      light += value;
      lightSquared += value * value;
      saturation += Math.max(r, g, b) - Math.min(r, g, b);
      if (x > 0) edge += Math.abs(value - grayscale[pixel - 1]);
      if (y > 0) edge += Math.abs(value - grayscale[pixel - info.width]);
    }
  }

  const brightness = light / pixels;
  return {
    brightness: Number(brightness.toFixed(2)),
    contrast: Number(Math.sqrt(Math.max(0, lightSquared / pixels - brightness ** 2)).toFixed(2)),
    saturation: Number((saturation / pixels).toFixed(2)),
    edge: Number((edge / (pixels * 2)).toFixed(2))
  };
}

export function differenceHash(data, width, height) {
  let bits = '';
  for (let y = 0; y < Math.min(8, height); y++) {
    for (let x = 0; x < Math.min(8, width - 1); x++) {
      bits += data[y * width + x] > data[y * width + x + 1] ? '1' : '0';
    }
  }
  return BigInt(`0b${bits.padEnd(64, '0')}`).toString(16).padStart(16, '0');
}

export function mediaDate(filePath, fallback = new Date(0)) {
  const compact = filePath.match(/(?:^|\D)(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])(?:\D|$)/);
  const separated = filePath.match(/(?:^|[\\/])(20\d{2})(?:[\\/-](0?[1-9]|1[0-2]))?(?:[\\/-](0?[1-9]|[12]\d|3[01]))?(?:[\\/_.-]|$)/);
  const match = compact || separated;
  if (!match) return new Date(fallback);
  const year = Number(match[1]);
  const month = Number(match[2] || 12);
  const day = Number(match[3] || new Date(Date.UTC(year, month, 0)).getUTCDate());
  return new Date(Date.UTC(year, month - 1, day));
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    if (!argv[index].startsWith('--')) continue;
    const [rawKey, inlineValue] = argv[index].slice(2).split('=', 2);
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index++;
    result[rawKey] = value;
  }
  return result;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(value, null, 2));
  await fsp.rename(temporary, filePath);
}

function run(command, argumentsList, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, { windowsHide: true });
    const stdout = [];
    let stderr = '';
    if (capture) child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve(capture ? Buffer.concat(stdout) : undefined)
      : reject(new Error(stderr.trim() || `${path.basename(command)} exited ${code}`)));
  });
}

async function walk(directory) {
  const files = [];
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

async function imageInput(filePath) {
  if (!/\.hei[cf]$/i.test(filePath)) return filePath;
  const buffer = await fsp.readFile(filePath);
  return Buffer.from(await heicConvert({ buffer, format: 'JPEG', quality: 0.78 }));
}

async function createImageThumbnail(filePath, thumbnailPath) {
  const input = await imageInput(filePath);
  const source = sharp(input, { failOn: 'none', limitInputPixels: false }).rotate();
  const metadata = await source.metadata();
  await source.clone()
    .resize({ width: 768, height: 576, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, chromaSubsampling: '4:2:0' })
    .toFile(thumbnailPath);
  return { width: metadata.width, height: metadata.height, duration: null };
}

async function createVideoThumbnail(filePath, thumbnailPath) {
  const output = await run(ffprobeStatic.path, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath], true);
  const details = JSON.parse(output.toString('utf8'));
  const video = details.streams.find((stream) => stream.codec_type === 'video') || {};
  const duration = Number(details.format?.duration || video.duration || 0);
  const seek = duration > 4 ? Math.min(duration * 0.3, duration - 1) : 0;
  await run(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-ss', String(seek), '-i', filePath,
    '-frames:v', '1', '-vf', 'scale=768:576:force_original_aspect_ratio=decrease',
    '-q:v', '3', thumbnailPath, '-y'
  ]);
  return { width: video.width, height: video.height, duration: Number(duration.toFixed(2)) };
}

async function analyzeThumbnail(thumbnailPath) {
  const { data, info } = await sharp(thumbnailPath)
    .resize(128, 96, { fit: 'inside' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const metrics = visualMetrics(data, info);
  const hashImage = await sharp(thumbnailPath).resize(9, 8, { fit: 'fill' }).grayscale().raw().toBuffer();
  return { metrics, hash: differenceHash(hashImage, 9, 8) };
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: ['photography', 'painting', 'hockey', 'people', 'screenshot', 'document', 'private', 'other'] },
    share_score: { type: 'integer', minimum: 0, maximum: 100 },
    story_score: { type: 'integer', minimum: 0, maximum: 100 },
    privacy_risk: { type: 'string', enum: ['low', 'medium', 'high'] },
    contains_people: { type: 'boolean' },
    title: { type: 'string' },
    reason: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } }
  },
  required: ['category', 'share_score', 'story_score', 'privacy_risk', 'contains_people', 'title', 'reason', 'tags']
};

class Curator {
  constructor(config) {
    this.config = config;
    this.catalogPath = path.join(config.dataDirectory, 'catalog.json');
    this.decisionsPath = path.join(config.dataDirectory, 'decisions.json');
    this.thumbnailDirectory = path.join(config.dataDirectory, 'thumbs');
    this.analysisDirectory = path.join(config.dataDirectory, 'analysis');
    this.catalog = [];
    this.decisions = {};
    this.state = { task: null, completed: 0, total: 0, message: 'Ready', error: null };
  }

  async initialize() {
    await fsp.mkdir(this.thumbnailDirectory, { recursive: true });
    await fsp.mkdir(this.analysisDirectory, { recursive: true });
    this.catalog = await readJson(this.catalogPath, []);
    this.decisions = await readJson(this.decisionsPath, {});
    for (const item of this.catalog) item.analysis = await readJson(path.join(this.analysisDirectory, `${item.id}.json`), null);
  }

  async scan(limit = Infinity) {
    if (this.state.task) throw new Error('Another task is already running');
    this.state = { task: 'scan', completed: 0, total: 0, message: 'Discovering media', error: null };
    try {
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - this.config.years);
      const candidates = (await walk(this.config.source))
        .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()) || VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase()));
      const discovered = [];
      for (const filePath of candidates) {
        const stat = await fsp.stat(filePath);
        const capturedAt = mediaDate(filePath, stat.mtime);
        if (capturedAt >= cutoff) discovered.push({ filePath, stat, capturedAt });
        if (discovered.length >= limit) break;
      }
      this.state.total = discovered.length;
      const previous = new Map(this.catalog.map((item) => [item.path, item]));
      const catalog = [];
      const firstByHash = new Map();

      for (const discoveredItem of discovered) {
        const { filePath, stat, capturedAt } = discoveredItem;
        const id = crypto.createHash('sha256').update(`${filePath}|${stat.size}|${stat.mtimeMs}`).digest('hex').slice(0, 20);
        const thumbnailPath = path.join(this.thumbnailDirectory, `${id}.jpg`);
        let item = previous.get(filePath);
        if (!item || item.id !== id || !fs.existsSync(thumbnailPath)) {
          const extension = path.extname(filePath).toLowerCase();
          const media = VIDEO_EXTENSIONS.has(extension)
            ? await createVideoThumbnail(filePath, thumbnailPath)
            : await createImageThumbnail(filePath, thumbnailPath);
          const { metrics, hash } = await analyzeThumbnail(thumbnailPath);
          item = {
            id,
            path: filePath,
            relativePath: path.relative(this.config.source, filePath),
            type: VIDEO_EXTENSIONS.has(extension) ? 'video' : 'image',
            bytes: stat.size,
            capturedAt: capturedAt.toISOString(),
            modifiedAt: stat.mtime.toISOString(),
            ...media,
            metrics,
            hash,
            technicalScore: technicalScore(metrics, media.width, media.height),
            duplicateOf: null
          };
        }
        if (firstByHash.has(item.hash)) item.duplicateOf = firstByHash.get(item.hash);
        else { firstByHash.set(item.hash, item.id); item.duplicateOf = null; }
        item.analysis = await readJson(path.join(this.analysisDirectory, `${item.id}.json`), null);
        catalog.push(item);
        this.state.completed++;
        this.state.message = `Scanned ${this.state.completed} of ${this.state.total}`;
      }

      this.catalog = catalog;
      await writeJsonAtomic(this.catalogPath, catalog.map(({ analysis, ...item }) => item));
      this.state.message = `Scan complete: ${catalog.length} items`;
    } catch (error) {
      this.state.error = error.message;
      throw error;
    } finally {
      this.state.task = null;
    }
  }

  preferenceProfile() {
    const tagWeights = new Map();
    const categoryWeights = new Map();
    for (const item of this.catalog) {
      const decision = this.decisions[item.id];
      if (!decision || !item.analysis) continue;
      const weight = decision === 'love' ? 2 : decision === 'maybe' ? 0.5 : -1.5;
      categoryWeights.set(item.analysis.category, (categoryWeights.get(item.analysis.category) || 0) + weight);
      for (const tag of item.analysis.tags || []) tagWeights.set(tag, (tagWeights.get(tag) || 0) + weight);
    }
    const favorites = [...tagWeights].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag]) => tag);
    const avoid = [...tagWeights].filter(([, value]) => value < 0).sort((a, b) => a[1] - b[1]).slice(0, 8).map(([tag]) => tag);
    const categories = [...categoryWeights].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([category]) => category);
    return { favorites, avoid, categories };
  }

  async evaluate(item) {
    const thumbnail = await fsp.readFile(path.join(this.thumbnailDirectory, `${item.id}.jpg`));
    const preferences = this.preferenceProfile();
    const prompt = `You are a candid but balanced visual editor helping one person choose what to share publicly.
This is a candidate image or representative video frame. Score 50 as ordinary, 70 as good, 85 as excellent, and reserve scores below 20 for accidental, unusable, private, or seriously flawed media.
Judge composition, light, focus, distinctiveness, emotion, story, and privacy. Do not reject an image merely because it is informal or technically imperfect.
Category definitions are strict: photography means a camera-made scene, landscape, portrait, wildlife, or ordinary photograph; painting means a visible physical or digital artwork; hockey means hockey play, gear, teams, or arenas; screenshot means visible phone/computer software UI or captured on-screen text, never an ordinary photograph; document means a page, receipt, form, or record; private means sensitive content that should not be surfaced.
The owner's emerging preferences are: favored categories ${preferences.categories.join(', ') || 'not learned yet'}; favored visual tags ${preferences.favorites.join(', ') || 'not learned yet'}; tags to avoid ${preferences.avoid.join(', ') || 'not learned yet'}.
Objective technical pre-score: ${item.technicalScore}/100. Use it as evidence, not as the final verdict.
Return only the requested structured result.`;
    const response = await fetch(`${this.config.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: 'user', content: prompt, images: [thumbnail.toString('base64')] }],
        format: REVIEW_SCHEMA,
        stream: false,
        think: false,
        keep_alive: '30m',
        options: { temperature: 0 }
      }),
      signal: AbortSignal.timeout(240_000)
    });
    if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
    const body = await response.json();
    const analysis = JSON.parse(body.message.content);
    analysis.evaluatedAt = new Date().toISOString();
    analysis.model = this.config.model;
    analysis.recommended = analysis.share_score >= 72 && analysis.privacy_risk !== 'high';
    await writeJsonAtomic(path.join(this.analysisDirectory, `${item.id}.json`), analysis);
    item.analysis = analysis;
  }

  async curate(limit = 50) {
    if (this.state.task) throw new Error('Another task is already running');
    const queue = this.catalog
      .filter((item) => !item.analysis && !item.duplicateOf)
      .sort((a, b) => b.technicalScore - a.technicalScore)
      .slice(0, limit);
    this.state = { task: 'curate', completed: 0, total: queue.length, message: 'Starting local model', error: null };
    try {
      for (const item of queue) {
        this.state.message = `Evaluating ${item.relativePath}`;
        await this.evaluate(item);
        this.state.completed++;
      }
      this.state.message = `Curation complete: ${queue.length} evaluated`;
    } catch (error) {
      this.state.error = error.message;
      throw error;
    } finally {
      this.state.task = null;
    }
  }

  async decide(id, decision) {
    if (!DECISIONS.has(decision)) throw new Error('Invalid decision');
    if (!this.catalog.some((item) => item.id === id)) throw new Error('Unknown item');
    if (decision === 'unreviewed') delete this.decisions[id];
    else this.decisions[id] = decision;
    await writeJsonAtomic(this.decisionsPath, this.decisions);
  }

  items(filters = {}) {
    let result = this.catalog.map((item) => ({ ...item, decision: this.decisions[item.id] || 'unreviewed' }));
    if (filters.category) result = result.filter((item) => item.analysis?.category === filters.category);
    if (filters.decision) result = result.filter((item) => item.decision === filters.decision);
    if (filters.recommended === 'true') result = result.filter((item) => item.analysis?.recommended);
    if (filters.hideDuplicates !== 'false') result = result.filter((item) => !item.duplicateOf);
    return result.sort((a, b) => {
      const aScore = a.analysis?.share_score ?? a.technicalScore;
      const bScore = b.analysis?.share_score ?? b.technicalScore;
      return bScore - aScore;
    });
  }
}

async function loadConfig() {
  const args = parseArguments(process.argv.slice(2));
  const configPath = path.resolve(args.config || path.join(__dirname, 'curator.config.json'));
  const fileConfig = await readJson(configPath, {});
  const source = path.resolve(args.source || fileConfig.source || '');
  if (!source || !fs.existsSync(source)) {
    throw new Error('A valid media source is required. Pass --source "C:\\path\\to\\photos" or create curator.config.json.');
  }
  return {
    source,
    dataDirectory: path.resolve(args.data || fileConfig.dataDirectory || path.join(__dirname, 'data')),
    model: args.model || fileConfig.model || 'gemma3:4b',
    ollamaUrl: (args.ollama || fileConfig.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    port: Number(args.port || fileConfig.port || 4317),
    years: clamp(Number(args.years || fileConfig.years || 5), 1, 100)
  };
}

async function main() {
  const config = await loadConfig();
  const curator = new Curator(config);
  await curator.initialize();
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/thumbs', express.static(curator.thumbnailDirectory));
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/status', (request, response) => response.json({ ...curator.state, count: curator.catalog.length, source: config.source, model: config.model, preferences: curator.preferenceProfile() }));
  app.get('/api/items', (request, response) => response.json(curator.items(request.query)));
  app.post('/api/scan', (request, response) => {
    if (curator.state.task) return response.status(409).json({ error: 'A task is already running' });
    const limit = Number(request.body?.limit) || Infinity;
    curator.scan(limit).catch((error) => console.error(error));
    response.status(202).json({ started: true });
  });
  app.post('/api/curate', (request, response) => {
    if (curator.state.task) return response.status(409).json({ error: 'A task is already running' });
    const limit = clamp(Number(request.body?.limit) || 50, 1, 500);
    curator.curate(limit).catch((error) => console.error(error));
    response.status(202).json({ started: true, limit });
  });
  app.post('/api/items/:id/decision', async (request, response, next) => {
    try {
      await curator.decide(request.params.id, request.body?.decision);
      response.json({ saved: true });
    } catch (error) { next(error); }
  });
  app.use((error, request, response, next) => {
    console.error(error);
    response.status(400).json({ error: error.message });
  });

  app.listen(config.port, '127.0.0.1', () => {
    console.log(`Photo Curator running at http://127.0.0.1:${config.port}`);
    console.log(`Source: ${config.source}`);
    console.log(`Model: ${config.model}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
