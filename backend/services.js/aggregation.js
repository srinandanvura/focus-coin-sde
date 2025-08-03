// services/aggregation.js - Heartbeat data aggregation
const { User, Heartbeat, DailyStats } = require('../models');
const cron = require('node-cron');

class AggregationService {
  constructor() {
    this.setupCronJobs();
  }

  setupCronJobs() {
    // Run every hour to aggregate recent data
    cron.schedule('0 * * * *', () => {
      console.log('Running hourly aggregation...');
      this.aggregateRecentData();
    });

    // Run daily at midnight to finalize previous day
    cron.schedule('0 0 * * *', () => {
      console.log('Running daily aggregation...');
      this.aggregateDailyData();
    });
  }

  async aggregateRecentData() {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    try {
      // Get all users with recent activity
      const users = await User.find({
        lastActive: { $gte: oneHourAgo }
      });

      for (const user of users) {
        await this.aggregateUserData(user._id, oneHourAgo, now);
      }

      console.log(`✅ Aggregated data for ${users.length} users`);
    } catch (error) {
      console.error('❌ Aggregation error:', error);
    }
  }

  async aggregateDailyData() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    const today = new Date(yesterday);
    today.setDate(today.getDate() + 1);

    try {
      const users = await User.find({});
      
      for (const user of users) {
        await this.aggregateUserData(user._id, yesterday, today, true);
      }

      console.log(`✅ Daily aggregation complete for ${users.length} users`);
    } catch (error) {
      console.error('❌ Daily aggregation error:', error);
    }
  }

  async aggregateUserData(userId, startTime, endTime, isDailyFinal = false) {
    try {
      // Get heartbeats for the period
      const heartbeats = await Heartbeat.find({
        userId,
        timestamp: { $gte: startTime, $lt: endTime }
      }).sort({ timestamp: 1 });

      if (heartbeats.length === 0) return;

      // Group by date
      const dailyData = {};
      
      heartbeats.forEach(hb => {
        const dateKey = hb.timestamp.toISOString().split('T')[0];
        
        if (!dailyData[dateKey]) {
          dailyData[dateKey] = {
            totalFocusTime: 0,
            coinsEarned: 0,
            coinsSpent: 0,
            productiveTime: 0,
            distractingTime: 0,
            sessionsCount: new Set(),
            siteBreakdown: {}
          };
        }

        const dayData = dailyData[dateKey];
        
        // Track session
        dayData.sessionsCount.add(hb.sessionId);
        
        // Track coins
        if (hb.coinsChange > 0) {
          dayData.coinsEarned += hb.coinsChange;
        } else if (hb.coinsChange < 0) {
          dayData.coinsSpent += Math.abs(hb.coinsChange);
        }

        // Track time by site type
        const timeIncrement = 5; // 5 seconds per heartbeat
        if (hb.siteType === 'productive') {
          dayData.productiveTime += timeIncrement;
          dayData.totalFocusTime += timeIncrement;
        } else if (hb.siteType === 'distracting') {
          dayData.distractingTime += timeIncrement;
        }

        // Site breakdown
        if (!dayData.siteBreakdown[hb.site]) {
          dayData.siteBreakdown[hb.site] = {
            site: hb.site,
            timeSpent: 0,
            coinsChange: 0,
            type: hb.siteType
          };
        }
        
        dayData.siteBreakdown[hb.site].timeSpent += timeIncrement;
        dayData.siteBreakdown[hb.site].coinsChange += hb.coinsChange;
      });

      // Save to DailyStats
      for (const [date, data] of Object.entries(dailyData)) {
        const statsData = {
          userId,
          date,
          stats: {
            totalFocusTime: data.totalFocusTime,
            coinsEarned: data.coinsEarned,
            coinsSpent: data.coinsSpent,
            productiveTime: data.productiveTime,
            distractingTime: data.distractingTime,
            sessionsCount: data.sessionsCount.size
          },
          siteBreakdown: Object.values(data.siteBreakdown),
          updatedAt: new Date()
        };

        await DailyStats.findOneAndUpdate(
          { userId, date },
          statsData,
          { upsert: true, new: true }
        );
      }

      // Update user stats if daily final
      if (isDailyFinal) {
        await this.updateUserStats(userId);
      }

    } catch (error) {
      console.error(`Error aggregating data for user ${userId}:`, error);
    }
  }

  async updateUserStats(userId) {
    try {
      // Get all daily stats for user
      const allStats = await DailyStats.find({ userId });
      
      const totalCoins = allStats.reduce((sum, day) => 
        sum + day.stats.coinsEarned - day.stats.coinsSpent, 0);
      
      const totalFocusTime = allStats.reduce((sum, day) => 
        sum + day.stats.totalFocusTime, 0);

      // Calculate streak
      const currentStreak = this.calculateStreak(allStats);
      
      await User.findByIdAndUpdate(userId, {
        'stats.totalCoins': totalCoins,
        'stats.totalFocusTime': totalFocusTime,
        'stats.currentStreak': currentStreak,
        'stats.bestStreak': Math.max(currentStreak, await this.getBestStreak(userId))
      });

    } catch (error) {
      console.error(`Error updating user stats for ${userId}:`, error);
    }
  }

  calculateStreak(dailyStats) {
    // Sort by date descending
    const sortedStats = dailyStats
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .filter(day => day.stats.totalFocusTime > 0);

    if (sortedStats.length === 0) return 0;

    let streak = 0;
    let currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    for (const dayStat of sortedStats) {
      const statDate = new Date(dayStat.date);
      const dayDiff = Math.floor((currentDate - statDate) / (1000 * 60 * 60 * 24));

      if (dayDiff === streak) {
        streak++;
        currentDate.setDate(currentDate.getDate() - 1);
      } else {
        break;
      }
    }

    return streak;
  }

  async getBestStreak(userId) {
    const user = await User.findById(userId);
    return user.stats.bestStreak || 0;
  }

  // Manual trigger for testing
  async triggerAggregation(userId = null) {
    if (userId) {
      const user = await User.findById(userId);
      if (user) {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        await this.aggregateUserData(userId, oneDayAgo, new Date(), true);
        console.log(`✅ Manual aggregation complete for user ${userId}`);
      }
    } else {
      await this.aggregateRecentData();
    }
  }
}

module.exports = new AggregationService();