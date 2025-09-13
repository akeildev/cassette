import subprocess
import sys
import os

def check_python_version():
    """Check if Python version is 3.8+"""
    version = sys.version_info
    if version.major < 3 or (version.major == 3 and version.minor < 8):
        print(f"Python 3.8+ required. Current: {sys.version}")
        return False
    print(f"Python {version.major}.{version.minor}.{version.micro}")
    return True

def create_venv():
    """Create virtual environment"""
    if os.path.exists('venv'):
        print("Virtual environment exists")
        return True
    
    print("Creating virtual environment...")
    try:
        subprocess.run([sys.executable, '-m', 'venv', 'venv'], check=True)
        print("Virtual environment created")
        return True
    except subprocess.CalledProcessError as e:
        print(f"Failed to create venv: {e}")
        return False

def install_requirements():
    """Install requirements"""
    venv_python = 'venv/Scripts/python.exe' if sys.platform == 'win32' else 'venv/bin/python3'
    
    if not os.path.exists(venv_python):
        print(f"Venv Python not found: {venv_python}")
        return False
    
    print("Installing requirements...")
    requirements = [
        'livekit>=0.2.5',
        'livekit-agents>=0.10.2',
        'livekit-plugins-openai>=0.8.5',
        'livekit-plugins-elevenlabs>=0.7.0',
        'livekit-plugins-silero>=0.6.0',
        'python-dotenv>=1.0.0',
        'aiohttp>=3.8.0'
    ]
    
    try:
        # Upgrade pip first
        subprocess.run([venv_python, '-m', 'pip', 'install', '--upgrade', 'pip'], check=True)
        
        # Install each requirement
        for req in requirements:
            print(f"Installing {req}...")
            subprocess.run([venv_python, '-m', 'pip', 'install', req], check=True)
        
        print("All requirements installed")
        return True
    except subprocess.CalledProcessError as e:
        print(f"Failed to install requirements: {e}")
        return False

def main():
    print("Setting up Python environment for Voice Agent\n")
    
    if not check_python_version():
        sys.exit(1)
    
    if not create_venv():
        sys.exit(1)
    
    if not install_requirements():
        sys.exit(1)
    
    print("\nSetup complete!")
    print("\nTo activate the environment:")
    if sys.platform == 'win32':
        print("venv\\Scripts\\activate")
    else:
        print("source venv/bin/activate")

if __name__ == '__main__':
    main()