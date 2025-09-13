"""
MCP Utilities
Helper functions for voice interaction and tool management
"""

import asyncio
import json
import logging
from typing import Optional, Dict, Any, List
from dataclasses import dataclass

logger = logging.getLogger("mcp-utils")

@dataclass
class ToolProposal:
    """Represents a proposed tool execution from the LLM"""
    intent: str  # Tool name or empty
    arguments: dict
    needs_confirmation: bool
    request_screenshot: bool
    rationale: str
    
    @classmethod
    def from_dict(cls, data: dict) -> 'ToolProposal':
        """Create from dictionary"""
        return cls(
            intent=data.get("intent", ""),
            arguments=data.get("arguments", {}),
            needs_confirmation=data.get("needs_confirmation", True),
            request_screenshot=data.get("request_screenshot", False),
            rationale=data.get("rationale", "")
        )
    
    @classmethod
    def empty(cls) -> 'ToolProposal':
        """Create empty proposal"""
        return cls(
            intent="",
            arguments={},
            needs_confirmation=True,
            request_screenshot=False,
            rationale=""
        )

class VoiceInteractionHelper:
    """Helper for voice-based interactions"""
    
    def __init__(self, session=None):
        self.session = session
        self.last_response = None
        
    async def say(self, text: str) -> None:
        """Speak text to user through TTS"""
        if not self.session:
            logger.warning("No session available for TTS")
            return
            
        try:
            logger.info(f"Speaking: {text}")
            # Use the session's TTS capabilities
            await self.session.say(text)
        except Exception as e:
            logger.error(f"TTS error: {e}")
    
    async def listen_yes_no(self, timeout: float = 6.0) -> bool:
        """Listen for yes/no response from user"""
        if not self.session:
            logger.warning("No session available for listening")
            return False
            
        try:
            logger.info(f"Listening for yes/no (timeout: {timeout}s)")
            
            # Create a custom listening context
            response = await asyncio.wait_for(
                self._wait_for_yes_no(),
                timeout=timeout
            )
            
            return response
            
        except asyncio.TimeoutError:
            logger.info("Yes/no response timeout")
            return False
        except Exception as e:
            logger.error(f"Listen error: {e}")
            return False
    
    async def _wait_for_yes_no(self) -> bool:
        """Internal method to wait for yes/no in the conversation"""
        # This will be integrated with the LiveKit session's transcript
        # For now, return a placeholder
        # In production, this would monitor the session's transcript for yes/no patterns
        
        positive_words = ["yes", "yeah", "yep", "sure", "okay", "ok", "go ahead", "do it", "confirm", "affirmative"]
        negative_words = ["no", "nope", "nah", "don't", "stop", "cancel", "negative", "abort"]
        
        # TODO: Integrate with actual LiveKit transcript monitoring
        # This is a simplified version - in production would monitor real transcript
        await asyncio.sleep(2)  # Simulate listening
        return True  # Default to yes for testing

