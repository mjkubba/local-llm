/**
 * @fileoverview Error classes for LM Studio integration
 * Defines structured error types for proper error handling and user feedback.
 */

const { ERROR_CATEGORIES } = require('./constants');

/**
 * Base error class for LM Studio-related errors
 * @class
 * @extends Error
 */
class LMStudioError extends Error {
    /**
     * Create an LMStudioError instance
     * @param {string} message - Error message
     * @param {string} code - Error code for programmatic handling
     * @param {string} category - Error category from ERROR_CATEGORIES
     * @param {boolean} [recoverable=true] - Whether the error is recoverable
     * @param {Error} [cause] - Original error that caused this error
     */
    constructor(message, code, category, recoverable = true, cause = null) {
        super(message);
        
        this.name = 'LMStudioError';
        this.code = code;
        this.category = category;
        this.recoverable = recoverable;
        this.cause = cause;
        this.timestamp = new Date();
        
        // Maintain proper stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, LMStudioError);
        }
    }

    /**
     * Check if this error is recoverable
     * @returns {boolean} True if error is recoverable
     */
    isRecoverable() {
        return this.recoverable;
    }

    /**
     * Get user-friendly error message
     * @returns {string} User-friendly error description
     */
    getUserMessage() {
        switch (this.category) {
            case ERROR_CATEGORIES.CONNECTION:
                return this.getConnectionMessage();
            case ERROR_CATEGORIES.API:
                return this.getApiMessage();
            case ERROR_CATEGORIES.MODEL:
                return this.getModelMessage();
            case ERROR_CATEGORIES.VALIDATION:
                return this.getValidationMessage();
            case ERROR_CATEGORIES.RUNTIME:
                return this.getRuntimeMessage();
            default:
                return this.message;
        }
    }

    /**
     * Get connection-specific user message
     * @private
     * @returns {string} Connection error message
     */
    getConnectionMessage() {
        switch (this.code) {
            case 'CONNECTION_REFUSED':
                return 'Cannot connect to LM Studio. Please ensure LM Studio is running and the server is enabled.';
            case 'TIMEOUT':
                return 'Connection to LM Studio timed out. Please check your network connection.';
            case 'NETWORK_ERROR':
                return 'Network error occurred while connecting to LM Studio.';
            default:
                return `Connection error: ${this.message}`;
        }
    }

    /**
     * Get API-specific user message
     * @private
     * @returns {string} API error message
     */
    getApiMessage() {
        switch (this.code) {
            case 'MODEL_NOT_FOUND':
                return 'The requested model was not found. Please check the model ID or refresh the model list.';
            case 'MODEL_NOT_LOADED':
                return 'The model is not currently loaded. Please load the model in LM Studio first.';
            case 'INVALID_REQUEST':
                return 'Invalid request sent to LM Studio. Please check your parameters.';
            case 'SERVER_ERROR':
                return 'LM Studio server encountered an error. Please try again or restart LM Studio.';
            default:
                return `API error: ${this.message}`;
        }
    }

    /**
     * Get model-specific user message
     * @private
     * @returns {string} Model error message
     */
    getModelMessage() {
        switch (this.code) {
            case 'MODEL_LOAD_FAILED':
                return 'Failed to load the model. Please check if you have enough memory available.';
            case 'MODEL_INCOMPATIBLE':
                return 'The selected model is not compatible with this operation.';
            case 'CONTEXT_LENGTH_EXCEEDED':
                return 'The input is too long for this model. Please reduce the text length.';
            default:
                return `Model error: ${this.message}`;
        }
    }

    /**
     * Get validation-specific user message
     * @private
     * @returns {string} Validation error message
     */
    getValidationMessage() {
        switch (this.code) {
            case 'INVALID_TEMPERATURE':
                return 'Temperature must be between 0 and 2.';
            case 'INVALID_MAX_TOKENS':
                return 'Maximum tokens must be a positive number.';
            case 'EMPTY_MESSAGE_CONTENT':
                return 'Message content cannot be empty.';
            case 'INVALID_URL':
                return 'Please enter a valid server URL (e.g., http://localhost:1234).';
            default:
                return `Validation error: ${this.message}`;
        }
    }

    /**
     * Get runtime-specific user message
     * @private
     * @returns {string} Runtime error message
     */
    getRuntimeMessage() {
        return `An unexpected error occurred: ${this.message}`;
    }

    /**
     * Convert error to JSON for logging
     * @returns {Object} JSON representation of the error
     */
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            category: this.category,
            recoverable: this.recoverable,
            timestamp: this.timestamp.toISOString(),
            stack: this.stack,
            cause: this.cause ? {
                name: this.cause.name,
                message: this.cause.message,
                stack: this.cause.stack
            } : null
        };
    }
}

