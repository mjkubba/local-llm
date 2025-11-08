/**
 * @fileoverview Global error boundary for catching unhandled errors
 * Provides a safety net for uncaught exceptions and promise rejections.
 */

const vscode = require('vscode');
const { RuntimeError } = require('../models/errors');
const { getLogger } = require('./logger');
const { errorHandler } = require('./errorHandler');

/**
 * Global error boundary for catching unhandled errors
 * @class
 */
class GlobalErrorBoundary {
    /**
     * Create a GlobalErrorBoundary instance
     */
    constructor() {
        this.logger = getLogger('GlobalErrorBoundary');
        this._isInitialized = false;
        this._originalHandlers = {
            uncaughtException: null,
            unhandledRejection: null
        };
        this._errorCount = 0;
        this._maxErrors = 10; // Maximum errors before disabling
        this._resetInterval = 60000; // Reset error count every minute
        this._resetTimer = null;
    }

    /**
     * Initialize the global error boundary
     */
    initialize() {
        if (this._isInitialized) {
            return;
        }

        this.logger.info('Initializing global error boundary');

        // Store original handlers
        this._originalHandlers.uncaughtException = process.listeners('uncaughtException');
        this._originalHandlers.unhandledRejection = process.listeners('unhandledRejection');

        // Set up error handlers
        process.on('uncaughtException', this._handleUncaughtException.bind(this));
        process.on('unhandledRejection', this._handleUnhandledRejection.bind(this));

        // Set up error count reset timer
        this._resetTimer = setInterval(() => {
            this._errorCount = 0;
        }, this._resetInterval);

        this._isInitialized = true;
        this.logger.info('Global error boundary initialized');
    }

    /**
     * Dispose of the global error boundary
     */
    dispose() {
        if (!this._isInitialized) {
            return;
        }

        this.logger.info('Disposing global error boundary');

        // Remove our handlers
        process.removeListener('uncaughtException', this._handleUncaughtException);
        process.removeListener('unhandledRejection', this._handleUnhandledRejection);

        // Clear reset timer
        if (this._resetTimer) {
            clearInterval(this._resetTimer);
            this._resetTimer = null;
        }

        this._isInitialized = false;
        this.logger.info('Global error boundary disposed');
    }

    /**
     * Wrap a function with error boundary protection
     * @param {Function} fn - Function to wrap
     * @param {Object} [context] - Error context
     * @returns {Function} Wrapped function
     */
    wrap(fn, context = {}) {
        return async (...args) => {
            try {
                const result = await fn(...args);
                return result;
            } catch (error) {
                await this._handleError(error, {
                    ...context,
                    operation: context.operation || fn.name || 'wrapped_function'
                });
                throw error; // Re-throw after handling
            }
        };
    }

    /**
     * Wrap a VS Code command with error boundary
     * @param {string} commandId - Command identifier
     * @param {Function} handler - Command handler function
     * @param {Object} [context] - Error context
     * @returns {Function} Wrapped command handler
     */
    wrapCommand(commandId, handler, context = {}) {
        return this.wrap(handler, {
            ...context,
            operation: `command:${commandId}`,
            commandId
        });
    }

    /**
     * Wrap an API call with error boundary
     * @param {Function} apiCall - API call function
     * @param {Object} [context] - Error context
     * @returns {Function} Wrapped API call
     */
    wrapApiCall(apiCall, context = {}) {
        return this.wrap(apiCall, {
            ...context,
            operation: context.operation || 'api_call'
        });
    }

    /**
     * Get error boundary statistics
     * @returns {Object} Error statistics
     */
    getStatistics() {
        return {
            isInitialized: this._isInitialized,
            errorCount: this._errorCount,
            maxErrors: this._maxErrors,
            resetInterval: this._resetInterval
        };
    }

