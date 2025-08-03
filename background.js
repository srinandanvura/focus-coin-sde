// background.js - Enhanced with backend synchronization
class FocusCoinEngine {
    constructor() {
        this.isSessionActive = false;
        this.currentTabId = null;
        this.lastUpdateTime = Date.now();
        this.coinUpdateInterval = 5000; // 5 seconds
        this.updateTimer = null;
        this.sessionId = null;
        this.uuid = null;
        
        // Backend config
        this.API_BASE = 'http://localhost:3000/api';
        this.heartbeatBuffer = [];
        this.syncInterval = 5 * 60 * 1000; // 5 minutes
        this.maxBufferSize = 10;

        this.productiveSites = [
            'github.com', 'stackoverflow.com', 'wikipedia.org', 'leetcode.com',
            'coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org',
            'developer.mozilla.org', 'w3schools.com', 'freecodecamp.org'
        ];
        
        this.distractingSites = [
            'youtube.com', 'instagram.com', 'twitter.com', 'facebook.com',
            'reddit.com', 'tiktok.com', 'netflix.com', 'twitch.tv',
            'discord.com', 'whatsapp.com'
        ];

        this.initialize();
    }

    async initialize() {
        // Generate or get UUID
        await this.ensureUUID();
        
        // Initialize storage
        const result = await chrome.storage.local.get([
            'focusCoins', 'todayCoins', 'focusStreak', 'sessionActive'
        ]);

        if (result.focusCoins === undefined) {
            await chrome.storage.local.set({
                focusCoins: 10,
                todayCoins: 0,
                focusStreak: 0,
                sessionActive: false,
                lastActiveDate: new Date().toDateString()
            });
        }

        this.isSessionActive = result.sessionActive || false;
        this.setupListeners();
        
        if (this.isSessionActive) {
            this.startMonitoring();
        }

        // Set up periodic sync
        setInterval(() => this.syncHeartbeats(), this.syncInterval);

        console.log('Focus Coin Engine initialized with UUID:', this.uuid);
    }

    async ensureUUID() {
        const result = await chrome.storage.local.get(['focus_uuid']);
        if (!result.focus_uuid) {
            this.uuid = crypto.randomUUID();
            await chrome.storage.local.set({ focus_uuid: this.uuid });
        } else {
            this.uuid = result.focus_uuid;
        }
    }

