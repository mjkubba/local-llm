const assert = require('assert');
const { LocalLLMClient } = require('../../services/localLLMClient');
const { 
    ConnectionError, 
    ApiError, 
    ModelError, 
    ValidationError 
} = require('../../models/errors');
const { 
    Model, 
    ChatCompletionRequest, 
    CompletionRequest, 
    EmbeddingRequest 
} = require('../../models/apiModels');
const { MODEL_TYPES, MODEL_STATES } = require('../../models/constants');

// Mock fetch globally for testing
global.fetch = async (url, options) => {
    return mockFetch(url, options);
};

// Mock server responses
let mockResponses = {};
let mockFetch;

suite('LocalLLMClient Test Suite', () => {
    let client;
    
    setup(() => {
        // Reset mock responses before each test
        mockResponses = {};
        
        // Create mock fetch function
        mockFetch = async (url, options) => {
            const endpoint = url.replace('http://localhost:1234', '');
            
            if (mockResponses[endpoint]) {
                const response = mockResponses[endpoint];
                
                if (response.error) {
                    throw response.error;
                }
                
                return {
                    ok: response.ok !== false,
                    status: response.status || 200,
                    statusText: response.statusText || 'OK',
                    json: async () => response.data,
                    text: async () => JSON.stringify(response.data),
                    body: response.stream ? {
                        getReader: () => ({
                            read: async () => response.stream.shift() || { done: true },
                            releaseLock: () => {}
                        })
                    } : undefined
                };
            }
            
            // Default 404 response
            return {
                ok: false,
                status: 404,
                statusText: 'Not Found',
                json: async () => ({ error: { message: 'Endpoint not found' } }),
                text: async () => JSON.stringify({ error: { message: 'Endpoint not found' } })
            };
        };
        
        // Replace global fetch
        global.fetch = mockFetch;
        
        // Create client instance
        client = new LocalLLMClient();
    });

    suite('Constructor and Configuration', () => {
        test('should create client with default configuration', () => {
            const defaultClient = new LocalLLMClient();
            assert.strictEqual(defaultClient.baseUrl, 'http://localhost:1234');
            assert.strictEqual(defaultClient.timeout, 30000);
            assert.strictEqual(defaultClient.retryAttempts, 3);
        });

        test('should create client with custom configuration', () => {
            const customClient = new LocalLLMClient('http://custom:8080', {
                timeout: 5000,
                retryAttempts: 1
            });
            assert.strictEqual(customClient.baseUrl, 'http://custom:8080');
            assert.strictEqual(customClient.timeout, 5000);
            assert.strictEqual(customClient.retryAttempts, 1);
        });

        test('should remove trailing slash from base URL', () => {
            const clientWithSlash = new LocalLLMClient('http://localhost:1234/');
            assert.strictEqual(clientWithSlash.baseUrl, 'http://localhost:1234');
        });

        test('should update configuration', () => {
            client.updateConfig({
                baseUrl: 'http://updated:9999',
                timeout: 15000,
                retryAttempts: 5
            });
            
            assert.strictEqual(client.baseUrl, 'http://updated:9999');
            assert.strictEqual(client.timeout, 15000);
            assert.strictEqual(client.retryAttempts, 5);
        });
    });

    suite('Health Check and Connection', () => {
        test('should return true for healthy connection', async () => {
            mockResponses['/v1/models'] = {
                data: { data: [] }
            };
            
            const isHealthy = await client.checkHealth();
            assert.strictEqual(isHealthy, true);
            assert.strictEqual(client.isHealthy, true);
        });

        test('should return false for unhealthy connection', async () => {
            mockResponses['/v1/models'] = {
                error: new Error('Connection refused')
            };
            
            const isHealthy = await client.checkHealth();
            assert.strictEqual(isHealthy, false);
            assert.strictEqual(client.isHealthy, false);
        });

        test('should validate connection successfully', async () => {
            mockResponses['/v1/models'] = {
                data: { data: [] }
            };
            
            const result = await client.validateConnection();
            assert.strictEqual(result, true);
        });

        test('should throw ConnectionError for failed validation', async () => {
            mockResponses['/v1/models'] = {
                error: new Error('Connection refused')
            };
            
            await assert.rejects(
                () => client.validateConnection(),
                ConnectionError
            );
        });
    });

    suite('Model Management', () => {
        const mockModelsResponse = {
            data: [
                {
                    id: 'test-llm',
                    object: 'model',
                    type: 'llm',
                    publisher: 'test',
                    arch: 'transformer',
                    compatibility_type: 'chat',
                    quantization: 'q4_0',
                    state: 'loaded',
                    max_context_length: 4096
                },
                {
                    id: 'test-embedding',
                    object: 'model',
                    type: 'embeddings',
                    publisher: 'test',
                    arch: 'transformer',
                    compatibility_type: 'embedding',
                    quantization: 'fp16',
                    state: 'not-loaded',
                    max_context_length: 512
                }
            ]
        };

        test('should get all models', async () => {
            mockResponses['/v1/models'] = { data: mockModelsResponse };
            
            const models = await client.getModels();
            assert.strictEqual(models.length, 2);
            assert.strictEqual(models[0].id, 'test-llm');
            assert.strictEqual(models[1].id, 'test-embedding');
            assert(models[0] instanceof Model);
        });

        test('should get specific model by ID', async () => {
            mockResponses['/v1/models'] = { data: mockModelsResponse };
            
            const model = await client.getModel('test-llm');
            assert.strictEqual(model.id, 'test-llm');
            assert.strictEqual(model.type, 'llm');
            assert(model instanceof Model);
        });

        test('should throw ModelError for non-existent model', async () => {
            mockResponses['/v1/models'] = { data: mockModelsResponse };
            
            await assert.rejects(
                () => client.getModel('non-existent'),
                ModelError
            );
        });

        test('should filter models by type', async () => {
            mockResponses['/v1/models'] = { data: mockModelsResponse };
            
            const llmModels = await client.getModelsByType(MODEL_TYPES.LLM);
            assert.strictEqual(llmModels.length, 1);
            assert.strictEqual(llmModels[0].type, 'llm');
            
            const embeddingModels = await client.getModelsByType(MODEL_TYPES.EMBEDDINGS);
            assert.strictEqual(embeddingModels.length, 1);
            assert.strictEqual(embeddingModels[0].type, 'embeddings');
        });

        test('should get only loaded models', async () => {
            mockResponses['/v1/models'] = { data: mockModelsResponse };
            
            const loadedModels = await client.getLoadedModels();
            assert.strictEqual(loadedModels.length, 1);
            assert.strictEqual(loadedModels[0].id, 'test-llm');
            assert.strictEqual(loadedModels[0].state, 'loaded');
        });

        test('should get chat-capable models', async () => {
            mockResponses['/v1/models'] = { data: mockModelsResponse };
            
            const chatModels = await client.getChatModels();
            assert.strictEqual(chatModels.length, 1);
            assert.strictEqual(chatModels[0].id, 'test-llm');
        });

        test('should check if model is loaded', async () => {
            mockResponses['/v1/models'] = { data: mockModelsResponse };
            
            const isLoaded = await client.isModelLoaded('test-llm');
            assert.strictEqual(isLoaded, true);
            
            const isNotLoaded = await client.isModelLoaded('test-embedding');
            assert.strictEqual(isNotLoaded, false);
        });
    });

    suite('Error Handling', () => {
        test('should handle API errors correctly', async () => {
            mockResponses['/v1/models'] = {
                ok: false,
                status: 500,
                data: { error: { message: 'Internal server error' } }
            };
            
            await assert.rejects(
                () => client.getModels(),
                ApiError
            );
        });

        test('should handle connection errors with retry', async () => {
            let attempts = 0;
            mockFetch = async () => {
                attempts++;
                if (attempts <= 2) {
                    throw new Error('ECONNREFUSED');
                }
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ data: [] })
                };
            };
            global.fetch = mockFetch;
            
            const models = await client.getModels();
            assert.strictEqual(attempts, 3);
            assert(Array.isArray(models));
        });

        test('should not retry on client errors', async () => {
            let attempts = 0;
            mockFetch = async () => {
                attempts++;
                return {
                    ok: false,
                    status: 400,
                    json: async () => ({ error: { message: 'Bad request' } }),
                    text: async () => JSON.stringify({ error: { message: 'Bad request' } })
                };
            };
            global.fetch = mockFetch;
            
            await assert.rejects(() => client.getModels(), ApiError);
            assert.strictEqual(attempts, 1); // Should not retry
        });
    });

    suite('Status and Utilities', () => {
        test('should return client status', () => {
            const status = client.getStatus();
            assert.strictEqual(status.baseUrl, 'http://localhost:1234');
            assert.strictEqual(status.timeout, 30000);
            assert.strictEqual(status.retryAttempts, 3);
            assert.strictEqual(typeof status.isHealthy, 'boolean');
        });

        test('should handle invalid JSON responses', async () => {
            mockFetch = async () => ({
                ok: true,
                status: 200,
                json: async () => {
                    throw new Error('Invalid JSON');
                }
            });
            global.fetch = mockFetch;
            
            await assert.rejects(
                () => client.getModels(),
                ApiError
            );
        });
    });
}); 
   suite('AI Interactions', () => {
        const mockModelsResponse = {
            data: [
                {
                    id: 'test-chat-model',
                    object: 'model',
                    type: 'llm',
                    publisher: 'test',
                    arch: 'transformer',
                    compatibility_type: 'chat',
                    quantization: 'q4_0',
                    state: 'loaded',
                    max_context_length: 4096
                },
                {
                    id: 'test-embedding-model',
                    object: 'model',
                    type: 'embeddings',
                    publisher: 'test',
                    arch: 'transformer',
                    compatibility_type: 'embedding',
                    quantization: 'fp16',
                    state: 'loaded',
                    max_context_length: 512
                }
            ]
        };

        const mockChatResponse = {
            id: 'chat-123',
            object: 'chat.completion',
            created: Date.now(),
            model: 'test-chat-model',
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: 'Hello! How can I help you?'
                },
                finish_reason: 'stop'
            }],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 8,
                total_tokens: 18
            },
            stats: {
                tokens_per_second: 25.5,
                time_to_first_token: 100,
                generation_time: 314,
                stop_reason: 'stop'
            },
            model_info: {
                id: 'test-chat-model',
                arch: 'transformer',
                context_length: 4096
            }
        };

        test('should perform chat completion', async () => {
            mockResponses['/v1/models'] = { data: mockModelsResponse };
            mockResponses['/v1/chat/completions'] = { data: mockChatResponse };
            
            const request = new ChatCompletionRequest('test-chat-model', [
                { role: 'user', content: 'Hello' }
            ]);
            
            const response = await client.chatCompletion(request);
            assert.strictEqual(response.model, 'test-chat-model');
            assert.strictEqual(response.getContent(), 'Hello! How can I help you?');
        });

        test('should validate chat model compatibility', async () => {
            mockResponses['/v1/models'] = { data: mockModelsResponse };
            
            const request = new ChatCompletionRequest('test-embedding-model', [
                { role: 'user', content: 'Hello' }
            ]);
            
            await assert.rejects(
                () => client.chatCompletion(request),
                ModelError
            );
        });

        test('should perform text completion', async () => {
            mockResponses['/v1/models'] = { data: mockModelsResponse };
            mockResponses['/v1/completions'] = {
                data: {
                    id: 'completion-123',
                    object: 'text_completion',
                    created: Date.now(),
                    model: 'test-chat-model',
                    choices: [{
                        index: 0,
                        text: ' world!',
                        finish_reason: 'stop'
                    }],
                    usage: {
                        prompt_tokens: 5,
                        completion_tokens: 2,
                        total_tokens: 7
                    },
                    stats: {
                        tokens_per_second: 30.0,
                        time_to_first_token: 80,
                        generation_time: 67,
                        stop_reason: 'stop'
                    },
                    model_info: {
                        id: 'test-chat-model',
                        arch: 'transformer',
                        context_length: 4096
                    }
                }
            };
            
            const request = new CompletionRequest('test-chat-model', 'Hello');
            const response = await client.textCompletion(request);
            
            assert.strictEqual(response.model, 'test-chat-model');
            assert.strictEqual(response.getText(), ' world!');
        });

        test('should generate embeddings', async () => {
            mockResponses['/v1/models'] = { data: mockModelsResponse };
            mockResponses['/v1/embeddings'] = {
                data: {
                    object: 'embedding',
                    data: [{
                        object: 'embedding',
                        embedding: [0.1, 0.2, 0.3, -0.1, -0.2],
                        index: 0
                    }],
                    model: 'test-embedding-model',
                    usage: {
                        prompt_tokens: 5,
                        completion_tokens: 0,
                        total_tokens: 5
                    }
                }
            };
            
            const request = new EmbeddingRequest('test-embedding-model', 'Hello world');
            const response = await client.generateEmbeddings(request);
            
            assert.strictEqual(response.model, 'test-embedding-model');
            const embeddings = response.getEmbeddings();
            assert.strictEqual(embeddings.length, 1);
            assert.strictEqual(embeddings[0].length, 5);
        });

        test('should validate embedding model compatibility', async () => {
            mockResponses['/v1/models'] = { data: mockModelsResponse };
            
            const request = new EmbeddingRequest('test-chat-model', 'Hello world');
            
            await assert.rejects(
                () => client.generateEmbeddings(request),
                ModelError
            );
        });

        test('should handle streaming chat completion', async () => {
            mockResponses['/v1/models'] = { data: mockModelsResponse };
            
            const streamData = [
                { value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'), done: false },
                { value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":" world"}}]}\n\n'), done: false },
                { value: new TextEncoder().encode('data: [DONE]\n\n'), done: false },
                { done: true }
            ];
            
            mockResponses['/v1/chat/completions'] = {
                stream: streamData
            };
            
            const chunks = [];
            const request = new ChatCompletionRequest('test-chat-model', [
                { role: 'user', content: 'Hello' }
            ]);
            
            await client.streamChatCompletion(request, (chunk) => {
                chunks.push(chunk);
            });
            
            assert.strictEqual(chunks.length, 2);
            assert.strictEqual(chunks[0].choices[0].delta.content, 'Hello');
            assert.strictEqual(chunks[1].choices[0].delta.content, ' world');
        });

        test('should skip model validation when requested', async () => {
            // Don't set up models response - should not be called
            mockResponses['/v1/chat/completions'] = { data: mockChatResponse };
            
            const request = new ChatCompletionRequest('any-model', [
                { role: 'user', content: 'Hello' }
            ]);
            
            const response = await client.chatCompletion(request, { validateModel: false });
            assert.strictEqual(response.getContent(), 'Hello! How can I help you?');
        });
    });
});