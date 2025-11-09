/**
 * @fileoverview Extension configuration data structures
 * Defines the configuration schema and default values for the LM Studio extension.
 */

const { DEFAULTS } = require('../models/constants');
const { validateServerUrl } = require('../models/validation');
const { ValidationError } = require('../models/errors');

/**
 * Chat-specific configuration settings
 * @class
 */
class ChatConfig {
    /**
     * Create a ChatConfig instance
     * @param {Object} [config={}] - Configuration object
     * @param {number} [config.temperature] - Sampling temperature (0-2)
     * @param {number} [config.maxTokens] - Maximum tokens to generate
     * @param {string} [config.systemPrompt] - Default system prompt
     */
    constructor(config = {}) {
        // Use fallback values if DEFAULTS is undefined (bundling issue)
        const defaultTemperature = (DEFAULTS && DEFAULTS.CHAT) ? DEFAULTS.CHAT.TEMPERATURE : 0.7;
        const defaultMaxTokens = (DEFAULTS && DEFAULTS.CHAT) ? DEFAULTS.CHAT.MAX_TOKENS : 1000;
        const defaultSystemPrompt = (DEFAULTS && DEFAULTS.CHAT) ? DEFAULTS.CHAT.SYSTEM_PROMPT : 'You are a helpful AI assistant for software development.';
        
        this.temperature = config.temperature ?? defaultTemperature;
        this.maxTokens = config.maxTokens ?? defaultMaxTokens;
        this.systemPrompt = config.systemPrompt ?? defaultSystemPrompt;
    }

    /**
     * Validate chat configuration
     * @throws {ValidationError} If validation fails
     * @returns {boolean} True if valid
     */
    validate() {
        if (typeof this.temperature !== 'number' || this.temperature < 0 || this.temperature > 2) {
            throw new ValidationError(
                'Chat temperature must be between 0 and 2',
                'INVALID_CHAT_TEMPERATURE',
                'temperature',
                this.temperature
            );
        }

        if (!Number.isInteger(this.maxTokens) || this.maxTokens <= 0) {
            throw new ValidationError(
                'Chat maxTokens must be a positive integer',
                'INVALID_CHAT_MAX_TOKENS',
                'maxTokens',
                this.maxTokens
            );
        }

        if (typeof this.systemPrompt !== 'string') {
            throw new ValidationError(
                'Chat systemPrompt must be a string',
                'INVALID_CHAT_SYSTEM_PROMPT',
                'systemPrompt',
                this.systemPrompt
            );
        }

        return true;
    }

    /**
     * Convert to plain object
     * @returns {Object} Plain object representation
     */
    toObject() {
        return {
            temperature: this.temperature,
            maxTokens: this.maxTokens,
            systemPrompt: this.systemPrompt
        };
    }

    /**
     * Create from plain object
     * @param {Object} obj - Plain object
     * @returns {ChatConfig} ChatConfig instance
     */
    static fromObject(obj) {
        return new ChatConfig(obj);
    }
}

/**
 * Text completion configuration settings
 * @class
 */
class CompletionConfig {
    /**
     * Create a CompletionConfig instance
     * @param {Object} [config={}] - Configuration object
     * @param {number} [config.temperature] - Sampling temperature (0-2)
     * @param {number} [config.maxTokens] - Maximum tokens to generate
     * @param {string[]} [config.stopSequences] - Stop sequences for completion
     */
    constructor(config = {}) {
        // Use fallback values if DEFAULTS is undefined (bundling issue)
        const defaultTemperature = (DEFAULTS && DEFAULTS.COMPLETION) ? DEFAULTS.COMPLETION.TEMPERATURE : 0.7;
        const defaultMaxTokens = (DEFAULTS && DEFAULTS.COMPLETION) ? DEFAULTS.COMPLETION.MAX_TOKENS : 500;
        const defaultStopSequences = (DEFAULTS && DEFAULTS.COMPLETION) ? [...DEFAULTS.COMPLETION.STOP_SEQUENCES] : ['\n\n', '```'];
        
        this.temperature = config.temperature ?? defaultTemperature;
        this.maxTokens = config.maxTokens ?? defaultMaxTokens;
        this.stopSequences = config.stopSequences ?? defaultStopSequences;
    }

