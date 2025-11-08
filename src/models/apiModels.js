/**
 * @fileoverview LM Studio API data models and schemas
 * Defines the structure of requests and responses for the LM Studio REST API.
 */

const { MODEL_TYPES, MODEL_STATES, API_OBJECT_TYPES } = require('./constants');

/**
 * Represents an LM Studio model
 * @class
 */
class Model {
    /**
     * Create a Model instance
     * @param {Object} data - Model data from API
     * @param {string} data.id - Unique model identifier
     * @param {string} data.object - API object type (should be 'model')
     * @param {string} data.type - Model type (llm, vlm, embeddings)
     * @param {string} data.publisher - Model publisher/creator
     * @param {string} data.arch - Model architecture
     * @param {string} data.compatibility_type - Compatibility information
     * @param {string} data.quantization - Quantization method used
     * @param {string} data.state - Current loading state
     * @param {number} data.max_context_length - Maximum context window size
     */
    constructor(data) {
        this.id = data.id;
        this.object = data.object || API_OBJECT_TYPES.MODEL;
        this.type = data.type;
        this.publisher = data.publisher;
        this.arch = data.arch;
        this.compatibility_type = data.compatibility_type;
        this.quantization = data.quantization;
        this.state = data.state;
        this.max_context_length = data.max_context_length;
    }

    /**
     * Check if the model is currently loaded
     * @returns {boolean} True if model is loaded
     */
    isLoaded() {
        // If state is undefined, assume the model is loaded since it's returned by the API
        // LM Studio only returns models that are available for use
        if (this.state === undefined || this.state === null) {
            return true;
        }
        // Otherwise check for explicit loaded state
        return this.state === MODEL_STATES.LOADED || this.state === 'ready' || this.state === 'active';
    }

    /**
     * Check if the model supports chat completions
     * @returns {boolean} True if model supports chat
     */
    supportsChat() {
        // If type is undefined, assume it's an LLM (most common case)
        // LM Studio typically returns LLMs without explicit type field
        if (this.type === undefined || this.type === null) {
            return true;
        }
        return this.type === MODEL_TYPES.LLM || this.type === MODEL_TYPES.VLM;
    }

    /**
     * Check if the model supports embeddings
     * @returns {boolean} True if model supports embeddings
     */
    supportsEmbeddings() {
        // Only return true if explicitly marked as embeddings type
        return this.type === MODEL_TYPES.EMBEDDINGS;
    }
}

/**
 * Represents a chat message
 * @class
 */
class ChatMessage {
    /**
     * Create a ChatMessage instance
     * @param {string} role - Message role (system, user, assistant)
     * @param {string} content - Message content
     * @param {Date} [timestamp] - Message timestamp
     */
    constructor(role, content, timestamp = new Date()) {
        this.role = role;
        this.content = content;
        this.timestamp = timestamp;
    }

    /**
     * Convert to API format (without timestamp)
     * @returns {Object} API-compatible message object
     */
    toApiFormat() {
        return {
            role: this.role,
            content: this.content
        };
    }
}

/**
 * Chat completion request parameters
 * @class
 */
class ChatCompletionRequest {
    /**
     * Create a ChatCompletionRequest instance
     * @param {string} model - Model ID to use
     * @param {ChatMessage[]} messages - Array of chat messages
     * @param {Object} [options] - Optional parameters
     * @param {number} [options.temperature] - Sampling temperature (0-2)
     * @param {number} [options.max_tokens] - Maximum tokens to generate
     * @param {boolean} [options.stream] - Enable streaming responses
     * @param {string[]} [options.stop] - Stop sequences
     */
    constructor(model, messages, options = {}) {
        this.model = model;
        this.messages = messages.map(msg => 
            msg instanceof ChatMessage ? msg.toApiFormat() : msg
        );
        this.temperature = options.temperature;
        this.max_tokens = options.max_tokens;
        this.stream = options.stream || false;
        this.stop = options.stop;
    }
}

/**
 * Text completion request parameters
 * @class
 */
class CompletionRequest {
    /**
     * Create a CompletionRequest instance
     * @param {string} model - Model ID to use
     * @param {string} prompt - Text prompt for completion
     * @param {Object} [options] - Optional parameters
     * @param {number} [options.temperature] - Sampling temperature (0-2)
     * @param {number} [options.max_tokens] - Maximum tokens to generate
     * @param {string[]} [options.stop] - Stop sequences
     */
    constructor(model, prompt, options = {}) {
        this.model = model;
        this.prompt = prompt;
        this.temperature = options.temperature;
        this.max_tokens = options.max_tokens;
        this.stop = options.stop;
    }
}

/**
 * Embedding generation request parameters
 * @class
 */
class EmbeddingRequest {
    /**
     * Create an EmbeddingRequest instance
     * @param {string} model - Model ID to use
     * @param {string|string[]} input - Text input(s) to embed
     */
    constructor(model, input) {
        this.model = model;
        this.input = input;
    }
}

/**
 * Token usage statistics
 * @class
 */