/**
 * Connection-related error
 * @class
 * @extends LMStudioError
 */
class ConnectionError extends LMStudioError {
    /**
     * Create a ConnectionError instance
     * @param {string} message - Error message
     * @param {string} code - Error code
     * @param {Error} [cause] - Original error
     */
    constructor(message, code, cause = null) {
        super(message, code, ERROR_CATEGORIES.CONNECTION, true, cause);
        this.name = 'ConnectionError';
    }
}

/**
 * API-related error
 * @class
 * @extends LMStudioError
 */
class ApiError extends LMStudioError {
    /**
     * Create an ApiError instance
     * @param {string} message - Error message
     * @param {string} code - Error code
     * @param {number} [statusCode] - HTTP status code
     * @param {Error} [cause] - Original error
     */
    constructor(message, code, statusCode = null, cause = null) {
        super(message, code, ERROR_CATEGORIES.API, true, cause);
        this.name = 'ApiError';
        this.statusCode = statusCode;
    }
}

/**
 * Model-related error
 * @class
 * @extends LMStudioError
 */
class ModelError extends LMStudioError {
    /**
     * Create a ModelError instance
     * @param {string} message - Error message
     * @param {string} code - Error code
     * @param {string} [modelId] - ID of the problematic model
     * @param {Error} [cause] - Original error
     */
    constructor(message, code, modelId = null, cause = null) {
        super(message, code, ERROR_CATEGORIES.MODEL, true, cause);
        this.name = 'ModelError';
        this.modelId = modelId;
    }
}

/**
 * Validation-related error
 * @class
 * @extends LMStudioError
 */
class ValidationError extends LMStudioError {
    /**
     * Create a ValidationError instance
     * @param {string} message - Error message
     * @param {string} code - Error code
     * @param {string} [field] - Field that failed validation
     * @param {*} [value] - Value that failed validation
     */
    constructor(message, code, field = null, value = null) {
        super(message, code, ERROR_CATEGORIES.VALIDATION, false);
        this.name = 'ValidationError';
        this.field = field;
        this.value = value;
    }
}

/**
 * Runtime error
 * @class
 * @extends LMStudioError
 */
class RuntimeError extends LMStudioError {
    /**
     * Create a RuntimeError instance
     * @param {string} message - Error message
     * @param {string} code - Error code
     * @param {Error} [cause] - Original error
     */
    constructor(message, code, cause = null) {
        super(message, code, ERROR_CATEGORIES.RUNTIME, false, cause);
        this.name = 'RuntimeError';
    }
}

/**
 * Create appropriate error instance from HTTP response
 * @param {Response} response - HTTP response object
 * @param {string} message - Error message
 * @returns {LMStudioError} Appropriate error instance
 */
function createErrorFromResponse(response, message) {
    const statusCode = response.status;
    
    if (statusCode >= 400 && statusCode < 500) {
        // Client errors
        switch (statusCode) {
            case 404:
                return new ModelError(message, 'MODEL_NOT_FOUND');
            case 400:
                return new ValidationError(message, 'INVALID_REQUEST');
            case 401:
                return new ApiError(message, 'UNAUTHORIZED', statusCode);
            case 403:
                return new ApiError(message, 'FORBIDDEN', statusCode);
            default:
                return new ApiError(message, 'CLIENT_ERROR', statusCode);
        }
    } else if (statusCode >= 500) {
        // Server errors
        return new ApiError(message, 'SERVER_ERROR', statusCode);
    } else {
        // Other errors
        return new ApiError(message, 'API_ERROR', statusCode);
    }
}

/**
 * Create error from network/connection issues
 * @param {Error} error - Original network error
 * @returns {ConnectionError} Connection error instance
 */
function createConnectionError(error) {
    if (error.code === 'ECONNREFUSED') {
        return new ConnectionError(
            'Connection refused by LM Studio server',
            'CONNECTION_REFUSED',
            error
        );
    } else if (error.code === 'ETIMEDOUT' || error.name === 'TimeoutError') {
        return new ConnectionError(
            'Connection to LM Studio timed out',
            'TIMEOUT',
            error
        );
    } else if (error.code === 'ENOTFOUND') {
        return new ConnectionError(
            'LM Studio server not found',
            'SERVER_NOT_FOUND',
            error
        );
    } else {
        return new ConnectionError(
            `Network error: ${error.message}`,
            'NETWORK_ERROR',
            error
        );
    }
}

module.exports = {
    LMStudioError,
    ConnectionError,
    ApiError,
    ModelError,
    ValidationError,
    RuntimeError,
    createErrorFromResponse,
    createConnectionError
};