    /**
     * Validate completion configuration
     * @throws {ValidationError} If validation fails
     * @returns {boolean} True if valid
     */
    validate() {
        if (typeof this.temperature !== 'number' || this.temperature < 0 || this.temperature > 2) {
            throw new ValidationError(
                'Completion temperature must be between 0 and 2',
                'INVALID_COMPLETION_TEMPERATURE',
                'temperature',
                this.temperature
            );
        }

        if (!Number.isInteger(this.maxTokens) || this.maxTokens <= 0) {
            throw new ValidationError(
                'Completion maxTokens must be a positive integer',
                'INVALID_COMPLETION_MAX_TOKENS',
                'maxTokens',
                this.maxTokens
            );
        }

        if (!Array.isArray(this.stopSequences)) {
            throw new ValidationError(
                'Completion stopSequences must be an array',
                'INVALID_COMPLETION_STOP_SEQUENCES',
                'stopSequences',
                this.stopSequences
            );
        }

        this.stopSequences.forEach((seq, index) => {
            if (typeof seq !== 'string') {
                throw new ValidationError(
                    `Stop sequence at index ${index} must be a string`,
                    'INVALID_STOP_SEQUENCE',
                    `stopSequences[${index}]`,
                    seq
                );
            }
        });

        return true;
    }

    /**
     * Convert to plain object
     * @returns {Object} Plain object representation
     */
    toObject() {
        return {
            temperature: this.temperature,
            maxTokens: this.maxTokens,
            stopSequences: [...this.stopSequences]
        };
    }

    /**
     * Create from plain object
     * @param {Object} obj - Plain object
     * @returns {CompletionConfig} CompletionConfig instance
     */
    static fromObject(obj) {
        return new CompletionConfig(obj);
    }
}

/**
 * Connection configuration settings
 * @class
 */
class ConnectionConfig {
    /**
     * Create a ConnectionConfig instance
     * @param {Object} [config={}] - Configuration object
     * @param {number} [config.timeout] - Request timeout in milliseconds
     * @param {number} [config.retryAttempts] - Number of retry attempts
     * @param {number} [config.healthCheckInterval] - Health check interval in milliseconds
     */
    constructor(config = {}) {
        // Use fallback values if DEFAULTS is undefined (bundling issue)
        const defaultTimeout = (DEFAULTS && DEFAULTS.CONNECTION) ? DEFAULTS.CONNECTION.TIMEOUT : 120000;
        const defaultRetryAttempts = (DEFAULTS && DEFAULTS.CONNECTION) ? DEFAULTS.CONNECTION.RETRY_ATTEMPTS : 3;
        const defaultHealthCheckInterval = (DEFAULTS && DEFAULTS.CONNECTION) ? DEFAULTS.CONNECTION.HEALTH_CHECK_INTERVAL : 60000;
        
        this.timeout = config.timeout ?? defaultTimeout;
        this.retryAttempts = config.retryAttempts ?? defaultRetryAttempts;
        this.healthCheckInterval = config.healthCheckInterval ?? defaultHealthCheckInterval;
    }

    /**
     * Validate connection configuration
     * @throws {ValidationError} If validation fails
     * @returns {boolean} True if valid
     */
    validate() {
        if (!Number.isInteger(this.timeout) || this.timeout <= 0) {
            throw new ValidationError(
                'Connection timeout must be a positive integer',
                'INVALID_CONNECTION_TIMEOUT',
                'timeout',
                this.timeout
            );
        }

        if (!Number.isInteger(this.retryAttempts) || this.retryAttempts < 0) {
            throw new ValidationError(
                'Connection retryAttempts must be a non-negative integer',
                'INVALID_CONNECTION_RETRY_ATTEMPTS',
                'retryAttempts',
                this.retryAttempts
            );
        }

        if (!Number.isInteger(this.healthCheckInterval) || this.healthCheckInterval <= 0) {
            throw new ValidationError(
                'Connection healthCheckInterval must be a positive integer',
                'INVALID_CONNECTION_HEALTH_CHECK_INTERVAL',
                'healthCheckInterval',
                this.healthCheckInterval
            );
        }

        return true;
    }

    /**
     * Convert to plain object
     * @returns {Object} Plain object representation
     */
    toObject() {
        return {
            timeout: this.timeout,
            retryAttempts: this.retryAttempts,
            healthCheckInterval: this.healthCheckInterval
        };
    }

    /**
     * Create from plain object
     * @param {Object} obj - Plain object
     * @returns {ConnectionConfig} ConnectionConfig instance
     */
    static fromObject(obj) {
        return new ConnectionConfig(obj);
    }
}

/**
 * Main extension configuration class
 * @class
 */
