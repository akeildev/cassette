"""
MCP Router - Manages connections to multiple MCP servers
Supports stdio and websocket transports with hot-reload capability
"""

import asyncio
import json
import os
import uuid
import time
import pathlib
import hashlib
import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Any, Union
from mcp_logger import MCPErrorLogger, setup_mcp_logging, log_mcp_startup, log_mcp_shutdown

# Setup logging
setup_mcp_logging()
logger = logging.getLogger("mcp-router")

@dataclass
class ToolSpec:
    """Specification for a tool exposed by an MCP server"""
    server_id: str
    name: str
    description: str
    schema: dict
    sensitive: bool = False

class JSONRPCHelper:
    """Helper for JSONRPC protocol formatting"""
    @staticmethod
    def request(method: str, params: dict | None = None) -> str:
        """Create a JSONRPC request"""
        return json.dumps({
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": method,
            "params": params or {}
        }) + "\n"

    @staticmethod
    def parse_response(data: str) -> dict:
        """Parse JSONRPC response"""
        resp = json.loads(data)
        if "error" in resp:
            raise RuntimeError(f"RPC Error: {resp['error']}")
        return resp.get("result", {})

class StdioTransport:
    """Stdio transport for local MCP servers"""
    def __init__(self, server_id: str, command: str, args: List[str], env: Dict[str, str]):
        self.server_id = server_id
        self.command = command
        self.args = args
        self.env = env
        self.proc: Optional[asyncio.subprocess.Process] = None
        self._lock = asyncio.Lock()

    async def start(self):
        """Start the stdio process"""
        logger.info(f"Starting stdio server {self.server_id}: {self.command} {' '.join(self.args)}")
        self.proc = await asyncio.create_subprocess_exec(
            self.command, *self.args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, **self.env}
        )

    async def call(self, method: str, params: dict, timeout: float) -> dict:
        """Make an RPC call over stdio"""
        async with self._lock:
            if not self.proc or not self.proc.stdin or not self.proc.stdout:
                raise RuntimeError(f"Stdio server {self.server_id} not started")

            request = JSONRPCHelper.request(method, params)
            self.proc.stdin.write(request.encode("utf-8"))
            await self.proc.stdin.drain()

            try:
                line = await asyncio.wait_for(self.proc.stdout.readline(), timeout=timeout)
                if not line:
                    raise RuntimeError(f"Stdio server {self.server_id} closed unexpectedly")
                return JSONRPCHelper.parse_response(line.decode("utf-8"))
            except asyncio.TimeoutError:
                raise TimeoutError(f"Timeout calling {method} on {self.server_id}")

    async def close(self):
        """Close the stdio process"""
        if self.proc:
            self.proc.terminate()
            try:
                await asyncio.wait_for(self.proc.wait(), timeout=5)
            except asyncio.TimeoutError:
                self.proc.kill()

class WebSocketTransport:
    """WebSocket transport for remote MCP servers"""
    def __init__(self, server_id: str, url: str, headers: Dict[str, str]):
        self.server_id = server_id
        self.url = url
        self.headers = headers
        self.ws = None
        self._lock = asyncio.Lock()

    async def start(self):
        """Connect to websocket server"""
        logger.info(f"Connecting to websocket server {self.server_id}: {self.url}")
        try:
            import websockets
        except ImportError:
            raise ImportError("websockets library required for WebSocket transport")

        self.ws = await websockets.connect(self.url, extra_headers=self.headers)

    async def call(self, method: str, params: dict, timeout: float) -> dict:
        """Make an RPC call over websocket"""
        async with self._lock:
            if not self.ws:
                raise RuntimeError(f"WebSocket server {self.server_id} not connected")

            payload = {
                "jsonrpc": "2.0",
                "id": str(uuid.uuid4()),
                "method": method,
                "params": params or {}
            }

            await self.ws.send(json.dumps(payload))

            try:
                msg = await asyncio.wait_for(self.ws.recv(), timeout=timeout)
                return JSONRPCHelper.parse_response(msg)
            except asyncio.TimeoutError:
                raise TimeoutError(f"Timeout calling {method} on {self.server_id}")

    async def close(self):
        """Close websocket connection"""
        if self.ws:
            await self.ws.close()

