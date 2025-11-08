/**
 * @fileoverview Configuration UI provider for VS Code integration
 * Handles configuration commands, validation, and user feedback.
 */

const vscode = require('vscode');
const { ConfigurationManager } = require('../config/configManager');
const { ValidationError, RuntimeError } = require('../models/errors');

/**
 * Configuration UI provider for VS Code integration
 * @class
 */
class ConfigurationProvider {
    /**
     * Create a ConfigurationProvider instance
     * @param {ConfigurationManager} configManager - Configuration manager instance
     */
    constructor(configManager) {
        this.configManager = configManager;
        this._disposables = [];
    }

    /**
     * Register configuration commands and UI components
     * @param {vscode.ExtensionContext} context - Extension context
     */
    register(context) {
        // Register configuration commands
        this._disposables.push(
            vscode.commands.registerCommand('lmstudio.resetConfiguration', 
                this.resetConfiguration.bind(this)
            )
        );

        this._disposables.push(
            vscode.commands.registerCommand('lmstudio.validateConfiguration', 
                this.validateConfiguration.bind(this)
            )
        );

        // Add disposables to context
        this._disposables.forEach(disposable => context.subscriptions.push(disposable));
    }

    /**
     * Reset configuration to defaults with user confirmation
     * @returns {Promise<void>}
     */
    async resetConfiguration() {
        try {
            // Ask for user confirmation
            const choice = await vscode.window.showWarningMessage(
                'This will reset all Local LLM settings to their default values. This action cannot be undone.',
                { modal: true },
                'Reset to Defaults',
                'Cancel'
            );

            if (choice !== 'Reset to Defaults') {
                return;
            }

            // Ask whether to reset globally or just for workspace
            const scope = await vscode.window.showQuickPick([
                {
                    label: 'Workspace Only',
                    description: 'Reset settings for this workspace only',
                    value: false
                },
                {
                    label: 'Global Settings',
                    description: 'Reset global settings (affects all workspaces)',
                    value: true
                }
            ], {
                placeHolder: 'Choose the scope for resetting configuration'
            });

            if (!scope) {
                return;
            }

            // Reset configuration
            await this.configManager.resetConfiguration(scope.value);

            // Show success message
            vscode.window.showInformationMessage(
                `Local LLM configuration has been reset to defaults (${scope.label.toLowerCase()}).`
            );

        } catch (error) {
            this._handleError('Failed to reset configuration', error);
        }
    }

    /**
     * Validate current configuration and show results
     * @returns {Promise<void>}
     */
    async validateConfiguration() {
        try {
            // Validate configuration
            const isValid = await this.configManager.validateConfiguration();
            
            if (isValid) {
                // Show success message with current settings summary
                const config = this.configManager.getConfiguration();
                const summary = this._createConfigurationSummary(config);
                
                vscode.window.showInformationMessage(
                    'Configuration is valid!',
                    'Show Details'
                ).then(choice => {
                    if (choice === 'Show Details') {
                        this._showConfigurationDetails(summary);
                    }
                });
            }

        } catch (error) {
            if (error instanceof ValidationError) {
                // Show validation error with fix suggestions
                this._showValidationError(error);
            } else {
                this._handleError('Failed to validate configuration', error);
            }
        }
    }

    /**
     * Show configuration validation error with fix suggestions
     * @private
     * @param {ValidationError} error - Validation error
     */
    async _showValidationError(error) {
        const message = `Configuration validation failed: ${error.message}`;
        
        // Provide fix suggestions based on error code
        const actions = this._getFixActions(error);
        
        const choice = await vscode.window.showErrorMessage(
            message,
            ...actions
        );

        if (choice) {
            await this._handleFixAction(choice, error);
        }
    }

    /**
     * Get fix actions for validation errors
     * @private
     * @param {ValidationError} error - Validation error
     * @returns {string[]} Array of action labels
     */
    _getFixActions(error) {
        const actions = ['Open Settings'];

        switch (error.code) {
            case 'INVALID_SERVER_URL':
                actions.unshift('Reset to Default URL');
                break;
            case 'INVALID_CHAT_TEMPERATURE':
            case 'INVALID_COMPLETION_TEMPERATURE':
                actions.unshift('Reset Temperature');
                break;
            case 'INVALID_CHAT_MAX_TOKENS':
            case 'INVALID_COMPLETION_MAX_TOKENS':
                actions.unshift('Reset Max Tokens');
                break;
            default:
                actions.unshift('Reset All Settings');
                break;
        }

        return actions;
    }

