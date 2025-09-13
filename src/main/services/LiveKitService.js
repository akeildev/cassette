const { AccessToken } = require("livekit-server-sdk");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const EventEmitter = require("events");

/**
 * LiveKitService - Manages LiveKit connections and Python agent
 */
class LiveKitService extends EventEmitter {
  constructor(settingsService) {
    super();
    this.settings = settingsService;
    this.agentProcess = null;
    this.currentRoom = null;
    this.isConnected = false;
    this.connectionAttempts = 0;
    this.maxConnectionAttempts = 3;
  }

  /**
   * Initialize the service
   */
  async initialize() {
    try {
      // Verify configuration
      const config = this.settings.getLiveKitConfig();

      if (!config.url || !config.apiKey || !config.apiSecret) {
        console.warn("[LiveKitService] Missing LiveKit configuration");
        console.log("  URL:", config.url ? "Set" : "Missing");
        console.log("  API Key:", config.apiKey ? "Set" : "Missing");
        console.log("  API Secret:", config.apiSecret ? "Set" : "Missing");
        return false;
      }

      console.log("[LiveKitService] Service initialized");
      console.log("  LiveKit URL:", config.url);
      return true;
    } catch (error) {
      console.error("[LiveKitService] Initialization failed:", error);
      return false;
    }
  }

  /**
   * Generate access token for room connection
   */
  async generateToken(roomName, participantName = "user", metadata = {}) {
    const config = this.settings.getLiveKitConfig();

    if (!config.apiKey || !config.apiSecret) {
      throw new Error("LiveKit API credentials not configured");
    }

    console.log("[LiveKitService] Generating token for room:", roomName);

    try {
      const token = new AccessToken(config.apiKey, config.apiSecret, {
        identity: participantName,
        ttl: "10h",
        metadata: JSON.stringify(metadata),
      });

      token.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canUpdateOwnMetadata: true,
        hidden: false,
      });

