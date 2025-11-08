const vscode = require('vscode');
const { LocalLLMClient } = require('../services/localLLMClient');
const { LMStudioError } = require('../models/errors');
const { ERROR_CATEGORIES } = require('../models/constants');

/**
 * Model management commands for LM Studio integration
 */
class ModelCommands {
    constructor(configManager) {
        this.configManager = configManager;
        this.client = null;
        this.activeModel = null;
        this.models = [];
        this.lastRefresh = null;
    }

    /**
     * Initialize the model commands with LM Studio client
     */
    async initialize() {
        try {
            const config = this.configManager.getConfiguration();
            this.client = new LocalLLMClient(config.serverUrl, {
                timeout: config.connectionSettings?.timeout,
                retryAttempts: config.connectionSettings?.retryAttempts
            });
            
            // Load persisted active model
            const persistedModel = this.configManager.getPersistedValue('activeModel');
            if (persistedModel) {
                this.activeModel = persistedModel;
            }
            
            // Initial model refresh with graceful degradation
            await this.refreshModels(false);
        } catch (error) {
            console.error('Failed to initialize model commands:', error);
            
            // Use error handler for initialization failures
            const { handleError } = require('../services/errorHandler');
            await handleError(error, {
                operation: 'model_commands_initialization'
            });
        }
    }

    /**
     * Get models with graceful degradation fallback
     * @returns {Promise<Array>} Array of models
     */
    async getModelsWithFallback() {
        try {
            const { gracefulDegradationService } = require('../services/gracefulDegradation');
            return await gracefulDegradationService.getModelsWithFallback();
        } catch (error) {
            // Fallback to cached models or empty array
            return this.models || [];
        }
    }

