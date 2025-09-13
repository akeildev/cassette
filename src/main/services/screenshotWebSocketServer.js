const WebSocket = require('ws');
const desktopCaptureService = require('./desktopCaptureService');

/**
 * WebSocket Bridge for Screenshot Service
 * Provides a WebSocket server for Python agent to request screenshots
 * Based on clueless screenshotBridge implementation
 */
class ScreenshotBridge {
    constructor() {
        this.wss = null;
        this.port = 8765; // Use same port as clueless for consistency
        this.host = '127.0.0.1'; // Loopback only for security
        this.clients = new Set();
    }

    /**
     * Start the WebSocket server
     */
    async start() {
        try {
            this.wss = new WebSocket.Server({
                port: this.port,
                host: this.host
            });

            this.wss.on('connection', (ws, req) => {
                const clientIp = req.socket.remoteAddress;
                console.log(`[ScreenshotBridge] Client connected from ${clientIp}`);

                // Add to clients set
                this.clients.add(ws);

                // Handle messages
                ws.on('message', async (message) => {
                    try {
                        const request = JSON.parse(message.toString());
                        console.log('[ScreenshotBridge] Received request:', request.action);

                        if (request.action === 'capture_screenshot') {
                            const result = await this.handleScreenshotRequest(request);
                            ws.send(JSON.stringify(result));
                        } else if (request.action === 'ping') {
                            ws.send(JSON.stringify({ success: true, action: 'pong' }));
                        } else {
                            ws.send(JSON.stringify({
                                success: false,
                                error: `Unknown action: ${request.action}`
                            }));
                        }
                    } catch (error) {
                        console.error('[ScreenshotBridge] Error handling message:', error);
                        ws.send(JSON.stringify({
                            success: false,
                            error: error.message
                        }));
                    }
                });

                // Handle disconnection
                ws.on('close', () => {
                    console.log('[ScreenshotBridge] Client disconnected');
                    this.clients.delete(ws);
                });

                // Handle errors
                ws.on('error', (error) => {
                    console.error('[ScreenshotBridge] WebSocket error:', error);
                    this.clients.delete(ws);
                });
            });

            this.wss.on('error', (error) => {
                console.error('[ScreenshotBridge] Server error:', error);
            });

            console.log(`[ScreenshotBridge] WebSocket server running on ws://${this.host}:${this.port}`);
            return true;

        } catch (error) {
            console.error('[ScreenshotBridge] Failed to start server:', error);
            throw error;
        }
    }

    /**
     * Handle screenshot request
     */
    async handleScreenshotRequest(request) {
        try {
            const startTime = Date.now();

            // Initialize capture service if needed
            if (!desktopCaptureService.isInitialized) {
                console.log('[ScreenshotBridge] Initializing desktop capture service...');
                await desktopCaptureService.initialize();
            }

            // Capture screenshot with optimal settings for vision analysis
            const screenshotOptions = {
                quality: request.quality || 85,  // Balance quality/size
                maxWidth: request.maxWidth || 1920,
                maxHeight: request.maxHeight || 1080
            };

            // Support different regions if specified
            if (request.region === 'window') {
                // TODO: Implement window-specific capture
                screenshotOptions.sourceId = request.sourceId;
            }

            console.log('[ScreenshotBridge] Capturing screenshot with options:', screenshotOptions);
            const screenshot = await desktopCaptureService.captureScreenshot(screenshotOptions);

            if (screenshot.success) {
                const captureTime = Date.now() - startTime;
                console.log(`[ScreenshotBridge] Screenshot captured successfully in ${captureTime}ms`);

                return {
                    success: true,
                    base64: screenshot.base64,
                    metadata: {
                        width: screenshot.width,
                        height: screenshot.height,
                        captureTime: captureTime,
                        dataSize: screenshot.base64.length,
                        timestamp: Date.now()
                    }
                };
            } else {
                throw new Error(screenshot.error || 'Screenshot capture failed');
            }

        } catch (error) {
            console.error('[ScreenshotBridge] Screenshot capture error:', error);
            throw error;
        }
    }

    /**
     * Get server status
     */
    getStatus() {
        return {
            running: this.wss !== null,
            port: this.port,
            host: this.host,
            clients: this.clients.size
        };
    }

    /**
     * Stop the WebSocket server
     */
    stop() {
        if (this.wss) {
            console.log('[ScreenshotBridge] Stopping WebSocket server...');

            // Close all client connections
            for (const ws of this.clients) {
                ws.close();
            }
            this.clients.clear();

            // Close the server
            this.wss.close(() => {
                console.log('[ScreenshotBridge] WebSocket server stopped');
            });

            this.wss = null;
        }
    }
}

module.exports = new ScreenshotBridge();