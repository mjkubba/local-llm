const vscode = require('vscode');

/**
 * Provides the chat webview in the sidebar
 */
class ChatViewProvider {
    constructor(configManager, modelCommands, client, extensionUri) {
        this.configManager = configManager;
        this.modelCommands = modelCommands;
        this.client = client;
        this.extensionUri = extensionUri;
        this._view = undefined;
        this.chatHistory = [];
        this.isStreaming = false;
        this.currentStreamingMessage = null;
        this.maxHistorySize = 100;
        this.statusBarProvider = null;
        
        this.loadChatHistory();
    }

    setStatusBarProvider(statusBarProvider) {
        this.statusBarProvider = statusBarProvider;
    }

    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', 'webview')]
        };

        webviewView.webview.html = this.getWebviewContent(this.extensionUri, webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            await this.handleWebviewMessage(message);
        });

        // Update state when view becomes visible
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.updateWebviewState();
            }
        });

        // Initial state update
        this.updateWebviewState();
    }

    async handleWebviewMessage(message) {
        try {
            if (!message || typeof message.type !== 'string') {
                throw new Error('Invalid message format');
            }

            switch (message.type) {
                case 'sendMessage':
                    if (!message.text || typeof message.text !== 'string') {
                        throw new Error('Message text is required');
                    }
                    await this.handleSendMessage(message.text, message.systemPrompt);
                    break;
                case 'clearChat':
                    await this.handleClearChat();
                    break;
                case 'selectModel':
                    if (!message.modelId) {
                        throw new Error('Model ID is required');
                    }
                    await this.handleSelectModel(message.modelId);
                    break;
                case 'refreshModels':
                    await this.handleRefreshModels();
                    break;
                case 'updateSettings':
                    if (!message.settings || typeof message.settings !== 'object') {
                        throw new Error('Settings object is required');
                    }
                    await this.handleUpdateSettings(message.settings);
                    break;
                case 'ready':
                    console.log('ChatViewProvider: Received ready message, updating state...');
                    await this.updateWebviewState();
                    console.log('ChatViewProvider: State update complete');
                    break;
                default:
                    console.warn('Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('Error handling webview message:', error);
            this.sendToWebview({
                type: 'error',
                message: error.message || 'An unexpected error occurred'
            });
        }
    }

    async handleSendMessage(text, systemPrompt) {
        if (this.isStreaming) {
            return this.sendError('Please wait for the current response to complete', 'Send Message');
        }

        const activeModel = this.modelCommands.getActiveModel();
        if (!activeModel) {
            return this.sendError('No active model selected. Please select a model first.', 'Send Message');
        }

        const userMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: text,
            timestamp: new Date().toISOString()
        };

        this.chatHistory.push(userMessage);
        await this.saveChatHistory();
        this.sendToWebview({ type: 'messageAdded', message: userMessage });

        const config = this.configManager.getConfiguration();
        const messages = [];
        const prompt = systemPrompt || config.chatSettings.systemPrompt;
        if (prompt) {
            messages.push({ role: 'system', content: prompt });
        }

        const recentHistory = this.chatHistory.slice(-20);
        messages.push(...recentHistory.map(msg => ({ role: msg.role, content: msg.content })));

        const streamingMessageId = (Date.now() + 1).toString();
        this.currentStreamingMessage = {
            id: streamingMessageId,
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            isStreaming: true
        };

        this.sendToWebview({ type: 'messageAdded', message: this.currentStreamingMessage });
        this.isStreaming = true;

        if (this.statusBarProvider) {
            this.statusBarProvider.setOperationInProgress(true, 'Chat Stream');
        }

        try {
            let fullContent = '';
            let stats = null;

            await this.client.streamChatCompletion({
                model: activeModel.id,
                messages: messages,
                temperature: config.chatSettings.temperature,
                max_tokens: config.chatSettings.maxTokens
            }, (chunk) => {
                if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) {
                    const delta = chunk.choices[0].delta;
                    if (delta.content) {
                        fullContent += delta.content;
                        this.currentStreamingMessage.content = fullContent;
                        this.sendToWebview({
                            type: 'messageUpdated',
                            messageId: streamingMessageId,
                            content: fullContent,
                            isStreaming: true
                        });
                    }
                }
                if (chunk.stats) {
                    stats = chunk.stats;
                }
            });

            this.currentStreamingMessage.isStreaming = false;
            this.currentStreamingMessage.content = fullContent;
            this.chatHistory.push(this.currentStreamingMessage);
            await this.saveChatHistory();

            if (this.statusBarProvider && stats) {
                this.statusBarProvider.setPerformanceMetrics({
                    tokensPerSecond: stats.tokens_per_second,
                    generationTime: stats.generation_time,
                    timeToFirstToken: stats.time_to_first_token
                });
            }

            this.sendToWebview({
                type: 'messageUpdated',
                messageId: streamingMessageId,
                content: fullContent,
                isStreaming: false,
                stats: stats
            });

        } catch (error) {
            console.error('Error in chat completion:', error);
            this.sendToWebview({ type: 'messageRemoved', messageId: streamingMessageId });
            this.sendError(`Failed to get response: ${error.message}`, 'Chat Completion');
        } finally {
            this.isStreaming = false;
            this.currentStreamingMessage = null;
            if (this.statusBarProvider) {
                this.statusBarProvider.setOperationInProgress(false);
            }
        }
    }

    async handleClearChat() {
        const choice = await vscode.window.showWarningMessage(
            'Clear chat history? This cannot be undone.',
            { modal: true },
            'Clear'
        );
        
        if (choice === 'Clear') {
            this.chatHistory = [];
            await this.saveChatHistory();
            this.sendToWebview({ type: 'chatCleared' });
        }
    }

    async handleSelectModel(modelId) {
        try {
            await this.modelCommands.setActiveModel(modelId);
            await this.updateWebviewState();
        } catch (error) {
            this.sendError(`Failed to select model: ${error.message}`, 'Model Selection');
        }
    }

    async handleRefreshModels() {
        try {
            await this.modelCommands.refreshModels();
            await this.updateWebviewState();
        } catch (error) {
            this.sendError(`Failed to refresh models: ${error.message}`, 'Model Refresh');
        }
    }

    async handleUpdateSettings(settings) {
        try {
            const updates = {};
            if (settings.temperature !== undefined) {
                updates['chatSettings.temperature'] = settings.temperature;
            }
            if (settings.maxTokens !== undefined) {
                updates['chatSettings.maxTokens'] = settings.maxTokens;
            }
            if (settings.systemPrompt !== undefined) {
                updates['chatSettings.systemPrompt'] = settings.systemPrompt;
            }
            await this.configManager.updateConfiguration(updates);
            this.sendSuccess('Settings saved successfully');
        } catch (error) {
            this.sendError(`Failed to update settings: ${error.message}`, 'Settings Update');
        }
    }

    sendToWebview(message) {
        if (this._view && this._view.webview) {
            this._view.webview.postMessage(message);
        }
    }

    sendError(message, context = 'Unknown') {
        const errorMessage = message instanceof Error ? message.message : String(message);
        this.sendToWebview({
            type: 'error',
            message: errorMessage,
            context: context,
            timestamp: new Date().toISOString()
        });
    }

    sendSuccess(message, data = null) {
        this.sendToWebview({
            type: 'success',
            message: message,
            data: data,
            timestamp: new Date().toISOString()
        });
    }

    async updateWebviewState() {
        if (!this._view) {
            console.log('ChatViewProvider: No view available yet');
            return;
        }

        console.log('ChatViewProvider: Updating webview state...');

        try {
            const config = this.configManager.getConfiguration();
            const activeModel = this.modelCommands ? this.modelCommands.getActiveModel() : null;
            const availableModels = this.modelCommands ? this.modelCommands.getAvailableModels() : [];

            console.log('ChatViewProvider: Active model:', activeModel?.id || 'none');
            console.log('ChatViewProvider: Available models:', availableModels.length);

            // If no models available, try to refresh them
            if (availableModels.length === 0 && this.modelCommands) {
                console.log('ChatViewProvider: No models available, attempting to refresh...');
                try {
                    await this.modelCommands.refreshModels(false);
                    // Get models again after refresh
                    const refreshedModels = this.modelCommands.getAvailableModels();
                    this.sendToWebview({
                        type: 'stateUpdate',
                        state: {
                            chatHistory: this.chatHistory,
                            activeModel: this.modelCommands.getActiveModel(),
                            availableModels: refreshedModels,
                            settings: {
                                temperature: config.chatSettings.temperature,
                                maxTokens: config.chatSettings.maxTokens,
                                systemPrompt: config.chatSettings.systemPrompt
                            },
                            isStreaming: this.isStreaming
                        }
                    });
                    return;
                } catch (refreshError) {
                    console.error('Failed to refresh models:', refreshError);
                }
            }

            console.log('ChatViewProvider: Sending state update to webview');
            this.sendToWebview({
                type: 'stateUpdate',
                state: {
                    chatHistory: this.chatHistory,
                    activeModel: activeModel,
                    availableModels: availableModels,
                    settings: {
                        temperature: config.chatSettings.temperature,
                        maxTokens: config.chatSettings.maxTokens,
                        systemPrompt: config.chatSettings.systemPrompt
                    },
                    isStreaming: this.isStreaming
                }
            });
            console.log('ChatViewProvider: State update sent successfully');
        } catch (error) {
            console.error('ChatViewProvider: Error updating webview state:', error);
            // Send empty state to unblock the UI
            this.sendToWebview({
                type: 'stateUpdate',
                state: {
                    chatHistory: [],
                    activeModel: null,
                    availableModels: [],
                    settings: {
                        temperature: 0.7,
                        maxTokens: 1000,
                        systemPrompt: 'You are a helpful AI assistant.'
                    },
                    isStreaming: false
                }
            });
        }
    }

    getWebviewContent(extensionUri, webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'ui', 'webview', 'chat.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'ui', 'webview', 'chat.css'));
        
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link href="${styleUri}" rel="stylesheet">
    <title>Local LLM Chat</title>
    <style>
        /* Sidebar-specific overrides */
        body {
            padding: 8px;
            font-size: 13px;
        }
        .chat-header {
            padding: 8px;
            margin-bottom: 8px;
        }
        .model-selector {
            flex-direction: column;
            gap: 4px;
        }
        .model-selector label {
            font-size: 11px;
        }
        #model-select {
            width: 100%;
            font-size: 12px;
        }
        .chat-messages {
            height: calc(100vh - 250px);
            font-size: 13px;
        }
        .message {
            padding: 8px;
            margin-bottom: 8px;
        }
        .chat-input-container {
            padding: 8px;
        }
        #message-input {
            font-size: 13px;
            min-height: 60px;
        }
        .settings-panel {
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div id="app">
        <div class="chat-header">
            <div class="model-selector">
                <label for="model-select">Model:</label>
                <select id="model-select" disabled>
                    <option value="">Loading...</option>
                </select>
                <button id="refresh-models" title="Refresh Models">🔄</button>
            </div>
            <div class="chat-actions">
                <button id="clear-chat" title="Clear Chat">🗑️</button>
                <button id="settings-toggle" title="Settings">⚙️</button>
            </div>
        </div>

        <div id="settings-panel" class="settings-panel hidden">
            <div class="settings-content">
                <h3>Settings</h3>
                <div class="setting-group">
                    <label for="temperature">Temperature:</label>
                    <input type="range" id="temperature" min="0" max="2" step="0.1" value="0.7">
                    <span id="temperature-value">0.7</span>
                </div>
                <div class="setting-group">
                    <label for="max-tokens">Max Tokens:</label>
                    <input type="number" id="max-tokens" min="1" max="100000" value="1000">
                </div>
                <div class="setting-group">
                    <label for="system-prompt">System Prompt:</label>
                    <textarea id="system-prompt" rows="3" placeholder="Enter system prompt..."></textarea>
                </div>
                <div class="settings-actions">
                    <button id="save-settings">Save</button>
                    <button id="cancel-settings">Cancel</button>
                </div>
            </div>
        </div>

        <div class="chat-container">
            <div id="chat-messages" class="chat-messages">
                <div class="welcome-message">
                    <h3>Local LLM Chat</h3>
                    <p>Select a model and start chatting!</p>
                </div>
            </div>
        </div>

        <div class="chat-input-container">
            <div class="input-wrapper">
                <textarea id="message-input" placeholder="Type your message..." rows="1"></textarea>
                <button id="send-button" disabled>Send</button>
            </div>
        </div>

        <div id="status-bar" class="status-bar">
            <span id="status-text">Ready</span>
        </div>
    </div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    async loadChatHistory() {
        try {
            const history = this.configManager.getPersistedValue('chatHistory');
            if (history && Array.isArray(history)) {
                this.chatHistory = history;
            }
        } catch (error) {
            console.error('Failed to load chat history:', error);
            this.chatHistory = [];
        }
    }

    async saveChatHistory() {
        try {
            if (this.chatHistory.length > this.maxHistorySize) {
                this.chatHistory = this.chatHistory.slice(-this.maxHistorySize);
            }
            await this.configManager.setPersistedValue('chatHistory', this.chatHistory);
        } catch (error) {
            console.error('Failed to save chat history:', error);
        }
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

module.exports = { ChatViewProvider };
