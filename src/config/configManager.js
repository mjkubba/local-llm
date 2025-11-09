/**
 * @fileoverview Configuration manager for VS Code integration
 * Handles reading, writing, and monitoring VS Code settings for the LM Studio extension.
 */

const vscode = require('vscode');
const { EventEmitter } = require('events');
const { ExtensionConfig } = require('./extensionConfig');
const { ValidationError, RuntimeError } = require('../models/errors');

/**
 * Configuration manager for VS Code settings integration
 * @class
 */
class ConfigurationManager extends EventEmitter {
    /**
     * Create a ConfigurationManager instance
     */
    constructor() {
        super();
        this._config = null;
        this._listeners = new Set();
        this._disposables = [];
        this._persistedValues = new Map();
        
        // Listen for configuration changes
        this._disposables.push(
            vscode.workspace.onDidChangeConfiguration(this._onConfigurationChanged.bind(this))
        );
    }

    /**
     * Initialize the configuration manager
     * @returns {Promise<ExtensionConfig>} Current configuration
     */
    async initialize() {
        await this._loadConfiguration();
        return this._config;
    }

    /**
     * Get the current configuration
     * @returns {ExtensionConfig} Current configuration
     */
    getConfiguration() {
        if (!this._config) {
            throw new RuntimeError(
                'Configuration not initialized. Call initialize() first.',
                'CONFIG_NOT_INITIALIZED'
            );
        }
        return this._config;
    }

    /**
     * Update configuration with new values
     * @param {Object} updates - Configuration updates
     * @param {boolean} [global=false] - Whether to update global settings
     * @returns {Promise<ExtensionConfig>} Updated configuration
     */
    async updateConfiguration(updates, global = false) {
        const vsConfig = vscode.workspace.getConfiguration('lmstudio');
        
        try {
            // Update VS Code settings
            for (const [key, value] of Object.entries(updates)) {
                await this._updateVSCodeSetting(vsConfig, key, value, global);
            }

            // Reload configuration
            await this._loadConfiguration();
            
            // Notify listeners
            this._notifyListeners(this._config);
            
            return this._config;
        } catch (error) {
            throw new RuntimeError(
                `Failed to update configuration: ${error.message}`,
                'CONFIG_UPDATE_FAILED',
                error
            );
        }
    }

    /**
     * Reset configuration to defaults
     * @param {boolean} [global=false] - Whether to reset global settings
     * @returns {Promise<ExtensionConfig>} Reset configuration
     */
    async resetConfiguration(global = false) {
        const vsConfig = vscode.workspace.getConfiguration('lmstudio');
        const defaultConfig = ExtensionConfig.createDefault();
        
        try {
            // Reset all settings to undefined (uses defaults)
            const configObject = defaultConfig.toObject();
            for (const key of Object.keys(configObject)) {
                await vsConfig.update(key, undefined, global);
            }

            // Reload configuration
            await this._loadConfiguration();
            
            // Notify listeners
            this._notifyListeners(this._config);
            
            return this._config;
        } catch (error) {
            throw new RuntimeError(
                `Failed to reset configuration: ${error.message}`,
                'CONFIG_RESET_FAILED',
                error
            );
        }
    }

    /**
     * Add a configuration change listener
     * @param {Function} listener - Listener function (config) => void
     * @returns {Function} Disposable function to remove listener
     */
    onConfigurationChanged(listener) {
        if (typeof listener !== 'function') {
            throw new ValidationError(
                'Listener must be a function',
                'INVALID_LISTENER',
                'listener',
                listener
            );
        }

        this._listeners.add(listener);
        
        // Return disposable
        return () => {
            this._listeners.delete(listener);
        };
    }

    /**
     * Validate current configuration
     * @returns {Promise<boolean>} True if configuration is valid
     * @throws {ValidationError} If configuration is invalid
     */
    async validateConfiguration() {
        if (!this._config) {
            await this._loadConfiguration();
        }
        
        return this._config.validate();
    }