    /**
     * Register all model management commands
     * @param {vscode.ExtensionContext} context 
     */
    register(context) {
        const commands = [
            vscode.commands.registerCommand('lmstudio.listModels', () => this.listModels()),
            vscode.commands.registerCommand('lmstudio.selectModel', () => this.selectModel()),
            vscode.commands.registerCommand('lmstudio.refreshModels', () => this.refreshModels(true))
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
            await this.refreshModels(false);
        });
    }

    /**
     * List all available models with status indicators
     */
    async listModels() {
        try {
            if (!this.client) {
                throw new LMStudioError(
                    'LM Studio client not initialized',
                    'CLIENT_NOT_INITIALIZED',
                    ERROR_CATEGORIES.RUNTIME
                );
            }

            // Refresh models if cache is stale (older than 5 minutes)
            const now = Date.now();
            if (!this.lastRefresh || (now - this.lastRefresh) > 5 * 60 * 1000) {
                await this.refreshModels(false);
            }

            if (this.models.length === 0) {
                vscode.window.showInformationMessage('No models available. Make sure LM Studio is running and has models loaded.');
                return;
            }

            // Create quick pick items with status indicators
            const quickPickItems = this.models.map(model => {
                const isActive = this.activeModel && this.activeModel.id === model.id;
                const statusIcon = model.state === 'loaded' ? '$(check)' : '$(circle-outline)';
                const activeIcon = isActive ? '$(star-full)' : '';
                
                return {
                    label: `${activeIcon} ${statusIcon} ${model.id}`,
                    description: `${model.arch} | ${model.quantization} | ${model.state}`,
                    detail: `Context: ${model.max_context_length} tokens | Type: ${model.type}`,
                    model: model
                };
            });

            const selected = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: 'Select a model to view details or set as active',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected) {
                await this.showModelDetails(selected.model);
            }

        } catch (error) {
            this.handleError('Failed to list models', error);
        }
    }

    /**
     * Select and set active model
     */
    async selectModel() {
        try {
            if (!this.client) {
                throw new LMStudioError(
                    'LM Studio client not initialized',
                    'CLIENT_NOT_INITIALIZED',
                    ERROR_CATEGORIES.RUNTIME
                );
            }

            // Refresh models to get latest status
            await this.refreshModels(false);

            if (this.models.length === 0) {
                vscode.window.showWarningMessage('No models available. Make sure LM Studio is running and has models loaded.');
                return;
            }

            // Filter to only loaded models for selection
            const loadedModels = this.models.filter(model => model.isLoaded());
            
            // Debug: Log model states
            console.log('All models:', this.models.map(m => ({ id: m.id, state: m.state, isLoaded: m.isLoaded() })));
            console.log('Loaded models count:', loadedModels.length);
            
            if (loadedModels.length === 0) {
                // Show more helpful message with model states
                const modelStates = this.models.map(m => `${m.id}: ${m.state}`).join('\n');
                vscode.window.showWarningMessage(
                    `No loaded models available. Please load a model in LM Studio first.\n\nFound ${this.models.length} model(s) but none are loaded:\n${modelStates}`,
                    'Refresh Models',
                    'Help'
                ).then(action => {
                    if (action === 'Refresh Models') {
                        vscode.commands.executeCommand('lmstudio.refreshModels');
                    } else if (action === 'Help') {
                        vscode.window.showInformationMessage(
                            'In LM Studio:\n1. Go to the model you want to use\n2. Click the "Load" button\n3. Wait for it to finish loading\n4. Try again in VS Code'
                        );
                    }
                });
                return;
            }

            // Create quick pick items for loaded models
            const quickPickItems = loadedModels.map(model => {
                const isActive = this.activeModel && this.activeModel.id === model.id;
                const activeIcon = isActive ? '$(star-full)' : '$(star-empty)';
                
                return {
                    label: `${activeIcon} ${model.id}`,
                    description: `${model.arch} | ${model.quantization}`,
                    detail: `Context: ${model.max_context_length} tokens | Type: ${model.type}`,
                    model: model
                };
            });

            const selected = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: 'Select a model to set as active',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected) {
                await this.setActiveModel(selected.model);
            }

        } catch (error) {
            this.handleError('Failed to select model', error);
        }
    }

    /**
     * Refresh the model list from LM Studio
     * @param {boolean} showProgress - Whether to show progress indicator
     */
    async refreshModels(showProgress = true) {
        try {
            if (!this.client) {
                throw new LMStudioError(
                    'LM Studio client not initialized',
                    'CLIENT_NOT_INITIALIZED',
                    ERROR_CATEGORIES.RUNTIME
                );
            }

            if (showProgress) {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Refreshing models from LM Studio...',
                    cancellable: false
                }, async (progress) => {
                    progress.report({ increment: 0 });
                    
                    this.models = await this.client.getModels();
                    this.lastRefresh = Date.now();
                    
                    progress.report({ increment: 100 });
                });

                vscode.window.showInformationMessage(`Refreshed ${this.models.length} models from LM Studio`);
            } else {
                this.models = await this.client.getModels();
                this.lastRefresh = Date.now();
            }

            // Validate active model still exists and is loaded
            if (this.activeModel) {
                const currentModel = this.models.find(m => m.id === this.activeModel.id);
                if (!currentModel || currentModel.state !== 'loaded') {
                    this.activeModel = null;
                    await this.configManager.setPersistedValue('activeModel', null);
                }
            }

        } catch (error) {
            this.handleError('Failed to refresh models', error);
        }
    }

    /**
     * Set the active model and persist the selection
     * @param {Object|string} modelOrId - The model object or ID to set as active
     */
    async setActiveModel(modelOrId) {
        if (typeof modelOrId === 'string') {
            // Delegate to the new method for string IDs
            return await this.setActiveModelById(modelOrId);
        }

        // Original functionality for model objects
        const model = modelOrId;
        try {
            // Verify model is still loaded
            const currentModel = await this.client.getModel(model.id);
            if (!currentModel.isLoaded()) {
                vscode.window.showWarningMessage(`Model ${model.id} is not currently loaded in LM Studio`);
                return;
            }

            this.activeModel = currentModel;
            await this.configManager.setPersistedValue('activeModel', currentModel);

            // Update default model in configuration if user wants
            const updateDefault = await vscode.window.showInformationMessage(
                `Set ${model.id} as active model. Update default model setting?`,
                'Yes', 'No'
            );

            if (updateDefault === 'Yes') {
                try {
                    await this.configManager.updateSingleConfiguration('defaultModel', model.id);
                } catch (configError) {
                    // If no workspace is open, just skip updating the setting
                    console.log('Could not update default model setting (no workspace open):', configError.message);
                }
            }

            vscode.window.showInformationMessage(`Active model set to: ${model.id}`);

            // Emit event for other components (like status bar)
            this.configManager.emit('activeModelChanged', this.activeModel);

        } catch (error) {
            this.handleError('Failed to set active model', error);
        }
    }

    /**
     * Show detailed information about a model
     * @param {Object} model - The model to show details for
     */
    async showModelDetails(model) {
        const actions = ['Set as Active', 'Copy Model ID'];
        
        if (model.state !== 'loaded') {
            actions.unshift('Load Model (External)');
        }

        const action = await vscode.window.showInformationMessage(
            `Model: ${model.id}\n` +
            `Architecture: ${model.arch}\n` +
            `Quantization: ${model.quantization}\n` +
            `Context Length: ${model.max_context_length} tokens\n` +
            `Type: ${model.type}\n` +
            `Status: ${model.state}\n` +
            `Publisher: ${model.publisher}`,
            ...actions
        );

        switch (action) {
            case 'Set as Active':
                if (model.state === 'loaded') {
                    await this.setActiveModel(model);
                } else {
                    vscode.window.showWarningMessage('Model must be loaded in LM Studio before setting as active');
                }
                break;
            case 'Copy Model ID':
                await vscode.env.clipboard.writeText(model.id);
                vscode.window.showInformationMessage('Model ID copied to clipboard');
                break;
            case 'Load Model (External)':
                vscode.window.showInformationMessage('Please load this model in LM Studio application');
                break;
        }
    }

    /**
     * Get the currently active model
     * @returns {Object|null} The active model or null if none selected
     */
    getActiveModel() {
        return this.activeModel;
    }

    /**
     * Get all available models
     * @returns {Array} Array of available models
     */
    getModels() {
        return this.models;
    }

    /**
     * Get available models (alias for getModels for chat panel compatibility)
     * @returns {Array} Array of available models
     */
    getAvailableModels() {
        return this.models;
    }

    /**
     * Set active model by ID or object (for chat panel compatibility)
     * @param {string|Object} modelOrId - Model object or ID of the model to set as active
     */
    async setActiveModelById(modelOrId) {
        try {
            let model;
            
            if (typeof modelOrId === 'string') {
                // Called with model ID, find the model object
                model = this.models.find(m => m.id === modelOrId);
                if (!model) {
                    throw new Error(`Model ${modelOrId} not found`);
                }
            } else {
                // Called with model object
                model = modelOrId;
            }

            // Verify model is still loaded
            const currentModel = await this.client.getModel(model.id);
            if (!currentModel.isLoaded()) {
                vscode.window.showWarningMessage(`Model ${model.id} is not currently loaded in LM Studio`);
                return;
            }

            this.activeModel = currentModel;
            await this.configManager.setPersistedValue('activeModel', currentModel);

            vscode.window.showInformationMessage(`Active model set to: ${model.id}`);

            // Emit event for other components (like status bar)
            this.configManager.emit('activeModelChanged', this.activeModel);

        } catch (error) {
            this.handleError('Failed to set active model', error);
            throw error;
        }
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
                    vscode.window.showErrorMessage(`${message}: Cannot connect to LM Studio. Make sure it's running on ${this.configManager.getConfiguration().serverUrl}`);
                    break;
                case ERROR_CATEGORIES.API:
                    vscode.window.showErrorMessage(`${message}: ${error.message}`);
                    break;
                default:
                    vscode.window.showErrorMessage(`${message}: ${error.message}`);
            }
        } else {
            vscode.window.showErrorMessage(`${message}: ${error.message}`);
        }
    }
}

module.exports = { ModelCommands };