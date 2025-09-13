/**
 * Audio Visualizer for Cassette Voice Overlay
 * Creates visual feedback for audio input/output
 */

class AudioVisualizer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.canvas = null;
        this.ctx = null;
        this.animationId = null;
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.isActive = false;
        
        this.init();
    }
    
    init() {
        // Create canvas for visualization
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'audio-visualizer-canvas';
        this.canvas.width = 300;
        this.canvas.height = 40;
        
        if (this.container) {
            this.container.appendChild(this.canvas);
        }
        
        this.ctx = this.canvas.getContext('2d');
        
        // Style the canvas
        this.canvas.style.width = '100%';
        this.canvas.style.height = '40px';
        this.canvas.style.display = 'none';
    }
    
    async connectToAudioTrack(audioTrack) {
        if (!audioTrack) {
            console.warn('No audio track provided');
            return;
        }
        
        try {
            // Create audio context if not exists
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            // Create analyser
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            const bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(bufferLength);
            
            // Get media stream from track
            const mediaStream = new MediaStream([audioTrack.mediaStreamTrack]);
            const source = this.audioContext.createMediaStreamSource(mediaStream);
            source.connect(this.analyser);
            
            // Start visualization
            this.start();
            
            console.log('Audio visualizer connected to track');
        } catch (error) {
            console.error('Failed to connect audio visualizer:', error);
        }
    }
    
    start() {
        if (this.isActive) return;
        
        this.isActive = true;
        this.canvas.style.display = 'block';
        this.draw();
    }
    
    stop() {
        this.isActive = false;
        this.canvas.style.display = 'none';
        
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        // Clear canvas
        if (this.ctx) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }
    
    draw() {
        if (!this.isActive) return;
        
        this.animationId = requestAnimationFrame(() => this.draw());
        
        if (!this.analyser || !this.dataArray) return;
        
        // Get frequency data
        this.analyser.getByteFrequencyData(this.dataArray);
        
        // Clear canvas with transparent background
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw frequency bars in retro style
        const barWidth = (this.canvas.width / this.dataArray.length) * 2.5;
        let barHeight;
        let x = 0;
        
        for (let i = 0; i < this.dataArray.length; i++) {
            barHeight = (this.dataArray[i] / 255) * this.canvas.height * 0.8;
            
            // Retro green color for bars
            const intensity = this.dataArray[i] / 255;
            this.ctx.fillStyle = `rgba(0, ${200 + intensity * 55}, 0, ${0.6 + intensity * 0.4})`;
            
            // Draw bar with rounded top
            this.ctx.fillRect(x, this.canvas.height - barHeight, barWidth - 1, barHeight);
            
            x += barWidth + 1;
        }
    }
    
    // Simple audio level indicator (alternative to frequency visualization)
    showAudioLevel(level) {
        if (!this.ctx) return;
        
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw retro-style level dots
        const dotCount = Math.floor(level * 10);
        const dotSize = 6;
        const spacing = 8;
        const startX = (this.canvas.width - (dotCount * spacing)) / 2;
        
        for (let i = 0; i < dotCount; i++) {
            // Color gradient from green to red
            let color;
            if (i < 3) {
                color = '#00ff00'; // Green
            } else if (i < 6) {
                color = '#ffaa00'; // Yellow
            } else {
                color = '#ff3333'; // Red
            }
            
            this.ctx.fillStyle = color;
            this.ctx.beginPath();
            this.ctx.arc(
                startX + (i * spacing),
                this.canvas.height / 2,
                dotSize / 2,
                0,
                Math.PI * 2
            );
            this.ctx.fill();
            
            // Add glow effect
            this.ctx.shadowColor = color;
            this.ctx.shadowBlur = 4;
            this.ctx.fill();
            this.ctx.shadowBlur = 0;
        }
    }
    
    destroy() {
        this.stop();
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        
        this.canvas = null;
        this.ctx = null;
        this.analyser = null;
        this.dataArray = null;
    }
}

// Export for use
window.AudioVisualizer = AudioVisualizer;