class TokenUsage {
    /**
     * Create a TokenUsage instance
     * @param {Object} data - Usage data from API
     * @param {number} data.prompt_tokens - Tokens in the prompt
     * @param {number} data.completion_tokens - Tokens in the completion
     * @param {number} data.total_tokens - Total tokens used
     */
    constructor(data) {
        this.prompt_tokens = data.prompt_tokens;
        this.completion_tokens = data.completion_tokens;
        this.total_tokens = data.total_tokens;
    }
}

/**
 * Performance statistics for model inference
 * @class
 */
class PerformanceStats {
    /**
     * Create a PerformanceStats instance
     * @param {Object} data - Performance data from API
     * @param {number} data.tokens_per_second - Generation speed
     * @param {number} data.time_to_first_token - Time to first token (ms)
     * @param {number} data.generation_time - Total generation time (ms)
     * @param {string} data.stop_reason - Reason generation stopped
     */
    constructor(data) {
        this.tokens_per_second = data.tokens_per_second;
        this.time_to_first_token = data.time_to_first_token;
        this.generation_time = data.generation_time;
        this.stop_reason = data.stop_reason;
    }
}

/**
 * Model information included in responses
 * @class
 */
class ModelInfo {
    /**
     * Create a ModelInfo instance
     * @param {Object} data - Model info data from API
     * @param {string} data.id - Model ID
     * @param {string} data.arch - Model architecture
     * @param {number} data.context_length - Context window size
     */
    constructor(data) {
        this.id = data.id;
        this.arch = data.arch;
        this.context_length = data.context_length;
    }
}

/**
 * Chat completion choice
 * @class
 */
class ChatChoice {
    /**
     * Create a ChatChoice instance
     * @param {Object} data - Choice data from API
     * @param {number} data.index - Choice index
     * @param {Object} data.message - Generated message
     * @param {string} data.finish_reason - Reason completion finished
     */
    constructor(data) {
        this.index = data.index;
        this.message = new ChatMessage(data.message.role, data.message.content);
        this.finish_reason = data.finish_reason;
    }
}

/**
 * Chat completion response
 * @class
 */
class ChatCompletionResponse {
    /**
     * Create a ChatCompletionResponse instance
     * @param {Object} data - Response data from API
     */
    constructor(data) {
        this.id = data.id;
        this.object = data.object;
        this.created = data.created;
        this.model = data.model;
        this.choices = data.choices.map(choice => new ChatChoice(choice));
        this.usage = new TokenUsage(data.usage);
        this.stats = new PerformanceStats(data.stats);
        this.model_info = new ModelInfo(data.model_info);
    }

    /**
     * Get the first choice message content
     * @returns {string} The generated message content
     */
    getContent() {
        return this.choices[0]?.message.content || '';
    }
}

/**
 * Text completion choice
 * @class
 */
class CompletionChoice {
    /**
     * Create a CompletionChoice instance
     * @param {Object} data - Choice data from API
     */
    constructor(data) {
        this.index = data.index;
        this.text = data.text;
        this.finish_reason = data.finish_reason;
    }
}

/**
 * Text completion response
 * @class
 */
class CompletionResponse {
    /**
     * Create a CompletionResponse instance
     * @param {Object} data - Response data from API
     */
    constructor(data) {
        this.id = data.id;
        this.object = data.object;
        this.created = data.created;
        this.model = data.model;
        this.choices = data.choices.map(choice => new CompletionChoice(choice));
        this.usage = new TokenUsage(data.usage);
        this.stats = new PerformanceStats(data.stats);
        this.model_info = new ModelInfo(data.model_info);
    }

    /**
     * Get the first choice text
     * @returns {string} The generated text
     */
    getText() {
        return this.choices[0]?.text || '';
    }
}

/**
 * Embedding data
 * @class
 */
class EmbeddingData {
    /**
     * Create an EmbeddingData instance
     * @param {Object} data - Embedding data from API
     */
    constructor(data) {
        this.object = data.object;
        this.embedding = data.embedding;
        this.index = data.index;
    }
}

/**
 * Embedding response
 * @class
 */
class EmbeddingResponse {
    /**
     * Create an EmbeddingResponse instance
     * @param {Object} data - Response data from API
     */
    constructor(data) {
        this.object = data.object;
        this.data = data.data.map(item => new EmbeddingData(item));
        this.model = data.model;
        this.usage = new TokenUsage(data.usage);
    }

    /**
     * Get all embedding vectors
     * @returns {number[][]} Array of embedding vectors
     */
    getEmbeddings() {
        return this.data.map(item => item.embedding);
    }
}

module.exports = {
    Model,
    ChatMessage,
    ChatCompletionRequest,
    CompletionRequest,
    EmbeddingRequest,
    TokenUsage,
    PerformanceStats,
    ModelInfo,
    ChatChoice,
    ChatCompletionResponse,
    CompletionChoice,
    CompletionResponse,
    EmbeddingData,
    EmbeddingResponse
};