    /**
     * Get configuration schema for VS Code settings
     * @returns {Object} VS Code configuration schema
     */
    static getConfigurationSchema() {
        return {
            type: 'object',
            title: 'LM Studio',
            properties: {
                'lmstudio.serverUrl': {
                    type: 'string',
                    default: 'http://localhost:1234',
                    description: 'LM Studio server URL',
                    pattern: '^https?://.+',
                    patternErrorMessage: 'Must be a valid HTTP or HTTPS URL'
                },
                'lmstudio.defaultModel': {
                    type: 'string',
                    default: '',
                    description: 'Default model ID to use for AI operations'
                },
                'lmstudio.chatSettings.temperature': {
                    type: 'number',
                    default: 0.7,
                    minimum: 0,
                    maximum: 2,
                    description: 'Chat completion temperature (0-2)'
                },
                'lmstudio.chatSettings.maxTokens': {
                    type: 'integer',
                    default: 1000,
                    minimum: 1,
                    maximum: 100000,
                    description: 'Maximum tokens for chat completions'
                },
                'lmstudio.chatSettings.systemPrompt': {
                    type: 'string',
                    default: 'You are a helpful AI assistant for software development.',
                    description: 'Default system prompt for chat conversations'
                },
                'lmstudio.completionSettings.temperature': {
                    type: 'number',
                    default: 0.7,
                    minimum: 0,
                    maximum: 2,
                    description: 'Text completion temperature (0-2)'
                },
                'lmstudio.completionSettings.maxTokens': {
                    type: 'integer',
                    default: 500,
                    minimum: 1,
                    maximum: 100000,
                    description: 'Maximum tokens for text completions'
                },
                'lmstudio.completionSettings.stopSequences': {
                    type: 'array',
                    items: {
                        type: 'string'
                    },
                    default: ['\n\n', '```'],
                    description: 'Stop sequences for text completions'
                },
                'lmstudio.connectionSettings.timeout': {
                    type: 'integer',
                    default: 120000,
                    minimum: 1000,
                    maximum: 300000,
                    description: 'Request timeout in milliseconds (default: 2 minutes)'
                },
                'lmstudio.connectionSettings.retryAttempts': {
                    type: 'integer',
                    default: 3,
                    minimum: 0,
                    maximum: 10,
                    description: 'Number of retry attempts for failed requests'
                },
                'lmstudio.connectionSettings.healthCheckInterval': {
                    type: 'integer',
                    default: 60000,
                    minimum: 10000,
                    maximum: 600000,
                    description: 'Health check interval in milliseconds'
                }
            }
        };
    }

    /**
     * Set a persisted value (stored in extension context)
     * @param {string} key - The key to store
     * @param {*} value - The value to store
     * @returns {Promise<void>}
     */
    async setPersistedValue(key, value) {
        this._persistedValues.set(key, value);
        // In a real implementation, this would use vscode.ExtensionContext.globalState
        // For now, just store in memory
    }

    /**
     * Get a persisted value
     * @param {string} key - The key to retrieve
     * @returns {*} The stored value or undefined
     */
    getPersistedValue(key) {
        return this._persistedValues.get(key);
    }

    /**
     * Update a single configuration setting
     * @param {string} key - Configuration key
     * @param {*} value - New value
     * @param {boolean} [global=false] - Whether to update global settings
     * @returns {Promise<ExtensionConfig>} Updated configuration
     */
    async updateSingleConfiguration(key, value, global = false) {
        const updates = {};
        updates[key] = value;
        return this.updateConfiguration(updates, global);
    }

    /**
     * Dispose of the configuration manager
     */
    dispose() {
        this._disposables.forEach(disposable => disposable.dispose());
        this._disposables.length = 0;
        this._listeners.clear();
        this.removeAllListeners();
    }

