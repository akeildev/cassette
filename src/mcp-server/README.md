# Cassette Course MCP Server

MCP server for interactive course navigation in Cassette.

## Installation

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables in `.env`:
```
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

3. Load course data (optional):
```bash
node course-data/load-courses.js
```

## MCP Configuration

Add this to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "cassette-courses": {
      "command": "node",
      "args": ["/Users/akeilsmith/cassette/src/mcp-server/src/stdio.js"],
      "env": {
        "SUPABASE_URL": "https://cearzjxohattpbiwmbij.supabase.co",
        "SUPABASE_ANON_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNlYXJ6anhvaGF0dHBiaXdtYmlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc3NTAzODYsImV4cCI6MjA3MzMyNjM4Nn0.GX2Ka2uVULBtUPYMRw1oqs9GV2phymrFhApoks2Pra8"
      }
    }
  }
}
```

## Available Tools

- `listCourses` - List all available courses
- `startCourse` - Start or resume a course
- `nextStep` - Move to the next step in the course
- `getProgress` - Get course progress and statistics

## Testing

Run tests:
```bash
node test-mcp.js
node test-full-navigation.js
```