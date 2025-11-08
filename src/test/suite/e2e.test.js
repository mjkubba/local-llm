const assert = require('assert');
const vscode = require('vscode');
const http = require('http');
const { LocalLLMClient } = require('../../services/localLLMClient');
const { ChatCompletionRequest, CompletionRequest, EmbeddingRequest } = require('../../models/apiModels');

/**
 * End-to-end tests with mock LM Studio server
 * These tests simulate real server interactions
 */
suite('End-to-End Test Suite', () => {
    let mockServer;
    let serverPort;
    let client;
    
    // Mock LM Studio server responses
    const mockModels = [
        {
            id: 'llama-2-7b-chat.q4_0.gguf',
            object: 'model',
            type: 'llm',
            publisher: 'meta-llama',
            arch: 'llama',
            compatibility_type: 'chat',
            quantization: 'q4_0',
            state: 'loaded',
            max_context_length: 4096
        },
        {
            id: 'code-llama-7b.q4_0.gguf',
            object: 'model',
            type: 'llm',
            publisher: 'meta-llama',
            arch: 'llama',
            compatibility_type: 'completion',
            quantization: 'q4_0',
            state: 'loaded',
            max_context_length: 16384
        },
        {
            id: 'all-minilm-l6-v2.gguf',
            object: 'model',
            type: 'embeddings',
            publisher: 'sentence-transformers',
            arch: 'transformer',
            compatibility_type: 'embedding',
            quantization: 'fp16',
            state: 'loaded',
            max_context_length: 512
        }
    ];

    setup(async () => {
        // Find available port
        serverPort = await findAvailablePort(3000);
        
        // Create mock LM Studio server
        mockServer = http.createServer((req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }
            
            const url = new URL(req.url, `http://localhost:${serverPort}`);
            
            // Handle different endpoints
            if (url.pathname === '/v1/models' && req.method === 'GET') {
                handleModelsRequest(res);
            } else if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
                handleChatRequest(req, res);
            } else if (url.pathname === '/v1/completions' && req.method === 'POST') {
                handleCompletionRequest(req, res);
            } else if (url.pathname === '/v1/embeddings' && req.method === 'POST') {
                handleEmbeddingRequest(req, res);
            } else {
                res.writeHead(404);
                res.end(JSON.stringify({ error: { message: 'Not found' } }));
            }
        });
        
        // Start server
        await new Promise((resolve) => {
            mockServer.listen(serverPort, 'localhost', resolve);
        });
        
        // Create client pointing to mock server
        client = new LocalLLMClient(`http://localhost:${serverPort}`);
    });

    teardown(async () => {
        if (mockServer) {
            await new Promise((resolve) => {
                mockServer.close(resolve);
            });
        }
    });

    // Helper functions for mock server
    function handleModelsRequest(res) {
        res.writeHead(200);
        res.end(JSON.stringify({ data: mockModels }));
    }

    function handleChatRequest(req, res) {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const request = JSON.parse(body);
                const response = {
                    id: 'chat-' + Date.now(),
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model: request.model,
                    choices: [{
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: `Echo: ${request.messages[request.messages.length - 1].content}`
                        },
                        finish_reason: 'stop'
                    }],
                    usage: {
                        prompt_tokens: 10,
                        completion_tokens: 15,
                        total_tokens: 25
                    },
                    stats: {
                        tokens_per_second: 25.5,
                        time_to_first_token: 45,
                        generation_time: 588,
                        stop_reason: 'stop'
                    },
                    model_info: {
                        id: request.model,
                        arch: 'llama',
                        context_length: 4096
                    }
                };
                
                res.writeHead(200);
                res.end(JSON.stringify(response));
            } catch (error) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: { message: 'Invalid JSON' } }));
            }
        });
    }

    function handleCompletionRequest(req, res) {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const request = JSON.parse(body);
                const response = {
                    id: 'comp-' + Date.now(),
                    object: 'text_completion',
                    created: Math.floor(Date.now() / 1000),
                    model: request.model,
                    choices: [{
                        index: 0,
                        text: `\n\nCompleted: ${request.prompt}`,
                        finish_reason: 'stop'
                    }],
                    usage: {
                        prompt_tokens: 8,
                        completion_tokens: 12,
                        total_tokens: 20
                    },
                    stats: {
                        tokens_per_second: 30.0,
                        generation_time: 400
                    },
                    model_info: {
                        id: request.model,
                        arch: 'llama',
                        context_length: 16384
                    }
                };
                
                res.writeHead(200);
                res.end(JSON.stringify(response));
            } catch (error) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: { message: 'Invalid JSON' } }));
            }
        });
    }

    function handleEmbeddingRequest(req, res) {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const request = JSON.parse(body);
                const inputs = Array.isArray(request.input) ? request.input : [request.input];
                
                const response = {
                    object: 'list',
                    data: inputs.map((input, index) => ({
                        object: 'embedding',
                        embedding: Array.from({ length: 384 }, () => Math.random() - 0.5),
                        index
                    })),
                    model: request.model,
                    usage: {
                        prompt_tokens: inputs.reduce((acc, input) => acc + input.length / 4, 0),
                        total_tokens: inputs.reduce((acc, input) => acc + input.length / 4, 0)
                    }
                };
                
                res.writeHead(200);
                res.end(JSON.stringify(response));
            } catch (error) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: { message: 'Invalid JSON' } }));
            }
        });
    }

    async function findAvailablePort(startPort) {
        return new Promise((resolve) => {
            const server = http.createServer();
            server.listen(startPort, () => {
                const port = server.address().port;
                server.close(() => resolve(port));
            });
        });
    }

    suite('Server Connection', () => {
        test('should connect to mock LM Studio server', async () => {
            const isHealthy = await client.checkHealth();
            assert.strictEqual(isHealthy, true, 'Should connect to mock server');
        });

        test('should handle server unavailable', async () => {
            // Create client with wrong port
            const badClient = new LocalLLMClient('http://localhost:9999');
            const isHealthy = await badClient.checkHealth();
            assert.strictEqual(isHealthy, false, 'Should detect unavailable server');
        });
    });

    suite('Model Management E2E', () => {
        test('should retrieve and parse models correctly', async () => {
            const models = await client.getModels();
            
            assert.strictEqual(models.length, 3, 'Should retrieve all mock models');
            
            const chatModel = models.find(m => m.id === 'llama-2-7b-chat.q4_0.gguf');
            assert(chatModel, 'Should find chat model');
            assert.strictEqual(chatModel.type, 'llm', 'Chat model should be LLM type');
            assert.strictEqual(chatModel.state, 'loaded', 'Chat model should be loaded');
            assert(chatModel.supportsChat(), 'Chat model should support chat');
            
            const embeddingModel = models.find(m => m.id === 'all-minilm-l6-v2.gguf');
            assert(embeddingModel, 'Should find embedding model');
            assert.strictEqual(embeddingModel.type, 'embeddings', 'Embedding model should be embeddings type');
            assert(embeddingModel.supportsEmbeddings(), 'Embedding model should support embeddings');
        });

        test('should filter models by type', async () => {
            const chatModels = await client.getChatModels();
            const embeddingModels = await client.getEmbeddingModels();
            const loadedModels = await client.getLoadedModels();
            
            assert.strictEqual(chatModels.length, 2, 'Should find 2 chat-capable models');
            assert.strictEqual(embeddingModels.length, 1, 'Should find 1 embedding model');
            assert.strictEqual(loadedModels.length, 3, 'Should find 3 loaded models');
        });

        test('should get specific model by ID', async () => {
            const model = await client.getModel('llama-2-7b-chat.q4_0.gguf');
            
            assert.strictEqual(model.id, 'llama-2-7b-chat.q4_0.gguf');
            assert.strictEqual(model.publisher, 'meta-llama');
            assert.strictEqual(model.arch, 'llama');
            assert.strictEqual(model.max_context_length, 4096);
        });

        test('should handle model not found', async () => {
            try {
                await client.getModel('nonexistent-model');
                assert.fail('Should throw error for nonexistent model');
            } catch (error) {
                assert.strictEqual(error.name, 'ModelError');
                assert.strictEqual(error.code, 'MODEL_NOT_FOUND');
            }
        });
    });

    suite('Chat Completion E2E', () => {
        test('should complete full chat workflow', async () => {
            const request = new ChatCompletionRequest('llama-2-7b-chat.q4_0.gguf', [
                { role: 'user', content: 'Hello, how are you?' }
            ]);
            
            const response = await client.chatCompletion(request);
            
            assert(response.id.startsWith('chat-'), 'Should have chat response ID');
            assert.strictEqual(response.model, 'llama-2-7b-chat.q4_0.gguf');
            assert.strictEqual(response.choices.length, 1, 'Should have one choice');
            assert(response.getContent().includes('Hello, how are you?'), 'Should echo user message');
            assert(response.usage.total_tokens > 0, 'Should have token usage');
            assert(response.stats.tokens_per_second > 0, 'Should have performance stats');
        });

        test('should handle system prompts', async () => {
            const request = new ChatCompletionRequest('llama-2-7b-chat.q4_0.gguf', [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'What is 2+2?' }
            ]);
            
            const response = await client.chatCompletion(request);
            
            assert(response.getContent().includes('What is 2+2?'), 'Should process user message');
            assert.strictEqual(response.choices[0].message.role, 'assistant');
        });

        test('should validate chat model compatibility', async () => {
            try {
                const request = new ChatCompletionRequest('all-minilm-l6-v2.gguf', [
                    { role: 'user', content: 'Hello' }
                ]);
                
                await client.chatCompletion(request);
                assert.fail('Should reject embedding model for chat');
            } catch (error) {
                assert.strictEqual(error.name, 'ModelError');
                assert.strictEqual(error.code, 'MODEL_INCOMPATIBLE_CHAT');
            }
        });
    });

    suite('Text Completion E2E', () => {
        test('should complete text generation workflow', async () => {
            const request = new CompletionRequest('code-llama-7b.q4_0.gguf', 'def fibonacci(n):');
            
            const response = await client.textCompletion(request);
            
            assert(response.id.startsWith('comp-'), 'Should have completion response ID');
            assert.strictEqual(response.model, 'code-llama-7b.q4_0.gguf');
            assert(response.getText().includes('fibonacci'), 'Should complete the function');
            assert(response.usage.total_tokens > 0, 'Should have token usage');
        });

        test('should handle completion parameters', async () => {
            const request = new CompletionRequest('code-llama-7b.q4_0.gguf', 'Write a function', {
                temperature: 0.5,
                max_tokens: 100
            });
            
            const response = await client.textCompletion(request);
            
            assert(response.getText().length > 0, 'Should generate completion');
            assert.strictEqual(response.model, 'code-llama-7b.q4_0.gguf');
        });
    });

    suite('Embeddings E2E', () => {
        test('should generate embeddings for single text', async () => {
            const request = new EmbeddingRequest('all-minilm-l6-v2.gguf', 'Hello world');
            
            const response = await client.generateEmbeddings(request);
            
            assert.strictEqual(response.object, 'list');
            assert.strictEqual(response.data.length, 1, 'Should have one embedding');
            assert.strictEqual(response.data[0].embedding.length, 384, 'Should have 384-dimensional embedding');
            assert.strictEqual(response.model, 'all-minilm-l6-v2.gguf');
        });

        test('should generate embeddings for multiple texts', async () => {
            const texts = ['Hello world', 'Goodbye world', 'How are you?'];
            const request = new EmbeddingRequest('all-minilm-l6-v2.gguf', texts);
            
            const response = await client.generateEmbeddings(request);
            
            assert.strictEqual(response.data.length, 3, 'Should have three embeddings');
            
            const embeddings = response.getEmbeddings();
            assert.strictEqual(embeddings.length, 3, 'Should extract three embedding vectors');
            embeddings.forEach((embedding, index) => {
                assert.strictEqual(embedding.length, 384, `Embedding ${index} should be 384-dimensional`);
                assert(embedding.every(val => typeof val === 'number'), `Embedding ${index} should contain numbers`);
            });
        });

        test('should validate embedding model compatibility', async () => {
            try {
                const request = new EmbeddingRequest('llama-2-7b-chat.q4_0.gguf', 'Hello');
                await client.generateEmbeddings(request);
                assert.fail('Should reject chat model for embeddings');
            } catch (error) {
                assert.strictEqual(error.name, 'ModelError');
                assert.strictEqual(error.code, 'MODEL_INCOMPATIBLE_EMBEDDINGS');
            }
        });
    });

    suite('Error Handling E2E', () => {
        test('should handle server errors gracefully', async () => {
            // Temporarily break the server
            const originalHandler = mockServer.listeners('request')[0];
            mockServer.removeAllListeners('request');
            
            mockServer.on('request', (req, res) => {
                res.writeHead(500);
                res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
            });
            
            try {
                await client.getModels();
                assert.fail('Should throw error for server error');
            } catch (error) {
                assert.strictEqual(error.name, 'ApiError');
                assert.strictEqual(error.code, 'SERVER_ERROR');
                assert.strictEqual(error.statusCode, 500);
            }
            
            // Restore original handler
            mockServer.removeAllListeners('request');
            mockServer.on('request', originalHandler);
        });

        test('should handle malformed JSON responses', async () => {
            // Temporarily break the server to return invalid JSON
            const originalHandler = mockServer.listeners('request')[0];
            mockServer.removeAllListeners('request');
            
            mockServer.on('request', (req, res) => {
                res.writeHead(200);
                res.end('invalid json{');
            });
            
            try {
                await client.getModels();
                assert.fail('Should throw error for invalid JSON');
            } catch (error) {
                assert.strictEqual(error.name, 'ApiError');
                assert.strictEqual(error.code, 'INVALID_JSON_RESPONSE');
            }
            
            // Restore original handler
            mockServer.removeAllListeners('request');
            mockServer.on('request', originalHandler);
        });

        test('should retry on connection failures', async () => {
            let attempts = 0;
            const originalHandler = mockServer.listeners('request')[0];
            mockServer.removeAllListeners('request');
            
            mockServer.on('request', (req, res) => {
                attempts++;
                if (attempts <= 2) {
                    // Simulate connection drop
                    req.destroy();
                    return;
                }
                // Success on third attempt
                originalHandler(req, res);
            });
            
            const models = await client.getModels();
            
            assert(attempts >= 3, 'Should have retried multiple times');
            assert.strictEqual(models.length, 3, 'Should eventually succeed');
            
            // Restore original handler
            mockServer.removeAllListeners('request');
            mockServer.on('request', originalHandler);
        });
    });

    suite('Performance E2E', () => {
        test('should handle concurrent requests efficiently', async () => {
            const concurrentRequests = 5;
            const startTime = Date.now();
            
            const promises = Array.from({ length: concurrentRequests }, (_, i) => {
                const request = new ChatCompletionRequest('llama-2-7b-chat.q4_0.gguf', [
                    { role: 'user', content: `Message ${i}` }
                ]);
                return client.chatCompletion(request);
            });
            
            const responses = await Promise.all(promises);
            const endTime = Date.now();
            
            assert.strictEqual(responses.length, concurrentRequests, 'Should handle all requests');
            assert(responses.every(r => r.getContent().length > 0), 'All responses should have content');
            assert(endTime - startTime < 5000, 'Concurrent requests should complete reasonably fast');
        });

        test('should maintain performance under load', async () => {
            const iterations = 10;
            const times = [];
            
            for (let i = 0; i < iterations; i++) {
                const startTime = Date.now();
                await client.getModels();
                const endTime = Date.now();
                times.push(endTime - startTime);
            }
            
            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
            const maxTime = Math.max(...times);
            
            assert(avgTime < 200, `Average response time should be reasonable (was ${avgTime}ms)`);
            assert(maxTime < 500, `Maximum response time should be acceptable (was ${maxTime}ms)`);
        });
    });

    suite('Extension Integration E2E', () => {
        test('should integrate with VS Code extension lifecycle', async () => {
            // Test that client can be used in extension context
            const extension = vscode.extensions.getExtension('kiro.lmstudio-kiro-extension');
            
            if (extension && !extension.isActive) {
                await extension.activate();
            }
            
            // Test basic functionality works in extension context
            const isHealthy = await client.checkHealth();
            assert.strictEqual(isHealthy, true, 'Should work in extension context');
            
            const models = await client.getModels();
            assert(models.length > 0, 'Should retrieve models in extension context');
        });
    });
});