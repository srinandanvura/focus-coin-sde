// routes/stats.js - Statistics and analytics API
const express = require('express');
const { User, DailyStats } = require('../models');
const router = express.Router();

// Middleware to get user by UUID
const getUserByUUID = async (req, res, next) => {
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

// GET /api/stats/today/:uuid - Today's stats
router.get('/today/:uuid', getUserByUUID, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const todayStats = await DailyStats.findOne({
      userId: req.user._id,
      date: today
    });

    const response = {
      date: today,
      stats: todayStats?.stats || {
        totalFocusTime: 0,
        coinsEarned: 0,
        coinsSpent: 0,
        productiveTime: 0,
        distractingTime: 0,
        sessionsCount: 0
      },
      siteBreakdown: todayStats?.siteBreakdown || [],
      userStats: {
        totalCoins: req.user.stats.totalCoins,
        currentStreak: req.user.stats.currentStreak,
        bestStreak: req.user.stats.bestStreak,
        totalFocusTime: req.user.stats.totalFocusTime
      }
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/stats/history/:uuid - Historical stats
router.get('/history/:uuid', getUserByUUID, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

    const stats = await DailyStats.find({
      userId: req.user._id,
      date: {
        $gte: startDate.toISOString().split('T')[0],
        $lte: endDate.toISOString().split('T')[0]
      }
    }).sort({ date: 1 });

    // Fill in missing days with zero stats
    const dailyData = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const existingStat = stats.find(s => s.date === dateStr);
      
      dailyData.push({
        date: dateStr,
        stats: existingStat?.stats || {
          totalFocusTime: 0,
          coinsEarned: 0,
          coinsSpent: 0,
          productiveTime: 0,
          distractingTime: 0,
          sessionsCount: 0
        },
        siteBreakdown: existingStat?.siteBreakdown || []
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Calculate summary stats
    const summary = {
      totalDays: days,
      avgFocusTime: Math.round(
        dailyData.reduce((sum, day) => sum + day.stats.totalFocusTime, 0) / days
      ),
      totalCoinsEarned: dailyData.reduce((sum, day) => sum + day.stats.coinsEarned, 0),
      totalCoinsSpent: dailyData.reduce((sum, day) => sum + day.stats.coinsSpent, 0),
      activeDays: dailyData.filter(day => day.stats.totalFocusTime > 0).length,
      mostProductiveSite: this.getMostProductiveSite(dailyData),
      longestSession: Math.max(...dailyData.map(day => day.stats.totalFocusTime))
    };

    res.json({
      period: { startDate: startDate.toISOString().split('T')[0], endDate: endDate.toISOString().split('T')[0] },
      summary,
      dailyData,
      userStats: {
        totalCoins: req.user.stats.totalCoins,
        currentStreak: req.user.stats.currentStreak,
        bestStreak: req.user.stats.bestStreak
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/stats/sites/:uuid - Site breakdown analysis
router.get('/sites/:uuid', getUserByUUID, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

    const stats = await DailyStats.find({
      userId: req.user._id,
      date: {
        $gte: startDate.toISOString().split('T')[0],
        $lte: endDate.toISOString().split('T')[0]
      }
    });

    // Aggregate site data
    const siteAggregates = {};
    
    stats.forEach(dayStat => {
      dayStat.siteBreakdown.forEach(site => {
        if (!siteAggregates[site.site]) {
          siteAggregates[site.site] = {
            site: site.site,
            type: site.type,
            totalTime: 0,
            totalCoinsChange: 0,
            daysActive: 0,
            avgTimePerDay: 0
          };
        }
        
        siteAggregates[site.site].totalTime += site.timeSpent;
        siteAggregates[site.site].totalCoinsChange += site.coinsChange;
        siteAggregates[site.site].daysActive++;
      });
    });

    // Calculate averages and sort
    const siteAnalysis = Object.values(siteAggregates)
      .map(site => ({
        ...site,
        avgTimePerDay: Math.round(site.totalTime / days),
        timePercent: 0 // Will calculate after getting total
      }))
      .sort((a, b) => b.totalTime - a.totalTime);

    // Calculate percentages
    const totalTime = siteAnalysis.reduce((sum, site) => sum + site.totalTime, 0);
    siteAnalysis.forEach(site => {
      site.timePercent = totalTime > 0 ? Math.round((site.totalTime / totalTime) * 100) : 0;
    });

    res.json({
      period: { 
        startDate: startDate.toISOString().split('T')[0], 
        endDate: endDate.toISOString().split('T')[0] 
      },
      totalSites: siteAnalysis.length,
      totalTimeTracked: totalTime,
      topSites: siteAnalysis.slice(0, 10),
      productiveSites: siteAnalysis.filter(s => s.type === 'productive'),
      distractingSites: siteAnalysis.filter(s => s.type === 'distracting'),
      siteBreakdown: siteAnalysis
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function
router.getMostProductiveSite = function(dailyData) {
  const siteTime = {};
  
  dailyData.forEach(day => {
    day.siteBreakdown.forEach(site => {
      if (site.type === 'productive') {
        siteTime[site.site] = (siteTime[site.site] || 0) + site.timeSpent;
      }
    });
  });

  const topSite = Object.entries(siteTime)
    .sort((a, b) => b[1] - a[1])[0];
    
  return topSite ? { site: topSite[0], time: topSite[1] } : null;
};

// GET /api/stats/export/:uuid - Export user data
router.get('/export/:uuid', getUserByUUID, async (req, res) => {
  try {
    const allStats = await DailyStats.find({
      userId: req.user._id
    }).sort({ date: 1 });

    const exportData = {
      user: {
        uuid: req.user.uuid,
        stats: req.user.stats,
        settings: req.user.settings,
        exportDate: new Date().toISOString()
      },
      dailyStats: allStats
    };

    res.setHeader('Content-Disposition', `attachment; filename=focuscoin-data-${req.user.uuid}.json`);
    res.setHeader('Content-Type', 'application/json');
    res.json(exportData);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;