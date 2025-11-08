/**
 * @fileoverview Error handling and recovery system
 * Provides centralized error handling, user notifications, and recovery mechanisms.
 */

const vscode = require('vscode');
const { 
    LMStudioError, 
    ConnectionError, 
    ApiError, 
    ModelError, 
    RuntimeError 
} = require('../models/errors');
const { ERROR_CATEGORIES } = require('../models/constants');
const { getLogger } = require('./logger');

/**
 * Error recovery strategies
 * @readonly
 * @enum {string}
 */
const RECOVERY_STRATEGIES = {
    /** Retry the operation automatically */
    RETRY: 'retry',
    /** Show error to user and let them decide */
    USER_CHOICE: 'user_choice',
    /** Fallback to alternative behavior */
    FALLBACK: 'fallback',
    /** Disable feature until manually re-enabled */
    DISABLE: 'disable',
    /** No recovery possible */
    NONE: 'none'
};

/**
 * Error notification types
 * @readonly
 * @enum {string}
 */
const NOTIFICATION_TYPES = {
    /** Show error message */
    ERROR: 'error',
    /** Show warning message */
    WARNING: 'warning',
    /** Show info message */
    INFO: 'info',
    /** Show in status bar only */
    STATUS_BAR: 'status_bar',
    /** No notification */
    SILENT: 'silent'
};

/**
 * Error handling and recovery system
 * @class
 */
class ErrorHandler {
    /**
     * Create an ErrorHandler instance
     */
    constructor() {
        this.logger = getLogger('ErrorHandler');
        this._recoveryStrategies = new Map();
        this._errorCounts = new Map();
        this._lastErrors = new Map();
        this._isEnabled = true;
        this._statusBarProvider = null;
        
        // Initialize default recovery strategies
        this._initializeDefaultStrategies();
    }

    /**
     * Set the status bar provider for error display
     * @param {Object} statusBarProvider - Status bar provider instance
     */
    setStatusBarProvider(statusBarProvider) {
        this._statusBarProvider = statusBarProvider;
    }

    /**
     * Enable or disable error handling
     * @param {boolean} enabled - Whether error handling is enabled
     */
    setEnabled(enabled) {
        this._isEnabled = enabled;
    }

    /**
     * Handle an error with appropriate recovery and notification
     * @param {Error} error - Error to handle
     * @param {Object} [context] - Additional context information
     * @param {string} [context.operation] - Operation that failed
     * @param {Object} [context.metadata] - Additional metadata
     * @returns {Promise<boolean>} True if error was recovered, false otherwise
     */
    async handleError(error, context = {}) {
        if (!this._isEnabled) {
            return false;
        }

        try {
            // Convert to LMStudioError if needed
            const lmError = this._ensureLMStudioError(error);
            
            // Log the error
            this._logError(lmError, context);
            
            // Track error frequency
            this._trackError(lmError);
            
            // Get recovery strategy
            const strategy = this._getRecoveryStrategy(lmError);
            
            // Show notification
            await this._showNotification(lmError, strategy);
            
            // Attempt recovery
            const recovered = await this._attemptRecovery(lmError, strategy, context);
            
            // Update status bar
            this._updateStatusBar(lmError, recovered);
            
            return recovered;
            
        } catch (handlingError) {
            this.logger.error('Error in error handler', handlingError);
            return false;
        }
    }

    /**
     * Handle connection errors specifically
     * @param {Error} error - Connection error
     * @param {Object} [context] - Additional context
     * @returns {Promise<boolean>} True if recovered
     */
    async handleConnectionError(error, context = {}) {
        const connectionError = error instanceof ConnectionError ? 
            error : new ConnectionError(error.message, 'CONNECTION_ERROR', error);
        
        return this.handleError(connectionError, {
            ...context,
            operation: context.operation || 'connection'
        });
    }

    /**
     * Handle API errors specifically
     * @param {Error} error - API error
     * @param {number} [statusCode] - HTTP status code
     * @param {Object} [context] - Additional context
     * @returns {Promise<boolean>} True if recovered
     */
    async handleApiError(error, statusCode = null, context = {}) {
        const apiError = error instanceof ApiError ? 
            error : new ApiError(error.message, 'API_ERROR', statusCode, error);
        
        return this.handleError(apiError, {
            ...context,
            operation: context.operation || 'api_request'
        });
    }

    /**
     * Handle model errors specifically
     * @param {Error} error - Model error
     * @param {string} [modelId] - Model ID that caused the error
     * @param {Object} [context] - Additional context
     * @returns {Promise<boolean>} True if recovered
     */
    async handleModelError(error, modelId = null, context = {}) {
        const modelError = error instanceof ModelError ? 
            error : new ModelError(error.message, 'MODEL_ERROR', modelId, error);
        
        return this.handleError(modelError, {
            ...context,
            operation: context.operation || 'model_operation',
            modelId
        });
    }

