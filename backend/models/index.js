// models/index.js - Database schemas
const mongoose = require('mongoose');

// User Schema
const userSchema = new mongoose.Schema({
  uuid: { type: String, unique: true, required: true },
  googleId: { type: String, unique: true, sparse: true },
  email: { type: String, sparse: true },
  settings: {
    productiveSites: [String],
    distractingSites: [String],
    private: { type: Boolean, default: false }
  },
  stats: {
    totalFocusTime: { type: Number, default: 0 },
    totalCoins: { type: Number, default: 0 },
    currentStreak: { type: Number, default: 0 },
    bestStreak: { type: Number, default: 0 }
  },
  createdAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now }
});

// Heartbeat Schema (raw logs)
const heartbeatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sessionId: { type: String, required: true },
  timestamp: { type: Date, required: true },
  site: { type: String, required: true },
  siteType: { type: String, enum: ['productive', 'distracting', 'neutral'], required: true },
  action: { type: String, enum: ['visit', 'focus', 'distract'], required: true },
  coinsChange: { type: Number, default: 0 },
  metadata: {
    tabId: Number,
    windowId: Number,
    url: String
  }
}, {
  timestamps: true
});

// Daily Stats Schema (aggregated data)
const dailyStatsSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true }, // YYYY-MM-DD format
  stats: {
    totalFocusTime: { type: Number, default: 0 },
    coinsEarned: { type: Number, default: 0 },
    coinsSpent: { type: Number, default: 0 },
    productiveTime: { type: Number, default: 0 },
    distractingTime: { type: Number, default: 0 },
    sessionsCount: { type: Number, default: 0 }
  },
  siteBreakdown: [{
    site: String,
    timeSpent: Number,
    coinsChange: Number,
    type: String
  }],
  updatedAt: { type: Date, default: Date.now }
});

// Create compound index for efficient queries
dailyStatsSchema.index({ userId: 1, date: 1 }, { unique: true });
heartbeatSchema.index({ userId: 1, timestamp: -1 });

// Export models
const User = mongoose.model('User', userSchema);
const Heartbeat = mongoose.model('Heartbeat', heartbeatSchema);
const DailyStats = mongoose.model('DailyStats', dailyStatsSchema);

module.exports = { User, Heartbeat, DailyStats };