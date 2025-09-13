const { BrowserWindow, screen } = require('electron');
const path = require('path');

/**
 * WindowService - Manages application windows
 */
class WindowService {
    constructor() {
        this.windows = new Map();
        this.mainWindowId = null;
    }

    /**
     * Create the main application window
     */
    createMainWindow(options = {}) {
        const defaultOptions = {
            width: 380,
            height: 500,
            minWidth: 320,
            minHeight: 400,
            frame: true,
            transparent: false,
            backgroundColor: '#f5f5f5',
            resizable: true,
            alwaysOnTop: true,
            titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, '../../renderer/preload.js'),
                webSecurity: true,
                backgroundThrottling: false
            }
        };
        
        const windowOptions = { ...defaultOptions, ...options };
        
        // Position window in top-right corner
        if (!windowOptions.x || !windowOptions.y) {
            const display = screen.getPrimaryDisplay();
            const { width, height } = display.workAreaSize;
            
            // Position in top-right corner with margin
            windowOptions.x = width - windowOptions.width - 20;
            windowOptions.y = 50;
        }
        
        const window = new BrowserWindow(windowOptions);
        
        // Store window reference
        const id = window.id;
        this.windows.set(id, window);
        this.mainWindowId = id;
        
        // Track window state changes
        this.setupWindowEventHandlers(window);
        
        // Clean up on close
        window.on('closed', () => {
            this.windows.delete(id);
            if (this.mainWindowId === id) {
                this.mainWindowId = null;
            }
        });
        
        console.log(`[WindowService] Created main window with ID: ${id}`);
        return window;
    }

    /**
     * Setup window event handlers
     */
    setupWindowEventHandlers(window) {
        // Track position changes
        let saveTimer = null;
        
        window.on('moved', () => {
            // Debounce position saving
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                this.saveWindowState(window);
            }, 500);
        });
        
        window.on('resized', () => {
            // Debounce size saving
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                this.saveWindowState(window);
            }, 500);
        });
        
        // Prevent window from being hidden completely
        window.on('minimize', (event) => {
            if (process.platform === 'darwin') {
                // On macOS, hide to dock instead of minimize
                window.hide();
                event.preventDefault();
            }
        });
        
        // Handle window focus
        window.on('focus', () => {
            console.log('[WindowService] Window focused');
        });
        
        window.on('blur', () => {
            console.log('[WindowService] Window blurred');
        });
    }

    /**
     * Save window state to settings
     */
    saveWindowState(window) {
        if (!window || window.isDestroyed()) return;
        
        try {
            const bounds = window.getBounds();
            const SettingsService = require('./SettingsService');
            
            SettingsService.saveWindowState({
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height
            });
            
            console.log('[WindowService] Window state saved');
        } catch (error) {
            console.error('[WindowService] Failed to save window state:', error);
        }
    }

    /**
     * Restore window position and size from settings
     */
    restoreWindowState(window) {
        try {
            const SettingsService = require('./SettingsService');
            const windowSettings = SettingsService.getWindowSettings();
            
            if (windowSettings.position && windowSettings.size) {
                // Verify position is still valid (monitor might have changed)
                const displays = screen.getAllDisplays();
                const inBounds = displays.some(display => {
                    const { x, y, width, height } = display.bounds;
                    return windowSettings.position.x >= x &&
                           windowSettings.position.x < x + width &&
                           windowSettings.position.y >= y &&
                           windowSettings.position.y < y + height;
                });
                
                if (inBounds) {
                    window.setBounds({
                        x: windowSettings.position.x,
                        y: windowSettings.position.y,
                        width: windowSettings.size.width,
                        height: windowSettings.size.height
                    });
                    console.log('[WindowService] Window state restored');
                } else {
                    console.log('[WindowService] Saved position out of bounds, using defaults');
                }
            }
        } catch (error) {
            console.error('[WindowService] Failed to restore window state:', error);
        }
    }

    /**
     * Get window by ID
     */
    getWindow(id) {
        return this.windows.get(id);
    }

    /**
     * Get main window
     */
    getMainWindow() {
        return this.mainWindowId ? this.windows.get(this.mainWindowId) : null;
    }

    /**
     * Get all windows
     */
    getAllWindows() {
        return Array.from(this.windows.values());
    }

    /**
     * Close all windows
     */
    closeAllWindows() {
        this.windows.forEach(window => {
            if (!window.isDestroyed()) {
                window.close();
            }
        });
        this.windows.clear();
    }

    /**
     * Send message to renderer
     */
    sendToRenderer(channel, data, windowId = null) {
        const window = windowId ? this.getWindow(windowId) : this.getMainWindow();
        
        if (window && !window.isDestroyed()) {
            window.webContents.send(channel, data);
            return true;
        }
        
        return false;
    }

    /**
     * Toggle always on top
     */
    toggleAlwaysOnTop(windowId = null) {
        const window = windowId ? this.getWindow(windowId) : this.getMainWindow();
        
        if (window && !window.isDestroyed()) {
            const current = window.isAlwaysOnTop();
            window.setAlwaysOnTop(!current);
            return !current;
        }
        
        return false;
    }
}

// Export singleton instance
module.exports = new WindowService();