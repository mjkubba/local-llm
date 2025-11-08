/**
 * @fileoverview Graceful degradation service for handling unavailable features
 * Provides fallback behavior when LM Studio is unavailable or models fail to load.
 */

const vscode = require('vscode');
const { getLogger } = require('./logger');
const { ConnectionError, ModelError, ApiError } = require('../models/errors');

/**
 * Feature states for graceful degradation
 * @readonly
 * @enum {string}
 */
const FEATURE_STATES = {
    /** Feature is fully available */
    AVAILABLE: 'available',
    /** Feature is partially available with limitations */
    LIMITED: 'limited',
    /** Feature is unavailable but may recover */
    UNAVAILABLE: 'unavailable',
    /** Feature is disabled due to repeated failures */
    DISABLED: 'disabled'
};

/**
 * Fallback strategies for different operations
 * @readonly
 * @enum {string}
 */
const FALLBACK_STRATEGIES = {
    /** Use cached/offline data */
    CACHED: 'cached',
    /** Use simplified functionality */
    SIMPLIFIED: 'simplified',
    /** Show helpful guidance to user */
    GUIDANCE: 'guidance',
    /** Disable feature completely */
    DISABLE: 'disable'
};

/**
 * Graceful degradation service
 * @class
 */
class GracefulDegradationService {
    /**
     * Create a GracefulDegradationService instance
     */
    constructor() {
        this.logger = getLogger('GracefulDegradation');
        this._featureStates = new Map();
        this._fallbackData = new Map();
        this._retryScheduler = new RetryScheduler();
        this._connectionMonitor = new ConnectionMonitor();
        this._isEnabled = true;
        
        // Initialize feature states
        this._initializeFeatureStates();
    }

    /**
     * Initialize the service
     * @param {Object} localLLMClient - LM Studio client instance
     * @param {Object} configManager - Configuration manager instance
     */
    initialize(localLLMClient, configManager) {
        this.localLLMClient = localLLMClient;
        this.configManager = configManager;
        
        // Start connection monitoring
        this._connectionMonitor.initialize(localLLMClient);
        this._connectionMonitor.onConnectionStateChanged(this._handleConnectionStateChange.bind(this));
        
        this.logger.info('Graceful degradation service initialized');
    }

    /**
     * Get the current state of a feature
     * @param {string} featureName - Name of the feature
     * @returns {string} Feature state from FEATURE_STATES
     */
    getFeatureState(featureName) {
        return this._featureStates.get(featureName) || FEATURE_STATES.UNAVAILABLE;
    }

    /**
     * Set the state of a feature
     * @param {string} featureName - Name of the feature
     * @param {string} state - New state from FEATURE_STATES
     */
    setFeatureState(featureName, state) {
        const oldState = this._featureStates.get(featureName);
        this._featureStates.set(featureName, state);
        
        if (oldState !== state) {
            this.logger.info(`Feature state changed: ${featureName} ${oldState} -> ${state}`);
            this._notifyFeatureStateChange(featureName, state, oldState);
        }
    }

    /**
     * Check if a feature is available
     * @param {string} featureName - Name of the feature
     * @returns {boolean} True if feature is available
     */
    isFeatureAvailable(featureName) {
        const state = this.getFeatureState(featureName);
        return state === FEATURE_STATES.AVAILABLE || state === FEATURE_STATES.LIMITED;
    }

    /**
     * Execute an operation with graceful degradation
     * @param {string} featureName - Name of the feature
     * @param {Function} operation - Operation to execute
     * @param {Object} [options] - Degradation options
     * @param {string} [options.fallbackStrategy] - Fallback strategy to use
     * @param {*} [options.fallbackValue] - Value to return on failure
     * @param {Function} [options.fallbackHandler] - Custom fallback handler
     * @returns {Promise<*>} Operation result or fallback value
     */
    async executeWithDegradation(featureName, operation, options = {}) {
        const {
            fallbackStrategy = FALLBACK_STRATEGIES.GUIDANCE,
            fallbackValue = null,
            fallbackHandler = null
        } = options;

        // Check if feature is disabled
        if (this.getFeatureState(featureName) === FEATURE_STATES.DISABLED) {
            return this._handleDisabledFeature(featureName, fallbackStrategy, fallbackValue);
        }

        try {
            // Attempt the operation
            const result = await operation();
            
            // Mark feature as available on success
            this.setFeatureState(featureName, FEATURE_STATES.AVAILABLE);
            
            return result;
            
        } catch (error) {
            this.logger.warn(`Operation failed for feature ${featureName}`, error);
            
            // Handle the error and determine degradation
            return this._handleOperationFailure(
                featureName, 
                error, 
                fallbackStrategy, 
                fallbackValue, 
                fallbackHandler
            );
        }
    }

