const fs = require("fs");
const path = require("path");
const os = require("os");

// Try to import electron app, but handle case when not in Electron environment
let app;
try {
  app = require("electron").app;
} catch (error) {
  app = null;
}

/**
 * ConfigService - Centralized configuration management
 * Manages application configuration with environment variable support
 */
class ConfigService {
  constructor() {
    this.config = {};
    this.configPath = null;
    this.initialized = false;
  }

  /**
   * Initialize the configuration service
   */
  initialize() {
    if (this.initialized) {
      return;
    }

    // Setup paths
    this.setupPaths();

    // Load configuration in order of precedence
    this.loadDefaults();
    this.loadEnvironment();
    this.loadUserConfig();

    // Validate configuration
    this.validate();

    this.initialized = true;
    console.log("[ConfigService] Initialized");
  }

  /**
   * Set up configuration file paths
   */
  setupPaths() {
    // User config directory - handle both Electron and non-Electron environments
    let userDataPath;
    if (app && app.getPath) {
      userDataPath = app.getPath("userData");
    } else {
      // Fallback for non-Electron environment
      userDataPath = path.join(os.homedir(), ".voice-overlay");
    }

    this.configDir = path.join(userDataPath, "config");
    this.configPath = path.join(this.configDir, "config.json");

    // Create config directory if it doesn't exist
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
      console.log("[ConfigService] Created config directory:", this.configDir);
    }
  }

  /**
   * Load default configuration values
   */
  loadDefaults() {
    this.config = {
      // App settings
      appName: "Voice Overlay",
      version: app && app.getVersion ? app.getVersion() : "1.0.0",
      environment: process.env.NODE_ENV || "production",

      // LiveKit defaults
      livekitUrl: "",
      livekitApiKey: "",
      livekitApiSecret: "",

      // OpenAI defaults
      openaiApiKey: "",

      // ElevenLabs defaults
      elevenLabsApiKey: "",
      elevenLabsVoiceId: "21m00Tcm4TlvDq8ikWAM",
      elevenLabsModelId: "eleven_turbo_v2_5",

      // Window settings
      alwaysOnTop: true,
      startMinimized: false,
      windowPosition: null,
      windowSize: { width: 380, height: 500 },

      // Audio settings
      audioSampleRate: 16000,
      audioChannels: 1,
      echoCancellation: true,
      noiseSuppression: true,

      // Debug
      debug: false,
      logLevel: "info",
    };
  }

  /**
   * Load configuration from environment variables
   */
  loadEnvironment() {
    // Load .env file if it exists
    try {
      require("dotenv").config();
    } catch (error) {
      // dotenv not critical, continue without it
      console.log(
        "[ConfigService] No .env file found, using system environment"
      );
    }

    // Override with environment variables
    const env = process.env;

    // Map environment variables to config
    if (env.LIVEKIT_URL) this.config.livekitUrl = env.LIVEKIT_URL;
    if (env.LIVEKIT_API_KEY) this.config.livekitApiKey = env.LIVEKIT_API_KEY;
    if (env.LIVEKIT_API_SECRET)
      this.config.livekitApiSecret = env.LIVEKIT_API_SECRET;
    if (env.OPENAI_API_KEY) this.config.openaiApiKey = env.OPENAI_API_KEY;
    if (env.ELEVEN_API_KEY) this.config.elevenLabsApiKey = env.ELEVEN_API_KEY;
    if (env.ELEVEN_VOICE_ID)
      this.config.elevenLabsVoiceId = env.ELEVEN_VOICE_ID;
    if (env.ELEVEN_MODEL_ID)
      this.config.elevenLabsModelId = env.ELEVEN_MODEL_ID;
    if (env.DEBUG === "true") this.config.debug = true;
    if (env.NODE_ENV) this.config.environment = env.NODE_ENV;
  }

  /**
   * Load user-specific configuration
   */
  loadUserConfig() {
    if (!fs.existsSync(this.configPath)) {
      console.log("[ConfigService] No user config file found");
      return;
    }

    try {
      const userConfig = JSON.parse(fs.readFileSync(this.configPath, "utf8"));
      // Only override non-sensitive settings from user config
      const allowedKeys = [
        "alwaysOnTop",
        "startMinimized",
        "windowPosition",
        "windowSize",
        "audioSampleRate",
        "audioChannels",
        "echoCancellation",
        "noiseSuppression",
        "logLevel",
      ];

      for (const key of allowedKeys) {
        if (userConfig[key] !== undefined) {
          this.config[key] = userConfig[key];
        }
      }

      console.log("[ConfigService] Loaded user config from:", this.configPath);
    } catch (error) {
      console.error("[ConfigService] Failed to load user config:", error);
    }
  }

  /**
   * Save current configuration to user config file
   */
  save() {
    try {
      // Only save non-sensitive settings
      const configToSave = {
        alwaysOnTop: this.config.alwaysOnTop,
        startMinimized: this.config.startMinimized,
        windowPosition: this.config.windowPosition,
        windowSize: this.config.windowSize,
        audioSampleRate: this.config.audioSampleRate,
        audioChannels: this.config.audioChannels,
        echoCancellation: this.config.echoCancellation,
        noiseSuppression: this.config.noiseSuppression,
        logLevel: this.config.logLevel,
      };

      fs.writeFileSync(
        this.configPath,
        JSON.stringify(configToSave, null, 2),
        "utf8"
      );

      console.log("[ConfigService] Saved user config to:", this.configPath);
    } catch (error) {
      console.error("[ConfigService] Failed to save user config:", error);
    }
  }

  /**
   * Validate configuration
   */
  validate() {
    const errors = [];
    const warnings = [];

    // Check required API keys
    if (!this.config.livekitUrl) {
      warnings.push("LiveKit URL not configured");
    }

    if (!this.config.livekitApiKey || !this.config.livekitApiSecret) {
      warnings.push("LiveKit API credentials not configured");
    }

    if (!this.config.openaiApiKey) {
      warnings.push("OpenAI API key not configured");
    }

    if (!this.config.elevenLabsApiKey) {
      warnings.push("ElevenLabs API key not configured");
    }

    // Log warnings
    if (warnings.length > 0) {
      console.warn("[ConfigService] Configuration warnings:", warnings);
    }

    // Fatal errors would throw
    if (errors.length > 0) {
      throw new Error(`Configuration validation failed: ${errors.join(", ")}`);
    }
  }

  /**
   * Get a configuration value
   * @param {string} key - Configuration key
   * @param {*} defaultValue - Default value if key doesn't exist
   */
  get(key, defaultValue = undefined) {
    return this.config[key] !== undefined ? this.config[key] : defaultValue;
  }

  /**
   * Set a configuration value
   * @param {string} key - Configuration key
   * @param {*} value - Value to set
   */
  set(key, value) {
    this.config[key] = value;
  }

  /**
   * Get all configuration
   */
  getAll() {
    // Return copy without sensitive data
    const publicConfig = { ...this.config };
    // Mask sensitive fields
    if (publicConfig.livekitApiSecret) publicConfig.livekitApiSecret = "***";
    if (publicConfig.openaiApiKey) publicConfig.openaiApiKey = "***";
    if (publicConfig.elevenLabsApiKey) publicConfig.elevenLabsApiKey = "***";
    return publicConfig;
  }

  /**
   * Check if running in development
   */
  isDevelopment() {
    return this.config.environment === "development";
  }

  /**
   * Check if debug mode is enabled
   */
  isDebugEnabled() {
    return this.config.debug === true;
  }
}

// Export singleton instance
module.exports = new ConfigService();
