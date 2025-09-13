// Try to import electron-store, but handle case when not in Electron environment
let Store;
try {
  // Check if we're in an Electron environment
  if (
    typeof process !== "undefined" &&
    process.versions &&
    process.versions.electron
  ) {
    Store = require("electron-store");
  } else {
    Store = null;
  }
} catch (error) {
  Store = null;
}

/**
 * SettingsService - Persistent settings management using electron-store
 */
class SettingsService {
  constructor() {
    this.store = null;
    this.initialized = false;
    this.isElectron =
      typeof process !== "undefined" &&
      process.versions &&
      process.versions.electron;
  }

  /**
   * Get default settings
   */
  getDefaults() {
    return {
      // API Keys (encrypted)
      openaiApiKey: "",
      elevenLabsApiKey: "",
      livekitUrl: "",
      livekitApiKey: "",
      livekitApiSecret: "",

      // Voice Configuration
      elevenLabsVoiceId: "21m00Tcm4TlvDq8ikWAM",
      elevenLabsModelId: "eleven_turbo_v2_5",

      // Window preferences
      alwaysOnTop: true,
      windowPosition: null,
      windowSize: { width: 380, height: 500 },
      startWithSystem: false,
      minimizeToTray: false,

      // Audio settings
      inputDevice: "default",
      outputDevice: "default",
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,

      // App preferences
      theme: "light",
      language: "en",
      showNotifications: true,

      // MCP settings
      mcpServers: {
        applescript: {
          enabled: true,
          command: "npx",
          args: ["-y", "@johnlindquist/mcp-server-applescript"],
        },
      },

      // Settings version for migration
      settingsVersion: 1,
    };
  }

  /**
   * Initialize the settings service
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Initialize the store
      this.initializeStore();

      // Migrate old settings if needed
      this.migrateSettings();

      // Validate settings
      this.validateSettings();

      this.initialized = true;
      console.log("[SettingsService] Initialized");
    } catch (error) {
      console.error("[SettingsService] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize the store (either electron-store or fallback)
   */
  initializeStore() {
    if (this.isElectron && Store) {
      try {
        this.store = new Store({
          name: "voice-overlay-settings",
          defaults: this.getDefaults(),
          encryptionKey: "voice-overlay-2024", // In production, use a secure key
          clearInvalidConfig: true,
        });
      } catch (error) {
        console.warn(
          "[SettingsService] Failed to initialize electron-store, using fallback:",
          error.message
        );
        this.initializeFallbackStore();
      }
    } else {
      this.initializeFallbackStore();
    }
  }

  /**
   * Initialize fallback in-memory store
   */
  initializeFallbackStore() {
    const defaults = this.getDefaults();
    const storeData = { ...defaults };
    this.store = {
      store: storeData,
      get: (key, defaultValue) =>
        storeData[key] !== undefined ? storeData[key] : defaultValue,
      set: (key, value) => {
        storeData[key] = value;
      },
      has: (key) => key in storeData,
      delete: (key) => {
        delete storeData[key];
      },
      clear: () => {
        Object.keys(storeData).forEach((key) => delete storeData[key]);
      },
    };
  }

  /**
   * Migrate settings from older versions
   */
  migrateSettings() {
    const currentVersion = this.store.get("settingsVersion", 0);

    if (currentVersion < 1) {
      // Perform migration from version 0 to 1
      console.log(
        "[SettingsService] Migrating settings from version",
        currentVersion,
        "to 1"
      );

      // Example: migrate old API key field names
      const oldOpenAIKey = this.store.get("openai_api_key");
      if (oldOpenAIKey && !this.store.get("openaiApiKey")) {
        this.store.set("openaiApiKey", oldOpenAIKey);
        this.store.delete("openai_api_key");
      }

      this.store.set("settingsVersion", 1);
    }
  }

  /**
   * Validate settings
   */
  validateSettings() {
    // Ensure critical settings have valid values
    const windowSize = this.store.get("windowSize");
    if (!windowSize || windowSize.width < 320 || windowSize.height < 400) {
      this.store.set("windowSize", { width: 380, height: 500 });
    }

    // Validate audio settings
    const validAudioSettings = [
      "echoCancellation",
      "noiseSuppression",
      "autoGainControl",
    ];
    for (const setting of validAudioSettings) {
      const value = this.store.get(setting);
      if (typeof value !== "boolean") {
        this.store.set(setting, true);
      }
    }
  }

