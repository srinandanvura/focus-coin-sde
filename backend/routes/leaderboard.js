// routes/leaderboard.js - Competitive leaderboard system
const express = require('express');
const { User } = require('../models');
const router = express.Router();

// Cache for leaderboard data (refreshed periodically)
let leaderboardCache = {
  lastUpdated: null,
  data: null
};

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Helper function to calculate level
const calculateLevel = (totalCoins) => {
  return Math.max(1, Math.floor(Math.sqrt(totalCoins / 100)));
};

// GET /api/leaderboard/global - Global leaderboard
router.get('/global', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const sortBy = req.query.sortBy || 'totalCoins'; // totalCoins, currentStreak, totalFocusTime
    
    if (limit > 100) {
      return res.status(400).json({ error: 'Limit cannot exceed 100' });
    }

    // Check cache first
    const now = Date.now();
    if (leaderboardCache.lastUpdated && 
        (now - leaderboardCache.lastUpdated) < CACHE_DURATION &&
        leaderboardCache.data[sortBy]) {
      
      const cached = leaderboardCache.data[sortBy];
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      
      return res.json({
        leaderboard: cached.users.slice(startIndex, endIndex),
        pagination: {
          page,
          limit,
          totalUsers: cached.totalUsers,
          totalPages: Math.ceil(cached.totalUsers / limit),
          hasNext: endIndex < cached.totalUsers,
          hasPrev: page > 1
        },
        sortBy,
        lastUpdated: leaderboardCache.lastUpdated,
        cached: true
      });
    }

    // Generate fresh leaderboard
    const sortField = `stats.${sortBy}`;
    const users = await User.find({
      'settings.private': { $ne: true },
      googleId: { $exists: true } // Only show authenticated users
    })
    .select('uuid email name picture stats createdAt')
    .sort({ [sortField]: -1 })
    .lean();

    const totalUsers = users.length;
    
    // Enhance user data
    const enhancedUsers = users.map((user, index) => ({
      rank: index + 1,
      uuid: user.uuid,
      displayName: user.name || `User ${user.uuid.slice(0, 8)}`,
      picture: user.picture,
      level: calculateLevel(user.stats.totalCoins),
      stats: {
        totalCoins: user.stats.totalCoins,
        currentStreak: user.stats.currentStreak,
        totalFocusTime: Math.round(user.stats.totalFocusTime / 60), // in minutes
        bestStreak: user.stats.bestStreak
      },
      joinedDate: user.createdAt,
      badge: this.getUserBadge(user.stats) // Top performer badge
    }));

    // Update cache
    if (!leaderboardCache.data) leaderboardCache.data = {};
    leaderboardCache.data[sortBy] = {
      users: enhancedUsers,
      totalUsers
    };
    leaderboardCache.lastUpdated = now;

    // Return paginated results
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;

    res.json({
      leaderboard: enhancedUsers.slice(startIndex, endIndex),
      pagination: {
        page,
        limit,
        totalUsers,
        totalPages: Math.ceil(totalUsers / limit),
        hasNext: endIndex < totalUsers,
        hasPrev: page > 1
      },
      sortBy,
      lastUpdated: now,
      cached: false
    });

  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/leaderboard/user/:uuid - Get user's position and nearby users
router.get('/user/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;
    const sortBy = req.query.sortBy || 'totalCoins';
    const range = parseInt(req.query.range) || 5; // Show ±5 users around target
    
    const user = await User.findOne({ uuid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.settings.private) {
      return res.json({
        message: 'User profile is private',
        userStats: {
          level: calculateLevel(user.stats.totalCoins),
          stats: user.stats
        }
      });
    }

    // Get user's rank
    const sortField = `stats.${sortBy}`;
    const betterUsers = await User.countDocuments({
      [sortField]: { $gt: user.stats[sortBy] },
      'settings.private': { $ne: true },
      googleId: { $exists: true }
    });

    const userRank = betterUsers + 1;

    // Get users around this rank
    const startRank = Math.max(1, userRank - range);
    const users = await User.find({
      'settings.private': { $ne: true },
      googleId: { $exists: true }
    })
    .select('uuid email name picture stats')
    .sort({ [sortField]: -1 })
    .skip(startRank - 1)
    .limit(range * 2 + 1)
    .lean();

    const leaderboardSlice = users.map((u, index) => ({
      rank: startRank + index,
      uuid: u.uuid,
      displayName: u.name || `User ${u.uuid.slice(0, 8)}`,
      picture: u.picture,
      level: calculateLevel(u.stats.totalCoins),
      stats: {
        totalCoins: u.stats.totalCoins,
        currentStreak: u.stats.currentStreak,
        totalFocusTime: Math.round(u.stats.totalFocusTime / 60),
        bestStreak: u.stats.bestStreak
      },
      isCurrentUser: u.uuid === uuid,
      badge: this.getUserBadge(u.stats)
    }));

    const totalUsers = await User.countDocuments({
      'settings.private': { $ne: true },
      googleId: { $exists: true }
    });

    res.json({
      userRank,
      totalUsers,
      percentile: Math.round(((totalUsers - userRank + 1) / totalUsers) * 100),
      leaderboardSlice,
      sortBy
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/leaderboard/weekly - Weekly leaderboard (most coins earned this week)
router.get('/weekly', async (req, res) => {
  try {
    const { DailyStats } = require('../models');
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    // Get start of current week
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    // Aggregate weekly stats
    const weeklyStats = await DailyStats.aggregate([
      {
        $match: {
          date: { $gte: startOfWeek.toISOString().split('T')[0] }
        }
      },
      {
        $group: {
          _id: '$userId',
          weeklyCoins: { $sum: '$stats.coinsEarned' },
          weeklyFocusTime: { $sum: '$stats.totalFocusTime' },
          activeDays: { $sum: { $cond: [{ $gt: ['$stats.totalFocusTime', 0] }, 1, 0] } }
        }
      },
      {
        $sort: { weeklyCoins: -1 }
      },
      {
        $skip: (page - 1) * limit
      },
      {
        $limit: limit
      }
    ]);

    // Get user details
    const userIds = weeklyStats.map(stat => stat._id);
    const users = await User.find({
      _id: { $in: userIds },
      'settings.private': { $ne: true },
      googleId: { $exists: true }
    }).select('uuid name picture stats').lean();

    // Combine data
    const weeklyLeaderboard = weeklyStats.map((stat, index) => {
      const user = users.find(u => u._id.toString() === stat._id.toString());
      if (!user) return null;

      return {
        rank: ((page - 1) * limit) + index + 1,
        uuid: user.uuid,
        displayName: user.name || `User ${user.uuid.slice(0, 8)}`,
        picture: user.picture,
        level: calculateLevel(user.stats.totalCoins),
        weeklyStats: {
          coinsEarned: stat.weeklyCoins,
          focusTime: Math.round(stat.weeklyFocusTime / 60),
          activeDays: stat.activeDays
        },
        totalStats: {
          totalCoins: user.stats.totalCoins,
          currentStreak: user.stats.currentStreak
        }
      };
    }).filter(Boolean);

    const totalWeeklyUsers = await DailyStats.distinct('userId', {
      date: { $gte: startOfWeek.toISOString().split('T')[0] }
    }).then(ids => ids.length);

    res.json({
      leaderboard: weeklyLeaderboard,
      period: {
        type: 'weekly',
        startDate: startOfWeek.toISOString().split('T')[0],
        endDate: now.toISOString().split('T')[0]
      },
      pagination: {
        page,
        limit,
        totalUsers: totalWeeklyUsers,
        totalPages: Math.ceil(totalWeeklyUsers / limit),
        hasNext: ((page - 1) * limit) + weeklyLeaderboard.length < totalWeeklyUsers,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function to assign badges based on performance
router.getUserBadge = function(stats) {
  if (stats.currentStreak >= 30) return { emoji: '💎', name: 'Diamond Streak' };
  if (stats.currentStreak >= 14) return { emoji: '🔥', name: 'Fire Streak' };
  if (stats.currentStreak >= 7) return { emoji: '⚡', name: 'Weekly Warrior' };
  if (stats.totalCoins >= 10000) return { emoji: '👑', name: 'Coin Royalty' };
  if (stats.totalCoins >= 1000) return { emoji: '💰', name: 'Coin Master' };
  if (stats.totalFocusTime >= 360000) return { emoji: '🏆', name: 'Focus Legend' };
  if (stats.totalFocusTime >= 36000) return { emoji: '🎯', name: 'Focus Pro' };
  return null;
};

// POST /api/leaderboard/challenge - Create or join weekly challenges
router.post('/challenge', async (req, res) => {
  try {
    const { uuid, challengeType } = req.body;
    
    // This could be expanded for future challenge features
    res.json({
      message: 'Challenge feature coming soon!',
      availableChallenges: [
        { id: 'weekly_focus', name: 'Weekly Focus Challenge', description: 'Focus for 10 hours this week' },
        { id: 'streak_builder', name: 'Streak Builder', description: 'Maintain a 7-day streak' },
        { id: 'site_explorer', name: 'Site Explorer', description: 'Visit 5 new productive sites' }
      ]
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;