import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { put } from '@vercel/blob';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(__dirname, 'data', 'paintings-uploaded.json');

async function readJson(filePath, fallback) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function api(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

export function paintingMatches(items) {
  return items.filter((item) =>
    item.type === 'image' &&
    !item.duplicateOf &&
    item.analysis?.category === 'painting' &&
    item.analysis?.privacy_risk !== 'high'
  );
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN is required');
  const baseUrl = (process.argv.find((value) => value.startsWith('--url='))?.split('=', 2)[1] || 'http://127.0.0.1:4318').replace(/\/$/, '');
  const items = await api(`${baseUrl}/api/items`);
  const matches = paintingMatches(items);
  const manifest = await readJson(manifestPath, { updatedAt: null, uploads: {} });
  let uploaded = 0;

  for (const item of matches) {
    if (manifest.uploads[item.id]) continue;
    const extension = path.extname(item.path).toLowerCase() || '.jpg';
    const year = item.capturedAt ? new Date(item.capturedAt).getUTCFullYear() : 'undated';
    const pathname = `paintings/${year}/${item.id}${extension}`;
    const blob = await put(pathname, await fs.readFile(item.path), {
      access: 'private',
      contentType: extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : extension === '.heic' || extension === '.heif' ? 'image/heic' : 'image/jpeg',
      addRandomSuffix: false
    });
    manifest.uploads[item.id] = {
      pathname: blob.pathname,
      url: blob.url,
      source: item.path,
      title: item.analysis.title,
      reason: item.analysis.reason,
      uploadedAt: new Date().toISOString()
    };
    manifest.updatedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    uploaded++;
    console.log(`Uploaded ${uploaded}: ${item.analysis.title}`);
  }

  console.log(`Painting matches: ${matches.length}; newly uploaded: ${uploaded}; total in manifest: ${Object.keys(manifest.uploads).length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
