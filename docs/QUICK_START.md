# Quick Start Guide

Get up and running with Local LLM Extension in minutes!

## Step 1: Install a Local AI Server

Choose one of these options:

### Option A: LM Studio (Recommended for Beginners)

1. Download from [lmstudio.ai](https://lmstudio.ai/)
2. Install and launch LM Studio
3. Download a model (e.g., "Llama 3.2 3B" or "Qwen 2.5 7B")
4. Go to the "Server" tab
5. Click "Start Server"
6. Note the server URL (usually `http://localhost:1234`)

### Option B: Ollama

1. Install from [ollama.ai](https://ollama.ai/)
2. Run: `ollama pull llama3.2`
3. Run: `ollama serve`
4. Server runs at `http://localhost:11434`

### Option C: Other OpenAI-Compatible Servers

Any server that implements the OpenAI API format will work!

## Step 2: Install the Extension

1. Download the `.vsix` file from releases
2. Open VS Code
3. Go to Extensions (Ctrl+Shift+X)
4. Click "..." menu → "Install from VSIX..."
5. Select the downloaded file
6. Reload VS Code if prompted

## Step 3: Configure the Extension

1. Open Settings (Ctrl+,)
2. Search for "Local LLM"
3. Set **Server URL** to match your AI server:
   - LM Studio: `http://localhost:1234`
   - Ollama: `http://localhost:11434`
   - Other: Your server's URL

## Step 4: Start Using It!

### Open the Chat Sidebar

1. Click the Local LLM icon in the Activity Bar (left sidebar)
2. Select a model from the dropdown
3. Start chatting!

### Try Keyboard Shortcuts

- `Ctrl+Shift+L C` - Open chat
- `Ctrl+Shift+L M` - Quick model switch
- `Ctrl+Shift+L E` - Explain selected code
- `Ctrl+Shift+L G` - Generate code

### Use Commands

Press `Ctrl+Shift+P` and type "Local LLM" to see all commands.

## Troubleshooting

### Can't Connect to Server

- Make sure your AI server is running
- Check the server URL in settings
- Try "Local LLM: Test Connection" command

### No Models Available

- Load a model in your AI server first
- Click "Refresh Models" in the extension
- Make sure the model is fully loaded

### Slow Responses

- Try a smaller model (3B or 7B parameters)
- Use quantized models (Q4 or Q5)
- Reduce "Max Tokens" in settings

## Next Steps

- Customize settings (temperature, max tokens, system prompt)
- Try different models for different tasks
- Explore all available commands
- Set up custom keyboard shortcuts

## Need Help?

Check the [main README](../README.md) for more information or open an issue on GitHub.