      const jwt = await token.toJwt();
      console.log("[LiveKitService] Token generated successfully");
      return jwt;
    } catch (error) {
      console.error("[LiveKitService] Token generation failed:", error);
      throw error;
    }
  }

  /**
   * Start a LiveKit session with agent
   */
  async startSession(options = {}) {
    try {
      if (this.isConnected) {
        console.warn("[LiveKitService] Already connected");
        return {
          success: false,
          error: "Already connected to a session",
        };
      }

      console.log("[LiveKitService] Starting session...");
      this.connectionAttempts++;

      // Generate unique room name
      this.currentRoom = `voice-${uuidv4().slice(0, 8)}`;
      console.log("[LiveKitService] Room name:", this.currentRoom);

      // Get configuration
      const config = this.settings.getLiveKitConfig();

      if (!config.url) {
        throw new Error("LiveKit URL not configured");
      }

      // Generate token for user
      const token = await this.generateToken(this.currentRoom, "user", {
        role: "user",
        timestamp: Date.now(),
      });

      // Start Python agent if requested (default: true)
      if (options.startAgent !== false) {
        const agentStarted = await this.startPythonAgent();

        if (!agentStarted) {
          // Continue without agent but warn
          console.warn(
            "[LiveKitService] Agent failed to start, continuing without agent"
          );
          this.emit("agent-error", "Agent failed to start");
        }
      }

      this.isConnected = true;
      this.connectionAttempts = 0;
      this.emit("connected", { room: this.currentRoom });

      // Return connection details for renderer
      return {
        success: true,
        url: config.url,
        token: token,
        roomName: this.currentRoom,
      };
    } catch (error) {
      console.error("[LiveKitService] Failed to start session:", error);

      // Retry logic
      if (this.connectionAttempts < this.maxConnectionAttempts) {
        console.log(
          `[LiveKitService] Retrying... (${this.connectionAttempts}/${this.maxConnectionAttempts})`
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return this.startSession(options);
      }

      this.connectionAttempts = 0;
      return {
        success: false,
        error: error.message,
        code: error.code || "UNKNOWN",
      };
    }
  }

  /**
   * Start the Python voice agent
   */
  async startPythonAgent() {
    return new Promise((resolve) => {
      try {
        console.log("[LiveKitService] Starting Python agent...");

        // Agent path - adjust based on your structure
        const agentPath = path.join(__dirname, "../../agent/voice_agent.py");
        console.log("[LiveKitService] Agent path:", agentPath);

        // Check if agent file exists
        const fs = require("fs");
        if (!fs.existsSync(agentPath)) {
          console.error("[LiveKitService] Agent file not found:", agentPath);
          resolve(false);
          return;
        }

        // Get configuration
        const config = this.settings.getLiveKitConfig();
        const voiceConfig = this.settings.getVoiceConfig();

        // Prepare environment - include process.env to get OPENAI_API_KEY from .env
        const env = {
          ...process.env,
          LIVEKIT_URL: config.url || process.env.LIVEKIT_URL,
          LIVEKIT_API_KEY: config.apiKey || process.env.LIVEKIT_API_KEY,
          LIVEKIT_API_SECRET: config.apiSecret || process.env.LIVEKIT_API_SECRET,
          OPENAI_API_KEY: process.env.OPENAI_API_KEY || this.settings.getApiKey("openai"),
          ELEVEN_API_KEY: process.env.ELEVENLABS_API_KEY || voiceConfig.apiKey,
          ELEVEN_VOICE_ID: process.env.ELEVENLABS_VOICE_ID || voiceConfig.voiceId,
          ELEVEN_MODEL_ID: voiceConfig.modelId,
          ROOM_NAME: this.currentRoom,
          PYTHONUNBUFFERED: "1",
          PYTHONPATH: path.join(__dirname, "../../agent"),
        };
        
        // Log environment variables for debugging (without leaking secrets)
        console.log("[LiveKitService] Environment variables:");
        console.log("  LIVEKIT_URL:", env.LIVEKIT_URL ? "Set" : "Missing");
        console.log("  LIVEKIT_API_KEY:", env.LIVEKIT_API_KEY ? "Set" : "Missing");
        console.log("  LIVEKIT_API_SECRET:", env.LIVEKIT_API_SECRET ? "Set" : "Missing");
        console.log("  OPENAI_API_KEY:", env.OPENAI_API_KEY ? "Set" : "Missing");
        console.log("  ELEVEN_API_KEY present:", env.ELEVEN_API_KEY ? "Yes" : "No");
        console.log("  ELEVEN_VOICE_ID:", env.ELEVEN_VOICE_ID || this.settings.getVoiceConfig().voiceId || 'Default');
        console.log("  ELEVEN_MODEL_ID:", env.ELEVEN_MODEL_ID || this.settings.getVoiceConfig().modelId || 'Default');
        console.log("  ROOM_NAME:", env.ROOM_NAME);

        // Determine Python command with full path
        let pythonCommand = "python3";
        if (process.platform === "darwin") {
          // macOS - try homebrew python first, then system python
          if (fs.existsSync("/opt/homebrew/bin/python3")) {
            pythonCommand = "/opt/homebrew/bin/python3";
          } else if (fs.existsSync("/usr/bin/python3")) {
            pythonCommand = "/usr/bin/python3";
          }
        } else if (process.platform === "win32") {
          pythonCommand = "python";
        }

        // Check for venv
        const venvPath = path.join(__dirname, "../../agent/venv");
        const venvPython = path.join(
          venvPath,
          process.platform === "win32" ? "Scripts/python.exe" : "bin/python3"
        );

        const usePython = fs.existsSync(venvPython)
          ? venvPython
          : pythonCommand;

        console.log("[LiveKitService] Using Python:", usePython);
        console.log("[LiveKitService] Room name in env:", env.ROOM_NAME);

        // Spawn Python process with 'connect' command to connect to the room
        const args = [
          agentPath, 
          "connect", 
          "--room", this.currentRoom,
          "--url", env.LIVEKIT_URL,
          "--api-key", env.LIVEKIT_API_KEY,
          "--api-secret", env.LIVEKIT_API_SECRET
        ];
        console.log("[LiveKitService] Starting agent with command:", usePython, "voice_agent.py connect --room", this.currentRoom);
        
        this.agentProcess = spawn(usePython, args, {
          env,
          cwd: path.join(__dirname, "../../agent"),
        });

        // Handle stdout
        this.agentProcess.stdout.on("data", (data) => {
          const message = data.toString();
          console.log("[Agent]:", message.trim());

          // Check for successful connection
          if (
            message.includes("Agent started") ||
            message.includes("Connected to room") ||
            message.includes("Voice session started")
          ) {
            console.log("[LiveKitService] Agent connected successfully");
            resolve(true);
          }

          this.emit("agent-log", message);
        });

        // Handle stderr
        this.agentProcess.stderr.on("data", (data) => {
          const error = data.toString();
          console.error("[Agent Error]:", error.trim());

          // Check for import errors
          if (error.includes("ModuleNotFoundError")) {
            console.error("[LiveKitService] Python dependencies missing");
            this.emit("agent-error", "Python dependencies not installed");
          }

          this.emit("agent-error", error);
        });

        // Handle process errors
        this.agentProcess.on("error", (error) => {
          console.error("[LiveKitService] Failed to start agent:", error);
          this.emit("agent-error", error.message);
          resolve(false);
        });

        // Handle process exit
        this.agentProcess.on("exit", (code, signal) => {
          console.log(
            `[LiveKitService] Agent exited with code ${code} (signal: ${signal})`
          );
          this.agentProcess = null;
          this.emit("agent-exit", { code, signal });

          // If we haven't resolved yet, it failed to start
          resolve(false);
        });

        // Set timeout for agent startup
        setTimeout(() => {
          resolve(false); // Timeout, but don't kill process
        }, 10000); // 10 second timeout
      } catch (error) {
        console.error("[LiveKitService] Error starting agent:", error);
        this.emit("agent-error", error.message);
        resolve(false);
      }
    });
  }

  async spawnPythonAgent(roomName) {
    const agentPath = path.join(__dirname, '../../agent/voice_agent.py');
    const venvPython = path.join(__dirname, '../../agent/venv/bin/python3');
    
    // Use venv Python if available, otherwise system Python
    const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3';
    
    logger.info(`Starting Python agent: ${pythonCmd} ${agentPath}`);
    
    const agentProcess = spawn(pythonCmd, [agentPath], {
        env: {
            ...process.env,
            LIVEKIT_URL: this.settings.get('livekit.url'),
            LIVEKIT_API_KEY: this.settings.get('livekit.apiKey'),
            LIVEKIT_API_SECRET: this.settings.get('livekit.apiSecret'),
            OPENAI_API_KEY: this.settings.get('openai.apiKey'),
            ELEVENLABS_API_KEY: this.settings.get('elevenlabs.apiKey'),
            PYTHONUNBUFFERED: '1'
        },
        cwd: path.dirname(agentPath)
    });
    
    // Log output
    agentProcess.stdout.on('data', (data) => {
        logger.info(`[Python Agent] ${data.toString().trim()}`);
    });
    
    agentProcess.stderr.on('data', (data) => {
        logger.error(`[Python Agent Error] ${data.toString().trim()}`);
    });
    
    agentProcess.on('exit', (code) => {
        logger.info(`[Python Agent] Process exited with code ${code}`);
        this.agentProcess = null;
    });
    
    this.agentProcess = agentProcess;
    logger.info('[Python Agent] Started successfully');
  }

  /**
   * Stop the current session
   */
  /**
   * Start agent for a specific room (wrapper for main.js compatibility)
   */
  async startAgent(roomName) {
    // Set the current room
    this.currentRoom = roomName;
    
    // Start the Python agent
    return await this.startPythonAgent();
  }
  
  /**
   * Stop agent (wrapper for main.js compatibility)
   */
  async stopAgent() {
    return await this.stopSession();
  }

  async stopSession() {
    try {
      console.log("[LiveKitService] Stopping session...");

      // Kill Python agent
      if (this.agentProcess) {
        console.log("[LiveKitService] Terminating Python agent...");

        // Try graceful shutdown first
        this.agentProcess.kill("SIGTERM");

        // Force kill after 5 seconds if still running
        setTimeout(() => {
          if (this.agentProcess) {
            console.log("[LiveKitService] Force killing Python agent...");
            this.agentProcess.kill("SIGKILL");
          }
        }, 5000);

        this.agentProcess = null;
      }

      // Clear state
      this.isConnected = false;
      this.currentRoom = null;
      this.connectionAttempts = 0;

      this.emit("disconnected");

      return { success: true };
    } catch (error) {
      console.error("[LiveKitService] Failed to stop session:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Check if session is active
   */
  isActive() {
    return this.isConnected && this.currentRoom !== null;
  }

  /**
   * Get current room name
   */
  getRoomName() {
    return this.currentRoom;
  }

  /**
   * Get session info
   */
  getSessionInfo() {
    return {
      isConnected: this.isConnected,
      roomName: this.currentRoom,
      hasAgent: this.agentProcess !== null,
      connectionAttempts: this.connectionAttempts,
    };
  }

  /**
   * Handle mute/unmute (pass-through for UI)
   */
  async setMute(muted) {
    // The actual muting happens in the renderer's LiveKit client
    // This is just for tracking state if needed
    this.emit("mute-changed", { muted });
    return { success: true, muted };
  }



}





module.exports = LiveKitService;
