import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const sourceDirectory = path.resolve('data', 'infographics-inbox');
const outputDirectory = path.resolve('..', 'public', 'media', 'infographics');
const selection = [
  ['The engineering marvel of Sacsayhuamán.png', 'sacsayhuaman.webp'],
  ['Enchant your gear guide(1).png', 'enchant-your-gear.webp'],
  ["Threads of thought in Valheim's firelight.png", 'threads-valheim.webp'],
  ['The journey of Odysseus explained(2).png', 'the-odyssey.webp'],
  ['The many threads of thought.png', 'threads-computer-scientist.webp']
];

await fs.mkdir(outputDirectory, { recursive: true });
for (const [sourceName, outputName] of selection) {
  await sharp(path.join(sourceDirectory, sourceName))
    .rotate()
    .resize({ width: 2000, withoutEnlargement: true })
    .webp({ quality: 88, effort: 6 })
    .toFile(path.join(outputDirectory, outputName));
  console.log(`Prepared ${outputName}`);
}
