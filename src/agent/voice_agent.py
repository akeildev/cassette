#!/usr/bin/env python3
"""
LiveKit Voice Agent for Halo
Integrates OpenAI Realtime (STT/LLM), ElevenLabs (TTS), and Silero VAD
"""

import asyncio
import logging
import os
import aiohttp
import pathlib
from typing import Optional, Dict, Any
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
    llm,
    function_tool,
    RunContext,
)
from livekit.agents.voice import AgentSession
from livekit.plugins import openai, elevenlabs, silero
from openai.types.beta.realtime.session import InputAudioTranscription
from openai import AsyncOpenAI

# Import MCP components
from mcp_router import McpToolRouter, ToolSpec
from mcp_utils import (
    VoiceInteractionHelper,
    ToolResultSummarizer,
    ToolProposalParser,
    ToolProposal
)
from mcp_logger import MCPErrorLogger, setup_mcp_logging

# Configure logging with MCP enhancements
setup_mcp_logging()
logger = logging.getLogger("voice-overlay-agent")
logger.setLevel(logging.INFO)


class VoiceOverlayAgent:
    """Main voice agent class for Voice Overlay assistant with MCP integration"""
    
    def __init__(self):
        self.session: Optional[AgentSession] = None
        self.context: Optional[JobContext] = None
        self.metadata: dict = {}
        self.screenshot_ws_url = "ws://127.0.0.1:8765"
        self.openai_client = AsyncOpenAI()
        self._screenshot_cache = None
        self._screenshot_cache_time = None
        
        # MCP components
        self.mcp_router: Optional[McpToolRouter] = None
        self.voice_helper: Optional[VoiceInteractionHelper] = None
        self.mcp_config_path = pathlib.Path(__file__).parent / "mcp.config.json"
        self.error_logger = MCPErrorLogger('voice-overlay-agent')
        
    async def start_agent_session(self, ctx: JobContext):
        """Initialize and start the agent session with MCP support"""
        self.context = ctx
        
        # Parse metadata from job
        self.metadata = ctx.job.metadata if ctx.job.metadata else {}
        logger.info(f"Starting agent with metadata: {self.metadata}")
        
        # Initialize MCP router
        await self._initialize_mcp()
        
        # Connect to room first
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        
        # Create agent with instructions and tools
        from livekit.agents import Agent
        
        # Combine existing tools with MCP tools
        tools = [
            self.take_screenshot,
            # self.execute_mcp_tool,  # MCP tool executor - temporarily disabled
        ]
        
        agent = Agent(
            instructions=self._get_system_instructions(),
            tools=tools
        )
        
        # Create agent session with working OpenAI Realtime configuration
        self.session = AgentSession(
            llm=openai.realtime.RealtimeModel(
                model="gpt-4o-realtime-preview",
                modalities=["text"],  # Key: Text-only mode for use with separate TTS
                input_audio_transcription=InputAudioTranscription(
                    model="whisper-1",
                    language="en",
                ),
            ),
            tts=elevenlabs.TTS(
                voice_id=os.getenv("ELEVENLABS_VOICE_ID", "EXAVITQu4vr4xnSDxMaL"),
                model="eleven_turbo_v2_5",
                api_key=os.getenv("ELEVENLABS_API_KEY") or os.getenv("ELEVEN_API_KEY"),
            ),
            vad=silero.VAD.load(
                min_speech_duration=0.2,
                min_silence_duration=0.5,
                activation_threshold=0.6,
            ),
        )
        
        # Initialize voice helper with session
        self.voice_helper = VoiceInteractionHelper(self.session)
        
        # Start the session with the agent
        await self.session.start(agent=agent, room=ctx.room)

        # Send initial greeting if specified
        if self.metadata.get("send_greeting", True):
            await self._send_greeting()
    
    async def _initialize_mcp(self):
        """Initialize MCP router and confirmation handler"""
        try:
            if not self.mcp_config_path.exists():
                logger.warning(f"MCP config not found at {self.mcp_config_path}")
                self.error_logger.log_connection_error("config", "file", 
                    FileNotFoundError(f"Config not found: {self.mcp_config_path}"))
                return
            
            logger.info("="*60)
            logger.info("Initializing MCP System")
            logger.info(f"Config: {self.mcp_config_path}")
            logger.info("="*60)
            
            # Create and start MCP router
            self.mcp_router = McpToolRouter(str(self.mcp_config_path))
            await self.mcp_router.start()
            logger.info(f"✓ MCP router started with {len(self.mcp_router.tools)} tools")
            
            # Log available tools
            if self.mcp_router.tools:
                logger.info("Available MCP tools:")
                for tool in self.mcp_router.tools[:10]:  # Show first 10
                    logger.info(f"  - {tool.name}: {tool.description[:50]}...")
            
            logger.info("✓ Direct execution mode enabled - tools will run immediately")
                
        except Exception as e:
            logger.error(f"Failed to initialize MCP: {e}")
            self.error_logger.log_connection_error("mcp_system", "initialization", e)
            self.mcp_router = None
    
    async def _say_wrapper(self, text: str):
        """Wrapper for TTS output - ensures text is spoken clearly"""
        if self.session:
            try:
                logger.info(f"Speaking through TTS: '{text}'")

                # Add a small pause before speaking for clarity
                await asyncio.sleep(0.2)

                # Use the session's generate_reply for proper conversation flow
                handle = await self.session.generate_reply(
                    instructions=f"Speak this message clearly to the user: '{text}'"
                )

                # Wait for the speech to complete
                if hasattr(handle, "wait_for_initialization"):
                    await handle.wait_for_initialization()

                # Add a small pause after speaking for clarity
                await asyncio.sleep(0.3)

                logger.info(f"Successfully spoke: '{text}'")

            except Exception as e:
                logger.error(f"TTS error while speaking '{text}': {e}")
                # Fallback: Try alternative TTS method
                try:
                    if hasattr(self.session, 'say'):
                        await self.session.say(text)
                        logger.info(f"Used fallback TTS for: '{text}'")
                except Exception as fallback_error:
                    logger.error(f"Fallback TTS also failed: {fallback_error}")
            
    async def _send_greeting(self):
        """Send initial greeting to user"""
        greeting = self.metadata.get(
            "greeting",
            "Hello! I'm your voice assistant. I can see your screen, help with various tasks, and execute commands. Just let me know how I can help."
        )

        # Add MCP tools info if available
        if self.mcp_router and self.mcp_router.tools:
            tool_count = len(self.mcp_router.tools)
            greeting += f" I have {tool_count} tools available to help with various tasks."

        # Send greeting using generate_reply - this triggers the conversation properly
        handle = await self.session.generate_reply(
            instructions=f"Say EXACTLY this and nothing else: '{greeting}'"
        )

        # Wait for greeting to complete
        if hasattr(handle, "wait_for_initialization"):
            await handle.wait_for_initialization()
            
    def _get_system_instructions(self):
        """Get system instructions for the agent"""
        base_instructions = """You are Voice Overlay, a helpful AI assistant integrated into the user's desktop.
        Be concise, friendly, and helpful. Focus on understanding the user's needs and providing
        clear, actionable responses.

        You can see the user's screen when they ask about it. Use the take_screenshot tool when:
        - They ask "what's on my screen" or "can you see this"
        - They need help with something visible on their screen
        - They want you to read or analyze visual content
        - They ask about errors, UI elements, or applications they're using

        For system operations, use the execute_mcp_tool function with appropriate tool names.

        Always describe actions in natural language without mentioning tool names.

        After completing tasks, summarize the results conversationally.

        You can be interrupted at any time - this is natural conversation."""
        
        # Add available MCP tools to instructions
        if self.mcp_router and self.mcp_router.tools:
            tool_names = [tool.name for tool in self.mcp_router.tools[:10]]
            base_instructions += f"\n\nAvailable MCP tools: {', '.join(tool_names)}"
        
        # Add any custom instructions from metadata
        custom_instructions = self.metadata.get("instructions", "")
        if custom_instructions:
            return f"{base_instructions}\n\n{custom_instructions}"
        return base_instructions
    
    @function_tool
    async def execute_mcp_tool(
        self,
        context: RunContext,
        tool_name: str,
        arguments: dict = None,
        request_screenshot_first: bool = False
    ) -> str:
        """
        Execute an MCP tool with optional screenshot context
        
        Args:
            tool_name: Name of the MCP tool to execute
            arguments: Arguments to pass to the tool
            request_screenshot_first: Whether to capture screen before execution
            
        Returns:
            Result of tool execution or error message
        """
        logger.info(f"MCP tool execution requested: {tool_name}")
        
        try:
            if not self.mcp_router:
                error_msg = "MCP tools are not available at the moment."
                logger.warning(error_msg)
                return error_msg
            
            # Capture screenshot if requested
            screenshot_context = None
            if request_screenshot_first:
                logger.info("Capturing screenshot for tool context")
                try:
                    screenshot_b64 = await self._request_screenshot("full")
                    screenshot_context = await self._analyze_with_vision(
                        screenshot_b64, 
                        f"Provide context for executing {tool_name}"
                    )
                    logger.info("Screenshot context captured successfully")
                except Exception as e:
                    logger.error(f"Screenshot capture failed: {e}")
            
            # Find the tool
            tool = self.mcp_router.get_tool_by_name(tool_name)
            if not tool:
                # Try to find similar tools
                similar = self.mcp_router.find_tools(tool_name, max_results=3)
                if similar:
                    suggestions = ", ".join([t.name for t in similar])
                    logger.info(f"Tool '{tool_name}' not found, suggesting: {suggestions}")
                    return f"Tool '{tool_name}' not found. Did you mean: {suggestions}?"
                
                logger.warning(f"Tool '{tool_name}' not found and no suggestions available")
                return f"Tool '{tool_name}' not found."
            
            # Add screenshot context to arguments if available
            if screenshot_context and arguments:
                arguments["_context"] = screenshot_context
            
            # Execute the tool directly
            logger.info(f"Executing tool: {tool_name}")
            result = await self.mcp_router.call_tool(
                tool,
                arguments or {},
                timeout=30
            )
            
            # Summarize the result for voice output
            summary = ToolResultSummarizer.summarize(tool_name, result)
            logger.info(f"Tool execution completed: {summary}")
            return summary
                
        except Exception as e:
            logger.error(f"MCP tool execution error: {e}", exc_info=True)
            self.error_logger.log_tool_execution_error(tool_name, arguments or {}, e)
            
            # Provide user-friendly error message
            error_str = str(e).lower()
            if "timeout" in error_str:
                return "The tool took too long to respond. Please try again."
            elif "permission" in error_str:
                return "I don't have permission to do that."
            elif "not found" in error_str:
                return "I couldn't find what you're looking for."
            else:
                return f"I couldn't execute that tool. Please check the logs for details."
        
    @function_tool
    async def take_screenshot(
        self,
        context: RunContext,
        query: str = "What do you see on the screen?",
        region: str = "full"
    ) -> str:
        """
        Captures and analyzes a screenshot of the user's screen.
        
        Args:
            query: What to analyze or look for in the screenshot
            region: Screen region to capture ("full", "window", or "selection")
            
        Returns:
            Visual analysis of the screenshot
        """
        try:
            # Provide immediate feedback
            await self._say_wrapper("Let me take a look at your screen.")
            
            # Check cache (5 second validity)
            import time
            current_time = time.time()
            if (self._screenshot_cache and 
                self._screenshot_cache_time and 
                current_time - self._screenshot_cache_time < 5):
                logger.info("Using cached screenshot")
                screenshot_base64 = self._screenshot_cache
            else:
                # Request new screenshot from Electron via WebSocket
                logger.info(f"Requesting screenshot capture (region: {region})")
                screenshot_base64 = await self._request_screenshot(region)
                # Cache it
                self._screenshot_cache = screenshot_base64
                self._screenshot_cache_time = current_time
            
            # Provide feedback that we're analyzing
            await self._say_wrapper("Analyzing what I see...")
            
            # Analyze with GPT-4o vision
            logger.info(f"Analyzing screenshot with query: {query}")
            analysis = await self._analyze_with_vision(screenshot_base64, query)
            
            return analysis
            
        except Exception as e:
            logger.error(f"Screenshot tool error: {e}", exc_info=True)
            return f"I couldn't capture the screen right now. Error: {str(e)}"
    
    async def _request_screenshot(self, region: str) -> str:
        """Request screenshot from Electron app via WebSocket"""
        try:
            timeout = aiohttp.ClientTimeout(total=10)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.ws_connect(self.screenshot_ws_url) as ws:
                    # Send screenshot request
                    await ws.send_json({
                        "action": "capture_screenshot",
                        "region": region
                    })
                    
                    # Wait for response
                    msg = await ws.receive_json()
                    if msg.get("success"):
                        logger.info("Screenshot captured successfully")
                        return msg["base64"]
                    else:
                        raise Exception(msg.get("error", "Screenshot capture failed"))
                        
        except aiohttp.ClientError as e:
            logger.error(f"WebSocket connection error: {e}")
            raise Exception(f"Could not connect to screenshot service: {str(e)}")
    
    async def _analyze_with_vision(self, image_base64: str, query: str) -> str:
        """Analyze screenshot with GPT-4o vision API"""
        try:
            response = await self.openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": query},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_base64}",
                                "detail": "auto"
                            }
                        }
                    ]
                }],
                max_tokens=500,
                temperature=0.7
            )
            
            return response.choices[0].message.content
            
        except Exception as e:
            logger.error(f"GPT-4o vision analysis error: {e}")
            raise Exception(f"Could not analyze the screenshot: {str(e)}")
    
    async def cleanup(self):
        """Clean up resources"""
        logger.info("Cleaning up voice agent resources...")
        
        # Log error summary
        error_summary = self.error_logger.get_error_summary()
        if error_summary['total_errors'] > 0:
            logger.warning(f"Session ended with {error_summary['total_errors']} errors")
            logger.info("Recent errors:")
            for error in error_summary['recent_errors']:
                logger.info(f"  - {error['operation']}: {error['error_message']}")
        
        if self.mcp_router:
            logger.info("Stopping MCP router...")
            await self.mcp_router.stop()
        if self.session:
            logger.info("Stopping agent session...")
            await self.session.stop()
        
        logger.info("✓ Cleanup complete")


