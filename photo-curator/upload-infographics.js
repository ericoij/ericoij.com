import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { put } from '@vercel/blob';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(__dirname, 'data', 'infographics-uploaded.json');
const downloads = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads');
const infographics = [
  {
    source: path.join(downloads, 'ChatGPT Image Aug 10, 2025, 01_46_44 AM.png'),
    slug: 'earth-electric-field',
    title: "Earth's Electric Field",
    topic: 'science'
  },
  {
    source: path.join(downloads, 'ChatGPT Image Jun 26, 2026, 01_50_27 AM.png'),
    slug: 'agile-development-ceremonies-v1',
    title: 'Agile Development: The Ceremonies — Version 1',
    topic: 'software-development'
  },
  {
    source: path.join(downloads, 'ChatGPT Image Jun 26, 2026, 01_56_35 AM.png'),
    slug: 'agile-development-ceremonies-v2',
    title: 'Agile Development: The Ceremonies — Version 2',
    topic: 'software-development'
  },
  {
    source: path.join(downloads, 'ChatGPT Image Jun 27, 2026, 01_04_41 AM.png'),
    slug: 'effective-dating-guide',
    title: 'Effective Dating Guide',
    topic: 'relationships'
  }
];

async function readManifest() {
  try { return JSON.parse(await fs.readFile(manifestPath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { updatedAt: null, uploads: {} }; throw error; }
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN is required');
  const manifest = await readManifest();
  for (const item of infographics) {
    const data = await fs.readFile(item.source);
    const checksum = crypto.createHash('sha256').update(data).digest('hex');
    if (manifest.uploads[checksum]) {
      console.log(`Already uploaded: ${item.title}`);
      continue;
    }
    const blob = await put(`infographics/${item.slug}-${checksum.slice(0, 12)}.png`, data, {
      access: 'private',
      contentType: 'image/png',
      addRandomSuffix: false
    });
    manifest.uploads[checksum] = {
      title: item.title,
      topic: item.topic,
      source: item.source,
      pathname: blob.pathname,
      url: blob.url,
      uploadedAt: new Date().toISOString()
    };
    manifest.updatedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`Uploaded: ${item.title}`);
  }
  console.log(`Private infographic records: ${Object.keys(manifest.uploads).length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
