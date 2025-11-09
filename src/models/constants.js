/**
 * @fileoverview Constants for LM Studio API integration
 * Defines model types, states, error categories, and other constant values
 * used throughout the extension.
 */

/**
 * Model types supported by LM Studio
 * @readonly
 * @enum {string}
 */
const MODEL_TYPES = {
    /** Large Language Model for text generation and chat */
    LLM: 'llm',
    /** Vision Language Model for multimodal tasks */
    VLM: 'vlm', 
    /** Embedding model for vector representations */
    EMBEDDINGS: 'embeddings'
};

/**
 * Model loading states
 * @readonly
 * @enum {string}
 */
const MODEL_STATES = {
    /** Model is loaded and ready for inference */
    LOADED: 'loaded',
    /** Model is not currently loaded */
    NOT_LOADED: 'not-loaded'
};

/**
 * Error categories for structured error handling
 * @readonly
 * @enum {string}
 */
const ERROR_CATEGORIES = {
    /** Connection-related errors (network, timeout, etc.) */
    CONNECTION: 'connection',
    /** API-related errors (invalid requests, server errors) */
    API: 'api',
    /** Model-related errors (not found, failed to load) */
    MODEL: 'model',
    /** Validation errors (invalid parameters, malformed data) */
    VALIDATION: 'validation',
    /** Runtime errors (unexpected exceptions) */
    RUNTIME: 'runtime'
};

/**
 * Chat message roles
 * @readonly
 * @enum {string}
 */
const MESSAGE_ROLES = {
    /** System message for setting context and behavior */
    SYSTEM: 'system',
    /** User message from the human */
    USER: 'user',
    /** Assistant message from the AI model */
    ASSISTANT: 'assistant'
};

/**
 * API object types returned by LM Studio
 * @readonly
 * @enum {string}
 */
const API_OBJECT_TYPES = {
    /** Model object type */
    MODEL: 'model',
    /** Chat completion object type */
    CHAT_COMPLETION: 'chat.completion',
    /** Text completion object type */
    TEXT_COMPLETION: 'text_completion',
    /** Embedding object type */
    EMBEDDING: 'embedding'
};

/**
 * Stop reasons for completion generation
 * @readonly
 * @enum {string}
 */
const STOP_REASONS = {
    /** Generation completed naturally */
    STOP: 'stop',
    /** Maximum token limit reached */
    LENGTH: 'length',
    /** Custom stop sequence encountered */
    STOP_SEQUENCE: 'stop_sequence'
};

/**
 * Default configuration values
 * @readonly
 */
const DEFAULTS = {
    /** Default LM Studio server URL */
    SERVER_URL: 'http://localhost:1234',
    
    /** Default chat completion parameters */
    CHAT: {
        TEMPERATURE: 0.7,
        MAX_TOKENS: 1000,
        SYSTEM_PROMPT: 'You are a helpful AI assistant for software development.'
    },
    
    /** Default text completion parameters */
    COMPLETION: {
        TEMPERATURE: 0.7,
        MAX_TOKENS: 500,
        STOP_SEQUENCES: ['\n\n', '```']
    },
    
    /** Default connection settings */
    CONNECTION: {
        TIMEOUT: 120000, // 2 minutes
        RETRY_ATTEMPTS: 3,
        HEALTH_CHECK_INTERVAL: 60000 // 1 minute
    }
};

module.exports = {
    MODEL_TYPES,
    MODEL_STATES,
    ERROR_CATEGORIES,
    MESSAGE_ROLES,
    API_OBJECT_TYPES,
    STOP_REASONS,
    DEFAULTS
};