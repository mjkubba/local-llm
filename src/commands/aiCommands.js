const vscode = require('vscode');
const { LocalLLMClient } = require('../services/localLLMClient');
const { LMStudioError } = require('../models/errors');
const { ERROR_CATEGORIES } = require('../models/constants');
const { ChatPanel } = require('../ui/chatPanel');

/**
 * AI interaction commands for chat, completion, and embedding generation
 */
class AICommands {
    constructor(configManager, modelCommands) {
        this.configManager = configManager;
        this.modelCommands = modelCommands;
        this.client = null;
        this.chatHistory = [];
        this.chatPanel = null;
        this.context = null;
        this.statusBarProvider = null;
    }

    /**
     * Initialize the AI commands with LM Studio client
     */
    async initialize() {
        try {
            const config = this.configManager.getConfiguration();
            this.client = new LocalLLMClient(config.serverUrl, {
                timeout: config.connectionSettings?.timeout,
                retryAttempts: config.connectionSettings?.retryAttempts
            });
            
            // Initialize chat panel
            this.chatPanel = new ChatPanel(this.configManager, this.modelCommands, this.client);
        } catch (error) {
            console.error('Failed to initialize AI commands:', error);
        }
    }

    /**
     * Register all AI interaction commands
     * @param {vscode.ExtensionContext} context 
     */
    register(context) {
        const commands = [
            vscode.commands.registerCommand('lmstudio.openChat', () => this.openChat()),
            vscode.commands.registerCommand('lmstudio.sendMessage', () => this.sendMessage()),
            vscode.commands.registerCommand('lmstudio.clearChat', () => this.clearChat()),
            vscode.commands.registerCommand('lmstudio.completeText', () => this.completeText()),
            vscode.commands.registerCommand('lmstudio.generateCode', () => this.generateCode()),
            vscode.commands.registerCommand('lmstudio.generateEmbedding', () => this.generateEmbedding()),
            vscode.commands.registerCommand('lmstudio.completeSelection', () => this.completeSelection()),
            vscode.commands.registerCommand('lmstudio.explainCode', () => this.explainCode()),
            vscode.commands.registerCommand('lmstudio.improveCode', () => this.improveCode())
        ];

        commands.forEach(command => {
            context.subscriptions.push(command);
        });

        // Listen for configuration changes
        this.configManager.onConfigurationChanged(async (config) => {
            this.client = new LocalLLMClient(config.serverUrl, {
                timeout: config.connectionSettings?.timeout,
                retryAttempts: config.connectionSettings?.retryAttempts
            });
            // Update chat panel client reference
            if (this.chatPanel) {
                this.chatPanel.client = this.client;
            }
        });
    }

    /**
     * Set the extension context for webview creation
     * @param {vscode.ExtensionContext} context 
     */
    setContext(context) {
        this.context = context;
    }

    /**
     * Set the status bar provider for performance metrics display
     * @param {StatusBarProvider} statusBarProvider 
     */
    setStatusBarProvider(statusBarProvider) {
        this.statusBarProvider = statusBarProvider;
        
        // Pass to chat panel if it exists
        if (this.chatPanel) {
            this.chatPanel.setStatusBarProvider(statusBarProvider);
        }
    }

    /**
     * Open chat interface using webview panel
     */
    async openChat() {
        try {
            if (!this.chatPanel) {
                this.chatPanel = new ChatPanel(this.configManager, this.modelCommands, this.client);
                
                // Set status bar provider if available
                if (this.statusBarProvider) {
                    this.chatPanel.setStatusBarProvider(this.statusBarProvider);
                }
            }
            
            if (!this.context) {
                throw new Error('Extension context not available');
            }
            
            await this.chatPanel.createOrShow(this.context);

        } catch (error) {
            this.handleError('Failed to open chat', error);
        }
    }

    /**
     * Send a message in the current chat session
     */
    async sendMessage() {
        try {
            const activeModel = this.modelCommands.getActiveModel();
            if (!activeModel) {
                vscode.window.showWarningMessage('No active model selected. Please select a model first.');
                return;
            }

            const message = await vscode.window.showInputBox({
                prompt: `Send message to ${activeModel.id}`,
                placeHolder: 'Enter your message...',
                ignoreFocusOut: true
            });

            if (message) {
                await this.processChatMessage(message);
            }

        } catch (error) {
            this.handleError('Failed to send message', error);
        }
    }

