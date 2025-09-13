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
            isMuted: false
        };
        
        // Animation interval
        this.animationInterval = null;
        
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
    
    
    toggleVoice() {
        // Simple toggle - if active, stop. If not, start.
        if (this.state.isVoiceActive) {
            this.stopVoice();
        } else {
            this.startVoice();
        }
    }
    
    startVoice() {
        // Don't start if already active
        if (this.state.isVoiceActive) return;
        
        // Set state and start animation
        this.state.isVoiceActive = true;
        this.setVoiceUI(true);
        this.simulateAudioLevels();
        this.updateStatus('connected', 'Listening');
        
        // Call backend if available (but don't wait for it)
        if (window.api) {
            window.api.startVoice().catch(err => 
                console.log('Backend call failed:', err)
            );
        }
    }
    
    stopVoice() {
        // Don't stop if not active
        if (!this.state.isVoiceActive) return;
        
        // Stop animation
        if (this.animationInterval) {
            clearInterval(this.animationInterval);
            this.animationInterval = null;
        }
        
        // Set state and stop animation
        this.state.isVoiceActive = false;
        this.setVoiceUI(false);
        this.updateStatus('ready', 'Ready');
        
        // Call backend if available (but don't wait for it)
        if (window.api) {
            window.api.stopVoice().catch(err => 
                console.log('Backend call failed:', err)
            );
        }
    }
    
    setVoiceUI(active) {
        if (active) {
            // Start recording state - just add spinning, not variable speeds
            this.elements.voiceButton?.classList.add('active', 'spinning');
            this.elements.muteButton?.classList.add('spinning');
            
            // Show audio LEDs
            const audioLeds = document.getElementById('audioLeds');
            if (audioLeds) {
                audioLeds.style.display = 'flex';
            }
            
            if (this.elements.voiceButton?.querySelector('.reel-text')) {
                this.elements.voiceButton.querySelector('.reel-text').textContent = 'STOP';
            }
        } else {
            // Stop recording state
            this.elements.voiceButton?.classList.remove('active', 'spinning');
            this.elements.muteButton?.classList.remove('spinning');
            
            // Hide audio LEDs and reset them
            const audioLeds = document.getElementById('audioLeds');
            if (audioLeds) {
                audioLeds.style.display = 'none';
                // Reset all LED states
                document.querySelectorAll('.audio-led').forEach(led => {
                    led.classList.remove('active', 'mid', 'high');
                });
            }
            
            if (this.elements.voiceButton?.querySelector('.reel-text')) {
                this.elements.voiceButton.querySelector('.reel-text').textContent = 'REC';
            }
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
    
    
    updateStatus(type, text) {
        if (this.elements.statusIndicator) {
            this.elements.statusIndicator.className = `status-indicator ${type}`;
        }
        
        if (this.elements.statusText) {
            this.elements.statusText.textContent = text;
        }
    }
    
    updateAudioLevel(level) {
        if (!this.state.isVoiceActive || this.state.isMuted) return;
        
        // Just update LED indicators, don't change spinning speed
        const leds = document.querySelectorAll('.audio-led');
        const activeLeds = Math.ceil(level * 5);
        
        leds.forEach((led, index) => {
            led.classList.remove('active', 'mid', 'high');
            
            if (index < activeLeds) {
                led.classList.add('active');
                
                if (index >= 3) {
                    led.classList.add('mid');
                }
                if (index >= 4) {
                    led.classList.remove('mid');
                    led.classList.add('high');
                }
            }
        });
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
    
    // Simulate audio levels for testing
    simulateAudioLevels() {
        if (!this.state.isVoiceActive) return;
        
        // Clear any existing interval first to prevent multiple
        if (this.animationInterval) {
            clearInterval(this.animationInterval);
            this.animationInterval = null;
        }
        
        this.animationInterval = setInterval(() => {
            if (!this.state.isVoiceActive) {
                clearInterval(this.animationInterval);
                this.animationInterval = null;
                return;
            }
            
            // Generate random audio level
            const level = Math.random() * 0.8 + 0.1;
            this.updateAudioLevel(level);
        }, 200);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.cassetteUI = new CassetteUI();
});