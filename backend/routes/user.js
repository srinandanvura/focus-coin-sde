// routes/user.js - User settings and profile management
const express = require('express');
const { User } = require('../models');
const BadgeSystem = require('../services/badges');
const router = express.Router();

// Middleware to get user
const getUser = async (req, res, next) => {
  try {
    const { uuid } = req.params;
    const user = await User.findOne({ uuid });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Leveling system utilities
const LevelSystem = {
  calculateLevel(totalCoins) {
    // Level = sqrt(totalCoins / 100), minimum level 1
    return Math.max(1, Math.floor(Math.sqrt(totalCoins / 100)));
  },
  
  calculateXPProgress(totalCoins) {
    const currentLevel = this.calculateLevel(totalCoins);
    const currentLevelXP = Math.pow(currentLevel, 2) * 100;
    const nextLevelXP = Math.pow(currentLevel + 1, 2) * 100;
    const progress = totalCoins - currentLevelXP;
    const needed = nextLevelXP - currentLevelXP;
    
    return {
      currentLevel,
      currentXP: totalCoins,
      progressXP: progress,
      neededXP: needed,
      progressPercent: Math.round((progress / needed) * 100)
    };
  }
};

// GET /api/user/profile/:uuid - Get user profile
router.get('/profile/:uuid', getUser, async (req, res) => {
  try {
    const levelInfo = LevelSystem.calculateXPProgress(req.user.stats.totalCoins);
    const badgeProgress = await BadgeSystem.getUserBadgeProgress(req.user._id);
    
    const profile = {
      uuid: req.user.uuid,
      level: levelInfo,
      stats: req.user.stats,
      badges: {
        earned: req.user.badges || [],
        available: BadgeSystem.getAllBadges(),
        progress: badgeProgress
      },
      settings: req.user.settings,
      accountInfo: {
        createdAt: req.user.createdAt,
        lastActive: req.user.lastActive,
        isGoogleLinked: !!req.user.googleId
      }
    };

    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/user/settings/sites/:uuid - Update site lists
router.put('/settings/sites/:uuid', getUser, async (req, res) => {
  try {
    const { productiveSites, distractingSites } = req.body;
    
    // Validate input
    if (!Array.isArray(productiveSites) || !Array.isArray(distractingSites)) {
      return res.status(400).json({ error: 'Site lists must be arrays' });
    }

    // Clean and validate domains
    const cleanSites = (sites) => sites
      .map(site => site.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, ''))
      .filter(site => site.length > 0)
      .slice(0, 50); // Limit to 50 sites

    const updatedSettings = {
      ...req.user.settings,
      productiveSites: cleanSites(productiveSites),
      distractingSites: cleanSites(distractingSites)
    };

    await User.findByIdAndUpdate(req.user._id, {
      settings: updatedSettings,
      lastActive: new Date()
    });

    res.json({
      success: true,
      settings: updatedSettings
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/user/settings/privacy/:uuid - Update privacy settings
router.put('/settings/privacy/:uuid', getUser, async (req, res) => {
  try {
    const { private: isPrivate } = req.body;
    
    if (typeof isPrivate !== 'boolean') {
      return res.status(400).json({ error: 'Privacy setting must be boolean' });
    }

    await User.findByIdAndUpdate(req.user._id, {
      'settings.private': isPrivate,
      lastActive: new Date()
    });

    res.json({
      success: true,
      private: isPrivate
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/badges/:uuid - Get user badges with progress
router.get('/badges/:uuid', getUser, async (req, res) => {
  try {
    // Check for new badges
    const newBadges = await BadgeSystem.checkAndAwardBadges(req.user._id);
    
    // Get updated user if new badges were awarded
    const updatedUser = newBadges.length > 0 
      ? await User.findById(req.user._id)
      : req.user;

    const badgeProgress = await BadgeSystem.getUserBadgeProgress(req.user._id);

    res.json({
      earned: updatedUser.badges || [],
      newBadges: newBadges,
      progress: badgeProgress,
      totalEarned: (updatedUser.badges || []).length,
      totalAvailable: BadgeSystem.getAllBadges().length
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/powerups/:uuid - Use powerups/bonuses
router.post('/powerups/:uuid', getUser, async (req, res) => {
  try {
    const { powerupType } = req.body;
    
    if (powerupType === 'streakSaver' && req.user.stats.totalCoins >= 50) {
      // Streak Saver: Costs 50 coins, prevents streak loss for 1 day
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { 'stats.totalCoins': -50 },
        $set: { 
          'powerups.streakSaver': new Date(Date.now() + 24 * 60 * 60 * 1000),
          lastActive: new Date()
        }
      });

      res.json({
        success: true,
        message: 'Streak Saver activated for 24 hours',
        coinsSpent: 50,
        remainingCoins: req.user.stats.totalCoins - 50
      });

    } else if (powerupType === 'doubleXP' && req.user.stats.totalCoins >= 100) {
      // Double XP: Costs 100 coins, doubles coin earning for 1 hour
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { 'stats.totalCoins': -100 },
        $set: { 
          'powerups.doubleXP': new Date(Date.now() + 60 * 60 * 1000),
          lastActive: new Date()
        }
      });

      res.json({
        success: true,
        message: 'Double XP activated for 1 hour',
        coinsSpent: 100,
        remainingCoins: req.user.stats.totalCoins - 100
      });

    } else {
      res.status(400).json({ 
        error: 'Invalid powerup or insufficient coins',
        availablePowerups: {
          streakSaver: { cost: 50, available: req.user.stats.totalCoins >= 50 },
          doubleXP: { cost: 100, available: req.user.stats.totalCoins >= 100 }
        }
      });
    }

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/leaderboard-preview - Get leaderboard position (no UUID needed)
router.get('/leaderboard-preview', async (req, res) => {
  try {
    const topUsers = await User.find({
      'settings.private': { $ne: true }
    })
    .select('uuid stats.totalCoins stats.currentStreak stats.totalFocusTime')
    .sort({ 'stats.totalCoins': -1 })
    .limit(10);

    const leaderboard = topUsers.map((user, index) => ({
      rank: index + 1,
      level: LevelSystem.calculateLevel(user.stats.totalCoins),
      totalCoins: user.stats.totalCoins,
      currentStreak: user.stats.currentStreak,
      totalFocusTime: Math.round(user.stats.totalFocusTime / 60), // in minutes
      uuid: user.uuid.slice(0, 8) + '...' // Partial UUID for privacy
    }));

    res.json({
      leaderboard,
      totalPublicUsers: await User.countDocuments({ 'settings.private': { $ne: true } })
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/rank/:uuid - Get user's leaderboard rank
router.get('/rank/:uuid', getUser, async (req, res) => {
  try {
    if (req.user.settings.private) {
      return res.json({
        rank: null,
        message: 'Profile is private - not shown on leaderboard'
      });
    }

    const betterUsers = await User.countDocuments({
      'stats.totalCoins': { $gt: req.user.stats.totalCoins },
      'settings.private': { $ne: true }
    });

    const totalUsers = await User.countDocuments({
      'settings.private': { $ne: true }
    });

    res.json({
      rank: betterUsers + 1,
      totalUsers: totalUsers,
      percentile: Math.round(((totalUsers - betterUsers) / totalUsers) * 100)
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/user/data/:uuid - Delete user data (GDPR compliance)
router.delete('/data/:uuid', getUser, async (req, res) => {
  try {
    const { confirm } = req.body;
    
    if (confirm !== 'DELETE_ALL_DATA') {
      return res.status(400).json({ 
        error: 'Must confirm deletion by sending { "confirm": "DELETE_ALL_DATA" }' 
      });
    }

    // Delete user and all associated data
    const { Heartbeat, DailyStats } = require('../models');
    
    await Promise.all([
      Heartbeat.deleteMany({ userId: req.user._id }),
      DailyStats.deleteMany({ userId: req.user._id }),
      User.findByIdAndDelete(req.user._id)
    ]);

    res.json({
      success: true,
      message: 'All user data has been permanently deleted'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;