    /**
     * Process a chat message and get AI response
     * @param {string} userMessage - The user's message
     */
    async processChatMessage(userMessage) {
        try {
            const activeModel = this.modelCommands.getActiveModel();
            const config = this.configManager.getConfiguration();

            // Add user message to history
            this.chatHistory.push({
                role: 'user',
                content: userMessage,
                timestamp: new Date()
            });

            // Prepare messages for API call
            const messages = [];
            
            // Add system prompt if configured
            if (config.chatSettings.systemPrompt) {
                messages.push({
                    role: 'system',
                    content: config.chatSettings.systemPrompt
                });
            }

            // Add recent chat history (limit to prevent context overflow)
            const recentHistory = this.chatHistory.slice(-10);
            messages.push(...recentHistory.map(msg => ({
                role: msg.role,
                content: msg.content
            })));

            // Show progress and make API call
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Getting response from ${activeModel.id}...`,
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0 });

                // Set operation in progress
                if (this.statusBarProvider) {
                    this.statusBarProvider.setOperationInProgress(true, 'Chat');
                }

                try {
                    const response = await this.client.chatCompletion({
                        model: activeModel.id,
                        messages: messages,
                        temperature: config.chatSettings.temperature,
                        max_tokens: config.chatSettings.maxTokens
                    });

                    progress.report({ increment: 100 });

                    // Update performance metrics in status bar
                    if (this.statusBarProvider && response.stats) {
                        this.statusBarProvider.setPerformanceMetrics({
                            tokensPerSecond: response.stats.tokens_per_second,
                            generationTime: response.stats.generation_time,
                            timeToFirstToken: response.stats.time_to_first_token
                        });
                    }

                    // Add assistant response to history
                    const assistantMessage = response.choices[0].message.content;
                    this.chatHistory.push({
                        role: 'assistant',
                        content: assistantMessage,
                        timestamp: new Date()
                    });

                    // Show response in a new document
                    await this.showChatResponse(userMessage, assistantMessage, response.stats);
                } finally {
                    // Clear operation in progress
                    if (this.statusBarProvider) {
                        this.statusBarProvider.setOperationInProgress(false);
                    }
                }
            });

        } catch (error) {
            this.handleError('Failed to process chat message', error);
        }
    }

    /**
     * Clear chat history
     */
    async clearChat() {
        const confirm = await vscode.window.showWarningMessage(
            'Clear chat history?',
            'Yes', 'No'
        );

        if (confirm === 'Yes') {
            this.chatHistory = [];
            vscode.window.showInformationMessage('Chat history cleared');
        }
    }

    /**
     * Complete text at cursor position
     */
    async completeText() {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor found');
                return;
            }

            const activeModel = this.modelCommands.getActiveModel();
            if (!activeModel) {
                vscode.window.showWarningMessage('No active model selected. Please select a model first.');
                return;
            }

            const document = editor.document;
            const position = editor.selection.active;
            
            // Get text before cursor as context
            const textBeforeCursor = document.getText(new vscode.Range(
                new vscode.Position(Math.max(0, position.line - 10), 0),
                position
            ));

            await this.generateCompletion(textBeforeCursor, editor, position);

        } catch (error) {
            this.handleError('Failed to complete text', error);
        }
    }

    /**
     * Complete selected text or text at cursor
     */
    async completeSelection() {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor found');
                return;
            }

            const activeModel = this.modelCommands.getActiveModel();
            if (!activeModel) {
                vscode.window.showWarningMessage('No active model selected. Please select a model first.');
                return;
            }

            const selection = editor.selection;
            let contextText;
            let insertPosition;

            if (selection.isEmpty) {
                // No selection, use text before cursor
                const position = selection.active;
                contextText = editor.document.getText(new vscode.Range(
                    new vscode.Position(Math.max(0, position.line - 5), 0),
                    position
                ));
                insertPosition = position;
            } else {
                // Use selected text as context
                contextText = editor.document.getText(selection);
                insertPosition = selection.end;
            }

            await this.generateCompletion(contextText, editor, insertPosition);

        } catch (error) {
            this.handleError('Failed to complete selection', error);
        }
    }

    /**
     * Generate code based on a prompt
     */
    async generateCode() {
        try {
            const activeModel = this.modelCommands.getActiveModel();
            if (!activeModel) {
                vscode.window.showWarningMessage('No active model selected. Please select a model first.');
                return;
            }

            const prompt = await vscode.window.showInputBox({
                prompt: 'Describe the code you want to generate',
                placeHolder: 'e.g., "Create a function to sort an array of objects by date"',
                ignoreFocusOut: true
            });

            if (!prompt) return;

            const editor = vscode.window.activeTextEditor;
            const language = editor ? editor.document.languageId : 'javascript';
            
            const codePrompt = `Generate ${language} code for the following request:\n\n${prompt}\n\nCode:`;

            await this.generateCompletion(codePrompt, editor, editor?.selection.active);

        } catch (error) {
            this.handleError('Failed to generate code', error);
        }
    }

    /**
     * Explain selected code
     */
    async explainCode() {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor found');
                return;
            }

            const activeModel = this.modelCommands.getActiveModel();
            if (!activeModel) {
                vscode.window.showWarningMessage('No active model selected. Please select a model first.');
                return;
            }

            const selection = editor.selection;
            if (selection.isEmpty) {
                vscode.window.showWarningMessage('Please select code to explain');
                return;
            }

            const selectedCode = editor.document.getText(selection);
            const language = editor.document.languageId;

            const messages = [
                {
                    role: 'system',
                    content: 'You are a helpful programming assistant. Explain code clearly and concisely.'
                },
                {
                    role: 'user',
                    content: `Please explain this ${language} code:\n\n\`\`\`${language}\n${selectedCode}\n\`\`\``
                }
            ];

