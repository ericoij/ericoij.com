import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function buildPhotoDatabase(options = {}) {
  const dataDirectory = path.resolve(options.dataDirectory || path.join(__dirname, "data"));
  const databasePath = path.resolve(
    options.databasePath || path.join(dataDirectory, "photo-library.sqlite"),
  );
  const catalog = await readJson(path.join(dataDirectory, "catalog.json"), []);
  const decisions = await readJson(path.join(dataDirectory, "decisions.json"), {});
  const analysisDirectory = path.join(dataDirectory, "analysis");

  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      relative_path TEXT NOT NULL,
      type TEXT NOT NULL,
      bytes INTEGER,
      captured_at TEXT,
      modified_at TEXT,
      width INTEGER,
      height INTEGER,
      duration REAL,
      hash TEXT,
      technical_score REAL,
      duplicate_of TEXT,
      decision TEXT NOT NULL DEFAULT 'unreviewed',
      category TEXT,
      share_score REAL,
      story_score REAL,
      privacy_risk TEXT,
      contains_people INTEGER,
      title TEXT,
      reason TEXT,
      evaluated_at TEXT,
      model TEXT,
      recommended INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tags (
      photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (photo_id, tag)
    );
    CREATE INDEX IF NOT EXISTS photos_captured_at_idx ON photos(captured_at);
    CREATE INDEX IF NOT EXISTS photos_category_score_idx ON photos(category, share_score DESC);
    CREATE INDEX IF NOT EXISTS photos_decision_idx ON photos(decision);
    CREATE INDEX IF NOT EXISTS photos_duplicate_idx ON photos(duplicate_of);
    CREATE INDEX IF NOT EXISTS tags_tag_idx ON tags(tag);
    CREATE VIRTUAL TABLE IF NOT EXISTS photo_search USING fts5(
      photo_id UNINDEXED,
      relative_path,
      title,
      reason,
      tags
    );
  `);

  const upsert = database.prepare(`
    INSERT INTO photos (
      id, path, relative_path, type, bytes, captured_at, modified_at, width, height,
      duration, hash, technical_score, duplicate_of, decision, category, share_score,
      story_score, privacy_risk, contains_people, title, reason, evaluated_at, model,
      recommended
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      path=excluded.path, relative_path=excluded.relative_path, type=excluded.type,
      bytes=excluded.bytes, captured_at=excluded.captured_at, modified_at=excluded.modified_at,
      width=excluded.width, height=excluded.height, duration=excluded.duration,
      hash=excluded.hash, technical_score=excluded.technical_score,
      duplicate_of=excluded.duplicate_of, decision=excluded.decision,
      category=excluded.category, share_score=excluded.share_score,
      story_score=excluded.story_score, privacy_risk=excluded.privacy_risk,
      contains_people=excluded.contains_people, title=excluded.title,
      reason=excluded.reason, evaluated_at=excluded.evaluated_at, model=excluded.model,
      recommended=excluded.recommended
  `);
  const insertTag = database.prepare("INSERT OR IGNORE INTO tags (photo_id, tag) VALUES (?, ?)");
  const insertSearch = database.prepare(
    "INSERT INTO photo_search (photo_id, relative_path, title, reason, tags) VALUES (?, ?, ?, ?, ?)",
  );

  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec("DELETE FROM tags; DELETE FROM photo_search;");
    const currentIds = [];
    for (const item of catalog) {
      const analysis = await readJson(
        path.join(analysisDirectory, `${item.id}.json`),
        null,
      );
      const tags = Array.isArray(analysis?.tags) ? analysis.tags : [];
      upsert.run(
        item.id,
        item.path,
        item.relativePath,
        item.type,
        item.bytes ?? null,
        item.capturedAt ?? null,
        item.modifiedAt ?? null,
        item.width ?? null,
        item.height ?? null,
        item.duration ?? null,
        item.hash ?? null,
        item.technicalScore ?? null,
        item.duplicateOf ?? null,
        decisions[item.id] || "unreviewed",
        analysis?.category ?? null,
        analysis?.share_score ?? null,
        analysis?.story_score ?? null,
        analysis?.privacy_risk ?? null,
        analysis ? Number(Boolean(analysis.contains_people)) : null,
        analysis?.title ?? null,
        analysis?.reason ?? null,
        analysis?.evaluatedAt ?? null,
        analysis?.model ?? null,
        Number(Boolean(analysis?.recommended)),
      );
      currentIds.push(item.id);
      for (const tag of tags) insertTag.run(item.id, String(tag));
      insertSearch.run(
        item.id,
        item.relativePath,
        analysis?.title || "",
        analysis?.reason || "",
        tags.join(" "),
      );
    }

    if (currentIds.length === 0) {
      database.exec("DELETE FROM photos");
    } else {
      const placeholders = currentIds.map(() => "?").join(",");
      database.prepare(`DELETE FROM photos WHERE id NOT IN (${placeholders})`).run(...currentIds);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    database.close();
    throw error;
  }

  const summary = database
    .prepare(`
      SELECT
        COUNT(*) AS photos,
        SUM(CASE WHEN share_score IS NOT NULL THEN 1 ELSE 0 END) AS analyzed,
        SUM(CASE WHEN duplicate_of IS NOT NULL THEN 1 ELSE 0 END) AS duplicates
      FROM photos
    `)
    .get();
  database.close();
  return { databasePath, ...summary };
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const [key, inline] = argv[index].replace(/^--/, "").split("=", 2);
    const value = inline ?? argv[++index];
    if (key === "data") options.dataDirectory = value;
    else if (key === "database") options.databasePath = value;
    else throw new Error(`Unknown option: --${key}`);
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildPhotoDatabase(parseOptions(process.argv.slice(2)))
    .then((summary) => {
      console.log(
        `Indexed ${summary.photos} photos (${summary.analyzed} analyzed, ${summary.duplicates} duplicates) in ${summary.databasePath}`,
      );
    })
    .catch((error) => {
      console.error(`Database build stopped: ${error.message}`);
      process.exitCode = 1;
    });
}
