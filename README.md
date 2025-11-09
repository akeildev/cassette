# Cassette Project

## Overview

The Cassette project consists of a backend and a frontend, designed to manage and render audio-visual content. The backend handles agent logic, configuration, and service management, while the frontend provides visualization and user interaction capabilities.

## Project Structure

- **`src/agent/`**: Contains backend logic including:
  - `mcp_logger.py`, `mcp_router.py`, `mcp_utils.py`: Logging, routing, and utility functions.
  - `voice_agent.py`: Handles voice interaction logic.
  - `setup.py`, `mcp.config.json`: Configuration files.

- **`src/main/`**: Manages main application services:
  - `index.js`, `main.js`: Main entry points for service configuration.
  - Services: Includes `ConfigService.js`, `LiveKitService.js`, `SettingsService.js`, `WindowService.js`.

- **`src/renderer/`**: Handles frontend rendering:
  - `index.html`, `index.js`: Main components for the visual app.
  - `audioVisualizer.js`, `livekitClient.js`, `preload.js`, `screenshotClient.js`: Visual and audio scripts.
  - `sounds/`: A collection of cassette sound effects.
  - `styles.css`: Main stylesheet.

## Installation

1. Clone the repository.
2. Run `npm install` to install dependencies.

## Usage

- Start the backend with `npm run start-backend`.
- Launch the frontend with `npm run start-frontend`.

## Contributing

Feel free to submit issues and pull requests.

## License

This project is licensed under the GNU License.
