const express = require('express');
const router = express.Router();
const SoloResult = require('../models/SoloResult');

// GET /api/solo-results - get top solo results
router.get('/solo-results', async (req, res) => {
  try {
    // Top 20 by WPM, then accuracy, then most recent
    const results = await SoloResult.find()
      .sort({ wpm: -1, accuracy: -1, createdAt: -1 })
      .limit(20);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch solo results' });
  }
});

module.exports = router;
