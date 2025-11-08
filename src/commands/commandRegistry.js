const vscode = require('vscode');
const { ModelCommands } = require('./modelCommands');
const { AICommands } = require('./aiCommands');

/**
 * Central command registry for managing all extension commands
 */
class CommandRegistry {
    constructor(configManager) {
        this.configManager = configManager;
        this.modelCommands = null;
        this.aiCommands = null;
        this.registeredCommands = [];
        this.connectionStatus = false;
    }

    /**
     * Initialize and register all commands
     * @param {vscode.ExtensionContext} context 
     */
    async initialize(context) {
        try {
            // Initialize command handlers
            this.modelCommands = new ModelCommands(this.configManager);
            this.aiCommands = new AICommands(this.configManager, this.modelCommands);

            await this.modelCommands.initialize();
            await this.aiCommands.initialize();

            // Register all commands
            this.registerModelCommands(context);
            this.registerAICommands(context);
            this.registerUtilityCommands(context);

            // Set up command enablement based on connection status
            await this.updateCommandEnablement();

            // Listen for configuration changes to update command enablement
            this.configManager.onConfigurationChanged(async () => {
                await this.updateCommandEnablement();
            });

            // Listen for active model changes
            this.configManager.on('activeModelChanged', () => {
                this.updateCommandEnablement();
            });

            console.log('Command registry initialized successfully');

        } catch (error) {
            console.error('Failed to initialize command registry:', error);
            throw error;
        }
    }

    /**
     * Register model management commands
     * @param {vscode.ExtensionContext} context 
     */
    registerModelCommands(context) {
        // Register model commands through the ModelCommands class
        this.modelCommands.register(context);

        // Track registered commands for enablement control
        this.registeredCommands.push(
            'lmstudio.listModels',
            'lmstudio.selectModel',
            'lmstudio.refreshModels'
        );
    }

    /**
     * Register AI interaction commands
     * @param {vscode.ExtensionContext} context 
     */
    registerAICommands(context) {
        // Register AI commands through the AICommands class
        this.aiCommands.register(context);
        
        // Store context reference for chat panel
        this.aiCommands.setContext(context);

        // Track registered commands for enablement control
        this.registeredCommands.push(
            'lmstudio.openChat',
            'lmstudio.sendMessage',
            'lmstudio.clearChat',
            'lmstudio.completeText',
            'lmstudio.generateCode',
            'lmstudio.generateEmbedding',
            'lmstudio.completeSelection',
            'lmstudio.explainCode',
            'lmstudio.improveCode'
        );
    }

    /**
     * Register utility and configuration commands
     * @param {vscode.ExtensionContext} context 
     */
    registerUtilityCommands(context) {
        const commands = [
            // Connection testing command
            vscode.commands.registerCommand('lmstudio.testConnection', async () => {
                await this.testConnection();
            }),

            // Show error statistics command
            vscode.commands.registerCommand('lmstudio.showErrorStats', async () => {
                await this.showErrorStatistics();
            }),

            // Show troubleshooting guide command
            vscode.commands.registerCommand('lmstudio.showTroubleshooting', async () => {
                await this.showTroubleshootingGuide();
            }),

            // Quick model switch command
            vscode.commands.registerCommand('lmstudio.quickModelSwitch', async () => {
                await this.quickModelSwitch();
            }),

            // Show extension info command
            vscode.commands.registerCommand('lmstudio.showInfo', () => {
                this.showExtensionInfo();
            }),

            // Open settings command
            vscode.commands.registerCommand('lmstudio.openSettings', () => {
                vscode.commands.executeCommand('workbench.action.openSettings', 'lmstudio');
            }),

            // Show help command
            vscode.commands.registerCommand('lmstudio.showHelp', () => {
                this.showHelp();
            })
        ];

        commands.forEach(command => {
            context.subscriptions.push(command);
        });

        // Track utility commands
        this.registeredCommands.push(
            'lmstudio.testConnection',
            'lmstudio.quickModelSwitch',
            'lmstudio.showInfo',
            'lmstudio.openSettings',
            'lmstudio.showHelp',
            'lmstudio.showErrorStats',
            'lmstudio.showTroubleshooting'
        );
    }

