const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 200,
        height: 60,
        webPreferences: {
            preload: path.join(__dirname, 'src/renderer/preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        frame: false,
        resizable: false,
        transparent: true,
        alwaysOnTop: true,
        hasShadow: false
    });
    
    mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    
    // Log when page loads
    mainWindow.webContents.once('did-finish-load', () => {
        console.log('Page loaded successfully');
        
        // Check if elements exist and add click listeners
        mainWindow.webContents.executeJavaScript(`
            console.log('Voice button:', document.getElementById('voiceButton'));
            console.log('Mute button:', document.getElementById('muteButton'));
            console.log('CassetteUI:', window.cassetteUI);
            
            // Test button clicks manually
            const voiceBtn = document.getElementById('voiceButton');
            const muteBtn = document.getElementById('muteButton');
            
            if (voiceBtn) {
                console.log('Voice button found, adding test listener');
                voiceBtn.addEventListener('click', () => console.log('VOICE BUTTON CLICKED!'));
            }
            
            if (muteBtn) {
                console.log('Mute button found, adding test listener');
                muteBtn.addEventListener('click', () => console.log('MUTE BUTTON CLICKED!'));
            }
        `);
    });
    
    // Handle window close from renderer
    mainWindow.webContents.on('before-input-event', (event, input) => {
        // Handle close button or allow window.close()
    });
}

// Mock IPC handlers for testing all JS functionality
ipcMain.handle('voice:start', async () => {
    console.log('[Mock] Voice start requested');
    
    // Simulate connection process
    setTimeout(() => {
        mainWindow.webContents.send('voice:status', 'connecting');
    }, 100);
    
    setTimeout(() => {
        mainWindow.webContents.send('voice:status', 'connected');
    }, 800);
    
    setTimeout(() => {
        mainWindow.webContents.send('voice:status', 'listening');
    }, 1200);
    
    // Simulate voice transcript
    setTimeout(() => {
        mainWindow.webContents.send('voice:transcript', {
            text: 'Hello, can you help me?',
            timestamp: Date.now()
        });
    }, 3000);
    
    // Simulate agent response
    setTimeout(() => {
        mainWindow.webContents.send('voice:response', {
            text: 'Of course! I\'m here to help. What do you need assistance with?',
            timestamp: Date.now()
        });
    }, 4000);
    
    return { success: true };
});

ipcMain.handle('voice:stop', async () => {
    console.log('[Mock] Voice stop requested');
    
    setTimeout(() => {
        mainWindow.webContents.send('voice:status', 'disconnected');
    }, 200);
    
    return { success: true };
});

ipcMain.handle('voice:toggleMute', async () => {
    console.log('[Mock] Mute toggle requested');
    return { success: true };
});

ipcMain.handle('settings:get', async () => {
    console.log('[Mock] Settings requested');
    return {
        theme: 'dark',
        autoStart: false,
        hotkey: 'Space'
    };
});

ipcMain.handle('settings:update', async (event, settings) => {
    console.log('[Mock] Settings update requested:', settings);
    
    // Simulate settings updated event
    setTimeout(() => {
        mainWindow.webContents.send('settings:updated', settings);
    }, 100);
    
    return { success: true };
});

ipcMain.handle('window:close', async () => {
    console.log('[Mock] Window close requested');
    mainWindow.close();
    return { success: true };
});

ipcMain.handle('window:minimize', async () => {
    console.log('[Mock] Window minimize requested');
    mainWindow.minimize();
    return { success: true };
});

ipcMain.handle('system:info', async () => {
    console.log('[Mock] System info requested');
    return {
        platform: process.platform,
        version: process.version,
        electron: process.versions.electron
    };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});