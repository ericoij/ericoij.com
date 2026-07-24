import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { buildPhotoDatabase } from "../photo-database.js";

test("buildPhotoDatabase creates a searchable SQLite catalog", async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), "photo-database-"));
  const analysisDirectory = path.join(dataDirectory, "analysis");
  const databasePath = path.join(dataDirectory, "library.sqlite");
  await mkdir(analysisDirectory);
  await writeFile(
    path.join(dataDirectory, "catalog.json"),
    JSON.stringify([
      {
        id: "photo-1",
        path: "C:\\photos\\mountain.jpg",
        relativePath: "mountain.jpg",
        type: "image",
        bytes: 123,
        capturedAt: "2026-01-01T00:00:00.000Z",
        modifiedAt: "2026-01-01T00:00:00.000Z",
        width: 2000,
        height: 1200,
        hash: "abc",
        technicalScore: 91,
        duplicateOf: null,
      },
    ]),
  );
  await writeFile(
    path.join(dataDirectory, "decisions.json"),
    JSON.stringify({ "photo-1": "love" }),
  );
  await writeFile(
    path.join(analysisDirectory, "photo-1.json"),
    JSON.stringify({
      category: "photography",
      share_score: 94,
      story_score: 88,
      privacy_risk: "low",
      contains_people: false,
      title: "Morning Mountain",
      reason: "Dramatic alpine light.",
      tags: ["mountain", "sunrise"],
      recommended: true,
    }),
  );

  const summary = await buildPhotoDatabase({ dataDirectory, databasePath });
  assert.equal(summary.photos, 1);
  assert.equal(summary.analyzed, 1);

  const database = new DatabaseSync(databasePath, { readOnly: true });
  const photo = database.prepare("SELECT title, decision, share_score FROM photos").get();
  const match = database
    .prepare("SELECT photo_id FROM photo_search WHERE photo_search MATCH 'mountain'")
    .get();
  database.close();
  assert.deepEqual({ ...photo }, { title: "Morning Mountain", decision: "love", share_score: 94 });
  assert.deepEqual({ ...match }, { photo_id: "photo-1" });
});