    /**
     * Register a custom recovery strategy for an error code
     * @param {string} errorCode - Error code to handle
     * @param {string} strategy - Recovery strategy from RECOVERY_STRATEGIES
     * @param {Function} [handler] - Custom recovery handler function
     */
    registerRecoveryStrategy(errorCode, strategy, handler = null) {
        this._recoveryStrategies.set(errorCode, {
            strategy,
            handler
        });
    }

    /**
     * Get error statistics
     * @returns {Object} Error statistics
     */
    getErrorStatistics() {
        const stats = {
            totalErrors: 0,
            errorsByCategory: {},
            errorsByCode: {},
            recentErrors: []
        };

        for (const [key, count] of this._errorCounts.entries()) {
            stats.totalErrors += count;
            
            if (key.includes(':')) {
                const [category, code] = key.split(':');
                stats.errorsByCategory[category] = (stats.errorsByCategory[category] || 0) + count;
                stats.errorsByCode[code] = (stats.errorsByCode[code] || 0) + count;
            }
        }

        // Get recent errors (last 10)
        const recentEntries = Array.from(this._lastErrors.entries())
            .sort((a, b) => b[1].timestamp - a[1].timestamp)
            .slice(0, 10);
        
        stats.recentErrors = recentEntries.map(([key, data]) => ({
            key,
            error: data.error,
            timestamp: data.timestamp,
            count: this._errorCounts.get(key) || 0
        }));

        return stats;
    }

    /**
     * Clear error statistics
     */
    clearStatistics() {
        this._errorCounts.clear();
        this._lastErrors.clear();
    }

    /**
     * Initialize default recovery strategies
     * @private
     */
    _initializeDefaultStrategies() {
        // Connection errors - retry with exponential backoff
        this.registerRecoveryStrategy('CONNECTION_REFUSED', RECOVERY_STRATEGIES.USER_CHOICE);
        this.registerRecoveryStrategy('TIMEOUT', RECOVERY_STRATEGIES.RETRY);
        this.registerRecoveryStrategy('NETWORK_ERROR', RECOVERY_STRATEGIES.RETRY);
        
        // API errors - mostly user choice or fallback
        this.registerRecoveryStrategy('MODEL_NOT_FOUND', RECOVERY_STRATEGIES.USER_CHOICE);
        this.registerRecoveryStrategy('MODEL_NOT_LOADED', RECOVERY_STRATEGIES.USER_CHOICE);
        this.registerRecoveryStrategy('INVALID_REQUEST', RECOVERY_STRATEGIES.NONE);
        this.registerRecoveryStrategy('SERVER_ERROR', RECOVERY_STRATEGIES.RETRY);
        
        // Model errors - user choice or fallback
        this.registerRecoveryStrategy('MODEL_LOAD_FAILED', RECOVERY_STRATEGIES.USER_CHOICE);
        this.registerRecoveryStrategy('MODEL_INCOMPATIBLE', RECOVERY_STRATEGIES.FALLBACK);
        this.registerRecoveryStrategy('CONTEXT_LENGTH_EXCEEDED', RECOVERY_STRATEGIES.FALLBACK);
        
        // Validation errors - no recovery
        this.registerRecoveryStrategy('INVALID_TEMPERATURE', RECOVERY_STRATEGIES.NONE);
        this.registerRecoveryStrategy('INVALID_MAX_TOKENS', RECOVERY_STRATEGIES.NONE);
        this.registerRecoveryStrategy('EMPTY_MESSAGE_CONTENT', RECOVERY_STRATEGIES.NONE);
        
        // Runtime errors - disable feature
        this.registerRecoveryStrategy('RUNTIME_ERROR', RECOVERY_STRATEGIES.DISABLE);
    }

    /**
     * Ensure error is an LMStudioError instance
     * @private
     * @param {Error} error - Original error
     * @returns {LMStudioError} LMStudioError instance
     */
    _ensureLMStudioError(error) {
        if (error instanceof LMStudioError) {
            return error;
        }

        // Try to categorize unknown errors
        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            return new ConnectionError(error.message, error.code, error);
        }

