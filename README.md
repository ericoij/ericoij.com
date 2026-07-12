# ericoij.com

The source repository for Eric OIJ's public creative studio, private Daily Reflections app, and local AI-assisted media curation tools.

- Website: [ericoij.com](https://ericoij.com)
- Photography: [ericoij.com/photography](https://ericoij.com/photography)
- Daily Reflections / Vibe Check: [vibe.ericoij.com](https://vibe.ericoij.com)

## Projects

| Path | Purpose | Runtime |
| --- | --- | --- |
| `public/` | Static portfolio for ericoij.com, including The Best of Five Years | Vercel |
| `DailyReflections/` | Authenticated check-ins, history, charts, and private image uploads | React, Express, Postgres, Vercel |
| `photo-curator/` | Local photo selection agent with technical scoring and Ollama vision | Node.js, Sharp, Ollama |
| `minecraft-server/` | Paper Minecraft server configuration and maintenance scripts | Java, Docker |
| `trading/` | Deterministic trading simulation experiments | Node.js |

The root Express service and tests are retained for the original slider-tracker API. New Daily Reflections work lives in `DailyReflections/`.

## Public portfolio

The public site is plain HTML, CSS, and JavaScript with no build step.

```powershell
npx serve public
```

The production project is deployed from `public/`. Large local videos and unrelated media are excluded from the deployment package through `public/.vercelignore`.

Deploy:

```powershell
vercel deploy --cwd public --prod --yes
```

## Daily Reflections

Daily Reflections is a separate authenticated application. It requires Node.js 22 and Postgres.

```powershell
cd DailyReflections
npm install
npm run dev
```

Required production configuration:

```text
DATABASE_URL
ACCESS_PIN
JWT_SECRET
```

Never commit real values. See `DailyReflections/VERCEL_DEPLOYMENT.md`, `DailyReflections/SECURITY.md`, and `DailyReflections/TESTING.md` for deployment and assurance details.

Verify the application:

```powershell
npm run ci
```

## Local photo curator

The curator runs only on the local computer. It creates private thumbnails, detects duplicates, evaluates images with a local Ollama vision model, and learns from **Awesome / Just OK / Pass** feedback.

Requirements:

- Node.js 22+
- Ollama at `http://127.0.0.1:11434`
- A vision model such as `gemma3:4b`

```powershell
cd photo-curator
npm install
npm start -- --source "C:\path\to\photos"
```

Open `http://127.0.0.1:4317`.

Create a ranked, resumable shortlist:

```powershell
npm run select-best
```

The curator does not move, delete, publish, or upload originals during scanning. Private Vercel Blob uploads are handled by a separate, explicit command after local classification and review. See `photo-curator/README.md` for the complete workflow.

## Testing

Root services:

```powershell
npm install
npm test
```

Photo curator:

```powershell
cd photo-curator
npm test
```

Daily Reflections:

```powershell
cd DailyReflections
npm run ci
```

## Storage and privacy

- Public portfolio assets live under `public/media/`.
- Private photo originals are stored separately from the public site.
- Approved private uploads use authenticated Vercel Blob storage.
- Curator caches, thumbnails, manifests, environment files, and Vercel credentials are git-ignored.
- Daily Reflections data requires application authentication and a configured database.
- Do not commit exports, phone-import staging folders, database files, access tokens, or personal photo libraries.

## Repository conventions

- Preserve originals during media processing.
- Publish only explicitly approved images.
- Keep secrets in local or Vercel environment variables.
- Run the relevant project tests before deployment.
- Treat `public/` and `DailyReflections/` as separate deployments.

## License

Licensed under the terms in [LICENSE](LICENSE).
