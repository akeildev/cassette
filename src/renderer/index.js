// Simple Cassette Widget Logic
document.addEventListener('DOMContentLoaded', () => {
    let isMuted = false;
    let isRecording = false;
    
    // Elements
    const closeButton = document.getElementById('closeButton');
    const voiceButton = document.getElementById('voiceButton');
    const muteButton = document.getElementById('muteButton');
    const muteText = document.getElementById('muteText');
    const leftReel = document.getElementById('leftReel');
    const rightReel = document.getElementById('rightReel');
    
    // Close button
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            if (window.close) {
                window.close();
            }
        });
    }
    
    // Voice button - Toggle recording with reel animation
    if (voiceButton) {
        voiceButton.addEventListener('click', () => {
            isRecording = !isRecording;
            
            if (isRecording) {
                // Start recording
                voiceButton.classList.add('active');
                voiceButton.querySelector('.voice-button-text').textContent = 'STOP';
                
                // Start reel animation
                if (leftReel) leftReel.classList.add('spinning');
                if (rightReel) rightReel.classList.add('spinning');
                
                console.log('Recording started');
            } else {
                // Stop recording
                voiceButton.classList.remove('active');
                voiceButton.querySelector('.voice-button-text').textContent = 'REC';
                
                // Stop reel animation
                if (leftReel) leftReel.classList.remove('spinning');
                if (rightReel) rightReel.classList.remove('spinning');
                
                console.log('Recording stopped');
            }
        });
    }
    
    // Mute button
    if (muteButton && muteText) {
        muteButton.addEventListener('click', () => {
            isMuted = !isMuted;
            
            if (isMuted) {
                muteText.textContent = 'MUTED';
                muteButton.classList.add('active');
            } else {
                muteText.textContent = 'MUTE';
                muteButton.classList.remove('active');
            }
            
            console.log('Mute toggled:', isMuted);
        });
    }
    
    console.log('Cassette Widget initialized');
});