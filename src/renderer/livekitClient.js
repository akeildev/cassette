/**
 * LiveKit Client for Cassette Voice Overlay
 * Handles WebRTC connection, audio streaming, and real-time communication
 */

class LiveKitClient {
    constructor() {
        this.room = null;
        this.localParticipant = null;
        this.remoteParticipants = new Map();
        this.audioTrack = null;
        this.isConnected = false;
        this.isMuted = false;
        this.eventHandlers = new Map();
        
        // Audio level monitoring
        this.audioLevel = 0;
        this.audioLevelInterval = null;
        
        // Initialize when LiveKit SDK is loaded
        this.sdkLoaded = false;
        this.initPromise = this.waitForSDK();
    }
    
    async waitForSDK() {
        // Wait for LiveKit SDK to be loaded from CDN
        return new Promise((resolve) => {
            const checkSDK = () => {
                if (window.LivekitClient) {
                    console.log('LiveKit SDK loaded');
                    this.sdkLoaded = true;
                    resolve();
                } else {
                    setTimeout(checkSDK, 100);
                }
            };
            checkSDK();
        });
    }
    
    async connect(url, token, roomName) {
        await this.initPromise;
        
        try {
            console.log(`Connecting to LiveKit room: ${roomName}`);
            
            // Create room instance
            this.room = new window.LivekitClient.Room({
                adaptiveStream: true,
                dynacast: true,
                videoCaptureDefaults: {
                    resolution: window.LivekitClient.VideoPresets.h720.resolution,
                },
                publishDefaults: {
                    simulcast: false,
                    stopMicTrackOnMute: false,
                },
                disconnectOnPageLeave: true,
            });
            
            // Set up event listeners before connecting
            this.setupRoomEventListeners();
            
            // Connect to room
            await this.room.connect(url, token, {
                autoSubscribe: true,
            });
            
            this.isConnected = true;
            console.log('Successfully connected to LiveKit room');
            
            // Enable microphone
            await this.enableMicrophone();
            
            // Start audio level monitoring
            this.startAudioLevelMonitoring();
            
            // Emit connected event
            this.emit('connected', { roomName });
            
            return true;
        } catch (error) {
            console.error('Failed to connect to LiveKit:', error);
            this.emit('error', { message: error.message });
            throw error;
        }
    }
    
    async disconnect() {
        console.log('Disconnecting from LiveKit');
        
        try {
            // Stop audio level monitoring
            this.stopAudioLevelMonitoring();
            
            // Disable tracks
            if (this.audioTrack) {
                await this.room?.localParticipant?.unpublishTrack(this.audioTrack);
                this.audioTrack.stop();
                this.audioTrack = null;
            }
            
            // Disconnect from room
            if (this.room) {
                await this.room.disconnect();
                this.room = null;
            }
            
            this.isConnected = false;
            this.emit('disconnected');
            
            console.log('Disconnected from LiveKit');
        } catch (error) {
            console.error('Error during disconnect:', error);
        }
    }
    
    async enableMicrophone() {
        if (!this.room || !this.isConnected) {
            throw new Error('Not connected to room');
        }
        
        try {
            console.log('Enabling microphone...');
            
            // Create and publish audio track
            this.audioTrack = await window.LivekitClient.createLocalAudioTrack({
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            });
            
            await this.room.localParticipant.publishTrack(this.audioTrack);
            
            console.log('Microphone enabled and published');
            this.emit('microphoneEnabled');
            
            return true;
        } catch (error) {
            console.error('Failed to enable microphone:', error);
            this.emit('error', { message: 'Microphone access denied' });
            throw error;
        }
    }
    
    async setMuted(muted) {
        if (!this.audioTrack) {
            console.warn('No audio track to mute/unmute');
            return false;
        }
        
        try {
            if (muted) {
                await this.audioTrack.mute();
            } else {
                await this.audioTrack.unmute();
            }
            
            this.isMuted = muted;
            console.log(`Microphone ${muted ? 'muted' : 'unmuted'}`);
            this.emit('muteChanged', { muted });
            
            return true;
        } catch (error) {
            console.error('Failed to change mute state:', error);
            return false;
        }
    }
    
