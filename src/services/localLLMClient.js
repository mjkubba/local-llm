/**
 * @fileoverview Local LLM HTTP client for API communication
 * Provides HTTP client functionality for communicating with Local LLM REST API
 * with proper error handling, retry logic, and connection validation.
 */

const { 
    ConnectionError, 
    ApiError, 
    ModelError,
    createErrorFromResponse, 
    createConnectionError 
} = require('../models/errors');
const constants = require('../models/constants');
const { DEFAULTS, MODEL_TYPES } = constants;

// Note: DEFAULTS may be undefined due to webpack bundling issues
// Fallback values are provided in the constructor
const { 
    Model, 
    ChatCompletionRequest, 
    CompletionRequest, 
    EmbeddingRequest,
    ChatCompletionResponse,
    CompletionResponse,
    EmbeddingResponse
} = require('../models/apiModels');
const { getLogger } = require('./logger');
const { wrapApiCall } = require('./globalErrorBoundary');

/**
 * HTTP client for Local LLM REST API
 * @class
 */
class LocalLLMClient {
    /**
     * Create an LocalLLMClient instance
     * @param {string} [baseUrl] - Base URL for Local LLM server
     * @param {Object} [options] - Client configuration options
     * @param {number} [options.timeout] - Request timeout in milliseconds
     * @param {number} [options.retryAttempts] - Number of retry attempts
     */
    constructor(baseUrl, options = {}) {
        // Ensure baseUrl is a string, use default if not provided
        const url = baseUrl || (DEFAULTS ? DEFAULTS.SERVER_URL : 'http://localhost:1234');
        if (typeof url !== 'string') {
            throw new Error(`baseUrl must be a string, got ${typeof url}`);
        }
        this.baseUrl = url.replace(/\/$/, ''); // Remove trailing slash
        
        // Use fallback values if DEFAULTS is undefined (bundling issue)
        const defaultTimeout = (DEFAULTS && DEFAULTS.CONNECTION) ? DEFAULTS.CONNECTION.TIMEOUT : 120000;
        const defaultRetryAttempts = (DEFAULTS && DEFAULTS.CONNECTION) ? DEFAULTS.CONNECTION.RETRY_ATTEMPTS : 3;
        
        this.timeout = options.timeout !== undefined ? options.timeout : defaultTimeout;
        this.retryAttempts = options.retryAttempts !== undefined ? options.retryAttempts : defaultRetryAttempts;
        this.isHealthy = false;
        this.lastHealthCheck = null;
        this.logger = getLogger('LocalLLMClient');
        
        // Wrap API methods with error boundary
        this.makeRequest = wrapApiCall(this.makeRequest.bind(this), { 
            operation: 'http_request' 
        });
    }