            await this.processExplanationRequest(messages, 'Code Explanation');

        } catch (error) {
            this.handleError('Failed to explain code', error);
        }
    }

    /**
     * Suggest improvements for selected code
     */
    async improveCode() {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor found');
                return;
            }

            const activeModel = this.modelCommands.getActiveModel();
            if (!activeModel) {
                vscode.window.showWarningMessage('No active model selected. Please select a model first.');
                return;
            }

            const selection = editor.selection;
            if (selection.isEmpty) {
                vscode.window.showWarningMessage('Please select code to improve');
                return;
            }

            const selectedCode = editor.document.getText(selection);
            const language = editor.document.languageId;

            const messages = [
                {
                    role: 'system',
                    content: 'You are a helpful programming assistant. Suggest improvements for code focusing on readability, performance, and best practices.'
                },
                {
                    role: 'user',
                    content: `Please suggest improvements for this ${language} code:\n\n\`\`\`${language}\n${selectedCode}\n\`\`\``
                }
            ];

            await this.processExplanationRequest(messages, 'Code Improvement Suggestions');

        } catch (error) {
            this.handleError('Failed to improve code', error);
        }
    }

    /**
     * Generate embeddings for selected text or input
     */
    async generateEmbedding() {
        try {
            const activeModel = this.modelCommands.getActiveModel();
            if (!activeModel) {
                vscode.window.showWarningMessage('No active model selected. Please select a model first.');
                return;
            }

            // Check if model supports embeddings
            if (activeModel.type !== 'embeddings') {
                vscode.window.showWarningMessage('Selected model does not support embeddings. Please select an embedding model.');
                return;
            }

            const editor = vscode.window.activeTextEditor;
            let text;

            if (editor && !editor.selection.isEmpty) {
                text = editor.document.getText(editor.selection);
            } else {
                text = await vscode.window.showInputBox({
                    prompt: 'Enter text to generate embeddings for',
                    placeHolder: 'Text to embed...',
                    ignoreFocusOut: true
                });
            }

            if (!text) return;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Generating embeddings...',
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0 });

                // Set operation in progress
                if (this.statusBarProvider) {
                    this.statusBarProvider.setOperationInProgress(true, 'Embedding');
                }

                try {
                    const response = await this.client.generateEmbeddings({
                        model: activeModel.id,
                        input: text
                    });

                    progress.report({ increment: 100 });

                    // Update performance metrics in status bar (embeddings don't have detailed stats)
                    if (this.statusBarProvider) {
                        this.statusBarProvider.setPerformanceMetrics({
                            tokensPerSecond: 0, // Embeddings don't report tokens per second
                            generationTime: 0,  // Not available for embeddings
                            timeToFirstToken: 0 // Not applicable for embeddings
                        });
                    }

                    // Show embeddings in a new document
                    await this.showEmbeddingResult(text, response);
                } finally {
                    // Clear operation in progress
                    if (this.statusBarProvider) {
                        this.statusBarProvider.setOperationInProgress(false);
                    }
                }
            });

        } catch (error) {
            this.handleError('Failed to generate embedding', error);
        }
    }

    /**
     * Generate completion and insert into editor
     * @param {string} prompt - The prompt for completion
     * @param {vscode.TextEditor} editor - The active editor
     * @param {vscode.Position} position - Position to insert completion
     */
    async generateCompletion(prompt, editor, position) {
        const activeModel = this.modelCommands.getActiveModel();
        const config = this.configManager.getConfiguration();

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Generating completion with ${activeModel.id}...`,
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0 });

            // Set operation in progress
            if (this.statusBarProvider) {
                this.statusBarProvider.setOperationInProgress(true, 'Completion');
            }

            try {
                const response = await this.client.textCompletion({
                    model: activeModel.id,
                    prompt: prompt,
                    temperature: config.completionSettings.temperature,
                    max_tokens: config.completionSettings.maxTokens,
                    stop: config.completionSettings.stopSequences
                });

                progress.report({ increment: 100 });

                // Update performance metrics in status bar
                if (this.statusBarProvider && response.stats) {
                    this.statusBarProvider.setPerformanceMetrics({
                        tokensPerSecond: response.stats.tokens_per_second,
                        generationTime: response.stats.generation_time,
                        timeToFirstToken: response.stats.time_to_first_token
                    });
                }

                const completion = response.choices[0].text;

                if (editor && position) {
                    // Insert completion at specified position
                    await editor.edit(editBuilder => {
                        editBuilder.insert(position, completion);
                    });

                    // Show completion stats
                    vscode.window.showInformationMessage(
                        `Completion generated: ${response.stats.tokens_per_second.toFixed(1)} tokens/sec`
                    );
                } else {
                    // Show completion in new document
                    await this.showCompletionResult(prompt, completion, response.stats);
                }
            } finally {
                // Clear operation in progress
                if (this.statusBarProvider) {
                    this.statusBarProvider.setOperationInProgress(false);
                }
            }
        });
    }

    /**
     * Process explanation or improvement requests
     * @param {Array} messages - Chat messages for the request
     * @param {string} title - Title for the result document
     */
    async processExplanationRequest(messages, title) {
        const activeModel = this.modelCommands.getActiveModel();
        const config = this.configManager.getConfiguration();

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Processing with ${activeModel.id}...`,
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0 });

            // Set operation in progress
            if (this.statusBarProvider) {
                this.statusBarProvider.setOperationInProgress(true, 'Analysis');
            }

            try {
                const response = await this.client.chatCompletion({
                    model: activeModel.id,
                    messages: messages,
                    temperature: config.chatSettings.temperature,
                    max_tokens: config.chatSettings.maxTokens
                });

                progress.report({ increment: 100 });

                // Update performance metrics in status bar
                if (this.statusBarProvider && response.stats) {
                    this.statusBarProvider.setPerformanceMetrics({
                        tokensPerSecond: response.stats.tokens_per_second,
                        generationTime: response.stats.generation_time,
                        timeToFirstToken: response.stats.time_to_first_token
                    });
                }

                const explanation = response.choices[0].message.content;
                await this.showExplanationResult(title, explanation, response.stats);
            } finally {
                // Clear operation in progress
                if (this.statusBarProvider) {
                    this.statusBarProvider.setOperationInProgress(false);
                }
            }
        });
    }

    /**
     * Show chat response in a new document
     */
    async showChatResponse(userMessage, assistantResponse, stats) {
        const doc = await vscode.workspace.openTextDocument({
            content: `# Chat Response\n\n**User:** ${userMessage}\n\n**Assistant:** ${assistantResponse}\n\n---\n*Generated in ${stats.generation_time.toFixed(2)}ms at ${stats.tokens_per_second.toFixed(1)} tokens/sec*`,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc);
    }

    /**
     * Show completion result in a new document
     */
    async showCompletionResult(prompt, completion, stats) {
        const doc = await vscode.workspace.openTextDocument({
            content: `# Text Completion\n\n**Prompt:** ${prompt}\n\n**Completion:**\n${completion}\n\n---\n*Generated in ${stats.generation_time.toFixed(2)}ms at ${stats.tokens_per_second.toFixed(1)} tokens/sec*`,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc);
    }

    /**
     * Show explanation result in a new document
     */
    async showExplanationResult(title, explanation, stats) {
        const doc = await vscode.workspace.openTextDocument({
            content: `# ${title}\n\n${explanation}\n\n---\n*Generated in ${stats.generation_time.toFixed(2)}ms at ${stats.tokens_per_second.toFixed(1)} tokens/sec*`,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc);
    }

    /**
     * Show embedding result in a new document
     */
    async showEmbeddingResult(text, response) {
        const embeddings = response.data[0].embedding;
        const doc = await vscode.workspace.openTextDocument({
            content: `# Embedding Result\n\n**Text:** ${text}\n\n**Embedding Vector (${embeddings.length} dimensions):**\n\`\`\`json\n${JSON.stringify(embeddings, null, 2)}\n\`\`\`\n\n**Usage:** ${response.usage.total_tokens} tokens`,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc);
    }

    /**
     * Handle errors with appropriate user feedback
     * @param {string} message - User-friendly error message
     * @param {Error} error - The actual error
     */
    handleError(message, error) {
        console.error(message, error);
        
        if (error instanceof LMStudioError) {
            switch (error.category) {
                case ERROR_CATEGORIES.CONNECTION:
                    vscode.window.showErrorMessage(`${message}: Cannot connect to LM Studio. Make sure it's running.`);
                    break;
                case ERROR_CATEGORIES.MODEL:
                    vscode.window.showErrorMessage(`${message}: Model error - ${error.message}`);
                    break;
                default:
                    vscode.window.showErrorMessage(`${message}: ${error.message}`);
            }
        } else {
            vscode.window.showErrorMessage(`${message}: ${error.message}`);
        }
    }
}

module.exports = { AICommands };