    setupRoomEventListeners() {
        if (!this.room) return;
        
        // Room events
        this.room.on('connected', () => {
            console.log('Room connected event');
            this.localParticipant = this.room.localParticipant;
        });
        
        this.room.on('disconnected', (reason) => {
            console.log('Room disconnected:', reason);
            this.isConnected = false;
            this.emit('disconnected', { reason });
        });
        
        this.room.on('reconnecting', () => {
            console.log('Room reconnecting...');
            this.emit('reconnecting');
        });
        
        this.room.on('reconnected', () => {
            console.log('Room reconnected');
            this.emit('reconnected');
        });
        
        // Participant events
        this.room.on('participantConnected', (participant) => {
            console.log('Participant connected:', participant.identity);
            this.remoteParticipants.set(participant.sid, participant);
            this.emit('participantConnected', { participant: participant.identity });
        });
        
        this.room.on('participantDisconnected', (participant) => {
            console.log('Participant disconnected:', participant.identity);
            this.remoteParticipants.delete(participant.sid);
            this.emit('participantDisconnected', { participant: participant.identity });
        });
        
        // Track events
        this.room.on('trackSubscribed', (track, publication, participant) => {
            console.log('Track subscribed:', track.kind, 'from', participant.identity);
            
            if (track.kind === 'audio') {
                // Attach audio track to audio element for playback
                const audioElement = track.attach();
                audioElement.style.display = 'none';
                document.body.appendChild(audioElement);
                
                this.emit('audioTrackSubscribed', { 
                    participant: participant.identity,
                    trackSid: track.sid 
                });
            }
        });
        
        this.room.on('trackUnsubscribed', (track, publication, participant) => {
            console.log('Track unsubscribed:', track.kind, 'from', participant.identity);
            
            if (track.kind === 'audio') {
                track.detach().forEach(element => element.remove());
                
                this.emit('audioTrackUnsubscribed', { 
                    participant: participant.identity,
                    trackSid: track.sid 
                });
            }
        });
        
        // Data messages
        this.room.on('dataReceived', (payload, participant, _, topic) => {
            const decoder = new TextDecoder();
            const message = decoder.decode(payload);
            
            console.log('Data received from', participant?.identity, 'topic:', topic, 'message:', message);
            
            try {
                const data = JSON.parse(message);
                this.emit('dataReceived', { 
                    data,
                    participant: participant?.identity,
                    topic 
                });
            } catch (e) {
                // Handle non-JSON messages
                this.emit('dataReceived', { 
                    data: message,
                    participant: participant?.identity,
                    topic 
                });
            }
        });
        
        // Speaking indicators
        this.room.on('activeSpeakersChanged', (speakers) => {
            const speakerIdentities = speakers.map(s => s.identity);
            console.log('Active speakers:', speakerIdentities);
            this.emit('activeSpeakersChanged', { speakers: speakerIdentities });
        });
        
        // Connection quality
        this.room.on('connectionQualityChanged', (quality, participant) => {
            console.log(`Connection quality for ${participant.identity}: ${quality}`);
            this.emit('connectionQualityChanged', { 
                quality,
                participant: participant.identity 
            });
        });
    }
    
    startAudioLevelMonitoring() {
        if (this.audioLevelInterval) return;
        
        this.audioLevelInterval = setInterval(() => {
            if (this.audioTrack && !this.isMuted) {
                // Get audio level from track statistics
                const audioLevel = this.getAudioLevel();
                if (audioLevel !== this.audioLevel) {
                    this.audioLevel = audioLevel;
                    this.emit('audioLevelChanged', { level: audioLevel });
                }
            }
        }, 100);
    }
    
    stopAudioLevelMonitoring() {
        if (this.audioLevelInterval) {
            clearInterval(this.audioLevelInterval);
            this.audioLevelInterval = null;
        }
    }
    
    getAudioLevel() {
        if (!this.audioTrack || this.isMuted) return 0;
        
        // Access the underlying MediaStreamTrack
        const mediaTrack = this.audioTrack.mediaStreamTrack;
        if (!mediaTrack) return 0;
        
        // Get audio level from track (this is a simplified version)
        // In production, you'd use Web Audio API for accurate levels
        return Math.random() * 0.5 + (this.isMuted ? 0 : 0.3);
    }
    
    async sendData(data, options = {}) {
        if (!this.room || !this.isConnected) {
            console.warn('Cannot send data: not connected');
            return false;
        }
        
        try {
            const encoder = new TextEncoder();
            const payload = encoder.encode(JSON.stringify(data));
            
            await this.room.localParticipant.publishData(
                payload,
                {
                    reliable: options.reliable !== false,
                    topic: options.topic,
                    destination: options.destination
                }
            );
            
            return true;
        } catch (error) {
            console.error('Failed to send data:', error);
            return false;
        }
    }
    
    // Event emitter pattern
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
        
        // Return unsubscribe function
        return () => {
            const handlers = this.eventHandlers.get(event);
            if (handlers) {
                const index = handlers.indexOf(handler);
                if (index > -1) {
                    handlers.splice(index, 1);
                }
            }
        };
    }
    
    off(event, handler) {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            if (handler) {
                const index = handlers.indexOf(handler);
                if (index > -1) {
                    handlers.splice(index, 1);
                }
            } else {
                // Remove all handlers for this event
                this.eventHandlers.delete(event);
            }
        }
    }
    
    emit(event, data) {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`Error in event handler for ${event}:`, error);
                }
            });
        }
    }
    
    // Utility methods
    getRoomInfo() {
        if (!this.room) return null;
        
        return {
            name: this.room.name,
            sid: this.room.sid,
            participantCount: this.remoteParticipants.size + 1,
            isConnected: this.isConnected,
            isMuted: this.isMuted,
            connectionState: this.room.state,
        };
    }
    
    getParticipants() {
        const participants = [];
        
        if (this.localParticipant) {
            participants.push({
                sid: this.localParticipant.sid,
                identity: this.localParticipant.identity,
                isLocal: true,
                isSpeaking: this.localParticipant.isSpeaking,
                connectionQuality: this.localParticipant.connectionQuality,
            });
        }
        
        this.remoteParticipants.forEach(participant => {
            participants.push({
                sid: participant.sid,
                identity: participant.identity,
                isLocal: false,
                isSpeaking: participant.isSpeaking,
                connectionQuality: participant.connectionQuality,
            });
        });
        
        return participants;
    }
}

// Export for use in main UI
window.LiveKitClient = LiveKitClient;