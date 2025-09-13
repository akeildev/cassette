const { desktopCapturer } = require('electron');
const { EventEmitter } = require('events');

class DesktopCaptureService extends EventEmitter {
    constructor() {
        super();
        this.platform = process.platform;
        this.isInitialized = false;

        this.config = {
            defaultQuality: 70,
            maxWidth: 1920,
            maxHeight: 1080,
            thumbnailSize: {
                width: 1920,
                height: 1080
            },
            compression: {
                jpeg: 70,
                png: 9
            }
        };

        this.captureState = {
            lastCapture: null,
            availableSources: [],
            primarySource: null,
            captureCount: 0
        };

        this.metrics = {
            capturesPerformed: 0,
            totalCaptureTime: 0,
            averageCaptureTime: 0,
            lastCaptureTime: 0,
            errors: 0,
            lastError: null
        };
    }

    async initialize() {
        if (this.isInitialized) {
            return true;
        }

        try {
            console.log('[DesktopCapture] Initializing desktop capture service...');

            await this._refreshAvailableSources();

            this.isInitialized = true;
            console.log('[DesktopCapture] ✅ Initialized successfully');

            this.emit('initialized');
            return true;

        } catch (error) {
            console.error('[DesktopCapture] ❌ Initialization failed:', error);
            this.emit('error', error);
            throw error;
        }
    }

    async _refreshAvailableSources() {
        try {
            const sources = await desktopCapturer.getSources({
                types: ['screen', 'window'],
                thumbnailSize: this.config.thumbnailSize,
                fetchWindowIcons: true
            });

            this.captureState.availableSources = sources;
            this.captureState.primarySource = sources.find(s => s.name.includes('Screen')) || sources[0];

            console.log(`[DesktopCapture] Found ${sources.length} available sources`);

        } catch (error) {
            console.error('[DesktopCapture] Error refreshing sources:', error);
            this.captureState.availableSources = [];
            this.captureState.primarySource = null;
        }
    }

    async captureScreenshot(options = {}) {
        try {
            const startTime = Date.now();

            const config = {
                ...this.config,
                ...options
            };

            console.log('[DesktopCapture] Capturing screenshot...');

            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: {
                    width: config.maxWidth,
                    height: config.maxHeight
                }
            });

            if (sources.length === 0) {
                throw new Error('No screen sources available');
            }

            const source = options.sourceId ?
                sources.find(s => s.id === options.sourceId) :
                sources[0];

            if (!source) {
                throw new Error(`Screen source not found: ${options.sourceId}`);
            }

            if (!source.thumbnail) {
                throw new Error('Source thumbnail not available');
            }

            const quality = config.quality || config.compression.jpeg || 70;
            const buffer = source.thumbnail.toJPEG(quality);
            const base64 = buffer.toString('base64');
            const size = source.thumbnail.getSize();

            const captureTime = Date.now() - startTime;
            this._updateMetrics(captureTime, buffer.length);

            this.captureState.lastCapture = {
                timestamp: Date.now(),
                source: source.name,
                size: size,
                dataSize: buffer.length,
                base64: base64
            };

            const result = {
                success: true,
                base64,
                width: size.width,
                height: size.height,
                source: {
                    id: source.id,
                    name: source.name
                },
                metadata: {
                    captureTime,
                    dataSize: buffer.length,
                    quality: quality,
                    timestamp: Date.now()
                }
            };

            console.log(`[DesktopCapture] ✅ Screenshot captured (${size.width}x${size.height}, ${captureTime}ms)`);
            this.emit('screenshotCaptured', result);

            return result;

        } catch (error) {
            console.error('[DesktopCapture] ❌ Screenshot capture failed:', error);
            this.metrics.errors++;
            this.metrics.lastError = error.message;
            this.emit('error', error);

            return {
                success: false,
                error: error.message,
                timestamp: Date.now()
            };
        }
    }

    async getAvailableSources(options = {}) {
        try {
            console.log('[DesktopCapture] Getting available sources...');

            const sources = await desktopCapturer.getSources({
                types: options.types || ['screen', 'window'],
                thumbnailSize: options.thumbnailSize || this.config.thumbnailSize,
                fetchWindowIcons: options.fetchWindowIcons !== false
            });

            const formattedSources = sources.map(source => ({
                id: source.id,
                name: source.name,
                type: source.name.includes('Screen') ? 'screen' : 'window',
                thumbnail: source.thumbnail.toDataURL(),
                display_id: source.display_id,
                appIcon: source.appIcon ? source.appIcon.toDataURL() : null
            }));

            this.captureState.availableSources = sources;
            this.captureState.primarySource = sources.find(s => s.name.includes('Screen')) || sources[0];

            console.log(`[DesktopCapture] Found ${formattedSources.length} sources`);

            return {
                success: true,
                sources: formattedSources,
                primarySource: this.captureState.primarySource ? {
                    id: this.captureState.primarySource.id,
                    name: this.captureState.primarySource.name
                } : null
            };

        } catch (error) {
            console.error('[DesktopCapture] ❌ Get sources failed:', error);
            return {
                success: false,
                error: error.message,
                sources: []
            };
        }
    }

    _updateMetrics(captureTime, dataSize) {
        this.metrics.capturesPerformed++;
        this.metrics.totalCaptureTime += captureTime;
        this.metrics.averageCaptureTime = this.metrics.totalCaptureTime / this.metrics.capturesPerformed;
        this.metrics.lastCaptureTime = captureTime;
        this.captureState.captureCount++;
    }

    getCaptureMetrics() {
        return {
            ...this.metrics,
            captureState: {
                ...this.captureState,
                lastCapture: this.captureState.lastCapture ? {
                    timestamp: this.captureState.lastCapture.timestamp,
                    source: this.captureState.lastCapture.source,
                    size: this.captureState.lastCapture.size,
                    dataSize: this.captureState.lastCapture.dataSize
                } : null
            },
            config: this.config,
            platform: this.platform,
            isInitialized: this.isInitialized
        };
    }

    updateConfig(newConfig) {
        this.config = {
            ...this.config,
            ...newConfig
        };

        console.log('[DesktopCapture] Configuration updated:', this.config);
        this.emit('configUpdated', this.config);
    }

    resetMetrics() {
        this.metrics = {
            capturesPerformed: 0,
            totalCaptureTime: 0,
            averageCaptureTime: 0,
            lastCaptureTime: 0,
            errors: 0,
            lastError: null
        };

        this.captureState.captureCount = 0;

        console.log('[DesktopCapture] Metrics reset');
    }

    getStatus() {
        return {
            isInitialized: this.isInitialized,
            platform: this.platform,
            availableSourcesCount: this.captureState.availableSources.length,
            hasPrimarySource: !!this.captureState.primarySource,
            lastCapture: this.captureState.lastCapture ? {
                timestamp: this.captureState.lastCapture.timestamp,
                source: this.captureState.lastCapture.source
            } : null,
            metrics: this.metrics
        };
    }

    async cleanup() {
        try {
            console.log('[DesktopCapture] Cleaning up...');

            this.captureState = {
                lastCapture: null,
                availableSources: [],
                primarySource: null,
                captureCount: 0
            };

            this.removeAllListeners();
            this.isInitialized = false;

            console.log('[DesktopCapture] ✅ Cleanup complete');

        } catch (error) {
            console.error('[DesktopCapture] ❌ Cleanup failed:', error);
            throw error;
        }
    }
}

module.exports = new DesktopCaptureService();