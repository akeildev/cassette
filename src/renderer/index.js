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
        
        // Audio elements for sound effects
        this.sounds = {
            start: new Audio('./sounds/Load Cassette Sound Effect.mp3'),
            stop: new Audio('./sounds/Cassette Sound Effects.mp3'),
            background: new Audio('./sounds/Cassette Sound Effect.mp3')
        };
        
        // Setup background sound to loop and be quiet
        this.sounds.background.loop = true;
        this.sounds.background.volume = 0.1; // Really soft volume
        
        // Preload sounds
        this.sounds.start.load();
        this.sounds.stop.load();
        this.sounds.background.load();
        
        // Initialize
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.setupIPCListeners();
        this.loadInitialState();
        
        // Initialize LiveKit if available
        if (window.LiveKitClient) {
            this.livekitClient = new window.LiveKitClient();
            this.setupLiveKitListeners();
        }
        
        // Test sound loading
        this.sounds.start.addEventListener('error', (e) => {
            console.error('Error loading start sound:', e);
        });
        this.sounds.stop.addEventListener('error', (e) => {
            console.error('Error loading stop sound:', e);
        });
        
        console.log('Cassette UI initialized');
    }
    
    setupLiveKitListeners() {
        if (!this.livekitClient) return;
        
        // Connection events
        this.livekitClient.on('connected', (data) => {
            console.log('LiveKit connected:', data);
            this.updateStatus('connected', 'Connected');
        });
        
        this.livekitClient.on('disconnected', () => {
            console.log('LiveKit disconnected');
            this.updateStatus('ready', 'Ready');
        });
        
        this.livekitClient.on('reconnecting', () => {
            this.updateStatus('connecting', 'Reconnecting');
        });
        
        this.livekitClient.on('reconnected', () => {
            this.updateStatus('connected', 'Connected');
        });
        
        // Audio level changes for real audio
        this.livekitClient.on('audioLevelChanged', (data) => {
            // Use real audio levels instead of simulated
            this.updateAudioLevel(data.level);
        });
        
        // Data messages for transcripts
        this.livekitClient.on('dataReceived', (data) => {
            console.log('Data received:', data);
            
            if (data.topic === 'transcript') {
                console.log('User:', data.data.text);
                // Could display this in UI
            } else if (data.topic === 'agent_message') {
                console.log('Assistant:', data.data.text);
                // Could display this in UI
            }
        });
        
        // Error handling
        this.livekitClient.on('error', (data) => {
            console.error('LiveKit error:', data);
            this.showError(data.message);
        });
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
            // Shift + ` to toggle voice
            if (e.shiftKey && e.code === 'Backquote') {
                e.preventDefault();
                this.toggleVoice();
            }
            
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
            console.log('Voice status update:', status);
            this.handleVoiceStatus(status);
        });
        
        // Voice transcripts
        window.api.on('voice:transcript', (data) => {
            console.log('Voice transcript:', data.text);
            // Update status to show we're listening
            if (this.state.isVoiceActive) {
                this.updateStatus('connected', 'Listening');
            }
        });
        
        // Agent responses
        window.api.on('voice:response', (data) => {
            console.log('Agent response:', data.text);
            // Update status to show agent is speaking
            if (this.state.isVoiceActive) {
                this.updateStatus('connected', 'Speaking');
                // Return to listening after a delay
                setTimeout(() => {
                    if (this.state.isVoiceActive) {
                        this.updateStatus('connected', 'Listening');
                    }
                }, 2000);
            }
        });
        
        // Agent messages
        window.api.on('agent:message', (data) => {
            console.log('Agent message:', data.text);
            // Could show toast notification
        });
        
        // Errors
        window.api.on('voice:error', (error) => {
            this.showError(error.message);
            console.error('Voice error:', error);
            // Stop voice on critical errors
            if (error.critical) {
                this.stopVoice();
            }
        });
        
        // Settings updates
        window.api.on('settings:updated', (settings) => {
            console.log('Settings updated:', settings);
        });
    }
    
    handleVoiceStatus(status) {
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
                this.updateStatus('ready', 'Ready');
                if (this.state.isVoiceActive) {
                    this.stopVoice();
                }
                break;
            case 'error':
                this.updateStatus('error', 'Error');
                break;
        }
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
    
    async startVoice() {
        // Don't start if already active
        if (this.state.isVoiceActive) return;
        
        // Play start sound
        this.sounds.start.play().catch(err => console.log('Could not play start sound:', err));
        
        // Start background sound looping softly
        this.sounds.background.play().catch(err => console.log('Could not play background sound:', err));
        
        // Set state and start animation with smooth transition
        this.state.isVoiceActive = true;
        this.updateStatus('connecting', 'Connecting');
        
        // Slightly longer delay for smoother transition
        setTimeout(() => {
            this.setVoiceUI(true);
            setTimeout(() => {
                this.simulateAudioLevels();
            }, 100);
        }, 100);
        
        // Call backend and handle real connection
        if (window.api) {
            try {
                const result = await window.api.startVoice();
                
                if (result.success) {
                    console.log('Voice started successfully:', result);
                    
                    // Update status
                    this.updateStatus('connected', 'Listening');
                    
                    // If LiveKit client is available, connect with real credentials
                    if (window.LiveKitClient && result.url && result.token) {
                        // Initialize LiveKit client if not already done
                        if (!this.livekitClient) {
                            this.livekitClient = new window.LiveKitClient();
                            this.setupLiveKitListeners();
                        }
                        
                        // Connect to LiveKit room
                        try {
                            await this.livekitClient.connect(
                                result.url,
                                result.token,
                                result.roomName
                            );
                            console.log('Connected to LiveKit room:', result.roomName);
                        } catch (err) {
                            console.error('Failed to connect to LiveKit:', err);
                            this.showError('Failed to connect to voice service');
                        }
                    }
                } else {
                    throw new Error(result.error || 'Failed to start voice');
                }
            } catch (err) {
                console.error('Failed to start voice:', err);
                this.showError(err.message);
                this.stopVoice();
            }
        }
    }
    
    async stopVoice() {
        // Don't stop if not active
        if (!this.state.isVoiceActive) return;
        
        // Stop background sound
        this.sounds.background.pause();
        this.sounds.background.currentTime = 0;
        
        // Play stop sound
        this.sounds.stop.play().catch(err => console.log('Could not play stop sound:', err));
        
        // Stop animation
        if (this.animationInterval) {
            clearInterval(this.animationInterval);
            this.animationInterval = null;
        }
        
        // Disconnect from LiveKit if connected
        if (this.livekitClient && this.livekitClient.isConnected) {
            try {
                await this.livekitClient.disconnect();
                console.log('Disconnected from LiveKit');
            } catch (err) {
                console.error('Error disconnecting from LiveKit:', err);
            }
        }
        
        // Set state and stop animation
        this.state.isVoiceActive = false;
        this.setVoiceUI(false);
        this.updateStatus('ready', 'Ready');
        
        // Call backend to stop agent
        if (window.api) {
            try {
                const result = await window.api.stopVoice();
                if (!result.success) {
                    console.error('Failed to stop voice:', result.error);
                }
            } catch (err) {
                console.error('Backend call failed:', err);
            }
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
            
            // Generate smoother random audio level
            const level = Math.random() * 0.6 + 0.2;
            this.updateAudioLevel(level);
        }, 300);  // Slower update for smoother effect
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.cassetteUI = new CassetteUI();
});