    /**
     * Update command enablement based on connection and model status
     */
    async updateCommandEnablement() {
        try {
            // Test connection status
            const config = this.configManager.getConfiguration();
            const wasConnected = this.connectionStatus;
            this.connectionStatus = await this.checkConnectionStatus(config);

            // Get active model status
            const activeModel = this.modelCommands ? this.modelCommands.getActiveModel() : null;
            const hasActiveModel = activeModel !== null;

            // Set context variables for command enablement
            await vscode.commands.executeCommand('setContext', 'lmstudio.connected', this.connectionStatus);
            await vscode.commands.executeCommand('setContext', 'lmstudio.hasActiveModel', hasActiveModel);
            await vscode.commands.executeCommand('setContext', 'lmstudio.modelLoaded', hasActiveModel && activeModel?.state === 'loaded');

            // Update status bar if connection status changed
            if (this.statusBarProvider) {
                if (wasConnected !== this.connectionStatus) {
                    this.statusBarProvider.setConnectionStatus(this.connectionStatus ? 'connected' : 'disconnected');
                }
                
                if (activeModel) {
                    this.statusBarProvider.setActiveModel(activeModel);
                }
            }

            // Update status indicators for other components
            this.updateStatusIndicators(this.connectionStatus, activeModel);

        } catch (error) {
            console.error('Failed to update command enablement:', error);
            await vscode.commands.executeCommand('setContext', 'lmstudio.connected', false);
            await vscode.commands.executeCommand('setContext', 'lmstudio.hasActiveModel', false);
            await vscode.commands.executeCommand('setContext', 'lmstudio.modelLoaded', false);
            
            // Update status bar with error state
            if (this.statusBarProvider) {
                this.statusBarProvider.setConnectionStatus('error');
            }
        }
    }

    /**
     * Check if LM Studio is connected and available
     * @param {Object} config - Extension configuration
     * @returns {boolean} Connection status
     */
    async checkConnectionStatus(config) {
        try {
            if (!this.modelCommands || !this.modelCommands.client) {
                return false;
            }

            // Use the client's health check method
            return await this.modelCommands.client.checkHealth();
        } catch (error) {
            return false;
        }
    }