    /**
     * Handle uncaught exceptions
     * @private
     * @param {Error} error - Uncaught exception
     */
    async _handleUncaughtException(error) {
        this.logger.error('Uncaught exception detected', error);
        
        await this._handleError(error, {
            operation: 'uncaught_exception',
            severity: 'critical'
        });

        // Check if we should exit the process
        if (this._shouldExitProcess(error)) {
            this.logger.error('Critical error detected, extension may become unstable');
            vscode.window.showErrorMessage(
                'LM Studio extension encountered a critical error and may become unstable. Please reload the window.',
                'Reload Window'
            ).then(choice => {
                if (choice === 'Reload Window') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        }
    }

    /**
     * Handle unhandled promise rejections
     * @private
     * @param {*} reason - Rejection reason
     * @param {Promise} promise - Rejected promise
     */
    async _handleUnhandledRejection(reason, promise) {
        this.logger.error('Unhandled promise rejection detected', {
            reason: reason instanceof Error ? reason : new Error(String(reason)),
            promise: promise.toString()
        });

        const error = reason instanceof Error ? reason : new Error(String(reason));
        
        await this._handleError(error, {
            operation: 'unhandled_rejection',
            severity: 'high'
        });
    }

    /**
     * Handle an error through the error boundary
     * @private
     * @param {Error} error - Error to handle
     * @param {Object} context - Error context
     */
    async _handleError(error, context = {}) {
        this._errorCount++;

        // Check if we've exceeded the error limit
        if (this._errorCount > this._maxErrors) {
            this.logger.error(`Error limit exceeded (${this._maxErrors}), suppressing further error handling`);
            return;
        }

        try {
            // Convert to RuntimeError if not already an LMStudioError
            const runtimeError = new RuntimeError(
                error.message || 'Unknown error',
                'GLOBAL_ERROR_BOUNDARY',
                error
            );

            // Handle through the error handler
            await errorHandler.handleError(runtimeError, context);

        } catch (handlingError) {
            // Last resort - log to console
            console.error('Error in global error boundary:', handlingError);
            console.error('Original error:', error);
        }
    }

    /**
     * Determine if the process should exit due to critical error
     * @private
     * @param {Error} error - Error to check
     * @returns {boolean} True if process should exit
     */
    _shouldExitProcess(error) {
        // Don't exit for known recoverable errors
        if (error.name === 'LMStudioError' && error.recoverable) {
            return false;
        }

        // Exit for critical system errors
        const criticalErrors = [
            'ENOSPC', // No space left on device
            'ENOMEM', // Out of memory
            'EMFILE', // Too many open files
            'ENOTFOUND' // DNS resolution failed
        ];

        return criticalErrors.includes(error.code);
    }
}

// Global error boundary instance
const globalErrorBoundary = new GlobalErrorBoundary();

/**
 * Initialize the global error boundary
 */
function initializeGlobalErrorBoundary() {
    globalErrorBoundary.initialize();
}

/**
 * Dispose of the global error boundary
 */
function disposeGlobalErrorBoundary() {
    globalErrorBoundary.dispose();
}

/**
 * Wrap a function with error boundary protection
 * @param {Function} fn - Function to wrap
 * @param {Object} [context] - Error context
 * @returns {Function} Wrapped function
 */
function wrapWithErrorBoundary(fn, context = {}) {
    return globalErrorBoundary.wrap(fn, context);
}

/**
 * Wrap a VS Code command with error boundary
 * @param {string} commandId - Command identifier
 * @param {Function} handler - Command handler function
 * @param {Object} [context] - Error context
 * @returns {Function} Wrapped command handler
 */
function wrapCommand(commandId, handler, context = {}) {
    return globalErrorBoundary.wrapCommand(commandId, handler, context);
}

/**
 * Wrap an API call with error boundary
 * @param {Function} apiCall - API call function
 * @param {Object} [context] - Error context
 * @returns {Function} Wrapped API call
 */
function wrapApiCall(apiCall, context = {}) {
    return globalErrorBoundary.wrapApiCall(apiCall, context);
}

module.exports = {
    GlobalErrorBoundary,
    globalErrorBoundary,
    initializeGlobalErrorBoundary,
    disposeGlobalErrorBoundary,
    wrapWithErrorBoundary,
    wrapCommand,
    wrapApiCall
};