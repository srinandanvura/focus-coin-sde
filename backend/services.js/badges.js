// services/badges.js - Badge and achievement system
const { User } = require('../models');

class BadgeSystem {
  constructor() {
    this.badges = {
      // Focus Time Badges
      'first_session': {
        id: 'first_session',
        name: 'Getting Started',
        description: 'Complete your first focus session',
        icon: '🌱',
        condition: (stats) => stats.totalFocusTime > 0
      },
      
      'focus_master_1h': {
        id: 'focus_master_1h',
        name: 'Focus Master',
        description: 'Accumulate 1 hour of total focus time',
        icon: '🎯',
        condition: (stats) => stats.totalFocusTime >= 3600
      },
      
      'focus_master_10h': {
        id: 'focus_master_10h',
        name: 'Focus Champion',
        description: 'Accumulate 10 hours of total focus time',
        icon: '🏆',
        condition: (stats) => stats.totalFocusTime >= 36000
      },
      
      'focus_master_100h': {
        id: 'focus_master_100h',
        name: 'Focus Legend',
        description: 'Accumulate 100 hours of total focus time',
        icon: '👑',
        condition: (stats) => stats.totalFocusTime >= 360000
      },

      // Streak Badges
      'streak_3': {
        id: 'streak_3',
        name: 'Consistency',
        description: 'Maintain a 3-day focus streak',
        icon: '🔥',
        condition: (stats) => stats.currentStreak >= 3 || stats.bestStreak >= 3
      },
      
      'streak_7': {
        id: 'streak_7',
        name: 'Weekly Warrior',
        description: 'Maintain a 7-day focus streak',
        icon: '⚡',
        condition: (stats) => stats.currentStreak >= 7 || stats.bestStreak >= 7
      },
      
      'streak_30': {
        id: 'streak_30',
        name: 'Monthly Master',
        description: 'Maintain a 30-day focus streak',
        icon: '💎',
        condition: (stats) => stats.currentStreak >= 30 || stats.bestStreak >= 30
      },

      // Coin Badges
      'coin_collector_100': {
        id: 'coin_collector_100',
        name: 'Coin Collector',
        description: 'Earn 100 focus coins',
        icon: '🪙',
        condition: (stats) => stats.totalCoins >= 100
      },
      
      'coin_collector_1000': {
        id: 'coin_collector_1000',
        name: 'Coin Hoarder',
        description: 'Earn 1,000 focus coins',
        icon: '💰',
        condition: (stats) => stats.totalCoins >= 1000
      },
      
      'coin_collector_10000': {
        id: 'coin_collector_10000',
        name: 'Coin Magnate',
        description: 'Earn 10,000 focus coins',
        icon: '🏦',
        condition: (stats) => stats.totalCoins >= 10000
      },

      // Special Achievements
      'early_bird': {
        id: 'early_bird',
        name: 'Early Bird',
        description: 'Complete a focus session before 8 AM',
        icon: '🌅',
        condition: (stats, userData) => userData.hasEarlySession
      },
      
      'night_owl': {
        id: 'night_owl',
        name: 'Night Owl',
        description: 'Complete a focus session after 10 PM',
        icon: '🦉',
        condition: (stats, userData) => userData.hasLateSession
      },
      
      'productive_day': {
        id: 'productive_day',
        name: 'Productive Day',
        description: 'Focus for over 2 hours in a single day',
        icon: '📈',
        condition: (stats, userData) => userData.maxDailyFocus >= 7200
      },
      
      'distraction_free': {
        id: 'distraction_free',
        name: 'Distraction Free',
        description: 'Complete a week without visiting distracting sites',
        icon: '🧘',
        condition: (stats, userData) => userData.hasDistractionFreeWeek
      },
      
      'site_explorer': {
        id: 'site_explorer',
        name: 'Site Explorer',
        description: 'Visit 10 different productive sites',
        icon: '🗺️',
        condition: (stats, userData) => userData.uniqueProductiveSites >= 10
      }
    };
  }

  async checkAndAwardBadges(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) return [];

      // Get additional user data for complex conditions
      const userData = await this.getUserAnalytics(userId);
      
      const currentBadges = user.badges || [];
      const newBadges = [];

      // Check each badge condition
      for (const [badgeId, badge] of Object.entries(this.badges)) {
        // Skip if user already has this badge
        if (currentBadges.some(b => b.badgeId === badgeId)) continue;

        // Check if user meets the condition
        if (badge.condition(user.stats, userData)) {
          const newBadge = {
            badgeId: badgeId,
            name: badge.name,
            description: badge.description,
            icon: badge.icon,
            dateEarned: new Date()
          };

          newBadges.push(newBadge);
          currentBadges.push(newBadge);
        }
      }

      // Update user with new badges
      if (newBadges.length > 0) {
        await User.findByIdAndUpdate(userId, {
          badges: currentBadges
        });

        console.log(`🏆 User ${userId} earned ${newBadges.length} new badges:`, 
          newBadges.map(b => b.name));
      }

