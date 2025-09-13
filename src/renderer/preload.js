const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
    // Voice control
    startVoice: () => ipcRenderer.invoke('voice:start'),
    stopVoice: () => ipcRenderer.invoke('voice:stop'),
    toggleMute: () => ipcRenderer.invoke('voice:toggleMute'),
    
    // Settings
    getSettings: () => ipcRenderer.invoke('settings:get'),
    updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
    
    // Window control
    minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
    closeWindow: () => ipcRenderer.invoke('window:close'),
    
    // System info
    getSystemInfo: () => ipcRenderer.invoke('system:info'),
    
    // Event listeners
    on: (channel, callback) => {
        const validChannels = [
            'voice:status',
            'voice:transcript',
            'voice:response',
            'voice:error',
            'settings:updated',
            'agent:message',
            'cassette:ready'
        ];
        
        if (validChannels.includes(channel)) {
            // Deliberately strip event as it includes `sender`
            const subscription = (event, ...args) => callback(...args);
            ipcRenderer.on(channel, subscription);
            
            // Return unsubscribe function
            return () => {
                ipcRenderer.removeListener(channel, subscription);
            };
        }
    },
    
    // One-time event listeners
    once: (channel, callback) => {
        const validChannels = [
            'voice:ready',
            'voice:connected',
            'voice:disconnected',
            'cassette:initialized'
        ];
        
        if (validChannels.includes(channel)) {
            ipcRenderer.once(channel, (event, ...args) => callback(...args));
        }
    },
    
    // Remove all listeners for a channel
    removeAllListeners: (channel) => {
        const validChannels = [
            'voice:status',
            'voice:transcript',
            'voice:response',
            'voice:error',
            'settings:updated',
            'agent:message'
        ];
        
        if (validChannels.includes(channel)) {
            ipcRenderer.removeAllListeners(channel);
        }
    }
});

// Log that preload script is loaded
console.log('Cassette preload script loaded successfully');