    /**
     * Get models with fallback behavior
     * @returns {Promise<Array>} Array of models or fallback data
     */
    async getModelsWithFallback() {
        return this.executeWithDegradation('models', async () => {
            return await this.localLLMClient.getModels();
        }, {
            fallbackStrategy: FALLBACK_STRATEGIES.CACHED,
            fallbackHandler: () => this._getCachedModels()
        });
    }

    /**
     * Perform chat completion with fallback
     * @param {Object} request - Chat completion request
     * @returns {Promise<Object>} Chat completion response or fallback
     */
    async chatCompletionWithFallback(request) {
        return this.executeWithDegradation('chat', async () => {
            return await this.localLLMClient.chatCompletion(request);
        }, {
            fallbackStrategy: FALLBACK_STRATEGIES.GUIDANCE,
            fallbackHandler: () => this._getChatFallbackResponse(request)
        });
    }

    /**
     * Perform text completion with fallback
     * @param {Object} request - Text completion request
     * @returns {Promise<Object>} Text completion response or fallback
     */
    async textCompletionWithFallback(request) {
        return this.executeWithDegradation('completion', async () => {
            return await this.localLLMClient.textCompletion(request);
        }, {
            fallbackStrategy: FALLBACK_STRATEGIES.GUIDANCE,
            fallbackHandler: () => this._getCompletionFallbackResponse(request)
        });
    }

    /**
     * Generate embeddings with fallback
     * @param {Object} request - Embedding request
     * @returns {Promise<Object>} Embedding response or fallback
     */
    async generateEmbeddingsWithFallback(request) {
        return this.executeWithDegradation('embeddings', async () => {
            return await this.localLLMClient.generateEmbeddings(request);
        }, {
            fallbackStrategy: FALLBACK_STRATEGIES.SIMPLIFIED,
            fallbackHandler: () => this._getEmbeddingFallbackResponse(request)
        });
    }

    /**
     * Schedule a retry for a failed operation
     * @param {string} featureName - Name of the feature
     * @param {Function} operation - Operation to retry
     * @param {Object} [options] - Retry options
     */
    scheduleRetry(featureName, operation, options = {}) {
        this._retryScheduler.schedule(featureName, operation, options);
    }

    /**
     * Get degradation status for all features
     * @returns {Object} Status information
     */
    getStatus() {
        const features = {};
        for (const [name, state] of this._featureStates.entries()) {
            features[name] = state;
        }

        return {
            isEnabled: this._isEnabled,
            features,
            connectionState: this._connectionMonitor.getState(),
            retryQueue: this._retryScheduler.getStatus()
        };
    }

