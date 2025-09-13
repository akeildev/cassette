const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

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
    console.log('Voice start requested');
    // Return mock data for testing
    return { 
        success: true,
        url: 'wss://example.livekit.cloud',
        token: 'mock_token',
        roomName: 'test-room'
    };
});

ipcMain.handle('voice:stop', async () => {
    console.log('Voice stop requested');
    return { success: true };
});

ipcMain.handle('voice:toggleMute', async () => {
    console.log('Mute toggle requested');
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

app.whenReady().then(() => {
    createWindow();
    
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

// Keep app running in background
app.on('before-quit', (event) => {
    // Optionally prevent quit to keep overlay always available
    // event.preventDefault();
});