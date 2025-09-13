import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { courseTools } from './tools.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import dotenv from 'dotenv';

// Load environment variables with quiet mode to avoid polluting stdout
dotenv.config({ quiet: true });

const server = new Server(
  {
    name: 'course-navigator',
    version: '1.0.0',
    description: 'Navigate through courses'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: courseTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema)
    }))
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = courseTools.find(t => t.name === request.params.name);

  if (!tool) {
    throw new Error(`Tool ${request.params.name} not found`);
  }

  const result = await tool.handler(request.params.arguments || {});

  return {
    content: [{ type: 'text', text: result.content || result.error || 'No output' }]
  };
});

export async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep the process alive
  process.stdin.resume();
}