  /**
   * API Key Management
   */
  getApiKey(service) {
    const keys = {
      openai: "openaiApiKey",
      elevenlabs: "elevenLabsApiKey",
      livekit: "livekitApiKey",
      "livekit-secret": "livekitApiSecret",
    };

    const key = keys[service];
    if (!key) {
      console.error(`[SettingsService] Unknown service: ${service}`);
      return "";
    }

    return this.store.get(key, "");
  }

  setApiKey(service, value) {
    const keys = {
      openai: "openaiApiKey",
      elevenlabs: "elevenLabsApiKey",
      livekit: "livekitApiKey",
      "livekit-secret": "livekitApiSecret",
    };

    const key = keys[service];
    if (!key) {
      console.error(`[SettingsService] Unknown service: ${service}`);
      return false;
    }

    this.store.set(key, value);
    return true;
  }

  /**
   * LiveKit Configuration
   */
  getLiveKitConfig() {
    return {
      url: this.store.get("livekitUrl", process.env.LIVEKIT_URL || ""),
      apiKey: this.store.get(
        "livekitApiKey",
        process.env.LIVEKIT_API_KEY || ""
      ),
      apiSecret: this.store.get(
        "livekitApiSecret",
        process.env.LIVEKIT_API_SECRET || ""
      ),
    };
  }

  setLiveKitConfig(config) {
    if (config.url !== undefined) this.store.set("livekitUrl", config.url);
    if (config.apiKey !== undefined)
      this.store.set("livekitApiKey", config.apiKey);
    if (config.apiSecret !== undefined)
      this.store.set("livekitApiSecret", config.apiSecret);
  }

  /**
   * Voice Configuration
   */
  getVoiceConfig() {
    return {
      voiceId: this.store.get("elevenLabsVoiceId"),
      modelId: this.store.get("elevenLabsModelId"),
      apiKey: this.store.get("elevenLabsApiKey"),
    };
  }

  setVoiceConfig(config) {
    if (config.voiceId) this.store.set("elevenLabsVoiceId", config.voiceId);
    if (config.modelId) this.store.set("elevenLabsModelId", config.modelId);
    if (config.apiKey) this.store.set("elevenLabsApiKey", config.apiKey);
  }

  /**
   * Window Settings
   */
  getWindowSettings() {
    return {
      alwaysOnTop: this.store.get("alwaysOnTop"),
      position: this.store.get("windowPosition"),
      size: this.store.get("windowSize"),
      startWithSystem: this.store.get("startWithSystem"),
      minimizeToTray: this.store.get("minimizeToTray"),
    };
  }

  saveWindowState(bounds) {
    this.store.set("windowPosition", { x: bounds.x, y: bounds.y });
    this.store.set("windowSize", {
      width: bounds.width,
      height: bounds.height,
    });
  }

  /**
   * MCP Server Configuration
   */
  getMCPServers() {
    return this.store.get("mcpServers", {});
  }

  setMCPServer(name, config) {
    const servers = this.store.get("mcpServers", {});
    servers[name] = config;
    this.store.set("mcpServers", servers);
  }

  /**
   * Generic getters/setters
   */
  get(key, defaultValue = undefined) {
    return this.store.get(key, defaultValue);
  }

  set(key, value) {
    this.store.set(key, value);
  }

  has(key) {
    return this.store.has(key);
  }

  delete(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  /**
   * Get all settings
   */
  getAll() {
    const allSettings = this.store.store;
    // Mask sensitive data
    const masked = { ...allSettings };
    if (masked.openaiApiKey) masked.openaiApiKey = "***";
    if (masked.elevenLabsApiKey) masked.elevenLabsApiKey = "***";
    if (masked.livekitApiSecret) masked.livekitApiSecret = "***";
    return masked;
  }

  /**
   * Save settings to disk (electron-store does this automatically)
   */
  save() {
    // Force a save by triggering a set operation
    this.store.set("lastSaved", Date.now());
    console.log("[SettingsService] Settings saved");
  }

  /**
   * Reset to defaults
   */
  reset() {
    this.store.clear();
    const defaults = this.getDefaults();
    for (const [key, value] of Object.entries(defaults)) {
      this.store.set(key, value);
    }
    console.log("[SettingsService] Settings reset to defaults");
  }

  /**
   * Export settings
   */
  exportSettings() {
    return JSON.stringify(this.store.store, null, 2);
  }

  /**
   * Import settings
   */
  importSettings(jsonString) {
    try {
      const settings = JSON.parse(jsonString);
      for (const [key, value] of Object.entries(settings)) {
        this.store.set(key, value);
      }
      return true;
    } catch (error) {
      console.error("[SettingsService] Failed to import settings:", error);
      return false;
    }
  }
}

// Export singleton instance
module.exports = new SettingsService();
