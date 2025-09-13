require("dotenv").config();

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  systemPreferences,
} = require("electron");
const path = require("path");
const ConfigService = require("./services/ConfigService");
const SettingsService = require("./services/SettingsService");

// Global references
let mainWindow = null;
let isShuttingDown = false;
let services = {};

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log("Another instance is already running, quitting...");
  app.quit();
} else {
  console.log("Got single instance lock");
  app.on("second-instance", () => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// App event handlers
app.whenReady().then(async () => {
  console.log("Voice Overlay Backend starting...");

  // Initialize services (we'll add these next)
  await initializeServices();

  // Check permissions on macOS
  if (process.platform === "darwin") {
    await checkPermissions();
  }

  // Create main window
  createMainWindow();

  // Setup IPC handlers
  setupIPCHandlers();

  console.log("Backend ready");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on("before-quit", async (event) => {
  if (!isShuttingDown) {
    event.preventDefault();
    isShuttingDown = true;
    await cleanup();
    app.quit();
  }
});

/**
 * Initialize all services
 */
async function initializeServices() {
  try {
    // Initialize configuration
    ConfigService.initialize();

    // Initialize settings
    await SettingsService.initialize();

    // Store references
    services = {
      config: ConfigService,
      settings: SettingsService,
    };

    console.log("Services initialized");
    console.log("Config:", ConfigService.getAll());
    console.log("Settings:", SettingsService.getAll());
  } catch (error) {
    console.error("Failed to initialize services:", error);
    dialog.showErrorBox(
      "Initialization Error",
      "Failed to initialize services. Please check your configuration."
    );
    app.quit();
  }
}
/**
 * Check system permissions (macOS)
 */
async function checkPermissions() {
  const microphoneStatus = systemPreferences.getMediaAccessStatus("microphone");

  if (microphoneStatus !== "granted") {
    console.log("Requesting microphone permission...");
    const result = await systemPreferences.askForMediaAccess("microphone");
    if (!result) {
      dialog.showMessageBox({
        type: "warning",
        title: "Microphone Permission Required",
        message:
          "Voice Overlay requires microphone access to function properly.",
        buttons: ["OK"],
      });
    }
  }
}

/**
 * Create the main window
 */
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 500,
    minWidth: 320,
    minHeight: 400,
    frame: true,
    transparent: false,
    backgroundColor: "#f5f5f5",
    resizable: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "../renderer/preload.js"),
      webSecurity: true,
    },
  });

  // For Phase 1, load a test page
  mainWindow.loadURL(`data:text/html,
        <!DOCTYPE html>
        <html>
        <head>
            <title>Backend Test</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    padding: 20px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                }
                h1 { margin-bottom: 20px; }
                .status { 
                    background: rgba(255,255,255,0.2);
                    padding: 10px;
                    border-radius: 5px;
                    margin: 10px 0;
                }
            </style>
        </head>
        <body>
            <h1>Backend Running</h1>
            <div class="status">Main Process: Active</div>
            <div class="status">IPC Handlers: Ready</div>
            <div class="status">Waiting for Frontend...</div>
        </body>
        </html>
    `);

  // Window event handlers
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Development tools
  if (!app.isPackaged && process.env.DEBUG === "true") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

/**
 * Setup IPC handlers for renderer communication
 * These are stubs for User 2 to connect to
 */
function setupIPCHandlers() {
  // Voice session handlers
  ipcMain.handle("voice:start", async () => {
    console.log("[Backend] Voice start requested");
    // Return mock data for now
    return {
      success: true,
      url: process.env.LIVEKIT_URL || "wss://dummy.livekit.cloud",
      token: "dummy-token-for-testing",
      roomName: "test-room-" + Date.now(),
    };
  });

  ipcMain.handle("voice:stop", async () => {
    console.log("[Backend] Voice stop requested");
    return { success: true };
  });

  ipcMain.handle("voice:mute", async (event, muted) => {
    console.log("[Backend] Mute requested:", muted);
    return { success: true, muted };
  });

  // Settings handlers
  ipcMain.handle("settings:get", (event, key) => {
    return SettingsService.get(key);
  });

  ipcMain.handle("settings:set", (event, key, value) => {
    SettingsService.set(key, value);
    return { success: true };
  });

  ipcMain.handle("settings:getAll", () => {
    return SettingsService.getAll();
  });

  // Window control handlers
  ipcMain.handle("window:minimize", () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.handle("window:close", () => {
    if (mainWindow) mainWindow.close();
  });

  ipcMain.handle("window:setAlwaysOnTop", (event, value) => {
    if (mainWindow) {
      mainWindow.setAlwaysOnTop(value);
      SettingsService.set("alwaysOnTop", value);
    }
    return { success: true };
  });

  // App info handlers
  ipcMain.handle("app:getVersion", () => {
    return app.getVersion();
  });

  ipcMain.handle("app:getPlatform", () => {
    return process.platform;
  });

  console.log("IPC handlers registered");
}

/**
 * Send message to renderer (for later use)
 */
function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

/**
 * Cleanup before quitting
 */
async function cleanup() {
  try {
    console.log("Cleaning up...");

    // Cleanup services (we'll add these later)
    SettingsService.save();
    ConfigService.save();

    console.log("Cleanup complete");
  } catch (error) {
    console.error("Error during cleanup:", error);
  }
}

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  dialog.showErrorBox(
    "Unexpected Error",
    `An unexpected error occurred: ${error.message}`
  );
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Export for testing
module.exports = { sendToRenderer };
