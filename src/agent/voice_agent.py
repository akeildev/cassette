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
            self.execute_mcp_tool,  # MCP tool executor
        ]
        
        agent = Agent(
            instructions=self._get_system_instructions(),
            tools=tools
        )
        
        # Resolve ElevenLabs configuration with robust logging and safer defaults
        eleven_api_key = os.getenv("ELEVEN_API_KEY") or os.getenv("ELEVENLABS_API_KEY")
        eleven_voice_id = os.getenv("ELEVEN_VOICE_ID") or os.getenv("ELEVENLABS_VOICE_ID") or "EXAVITQu4vr4xnSDxMaL"
        eleven_model_env = os.getenv("ELEVEN_MODEL_ID")
        eleven_model = self._normalize_eleven_model_id(eleven_model_env)

        if not eleven_api_key:
            logger.warning("ELEVEN_API_KEY/ELEVENLABS_API_KEY is not set; TTS will likely fail")
        else:
            masked = f"***{eleven_api_key[-6:]}" if len(eleven_api_key) > 6 else "***"
            logger.info(f"ElevenLabs API key detected: {masked}")
        logger.info(f"ElevenLabs voice: {eleven_voice_id}, model: {eleven_model}")

        # Optional: preflight check to validate ElevenLabs key quickly (non-fatal)
        try:
            await self._tts_preflight_check(eleven_api_key)
        except Exception as preflight_err:
            logger.warning(f"TTS preflight check failed: {preflight_err}")

        # Validate voice id against account (non-fatal; will fall back)
        try:
            eleven_voice_id = await self._resolve_voice_id(eleven_api_key, eleven_voice_id)
        except Exception as voice_err:
            logger.warning(f"Voice validation skipped/failed: {voice_err}")

        # Create agent session with working OpenAI Realtime configuration
        self.session = AgentSession(
            llm=openai.realtime.RealtimeModel(
                model="gpt-4o-realtime-preview",
                modalities=["text"],  # Text-only mode for use with separate TTS
                input_audio_transcription=InputAudioTranscription(
                    model="whisper-1",
                    language="en",
                ),
            ),
            tts=elevenlabs.TTS(
                voice_id=eleven_voice_id,
                model=eleven_model,
                api_key=eleven_api_key,
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
    
    async def _send_greeting(self):
        """Send initial greeting to user for Cassette onboarding"""
        greeting = self.metadata.get(
            "greeting",
            "Hello! Welcome to Cassette. I'm here to guide you through the MoneyFi AI onboarding course. Just say 'start course' when you're ready to begin!"
        )

        # Send greeting - let RealtimeModel handle turn detection
        handle = await self.session.generate_reply(
            instructions=f"Say EXACTLY this and nothing else: '{greeting}'"
        )
            
    def _get_system_instructions(self):
        """Get system instructions for the agent"""
        base_instructions = """You are Cassette, a helpful AI voice assistant for interactive onboarding and training.
        Be conversational, friendly, and guide users through the MoneyFi AI Onboarding course.

        LANGUAGE REQUIREMENT:
        ====================
        You must ALWAYS speak in English only. Respond to all queries in English regardless of the language used by the user.

        YOUR ROLE:
        ==========
        You are the voice interface for Cassette's interactive training platform. You guide users through
        the MoneyFi AI Onboarding course, which teaches them about options trading and AI algorithms.

        STARTING THE COURSE - SIMPLIFIED FLOW:
        =======================================
        When a user says any of these: "start course", "start onboarding", "begin training", "let's start":
        1. Say: "I'll guide you through the MoneyFi AI onboarding. Ready?"
        2. Wait for user confirmation (yes/okay/sure/let's go/ready)
        3. Call: execute_mcp_tool with tool_name="startCourse" and arguments: {"courseTitle": "MoneyFi AI Onboarding"}
        4. Begin the course flow - the first step will provide any needed context

        NO EMAIL NEEDED - This is a demo system, no email parameter required!

        COURSE NAVIGATION:
        ==================
        - START: execute_mcp_tool with tool_name="startCourse", arguments: {"courseTitle": "MoneyFi AI Onboarding"}
        - NEXT: execute_mcp_tool with tool_name="nextStep", arguments: {"courseTitle": "MoneyFi AI Onboarding"}
        - PROGRESS: execute_mcp_tool with tool_name="getProgress", arguments: {"courseTitle": "MoneyFi AI Onboarding"}
        - RESET DEMO: execute_mcp_tool with tool_name="resetDemo", arguments: {}

        HANDLING COURSE CONTENT:
        ========================
        Content may include special markers:

        1. [STEP_ACTION] - An action to perform:
           - Parse the JSON inside for tool, description, parameters
           - Say the description naturally
           - Execute using execute_mcp_tool with the specified tool

        2. [WAIT_FOR_RESPONSE] - Wait for user input:
           - Ask the question and wait for response
           - Continue after user responds

        3. [FALLBACK_ACTION] - Alternative if primary fails:
           - Use if the main action doesn't work

        4. [SAVE_TO_DATABASE] - Data to save:
           - Call saveSessionData with the provided data

        5. [STOP_HERE] - Stop the course flow:
           - Do NOT automatically proceed to next step
           - This marks the end of the Cassette portion

        STEP-BY-STEP FLOW:
        ==================
        1. Read the lesson content naturally (stop at any markers)
        2. If [WAIT_FOR_RESPONSE], wait for user answer
        3. If [STEP_ACTION], execute the action
        4. If [STOP_HERE], DO NOT call nextStep - course portion complete
        5. Otherwise, automatically call nextStep to continue
        6. Repeat until course complete or [STOP_HERE] encountered

        PLATFORM-SPECIFIC BEHAVIOR:
        ===========================
        You are running on Cassette platform. This means:
        - You can execute AppleScript actions (opening apps, navigation)
        - You can capture and analyze screenshots
        - Stock selections are automatically saved to database
        - Skip any steps marked for "cursor-only" platform

        HANDLING STOCK SELECTION:
        =========================
        When the user selects a stock:
        1. The screenshot tool will capture it automatically
        2. AI analyzes and extracts stock name and ticker
        3. Data is saved to database automatically
        4. This data will be available later for Cursor platform

        CONVERSATION STYLE:
        ===================
        - Be encouraging and supportive
        - Use simple, clear language
        - Confirm understanding before moving on
        - Offer to repeat or clarify if needed
        - Keep responses concise but friendly

        EXAMPLE INTERACTIONS:
        ====================
        User: "Start the course"
        You: [Start course and read first step]

        User: "I don't understand moving averages"
        You: "No problem! Let me explain it differently. A moving average is like the average temperature over a week - it smooths out the daily ups and downs to show the overall trend."

        IMPORTANT: Always maintain the flow - after each step, automatically proceed to the next one unless the user asks to stop or has questions.

        CRITICAL RULES:
        - NEVER read [STEP_ACTION] blocks aloud - they're instructions for you
        - ALWAYS execute the action if present - it's part of the lesson
        - A step is NOT complete until BOTH content AND action are done
        - If you see [STOP_HERE], DO NOT call nextStep - the Cassette portion is complete
        - Otherwise, ALWAYS call nextStep after completing a step (unless [STOP_HERE])
        - Make everything sound natural and conversational

        You can see the user's screen when they ask about it. Use the take_screenshot tool when:
        - When we move to a new step, take a screenshot of the new step and analyze it
        - They ask "what's on my screen" or "can you see this"
        - They need help with something visible on their screen
        - They want you to read or analyze visual content
        - They ask about errors, UI elements, or applications they're using

        CRITICAL INSTRUCTION FOR ALL MACOS OPERATIONS:
        ================================================
        You have ONLY ONE TOOL for macOS operations: execute_mcp_tool with tool_name="applescript_execute"

        NEVER create fake tool names. ALWAYS use:
        - Function: execute_mcp_tool
        - tool_name: "applescript_execute"
        - arguments: {"code_snippet": "<your AppleScript code here>"}

        CRITICAL: In AppleScript code_snippet formatting:
        - Use regular double quotes " inside the AppleScript (NOT escaped)
        - Use \\n for line breaks between AppleScript lines
        - The code_snippet is a normal string - let JSON handle the escaping

        Examples of AppleScript operations:

        1. REMINDERS (with proper date/time handling):
        - Create reminder for specific time today:
          code_snippet: "set reminderDate to (current date) + (5 * hours)\\ntell application \\"Reminders\\" to make new reminder with properties {name:\\"Task\\", remind me date:reminderDate}"
        - Create reminder for tomorrow at specific time:
          set reminderDate to (current date) + (1 * days)
          set hours of reminderDate to 17 -- 5 PM
          set minutes of reminderDate to 0
          tell application "Reminders" to make new reminder with properties {name:"Task", remind me date:reminderDate}
        - List: tell application "Reminders" to get name of every reminder

        2. CALENDAR (IMPORTANT: Use proper date/time formats with timezone):
        - Get timezone first: do shell script "date +%Z"
        - Get first calendar: tell application "Calendar" to get name of first calendar
        - Create event with proper date format (use calendar 1 or "Work"):
          set eventDate to current date
          set day of eventDate to 25
          set month of eventDate to 12
          set year of eventDate to 2024
          set hours of eventDate to 15
          set minutes of eventDate to 0
          tell application "Calendar" to make new event at calendar 1 with properties {summary:"Meeting", start date:eventDate, end date:eventDate + (60 * minutes)}
        - Create event for specific time today/tomorrow:
          set eventDate to (current date) + (5 * hours) -- for 5 hours from now
          tell application "Calendar" to make new event at calendar 1 with properties {summary:"Test", start date:eventDate, end date:eventDate + (60 * minutes)}
        - Check calendar: tell application "Calendar" to get summary of every event of calendar 1

        3. MESSAGES:
        - Send: tell application "Messages" to send "Hello" to buddy "+1234567890"

        4. NOTES:
        - Create: tell application "Notes" to make new note with properties {name:"Title", body:"Content"}
        - Read: tell application "Notes" to get body of note 1

        5. SYSTEM INFO:
        - Battery: do shell script "pmset -g batt | grep -o '[0-9]*%'"
        - WiFi: do shell script "networksetup -getairportnetwork en0"
        - Disk space: do shell script "df -h / | tail -1"

        6. FINDER/FILES:
        - List files: tell application "Finder" to get name of every file of desktop
        - Open folder: tell application "Finder" to open folder "Documents" of home

        7. SAFARI:
        - Open URL: tell application "Safari" to open location "https://example.com"
        - Get URL: tell application "Safari" to get URL of current tab of window 1

        8. NOTIFICATIONS:
        - Show: display notification "Message" with title "Title"

        REMEMBER: There is NO "reminders_add", "calendar_create", "messages_send" tool!
        ONLY use execute_mcp_tool with tool_name="applescript_execute" for EVERYTHING!

        Always describe actions in natural language without mentioning tool names.

        EXECUTION FLOW:
        1. When user asks to add something to calendar/reminders, acknowledge and execute immediately
        2. After successful execution, confirm: "I've added [event] to your calendar" or "Your reminder is set"
        3. If there's an error, explain what went wrong

        TIMEZONE AWARENESS:
        - Detect user's timezone with: do shell script "date +%Z"
        - Always use proper AppleScript date objects with correct timezone
        - For "5pm today", calculate from current date/time
        - For "tomorrow at 3pm", add days then set specific hours

        After completing tasks, summarize the results conversationally.

        You can be interrupted at any time - this is natural conversation."""
        
        # Add available MCP tools to instructions
        if self.mcp_router and self.mcp_router.tools:
            tool_names = [tool.name for tool in self.mcp_router.tools[:10]]
            base_instructions += f"\n\nAvailable MCP tools: {', '.join(tool_names)}"
            base_instructions += "\nREMEMBER: Use applescript_execute for ALL system operations!"
        
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
        arguments: Optional[Dict[str, Any]] = None
    ) -> str:
        """Execute an MCP tool and return results for LLM processing"""
        logger.info(f"MCP tool execution requested: {tool_name}")

        try:
            if not self.mcp_router:
                return "MCP tools are not available at the moment."

            tool = self.mcp_router.get_tool_by_name(tool_name)
            if not tool:
                return f"Tool '{tool_name}' not found."

            # Execute tool without any manual TTS - let conversation flow naturally
            result = await self.mcp_router.call_tool(
                tool,
                arguments or {},
                timeout=30
            )

            logger.info(f"Tool {tool_name} completed successfully")

            # Return detailed result for LLM to process and generate natural response
            if tool_name == "applescript_execute":
                # Check the arguments to provide context about what was done
                code_snippet = arguments.get("code_snippet", "") if arguments else ""
                if "Calendar" in code_snippet and "make new event" in code_snippet:
                    return "Successfully created a new calendar event as requested."
                elif "Reminders" in code_snippet and "make new reminder" in code_snippet:
                    return "Successfully added the reminder to your reminders list."
                elif "display notification" in code_snippet:
                    return "Successfully displayed the notification."
                elif "do shell script" in code_snippet:
                    return f"Successfully executed the command. Result: {result}"
                else:
                    return f"Successfully executed the AppleScript command. Result: {result}"
            elif tool_name in ["listCourses", "startCourse", "nextStep", "getProgress"]:
                # For course tools, parse and log the content structure
                result_str = str(result)
                logger.info(f"[Course Tool] Raw result from {tool_name}: {result_str[:500] if len(result_str) > 500 else result_str}...")

                # For step content, check if it has an embedded action
                if tool_name in ["startCourse", "nextStep"] and "[STEP_ACTION]" in result_str:
                    try:
                        import json
                        import re

                        # Extract the action JSON from the embedded block
                        action_match = re.search(r'\[STEP_ACTION\](.*?)\[/STEP_ACTION\]', result_str, re.DOTALL)
                        if action_match:
                            action_json = action_match.group(1).strip()
                            if action_json:  # Only parse if not empty
                                # Remove any leading/trailing whitespace and newlines more aggressively
                                action_json = action_json.strip('\n\r\t ')
                                logger.info(f"[Course Tool] Extracted action JSON: {action_json[:100]}...")
                                # Parse the JSON
                                action_data = json.loads(action_json)

                                logger.info(f"[Course Tool] Found embedded action:")
                                logger.info(f"  - Tool: {action_data.get('tool', 'N/A')}")
                                logger.info(f"  - Description: {action_data.get('description', 'N/A')}")
                                logger.info(f"  - Has parameters: {bool(action_data.get('parameters'))}")
                            else:
                                logger.warning("[Course Tool] Action block was empty")
                        else:
                            logger.info("[Course Tool] No action match found in step content")

                    except json.JSONDecodeError as e:
                        logger.error(f"[Course Tool] JSON parse error: {e}")
                        logger.error(f"[Course Tool] Failed to parse: {action_json[:200] if 'action_json' in locals() else 'N/A'}")
                    except Exception as e:
                        logger.error(f"[Course Tool] Unexpected error parsing action: {e}")

                # Return the raw content for the agent to process
                return result
            else:
                return f"Tool {tool_name} completed successfully. Result: {result}"

        except Exception as e:
            logger.error(f"MCP tool execution error: {e}")
            return f"I encountered an error while executing {tool_name}: {str(e)}"
        
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
            # Check cache (5 second validity) - same as Clueless
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

            # Analyze with GPT-4o vision - simple and direct like Clueless
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
                                "detail": "auto"  # Let GPT-4o decide detail level
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
            await self.session.end()
        
        logger.info("✓ Cleanup complete")

    async def _tts_preflight_check(self, api_key: Optional[str]):
        """Quickly validate ElevenLabs API key by listing voices (non-fatal)."""
        if not api_key:
            raise ValueError("Missing ElevenLabs API key")
        try:
            timeout = aiohttp.ClientTimeout(total=5)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                headers = {
                    "xi-api-key": api_key,
                    "accept": "application/json",
                }
                async with session.get("https://api.elevenlabs.io/v1/voices", headers=headers) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        count = len(data.get("voices", []))
                        logger.info(f"ElevenLabs preflight OK - {count} voice(s) accessible")
                    else:
                        text = await resp.text()
                        raise RuntimeError(f"HTTP {resp.status}: {text[:200]}")
        except Exception as e:
            # Bubble up to caller to log a single warning (keeps noise low)
            raise

    async def _resolve_voice_id(self, api_key: Optional[str], desired_voice_id: str) -> str:
        """Ensure the configured voice ID exists; if not, pick a valid fallback and log."""
        if not api_key:
            raise ValueError("Missing ElevenLabs API key for voice validation")
        timeout = aiohttp.ClientTimeout(total=6)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            headers = {
                "xi-api-key": api_key,
                "accept": "application/json",
            }
            async with session.get("https://api.elevenlabs.io/v1/voices", headers=headers) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    raise RuntimeError(f"Voice list HTTP {resp.status}: {text[:200]}")
                data = await resp.json()
                voices = data.get("voices", []) or []
                voice_ids = {v.get("voice_id"): v for v in voices if v.get("voice_id")}
                if desired_voice_id in voice_ids:
                    logger.info(f"Using configured ElevenLabs voice: {desired_voice_id}")
                    return desired_voice_id
                if voices:
                    fallback = voices[0].get("voice_id")
                    name = voices[0].get("name") or "unknown"
                    logger.warning(
                        f"Configured voice_id '{desired_voice_id}' not found. Falling back to '{name}' ({fallback})."
                    )
                    return fallback or desired_voice_id
                logger.warning("No voices available in ElevenLabs account; keeping configured voice id as-is")
                return desired_voice_id

    def _normalize_eleven_model_id(self, model_id: Optional[str]) -> str:
        """Validate/normalize model id per ElevenLabs docs; choose sensible default if unset/unknown.

        Reference: Turbo v2.5 and other model IDs listed in ElevenLabs documentation.
        """
        # Known common model ids from docs
        known_models = {
            "eleven_turbo_v2_5",
            "eleven_turbo_v2",
            "eleven_flash_v2_5",
            "eleven_multilingual_v2",
            "eleven_v3",
        }
        preferred_default = "eleven_turbo_v2_5"
        if not model_id:
            return preferred_default
        model_id = model_id.strip()
        if model_id in known_models:
            return model_id
        logger.warning(f"Unknown ELEVEN_MODEL_ID '{model_id}', defaulting to {preferred_default}")
        return preferred_default


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
