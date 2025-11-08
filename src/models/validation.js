/**
 * @fileoverview Validation functions for LM Studio API data
 * Provides runtime validation for API requests, responses, and configuration data.
 */

const { MODEL_TYPES, MODEL_STATES, MESSAGE_ROLES, ERROR_CATEGORIES } = require('./constants');
const { LMStudioError } = require('./errors');

/**
 * Validate a model object structure
 * @param {Object} model - Model object to validate
 * @throws {LMStudioError} If validation fails
 * @returns {boolean} True if valid
 */
function validateModel(model) {
    if (!model || typeof model !== 'object') {
        throw new LMStudioError(
            'Model must be an object',
            'INVALID_MODEL',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    const required = ['id', 'type', 'state'];
    for (const field of required) {
        if (!model[field]) {
            throw new LMStudioError(
                `Model missing required field: ${field}`,
                'MISSING_FIELD',
                ERROR_CATEGORIES.VALIDATION
            );
        }
    }

    if (!Object.values(MODEL_TYPES).includes(model.type)) {
        throw new LMStudioError(
            `Invalid model type: ${model.type}`,
            'INVALID_MODEL_TYPE',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    if (!Object.values(MODEL_STATES).includes(model.state)) {
        throw new LMStudioError(
            `Invalid model state: ${model.state}`,
            'INVALID_MODEL_STATE',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    if (typeof model.max_context_length === 'number' && model.max_context_length <= 0) {
        throw new LMStudioError(
            'Model max_context_length must be positive',
            'INVALID_CONTEXT_LENGTH',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    return true;
}

/**
 * Validate a chat message object
 * @param {Object} message - Message object to validate
 * @throws {LMStudioError} If validation fails
 * @returns {boolean} True if valid
 */
function validateChatMessage(message) {
    if (!message || typeof message !== 'object') {
        throw new LMStudioError(
            'Message must be an object',
            'INVALID_MESSAGE',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    if (!message.role || !Object.values(MESSAGE_ROLES).includes(message.role)) {
        throw new LMStudioError(
            `Invalid message role: ${message.role}`,
            'INVALID_MESSAGE_ROLE',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    if (!message.content || typeof message.content !== 'string') {
        throw new LMStudioError(
            'Message content must be a non-empty string',
            'INVALID_MESSAGE_CONTENT',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    if (message.content.trim().length === 0) {
        throw new LMStudioError(
            'Message content cannot be empty',
            'EMPTY_MESSAGE_CONTENT',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    return true;
}

/**
 * Validate chat completion request parameters
 * @param {Object} request - Request object to validate
 * @throws {LMStudioError} If validation fails
 * @returns {boolean} True if valid
 */
function validateChatCompletionRequest(request) {
    if (!request || typeof request !== 'object') {
        throw new LMStudioError(
            'Request must be an object',
            'INVALID_REQUEST',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    if (!request.model || typeof request.model !== 'string') {
        throw new LMStudioError(
            'Request must specify a valid model ID',
            'MISSING_MODEL',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    if (!Array.isArray(request.messages) || request.messages.length === 0) {
        throw new LMStudioError(
            'Request must include at least one message',
            'MISSING_MESSAGES',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    // Validate each message
    request.messages.forEach((message, index) => {
        try {
            validateChatMessage(message);
        } catch (error) {
            throw new LMStudioError(
                `Invalid message at index ${index}: ${error.message}`,
                'INVALID_MESSAGE_IN_REQUEST',
                ERROR_CATEGORIES.VALIDATION
            );
        }
    });

    // Validate optional parameters
    if (request.temperature !== undefined) {
        if (typeof request.temperature !== 'number' || request.temperature < 0 || request.temperature > 2) {
            throw new LMStudioError(
                'Temperature must be a number between 0 and 2',
                'INVALID_TEMPERATURE',
                ERROR_CATEGORIES.VALIDATION
            );
        }
    }

    if (request.max_tokens !== undefined) {
        if (!Number.isInteger(request.max_tokens) || request.max_tokens <= 0) {
            throw new LMStudioError(
                'max_tokens must be a positive integer',
                'INVALID_MAX_TOKENS',
                ERROR_CATEGORIES.VALIDATION
            );
        }
    }

    if (request.stream !== undefined && typeof request.stream !== 'boolean') {
        throw new LMStudioError(
            'stream must be a boolean',
            'INVALID_STREAM',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    return true;
}

/**
 * Validate text completion request parameters
 * @param {Object} request - Request object to validate
 * @throws {LMStudioError} If validation fails
 * @returns {boolean} True if valid
 */
function validateCompletionRequest(request) {
    if (!request || typeof request !== 'object') {
        throw new LMStudioError(
            'Request must be an object',
            'INVALID_REQUEST',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    if (!request.model || typeof request.model !== 'string') {
        throw new LMStudioError(
            'Request must specify a valid model ID',
            'MISSING_MODEL',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    if (!request.prompt || typeof request.prompt !== 'string') {
        throw new LMStudioError(
            'Request must include a non-empty prompt',
            'MISSING_PROMPT',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    if (request.prompt.trim().length === 0) {
        throw new LMStudioError(
            'Prompt cannot be empty',
            'EMPTY_PROMPT',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    // Validate optional parameters (same as chat completion)
    if (request.temperature !== undefined) {
        if (typeof request.temperature !== 'number' || request.temperature < 0 || request.temperature > 2) {
            throw new LMStudioError(
                'Temperature must be a number between 0 and 2',
                'INVALID_TEMPERATURE',
                ERROR_CATEGORIES.VALIDATION
            );
        }
    }

    if (request.max_tokens !== undefined) {
        if (!Number.isInteger(request.max_tokens) || request.max_tokens <= 0) {
            throw new LMStudioError(
                'max_tokens must be a positive integer',
                'INVALID_MAX_TOKENS',
                ERROR_CATEGORIES.VALIDATION
            );
        }
    }

    if (request.stop !== undefined) {
        if (!Array.isArray(request.stop)) {
            throw new LMStudioError(
                'stop must be an array of strings',
                'INVALID_STOP',
                ERROR_CATEGORIES.VALIDATION
            );
        }
        
        request.stop.forEach((seq, index) => {
            if (typeof seq !== 'string') {
                throw new LMStudioError(
                    `Stop sequence at index ${index} must be a string`,
                    'INVALID_STOP_SEQUENCE',
                    ERROR_CATEGORIES.VALIDATION
                );
            }
        });
    }

    return true;
}

/**
 * Validate embedding request parameters
 * @param {Object} request - Request object to validate
 * @throws {LMStudioError} If validation fails
 * @returns {boolean} True if valid
 */
function validateEmbeddingRequest(request) {
    if (!request || typeof request !== 'object') {
        throw new LMStudioError(
            'Request must be an object',
            'INVALID_REQUEST',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    if (!request.model || typeof request.model !== 'string') {
        throw new LMStudioError(
            'Request must specify a valid model ID',
            'MISSING_MODEL',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    if (!request.input) {
        throw new LMStudioError(
            'Request must include input text',
            'MISSING_INPUT',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    // Input can be string or array of strings
    if (typeof request.input === 'string') {
        if (request.input.trim().length === 0) {
            throw new LMStudioError(
                'Input text cannot be empty',
                'EMPTY_INPUT',
                ERROR_CATEGORIES.VALIDATION
            );
        }
    } else if (Array.isArray(request.input)) {
        if (request.input.length === 0) {
            throw new LMStudioError(
                'Input array cannot be empty',
                'EMPTY_INPUT_ARRAY',
                ERROR_CATEGORIES.VALIDATION
            );
        }
        
        request.input.forEach((text, index) => {
            if (typeof text !== 'string' || text.trim().length === 0) {
                throw new LMStudioError(
                    `Input at index ${index} must be a non-empty string`,
                    'INVALID_INPUT_ITEM',
                    ERROR_CATEGORIES.VALIDATION
                );
            }
        });
    } else {
        throw new LMStudioError(
            'Input must be a string or array of strings',
            'INVALID_INPUT_TYPE',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    return true;
}

/**
 * Validate server URL format
 * @param {string} url - URL to validate
 * @throws {LMStudioError} If validation fails
 * @returns {boolean} True if valid
 */
function validateServerUrl(url) {
    if (!url || typeof url !== 'string') {
        throw new LMStudioError(
            'Server URL must be a non-empty string',
            'INVALID_URL',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new LMStudioError(
                'Server URL must use HTTP or HTTPS protocol',
                'INVALID_URL_PROTOCOL',
                ERROR_CATEGORIES.VALIDATION
            );
        }
    } catch (error) {
        throw new LMStudioError(
            `Invalid server URL format: ${error.message}`,
            'MALFORMED_URL',
            ERROR_CATEGORIES.VALIDATION
        );
    }

    return true;
}

/**
 * Validate API response structure
 * @param {Object} response - Response object to validate
 * @param {string} expectedType - Expected object type
 * @throws {LMStudioError} If validation fails
 * @returns {boolean} True if valid
 */
function validateApiResponse(response, expectedType) {
    if (!response || typeof response !== 'object') {
        throw new LMStudioError(
            'API response must be an object',
            'INVALID_RESPONSE',
            ERROR_CATEGORIES.API
        );
    }

    if (response.error) {
        throw new LMStudioError(
            `API error: ${response.error.message || 'Unknown error'}`,
            response.error.code || 'API_ERROR',
            ERROR_CATEGORIES.API
        );
    }

    if (expectedType && response.object !== expectedType) {
        throw new LMStudioError(
            `Expected response type ${expectedType}, got ${response.object}`,
            'UNEXPECTED_RESPONSE_TYPE',
            ERROR_CATEGORIES.API
        );
    }

    return true;
}

module.exports = {
    validateModel,
    validateChatMessage,
    validateChatCompletionRequest,
    validateCompletionRequest,
    validateEmbeddingRequest,
    validateServerUrl,
    validateApiResponse
};