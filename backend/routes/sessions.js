// routes/sessions.js - Session management API
const express = require('express');
const { User, Heartbeat } = require('../models');
const router = express.Router();

// Middleware to get or create user
const getOrCreateUser = async (req, res, next) => {
  try {
    const { uuid } = req.body;
    if (!uuid) {
      return res.status(400).json({ error: 'UUID required' });
    }

    let user = await User.findOne({ uuid });
    if (!user) {
      user = new User({ 
        uuid,
        settings: {
          productiveSites: [
            'github.com', 'stackoverflow.com', 'wikipedia.org', 
            'leetcode.com', 'coursera.org', 'udemy.com'
          ],
          distractingSites: [
            'youtube.com', 'instagram.com', 'twitter.com', 
            'facebook.com', 'reddit.com', 'tiktok.com'
          ]
        }
      });
      await user.save();
    }
    
    req.user = user;
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// POST /api/sessions/start
router.post('/start', getOrCreateUser, async (req, res) => {
  try {
    const { sessionId, timestamp } = req.body;
    
    // Update user's last active
    req.user.lastActive = new Date();
    await req.user.save();

    res.json({
      success: true,
      sessionId,
      userId: req.user._id,
      timestamp: timestamp || Date.now()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/stop
router.post('/stop', getOrCreateUser, async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    // Could add session cleanup logic here
    
    res.json({
      success: true,
      sessionId,
      stoppedAt: Date.now()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/heartbeats - Batch heartbeat processing
router.post('/heartbeats', getOrCreateUser, async (req, res) => {
  try {
    const { heartbeats } = req.body;
    
    if (!Array.isArray(heartbeats) || heartbeats.length === 0) {
      return res.status(400).json({ error: 'Heartbeats array required' });
    }

    // Process heartbeats
    const processedHeartbeats = heartbeats.map(hb => ({
      userId: req.user._id,
      sessionId: hb.sessionId,
      timestamp: new Date(hb.timestamp),
      site: hb.site,
      siteType: hb.siteType,
      action: hb.action,
      coinsChange: hb.coinsChange || 0,
      metadata: {
        tabId: hb.tabId,
        url: hb.url
      }
    }));

    // Bulk insert heartbeats
    await Heartbeat.insertMany(processedHeartbeats);

    // Update user stats
    const totalCoinsChange = heartbeats.reduce((sum, hb) => sum + (hb.coinsChange || 0), 0);
    req.user.stats.totalCoins += totalCoinsChange;
    await req.user.save();

    res.json({
      success: true,
      processed: heartbeats.length,
      coinsChange: totalCoinsChange,
      totalCoins: req.user.stats.totalCoins
    });

  } catch (error) {
    console.error('Heartbeat processing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sessions/stats - Get user stats
router.get('/stats/:uuid', async (req, res) => {
  try {
    const user = await User.findOne({ uuid: req.params.uuid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      totalCoins: user.stats.totalCoins,
      currentStreak: user.stats.currentStreak,
      totalFocusTime: user.stats.totalFocusTime,
      settings: user.settings
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;