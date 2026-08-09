const path = require('path');
const express = require('express');
const cors = require('cors');
const Datastore = require('nedb-promises');
const fs = require('fs');

class ValidationError extends Error {}

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

const sliderDefinitions = [
  { id: 'mood', label: 'Overall Mood', min: 0, max: 10 },
  { id: 'energy', label: 'Energy Level', min: 0, max: 10 },
  { id: 'calm', label: 'Calm', min: 0, max: 10 },
  { id: 'focus', label: 'Focus', min: 0, max: 10 },
  { id: 'sleep', label: 'Sleep Quality', min: 0, max: 10 }
];

const db = Datastore.create({
  filename: path.join(DATA_DIR, 'entries.db'),
  autoload: true
});

db.ensureIndex({ fieldName: 'recordedAt' }).catch((error) => {
  console.error('Failed to ensure index on recordedAt', error);
});

const sanitizeEntry = (entry) => ({
  id: entry._id,
  recordedAt: entry.recordedAt,
  sliders: entry.sliders
});

const parseSliders = (sliders = {}) => {
  const result = {};

  for (const definition of sliderDefinitions) {
    const rawValue = sliders[definition.id];
    const value = Number(rawValue);

    if (!Number.isFinite(value)) {
      throw new ValidationError('Missing value for ' + definition.label);
    }

    if (value < definition.min || value > definition.max) {
      throw new ValidationError(
        definition.label + ' must be between ' + definition.min + ' and ' + definition.max
      );
    }

    result[definition.id] = value;
  }

  return result;
};

const createApp = (entryDb = db) => {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/sliders', (req, res) => {
    res.json({ sliders: sliderDefinitions });
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/entries', async (req, res, next) => {
    try {
      const entries = await entryDb.find({});
      entries.sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
      res.json(entries.map(sanitizeEntry));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/entries', async (req, res, next) => {
    try {
      const cleanedSliders = parseSliders(req.body.sliders);
      const timestamp = req.body.recordedAt ? new Date(req.body.recordedAt) : new Date();

      if (Number.isNaN(timestamp.getTime())) {
        throw new ValidationError('Invalid recordedAt timestamp');
      }

      const entry = await entryDb.insert({
        sliders: cleanedSliders,
        recordedAt: timestamp.toISOString()
      });

      res.status(201).json(sanitizeEntry(entry));
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }

      next(error);
    }
  });

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'An unexpected error occurred' });
  });

  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
      return;
    }
    next();
  });

  return app;
};

const app = createApp();

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('Server listening on http://localhost:' + PORT);
  });
}

module.exports = {
  ValidationError: ValidationError,
  app: app,
  createApp: createApp,
  parseSliders: parseSliders,
  sanitizeEntry: sanitizeEntry,
  sliderDefinitions: sliderDefinitions
};