        // Default to runtime error
        return new RuntimeError(error.message, 'UNKNOWN_ERROR', error);
    }

    /**
     * Log error with appropriate level and context
     * @private
     * @param {LMStudioError} error - Error to log
     * @param {Object} context - Error context
     */
    _logError(error, context) {
        const metadata = {
            code: error.code,
            category: error.category,
            recoverable: error.recoverable,
            operation: context.operation,
            ...context.metadata
        };

        if (error.category === ERROR_CATEGORIES.RUNTIME) {
            this.logger.error(`Runtime error: ${error.message}`, metadata);
        } else if (error.category === ERROR_CATEGORIES.CONNECTION) {
            this.logger.warn(`Connection error: ${error.message}`, metadata);
        } else {
            this.logger.info(`${error.category} error: ${error.message}`, metadata);
        }
    }

    /**
     * Track error frequency for analysis
     * @private
     * @param {LMStudioError} error - Error to track
     */
    _trackError(error) {
        const key = `${error.category}:${error.code}`;
        const count = this._errorCounts.get(key) || 0;
        this._errorCounts.set(key, count + 1);
        
        this._lastErrors.set(key, {
            error: error.toJSON(),
            timestamp: Date.now()
        });
    }

    /**
     * Get recovery strategy for an error
     * @private
     * @param {LMStudioError} error - Error to get strategy for
     * @returns {string} Recovery strategy
     */
    _getRecoveryStrategy(error) {
        const registered = this._recoveryStrategies.get(error.code);
        if (registered) {
            return registered.strategy;
        }

        // Default strategies by category
        switch (error.category) {
            case ERROR_CATEGORIES.CONNECTION:
                return RECOVERY_STRATEGIES.RETRY;
            case ERROR_CATEGORIES.API:
                return RECOVERY_STRATEGIES.USER_CHOICE;
            case ERROR_CATEGORIES.MODEL:
                return RECOVERY_STRATEGIES.USER_CHOICE;
            case ERROR_CATEGORIES.VALIDATION:
                return RECOVERY_STRATEGIES.NONE;
            case ERROR_CATEGORIES.RUNTIME:
                return RECOVERY_STRATEGIES.DISABLE;
            default:
                return RECOVERY_STRATEGIES.NONE;
        }
    }

    /**
     * Show appropriate notification for error
     * @private
     * @param {LMStudioError} error - Error to show
     * @param {string} strategy - Recovery strategy
     */
    async _showNotification(error, strategy) {
        const userMessage = error.getUserMessage();
        
        // Determine notification type
        let notificationType;
        if (error.category === ERROR_CATEGORIES.RUNTIME) {
            notificationType = NOTIFICATION_TYPES.ERROR;
        } else if (error.category === ERROR_CATEGORIES.CONNECTION) {
            notificationType = NOTIFICATION_TYPES.WARNING;
        } else if (strategy === RECOVERY_STRATEGIES.NONE) {
            notificationType = NOTIFICATION_TYPES.INFO;
        } else {
            notificationType = NOTIFICATION_TYPES.WARNING;
        }

        // Show notification based on type
        switch (notificationType) {
            case NOTIFICATION_TYPES.ERROR:
                await vscode.window.showErrorMessage(userMessage, 'Show Logs');
                break;
            case NOTIFICATION_TYPES.WARNING:
                await vscode.window.showWarningMessage(userMessage);
                break;
            case NOTIFICATION_TYPES.INFO:
                await vscode.window.showInformationMessage(userMessage);
                break;
            case NOTIFICATION_TYPES.STATUS_BAR:
                // Handle via status bar update
                break;
            case NOTIFICATION_TYPES.SILENT:
                // No notification
                break;
        }
    }

    /**
     * Attempt error recovery based on strategy
     * @private
     * @param {LMStudioError} error - Error to recover from
     * @param {string} strategy - Recovery strategy
     * @param {Object} context - Error context
     * @returns {Promise<boolean>} True if recovered
     */
    async _attemptRecovery(error, strategy, context) {
        try {
            switch (strategy) {
                case RECOVERY_STRATEGIES.RETRY:
                    return await this._retryRecovery(error, context);
                case RECOVERY_STRATEGIES.USER_CHOICE:
                    return await this._userChoiceRecovery(error, context);
                case RECOVERY_STRATEGIES.FALLBACK:
                    return await this._fallbackRecovery(error, context);
                case RECOVERY_STRATEGIES.DISABLE:
                    return await this._disableRecovery(error, context);
                case RECOVERY_STRATEGIES.NONE:
                default:
                    return false;
            }
        } catch (recoveryError) {
            this.logger.error('Recovery attempt failed', recoveryError);
            return false;
        }
    }

    /**
     * Retry recovery strategy
     * @private
     * @param {LMStudioError} error - Error to recover from
     * @param {Object} context - Error context
     * @returns {Promise<boolean>} True if recovered
     */
    async _retryRecovery(error, context) {
        // For now, just log that retry would happen
        // In a full implementation, this would coordinate with the calling code
        this.logger.info(`Retry recovery suggested for ${error.code}`);
        return false;
    }

    /**
     * User choice recovery strategy
     * @private
     * @param {LMStudioError} error - Error to recover from
     * @param {Object} context - Error context
     * @returns {Promise<boolean>} True if recovered
     */
    async _userChoiceRecovery(error, context) {
        const actions = this._getRecoveryActions(error);
        if (actions.length === 0) {
            return false;
        }

        const choice = await vscode.window.showErrorMessage(
            error.getUserMessage(),
            ...actions
        );

        if (choice) {
            return await this._executeRecoveryAction(choice, error, context);
        }

        return false;
    }

    /**
     * Fallback recovery strategy
     * @private
     * @param {LMStudioError} error - Error to recover from
     * @param {Object} context - Error context
     * @returns {Promise<boolean>} True if recovered
     */
    async _fallbackRecovery(error, context) {
        this.logger.info(`Fallback recovery for ${error.code}`);
        // Implement fallback logic based on error type
        return false;
    }

    /**
     * Disable recovery strategy
     * @private
     * @param {LMStudioError} error - Error to recover from
     * @param {Object} context - Error context
     * @returns {Promise<boolean>} True if recovered
     */
    async _disableRecovery(error, context) {
        this.logger.warn(`Disabling feature due to ${error.code}`);
        // Implement feature disabling logic
        return false;
    }

    /**
     * Get available recovery actions for an error
     * @private
     * @param {LMStudioError} error - Error to get actions for
     * @returns {string[]} Array of action labels
     */
    _getRecoveryActions(error) {
        const actions = [];

        switch (error.code) {
            case 'CONNECTION_REFUSED':
                actions.push('Open LM Studio', 'Check Settings');
                break;
            case 'MODEL_NOT_FOUND':
                actions.push('Refresh Models', 'Select Different Model');
                break;
            case 'MODEL_NOT_LOADED':
                actions.push('Load Model', 'Select Different Model');
                break;
            case 'MODEL_LOAD_FAILED':
                actions.push('Try Again', 'Select Different Model');
                break;
            default:
                actions.push('Retry');
                break;
        }

        return actions;
    }

    /**
     * Execute a recovery action
     * @private
     * @param {string} action - Action to execute
     * @param {LMStudioError} error - Original error
     * @param {Object} context - Error context
     * @returns {Promise<boolean>} True if action succeeded
     */
    async _executeRecoveryAction(action, error, context) {
        this.logger.info(`Executing recovery action: ${action}`);
        
        switch (action) {
            case 'Open LM Studio':
                // Would open LM Studio if possible
                return false;
            case 'Check Settings':
                await vscode.commands.executeCommand('workbench.action.openSettings', 'lmstudio');
                return false;
            case 'Refresh Models':
                await vscode.commands.executeCommand('lmstudio.refreshModels');
                return true;
            case 'Select Different Model':
                await vscode.commands.executeCommand('lmstudio.selectModel');
                return true;
            case 'Load Model':
                // Would attempt to load model in LM Studio
                return false;
            case 'Retry':
                // Would retry the original operation
                return false;
            default:
                return false;
        }
    }

    /**
     * Update status bar with error information
     * @private
     * @param {LMStudioError} error - Error that occurred
     * @param {boolean} recovered - Whether error was recovered
     */
    _updateStatusBar(error, recovered) {
        if (this._statusBarProvider) {
            if (recovered) {
                this._statusBarProvider.clearError();
            } else {
                this._statusBarProvider.showError(error.getUserMessage());
            }
        }
    }
}

