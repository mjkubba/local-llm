const vscode = require('vscode');
const path = require('path');

/**
 * Chat panel webview provider for LM Studio integration
 */
class ChatPanel {
    constructor(configManager, modelCommands, client) {
        this.configManager = configManager;
        this.modelCommands = modelCommands;
        this.client = client;
        this.panel = null;
        this.chatHistory = [];
        this.isStreaming = false;
        this.currentStreamingMessage = null;
        this.maxHistorySize = 100; // Maximum number of messages to keep in history
        this.healthCheckInterval = null;
        this.lastPingTime = null;
        this.statusBarProvider = null;
        
        // Load persisted chat history
        this.loadChatHistory();
    }

    /**
     * Set the status bar provider for operation status updates
     * @param {StatusBarProvider} statusBarProvider 
     */
    setStatusBarProvider(statusBarProvider) {
        this.statusBarProvider = statusBarProvider;
    }

    /**
     * Create or show the chat panel
     * @param {vscode.ExtensionContext} context 
     */
    async createOrShow(context) {
        const columnToShowIn = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (this.panel) {
            // If panel already exists, just show it
            this.panel.reveal(columnToShowIn);
            return;
        }

        // Create new panel
        this.panel = vscode.window.createWebviewPanel(
            'lmstudioChat',
            'Local LLM Chat',
            columnToShowIn || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'src', 'ui', 'webview')
                ]
            }
        );

        // Set the webview's initial html content
        this.panel.webview.html = this.getWebviewContent(context);

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            message => this.handleWebviewMessage(message),
            undefined,
            context.subscriptions
        );

        // Handle panel disposal
        this.panel.onDidDispose(
            () => {
                this.panel = null;
            },
            null,
            context.subscriptions
        );

        // Send initial state to webview
        await this.updateWebviewState();
        
        // Start health check
        this.startHealthCheck();
    }

    /**
     * Handle messages from the webview
     * @param {Object} message - Message from webview
     */
    async handleWebviewMessage(message) {
        try {
            // Validate message structure
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
                case 'exportChat':
                    await this.handleExportChat();
                    break;
                case 'importChat':
                    if (!message.data) {
                        throw new Error('Import data is required');
                    }
                    await this.handleImportChat(message.data);
                    break;
                case 'newSession':
                    await this.handleNewSession();
                    break;
                case 'ready':
                    await this.updateWebviewState();
                    break;
                case 'ping':
                    // Health check from webview
                    this.lastPingTime = Date.now();
                    this.sendToWebview({ type: 'pong' });
                    break;
                default:
                    console.warn('Unknown message type:', message.type);
                    this.sendToWebview({
                        type: 'error',
                        message: `Unknown message type: ${message.type}`
                    });
            }
        } catch (error) {
            console.error('Error handling webview message:', error);
            this.sendToWebview({
                type: 'error',
                message: error.message || 'An unexpected error occurred'
            });
        }
    }

    /**
     * Handle sending a message to the AI
     * @param {string} userMessage - User's message
     * @param {string} systemPrompt - Optional system prompt override
     */
    async handleSendMessage(userMessage, systemPrompt) {
        if (this.isStreaming) {
            this.sendError('Please wait for the current response to complete', 'Send Message');
            return;
        }

        const activeModel = this.modelCommands.getActiveModel();
        if (!activeModel) {
            this.sendError('No active model selected. Please select a model first.', 'Send Message');
            return;
        }

        // Add user message to history
        const userMessageObj = {
            id: Date.now().toString(),
            role: 'user',
            content: userMessage,
            timestamp: new Date().toISOString()
        };
        
        this.chatHistory.push(userMessageObj);
        
        // Save updated chat history
        await this.saveChatHistory();
        
        // Send user message to webview
        this.sendToWebview({
            type: 'messageAdded',
            message: userMessageObj
        });

        // Prepare messages for API call
        const config = this.configManager.getConfiguration();
        const messages = [];
        
        // Add system prompt
        const finalSystemPrompt = systemPrompt || config.chatSettings.systemPrompt;
        if (finalSystemPrompt) {
            messages.push({
                role: 'system',
                content: finalSystemPrompt
            });
        }

        // Add recent chat history (limit to prevent context overflow)
        const recentHistory = this.chatHistory.slice(-20);
        messages.push(...recentHistory.map(msg => ({
            role: msg.role,
            content: msg.content
        })));

        // Create assistant message placeholder
        const assistantMessageId = (Date.now() + 1).toString();
        this.currentStreamingMessage = {
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            isStreaming: true
        };

        this.sendToWebview({
            type: 'messageAdded',
            message: this.currentStreamingMessage
        });

        this.isStreaming = true;

        // Set operation in progress in status bar
        if (this.statusBarProvider) {
            this.statusBarProvider.setOperationInProgress(true, 'Chat Stream');
        }

        try {
            let fullContent = '';
            let finalStats = null;

            // Use streaming chat completion
            await this.client.streamChatCompletion({
                model: activeModel.id,
                messages: messages,
                temperature: config.chatSettings.temperature,
                max_tokens: config.chatSettings.maxTokens
            }, (chunk) => {
                // Handle streaming chunk
                if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) {
                    const delta = chunk.choices[0].delta;
                    if (delta.content) {
                        fullContent += delta.content;
                        this.currentStreamingMessage.content = fullContent;
                        
                        this.sendToWebview({
                            type: 'messageUpdated',
                            messageId: assistantMessageId,
                            content: fullContent,
                            isStreaming: true
                        });
                    }
                }
                
                // Capture final stats if available
                if (chunk.stats) {
                    finalStats = chunk.stats;
                }
            });

            // Finalize the message
            this.currentStreamingMessage.isStreaming = false;
            this.currentStreamingMessage.content = fullContent;
            this.chatHistory.push(this.currentStreamingMessage);

            // Save updated chat history
            await this.saveChatHistory();

            // Update performance metrics in status bar
            if (this.statusBarProvider && finalStats) {
                this.statusBarProvider.setPerformanceMetrics({
                    tokensPerSecond: finalStats.tokens_per_second,
                    generationTime: finalStats.generation_time,
                    timeToFirstToken: finalStats.time_to_first_token
                });
            }

            this.sendToWebview({
                type: 'messageUpdated',
                messageId: assistantMessageId,
                content: fullContent,
                isStreaming: false,
                stats: finalStats
            });

        } catch (error) {
            console.error('Error in chat completion:', error);
            
            // Remove the placeholder message
            this.sendToWebview({
                type: 'messageRemoved',
                messageId: assistantMessageId
            });

            this.sendError(`Failed to get response: ${error.message}`, 'Chat Completion');
        } finally {
            this.isStreaming = false;
            this.currentStreamingMessage = null;
            
            // Clear operation in progress in status bar
            if (this.statusBarProvider) {
                this.statusBarProvider.setOperationInProgress(false);
            }
        }
    }

    /**
     * Handle clearing chat history
     */
    async handleClearChat() {
        const choice = await vscode.window.showWarningMessage(
            'Clear chat history? This cannot be undone.',
            { modal: true },
            'Clear'
        );
        
        if (choice === 'Clear') {
            this.chatHistory = [];
            await this.saveChatHistory();
            this.sendToWebview({
                type: 'chatCleared'
            });
        }
    }

    /**
     * Handle model selection
     * @param {string} modelId - ID of the model to select
     */
    async handleSelectModel(modelId) {
        try {
            await this.modelCommands.setActiveModel(modelId);
            await this.updateWebviewState();
        } catch (error) {
            this.sendError(`Failed to select model: ${error.message}`, 'Model Selection');
        }
    }

    /**
     * Handle refreshing models list
     */
    async handleRefreshModels() {
        try {
            await this.modelCommands.refreshModels();
            await this.updateWebviewState();
        } catch (error) {
            this.sendError(`Failed to refresh models: ${error.message}`, 'Model Refresh');
        }
    }

    /**
     * Handle updating chat settings
     * @param {Object} settings - New settings
     */
    async handleUpdateSettings(settings) {
        try {
            const updates = {};
            
            // Update chat settings
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

    /**
     * Handle exporting chat history
     */
    async handleExportChat() {
        try {
            const exportData = this.exportChatHistory();
            const fileName = `lmstudio-chat-${new Date().toISOString().split('T')[0]}.json`;
            
            this.sendToWebview({
                type: 'chatExported',
                data: exportData,
                fileName: fileName
            });
            
        } catch (error) {
            this.sendError(`Failed to export chat: ${error.message}`, 'Chat Export');
        }
    }

    /**
     * Handle importing chat history
     * @param {Object} importData - Chat data to import
     */
    async handleImportChat(importData) {
        try {
            await this.importChatHistory(importData);
            
            this.sendSuccess('Chat history imported successfully');
            
        } catch (error) {
            this.sendError(`Failed to import chat: ${error.message}`, 'Chat Import');
        }
    }

    /**
     * Handle starting a new chat session
     */
    async handleNewSession() {
        try {
            // Save current session before clearing
            if (this.chatHistory.length > 0) {
                const sessionData = {
                    timestamp: new Date().toISOString(),
                    messageCount: this.chatHistory.length,
                    model: this.modelCommands.getActiveModel()?.id || 'unknown',
                    history: [...this.chatHistory]
                };
                
                // Store in session history (could be expanded to multiple sessions)
                await this.configManager.setPersistedValue('lastSession', sessionData);
            }
            
            // Clear current chat
            this.chatHistory = [];
            await this.saveChatHistory();
            
            this.sendSuccess('New chat session started');
            
            // Update webview to show empty state
            await this.updateWebviewState();
            
        } catch (error) {
            this.sendError(`Failed to start new session: ${error.message}`, 'New Session');
        }
    }

    /**
     * Send message to webview with error handling
     * @param {Object} message - Message to send
     * @param {number} retries - Number of retry attempts
     */
    sendToWebview(message, retries = 3) {
        if (!this.panel || !this.panel.webview) {
            console.warn('Cannot send message: webview not available');
            return false;
        }

        try {
            // Add timestamp and message ID for tracking
            const messageWithMeta = {
                ...message,
                timestamp: Date.now(),
                id: Math.random().toString(36).substr(2, 9)
            };

            this.panel.webview.postMessage(messageWithMeta);
            return true;
        } catch (error) {
            console.error('Failed to send message to webview:', error);
            
            if (retries > 0) {
                // Retry after a short delay
                setTimeout(() => {
                    this.sendToWebview(message, retries - 1);
                }, 100);
            }
            
            return false;
        }
    }

    /**
     * Send error message to webview with proper formatting
     * @param {string|Error} error - Error message or Error object
     * @param {string} context - Context where the error occurred
     */
    sendError(error, context = 'Unknown') {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        this.sendToWebview({
            type: 'error',
            message: errorMessage,
            context: context,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Send success message to webview
     * @param {string} message - Success message
     * @param {Object} data - Optional additional data
     */
    sendSuccess(message, data = null) {
        this.sendToWebview({
            type: 'success',
            message: message,
            data: data,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Update webview with current state
     */
    async updateWebviewState() {
        try {
            const config = this.configManager.getConfiguration();
            const activeModel = this.modelCommands.getActiveModel();
            const availableModels = this.modelCommands.getAvailableModels();

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
        } catch (error) {
            console.error('Error updating webview state:', error);
        }
    }

    /**
     * Get the webview HTML content
     * @param {vscode.ExtensionContext} context 
     * @returns {string} HTML content
     */
    getWebviewContent(context) {
        // Get URIs for webview resources
        const scriptUri = this.panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'src', 'ui', 'webview', 'chat.js')
        );
        const styleUri = this.panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'src', 'ui', 'webview', 'chat.css')
        );

        // Use a nonce to whitelist which scripts can be run
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link href="${styleUri}" rel="stylesheet">
    <title>Local LLM Chat</title>
</head>
<body>
    <div id="app">
        <div class="chat-header">
            <div class="model-selector">
                <label for="model-select">Model:</label>
                <select id="model-select" disabled>
                    <option value="">Loading models...</option>
                </select>
                <button id="refresh-models" title="Refresh Models">🔄</button>
            </div>
            <div class="chat-actions">
                <button id="new-session" title="New Session">📄</button>
                <button id="export-chat" title="Export Chat">💾</button>
                <button id="clear-chat" title="Clear Chat">🗑️</button>
                <button id="settings-toggle" title="Settings">⚙️</button>
            </div>
        </div>

        <div id="settings-panel" class="settings-panel hidden">
            <div class="settings-content">
                <h3>Chat Settings</h3>
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
                    <h3>Welcome to Local LLM Chat</h3>
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

    /**
     * Load chat history from persistent storage
     */
    async loadChatHistory() {
        try {
            const savedHistory = this.configManager.getPersistedValue('chatHistory');
            if (savedHistory && Array.isArray(savedHistory)) {
                this.chatHistory = savedHistory;
            }
        } catch (error) {
            console.error('Failed to load chat history:', error);
            this.chatHistory = [];
        }
    }

    /**
     * Save chat history to persistent storage
     */
    async saveChatHistory() {
        try {
            // Limit history size to prevent excessive memory usage
            if (this.chatHistory.length > this.maxHistorySize) {
                this.chatHistory = this.chatHistory.slice(-this.maxHistorySize);
            }
            
            await this.configManager.setPersistedValue('chatHistory', this.chatHistory);
        } catch (error) {
            console.error('Failed to save chat history:', error);
        }
    }

    /**
     * Get chat session summary for persistence
     */
    getChatSessionSummary() {
        return {
            messageCount: this.chatHistory.length,
            lastActivity: this.chatHistory.length > 0 ? 
                this.chatHistory[this.chatHistory.length - 1].timestamp : null,
            activeModel: this.modelCommands.getActiveModel()?.id || null
        };
    }

    /**
     * Export chat history for backup or sharing
     */
    exportChatHistory() {
        return {
            version: '1.0',
            exportDate: new Date().toISOString(),
            chatHistory: this.chatHistory,
            sessionSummary: this.getChatSessionSummary()
        };
    }

    /**
     * Import chat history from backup
     * @param {Object} exportData - Exported chat data
     */
    async importChatHistory(exportData) {
        try {
            if (exportData.version === '1.0' && Array.isArray(exportData.chatHistory)) {
                this.chatHistory = exportData.chatHistory;
                await this.saveChatHistory();
                await this.updateWebviewState();
            } else {
                throw new Error('Invalid export data format');
            }
        } catch (error) {
            console.error('Failed to import chat history:', error);
            throw error;
        }
    }

    /**
     * Start health check for webview communication
     */
    startHealthCheck() {
        // Clear existing interval
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
        
        // Start new health check every 30 seconds
        this.healthCheckInterval = setInterval(() => {
            this.performHealthCheck();
        }, 30000);
    }

    /**
     * Perform health check by pinging webview
     */
    performHealthCheck() {
        if (!this.panel) {
            return;
        }
        
        const now = Date.now();
        
        // Check if we've received a ping recently
        if (this.lastPingTime && (now - this.lastPingTime) > 60000) {
            console.warn('Webview communication may be stale');
        }
        
        // Send ping to webview
        this.sendToWebview({ type: 'healthCheck' });
    }

    /**
     * Stop health check
     */
    stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }

    /**
     * Dispose of the chat panel
     */
    dispose() {
        this.stopHealthCheck();
        
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }
    }
}

/**
 * Generate a nonce for CSP
 * @returns {string} Random nonce
 */
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

module.exports = { ChatPanel };