/**
 * Screenshot Client for Cassette Voice Overlay
 * Handles screenshot capture requests via WebSocket
 */

class ScreenshotClient {
    constructor() {
        this.ws = null;
        this.wsUrl = 'ws://127.0.0.1:8765';
        this.isConnected = false;
        this.reconnectInterval = null;
        this.reconnectDelay = 5000;
        this.eventHandlers = new Map();
    }
    
    async connect() {
        if (this.isConnected) {
            console.log('Screenshot client already connected');
            return true;
        }
        
        try {
            console.log('Connecting to screenshot service...');
            
            this.ws = new WebSocket(this.wsUrl);
            
            // Set up WebSocket event handlers
            this.ws.onopen = () => {
                console.log('Screenshot service connected');
                this.isConnected = true;
                this.emit('connected');
                
                // Clear reconnect interval if exists
                if (this.reconnectInterval) {
                    clearInterval(this.reconnectInterval);
                    this.reconnectInterval = null;
                }
            };
            
            this.ws.onclose = () => {
                console.log('Screenshot service disconnected');
                this.isConnected = false;
                this.emit('disconnected');
                
                // Start reconnection attempts
                this.startReconnection();
            };
            
            this.ws.onerror = (error) => {
                console.error('Screenshot service error:', error);
                this.emit('error', { message: 'WebSocket error' });
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('Failed to parse screenshot service message:', error);
                }
            };
            
            // Wait for connection
            return await this.waitForConnection();
            
        } catch (error) {
            console.error('Failed to connect to screenshot service:', error);
            this.startReconnection();
            return false;
        }
    }
    
    async waitForConnection(timeout = 5000) {
        return new Promise((resolve) => {
            const checkConnection = () => {
                if (this.isConnected) {
                    resolve(true);
                    return;
                }
                
                timeout -= 100;
                if (timeout <= 0) {
                    resolve(false);
                    return;
                }
                
                setTimeout(checkConnection, 100);
            };
            
            checkConnection();
        });
    }
    
    startReconnection() {
        if (this.reconnectInterval) return;
        
        console.log('Starting screenshot service reconnection...');
        
        this.reconnectInterval = setInterval(() => {
            if (!this.isConnected) {
                console.log('Attempting to reconnect to screenshot service...');
                this.connect();
            } else {
                clearInterval(this.reconnectInterval);
                this.reconnectInterval = null;
            }
        }, this.reconnectDelay);
    }
    
    async captureScreenshot(region = 'full') {
        if (!this.isConnected) {
            console.warn('Screenshot service not connected');
            
            // Try to connect first
            const connected = await this.connect();
            if (!connected) {
                throw new Error('Screenshot service unavailable');
            }
        }
        
        return new Promise((resolve, reject) => {
            const requestId = this.generateRequestId();
            
            // Set up response handler
            const responseHandler = (data) => {
                if (data.requestId === requestId) {
                    this.off('screenshot', responseHandler);
                    
                    if (data.success) {
                        resolve(data.base64);
                    } else {
                        reject(new Error(data.error || 'Screenshot capture failed'));
                    }
                }
            };
            
            this.on('screenshot', responseHandler);
            
            // Send capture request
            this.send({
                action: 'capture_screenshot',
                region: region,
                requestId: requestId
            });
            
            // Timeout after 10 seconds
            setTimeout(() => {
                this.off('screenshot', responseHandler);
                reject(new Error('Screenshot capture timeout'));
            }, 10000);
        });
    }
    
    handleMessage(data) {
        console.log('Screenshot service message:', data);
        
        switch (data.type) {
            case 'screenshot':
                this.emit('screenshot', data);
                break;
                
            case 'status':
                this.emit('status', data);
                break;
                
            case 'error':
                this.emit('error', data);
                break;
                
            default:
                console.log('Unknown message type:', data.type);
        }
    }
    
    send(data) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('Cannot send message: WebSocket not connected');
            return false;
        }
        
        try {
            this.ws.send(JSON.stringify(data));
            return true;
        } catch (error) {
            console.error('Failed to send message:', error);
            return false;
        }
    }
    
    disconnect() {
        if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
        }
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        this.isConnected = false;
    }
    
    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // Event emitter pattern
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
        
        return () => this.off(event, handler);
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
}

// Export for use
window.ScreenshotClient = ScreenshotClient;