class McpToolRouter:
    """Main router for managing multiple MCP servers"""

    def __init__(self, config_path: str):
        self.config_path = config_path
        self.config_mtime = 0.0
        self.config = {}
        self.clients: Dict[str, Union[StdioTransport, WebSocketTransport]] = {}
        self.tools: List[ToolSpec] = []
        self.sensitive_keywords: List[str] = []
        self.policy = {}
        self.runtime = {}
        self._lock = asyncio.Lock()
        self._reload_task = None
        self.error_logger = MCPErrorLogger('mcp-router')

    async def _load_config(self) -> bool:
        """Load configuration from file"""
        try:
            path = pathlib.Path(self.config_path)
            if not path.exists():
                logger.warning(f"Config file not found: {self.config_path}")
                return False

            mtime = path.stat().st_mtime
            if mtime == self.config_mtime:
                return False

            self.config = json.loads(path.read_text())
            self.config_mtime = mtime

            # Parse configuration
            self.sensitive_keywords = [
                kw.lower() for kw in self.config.get("policy", {}).get("sensitive_keywords", [])
            ]
            self.policy = self.config.get("policy", {})
            self.runtime = self.config.get("runtime", {})

            logger.info(f"Loaded config with {len(self.config.get('servers', []))} servers")
            return True
        except Exception as e:
            logger.error(f"Failed to load config: {e}")
            return False

    async def _connect_server(self, server_config: dict):
        """Connect to a single MCP server"""
        server_id = server_config["id"]
        transport_type = server_config.get("transport", "stdio")

        logger.info(f"Connecting to server: {server_id} (transport: {transport_type})")

        try:
            if transport_type == "stdio":
                client = StdioTransport(
                    server_id,
                    server_config["command"],
                    server_config.get("args", []),
                    server_config.get("env", {})
                )
            elif transport_type == "ws" or transport_type == "websocket":
                client = WebSocketTransport(
                    server_id,
                    server_config["url"],
                    server_config.get("headers", {})
                )
            else:
                error_msg = f"Unknown transport type: {transport_type}"
                logger.error(error_msg)
                self.error_logger.log_connection_error(server_id, transport_type, ValueError(error_msg))
                return

            await client.start()
            self.clients[server_id] = client
            logger.info(f"✓ Connected to {server_id}")

            # Initialize connection with proper MCP protocol
            try:
                await self._rpc(server_id, "initialize", {
                    "protocolVersion": "1.0.0",
                    "capabilities": {
                        "tools": {"call": True},
                        "resources": {"list": False, "read": False},
                        "prompts": {"list": False, "get": False}
                    },
                    "clientInfo": {"name": "voice-overlay-agent", "version": "1.0.0"}
                }, 5.0)
                logger.info(f"✓ Initialized server {server_id}")
            except Exception as e:
                logger.debug(f"Optional initialization failed for {server_id}: {e}")
                # This is often OK, not all servers require initialization

        except Exception as e:
            logger.error(f"Failed to connect to server {server_id}: {e}")
            self.error_logger.log_connection_error(server_id, transport_type, e)

    async def _disconnect_server(self, server_id: str):
        """Disconnect from an MCP server"""
        if server_id in self.clients:
            try:
                await self.clients[server_id].close()
            except Exception as e:
                logger.error(f"Error closing server {server_id}: {e}")
            finally:
                del self.clients[server_id]

    async def _rpc(self, server_id: str, method: str, params: dict, timeout: float) -> dict:
        """Make an RPC call to a specific server"""
        if server_id not in self.clients:
            error = RuntimeError(f"Server {server_id} not connected")
            self.error_logger.log_rpc_error(server_id, method, params, error)
            raise error

        try:
            logger.debug(f"RPC call: {method} on {server_id}")
            result = await self.clients[server_id].call(method, params, timeout)
            logger.debug(f"RPC success: {method} on {server_id}")
            return result
        except Exception as e:
            logger.error(f"RPC failed: {method} on {server_id}: {e}")
            self.error_logger.log_rpc_error(server_id, method, params, e)
            raise

    async def _refresh_tools(self):
        """Refresh tool list from all connected servers"""
        tools: List[ToolSpec] = []

        logger.info("Refreshing tool list from all servers...")

        for server_id, client in list(self.clients.items()):
            try:
                # Get tools from server
                logger.debug(f"Requesting tools from {server_id}")
                result = await self._rpc(server_id, "tools/list", {}, 8.0)
                server_tools = result.get("tools", [])

                logger.info(f"Server {server_id} returned {len(server_tools)} tools")

                for tool in server_tools:
                    name = tool.get("name", "")
                    description = tool.get("description", "")
                    schema = tool.get("inputSchema") or tool.get("input_schema") or {}

                    # Check if tool is sensitive
                    tool_text = f"{name} {description}".lower()
                    is_sensitive = any(kw in tool_text for kw in self.sensitive_keywords)

                    tools.append(ToolSpec(
                        server_id=server_id,
                        name=name,
                        description=description,
                        schema=schema,
                        sensitive=is_sensitive
                    ))

                    logger.debug(f"  - {name}: {description[:50]}..." if len(description) > 50 else f"  - {name}: {description}")

                logger.info(f"✓ Loaded {len(server_tools)} tools from {server_id}")

            except Exception as e:
                logger.error(f"Failed to refresh tools from {server_id}: {e}")
                self.error_logger.log_tool_discovery_error(server_id, e)
                # Mark server as unhealthy
                logger.warning(f"Disconnecting unhealthy server: {server_id}")
                await self._disconnect_server(server_id)

        self.tools = tools
        logger.info(f"Total tools available: {len(self.tools)}")

        # Log available tools
        if self.tools:
            logger.info("Available tools:")
            for tool in self.tools[:10]:  # Show first 10
                logger.info(f"  - {tool.name}: {tool.description[:50]}...")

    async def start(self):
        """Start the MCP router"""
        logger.info("="*60)
        logger.info("Starting MCP Router")
        logger.info("="*60)

        await self._load_config()

        server_configs = self.config.get("servers", [])
        logger.info(f"Found {len(server_configs)} server(s) in configuration")

        # Connect to all configured servers
        for server_config in server_configs:
            await self._connect_server(server_config)

        logger.info(f"Successfully connected to {len(self.clients)}/{len(server_configs)} servers")

        # Refresh tool list
        await self._refresh_tools()

        # Log startup summary
        log_mcp_startup(
            self.config_path,
            len(self.clients),
            len(self.tools)
        )

        # Start hot reload if enabled
        if self.runtime.get("hot_reload"):
            logger.info("Hot reload enabled")
            self._reload_task = asyncio.create_task(self._hot_reload_loop())

    async def stop(self):
        """Stop the MCP router"""
        logger.info("Stopping MCP Router...")

        # Cancel reload task
        if self._reload_task:
            self._reload_task.cancel()
            try:
                await self._reload_task
            except asyncio.CancelledError:
                pass

        # Disconnect all servers
        for server_id in list(self.clients.keys()):
            logger.info(f"Disconnecting {server_id}...")
            await self._disconnect_server(server_id)

        # Log shutdown
        log_mcp_shutdown("User requested shutdown")

        # Get error summary
        error_summary = self.error_logger.get_error_summary()
        if error_summary['total_errors'] > 0:
            logger.warning(f"Session ended with {error_summary['total_errors']} total errors")
            logger.info("Check log files for details")

    async def _hot_reload_loop(self):
        """Background task for hot-reloading configuration"""
        interval = self.runtime.get("reload_every_sec", 5)

        while True:
            try:
                await asyncio.sleep(interval)

                # Check for config changes
                config_changed = await self._load_config()
                if not config_changed:
                    continue

                # Update server connections
                current_servers = set(self.clients.keys())
                wanted_servers = set(s["id"] for s in self.config.get("servers", []))

                # Disconnect removed servers
                for server_id in current_servers - wanted_servers:
                    logger.info(f"Removing server {server_id}")
                    await self._disconnect_server(server_id)

                # Connect new servers
                for server_config in self.config.get("servers", []):
                    if server_config["id"] not in current_servers:
                        logger.info(f"Adding server {server_config['id']}")
                        await self._connect_server(server_config)

                # Refresh tools
                await self._refresh_tools()

            except Exception as e:
                logger.error(f"Error in hot reload loop: {e}")

    def find_tools(self, query: str, max_results: int = 5) -> List[ToolSpec]:
        """Find tools matching a query"""
        query_lower = query.lower()
        tokens = [t for t in query_lower.replace(",", " ").split() if t]

        scored_tools = []
        for tool in self.tools:
            haystack = f"{tool.name} {tool.description}".lower()
            score = sum(1 for token in tokens if token in haystack)
            if score > 0:
                scored_tools.append((score, tool))

        # Sort by score (descending) and name
        scored_tools.sort(key=lambda x: (-x[0], x[1].name))

        return [tool for _, tool in scored_tools[:max_results]]

    def get_tool_by_name(self, name: str) -> Optional[ToolSpec]:
        """Get a specific tool by name"""
        for tool in self.tools:
            if tool.name == name:
                return tool
        return None

    async def call_tool(self, tool: ToolSpec, arguments: dict, timeout: Optional[float] = None) -> dict:
        """Call a tool with arguments"""
        if timeout is None:
            timeout = self.policy.get("tool_timeout_sec", 25)

        logger.info(f"Calling tool {tool.name} on server {tool.server_id}")
        logger.debug(f"Arguments: {self.error_logger._sanitize_args(arguments)}")

        start_time = time.time()

        try:
            result = await self._rpc(
                tool.server_id,
                "tools/call",
                {"name": tool.name, "arguments": arguments},
                timeout
            )

            duration = time.time() - start_time
            logger.info(f"✓ Tool {tool.name} completed in {duration:.2f}s")
            self.error_logger.log_successful_execution(tool.name, duration)

            return result
        except asyncio.TimeoutError as e:
            duration = time.time() - start_time
            logger.error(f"Tool {tool.name} timed out after {duration:.2f}s")
            self.error_logger.log_tool_execution_error(tool.name, arguments, e)
            raise
        except Exception as e:
            duration = time.time() - start_time
            logger.error(f"Tool {tool.name} failed after {duration:.2f}s: {e}")
            self.error_logger.log_tool_execution_error(tool.name, arguments, e)
            raise