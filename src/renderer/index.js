/**
 * Cassette Voice Overlay - Frontend UI Logic
 * Handles all UI interactions and state management
 */

class CassetteUI {
    constructor() {
        // DOM Elements
        this.elements = {
            // Status
            statusIndicator: document.getElementById('statusIndicator'),
            statusDot: document.querySelector('.status-dot'),
            statusText: document.querySelector('.status-text'),
            
            // Controls
            voiceButton: document.getElementById('voiceButton'),
            muteButton: document.getElementById('muteButton'),
            muteText: document.getElementById('muteText'),
            closeButton: document.getElementById('closeButton')
        };
        
        // State
        this.state = {
            isVoiceActive: false,
            isMuted: false,
            isConnected: false,
            currentStatus: 'ready'
        };
        
        // Initialize
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.setupIPCListeners();
        this.loadInitialState();
        console.log('Cassette UI initialized');
    }
    
    setupEventListeners() {
        // Voice button
        if (this.elements.voiceButton) {
            this.elements.voiceButton.addEventListener('click', () => {
                this.toggleVoice();
            });
        }
        
        // Mute button
        if (this.elements.muteButton) {
            this.elements.muteButton.addEventListener('click', () => {
                this.toggleMute();
            });
        }
        
        // Close button
        if (this.elements.closeButton) {
            this.elements.closeButton.addEventListener('click', () => {
                this.closeWindow();
            });
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Spacebar to toggle voice (when not typing)
            if (e.code === 'Space' && e.target === document.body) {
                e.preventDefault();
                this.toggleVoice();
            }
            
            // Escape to stop voice
            if (e.code === 'Escape' && this.state.isVoiceActive) {
                this.stopVoice();
            }
            
            // Cmd/Ctrl+M to toggle mute
            if ((e.metaKey || e.ctrlKey) && e.code === 'KeyM') {
                e.preventDefault();
                this.toggleMute();
            }
            
            // Cmd/Ctrl+W to close
            if ((e.metaKey || e.ctrlKey) && e.code === 'KeyW') {
                e.preventDefault();
                this.closeWindow();
            }
        });
    }
    
    setupIPCListeners() {
        if (!window.api) {
            console.warn('API not available - running in test mode');
            return;
        }
        
        // Voice status updates
        window.api.on('voice:status', (status) => {
            this.updateVoiceStatus(status);
        });
        
        // Voice transcripts
        window.api.on('voice:transcript', (data) => {
            console.log('Voice transcript:', data.text);
            // Could add visual feedback here
        });
        
        // Agent responses
        window.api.on('voice:response', (data) => {
            console.log('Agent response:', data.text);
            // Could add visual feedback here
        });
        
        // Agent messages
        window.api.on('agent:message', (data) => {
            console.log('Agent message:', data.text);
        });
        
        // Errors
        window.api.on('voice:error', (error) => {
            this.showError(error.message);
            console.error('Voice error:', error);
        });
        
        // Settings updates
        window.api.on('settings:updated', (settings) => {
            console.log('Settings updated:', settings);
        });
    }
    
    async loadInitialState() {
        try {
            if (window.api) {
                // Get settings from backend
                const settings = await window.api.getSettings();
                if (settings) {
                    // Apply any relevant settings
                    console.log('Settings loaded:', settings);
                }
                
                // Get system info
                const systemInfo = await window.api.getSystemInfo();
                if (systemInfo) {
                    console.log('System info:', systemInfo);
                }
            }
        } catch (error) {
            console.error('Failed to load initial state:', error);
        }
    }
    
    async toggleVoice() {
        if (this.state.isVoiceActive) {
            await this.stopVoice();
        } else {
            await this.startVoice();
        }
    }
    
    async startVoice() {
        try {
            // Update UI immediately
            this.setVoiceActive(true);
            this.updateStatus('connecting', 'Connecting');
            
            if (window.api) {
                // Call backend
                const result = await window.api.startVoice();
                
                if (result.success) {
                    console.log('Voice started successfully:', result);
                    this.updateStatus('connected', 'Connected');
                } else {
                    throw new Error(result.error || 'Failed to start voice');
                }
            } else {
                // Test mode - simulate connection
                setTimeout(() => {
                    this.updateStatus('connected', 'Connected');
                }, 1000);
            }
        } catch (error) {
            console.error('Failed to start voice:', error);
            this.setVoiceActive(false);
            this.showError(error.message);
        }
    }
    
    async stopVoice() {
        try {
            // Update UI immediately
            this.setVoiceActive(false);
            
            if (window.api) {
                // Call backend
                const result = await window.api.stopVoice();
                
                if (result.success) {
                    console.log('Voice stopped successfully');
                    this.updateStatus('ready', 'Ready');
                } else {
                    throw new Error(result.error || 'Failed to stop voice');
                }
            } else {
                // Test mode
                this.updateStatus('ready', 'Ready');
            }
        } catch (error) {
            console.error('Failed to stop voice:', error);
            this.showError(error.message);
        }
    }
    
    setVoiceActive(active) {
        this.state.isVoiceActive = active;
        
        if (active) {
            // Start recording state
            this.elements.voiceButton?.classList.add('active');
            if (this.elements.voiceButton?.querySelector('.reel-text')) {
                this.elements.voiceButton.querySelector('.reel-text').textContent = 'STOP';
            }
            
            console.log('Voice activated');
        } else {
            // Stop recording state
            this.elements.voiceButton?.classList.remove('active');
            if (this.elements.voiceButton?.querySelector('.reel-text')) {
                this.elements.voiceButton.querySelector('.reel-text').textContent = 'REC';
            }
            
            console.log('Voice deactivated');
        }
    }
    
    async toggleMute() {
        try {
            const newMutedState = !this.state.isMuted;
            
            if (window.api) {
                // Call backend
                const result = await window.api.toggleMute();
                
                if (result.success) {
                    this.setMuted(newMutedState);
                } else {
                    throw new Error(result.error || 'Failed to toggle mute');
                }
            } else {
                // Test mode
                this.setMuted(newMutedState);
            }
        } catch (error) {
            console.error('Failed to toggle mute:', error);
            this.showError(error.message);
        }
    }
    
    setMuted(muted) {
        this.state.isMuted = muted;
        
        if (muted) {
            this.elements.muteText.textContent = 'MUTED';
            this.elements.muteButton?.classList.add('active');
        } else {
            this.elements.muteText.textContent = 'MUTE';
            this.elements.muteButton?.classList.remove('active');
        }
        
        console.log('Mute toggled:', muted);
    }
    
    async closeWindow() {
        try {
            if (window.api) {
                await window.api.closeWindow();
            } else {
                // Test mode
                if (window.close) {
                    window.close();
                }
            }
        } catch (error) {
            console.error('Failed to close window:', error);
        }
    }
    
    updateVoiceStatus(status) {
        this.state.currentStatus = status;
        
        switch (status) {
            case 'connecting':
                this.updateStatus('connecting', 'Connecting');
                break;
            case 'connected':
                this.updateStatus('connected', 'Connected');
                break;
            case 'listening':
                this.updateStatus('connected', 'Listening');
                break;
            case 'processing':
                this.updateStatus('connected', 'Processing');
                break;
            case 'speaking':
                this.updateStatus('connected', 'Speaking');
                break;
            case 'disconnected':
                this.setVoiceActive(false);
                this.updateStatus('ready', 'Ready');
                break;
            case 'error':
                this.setVoiceActive(false);
                this.updateStatus('error', 'Error');
                break;
        }
    }
    
    updateStatus(type, text) {
        if (this.elements.statusIndicator) {
            this.elements.statusIndicator.className = `status-indicator ${type}`;
        }
        
        if (this.elements.statusText) {
            this.elements.statusText.textContent = text;
        }
    }
    
    showError(message) {
        this.updateStatus('error', 'Error');
        
        // Show error notification (could be enhanced with a toast)
        console.error('Error:', message);
        
        // Reset status after 3 seconds
        setTimeout(() => {
            if (!this.state.isVoiceActive) {
                this.updateStatus('ready', 'Ready');
            }
        }, 3000);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.cassetteUI = new CassetteUI();
});