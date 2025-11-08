# Local LLM Extension

Connect local AI models to your VS Code development environment using OpenAI-compatible APIs.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

- 🤖 **Sidebar Chat** - Always-visible AI chat in the sidebar
- 💬 **Streaming Responses** - Real-time AI responses with streaming
- �  **Model Management** - Easy model selection and switching
- ⚡ **Fast & Local** - All processing happens on your machine
- 🎯 **Code Actions** - Explain, improve, and generate code
- 📝 **Text Completion** - AI-powered code completion
- � ***Configurable** - Customize temperature, tokens, and prompts
- � **CPerformance Metrics** - See tokens/sec and generation time
- � **OprenAI Compatible** - Works with LM Studio, Ollama, and other OpenAI-compatible servers

## 🚀 Quick Start

### Prerequisites

You need a local AI server running with OpenAI-compatible API. Popular options:

- **[LM Studio](https://lmstudio.ai/)** - Easy-to-use GUI for running models locally
- **[Ollama](https://ollama.ai/)** - Command-line tool for running models
- **[LocalAI](https://localai.io/)** - Self-hosted OpenAI alternative
- Any other OpenAI-compatible API server

### Installation

1. Download the `.vsix` file from releases
2. Open VS Code
3. Go to Extensions (Ctrl+Shift+X)
4. Click the "..." menu → "Install from VSIX..."
5. Select the downloaded `.vsix` file

### Setup

1. Start your local AI server (e.g., LM Studio with local server enabled)
2. Load a model in your AI server
3. Click the Local LLM icon in the Activity Bar (left sidebar)
4. Select a model from the dropdown
5. Start chatting!

## 🎮 Usage

### Sidebar Chat

Click the Local LLM icon in the Activity Bar to open the chat sidebar. The chat stays visible while you code!

### Keyboard Shortcuts

- `Ctrl+Shift+L C` - Open chat
- `Ctrl+Shift+L M` - Quick model switch
- `Ctrl+Shift+L T` - Complete text
- `Ctrl+Shift+L G` - Generate code
- `Ctrl+Shift+L E` - Explain code
- `Ctrl+Shift+L S` - Complete selection

### Commands

Press `Ctrl+Shift+P` and type "Local LLM" to see all available commands:

- **Open Chat** - Open the chat sidebar
- **Select Model** - Choose your active model
- **List Models** - View all available models
- **Refresh Models** - Refresh the model list
- **Test Connection** - Check server connection
- **Complete Text** - Generate text completion
- **Generate Code** - Generate code from description
- **Explain Code** - Explain selected code
- **Improve Code** - Get improvement suggestions

## ⚙️ Configuration

Access settings via `File > Preferences > Settings` and search for "Local LLM":

### Connection Settings

- **Server URL** - Your local AI server address (default: `http://localhost:1234`)
- **Timeout** - Request timeout in milliseconds (default: 30000)
- **Retry Attempts** - Number of retry attempts (default: 3)

### Chat Settings

- **Temperature** - Sampling temperature 0-2 (default: 0.7)
- **Max Tokens** - Maximum tokens to generate (default: 1000)
- **System Prompt** - Default system prompt for chat

### Completion Settings

- **Temperature** - Completion temperature (default: 0.7)
- **Max Tokens** - Maximum completion tokens (default: 500)
- **Stop Sequences** - Sequences to stop generation

## 🔧 Troubleshooting

### Connection Issues

**Problem:** Cannot connect to server

**Solutions:**
1. Ensure your AI server is running
2. Check that the local server is started
3. Verify the server URL in settings
4. Check firewall settings

### Model Issues

**Problem:** No models available or model not loading

**Solutions:**
1. Load a model in your AI server first
2. Click "Refresh Models" in the extension
3. Ensure the model is fully loaded
4. Check available system memory

### Performance Issues

**Problem:** Slow responses or high memory usage

**Solutions:**
1. Use a smaller or quantized model
2. Reduce max tokens in settings
3. Close other applications to free memory
4. Adjust temperature for faster responses

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

Check out the [TODO list](TODO.md) for known issues and planned features.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

## 📞 Support

- **Issues:** Report bugs and request features via GitHub Issues
- **Repository:** [github.com/mjkubba/local-llm](https://github.com/mjkubba/local-llm)

---

**Made with ❤️ for local AI development**