    /**
     * Make HTTP request with error handling and retry logic
     * @private
     * @param {string} endpoint - API endpoint path
     * @param {Object} [options] - Request options
     * @param {string} [options.method='GET'] - HTTP method
     * @param {Object} [options.headers] - Request headers
     * @param {Object} [options.body] - Request body
     * @param {boolean} [options.stream=false] - Enable streaming response
     * @returns {Promise<Response>} HTTP response
     * @throws {ConnectionError|ApiError} On request failure
     */
    async makeRequest(endpoint, options = {}) {
        const {
            method = 'GET',
            headers = {},
            body = null,
            stream = false
        } = options;

        const url = `${this.baseUrl}${endpoint}`;
        const requestOptions = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': stream ? 'text/event-stream' : 'application/json',
                ...headers
            },
            signal: AbortSignal.timeout(this.timeout)
        };

        if (body && method !== 'GET') {
            requestOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        }

        let lastError;
        const startTime = Date.now();
        
        // Log the request
        this.logger.logApiRequest(method, url, { headers, bodySize: body ? body.length : 0 });
        
        for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
            try {
                const response = await fetch(url, requestOptions);
                const duration = Date.now() - startTime;
                
                // Log the response
                this.logger.logApiResponse(method, url, response.status, duration);
                
                if (!response.ok) {
                    const errorText = await response.text();
                    let errorMessage;
                    
                    try {
                        const errorData = JSON.parse(errorText);
                        errorMessage = errorData.error?.message || errorData.message || errorText;
                    } catch {
                        errorMessage = errorText || `HTTP ${response.status} ${response.statusText}`;
                    }
                    
                    throw createErrorFromResponse(response, errorMessage);
                }

                return response;
                
            } catch (error) {
                lastError = error;
                
                // Log the error
                this.logger.warn(`Request failed (attempt ${attempt + 1}/${this.retryAttempts + 1})`, {
                    method,
                    url,
                    error: error.message,
                    attempt: attempt + 1
                });
                
                // Don't retry on client errors (4xx) or validation errors
                if (error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500) {
                    throw error;
                }
                
                // Don't retry on the last attempt
                if (attempt === this.retryAttempts) {
                    break;
                }
                
                // Convert network errors to connection errors
                if (!(error instanceof ApiError)) {
                    lastError = createConnectionError(error);
                }
                
                // Wait before retrying (exponential backoff with jitter)
                const baseDelay = 1000 * Math.pow(2, attempt);
                const jitter = Math.random() * 0.1 * baseDelay; // Add up to 10% jitter
                const delay = Math.min(baseDelay + jitter, 10000);
                this.logger.debug(`Retrying in ${Math.round(delay)}ms... (attempt ${attempt + 1}/${this.retryAttempts + 1})`);
                await this.sleep(delay);
            }
        }
        
        throw lastError;
    }

    /**
     * Make JSON request and parse response
     * @private
     * @param {string} endpoint - API endpoint path
     * @param {Object} [options] - Request options
     * @returns {Promise<Object>} Parsed JSON response
     * @throws {ConnectionError|ApiError} On request failure
     */
    async makeJsonRequest(endpoint, options = {}) {
        const response = await this.makeRequest(endpoint, options);
        
        try {
            return await response.json();
        } catch (error) {
            throw new ApiError(
                'Failed to parse JSON response',
                'INVALID_JSON_RESPONSE',
                response.status,
                error
            );
        }
    }

    /**
     * Check if Local LLM server is healthy and accessible
     * @returns {Promise<boolean>} True if server is healthy
     */
    async checkHealth() {
        try {
            // Use models endpoint as health check
            await this.makeRequest('/v1/models');
            this.isHealthy = true;
            this.lastHealthCheck = new Date();
            return true;
        } catch (error) {
            this.isHealthy = false;
            this.lastHealthCheck = new Date();
            return false;
        }
    }

    /**
     * Validate connection to Local LLM server
     * @throws {ConnectionError} If connection validation fails
     * @returns {Promise<boolean>} True if connection is valid
     */
    async validateConnection() {
        const isHealthy = await this.checkHealth();
        
        if (!isHealthy) {
            throw new ConnectionError(
                'Cannot connect to Local LLM server. Please ensure Local LLM is running and the server is enabled.',
                'CONNECTION_VALIDATION_FAILED'
            );
        }
        
        return true;
    }

    /**
     * Update client configuration
     * @param {Object} config - New configuration
     * @param {string} [config.baseUrl] - New base URL
     * @param {number} [config.timeout] - New timeout value
     * @param {number} [config.retryAttempts] - New retry attempts
     */
    updateConfig(config) {
        if (config.baseUrl) {
            if (typeof config.baseUrl !== 'string') {
                throw new Error(`baseUrl must be a string, got ${typeof config.baseUrl}`);
            }
            this.baseUrl = config.baseUrl.replace(/\/$/, '');
        }
        
        if (config.timeout !== undefined) {
            this.timeout = config.timeout;
        }
        
        if (config.retryAttempts !== undefined) {
            this.retryAttempts = config.retryAttempts;
        }
        
        // Reset health status when config changes
        this.isHealthy = false;
        this.lastHealthCheck = null;
    }

    /**
     * Get current client status
     * @returns {Object} Client status information
     */
    getStatus() {
        return {
            baseUrl: this.baseUrl,
            timeout: this.timeout,
            retryAttempts: this.retryAttempts,
            isHealthy: this.isHealthy,
            lastHealthCheck: this.lastHealthCheck
        };
    }

    /**
     * Get all available models from Local LLM
     * @returns {Promise<Model[]>} Array of available models
     * @throws {ConnectionError|ApiError} On request failure
     */
    async getModels() {
        try {
            const response = await this.makeJsonRequest('/v1/models');
            
            if (!response.data || !Array.isArray(response.data)) {
                throw new ApiError(
                    'Invalid models response format',
                    'INVALID_MODELS_RESPONSE'
                );
            }
            
            return response.data.map(modelData => new Model(modelData));
            
        } catch (error) {
            if (error instanceof ConnectionError || error instanceof ApiError) {
                throw error;
            }
            
            throw new ApiError(
                `Failed to retrieve models: ${error.message}`,
                'GET_MODELS_FAILED',
                null,
                error
            );
        }
    }

    /**
     * Get specific model by ID
     * @param {string} modelId - Model identifier
     * @returns {Promise<Model>} Model instance
     * @throws {ModelError|ConnectionError|ApiError} On request failure or model not found
     */
    async getModel(modelId) {
        if (!modelId || typeof modelId !== 'string') {
            throw new ModelError(
                'Model ID is required and must be a string',
                'INVALID_MODEL_ID',
                modelId
            );
        }

        try {
            const models = await this.getModels();
            const model = models.find(m => m.id === modelId);
            
            if (!model) {
                throw new ModelError(
                    `Model '${modelId}' not found`,
                    'MODEL_NOT_FOUND',
                    modelId
                );
            }
            
            return model;
            
        } catch (error) {
            if (error instanceof ModelError) {
                throw error;
            }
            
            throw new ModelError(
                `Failed to retrieve model '${modelId}': ${error.message}`,
                'GET_MODEL_FAILED',
                modelId,
                error
            );
        }
    }

    /**
     * Get models filtered by type
     * @param {string} modelType - Model type to filter by (from MODEL_TYPES)
     * @returns {Promise<Model[]>} Array of models matching the type
     * @throws {ConnectionError|ApiError} On request failure
     */
    async getModelsByType(modelType) {
        if (!Object.values(MODEL_TYPES).includes(modelType)) {
            throw new ModelError(
                `Invalid model type '${modelType}'. Must be one of: ${Object.values(MODEL_TYPES).join(', ')}`,
                'INVALID_MODEL_TYPE'
            );
        }

        const models = await this.getModels();
        return models.filter(model => model.type === modelType);
    }

    /**
     * Get only loaded models
     * @returns {Promise<Model[]>} Array of loaded models
     * @throws {ConnectionError|ApiError} On request failure
     */
    async getLoadedModels() {
        const models = await this.getModels();
        return models.filter(model => model.isLoaded());
    }

    /**
     * Get models that support chat completions
     * @returns {Promise<Model[]>} Array of chat-capable models
     * @throws {ConnectionError|ApiError} On request failure
     */
    async getChatModels() {
        const models = await this.getModels();
        return models.filter(model => model.supportsChat());
    }

    /**
     * Get models that support embeddings
     * @returns {Promise<Model[]>} Array of embedding-capable models
     * @throws {ConnectionError|ApiError} On request failure
     */
    async getEmbeddingModels() {
        const models = await this.getModels();
        return models.filter(model => model.supportsEmbeddings());
    }

    /**
     * Check if a specific model is loaded and ready
     * @param {string} modelId - Model identifier
     * @returns {Promise<boolean>} True if model is loaded
     * @throws {ModelError|ConnectionError|ApiError} On request failure
     */
    async isModelLoaded(modelId) {
        try {
            const model = await this.getModel(modelId);
            return model.isLoaded();
        } catch (error) {
            if (error instanceof ModelError && error.code === 'MODEL_NOT_FOUND') {
                return false;
            }
            throw error;
        }
    }

    /**
     * Get model metadata and status information
     * @param {string} modelId - Model identifier
     * @returns {Promise<Object>} Model metadata object
     * @throws {ModelError|ConnectionError|ApiError} On request failure
     */
    async getModelMetadata(modelId) {
        const model = await this.getModel(modelId);
        
        return {
            id: model.id,
            type: model.type,
            publisher: model.publisher,
            architecture: model.arch,
            quantization: model.quantization,
            state: model.state,
            maxContextLength: model.max_context_length,
            isLoaded: model.isLoaded(),
            supportsChat: model.supportsChat(),
            supportsEmbeddings: model.supportsEmbeddings(),
            compatibilityType: model.compatibility_type
        };
    }

    /**
     * Generate chat completion using Local LLM
     * @param {ChatCompletionRequest|Object} request - Chat completion request
     * @param {Object} [options] - Additional options
     * @param {boolean} [options.validateModel=true] - Whether to validate model exists and supports chat
     * @returns {Promise<ChatCompletionResponse>} Chat completion response
     * @throws {ModelError|ValidationError|ConnectionError|ApiError} On request failure
     */
    async chatCompletion(request, options = {}) {
        const { validateModel = true } = options;
        
        // Convert to ChatCompletionRequest if needed
        const chatRequest = request instanceof ChatCompletionRequest ? 
            request : new ChatCompletionRequest(request.model, request.messages, request);
        
        // Validate model if requested
        if (validateModel) {
            await this.validateChatModel(chatRequest.model);
        }
        
        try {
            const response = await this.makeJsonRequest('/v1/chat/completions', {
                method: 'POST',
                body: chatRequest
            });
            
            return new ChatCompletionResponse(response);
            
        } catch (error) {
            if (error instanceof ConnectionError || error instanceof ApiError) {
                throw error;
            }
            
            throw new ApiError(
                `Chat completion failed: ${error.message}`,
                'CHAT_COMPLETION_FAILED',
                null,
                error
            );
        }
    }

    /**
     * Generate streaming chat completion
     * @param {ChatCompletionRequest|Object} request - Chat completion request
     * @param {Function} onChunk - Callback for each streaming chunk
     * @param {Object} [options] - Additional options
     * @param {boolean} [options.validateModel=true] - Whether to validate model
     * @returns {Promise<void>} Resolves when streaming completes
     * @throws {ModelError|ValidationError|ConnectionError|ApiError} On request failure
     */
    async streamChatCompletion(request, onChunk, options = {}) {
        const { validateModel = true } = options;
        
        // Convert to ChatCompletionRequest and enable streaming
        const chatRequest = request instanceof ChatCompletionRequest ? 
            request : new ChatCompletionRequest(request.model, request.messages, request);
        chatRequest.stream = true;
        
        // Validate model if requested
        if (validateModel) {
            await this.validateChatModel(chatRequest.model);
        }
        
        try {
            const response = await this.makeRequest('/v1/chat/completions', {
                method: 'POST',
                body: chatRequest,
                stream: true
            });
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            try {
                // eslint-disable-next-line no-constant-condition
                while (true) {
                    const { done, value } = await reader.read();
                    
                    if (done) {
                        break;
                    }
                    
                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n').filter(line => line.trim());
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            
                            if (data === '[DONE]') {
                                return;
                            }
                            
                            try {
                                const parsed = JSON.parse(data);
                                onChunk(parsed);
                            } catch (parseError) {
                                // Skip invalid JSON chunks
                                continue;
                            }
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }
            
        } catch (error) {
            if (error instanceof ConnectionError || error instanceof ApiError) {
                throw error;
            }
            
            throw new ApiError(
                `Streaming chat completion failed: ${error.message}`,
                'STREAM_CHAT_COMPLETION_FAILED',
                null,
                error
            );
        }
    }

    /**
     * Generate text completion using Local LLM
     * @param {CompletionRequest|Object} request - Text completion request
     * @param {Object} [options] - Additional options
     * @param {boolean} [options.validateModel=true] - Whether to validate model exists
     * @returns {Promise<CompletionResponse>} Text completion response
     * @throws {ModelError|ValidationError|ConnectionError|ApiError} On request failure
     */
    async textCompletion(request, options = {}) {
        const { validateModel = true } = options;
        
        // Convert to CompletionRequest if needed
        const completionRequest = request instanceof CompletionRequest ? 
            request : new CompletionRequest(request.model, request.prompt, request);
        
        // Validate model if requested
        if (validateModel) {
            await this.validateTextModel(completionRequest.model);
        }
        
        try {
            const response = await this.makeJsonRequest('/v1/completions', {
                method: 'POST',
                body: completionRequest
            });
            
            return new CompletionResponse(response);
            
        } catch (error) {
            if (error instanceof ConnectionError || error instanceof ApiError) {
                throw error;
            }
            
            throw new ApiError(
                `Text completion failed: ${error.message}`,
                'TEXT_COMPLETION_FAILED',
                null,
                error
            );
        }
    }

    /**
     * Generate embeddings using Local LLM
     * @param {EmbeddingRequest|Object} request - Embedding request
     * @param {Object} [options] - Additional options
     * @param {boolean} [options.validateModel=true] - Whether to validate model supports embeddings
     * @returns {Promise<EmbeddingResponse>} Embedding response
     * @throws {ModelError|ValidationError|ConnectionError|ApiError} On request failure
     */
    async generateEmbeddings(request, options = {}) {
        const { validateModel = true } = options;
        
        // Convert to EmbeddingRequest if needed
        const embeddingRequest = request instanceof EmbeddingRequest ? 
            request : new EmbeddingRequest(request.model, request.input);
        
        // Validate model if requested
        if (validateModel) {
            await this.validateEmbeddingModel(embeddingRequest.model);
        }
        
        try {
            const response = await this.makeJsonRequest('/v1/embeddings', {
                method: 'POST',
                body: embeddingRequest
            });
            
            return new EmbeddingResponse(response);
            
        } catch (error) {
            if (error instanceof ConnectionError || error instanceof ApiError) {
                throw error;
            }
            
            throw new ApiError(
                `Embedding generation failed: ${error.message}`,
                'EMBEDDING_GENERATION_FAILED',
                null,
                error
            );
        }
    }

    /**
     * Validate that a model exists and supports chat completions
     * @private
     * @param {string} modelId - Model identifier
     * @throws {ModelError} If model doesn't exist or doesn't support chat
     */
    async validateChatModel(modelId) {
        const model = await this.getModel(modelId);
        
        if (!model.supportsChat()) {
            throw new ModelError(
                `Model '${modelId}' does not support chat completions. Model type: ${model.type}`,
                'MODEL_INCOMPATIBLE_CHAT',
                modelId
            );
        }
        
        if (!model.isLoaded()) {
            throw new ModelError(
                `Model '${modelId}' is not currently loaded. Please load the model in Local LLM first.`,
                'MODEL_NOT_LOADED',
                modelId
            );
        }
    }

    /**
     * Validate that a model exists and can be used for text completion
     * @private
     * @param {string} modelId - Model identifier
     * @throws {ModelError} If model doesn't exist or isn't loaded
     */
    async validateTextModel(modelId) {
        const model = await this.getModel(modelId);
        
        if (!model.isLoaded()) {
            throw new ModelError(
                `Model '${modelId}' is not currently loaded. Please load the model in Local LLM first.`,
                'MODEL_NOT_LOADED',
                modelId
            );
        }
    }

    /**
     * Validate that a model exists and supports embeddings
     * @private
     * @param {string} modelId - Model identifier
     * @throws {ModelError} If model doesn't exist or doesn't support embeddings
     */
    async validateEmbeddingModel(modelId) {
        const model = await this.getModel(modelId);
        
        if (!model.supportsEmbeddings()) {
            throw new ModelError(
                `Model '${modelId}' does not support embeddings. Model type: ${model.type}`,
                'MODEL_INCOMPATIBLE_EMBEDDINGS',
                modelId
            );
        }
        
        if (!model.isLoaded()) {
            throw new ModelError(
                `Model '${modelId}' is not currently loaded. Please load the model in Local LLM first.`,
                'MODEL_NOT_LOADED',
                modelId
            );
        }
    }

    /**
     * Sleep for specified duration
     * @private
     * @param {number} ms - Milliseconds to sleep
     * @returns {Promise<void>}
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { LocalLLMClient };