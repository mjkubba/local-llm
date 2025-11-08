/**
 * @fileoverview User guidance system for common error scenarios
 * Provides helpful guidance and troubleshooting steps for users.
 */

const vscode = require('vscode');
const { getLogger } = require('./logger');
// const { ERROR_CATEGORIES } = require('../models/constants'); // Unused for now

/**
 * Guidance types for different scenarios
 * @readonly
 * @enum {string}
 */
const GUIDANCE_TYPES = {
    /** Quick fix guidance */
    QUICK_FIX: 'quick_fix',
    /** Step-by-step tutorial */
    TUTORIAL: 'tutorial',
    /** Troubleshooting guide */
    TROUBLESHOOTING: 'troubleshooting',
    /** Configuration help */
    CONFIGURATION: 'configuration'
};

/**
 * User guidance system
 * @class
 */
class UserGuidanceSystem {
    /**
     * Create a UserGuidanceSystem instance
     */
    constructor() {
        this.logger = getLogger('UserGuidance');
        this._guidanceDatabase = new Map();
        this._shownGuidance = new Set();
        this._isEnabled = true;
        
        // Initialize guidance database
        this._initializeGuidanceDatabase();
    }

    /**
     * Show guidance for an error
     * @param {Error} error - Error that occurred
     * @param {Object} [context] - Additional context
     * @returns {Promise<boolean>} True if guidance was shown
     */
    async showErrorGuidance(error, context = {}) {
        if (!this._isEnabled) {
            return false;
        }

        const guidanceKey = this._getGuidanceKey(error);
        const guidance = this._guidanceDatabase.get(guidanceKey);
        
        if (!guidance) {
            this.logger.debug(`No guidance available for error: ${error.code || error.name}`);
            return false;
        }

        // Check if we've already shown this guidance recently
        if (this._shownGuidance.has(guidanceKey)) {
            return false;
        }

        // Mark as shown (expires after 5 minutes)
        this._shownGuidance.add(guidanceKey);
        setTimeout(() => {
            this._shownGuidance.delete(guidanceKey);
        }, 5 * 60 * 1000);

        return await this._displayGuidance(guidance, error, context);
    }

    /**
     * Show guidance for a specific scenario
     * @param {string} scenario - Scenario identifier
     * @param {Object} [context] - Additional context
     * @returns {Promise<boolean>} True if guidance was shown
     */
    async showScenarioGuidance(scenario, context = {}) {
        if (!this._isEnabled) {
            return false;
        }

        const guidance = this._guidanceDatabase.get(scenario);
        if (!guidance) {
            this.logger.debug(`No guidance available for scenario: ${scenario}`);
            return false;
        }

        return await this._displayGuidance(guidance, null, context);
    }

    /**
     * Show first-time setup guidance
     * @returns {Promise<void>}
     */
    async showSetupGuidance() {
        const guidance = {
            type: GUIDANCE_TYPES.TUTORIAL,
            title: 'Welcome to Local LLM Extension',
            message: 'Let\'s get you set up with local AI server integration.',
            steps: [
                'Download and install a local AI server (LM Studio, Ollama, etc.)',
                'Launch your AI server and download a model',
                'Enable the local server (Server tab)',
                'The extension will automatically connect to http://localhost:1234'
            ],
            actions: [
                { label: 'Setup Guide', command: 'vscode.open', args: ['https://lmstudio.ai'] },
                { label: 'Check Settings', command: 'workbench.action.openSettings', args: ['lmstudio'] }
            ]
        };

        await this._displayGuidance(guidance);
    }

    /**
     * Show troubleshooting guide
     * @param {string} [category] - Specific category to show
     * @returns {Promise<void>}
     */
    async showTroubleshootingGuide(category = null) {
        if (category) {
            const guidance = this._guidanceDatabase.get(`troubleshooting_${category}`);
            if (guidance) {
                await this._displayGuidance(guidance);
                return;
            }
        }

        // Show general troubleshooting
        const guidance = {
            type: GUIDANCE_TYPES.TROUBLESHOOTING,
            title: 'Local LLM Troubleshooting Guide',
            message: 'Common issues and solutions:',
            sections: [
                {
                    title: 'Connection Issues',
                    items: [
                        'Ensure your AI server is running',
                        'Check that the local server is enabled',
                        'Verify the server URL in extension settings',
                        'Check firewall settings'
                    ]
                },
                {
                    title: 'Model Issues',
                    items: [
                        'Make sure a model is loaded in your AI server',
                        'Check available system memory',
                        'Try a smaller model if loading fails',
                        'Refresh the model list'
                    ]
                },
                {
                    title: 'Performance Issues',
                    items: [
                        'Close other applications to free memory',
                        'Use a quantized model for better performance',
                        'Adjust temperature and token limits',
                        'Check system resources'
                    ]
                }
            ],
            actions: [
                { label: 'Check Settings', command: 'workbench.action.openSettings', args: ['lmstudio'] },
                { label: 'Refresh Models', command: 'lmstudio.refreshModels' },
                { label: 'Test Connection', command: 'lmstudio.testConnection' }
            ]
        };

        await this._displayGuidance(guidance);
    }