class ExtensionConfig {
    /**
     * Create an ExtensionConfig instance
     * @param {Object} [config={}] - Configuration object
     * @param {string} [config.serverUrl] - LM Studio server URL
     * @param {string} [config.defaultModel] - Default model ID
     * @param {Object} [config.chatSettings] - Chat configuration
     * @param {Object} [config.completionSettings] - Completion configuration
     * @param {Object} [config.connectionSettings] - Connection configuration
     */
    constructor(config = {}) {
        // Use fallback values if DEFAULTS is undefined (bundling issue)
        const defaultServerUrl = DEFAULTS ? DEFAULTS.SERVER_URL : 'http://localhost:1234';
        
        this.serverUrl = config.serverUrl ?? defaultServerUrl;
        this.defaultModel = config.defaultModel ?? '';
        this.chatSettings = new ChatConfig(config.chatSettings);
        this.completionSettings = new CompletionConfig(config.completionSettings);
        this.connectionSettings = new ConnectionConfig(config.connectionSettings);
    }

    /**
     * Validate the entire configuration
     * @throws {ValidationError} If validation fails
     * @returns {boolean} True if valid
     */
    validate() {
        // Validate server URL
        validateServerUrl(this.serverUrl);

        // Validate default model (can be empty)
        if (this.defaultModel && typeof this.defaultModel !== 'string') {
            throw new ValidationError(
                'Default model must be a string',
                'INVALID_DEFAULT_MODEL',
                'defaultModel',
                this.defaultModel
            );
        }

        // Validate sub-configurations
        this.chatSettings.validate();
        this.completionSettings.validate();
        this.connectionSettings.validate();

        return true;
    }

    /**
     * Update configuration with new values
     * @param {Object} updates - Configuration updates
     * @returns {ExtensionConfig} Updated configuration instance
     */
    update(updates) {
        const newConfig = {
            serverUrl: updates.serverUrl ?? this.serverUrl,
            defaultModel: updates.defaultModel ?? this.defaultModel,
            chatSettings: updates.chatSettings ? 
                { ...this.chatSettings.toObject(), ...updates.chatSettings } : 
                this.chatSettings.toObject(),
            completionSettings: updates.completionSettings ? 
                { ...this.completionSettings.toObject(), ...updates.completionSettings } : 
                this.completionSettings.toObject(),
            connectionSettings: updates.connectionSettings ? 
                { ...this.connectionSettings.toObject(), ...updates.connectionSettings } : 
                this.connectionSettings.toObject()
        };

        return new ExtensionConfig(newConfig);
    }

    /**
     * Reset to default values
     * @returns {ExtensionConfig} New configuration with defaults
     */
    static createDefault() {
        return new ExtensionConfig();
    }

    /**
     * Convert to plain object for serialization
     * @returns {Object} Plain object representation
     */
    toObject() {
        return {
            serverUrl: this.serverUrl,
            defaultModel: this.defaultModel,
            chatSettings: this.chatSettings.toObject(),
            completionSettings: this.completionSettings.toObject(),
            connectionSettings: this.connectionSettings.toObject()
        };
    }

    /**
     * Create from plain object
     * @param {Object} obj - Plain object
     * @returns {ExtensionConfig} ExtensionConfig instance
     */
    static fromObject(obj) {
        return new ExtensionConfig(obj);
    }

    /**
     * Sanitize configuration values
     * Ensures all values are within valid ranges and formats
     * @returns {ExtensionConfig} Sanitized configuration
     */
    sanitize() {
        const sanitized = {
            serverUrl: this.sanitizeServerUrl(this.serverUrl),
            defaultModel: this.sanitizeDefaultModel(this.defaultModel),
            chatSettings: this.sanitizeChatSettings(this.chatSettings.toObject()),
            completionSettings: this.sanitizeCompletionSettings(this.completionSettings.toObject()),
            connectionSettings: this.sanitizeConnectionSettings(this.connectionSettings.toObject())
        };

        return new ExtensionConfig(sanitized);
    }

    /**
     * Sanitize server URL
     * @private
     * @param {string} url - URL to sanitize
     * @returns {string} Sanitized URL
     */
    sanitizeServerUrl(url) {
        if (!url || typeof url !== 'string') {
            return DEFAULTS ? DEFAULTS.SERVER_URL : 'http://localhost:1234';
        }

        // Remove trailing slash
        return url.replace(/\/$/, '');
    }

    /**
     * Sanitize default model
     * @private
     * @param {string} model - Model to sanitize
     * @returns {string} Sanitized model
     */
    sanitizeDefaultModel(model) {
        if (!model || typeof model !== 'string') {
            return '';
        }
        return model.trim();
    }

