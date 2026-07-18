# Local Photo Curator

A private, resumable photo and video curator that runs on this computer. It combines objective media checks with a local Ollama vision model, then learns from **Awesome / Just OK / Pass** feedback.

The tool never uploads media, moves originals, or publishes anything. Its cache and thumbnails stay in the local `data/` directory.

## What it does

- Reads JPG, PNG, WebP, HEIC/HEIF, TIFF, AVIF, MOV, MP4, M4V, and AVI.
- Creates private 768px thumbnails and representative video frames.
- Scores sharpness, exposure, contrast, resolution, and exact visual duplicates.
- Uses Ollama structured vision output for category, story, share score, title, tags, people detection, and privacy risk.
- Learns a lightweight preference profile from your review decisions.
- Caches scan and model results, so large libraries resume rather than restart.

## Run it

Requirements already present on this machine:

- Node.js 22+
- Ollama at `http://127.0.0.1:11434`
- A dedicated vision model such as `gemma3:4b`

Install once:

```powershell
cd photo-curator
npm install
```

Start against a small test folder:

```powershell
npm start -- --source "C:\path\to\photos"
```

Or copy `curator.config.example.json` to `curator.config.json`, edit the source, and run:

```powershell
npm start
```

Open:

```text
http://127.0.0.1:4317
```

Recommended first run:

1. Enter a scan limit of `25` and choose **Scan library**.
2. Run an AI batch of `5`.
3. Mark every result **Awesome**, **Just OK**, or **Pass**.
4. Run another batch. The prompt will include the tags and categories emerging from your decisions.
5. Increase scan and AI batch sizes once the taste profile feels right.

## Select the full five-year library

Once the local curator is running and your feedback has started teaching it your taste:

```powershell
npm run select-best
```

The script scans the full configured five-year library, resumes cached evaluations, and saves a ranked shortlist to `data/best-selection.json`. It does not copy, move, delete, upload, or publish media.

Useful options:

```powershell
npm run select-best -- --skip-scan true --minimum-score 80 --top 100 --batch 25
```

## Curate infographic studies

Place private source images in `data/infographics-inbox/`, then run the local
vision review:

```powershell
npm run curate-infographics
```

The ranked review is written to `data/infographic-curation.json`, which remains
local and git-ignored. After choosing the publishable studies, update the
selection in `prepare-infographics.js` and create optimized WebP assets with:

```powershell
npm run prepare-infographics
```

Only the optimized files in `../public/media/infographics/` are intended for
the public site. As with the photo curator, the review stays local and does not
upload, move, or delete source files.

## Performance

The local model remains loaded for 30 minutes between evaluations. HEIC decoding and the first model load are the slowest operations. A full 2,000-item library is intentionally resumable and should be run in batches rather than as one opaque job.

## Privacy model

- Express binds only to `127.0.0.1`.
- The REST call targets the local Ollama address.
- Thumbnails and analyses are git-ignored.
- Originals are read-only.
- No export, move, delete, or publish endpoint exists in this MVP.