class ToolResultSummarizer:
    """Summarizes tool execution results for voice output"""
    
    @staticmethod
    def summarize(tool_name: str, result: Any, max_length: int = 250) -> str:
        """Create a concise summary of tool results"""
        
        # Handle different result types
        if isinstance(result, dict):
            return ToolResultSummarizer._summarize_dict(tool_name, result, max_length)
        elif isinstance(result, list):
            return ToolResultSummarizer._summarize_list(tool_name, result, max_length)
        elif isinstance(result, str):
            return ToolResultSummarizer._summarize_string(tool_name, result, max_length)
        else:
            return f"The {tool_name} completed successfully."
    
    @staticmethod
    def _summarize_dict(tool_name: str, result: dict, max_length: int) -> str:
        """Summarize dictionary results"""
        # Special handling for common patterns
        if "content" in result:
            content = str(result["content"])
            if len(content) > max_length:
                return content[:max_length-3] + "..."
            return content
            
        if "message" in result:
            return str(result["message"])
            
        if "status" in result:
            status = result["status"]
            if "data" in result:
                return f"Status: {status}. {ToolResultSummarizer._summarize_data(result['data'], max_length-20)}"
            return f"Status: {status}"
            
        # Generic dict summary
        items = []
        for key, value in list(result.items())[:3]:  # First 3 items
            if isinstance(value, (str, int, float, bool)):
                items.append(f"{key}: {value}")
        
        if items:
            summary = ", ".join(items)
            if len(summary) > max_length:
                return summary[:max_length-3] + "..."
            return summary
        
        return f"The {tool_name} returned a result with {len(result)} items."
    
    @staticmethod
    def _summarize_list(tool_name: str, result: list, max_length: int) -> str:
        """Summarize list results"""
        if not result:
            return f"The {tool_name} returned no results."
            
        count = len(result)
        if count == 1:
            # Single item - describe it
            item_summary = ToolResultSummarizer.summarize(tool_name, result[0], max_length)
            return item_summary
        
        # Multiple items - summarize count and first few
        summary_parts = [f"Found {count} items"]
        
        # Add first item details if it's a dict with useful info
        if isinstance(result[0], dict):
            if "name" in result[0]:
                names = [str(item.get("name", "")) for item in result[:3] if "name" in item]
                if names:
                    summary_parts.append(f"including: {', '.join(names)}")
            elif "title" in result[0]:
                titles = [str(item.get("title", "")) for item in result[:3] if "title" in item]
                if titles:
                    summary_parts.append(f"including: {', '.join(titles)}")
        
        summary = ". ".join(summary_parts)
        if len(summary) > max_length:
            return summary[:max_length-3] + "..."
        return summary
    
    @staticmethod
    def _summarize_string(tool_name: str, result: str, max_length: int) -> str:
        """Summarize string results"""
        if len(result) <= max_length:
            return result
        
        # Try to cut at sentence boundary
        truncated = result[:max_length-3]
        last_period = truncated.rfind('.')
        last_newline = truncated.rfind('\n')
        
        cut_point = max(last_period, last_newline)
        if cut_point > max_length * 0.7:  # If we can preserve most of it
            return truncated[:cut_point+1] + "..."
        
        return truncated + "..."
    
    @staticmethod
    def _summarize_data(data: Any, max_length: int) -> str:
        """Summarize nested data"""
        if isinstance(data, (str, int, float, bool)):
            s = str(data)
            if len(s) > max_length:
                return s[:max_length-3] + "..."
            return s
        elif isinstance(data, (dict, list)):
            return ToolResultSummarizer.summarize("data", data, max_length)
        else:
            return "Complex data returned."

class ToolProposalParser:
    """Parses LLM responses to extract tool proposals"""
    
    @staticmethod
    def parse(llm_response: str) -> ToolProposal:
        """Parse LLM response to extract tool proposal"""
        try:
            # Try to extract JSON from response
            # Handle case where LLM includes explanation with JSON
            json_start = llm_response.find('{')
            json_end = llm_response.rfind('}') + 1
            
            if json_start >= 0 and json_end > json_start:
                json_str = llm_response[json_start:json_end]
                data = json.loads(json_str)
                return ToolProposal.from_dict(data)
            
            # If no valid JSON, return empty proposal
            return ToolProposal.empty()
            
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse tool proposal: {e}")
            return ToolProposal.empty()
        except Exception as e:
            logger.error(f"Unexpected error parsing proposal: {e}")
            return ToolProposal.empty()
    
    @staticmethod
    def create_prompt(user_query: str, available_tools: List[str], has_screenshot: bool = False) -> str:
        """Create prompt for LLM to propose tool usage"""
        tools_list = ", ".join(available_tools[:10])  # Limit to 10 tools in prompt
        
        prompt = f"""Based on the user's request, propose a tool to use or indicate no tool is needed.

User request: {user_query}

Available tools: {tools_list}

{"The user's screen has been captured and is available for analysis." if has_screenshot else ""}

Reply ONLY with JSON in this exact format:
{{
  "intent": "<tool_name_or_empty>",
  "arguments": {{}},
  "needs_confirmation": true,
  "request_screenshot": false,
  "rationale": "<20_words_or_less>"
}}

If no tool is needed, set intent to empty string.
If you need to see the screen first, set request_screenshot to true."""
        
        return prompt