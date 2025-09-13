"""
MCP Error Logger Configuration
Provides detailed logging for debugging MCP tool execution issues
"""

import logging
import os
import sys
from datetime import datetime
from pathlib import Path
import json
import traceback

def setup_mcp_logging():
    """
    Set up comprehensive logging for MCP system
    Creates both file and console handlers with detailed formatting
    """
    
    # Create logs directory
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)
    
    # Create formatters
    detailed_formatter = logging.Formatter(
        '%(asctime)s | %(name)-20s | %(levelname)-8s | %(funcName)-20s | %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    simple_formatter = logging.Formatter(
        '%(asctime)s | %(levelname)-8s | %(message)s',
        datefmt='%H:%M:%S'
    )
    
    # Create file handlers
    # Main log file for all MCP operations
    main_log = log_dir / f"mcp_{datetime.now().strftime('%Y%m%d')}.log"
    main_handler = logging.FileHandler(main_log, encoding='utf-8')
    main_handler.setLevel(logging.DEBUG)
    main_handler.setFormatter(detailed_formatter)
    
    # Error-only log file
    error_log = log_dir / f"mcp_errors_{datetime.now().strftime('%Y%m%d')}.log"
    error_handler = logging.FileHandler(error_log, encoding='utf-8')
    error_handler.setLevel(logging.ERROR)
    error_handler.setFormatter(detailed_formatter)
    
    # Console handler for immediate feedback
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(simple_formatter)
    
    # Configure loggers
    loggers = [
        'mcp-router',
        'confirm-execute',
        'action-namer',
        'mcp-utils',
        'halo-agent'
    ]
    
    for logger_name in loggers:
        logger = logging.getLogger(logger_name)
        logger.setLevel(logging.DEBUG)
        logger.handlers = []  # Clear existing handlers
        logger.addHandler(main_handler)
        logger.addHandler(error_handler)
        logger.addHandler(console_handler)
        logger.propagate = False
    
    # Log startup
    logger = logging.getLogger('mcp-router')
    logger.info("="*60)
    logger.info("MCP LOGGING INITIALIZED")
    logger.info(f"Main log: {main_log}")
    logger.info(f"Error log: {error_log}")
    logger.info("="*60)
    
    return main_log, error_log