      return newBadges;

    } catch (error) {
      console.error('Error checking badges:', error);
      return [];
    }
  }

  async getUserAnalytics(userId) {
    const { DailyStats, Heartbeat } = require('../models');
    
    try {
      // Get daily stats for analysis
      const dailyStats = await DailyStats.find({ userId }).sort({ date: -1 });
      
      // Get recent heartbeats for time-based analysis
      const recentHeartbeats = await Heartbeat.find({
        userId,
        timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      }).sort({ timestamp: -1 });

      // Analyze data
      const analytics = {
        hasEarlySession: this.checkEarlyBirdSessions(recentHeartbeats),
        hasLateSession: this.checkNightOwlSessions(recentHeartbeats),
        maxDailyFocus: this.getMaxDailyFocus(dailyStats),
        hasDistractionFreeWeek: this.checkDistractionFreeWeek(dailyStats),
        uniqueProductiveSites: this.countUniqueProductiveSites(dailyStats)
      };

      return analytics;

    } catch (error) {
      console.error('Error getting user analytics:', error);
      return {};
    }
  }

  checkEarlyBirdSessions(heartbeats) {
    return heartbeats.some(hb => {
      const hour = hb.timestamp.getHours();
      return hour >= 5 && hour < 8; // 5 AM to 8 AM
    });
  }

  checkNightOwlSessions(heartbeats) {
    return heartbeats.some(hb => {
      const hour = hb.timestamp.getHours();
      return hour >= 22 || hour < 5; // 10 PM to 5 AM
    });
  }

  getMaxDailyFocus(dailyStats) {
    if (!dailyStats.length) return 0;
    return Math.max(...dailyStats.map(day => day.stats.totalFocusTime));
  }

  checkDistractionFreeWeek(dailyStats) {
    if (dailyStats.length < 7) return false;
    
    // Check if any 7-day period has zero distracting time
    for (let i = 0; i <= dailyStats.length - 7; i++) {
      const weekStats = dailyStats.slice(i, i + 7);
      const totalDistracting = weekStats.reduce((sum, day) => 
        sum + (day.stats.distractingTime || 0), 0);
      
      if (totalDistracting === 0) return true;
    }
    
    return false;
  }

  countUniqueProductiveSites(dailyStats) {
    const uniqueSites = new Set();
    
    dailyStats.forEach(day => {
      day.siteBreakdown.forEach(site => {
        if (site.type === 'productive') {
          uniqueSites.add(site.site);
        }
      });
    });
    
    return uniqueSites.size;
  }

  // Get all available badges for display
  getAllBadges() {
    return Object.values(this.badges).map(badge => ({
      id: badge.id,
      name: badge.name,
      description: badge.description,
      icon: badge.icon
    }));
  }

  // Get user's badge progress
  async getUserBadgeProgress(userId) {
    try {
      const user = await User.findById(userId);
      const userData = await this.getUserAnalytics(userId);
      
      const badgeProgress = Object.entries(this.badges).map(([badgeId, badge]) => {
        const earned = user.badges?.some(b => b.badgeId === badgeId);
        const progress = this.calculateBadgeProgress(badge, user.stats, userData);
        
        return {
          id: badgeId,
          name: badge.name,
          description: badge.description,
          icon: badge.icon,
          earned: earned,
          dateEarned: earned ? user.badges.find(b => b.badgeId === badgeId).dateEarned : null,
          progress: progress
        };
      });

      return badgeProgress;

    } catch (error) {
      console.error('Error getting badge progress:', error);
      return [];
    }
  }

  calculateBadgeProgress(badge, stats, userData) {
    // Calculate progress percentage for numeric badges
    if (badge.id === 'focus_master_1h') {
      return Math.min(100, (stats.totalFocusTime / 3600) * 100);
    }
    if (badge.id === 'focus_master_10h') {
      return Math.min(100, (stats.totalFocusTime / 36000) * 100);
    }
    if (badge.id === 'focus_master_100h') {
      return Math.min(100, (stats.totalFocusTime / 360000) * 100);
    }
    if (badge.id === 'streak_3') {
      return Math.min(100, (Math.max(stats.currentStreak, stats.bestStreak) / 3) * 100);
    }
    if (badge.id === 'streak_7') {
      return Math.min(100, (Math.max(stats.currentStreak, stats.bestStreak) / 7) * 100);
    }
    if (badge.id === 'streak_30') {
      return Math.min(100, (Math.max(stats.currentStreak, stats.bestStreak) / 30) * 100);
    }
    if (badge.id === 'coin_collector_100') {
      return Math.min(100, (stats.totalCoins / 100) * 100);
    }
    if (badge.id === 'coin_collector_1000') {
      return Math.min(100, (stats.totalCoins / 1000) * 100);
    }
    if (badge.id === 'coin_collector_10000') {
      return Math.min(100, (stats.totalCoins / 10000) * 100);
    }
    if (badge.id === 'site_explorer') {
      return Math.min(100, ((userData.uniqueProductiveSites || 0) / 10) * 100);
    }
    if (badge.id === 'productive_day') {
      return Math.min(100, ((userData.maxDailyFocus || 0) / 7200) * 100);
    }

    // For binary badges, return 0 or 100
    return badge.condition(stats, userData) ? 100 : 0;
  }
}

module.exports = new BadgeSystem();