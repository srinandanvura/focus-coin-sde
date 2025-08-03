// routes/auth.js - Google OAuth authentication
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { User, Heartbeat, DailyStats } = require('../models');
const router = express.Router();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// POST /api/auth/google - Verify Google token and login/register
router.post('/google', async (req, res) => {
  try {
    const { idToken, uuid } = req.body;
    
    if (!idToken) {
      return res.status(400).json({ error: 'ID token required' });
    }

    // Verify the Google ID token
    const ticket = await client.verifyIdToken({
      idToken: idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name;
    const picture = payload.picture;

    // Check if user already exists with this Google ID
    let existingUser = await User.findOne({ googleId });
    
    if (existingUser) {
      // User exists, update last active
      existingUser.lastActive = new Date();
      await existingUser.save();
      
      return res.json({
        success: true,
        user: {
          uuid: existingUser.uuid,
          googleId: existingUser.googleId,
          email: existingUser.email,
          name: existingUser.name,
          picture: existingUser.picture,
          stats: existingUser.stats,
          isNewUser: false
        }
      });
    }

    // Check if we need to migrate data from UUID-based account
    let uuidUser = null;
    if (uuid) {
      uuidUser = await User.findOne({ uuid, googleId: { $exists: false } });
    }

    if (uuidUser) {
      // Migrate existing UUID account to Google account
      await this.migrateUUIDToGoogle(uuidUser, googleId, email, name, picture);
      
      return res.json({
        success: true,
        user: {
          uuid: uuidUser.uuid,
          googleId: googleId,
          email: email,
          name: name,
          picture: picture,
          stats: uuidUser.stats,
          isNewUser: false,
          migrated: true
        }
      });

    } else {
      // Create new Google-linked user
      const newUser = new User({
        uuid: uuid || crypto.randomUUID(),
        googleId: googleId,
        email: email,
        name: name,
        picture: picture,
        settings: {
          productiveSites: [
            'github.com', 'stackoverflow.com', 'wikipedia.org', 
            'leetcode.com', 'coursera.org', 'udemy.com'
          ],
          distractingSites: [
            'youtube.com', 'instagram.com', 'twitter.com', 
            'facebook.com', 'reddit.com', 'tiktok.com'
          ],
          private: false
        },
        stats: {
          totalFocusTime: 0,
          totalCoins: 10, // Starting coins
          currentStreak: 0,
          bestStreak: 0
        }
      });

      await newUser.save();

      return res.json({
        success: true,
        user: {
          uuid: newUser.uuid,
          googleId: newUser.googleId,
          email: newUser.email,
          name: newUser.name,
          picture: newUser.picture,
          stats: newUser.stats,
          isNewUser: true
        }
      });
    }

  } catch (error) {
    console.error('Google auth error:', error);
    
    if (error.message.includes('Token used too early')) {
      return res.status(400).json({ error: 'Token not yet valid. Please try again.' });
    }
    
    res.status(400).json({ 
      error: 'Invalid Google token',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/auth/link-google - Link Google account to existing UUID account
router.post('/link-google', async (req, res) => {
  try {
    const { idToken, uuid } = req.body;
    
    if (!idToken || !uuid) {
      return res.status(400).json({ error: 'ID token and UUID required' });
    }

    // Verify Google token
    const ticket = await client.verifyIdToken({
      idToken: idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name;
    const picture = payload.picture;

    // Check if Google account is already linked elsewhere
    const existingGoogleUser = await User.findOne({ googleId });
    if (existingGoogleUser) {
      return res.status(400).json({ 
        error: 'This Google account is already linked to another Focus Coin account' 
      });
    }

    // Find the UUID-based user
    const uuidUser = await User.findOne({ uuid });
    if (!uuidUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (uuidUser.googleId) {
      return res.status(400).json({ 
        error: 'This account is already linked to a Google account' 
      });
    }

    // Link Google account
    uuidUser.googleId = googleId;
    uuidUser.email = email;
    uuidUser.name = name;
    uuidUser.picture = picture;
    uuidUser.lastActive = new Date();
    
    await uuidUser.save();

    res.json({
      success: true,
      message: 'Google account successfully linked',
      user: {
        uuid: uuidUser.uuid,
        googleId: uuidUser.googleId,
        email: uuidUser.email,
        name: uuidUser.name,
        picture: uuidUser.picture,
        stats: uuidUser.stats
      }
    });

  } catch (error) {
    console.error('Link Google error:', error);
    res.status(400).json({ error: 'Failed to link Google account' });
  }
});

// POST /api/auth/unlink-google - Unlink Google account
router.post('/unlink-google', async (req, res) => {
  try {
    const { uuid } = req.body;
    
    if (!uuid) {
      return res.status(400).json({ error: 'UUID required' });
    }

    const user = await User.findOne({ uuid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.googleId) {
      return res.status(400).json({ error: 'No Google account linked' });
    }

    // Remove Google linkage but keep the user data
    user.googleId = undefined;
    user.email = undefined;
    user.name = undefined;
    user.picture = undefined;
    user.lastActive = new Date();
    
    await user.save();

    res.json({
      success: true,
      message: 'Google account successfully unlinked',
      user: {
        uuid: user.uuid,
        stats: user.stats
      }
    });

  } catch (error) {
    console.error('Unlink Google error:', error);
    res.status(500).json({ error: 'Failed to unlink Google account' });
  }
});

// GET /api/auth/profile/:uuid - Get user profile (authenticated or not)
router.get('/profile/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;
    
    const user = await User.findOne({ uuid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const profile = {
      uuid: user.uuid,
      isAuthenticated: !!user.googleId,
      profile: user.googleId ? {
        email: user.email,
        name: user.name,
        picture: user.picture
      } : null,
      stats: user.stats,
      settings: user.settings,
      accountInfo: {
        createdAt: user.createdAt,
        lastActive: user.lastActive
      }
    };

    res.json(profile);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function to migrate UUID account to Google account
router.migrateUUIDToGoogle = async function(uuidUser, googleId, email, name, picture) {
  try {
    // Update user with Google info
    uuidUser.googleId = googleId;
    uuidUser.email = email;
    uuidUser.name = name;
    uuidUser.picture = picture;
    uuidUser.lastActive = new Date();
    
    await uuidUser.save();
    
    console.log(`✅ Migrated UUID user ${uuidUser.uuid} to Google account ${email}`);
    
    return uuidUser;

  } catch (error) {
    console.error('Migration error:', error);
    throw error;
  }
};

// POST /api/auth/refresh - Refresh user session
router.post('/refresh', async (req, res) => {
  try {
    const { uuid } = req.body;
    
    if (!uuid) {
      return res.status(400).json({ error: 'UUID required' });
    }

    const user = await User.findOne({ uuid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update last active
    user.lastActive = new Date();
    await user.save();

    res.json({
      success: true,
      user: {
        uuid: user.uuid,
        isAuthenticated: !!user.googleId,
        profile: user.googleId ? {
          email: user.email,
          name: user.name,
          picture: user.picture
        } : null,
        stats: user.stats
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;