    /**
     * Enable or disable graceful degradation
     * @param {boolean} enabled - Whether to enable degradation
     */
    setEnabled(enabled) {
        this._isEnabled = enabled;
        this.logger.info(`Graceful degradation ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Dispose of the service
     */
    dispose() {
        this._connectionMonitor.dispose();
        this._retryScheduler.dispose();
        this._featureStates.clear();
        this._fallbackData.clear();
    }

    /**
     * Initialize default feature states
     * @private
     */
    _initializeFeatureStates() {
        const features = ['models', 'chat', 'completion', 'embeddings', 'connection'];
        for (const feature of features) {
            this._featureStates.set(feature, FEATURE_STATES.UNAVAILABLE);
        }
    }

    /**
     * Handle connection state changes
     * @private
     * @param {boolean} isConnected - Whether connection is available
     */
    _handleConnectionStateChange(isConnected) {
        if (isConnected) {
            this.setFeatureState('connection', FEATURE_STATES.AVAILABLE);
            // Re-enable other features when connection is restored
            for (const [feature, state] of this._featureStates.entries()) {
                if (feature !== 'connection' && state === FEATURE_STATES.UNAVAILABLE) {
                    this.setFeatureState(feature, FEATURE_STATES.LIMITED);
                }
            }
        } else {
            this.setFeatureState('connection', FEATURE_STATES.UNAVAILABLE);
            // Mark dependent features as unavailable
            for (const feature of ['models', 'chat', 'completion', 'embeddings']) {
                this.setFeatureState(feature, FEATURE_STATES.UNAVAILABLE);
            }
        }
    }

    /**
     * Handle operation failure and determine degradation
     * @private
     * @param {string} featureName - Name of the feature
     * @param {Error} error - Error that occurred
     * @param {string} fallbackStrategy - Fallback strategy
     * @param {*} fallbackValue - Fallback value
     * @param {Function} fallbackHandler - Custom fallback handler
     * @returns {Promise<*>} Fallback result
     */
    async _handleOperationFailure(featureName, error, fallbackStrategy, fallbackValue, fallbackHandler) {
        // Determine new feature state based on error
        let newState;
        if (error instanceof ConnectionError) {
            newState = FEATURE_STATES.UNAVAILABLE;
        } else if (error instanceof ModelError) {
            newState = FEATURE_STATES.LIMITED;
        } else if (error instanceof ApiError) {
            newState = error.statusCode >= 500 ? FEATURE_STATES.UNAVAILABLE : FEATURE_STATES.LIMITED;
        } else {
            newState = FEATURE_STATES.UNAVAILABLE;
        }

        this.setFeatureState(featureName, newState);

        // Execute fallback strategy
        switch (fallbackStrategy) {
            case FALLBACK_STRATEGIES.CACHED:
                return this._getCachedFallback(featureName);
            case FALLBACK_STRATEGIES.SIMPLIFIED:
                return this._getSimplifiedFallback(featureName);
            case FALLBACK_STRATEGIES.GUIDANCE:
                await this._showGuidance(featureName, error);
                return fallbackValue;
            case FALLBACK_STRATEGIES.DISABLE:
                this.setFeatureState(featureName, FEATURE_STATES.DISABLED);
                return fallbackValue;
            default:
                if (fallbackHandler) {
                    return await fallbackHandler(error);
                }
                return fallbackValue;
        }
    }

    /**
     * Handle disabled feature access
     * @private
     * @param {string} featureName - Name of the feature
     * @param {string} fallbackStrategy - Fallback strategy
     * @param {*} fallbackValue - Fallback value
     * @returns {*} Fallback result
     */
    _handleDisabledFeature(featureName, fallbackStrategy, fallbackValue) {
        this.logger.warn(`Attempted to use disabled feature: ${featureName}`);
        
        vscode.window.showWarningMessage(
            `${featureName} feature is currently disabled due to repeated failures. Please check your LM Studio connection.`,
            'Check Settings'
        ).then(choice => {
            if (choice === 'Check Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'lmstudio');
            }
        });

        return fallbackValue;
    }

    /**
     * Get cached fallback data
     * @private
     * @param {string} featureName - Name of the feature
     * @returns {*} Cached data or null
     */
    _getCachedFallback(featureName) {
        const cached = this._fallbackData.get(featureName);
        if (cached) {
            this.logger.info(`Using cached fallback for ${featureName}`);
            return cached;
        }
        return null;
    }

    /**
     * Get simplified fallback
     * @private
     * @param {string} featureName - Name of the feature
     * @returns {*} Simplified result
     */
    _getSimplifiedFallback(featureName) {
        this.logger.info(`Using simplified fallback for ${featureName}`);
        // Return basic functionality based on feature
        switch (featureName) {
            case 'models':
                return [];
            case 'chat':
            case 'completion':
                return { choices: [{ text: 'LM Studio is currently unavailable.' }] };
            case 'embeddings':
                return { data: [] };
            default:
                return null;
        }
    }

    /**
     * Show guidance to user
     * @private
     * @param {string} featureName - Name of the feature
     * @param {Error} error - Error that occurred
     */
    async _showGuidance(featureName, error) {
        const guidance = this._getGuidanceMessage(featureName, error);
        const actions = this._getGuidanceActions(featureName, error);
        
        if (actions.length > 0) {
            const choice = await vscode.window.showInformationMessage(guidance, ...actions);
            if (choice) {
                await this._executeGuidanceAction(choice, featureName);
            }
        } else {
            vscode.window.showInformationMessage(guidance);
        }
    }

    /**
     * Get guidance message for feature failure
     * @private
     * @param {string} featureName - Name of the feature
     * @param {Error} error - Error that occurred
     * @returns {string} Guidance message
     */
    _getGuidanceMessage(featureName, error) {
        if (error instanceof ConnectionError) {
            return 'Cannot connect to LM Studio. Please ensure LM Studio is running and the server is enabled.';
        } else if (error instanceof ModelError) {
            return `Model operation failed. Please check that the selected model is loaded in LM Studio.`;
        } else {
            return `${featureName} is currently unavailable. Please check your LM Studio connection.`;
        }
    }

    /**
     * Get guidance actions for feature failure
     * @private
     * @param {string} featureName - Name of the feature
     * @param {Error} error - Error that occurred
     * @returns {string[]} Array of action labels
     */
    _getGuidanceActions(featureName, error) {
        const actions = [];
        
        if (error instanceof ConnectionError) {
            actions.push('Check Settings', 'Retry Connection');
        } else if (error instanceof ModelError) {
            actions.push('Refresh Models', 'Select Model');
        } else {
            actions.push('Retry');
        }
        
        return actions;
    }

    /**
     * Execute a guidance action
     * @private
     * @param {string} action - Action to execute
     * @param {string} featureName - Name of the feature
     */
    async _executeGuidanceAction(action, featureName) {
        switch (action) {
            case 'Check Settings':
                await vscode.commands.executeCommand('workbench.action.openSettings', 'lmstudio');
                break;
            case 'Retry Connection':
                await this.localLLMClient.checkHealth();
                break;
            case 'Refresh Models':
                await vscode.commands.executeCommand('lmstudio.refreshModels');
                break;
            case 'Select Model':
                await vscode.commands.executeCommand('lmstudio.selectModel');
                break;
            case 'Retry':
                // Schedule a retry
                this.scheduleRetry(featureName, () => {
                    // The retry will be handled by the calling code
                });
                break;
        }
    }

    /**
     * Get cached models
     * @private
     * @returns {Array} Cached models or empty array
     */
    _getCachedModels() {
        return this._fallbackData.get('models') || [];
    }

    /**
     * Get chat fallback response
     * @private
     * @param {Object} request - Original request
     * @returns {Object} Fallback response
     */
    _getChatFallbackResponse(request) {
        return {
            choices: [{
                message: {
                    role: 'assistant',
                    content: 'I apologize, but I cannot process your request right now because LM Studio is unavailable. Please check your connection and try again.'
                }
            }]
        };
    }

    /**
     * Get completion fallback response
     * @private
     * @param {Object} request - Original request
     * @returns {Object} Fallback response
     */
    _getCompletionFallbackResponse(request) {
        return {
            choices: [{
                text: '// LM Studio is currently unavailable\n// Please check your connection and try again'
            }]
        };
    }

    /**
     * Get embedding fallback response
     * @private
     * @param {Object} request - Original request
     * @returns {Object} Fallback response
     */
    _getEmbeddingFallbackResponse(request) {
        return {
            data: [],
            usage: { total_tokens: 0 }
        };
    }

    /**
     * Notify about feature state changes
     * @private
     * @param {string} featureName - Name of the feature
     * @param {string} newState - New state
     * @param {string} oldState - Old state
     */
    _notifyFeatureStateChange(featureName, newState, oldState) {
        // Emit events or update UI as needed
        // This could be expanded to notify other components
    }
}

/**
 * Retry scheduler for failed operations
 * @class
 */
class RetryScheduler {
    /**
     * Create a RetryScheduler instance
     */
    constructor() {
        this.logger = getLogger('RetryScheduler');
        this._retryQueue = new Map();
        this._timers = new Map();
    }

    /**
     * Schedule a retry for an operation
     * @param {string} key - Unique key for the operation
     * @param {Function} operation - Operation to retry
     * @param {Object} [options] - Retry options
     * @param {number} [options.delay=5000] - Initial delay in ms
     * @param {number} [options.maxAttempts=3] - Maximum retry attempts
     * @param {number} [options.backoffMultiplier=2] - Backoff multiplier
     */
    schedule(key, operation, options = {}) {
        const {
            delay = 5000,
            maxAttempts = 3,
            backoffMultiplier = 2
        } = options;

        // Cancel existing retry for this key
        this.cancel(key);

        const retryInfo = {
            operation,
            attempts: 0,
            maxAttempts,
            delay,
            backoffMultiplier,
            scheduledAt: Date.now()
        };

        this._retryQueue.set(key, retryInfo);
        this._scheduleNextAttempt(key);
    }

    /**
     * Cancel a scheduled retry
     * @param {string} key - Unique key for the operation
     */
    cancel(key) {
        if (this._timers.has(key)) {
            clearTimeout(this._timers.get(key));
            this._timers.delete(key);
        }
        this._retryQueue.delete(key);
    }

    /**
     * Get retry status
     * @returns {Object} Status information
     */
    getStatus() {
        const queue = [];
        for (const [key, info] of this._retryQueue.entries()) {
            queue.push({
                key,
                attempts: info.attempts,
                maxAttempts: info.maxAttempts,
                scheduledAt: info.scheduledAt
            });
        }
        return { queue };
    }

    /**
     * Dispose of the scheduler
     */
    dispose() {
        for (const timer of this._timers.values()) {
            clearTimeout(timer);
        }
        this._timers.clear();
        this._retryQueue.clear();
    }

    /**
     * Schedule the next retry attempt
     * @private
     * @param {string} key - Operation key
     */
    _scheduleNextAttempt(key) {
        const retryInfo = this._retryQueue.get(key);
        if (!retryInfo) {
            return;
        }

        const currentDelay = retryInfo.delay * Math.pow(retryInfo.backoffMultiplier, retryInfo.attempts);
        
        this.logger.debug(`Scheduling retry for ${key} in ${currentDelay}ms (attempt ${retryInfo.attempts + 1}/${retryInfo.maxAttempts})`);

        const timer = setTimeout(async () => {
            await this._executeRetry(key);
        }, currentDelay);

        this._timers.set(key, timer);
    }

    /**
     * Execute a retry attempt
     * @private
     * @param {string} key - Operation key
     */
    async _executeRetry(key) {
        const retryInfo = this._retryQueue.get(key);
        if (!retryInfo) {
            return;
        }

        retryInfo.attempts++;
        this._timers.delete(key);

        try {
            this.logger.info(`Executing retry for ${key} (attempt ${retryInfo.attempts}/${retryInfo.maxAttempts})`);
            await retryInfo.operation();
            
            // Success - remove from queue
            this._retryQueue.delete(key);
            this.logger.info(`Retry succeeded for ${key}`);
            
        } catch (error) {
            this.logger.warn(`Retry failed for ${key}`, error);
            
            if (retryInfo.attempts < retryInfo.maxAttempts) {
                // Schedule next attempt
                this._scheduleNextAttempt(key);
            } else {
                // Max attempts reached
                this._retryQueue.delete(key);
                this.logger.error(`Max retry attempts reached for ${key}`);
            }
        }
    }
}

/**
 * Connection monitor for tracking LM Studio availability
 * @class
 */
class ConnectionMonitor {
    /**
     * Create a ConnectionMonitor instance
     */
    constructor() {
        this.logger = getLogger('ConnectionMonitor');
        this._isConnected = false;
        this._checkInterval = null;
        this._listeners = new Set();
        this._localLLMClient = null;
    }

    /**
     * Initialize the connection monitor
     * @param {Object} localLLMClient - LM Studio client instance
     */
    initialize(localLLMClient) {
        this._localLLMClient = localLLMClient;
        
        // Start periodic health checks
        this._checkInterval = setInterval(() => {
            this._checkConnection();
        }, 30000); // Check every 30 seconds

        // Initial check
        this._checkConnection();
    }

    /**
     * Get current connection state
     * @returns {boolean} True if connected
     */
    getState() {
        return this._isConnected;
    }

    /**
     * Add a connection state change listener
     * @param {Function} listener - Listener function
     */
    onConnectionStateChanged(listener) {
        this._listeners.add(listener);
    }

    /**
     * Remove a connection state change listener
     * @param {Function} listener - Listener function
     */
    removeConnectionStateListener(listener) {
        this._listeners.delete(listener);
    }

    /**
     * Dispose of the connection monitor
     */
    dispose() {
        if (this._checkInterval) {
            clearInterval(this._checkInterval);
            this._checkInterval = null;
        }
        this._listeners.clear();
    }

    /**
     * Check connection status
     * @private
     */
    async _checkConnection() {
        try {
            const isHealthy = await this._localLLMClient.checkHealth();
            this._updateConnectionState(isHealthy);
        } catch (error) {
            this._updateConnectionState(false);
        }
    }

    /**
     * Update connection state and notify listeners
     * @private
     * @param {boolean} isConnected - New connection state
     */
    _updateConnectionState(isConnected) {
        if (this._isConnected !== isConnected) {
            this._isConnected = isConnected;
            this.logger.info(`Connection state changed: ${isConnected ? 'connected' : 'disconnected'}`);
            
            for (const listener of this._listeners) {
                try {
                    listener(isConnected);
                } catch (error) {
                    this.logger.error('Error in connection state listener', error);
                }
            }
        }
    }
}

// Global graceful degradation service instance
const gracefulDegradationService = new GracefulDegradationService();

module.exports = {
    GracefulDegradationService,
    RetryScheduler,
    ConnectionMonitor,
    FEATURE_STATES,
    FALLBACK_STRATEGIES,
    gracefulDegradationService
};