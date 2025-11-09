# Changelog

All notable changes to the Local LLM Extension will be documented in this file.

## [0.1.1] - 2024-11-09

### Fixed
- Fixed clear button using VS Code native dialogs instead of sandboxed confirm/alert
- Fixed status bar positioning to avoid overlap with IDE status bar
- Removed all confirm() and alert() calls from webview (sandboxing issue)

### Changed
- Increased default timeout from 30 seconds to 2 minutes (120000ms)
- Updated welcome message to generic "Welcome to Local LLM Chat"
- Improved webview CSS with proper spacing and padding

### Added
- Screenshots to README showing chat interface
- Timeout troubleshooting section in README
- TODO.md for tracking issues and features

## [0.1.0] - 2024-11-08

### Initial Release

- Connect to local AI servers with OpenAI-compatible APIs
- Sidebar chat interface with streaming responses
- Model management (list, select, refresh)
- Code actions (explain, improve, generate)
- Text completion support
- Keyboard shortcuts for quick access
- Configurable settings (temperature, tokens, prompts)
- Performance metrics display
- Status bar integration
- Compatible with LM Studio, Ollama, and other OpenAI-compatible servers
