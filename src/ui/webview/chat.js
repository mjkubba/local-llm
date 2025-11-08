// Chat webview JavaScript
(function() {
    'use strict';

    // Get VS Code API
    const vscode = acquireVsCodeApi();

    // State management
    let state = {
        chatHistory: [],
        activeModel: null,
        availableModels: [],
        settings: {
            temperature: 0.7,
            maxTokens: 1000,
            systemPrompt: ''
        },
        isStreaming: false
    };

    // DOM elements
    let elements = {};

    // Initialize the chat interface
    function initialize() {
        // Get DOM elements
        elements = {
            modelSelect: document.getElementById('model-select'),
            refreshModels: document.getElementById('refresh-models'),
            newSession: document.getElementById('new-session'),
            exportChat: document.getElementById('export-chat'),
            clearChat: document.getElementById('clear-chat'),
            settingsToggle: document.getElementById('settings-toggle'),
            settingsPanel: document.getElementById('settings-panel'),
            saveSettings: document.getElementById('save-settings'),
            cancelSettings: document.getElementById('cancel-settings'),
            chatMessages: document.getElementById('chat-messages'),
            messageInput: document.getElementById('message-input'),
            sendButton: document.getElementById('send-button'),
            statusText: document.getElementById('status-text'),
            temperature: document.getElementById('temperature'),
            temperatureValue: document.getElementById('temperature-value'),
            maxTokens: document.getElementById('max-tokens'),
            systemPrompt: document.getElementById('system-prompt')
        };

        // Set up event listeners
        setupEventListeners();

        // Request initial state
        vscode.postMessage({ type: 'ready' });

        // Set initial status
        updateStatus('Initializing...');
    }

    // Set up all event listeners
    function setupEventListeners() {
        // Model selection
        elements.modelSelect.addEventListener('change', (e) => {
            if (e.target.value) {
                vscode.postMessage({
                    type: 'selectModel',
                    modelId: e.target.value
                });
            }
        });

        // Refresh models
        elements.refreshModels.addEventListener('click', () => {
            vscode.postMessage({ type: 'refreshModels' });
            updateStatus('Refreshing models...');
        });

        // New session (optional - only in panel view)
        if (elements.newSession) {
            elements.newSession.addEventListener('click', () => {
                if (state.chatHistory.length > 0) {
                    if (confirm('Start a new chat session? Current conversation will be saved.')) {
                        vscode.postMessage({ type: 'newSession' });
                    }
                } else {
                    vscode.postMessage({ type: 'newSession' });
                }
            });
        }

        // Export chat (optional - only in panel view)
        if (elements.exportChat) {
            elements.exportChat.addEventListener('click', () => {
                if (state.chatHistory.length > 0) {
                    vscode.postMessage({ type: 'exportChat' });
                } else {
                    alert('No chat history to export');
                }
            });
        }

        // Clear chat
        elements.clearChat.addEventListener('click', () => {
            if (confirm('Clear chat history? This cannot be undone.')) {
                vscode.postMessage({ type: 'clearChat' });
            }
        });

        // Settings toggle
        elements.settingsToggle.addEventListener('click', () => {
            toggleSettings();
        });

        // Settings actions
        elements.saveSettings.addEventListener('click', () => {
            saveSettings();
        });

        elements.cancelSettings.addEventListener('click', () => {
            hideSettings();
            loadSettingsFromState();
        });

        // Temperature slider
        elements.temperature.addEventListener('input', (e) => {
            elements.temperatureValue.textContent = e.target.value;
        });

        // Message input
        elements.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        elements.messageInput.addEventListener('input', () => {
            autoResizeTextarea(elements.messageInput);
            updateSendButton();
        });

        // Send button
        elements.sendButton.addEventListener('click', () => {
            sendMessage();
        });

        // Listen for messages from extension
        window.addEventListener('message', (event) => {
            handleExtensionMessage(event.data);
        });
    }

    // Handle messages from the extension
    function handleExtensionMessage(message) {
        switch (message.type) {
            case 'stateUpdate':
                updateState(message.state);
                break;
            case 'messageAdded':
                addMessage(message.message);
                break;
            case 'messageUpdated':
                updateMessage(message.messageId, message.content, message.isStreaming, message.stats);
                break;
            case 'messageRemoved':
                removeMessage(message.messageId);
                break;
            case 'chatCleared':
                clearChatDisplay();
                break;
            case 'error':
                showError(message.message, message.context);
                break;
            case 'success':
                showSuccess(message.message);
                break;
            case 'settingsUpdated':
                updateStatus(message.message);
                break;
            case 'sessionStarted':
                updateStatus(message.message);
                break;
            case 'chatExported':
                downloadChatExport(message.data, message.fileName);
                break;
            case 'chatImported':
                updateStatus(message.message);
                break;
            case 'healthCheck':
                // Respond to health check
                vscode.postMessage({ type: 'ping' });
                break;
            case 'pong':
                // Extension responded to our ping
                console.log('Extension communication healthy');
                break;
            default:
                console.warn('Unknown message type:', message.type);
        }
    }

    // Update the entire state
    function updateState(newState) {
        state = { ...state, ...newState };
        
        // Update UI components
        updateModelSelector();
        updateChatDisplay();
        updateSettingsDisplay();
        updateSendButton();
        
        if (state.activeModel) {
            updateStatus(`Connected to ${state.activeModel.id}`);
        } else {
            updateStatus('No model selected');
        }
    }

    // Update model selector dropdown
    function updateModelSelector() {
        const select = elements.modelSelect;
        
        // Clear existing options
        select.innerHTML = '';
        
        if (state.availableModels.length === 0) {
            select.innerHTML = '<option value="">No models available</option>';
            select.disabled = true;
            return;
        }

        // Add default option
        select.innerHTML = '<option value="">Select a model...</option>';
        
        // Add model options
        state.availableModels.forEach(model => {
            const option = document.createElement('option');
            option.value = model.id;
            option.textContent = `${model.id} (${model.arch})`;
            if (model.state === 'loaded') {
                option.textContent += ' ✓';
            }
            select.appendChild(option);
        });

        // Select active model
        if (state.activeModel) {
            select.value = state.activeModel.id;
        }

        select.disabled = false;
    }

    // Update chat display
    function updateChatDisplay() {
        const container = elements.chatMessages;
        
        // Clear existing messages
        container.innerHTML = '';
        
        if (state.chatHistory.length === 0) {
            container.innerHTML = `
                <div class="welcome-message">
                    <h3>Welcome to LM Studio Chat</h3>
                    <p>Select a model and start chatting with your local AI!</p>
                </div>
            `;
            return;
        }

        // Add messages
        state.chatHistory.forEach(message => {
            addMessageToDOM(message);
        });

        // Scroll to bottom
        scrollToBottom();
    }

    // Add a single message to the display
    function addMessage(message) {
        // Add to state if not already there
        if (!state.chatHistory.find(m => m.id === message.id)) {
            state.chatHistory.push(message);
        }

        // Remove welcome message if present
        const welcomeMessage = elements.chatMessages.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }

        // Add to DOM
        addMessageToDOM(message);
        scrollToBottom();
    }

    // Add message to DOM
    function addMessageToDOM(message) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.role}`;
        messageElement.id = `message-${message.id}`;

        const timestamp = new Date(message.timestamp).toLocaleTimeString();
        
        messageElement.innerHTML = `
            <div class="message-header">
                <span class="message-role">${message.role}</span>
                <span class="message-timestamp">${timestamp}</span>
                ${message.isStreaming ? '<span class="streaming-indicator"></span>' : ''}
            </div>
            <div class="message-content">${formatMessageContent(message.content)}</div>
            ${message.stats ? `<div class="message-stats">${formatStats(message.stats)}</div>` : ''}
        `;

        elements.chatMessages.appendChild(messageElement);
    }

    // Update an existing message
    function updateMessage(messageId, content, isStreaming, stats) {
        const messageElement = document.getElementById(`message-${messageId}`);
        if (!messageElement) return;

        // Update content
        const contentElement = messageElement.querySelector('.message-content');
        contentElement.innerHTML = formatMessageContent(content);

        // Update streaming indicator
        const header = messageElement.querySelector('.message-header');
        const existingIndicator = header.querySelector('.streaming-indicator');
        
        if (isStreaming && !existingIndicator) {
            header.insertAdjacentHTML('beforeend', '<span class="streaming-indicator"></span>');
        } else if (!isStreaming && existingIndicator) {
            existingIndicator.remove();
        }

        // Update stats
        let statsElement = messageElement.querySelector('.message-stats');
        if (stats) {
            if (!statsElement) {
                statsElement = document.createElement('div');
                statsElement.className = 'message-stats';
                messageElement.appendChild(statsElement);
            }
            statsElement.innerHTML = formatStats(stats);
        }

        // Update state
        const messageInState = state.chatHistory.find(m => m.id === messageId);
        if (messageInState) {
            messageInState.content = content;
            messageInState.isStreaming = isStreaming;
            if (stats) {
                messageInState.stats = stats;
            }
        }

        // Clear status when streaming is complete
        if (!isStreaming) {
            if (state.activeModel) {
                updateStatus(`Connected to ${state.activeModel.id}`);
            } else {
                updateStatus('Ready');
            }
        }

        scrollToBottom();
    }

    // Remove a message
    function removeMessage(messageId) {
        const messageElement = document.getElementById(`message-${messageId}`);
        if (messageElement) {
            messageElement.remove();
        }

        // Remove from state
        state.chatHistory = state.chatHistory.filter(m => m.id !== messageId);
    }

    // Format message content with syntax highlighting
    function formatMessageContent(content) {
        if (!content) return '';

        // Convert markdown-style code blocks to HTML
        let formatted = content
            .replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
                return `<pre><code class="language-${lang || 'text'}">${escapeHtml(code.trim())}</code></pre>`;
            })
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');

        return formatted;
    }

    // Format performance stats
    function formatStats(stats) {
        if (!stats) return '';
        
        const tokensPerSec = stats.tokens_per_second ? `${stats.tokens_per_second.toFixed(1)} tok/s` : '';
        const genTime = stats.generation_time ? `${stats.generation_time.toFixed(0)}ms` : '';
        
        return [tokensPerSec, genTime].filter(Boolean).join(' • ');
    }

    // Escape HTML characters
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Clear chat display
    function clearChatDisplay() {
        state.chatHistory = [];
        updateChatDisplay();
        updateStatus('Chat cleared');
    }

    // Send a message
    function sendMessage() {
        const message = elements.messageInput.value.trim();
        if (!message || state.isStreaming) return;

        // Get current system prompt from settings
        const systemPrompt = elements.systemPrompt.value.trim();

        // Send to extension
        vscode.postMessage({
            type: 'sendMessage',
            text: message,
            systemPrompt: systemPrompt || undefined
        });

        // Clear input
        elements.messageInput.value = '';
        autoResizeTextarea(elements.messageInput);
        updateSendButton();
        
        // Update status
        updateStatus('Sending message...');
    }

    // Update send button state
    function updateSendButton() {
        const hasMessage = elements.messageInput.value.trim().length > 0;
        const hasModel = state.activeModel !== null;
        const notStreaming = !state.isStreaming;
        
        elements.sendButton.disabled = !hasMessage || !hasModel || !notStreaming;
    }

    // Auto-resize textarea
    function autoResizeTextarea(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }

    // Settings management
    function toggleSettings() {
        const panel = elements.settingsPanel;
        if (panel.classList.contains('visible')) {
            hideSettings();
        } else {
            showSettings();
        }
    }

    function showSettings() {
        elements.settingsPanel.classList.remove('hidden');
        elements.settingsPanel.classList.add('visible');
        loadSettingsFromState();
    }

    function hideSettings() {
        elements.settingsPanel.classList.remove('visible');
        elements.settingsPanel.classList.add('hidden');
    }

    function loadSettingsFromState() {
        elements.temperature.value = state.settings.temperature;
        elements.temperatureValue.textContent = state.settings.temperature;
        elements.maxTokens.value = state.settings.maxTokens;
        elements.systemPrompt.value = state.settings.systemPrompt;
    }

    function saveSettings() {
        const settings = {
            temperature: parseFloat(elements.temperature.value),
            maxTokens: parseInt(elements.maxTokens.value),
            systemPrompt: elements.systemPrompt.value.trim()
        };

        vscode.postMessage({
            type: 'updateSettings',
            settings: settings
        });

        hideSettings();
        updateStatus('Settings saved');
    }

    function updateSettingsDisplay() {
        // Update settings panel if visible
        if (elements.settingsPanel.classList.contains('visible')) {
            loadSettingsFromState();
        }
    }

    // Utility functions
    function updateStatus(message) {
        elements.statusText.textContent = message;
    }

    function showError(message, context = '') {
        // Create error element
        const errorElement = document.createElement('div');
        errorElement.className = 'error-message';
        errorElement.innerHTML = `
            <strong>Error${context ? ` (${context})` : ''}:</strong> ${escapeHtml(message)}
            <button class="close-btn" onclick="this.parentElement.remove()">×</button>
        `;
        
        // Insert at top of chat
        elements.chatMessages.insertBefore(errorElement, elements.chatMessages.firstChild);
        
        // Remove after 8 seconds
        setTimeout(() => {
            if (errorElement.parentNode) {
                errorElement.parentNode.removeChild(errorElement);
            }
        }, 8000);

        updateStatus('Error occurred');
    }

    function showSuccess(message) {
        // Create success element
        const successElement = document.createElement('div');
        successElement.className = 'success-message';
        successElement.innerHTML = `
            <strong>Success:</strong> ${escapeHtml(message)}
            <button class="close-btn" onclick="this.parentElement.remove()">×</button>
        `;
        
        // Insert at top of chat
        elements.chatMessages.insertBefore(successElement, elements.chatMessages.firstChild);
        
        // Remove after 4 seconds
        setTimeout(() => {
            if (successElement.parentNode) {
                successElement.parentNode.removeChild(successElement);
            }
        }, 4000);

        updateStatus(message);
    }

    function scrollToBottom() {
        elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    }

    function downloadChatExport(data, fileName) {
        try {
            const jsonString = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            updateStatus('Chat exported successfully');
        } catch (error) {
            showError('Failed to download chat export');
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();