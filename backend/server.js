const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/cards', require('./routes/cards'));
app.use('/api/collection', require('./routes/collection'));
app.use('/api/types', require('./routes/types'));
app.use('/api/stats', require('./routes/stats'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// In the Docker image the built frontend sits in ./public and is served from
// here. In dev there's no ./public -- Vite serves the frontend and proxies /api.
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// Only listen when run directly, so tests can require() the app
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MTG API server running on http://0.0.0.0:${PORT}`);
  });
}

module.exports = app;