    /**
     * Sanitize chat settings
     * @private
     * @param {Object} settings - Settings to sanitize
     * @returns {Object} Sanitized settings
     */
    sanitizeChatSettings(settings) {
        // Use fallback values if DEFAULTS is undefined (bundling issue)
        const defaultTemperature = (DEFAULTS && DEFAULTS.CHAT) ? DEFAULTS.CHAT.TEMPERATURE : 0.7;
        const defaultMaxTokens = (DEFAULTS && DEFAULTS.CHAT) ? DEFAULTS.CHAT.MAX_TOKENS : 1000;
        const defaultSystemPrompt = (DEFAULTS && DEFAULTS.CHAT) ? DEFAULTS.CHAT.SYSTEM_PROMPT : 'You are a helpful AI assistant for software development.';
        
        return {
            temperature: this.clampNumber(settings.temperature, 0, 2, defaultTemperature),
            maxTokens: this.clampInteger(settings.maxTokens, 1, 100000, defaultMaxTokens),
            systemPrompt: typeof settings.systemPrompt === 'string' ? 
                settings.systemPrompt : defaultSystemPrompt
        };
    }

    /**
     * Sanitize completion settings
     * @private
     * @param {Object} settings - Settings to sanitize
     * @returns {Object} Sanitized settings
     */
    sanitizeCompletionSettings(settings) {
        // Use fallback values if DEFAULTS is undefined (bundling issue)
        const defaultTemperature = (DEFAULTS && DEFAULTS.COMPLETION) ? DEFAULTS.COMPLETION.TEMPERATURE : 0.7;
        const defaultMaxTokens = (DEFAULTS && DEFAULTS.COMPLETION) ? DEFAULTS.COMPLETION.MAX_TOKENS : 500;
        const defaultStopSequences = (DEFAULTS && DEFAULTS.COMPLETION) ? [...DEFAULTS.COMPLETION.STOP_SEQUENCES] : ['\n\n', '```'];
        
        return {
            temperature: this.clampNumber(settings.temperature, 0, 2, defaultTemperature),
            maxTokens: this.clampInteger(settings.maxTokens, 1, 100000, defaultMaxTokens),
            stopSequences: Array.isArray(settings.stopSequences) ? 
                settings.stopSequences.filter(seq => typeof seq === 'string') : 
                defaultStopSequences
        };
    }

    /**
     * Sanitize connection settings
     * @private
     * @param {Object} settings - Settings to sanitize
     * @returns {Object} Sanitized settings
     */
    sanitizeConnectionSettings(settings) {
        // Use fallback values if DEFAULTS is undefined (bundling issue)
        const defaultTimeout = (DEFAULTS && DEFAULTS.CONNECTION) ? DEFAULTS.CONNECTION.TIMEOUT : 120000;
        const defaultRetryAttempts = (DEFAULTS && DEFAULTS.CONNECTION) ? DEFAULTS.CONNECTION.RETRY_ATTEMPTS : 3;
        const defaultHealthCheckInterval = (DEFAULTS && DEFAULTS.CONNECTION) ? DEFAULTS.CONNECTION.HEALTH_CHECK_INTERVAL : 60000;
        
        return {
            timeout: this.clampInteger(settings.timeout, 1000, 300000, defaultTimeout),
            retryAttempts: this.clampInteger(settings.retryAttempts, 0, 10, defaultRetryAttempts),
            healthCheckInterval: this.clampInteger(settings.healthCheckInterval, 10000, 600000, defaultHealthCheckInterval)
        };
    }

    /**
     * Clamp a number to a valid range
     * @private
     * @param {*} value - Value to clamp
     * @param {number} min - Minimum value
     * @param {number} max - Maximum value
     * @param {number} defaultValue - Default value if invalid
     * @returns {number} Clamped number
     */
    clampNumber(value, min, max, defaultValue) {
        if (typeof value !== 'number' || isNaN(value)) {
            return defaultValue;
        }
        return Math.max(min, Math.min(max, value));
    }

    /**
     * Clamp an integer to a valid range
     * @private
     * @param {*} value - Value to clamp
     * @param {number} min - Minimum value
     * @param {number} max - Maximum value
     * @param {number} defaultValue - Default value if invalid
     * @returns {number} Clamped integer
     */
    clampInteger(value, min, max, defaultValue) {
        if (!Number.isInteger(value)) {
            return defaultValue;
        }
        return Math.max(min, Math.min(max, value));
    }
}

module.exports = {
    ChatConfig,
    CompletionConfig,
    ConnectionConfig,
    ExtensionConfig
};