    /**
     * Load configuration from VS Code settings
     * @private
     * @returns {Promise<void>}
     */
    async _loadConfiguration() {
        try {
            const vsConfig = vscode.workspace.getConfiguration('lmstudio');
            
            // Get configuration values with proper type handling
            const serverUrl = vsConfig.get('serverUrl');
            const defaultModel = vsConfig.get('defaultModel');
            
            // Get nested configuration objects
            const chatSettings = vsConfig.get('chatSettings') || {};
            const completionSettings = vsConfig.get('completionSettings') || {};
            const connectionSettings = vsConfig.get('connectionSettings') || {};
            
            // Debug logging
            console.log('Raw serverUrl from VS Code:', serverUrl, 'Type:', typeof serverUrl);
            console.log('Raw chatSettings:', chatSettings);
            console.log('Raw completionSettings:', completionSettings);
            console.log('Raw connectionSettings:', connectionSettings);
            
            const configData = {
                serverUrl: typeof serverUrl === 'string' ? serverUrl : 'http://localhost:1234',
                defaultModel: typeof defaultModel === 'string' ? defaultModel : '',
                chatSettings: {
                    temperature: chatSettings.temperature ?? 0.7,
                    maxTokens: chatSettings.maxTokens ?? 1000,
                    systemPrompt: chatSettings.systemPrompt ?? 'You are a helpful AI assistant for software development.'
                },
                completionSettings: {
                    temperature: completionSettings.temperature ?? 0.7,
                    maxTokens: completionSettings.maxTokens ?? 500,
                    stopSequences: completionSettings.stopSequences ?? ['\n\n', '```']
                },
                connectionSettings: {
                    timeout: connectionSettings.timeout ?? 120000,
                    retryAttempts: connectionSettings.retryAttempts ?? 3,
                    healthCheckInterval: connectionSettings.healthCheckInterval ?? 60000
                }
            };

            console.log('ConfigData before ExtensionConfig:', JSON.stringify(configData, null, 2));

            // Create and sanitize configuration
            this._config = new ExtensionConfig(configData).sanitize();
            
            console.log('Config after sanitize - serverUrl:', this._config.serverUrl, 'Type:', typeof this._config.serverUrl);
            
        } catch (error) {
            // If loading fails, use default configuration
            console.warn('Failed to load configuration, using defaults:', error);
            this._config = ExtensionConfig.createDefault();
        }
    }

    /**
     * Handle VS Code configuration changes
     * @private
     * @param {vscode.ConfigurationChangeEvent} event - Configuration change event
     */
    async _onConfigurationChanged(event) {
        if (event.affectsConfiguration('lmstudio')) {
            const oldConfig = this._config;
            await this._loadConfiguration();
            
            // Only notify if configuration actually changed
            if (!this._configsEqual(oldConfig, this._config)) {
                this._notifyListeners(this._config);
            }
        }
    }

    /**
     * Update a VS Code setting
     * @private
     * @param {vscode.WorkspaceConfiguration} vsConfig - VS Code configuration
     * @param {string} key - Setting key
     * @param {*} value - Setting value
     * @param {boolean} global - Whether to update global settings
     * @returns {Promise<void>}
     */
    async _updateVSCodeSetting(vsConfig, key, value, global) {
        // Handle nested settings
        if (key.includes('.')) {
            const parts = key.split('.');
            const settingKey = parts.join('.');
            await vsConfig.update(settingKey, value, global);
        } else {
            await vsConfig.update(key, value, global);
        }
    }

    /**
     * Notify all listeners of configuration changes
     * @private
     * @param {ExtensionConfig} config - New configuration
     */
    _notifyListeners(config) {
        for (const listener of this._listeners) {
            try {
                listener(config);
            } catch (error) {
                console.error('Configuration listener error:', error);
            }
        }
    }

    /**
     * Compare two configurations for equality
     * @private
     * @param {ExtensionConfig} config1 - First configuration
     * @param {ExtensionConfig} config2 - Second configuration
     * @returns {boolean} True if configurations are equal
     */
    _configsEqual(config1, config2) {
        if (!config1 || !config2) {
            return config1 === config2;
        }

        try {
            return JSON.stringify(config1.toObject()) === JSON.stringify(config2.toObject());
        } catch (error) {
            return false;
        }
    }
}

module.exports = {
    ConfigurationManager
};