class MCPErrorLogger:
    """
    Enhanced error logger for MCP operations
    Provides detailed error tracking and debugging information
    """
    
    def __init__(self, component_name: str):
        self.logger = logging.getLogger(component_name)
        self.component = component_name
        self.error_count = 0
        self.last_errors = []  # Keep last 10 errors
        
    def log_tool_discovery_error(self, server_id: str, error: Exception):
        """Log errors during tool discovery"""
        self.error_count += 1
        error_info = {
            'timestamp': datetime.now().isoformat(),
            'component': self.component,
            'operation': 'tool_discovery',
            'server_id': server_id,
            'error_type': type(error).__name__,
            'error_message': str(error),
            'traceback': traceback.format_exc()
        }
        
        self.last_errors.append(error_info)
        if len(self.last_errors) > 10:
            self.last_errors.pop(0)
        
        self.logger.error(f"Tool discovery failed for {server_id}: {error}")
        self.logger.debug(f"Full error details: {json.dumps(error_info, indent=2)}")
        
    def log_tool_execution_error(self, tool_name: str, args: dict, error: Exception):
        """Log errors during tool execution"""
        self.error_count += 1
        
        # Sanitize args for logging (remove sensitive data)
        safe_args = self._sanitize_args(args)
        
        error_info = {
            'timestamp': datetime.now().isoformat(),
            'component': self.component,
            'operation': 'tool_execution',
            'tool_name': tool_name,
            'arguments': safe_args,
            'error_type': type(error).__name__,
            'error_message': str(error),
            'traceback': traceback.format_exc()
        }
        
        self.last_errors.append(error_info)
        if len(self.last_errors) > 10:
            self.last_errors.pop(0)
        
        self.logger.error(f"Tool execution failed - {tool_name}: {error}")
        self.logger.debug(f"Arguments: {safe_args}")
        self.logger.debug(f"Full traceback:\n{traceback.format_exc()}")
        
    def log_connection_error(self, server_id: str, transport: str, error: Exception):
        """Log server connection errors"""
        self.error_count += 1
        
        error_info = {
            'timestamp': datetime.now().isoformat(),
            'component': self.component,
            'operation': 'server_connection',
            'server_id': server_id,
            'transport': transport,
            'error_type': type(error).__name__,
            'error_message': str(error),
            'traceback': traceback.format_exc()
        }
        
        self.last_errors.append(error_info)
        if len(self.last_errors) > 10:
            self.last_errors.pop(0)
        
        self.logger.error(f"Failed to connect to {server_id} ({transport}): {error}")
        self.logger.debug(f"Connection details: {json.dumps(error_info, indent=2)}")
        
    def log_rpc_error(self, server_id: str, method: str, params: dict, error: Exception):
        """Log RPC communication errors"""
        self.error_count += 1
        
        safe_params = self._sanitize_args(params)
        
        error_info = {
            'timestamp': datetime.now().isoformat(),
            'component': self.component,
            'operation': 'rpc_call',
            'server_id': server_id,
            'method': method,
            'params': safe_params,
            'error_type': type(error).__name__,
            'error_message': str(error),
            'traceback': traceback.format_exc()
        }
        
        self.last_errors.append(error_info)
        if len(self.last_errors) > 10:
            self.last_errors.pop(0)
        
        self.logger.error(f"RPC call failed - {method} on {server_id}: {error}")
        self.logger.debug(f"RPC params: {safe_params}")
        
    def log_validation_error(self, tool_name: str, args: dict, validation_error: str):
        """Log argument validation errors"""
        safe_args = self._sanitize_args(args)
        
        self.logger.warning(f"Validation failed for {tool_name}: {validation_error}")
        self.logger.debug(f"Invalid arguments: {safe_args}")
        
    def log_confirmation_timeout(self, tool_name: str, timeout: float):
        """Log when user doesn't respond to confirmation"""
        self.logger.info(f"Confirmation timeout for {tool_name} after {timeout}s")
        
    def log_successful_execution(self, tool_name: str, duration: float):
        """Log successful tool execution for tracking"""
        self.logger.info(f"✓ {tool_name} completed in {duration:.2f}s")
        
    def get_error_summary(self) -> dict:
        """Get summary of recent errors"""
        return {
            'total_errors': self.error_count,
            'recent_errors': self.last_errors[-5:] if self.last_errors else [],
            'component': self.component
        }
        
    def _sanitize_args(self, args: dict) -> dict:
        """Remove sensitive data from arguments before logging"""
        if not args:
            return {}
            
        sensitive_keys = ['password', 'token', 'api_key', 'secret', 'credential']
        safe_args = {}
        
        for key, value in args.items():
            # Check if key contains sensitive terms
            is_sensitive = any(term in key.lower() for term in sensitive_keys)
            
            if is_sensitive:
                safe_args[key] = "***REDACTED***"
            elif isinstance(value, str) and len(value) > 500:
                safe_args[key] = value[:100] + "...[truncated]"
            else:
                safe_args[key] = value
                
        return safe_args

def log_mcp_startup(config_path: str, server_count: int, tool_count: int):
    """Log MCP system startup information"""
    logger = logging.getLogger('mcp-router')
    logger.info("="*60)
    logger.info("MCP SYSTEM STARTUP")
    logger.info(f"Config: {config_path}")
    logger.info(f"Servers configured: {server_count}")
    logger.info(f"Tools discovered: {tool_count}")
    logger.info("="*60)

def log_mcp_shutdown(reason: str = "Normal shutdown"):
    """Log MCP system shutdown"""
    logger = logging.getLogger('mcp-router')
    logger.info("="*60)
    logger.info(f"MCP SYSTEM SHUTDOWN: {reason}")
    logger.info("="*60)