    /**
     * Test connection to LM Studio
     */
    async testConnection() {
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Testing LM Studio connection...',
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0 });

                try {
                    // Use graceful degradation service for connection test
                    
                    const isConnected = await this.checkConnectionStatus(config);
                    progress.report({ increment: 50 });

                    if (isConnected) {
                        // Test model retrieval
                        const models = await this.modelCommands.getModelsWithFallback();
                        progress.report({ increment: 100 });
                        
                        const loadedModels = models.filter(m => m.state === 'loaded');
                        
                        vscode.window.showInformationMessage(
                            `✅ Connected to LM Studio at ${config.serverUrl}. Found ${models.length} models (${loadedModels.length} loaded).`,
                            'Show Models'
                        ).then(choice => {
                            if (choice === 'Show Models') {
                                vscode.commands.executeCommand('lmstudio.listModels');
                            }
                        });
                    } else {
                        progress.report({ increment: 100 });
                        
                        const { showErrorGuidance } = require('../services/userGuidance');
                        const connectionError = new (require('../models/errors').ConnectionError)(
                            'Cannot connect to LM Studio',
                            'CONNECTION_REFUSED'
                        );
                        
                        const config = this.configManager.getConfiguration();
                        await showErrorGuidance(connectionError, {
                            operation: 'connection_test',
                            serverUrl: config.serverUrl
                        });
                    }

                } catch (testError) {
                    progress.report({ increment: 100 });
                    
                    const config = this.configManager.getConfiguration();
                    const { handleConnectionError } = require('../services/errorHandler');
                    await handleConnectionError(testError, {
                        operation: 'connection_test',
                        serverUrl: config.serverUrl
                    });
                }

                await this.updateCommandEnablement();
            });

        } catch (error) {
            const { handleError } = require('../services/errorHandler');
            await handleError(error, {
                operation: 'connection_test_wrapper'
            });
        }
    }

    /**
     * Quick model switch with keyboard shortcut support
     */
    async quickModelSwitch() {
        try {
            if (!this.connectionStatus) {
                vscode.window.showWarningMessage('Not connected to LM Studio. Please check your connection.');
                return;
            }

            const models = this.modelCommands.getModels();
            const loadedModels = models.filter(model => model.state === 'loaded');

            if (loadedModels.length === 0) {
                vscode.window.showWarningMessage('No loaded models available. Please load a model in LM Studio first.');
                return;
            }

            if (loadedModels.length === 1) {
                await this.modelCommands.setActiveModel(loadedModels[0]);
                return;
            }

            // Show quick pick for multiple models
            const activeModel = this.modelCommands.getActiveModel();
            const quickPickItems = loadedModels.map(model => {
                const isActive = activeModel && activeModel.id === model.id;
                return {
                    label: `${isActive ? '$(star-full)' : '$(star-empty)'} ${model.id}`,
                    description: model.arch,
                    detail: `${model.quantization} | ${model.max_context_length} tokens`,
                    model: model
                };
            });

            const selected = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: 'Select model to switch to',
                matchOnDescription: true
            });

            if (selected) {
                await this.modelCommands.setActiveModel(selected.model);
            }

        } catch (error) {
            vscode.window.showErrorMessage(`Quick model switch failed: ${error.message}`);
        }
    }

    /**
     * Show extension information
     */
    showExtensionInfo() {
        const activeModel = this.modelCommands ? this.modelCommands.getActiveModel() : null;
        const config = this.configManager.getConfiguration();
        const models = this.modelCommands ? this.modelCommands.getModels() : [];

        const info = [
            '# LM Studio Kiro Extension',
            '',
            `**Connection Status:** ${this.connectionStatus ? '✅ Connected' : '❌ Disconnected'}`,
            `**Server URL:** ${config.serverUrl}`,
            `**Available Models:** ${models.length}`,
            `**Active Model:** ${activeModel ? activeModel.id : 'None'}`,
            '',
            '## Available Commands',
            '- `LM Studio: List Models` - View all available models',
            '- `LM Studio: Select Model` - Choose active model',
            '- `LM Studio: Open Chat` - Start chat session',
            '- `LM Studio: Complete Text` - Generate text completion',
            '- `LM Studio: Generate Code` - Generate code from description',
            '- `LM Studio: Explain Code` - Explain selected code',
            '- `LM Studio: Improve Code` - Get improvement suggestions',
            '- `LM Studio: Generate Embedding` - Create text embeddings',
            '',
            '## Keyboard Shortcuts',
            '- `Ctrl+Shift+L M` - Quick model switch',
            '- `Ctrl+Shift+L C` - Open chat',
            '- `Ctrl+Shift+L T` - Complete text',
            '- `Ctrl+Shift+L G` - Generate code'
        ].join('\n');

        vscode.workspace.openTextDocument({
            content: info,
            language: 'markdown'
        }).then(doc => {
            vscode.window.showTextDocument(doc);
        });
    }

    /**
     * Show error statistics
     */
    async showErrorStatistics() {
        try {
            const errorHandler = vscode.workspace.getConfiguration().get('lmstudio.errorHandler');
            if (!errorHandler) {
                vscode.window.showInformationMessage('Error statistics not available.');
                return;
            }

            const stats = errorHandler.getErrorStatistics();
            
            const statsContent = [
                '# LM Studio Error Statistics',
                '',
                `**Total Errors:** ${stats.totalErrors}`,
                '',
                '## Errors by Category',
                ...Object.entries(stats.errorsByCategory).map(([category, count]) => 
                    `- **${category}:** ${count}`
                ),
                '',
                '## Errors by Code',
                ...Object.entries(stats.errorsByCode).map(([code, count]) => 
                    `- **${code}:** ${count}`
                ),
                '',
                '## Recent Errors',
                ...stats.recentErrors.map(error => 
                    `- **${error.key}** (${error.count}x) - ${new Date(error.timestamp).toLocaleString()}`
                )
            ].join('\n');

            const doc = await vscode.workspace.openTextDocument({
                content: statsContent,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc);

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show error statistics: ${error.message}`);
        }
    }

    /**
     * Show troubleshooting guide
     */
    async showTroubleshootingGuide() {
        try {
            const { showTroubleshootingGuide } = require('../services/userGuidance');
            await showTroubleshootingGuide();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show troubleshooting guide: ${error.message}`);
        }
    }

    /**
     * Show help information
     */
    showHelp() {
        const help = [
            '# LM Studio Kiro Extension Help',
            '',
            '## Getting Started',
            '1. Install and run LM Studio application',
            '2. Load at least one model in LM Studio',
            '3. Use `LM Studio: Test Connection` to verify connectivity',
            '4. Use `LM Studio: Select Model` to choose your active model',
            '',
            '## Common Issues',
            '',
            '### Connection Problems',
            '- Ensure LM Studio is running on the configured port (default: 1234)',
            '- Check firewall settings if using custom server URL',
            '- Verify server URL in extension settings',
            '',
            '### Model Issues',
            '- Models must be loaded in LM Studio before use',
            '- Some features require specific model types (e.g., embeddings)',
            '- Large models may take time to respond',
            '',
            '### Performance Tips',
            '- Use smaller models for faster responses',
            '- Adjust temperature and max tokens in settings',
            '- Clear chat history periodically to free memory',
            '',
            '## Configuration',
            'Access settings via `File > Preferences > Settings` and search for "LM Studio"',
            '',
            '## Support',
            'For issues and feature requests, visit the extension repository.'
        ].join('\n');

        vscode.workspace.openTextDocument({
            content: help,
            language: 'markdown'
        }).then(doc => {
            vscode.window.showTextDocument(doc);
        });
    }

    /**
     * Update status indicators based on connection and model status
     * @param {boolean} connected - Connection status
     * @param {Object|null} activeModel - Currently active model
     */
    updateStatusIndicators(connected, activeModel) {
        // Emit events that status bar and other UI components can listen to
        this.configManager.emit('connectionStatusChanged', connected);
        if (activeModel) {
            this.configManager.emit('activeModelChanged', activeModel);
        }
    }

    /**
     * Set status bar provider reference for status updates
     * @param {StatusBarProvider} statusBarProvider - Status bar provider instance
     */
    setStatusBarProvider(statusBarProvider) {
        this.statusBarProvider = statusBarProvider;
        
        // Pass status bar provider to AI commands for performance metrics
        if (this.aiCommands) {
            this.aiCommands.setStatusBarProvider(statusBarProvider);
        }
        
        // Update status bar with current state
        if (statusBarProvider) {
            statusBarProvider.setConnectionStatus(this.connectionStatus ? 'connected' : 'disconnected');
            
            const activeModel = this.modelCommands ? this.modelCommands.getActiveModel() : null;
            if (activeModel) {
                statusBarProvider.setActiveModel(activeModel);
            }
        }
    }

    /**
     * Get the model commands instance
     * @returns {ModelCommands} Model commands instance
     */
    getModelCommands() {
        return this.modelCommands;
    }

    /**
     * Get the AI commands instance
     * @returns {AICommands} AI commands instance
     */
    getAICommands() {
        return this.aiCommands;
    }

    /**
     * Get connection status
     * @returns {boolean} Current connection status
     */
    isConnected() {
        return this.connectionStatus;
    }

    /**
     * Dispose of all registered commands
     */
    dispose() {
        // Commands are automatically disposed by VS Code when added to context.subscriptions
        this.registeredCommands = [];
        this.modelCommands = null;
        this.aiCommands = null;
    }
}

module.exports = { CommandRegistry };