    /**
     * Enable or disable guidance system
     * @param {boolean} enabled - Whether to enable guidance
     */
    setEnabled(enabled) {
        this._isEnabled = enabled;
        this.logger.info(`User guidance ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Clear shown guidance cache
     */
    clearShownGuidance() {
        this._shownGuidance.clear();
    }

    /**
     * Initialize the guidance database
     * @private
     */
    _initializeGuidanceDatabase() {
        // Connection error guidance
        this._guidanceDatabase.set('CONNECTION_REFUSED', {
            type: GUIDANCE_TYPES.QUICK_FIX,
            title: 'Cannot Connect to AI Server',
            message: 'The extension cannot connect to your AI server. Here\'s how to fix it:',
            steps: [
                'Make sure your AI server is running on your computer',
                'In your AI server, go to the "Server" tab',
                'Click "Start Server" if it\'s not already running',
                'Verify the server is running on port 1234'
            ],
            actions: [
                { label: 'Check Settings', command: 'workbench.action.openSettings', args: ['lmstudio'] },
                { label: 'Retry Connection', command: 'lmstudio.testConnection' }
            ]
        });

        this._guidanceDatabase.set('TIMEOUT', {
            type: GUIDANCE_TYPES.TROUBLESHOOTING,
            title: 'Connection Timeout',
            message: 'The connection to your AI server timed out. This might be due to:',
            items: [
                'AI server is overloaded',
                'Network connectivity issues',
                'Firewall blocking the connection',
                'Your AI server is processing a large model'
            ],
            actions: [
                { label: 'Retry', command: 'lmstudio.testConnection' },
                { label: 'Check Settings', command: 'workbench.action.openSettings', args: ['lmstudio'] }
            ]
        });

        // Model error guidance
        this._guidanceDatabase.set('MODEL_NOT_FOUND', {
            type: GUIDANCE_TYPES.QUICK_FIX,
            title: 'Model Not Found',
            message: 'The selected model was not found in your AI server.',
            steps: [
                'Check if the model is still available in your AI server',
                'Refresh the model list to get the latest models',
                'Select a different model if the current one was removed'
            ],
            actions: [
                { label: 'Refresh Models', command: 'lmstudio.refreshModels' },
                { label: 'Select Model', command: 'lmstudio.selectModel' }
            ]
        });

        this._guidanceDatabase.set('MODEL_NOT_LOADED', {
            type: GUIDANCE_TYPES.QUICK_FIX,
            title: 'Model Not Loaded',
            message: 'The selected model is not currently loaded in your AI server.',
            steps: [
                'Open your AI server',
                'Go to the "Chat" or "Playground" tab',
                'Select and load the model you want to use',
                'Wait for the model to finish loading'
            ],
            actions: [
                { label: 'Refresh Models', command: 'lmstudio.refreshModels' },
                { label: 'Select Different Model', command: 'lmstudio.selectModel' }
            ]
        });

        this._guidanceDatabase.set('MODEL_LOAD_FAILED', {
            type: GUIDANCE_TYPES.TROUBLESHOOTING,
            title: 'Model Failed to Load',
            message: 'The model could not be loaded. Common causes:',
            items: [
                'Insufficient system memory (RAM)',
                'Model file is corrupted',
                'Incompatible model format',
                'System resources are exhausted'
            ],
            steps: [
                'Close other applications to free memory',
                'Try loading a smaller model',
                'Restart your AI server',
                'Check available disk space'
            ],
            actions: [
                { label: 'Select Smaller Model', command: 'lmstudio.selectModel' },
                { label: 'Refresh Models', command: 'lmstudio.refreshModels' }
            ]
        });

        // API error guidance
        this._guidanceDatabase.set('SERVER_ERROR', {
            type: GUIDANCE_TYPES.TROUBLESHOOTING,
            title: 'LM Studio Server Error',
            message: 'LM Studio encountered an internal error.',
            steps: [
                'Wait a moment and try again',
                'Check LM Studio logs for error details',
                'Restart your AI server if the problem persists',
                'Update your AI server to the latest version'
            ],
            actions: [
                { label: 'Retry', command: 'lmstudio.testConnection' },
                { label: 'Check Settings', command: 'workbench.action.openSettings', args: ['lmstudio'] }
            ]
        });

        // Configuration guidance
        this._guidanceDatabase.set('setup_first_time', {
            type: GUIDANCE_TYPES.TUTORIAL,
            title: 'First Time Setup',
            message: 'Welcome! Let\'s set up local AI server integration.',
            steps: [
                'Install a local AI server (LM Studio, Ollama, etc.)',
                'Download a model (e.g., Llama 2 7B)',
                'Start the local server in your AI server',
                'The extension will connect automatically'
            ],
            actions: [
                { label: 'Setup Guide', command: 'vscode.open', args: ['https://lmstudio.ai'] },
                { label: 'Test Connection', command: 'lmstudio.testConnection' }
            ]
        });

        // Performance guidance
        this._guidanceDatabase.set('performance_tips', {
            type: GUIDANCE_TYPES.CONFIGURATION,
            title: 'Performance Tips',
            message: 'Optimize your local AI experience:',
            sections: [
                {
                    title: 'Model Selection',
                    items: [
                        'Use quantized models (Q4, Q5) for better performance',
                        'Smaller models respond faster',
                        'Consider your available RAM when choosing models'
                    ]
                },
                {
                    title: 'Settings Optimization',
                    items: [
                        'Lower temperature for more consistent responses',
                        'Reduce max tokens for faster responses',
                        'Adjust timeout settings based on your hardware'
                    ]
                }
            ],
            actions: [
                { label: 'Open Settings', command: 'workbench.action.openSettings', args: ['lmstudio'] },
                { label: 'Select Model', command: 'lmstudio.selectModel' }
            ]
        });
    }

    /**
     * Get guidance key for an error
     * @private
     * @param {Error} error - Error object
     * @returns {string} Guidance key
     */
    _getGuidanceKey(error) {
        if (error.code) {
            return error.code;
        }
        
        if (error.category) {
            return error.category;
        }
        
        return error.name || 'unknown_error';
    }

    /**
     * Display guidance to the user
     * @private
     * @param {Object} guidance - Guidance object
     * @param {Error} [error] - Associated error
     * @param {Object} [context] - Additional context
     * @returns {Promise<boolean>} True if guidance was displayed
     */
    async _displayGuidance(guidance, error = null, context = {}) {
        try {
            switch (guidance.type) {
                case GUIDANCE_TYPES.QUICK_FIX:
                    return await this._showQuickFixGuidance(guidance);
                case GUIDANCE_TYPES.TUTORIAL:
                    return await this._showTutorialGuidance(guidance);
                case GUIDANCE_TYPES.TROUBLESHOOTING:
                    return await this._showTroubleshootingGuidance(guidance);
                case GUIDANCE_TYPES.CONFIGURATION:
                    return await this._showConfigurationGuidance(guidance);
                default:
                    return await this._showGenericGuidance(guidance);
            }
        } catch (displayError) {
            this.logger.error('Error displaying guidance', displayError);
            return false;
        }
    }

    /**
     * Show quick fix guidance
     * @private
     * @param {Object} guidance - Guidance object
     * @returns {Promise<boolean>} True if displayed
     */
    async _showQuickFixGuidance(guidance) {
        const message = this._formatMessage(guidance);
        const actions = guidance.actions?.map(action => action.label) || [];
        
        const choice = await vscode.window.showWarningMessage(message, ...actions);
        
        if (choice) {
            await this._executeAction(guidance.actions.find(a => a.label === choice));
        }
        
        return true;
    }

    /**
     * Show tutorial guidance
     * @private
     * @param {Object} guidance - Guidance object
     * @returns {Promise<boolean>} True if displayed
     */
    async _showTutorialGuidance(guidance) {
        const message = this._formatMessage(guidance);
        const actions = guidance.actions?.map(action => action.label) || [];
        actions.push('Show Details');
        
        const choice = await vscode.window.showInformationMessage(message, ...actions);
        
        if (choice === 'Show Details') {
            await this._showDetailedGuidance(guidance);
        } else if (choice) {
            await this._executeAction(guidance.actions.find(a => a.label === choice));
        }
        
        return true;
    }

    /**
     * Show troubleshooting guidance
     * @private
     * @param {Object} guidance - Guidance object
     * @returns {Promise<boolean>} True if displayed
     */
    async _showTroubleshootingGuidance(guidance) {
        const message = this._formatMessage(guidance);
        const actions = guidance.actions?.map(action => action.label) || [];
        actions.push('Show Guide');
        
        const choice = await vscode.window.showErrorMessage(message, ...actions);
        
        if (choice === 'Show Guide') {
            await this._showDetailedGuidance(guidance);
        } else if (choice) {
            await this._executeAction(guidance.actions.find(a => a.label === choice));
        }
        
        return true;
    }

    /**
     * Show configuration guidance
     * @private
     * @param {Object} guidance - Guidance object
     * @returns {Promise<boolean>} True if displayed
     */
    async _showConfigurationGuidance(guidance) {
        const message = this._formatMessage(guidance);
        const actions = guidance.actions?.map(action => action.label) || [];
        
        const choice = await vscode.window.showInformationMessage(message, ...actions);
        
        if (choice) {
            await this._executeAction(guidance.actions.find(a => a.label === choice));
        }
        
        return true;
    }

    /**
     * Show generic guidance
     * @private
     * @param {Object} guidance - Guidance object
     * @returns {Promise<boolean>} True if displayed
     */
    async _showGenericGuidance(guidance) {
        const message = this._formatMessage(guidance);
        await vscode.window.showInformationMessage(message);
        return true;
    }

    /**
     * Show detailed guidance in a webview or output channel
     * @private
     * @param {Object} guidance - Guidance object
     */
    async _showDetailedGuidance(guidance) {
        // For now, show in output channel
        // In a full implementation, this could be a webview
        const outputChannel = vscode.window.createOutputChannel('Local LLM Guidance');
        outputChannel.clear();
        outputChannel.appendLine(`# ${guidance.title}\n`);
        
        if (guidance.message) {
            outputChannel.appendLine(`${guidance.message}\n`);
        }
        
        if (guidance.steps) {
            outputChannel.appendLine('## Steps:');
            guidance.steps.forEach((step, index) => {
                outputChannel.appendLine(`${index + 1}. ${step}`);
            });
            outputChannel.appendLine('');
        }
        
        if (guidance.items) {
            outputChannel.appendLine('## Items:');
            guidance.items.forEach(item => {
                outputChannel.appendLine(`• ${item}`);
            });
            outputChannel.appendLine('');
        }
        
        if (guidance.sections) {
            guidance.sections.forEach(section => {
                outputChannel.appendLine(`## ${section.title}`);
                section.items.forEach(item => {
                    outputChannel.appendLine(`• ${item}`);
                });
                outputChannel.appendLine('');
            });
        }
        
        outputChannel.show();
    }

    /**
     * Format guidance message
     * @private
     * @param {Object} guidance - Guidance object
     * @returns {string} Formatted message
     */
    _formatMessage(guidance) {
        let message = guidance.title;
        
        if (guidance.message) {
            message += `: ${guidance.message}`;
        }
        
        return message;
    }

    /**
     * Execute a guidance action
     * @private
     * @param {Object} action - Action to execute
     */
    async _executeAction(action) {
        if (!action) {
            return;
        }
        
        try {
            if (action.command) {
                if (action.args) {
                    await vscode.commands.executeCommand(action.command, ...action.args);
                } else {
                    await vscode.commands.executeCommand(action.command);
                }
            }
        } catch (error) {
            this.logger.error('Error executing guidance action', error);
        }
    }
}

// Global user guidance system instance
const userGuidanceSystem = new UserGuidanceSystem();

/**
 * Show error guidance
 * @param {Error} error - Error that occurred
 * @param {Object} [context] - Additional context
 * @returns {Promise<boolean>} True if guidance was shown
 */
async function showErrorGuidance(error, context = {}) {
    return userGuidanceSystem.showErrorGuidance(error, context);
}

/**
 * Show scenario guidance
 * @param {string} scenario - Scenario identifier
 * @param {Object} [context] - Additional context
 * @returns {Promise<boolean>} True if guidance was shown
 */
async function showScenarioGuidance(scenario, context = {}) {
    return userGuidanceSystem.showScenarioGuidance(scenario, context);
}

/**
 * Show setup guidance
 * @returns {Promise<void>}
 */
async function showSetupGuidance() {
    return userGuidanceSystem.showSetupGuidance();
}

/**
 * Show troubleshooting guide
 * @param {string} [category] - Specific category
 * @returns {Promise<void>}
 */
async function showTroubleshootingGuide(category = null) {
    return userGuidanceSystem.showTroubleshootingGuide(category);
}

module.exports = {
    UserGuidanceSystem,
    GUIDANCE_TYPES,
    userGuidanceSystem,
    showErrorGuidance,
    showScenarioGuidance,
    showSetupGuidance,
    showTroubleshootingGuide
};