    /**
     * Handle fix action for validation errors
     * @private
     * @param {string} action - Selected action
     * @param {ValidationError} error - Validation error
     */
    async _handleFixAction(action, error) {
        try {
            switch (action) {
                case 'Reset to Default URL':
                    await this.configManager.updateConfiguration({
                        serverUrl: 'http://localhost:1234'
                    });
                    vscode.window.showInformationMessage('Server URL reset to default.');
                    break;

                case 'Reset Temperature':
                    const tempUpdates = {};
                    if (error.field.includes('chat')) {
                        tempUpdates.chatSettings = { temperature: 0.7 };
                    } else {
                        tempUpdates.completionSettings = { temperature: 0.7 };
                    }
                    await this.configManager.updateConfiguration(tempUpdates);
                    vscode.window.showInformationMessage('Temperature reset to default.');
                    break;

                case 'Reset Max Tokens':
                    const tokenUpdates = {};
                    if (error.field.includes('chat')) {
                        tokenUpdates.chatSettings = { maxTokens: 1000 };
                    } else {
                        tokenUpdates.completionSettings = { maxTokens: 500 };
                    }
                    await this.configManager.updateConfiguration(tokenUpdates);
                    vscode.window.showInformationMessage('Max tokens reset to default.');
                    break;

                case 'Reset All Settings':
                    await this.resetConfiguration();
                    break;

                case 'Open Settings':
                    await vscode.commands.executeCommand('workbench.action.openSettings', 'lmstudio');
                    break;
            }
        } catch (fixError) {
            this._handleError('Failed to apply fix', fixError);
        }
    }

    /**
     * Create a configuration summary for display
     * @private
     * @param {ExtensionConfig} config - Configuration object
     * @returns {Object} Configuration summary
     */
    _createConfigurationSummary(config) {
        return {
            serverUrl: config.serverUrl,
            defaultModel: config.defaultModel || 'Not set',
            chatSettings: {
                temperature: config.chatSettings.temperature,
                maxTokens: config.chatSettings.maxTokens,
                systemPrompt: config.chatSettings.systemPrompt.substring(0, 50) + '...'
            },
            completionSettings: {
                temperature: config.completionSettings.temperature,
                maxTokens: config.completionSettings.maxTokens,
                stopSequences: config.completionSettings.stopSequences.length
            },
            connectionSettings: {
                timeout: `${config.connectionSettings.timeout}ms`,
                retryAttempts: config.connectionSettings.retryAttempts,
                healthCheckInterval: `${config.connectionSettings.healthCheckInterval}ms`
            }
        };
    }

    /**
     * Show detailed configuration information
     * @private
     * @param {Object} summary - Configuration summary
     */
    async _showConfigurationDetails(summary) {
        const details = [
            '# LM Studio Configuration',
            '',
            '## Connection',
            `- Server URL: ${summary.serverUrl}`,
            `- Default Model: ${summary.defaultModel}`,
            `- Timeout: ${summary.connectionSettings.timeout}`,
            `- Retry Attempts: ${summary.connectionSettings.retryAttempts}`,
            `- Health Check Interval: ${summary.connectionSettings.healthCheckInterval}`,
            '',
            '## Chat Settings',
            `- Temperature: ${summary.chatSettings.temperature}`,
            `- Max Tokens: ${summary.chatSettings.maxTokens}`,
            `- System Prompt: ${summary.chatSettings.systemPrompt}`,
            '',
            '## Completion Settings',
            `- Temperature: ${summary.completionSettings.temperature}`,
            `- Max Tokens: ${summary.completionSettings.maxTokens}`,
            `- Stop Sequences: ${summary.completionSettings.stopSequences} configured`,
            ''
        ].join('\n');

        // Create and show a new document with configuration details
        const doc = await vscode.workspace.openTextDocument({
            content: details,
            language: 'markdown'
        });

        await vscode.window.showTextDocument(doc, {
            preview: true,
            viewColumn: vscode.ViewColumn.Beside
        });
    }

    /**
     * Handle errors with user-friendly messages
     * @private
     * @param {string} message - Error message
     * @param {Error} error - Original error
     */
    _handleError(message, error) {
        console.error(message, error);
        
        let userMessage = message;
        if (error instanceof ValidationError || error instanceof RuntimeError) {
            userMessage += `: ${error.message}`;
        }

        vscode.window.showErrorMessage(userMessage, 'Open Settings').then(choice => {
            if (choice === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'lmstudio');
            }
        });
    }

    /**
     * Dispose of the configuration provider
     */
    dispose() {
        this._disposables.forEach(disposable => disposable.dispose());
        this._disposables.length = 0;
    }
}

module.exports = {
    ConfigurationProvider
};