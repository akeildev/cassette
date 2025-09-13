require('dotenv').config();
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const configService = require('./services/ConfigService');
const settingsService = require('./services/SettingsService');
const LiveKitService = require('./services/LiveKitService');

let mainWindow;
let services = {};

// Initialize services
async function initializeServices() {
    try {
        console.log('[Main] Initializing services...');
        
        // Settings service is already a singleton instance
        services.settings = settingsService;
        await services.settings.initialize();
        
        // Initialize LiveKit service
        services.livekit = new LiveKitService(services.settings);
        const livekitReady = await services.livekit.initialize();
        
        if (!livekitReady) {
            console.warn('[Main] LiveKit service not fully configured');
            dialog.showErrorBox(
                'Configuration Required',
                'LiveKit API credentials are not configured. Please set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in your .env file.'
            );
        }
        
        console.log('[Main] Services initialized successfully');
        return true;
    } catch (error) {
        console.error('[Main] Failed to initialize services:', error);
        return false;
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 200,
        height: 70,
        x: 20,  // Position in top-left corner
        y: 20,
        webPreferences: {
            preload: path.join(__dirname, '../renderer/preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        frame: false,
        resizable: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        minimizable: false,
        maximizable: false,
        hasShadow: false
    });
    
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    
    // Platform-specific enhancements
    if (process.platform === 'darwin') {
        // macOS: appear on all spaces/desktops and over fullscreen apps
        mainWindow.setVisibleOnAllWorkspaces(true, {
            visibleOnFullScreen: true
        });
        
        // Use highest z-order level
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
    
    // Windows/Linux: periodically reassert always-on-top
    if (process.platform === 'win32' || process.platform === 'linux') {
        setInterval(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.setAlwaysOnTop(true);
            }
        }, 1000);
    }
    
    // Reinforce always-on-top when window is shown
    mainWindow.on('show', () => {
        if (process.platform === 'darwin') {
            mainWindow.setAlwaysOnTop(true, 'screen-saver');
        } else {
            mainWindow.setAlwaysOnTop(true);
        }
        mainWindow.focus();
    });
    
    // Prevent window from being hidden
    mainWindow.on('blur', () => {
        // Keep window on top even when it loses focus
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setAlwaysOnTop(true, process.platform === 'darwin' ? 'screen-saver' : 'floating');
        }
    });
}

// IPC Handlers for voice functionality
ipcMain.handle('voice:start', async () => {
    console.log('[IPC] Voice start requested');
    
    try {
        // Check if LiveKit is configured
        if (!services.livekit) {
            throw new Error('LiveKit service not initialized');
        }
        
        // Generate unique room name
        const roomName = `cassette-${Date.now()}`;
        const participantName = 'user';
        
        // Generate access token
        const token = await services.livekit.generateToken(roomName, participantName);
        
        // Get LiveKit configuration
        const config = services.settings.getLiveKitConfig();
        
        // Start the Python agent for this room
        const agentStarted = await services.livekit.startAgent(roomName);
        
        if (!agentStarted) {
            console.warn('[IPC] Agent failed to start, but continuing...');
        }
        
        // Send status update to renderer
        if (mainWindow) {
            mainWindow.webContents.send('voice:status', 'connecting');
        }
        
        return { 
            success: true,
            url: config.url,
            token: token,
            roomName: roomName
        };
    } catch (error) {
        console.error('[IPC] Failed to start voice:', error);
        
        if (mainWindow) {
            mainWindow.webContents.send('voice:error', {
                message: error.message
            });
        }
        
        return {
            success: false,
            error: error.message
        };
    }
});

ipcMain.handle('voice:stop', async () => {
    console.log('[IPC] Voice stop requested');
    
    try {
        if (services.livekit) {
            await services.livekit.stopAgent();
        }
        
        if (mainWindow) {
            mainWindow.webContents.send('voice:status', 'disconnected');
        }
        
        return { success: true };
    } catch (error) {
        console.error('[IPC] Failed to stop voice:', error);
        return {
            success: false,
            error: error.message
        };
    }
});

ipcMain.handle('voice:toggleMute', async () => {
    console.log('[IPC] Mute toggle requested');
    // This will be handled on the frontend via LiveKit client
    return { success: true };
});

ipcMain.handle('settings:get', async () => {
    return {
        theme: 'retro',
        autoStart: false,
        hotkey: 'Space'
    };
});

ipcMain.handle('settings:update', async (event, settings) => {
    console.log('Settings update:', settings);
    if (mainWindow) {
        mainWindow.webContents.send('settings:updated', settings);
    }
    return { success: true };
});

ipcMain.handle('window:close', async () => {
    if (mainWindow) {
        mainWindow.close();
    }
    return { success: true };
});

ipcMain.handle('window:minimize', async () => {
    // Instead of minimizing, we hide it since it's always-on-top
    if (mainWindow) {
        mainWindow.hide();
        // Show again after 2 seconds (or implement a hotkey to show)
        setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
            }
        }, 2000);
    }
    return { success: true };
});

ipcMain.handle('system:info', async () => {
    return {
        platform: process.platform,
        version: process.version,
        electron: process.versions.electron
    };
});

app.whenReady().then(async () => {
    console.log('[Main] Cassette Voice Assistant starting...');
    
    // Initialize services first
    await initializeServices();
    
    // Create the main window
    createWindow();
    
    // Setup event listeners for LiveKit service
    if (services.livekit) {
        services.livekit.on('agent:started', (data) => {
            console.log('[Main] Agent started:', data);
            if (mainWindow) {
                mainWindow.webContents.send('agent:message', { 
                    text: 'Voice assistant ready' 
                });
            }
        });
        
        services.livekit.on('agent:stopped', (data) => {
            console.log('[Main] Agent stopped:', data);
        });
        
        services.livekit.on('agent:error', (error) => {
            console.error('[Main] Agent error:', error);
            if (mainWindow) {
                mainWindow.webContents.send('voice:error', { 
                    message: error.message 
                });
            }
        });
    }
    
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Cleanup on quit
app.on('before-quit', async (event) => {
    console.log('[Main] Application shutting down...');
    
    // Stop any running agents
    if (services.livekit) {
        try {
            await services.livekit.stopAgent();
        } catch (error) {
            console.error('[Main] Error stopping agent:', error);
        }
    }
    
    // Clean up services
    if (services.settings) {
        services.settings.save();
    }
});