async def entrypoint(ctx: JobContext):
    """Main entrypoint for the agent worker"""
    logger.info(f"Agent started for room: {ctx.room.name}")
    
    # Create and start agent
    agent = VoiceOverlayAgent()
    
    try:
        await agent.start_agent_session(ctx)
        
        # Keep the agent running
        while True:
            await asyncio.sleep(1)
            
            # Check if we should stop
            if ctx.room.connection_state == "disconnected":
                logger.info("Room disconnected, stopping agent")
                break
                
    except Exception as e:
        logger.error(f"Agent error: {e}", exc_info=True)
    finally:
        await agent.cleanup()
        logger.info("Agent stopped")


def main():
    """Main function to run the agent"""
    # Set up environment variables if not already set
    if not os.getenv("OPENAI_API_KEY"):
        logger.warning("OPENAI_API_KEY not set in environment")
    if not os.getenv("ELEVENLABS_API_KEY"):
        logger.warning("ELEVENLABS_API_KEY not set in environment")
    
    # Map ELEVENLABS_API_KEY to ELEVEN_API_KEY for ElevenLabs plugin compatibility
    if os.getenv("ELEVENLABS_API_KEY") and not os.getenv("ELEVEN_API_KEY"):
        os.environ["ELEVEN_API_KEY"] = os.getenv("ELEVENLABS_API_KEY")
        logger.info("Mapped ELEVENLABS_API_KEY to ELEVEN_API_KEY for ElevenLabs plugin")
        
    # Run the agent worker
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
        ),
    )


if __name__ == "__main__":
    main()