    setupListeners() {
        chrome.tabs.onActivated.addListener((activeInfo) => {
            this.currentTabId = activeInfo.tabId;
            this.handleTabChange();
        });

        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (tabId === this.currentTabId && changeInfo.url) {
                this.handleTabChange();
            }
        });

        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
        });
    }

    async handleMessage(message, sender, sendResponse) {
        switch (message.action) {
            case 'startSession':
                await this.startSession();
                break;
            case 'stopSession':
                await this.stopSession();
                break;
            case 'getCoins':
                const result = await chrome.storage.local.get(['focusCoins', 'todayCoins']);
                sendResponse({
                    focusCoins: result.focusCoins || 0,
                    todayCoins: result.todayCoins || 0
                });
                break;
        }
    }

    async startSession() {
        this.isSessionActive = true;
        this.sessionId = crypto.randomUUID();
        this.lastUpdateTime = Date.now();
        
        await chrome.storage.local.set({
            sessionActive: true,
            sessionStartTime: this.lastUpdateTime
        });
        
        // Notify backend
        await this.apiCall('/sessions/start', {
            uuid: this.uuid,
            sessionId: this.sessionId,
            timestamp: this.lastUpdateTime
        });
        
        this.startMonitoring();
        console.log('Focus session started:', this.sessionId);
    }

    async stopSession() {
        this.isSessionActive = false;
        
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }
        
        // Sync remaining heartbeats
        await this.syncHeartbeats();
        
        // Notify backend
        await this.apiCall('/sessions/stop', {
            uuid: this.uuid,
            sessionId: this.sessionId
        });
        
        await chrome.storage.local.set({
            sessionActive: false,
            sessionStartTime: null
        });
        
        this.sessionId = null;
        console.log('Focus session stopped');
    }

    startMonitoring() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }
        
        this.updateCoins();
        this.updateTimer = setInterval(() => {
            this.updateCoins();
        }, this.coinUpdateInterval);
    }

    async handleTabChange() {
        if (!this.isSessionActive) return;
        this.lastUpdateTime = Date.now();
        this.updateCoins();
    }

    async updateCoins() {
        if (!this.isSessionActive) return;

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.url) return;

            const url = new URL(tab.url);
            const domain = url.hostname.replace('www.', '');
            const siteType = this.getSiteType(domain);
            
            if (siteType === 'neutral') return;
            
            const result = await chrome.storage.local.get(['focusCoins', 'todayCoins']);
            let currentCoins = result.focusCoins || 0;
            let todayCoins = result.todayCoins || 0;

            const now = Date.now();
            const timeDiff = now - this.lastUpdateTime;
            const intervalsElapsed = Math.floor(timeDiff / this.coinUpdateInterval);

            if (intervalsElapsed > 0) {
                let coinChange = 0;

                if (siteType === 'productive') {
                    coinChange = intervalsElapsed * 3;
                    currentCoins += coinChange;
                    todayCoins += coinChange;
                } else if (siteType === 'distracting') {
                    coinChange = intervalsElapsed * -4;
                    if (currentCoins > 0) {
                        currentCoins = Math.max(0, currentCoins + coinChange);
                    } else {
                        await this.blockSite(tab, domain);
                        return;
                    }
                }

                // Save locally
                await chrome.storage.local.set({
                    focusCoins: currentCoins,
                    todayCoins: todayCoins
                });

                // Add to heartbeat buffer
                this.addHeartbeat({
                    timestamp: now,
                    site: domain,
                    siteType: siteType,
                    action: siteType === 'productive' ? 'focus' : 'distract',
                    coinsChange: coinChange,
                    tabId: tab.id,
                    url: tab.url
                });

                // Notify popup
                try {
                    await chrome.runtime.sendMessage({
                        action: 'coinsUpdated',
                        coins: currentCoins,
                        change: coinChange,
                        siteType: siteType,
                        domain: domain
                    });
                } catch (error) {
                    // Popup closed, ignore
                }

                this.lastUpdateTime = now;
            }

        } catch (error) {
            console.error('Error updating coins:', error);
        }
    }

    addHeartbeat(data) {
        this.heartbeatBuffer.push({
            ...data,
            sessionId: this.sessionId
        });

        // Auto-sync if buffer is full
        if (this.heartbeatBuffer.length >= this.maxBufferSize) {
            this.syncHeartbeats();
        }
    }

    async syncHeartbeats() {
        if (this.heartbeatBuffer.length === 0) return;

        try {
            const response = await this.apiCall('/sessions/heartbeats', {
                uuid: this.uuid,
                heartbeats: this.heartbeatBuffer
            });

            if (response.success) {
                console.log(`Synced ${this.heartbeatBuffer.length} heartbeats`);
                this.heartbeatBuffer = [];
            }
        } catch (error) {
            console.error('Sync failed:', error);
            // Keep heartbeats for retry
        }
    }

    async apiCall(endpoint, data) {
        try {
            const response = await fetch(`${this.API_BASE}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
            return await response.json();
        } catch (error) {
            console.error('API call failed:', error);
            throw error;
        }
    }

    getSiteType(domain) {
        if (this.productiveSites.some(site => domain.includes(site))) {
            return 'productive';
        } else if (this.distractingSites.some(site => domain.includes(site))) {
            return 'distracting';
        } else {
            return 'neutral';
        }
    }

    async blockSite(tab, domain) {
        const blockingPageUrl = chrome.runtime.getURL('blocked.html') + '?site=' + encodeURIComponent(domain);
        try {
            await chrome.tabs.update(tab.id, { url: blockingPageUrl });
            console.log(`Blocked ${domain}`);
        } catch (error) {
            console.error('Error blocking site:', error);
        }
    }
}

// Initialize
const focusEngine = new FocusCoinEngine();