// Global error handler instance
const errorHandler = new ErrorHandler();

/**
 * Handle an error globally
 * @param {Error} error - Error to handle
 * @param {Object} [context] - Additional context
 * @returns {Promise<boolean>} True if recovered
 */
async function handleError(error, context = {}) {
    return errorHandler.handleError(error, context);
}

/**
 * Handle connection error
 * @param {Error} error - Connection error
 * @param {Object} [context] - Additional context
 * @returns {Promise<boolean>} True if recovered
 */
async function handleConnectionError(error, context = {}) {
    return errorHandler.handleConnectionError(error, context);
}

/**
 * Handle API error
 * @param {Error} error - API error
 * @param {number} [statusCode] - HTTP status code
 * @param {Object} [context] - Additional context
 * @returns {Promise<boolean>} True if recovered
 */
async function handleApiError(error, statusCode = null, context = {}) {
    return errorHandler.handleApiError(error, statusCode, context);
}

/**
 * Handle model error
 * @param {Error} error - Model error
 * @param {string} [modelId] - Model ID
 * @param {Object} [context] - Additional context
 * @returns {Promise<boolean>} True if recovered
 */
async function handleModelError(error, modelId = null, context = {}) {
    return errorHandler.handleModelError(error, modelId, context);
}

module.exports = {
    ErrorHandler,
    RECOVERY_STRATEGIES,
    NOTIFICATION_TYPES,
    errorHandler,
    handleError,
    handleConnectionError,
    handleApiError,
    handleModelError
};