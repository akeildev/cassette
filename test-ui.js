const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 320,
        height: 120,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        frame: false,
        resizable: false,
        backgroundColor: '#1a1a1a'
    });
    
    mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    
    // Handle window close from renderer
    mainWindow.webContents.on('before-input-event', (event, input) => {
        // Handle close button or allow window.close()
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});