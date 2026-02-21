const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = 3001;

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MTG API server running on http://0.0.0.0:${PORT}`);
  console.log(`Access from your network: http://192.168.0.16:${PORT}`);
});