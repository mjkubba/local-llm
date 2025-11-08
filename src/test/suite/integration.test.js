const assert = require('assert');
const vscode = require('vscode');
const { LocalLLMClient } = require('../../services/localLLMClient');
const { ConfigurationManager } = require('../../config/configManager');

/**
 * Integration tests for full user workflows
 * These tests simulate real user interactions with the extension
 */
suite('Integration Test Suite', () => {
    let client;
    let configManager;
    
    setup(async () => {
        // Initialize services
        configManager = new ConfigurationManager();
        client = new LocalLLMClient();
        
        // Mock VS Code configuration
        const mockConfig = {
            get: (key) => {
                const defaults = {
                    'lmstudio.serverUrl': 'http://localhost:1234',
                    'lmstudio.defaultModel': '',
                    'lmstudio.chatSettings.temperature': 0.7,
                    'lmstudio.chatSettings.maxTokens': 1000,
                    'lmstudio.chatSettings.systemPrompt': 'You are a helpful AI assistant.',
                    'lmstudio.completionSettings.temperature': 0.3,
                    'lmstudio.completionSettings.maxTokens': 500,
                    'lmstudio.connectionSettings.timeout': 30000,
                    'lmstudio.connectionSettings.retryAttempts': 3
                };
                return defaults[key];
            },
            update: async () => {},
            inspect: () => ({ defaultValue: undefined })
        };
        
        // Mock vscode.workspace.getConfiguration
        const originalGetConfiguration = vscode.workspace.getConfiguration;
        vscode.workspace.getConfiguration = () => mockConfig;
        
        // Restore after test
        this.restoreGetConfiguration = () => {
            vscode.workspace.getConfiguration = originalGetConfiguration;
        };
    });
    
    teardown(() => {
        if (this.restoreGetConfiguration) {
            this.restoreGetConfiguration();
        }
    });

    suite('Extension Activation Workflow', () => {
        test('should activate extension and initialize services', async () => {
            // Get the extension
            const extension = vscode.extensions.getExtension('kiro.lmstudio-kiro-extension');
            
            if (extension) {
                // Activate the extension
                await extension.activate();
                
                // Verify extension is active
                assert.strictEqual(extension.isActive, true);
                
                // Verify commands are registered
                const commands = await vscode.commands.getCommands();
                const lmStudioCommands = commands.filter(cmd => cmd.startsWith('lmstudio.'));
                
                assert(lmStudioCommands.length > 0, 'LM Studio commands should be registered');
                assert(lmStudioCommands.includes('lmstudio.openChat'), 'Chat command should be registered');
                assert(lmStudioCommands.includes('lmstudio.listModels'), 'List models command should be registered');
            }
        });
    });

    suite('Model Management Workflow', () => {
        test('should complete full model selection workflow', async () => {
            // Mock successful model response
            global.fetch = async (url) => {
                if (url.includes('/v1/models')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            data: [
                                {
                                    id: 'llama-2-7b-chat',
                                    object: 'model',
                                    type: 'llm',
                                    publisher: 'meta',
                                    arch: 'llama',
                                    compatibility_type: 'chat',
                                    quantization: 'q4_0',
                                    state: 'loaded',
                                    max_context_length: 4096
                                }
                            ]
                        })
                    };
                }
                return { ok: false, status: 404 };
            };
            
            // 1. Check connection
            const isHealthy = await client.checkHealth();
            assert.strictEqual(isHealthy, true, 'Should connect to LM Studio');
            
            // 2. Get available models
            const models = await client.getModels();
            assert.strictEqual(models.length, 1, 'Should retrieve models');
            assert.strictEqual(models[0].id, 'llama-2-7b-chat', 'Should get correct model');
            
            // 3. Select model (simulate user selection)
            const selectedModel = models[0];
            assert.strictEqual(selectedModel.state, 'loaded', 'Selected model should be loaded');
            
            // 4. Verify model is suitable for chat
            const chatModels = await client.getChatModels();
            assert.strictEqual(chatModels.length, 1, 'Should have chat-capable models');
        });

        test('should handle model loading workflow', async () => {
            // Mock model that needs loading
            global.fetch = async (url) => {
                if (url.includes('/v1/models')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            data: [
                                {
                                    id: 'unloaded-model',
                                    object: 'model',
                                    type: 'llm',
                                    state: 'not-loaded',
                                    max_context_length: 2048
                                }
                            ]
                        })
                    };
                }
                return { ok: false, status: 404 };
            };
            
            const models = await client.getModels();
            const unloadedModel = models[0];
            
            assert.strictEqual(unloadedModel.state, 'not-loaded', 'Model should be unloaded');
            
            const isLoaded = await client.isModelLoaded(unloadedModel.id);
            assert.strictEqual(isLoaded, false, 'Should detect unloaded model');
            
            const loadedModels = await client.getLoadedModels();
            assert.strictEqual(loadedModels.length, 0, 'Should have no loaded models');
        });
    });

    suite('Chat Workflow', () => {
        test('should complete full chat interaction workflow', async () => {
            // Mock responses for chat workflow
            global.fetch = async (url, options) => {
                if (url.includes('/v1/models')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            data: [{
                                id: 'chat-model',
                                type: 'llm',
                                compatibility_type: 'chat',
                                state: 'loaded',
                                max_context_length: 4096
                            }]
                        })
                    };
                }
                
                if (url.includes('/v1/chat/completions')) {
                    const body = JSON.parse(options.body);
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            id: 'chat-123',
                            object: 'chat.completion',
                            model: body.model,
                            choices: [{
                                message: {
                                    role: 'assistant',
                                    content: `I received your message: "${body.messages[body.messages.length - 1].content}"`
                                },
                                finish_reason: 'stop'
                            }],
                            usage: { total_tokens: 20 },
                            stats: { tokens_per_second: 25.0 }
                        })
                    };
                }
                
                return { ok: false, status: 404 };
            };
            
            // 1. Verify model availability
            const models = await client.getChatModels();
            assert(models.length > 0, 'Should have chat models available');
            
            // 2. Create chat request
            const { ChatCompletionRequest } = require('../../models/apiModels');
            const request = new ChatCompletionRequest(models[0].id, [
                { role: 'user', content: 'Hello, can you help me with coding?' }
            ]);
            
            // 3. Send chat message
            const response = await client.chatCompletion(request);
            
            // 4. Verify response
            assert(response.getContent().includes('Hello, can you help me with coding?'), 'Should echo user message');
            assert(response.stats.tokens_per_second > 0, 'Should have performance stats');
        });

        test('should handle chat with system prompt', async () => {
            global.fetch = async (url, options) => {
                if (url.includes('/v1/models')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            data: [{
                                id: 'chat-model',
                                type: 'llm',
                                compatibility_type: 'chat',
                                state: 'loaded'
                            }]
                        })
                    };
                }
                
                if (url.includes('/v1/chat/completions')) {
                    const body = JSON.parse(options.body);
                    const hasSystemPrompt = body.messages.some(msg => msg.role === 'system');
                    
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            choices: [{
                                message: {
                                    role: 'assistant',
                                    content: hasSystemPrompt ? 'System prompt received' : 'No system prompt'
                                }
                            }]
                        })
                    };
                }
                
                return { ok: false, status: 404 };
            };
            
            const { ChatCompletionRequest } = require('../../models/apiModels');
            const request = new ChatCompletionRequest('chat-model', [
                { role: 'system', content: 'You are a helpful coding assistant.' },
                { role: 'user', content: 'Help me write a function.' }
            ]);
            
            const response = await client.chatCompletion(request);
            assert.strictEqual(response.getContent(), 'System prompt received', 'Should handle system prompt');
        });
    });

    suite('Code Completion Workflow', () => {
        test('should complete code generation workflow', async () => {
            global.fetch = async (url, options) => {
                if (url.includes('/v1/models')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            data: [{
                                id: 'code-model',
                                type: 'llm',
                                state: 'loaded'
                            }]
                        })
                    };
                }
                
                if (url.includes('/v1/completions')) {
                    const body = JSON.parse(options.body);
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            choices: [{
                                text: `\\nfunction ${body.prompt.includes('sort') ? 'sortArray' : 'processData'}() {\\n    // Implementation here\\n}`
                            }]
                        })
                    };
                }
                
                return { ok: false, status: 404 };
            };
            
            const { CompletionRequest } = require('../../models/apiModels');
            const request = new CompletionRequest('code-model', 'Write a JavaScript function to sort an array:');
            
            const response = await client.textCompletion(request);
            const generatedCode = response.getText();
            
            assert(generatedCode.includes('function'), 'Should generate function');
            assert(generatedCode.includes('sortArray'), 'Should generate relevant function name');
        });
    });

    suite('Error Recovery Workflow', () => {
        test('should handle connection loss and recovery', async () => {
            let connectionAttempts = 0;
            
            global.fetch = async () => {
                connectionAttempts++;
                if (connectionAttempts <= 2) {
                    throw new Error('ECONNREFUSED');
                }
                
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ data: [] })
                };
            };
            
            // Should retry and eventually succeed
            const isHealthy = await client.checkHealth();
            assert.strictEqual(isHealthy, true, 'Should recover from connection issues');
            assert(connectionAttempts >= 3, 'Should have retried connection');
        });

        test('should handle model unavailability gracefully', async () => {
            global.fetch = async (url) => {
                if (url.includes('/v1/models')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({ data: [] }) // No models available
                    };
                }
                return { ok: false, status: 404 };
            };
            
            const models = await client.getModels();
            assert.strictEqual(models.length, 0, 'Should handle no models gracefully');
            
            const chatModels = await client.getChatModels();
            assert.strictEqual(chatModels.length, 0, 'Should handle no chat models gracefully');
        });
    });

    suite('Configuration Workflow', () => {
        test('should handle configuration changes', async () => {
            // Test initial configuration
            const initialConfig = configManager.getConfig();
            assert.strictEqual(initialConfig.serverUrl, 'http://localhost:1234');
            
            // Test configuration update
            const newConfig = {
                serverUrl: 'http://localhost:8080',
                timeout: 15000
            };
            
            client.updateConfig(newConfig);
            
            const status = client.getStatus();
            assert.strictEqual(status.baseUrl, 'http://localhost:8080');
            assert.strictEqual(status.timeout, 15000);
        });

        test('should validate configuration values', async () => {
            const { ValidationError } = require('../../models/errors');
            
            // Test invalid URL
            assert.throws(() => {
                client.updateConfig({ baseUrl: 'invalid-url' });
            }, ValidationError);
            
            // Test invalid timeout
            assert.throws(() => {
                client.updateConfig({ timeout: -1 });
            }, ValidationError);
        });
    });

    suite('Performance Workflow', () => {
        test('should track performance metrics', async () => {
            global.fetch = async (url, options) => {
                if (url.includes('/v1/models')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            data: [{
                                id: 'perf-model',
                                type: 'llm',
                                compatibility_type: 'chat',
                                state: 'loaded'
                            }]
                        })
                    };
                }
                
                if (url.includes('/v1/chat/completions')) {
                    // Simulate processing time
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            choices: [{ message: { role: 'assistant', content: 'Response' } }],
                            usage: { total_tokens: 15 },
                            stats: {
                                tokens_per_second: 30.5,
                                time_to_first_token: 50,
                                generation_time: 492
                            }
                        })
                    };
                }
                
                return { ok: false, status: 404 };
            };
            
            const { ChatCompletionRequest } = require('../../models/apiModels');
            const request = new ChatCompletionRequest('perf-model', [
                { role: 'user', content: 'Test performance' }
            ]);
            
            const startTime = Date.now();
            const response = await client.chatCompletion(request);
            const endTime = Date.now();
            
            // Verify performance metrics are captured
            assert(response.stats.tokens_per_second > 0, 'Should have tokens per second');
            assert(response.stats.generation_time > 0, 'Should have generation time');
            assert(endTime - startTime >= 100, 'Should respect actual processing time');
        });
    });

    suite('Embedding Workflow', () => {
        test('should complete embedding generation workflow', async () => {
            global.fetch = async (url, options) => {
                if (url.includes('/v1/models')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            data: [{
                                id: 'embedding-model',
                                type: 'embeddings',
                                compatibility_type: 'embedding',
                                state: 'loaded'
                            }]
                        })
                    };
                }
                
                if (url.includes('/v1/embeddings')) {
                    const body = JSON.parse(options.body);
                    const inputs = Array.isArray(body.input) ? body.input : [body.input];
                    
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            object: 'list',
                            data: inputs.map((input, index) => ({
                                object: 'embedding',
                                embedding: Array.from({ length: 384 }, () => Math.random()),
                                index
                            })),
                            model: body.model,
                            usage: { total_tokens: inputs.length * 10 }
                        })
                    };
                }
                
                return { ok: false, status: 404 };
            };
            
            const { EmbeddingRequest } = require('../../models/apiModels');
            
            // Test single text embedding
            const singleRequest = new EmbeddingRequest('embedding-model', 'Hello world');
            const singleResponse = await client.generateEmbeddings(singleRequest);
            
            assert.strictEqual(singleResponse.data.length, 1, 'Should generate one embedding');
            assert.strictEqual(singleResponse.data[0].embedding.length, 384, 'Should have correct dimensions');
            
            // Test batch embedding
            const batchRequest = new EmbeddingRequest('embedding-model', ['Text 1', 'Text 2', 'Text 3']);
            const batchResponse = await client.generateEmbeddings(batchRequest);
            
            assert.strictEqual(batchResponse.data.length, 3, 'Should generate three embeddings');
            assert(batchResponse.usage.total_tokens > 0, 'Should have token usage');
        });
    });

    suite('Streaming Workflow', () => {
        test('should handle streaming chat completions', async () => {
            const chunks = [];
            let streamComplete = false;
            
            global.fetch = async (url, options) => {
                if (url.includes('/v1/models')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            data: [{
                                id: 'stream-model',
                                type: 'llm',
                                compatibility_type: 'chat',
                                state: 'loaded'
                            }]
                        })
                    };
                }
                
                if (url.includes('/v1/chat/completions') && options.stream) {
                    // Mock streaming response
                    const mockChunks = [
                        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
                        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
                        'data: {"choices":[{"delta":{"content":"!"}}]}\n\n',
                        'data: [DONE]\n\n'
                    ];
                    
                    const stream = new ReadableStream({
                        start(controller) {
                            mockChunks.forEach((chunk, index) => {
                                setTimeout(() => {
                                    controller.enqueue(new TextEncoder().encode(chunk));
                                    if (index === mockChunks.length - 1) {
                                        controller.close();
                                    }
                                }, index * 50);
                            });
                        }
                    });
                    
                    return {
                        ok: true,
                        status: 200,
                        body: stream
                    };
                }
                
                return { ok: false, status: 404 };
            };
            
            const { ChatCompletionRequest } = require('../../models/apiModels');
            const request = new ChatCompletionRequest('stream-model', [
                { role: 'user', content: 'Say hello' }
            ]);
            
            await client.streamChatCompletion(request, (chunk) => {
                chunks.push(chunk);
            });
            
            streamComplete = true;
            
            assert(streamComplete, 'Streaming should complete');
            assert(chunks.length > 0, 'Should receive streaming chunks');
        });
    });

    suite('Multi-Model Workflow', () => {
        test('should handle switching between different model types', async () => {
            global.fetch = async (url, options) => {
                if (url.includes('/v1/models')) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            data: [
                                {
                                    id: 'chat-model',
                                    type: 'llm',
                                    compatibility_type: 'chat',
                                    state: 'loaded'
                                },
                                {
                                    id: 'code-model',
                                    type: 'llm',
                                    compatibility_type: 'completion',
                                    state: 'loaded'
                                },
                                {
                                    id: 'embed-model',
                                    type: 'embeddings',
                                    compatibility_type: 'embedding',
                                    state: 'loaded'
                                }
                            ]
                        })
                    };
                }
                
                if (url.includes('/v1/chat/completions')) {
                    const body = JSON.parse(options.body);
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            choices: [{ message: { role: 'assistant', content: `Chat response from ${body.model}` } }],
                            usage: { total_tokens: 10 }
                        })
                    };
                }
                
                if (url.includes('/v1/completions')) {
                    const body = JSON.parse(options.body);
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            choices: [{ text: `Completion from ${body.model}` }],
                            usage: { total_tokens: 8 }
                        })
                    };
                }
                
                if (url.includes('/v1/embeddings')) {
                    const body = JSON.parse(options.body);
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            object: 'list',
                            data: [{ object: 'embedding', embedding: [0.1, 0.2, 0.3], index: 0 }],
                            model: body.model,
                            usage: { total_tokens: 5 }
                        })
                    };
                }
                
                return { ok: false, status: 404 };
            };
            
            const { ChatCompletionRequest, CompletionRequest, EmbeddingRequest } = require('../../models/apiModels');
            
            // Test chat model
            const chatRequest = new ChatCompletionRequest('chat-model', [
                { role: 'user', content: 'Hello' }
            ]);
            const chatResponse = await client.chatCompletion(chatRequest);
            assert(chatResponse.getContent().includes('chat-model'), 'Should use chat model');
            
            // Test completion model
            const completionRequest = new CompletionRequest('code-model', 'def hello():');
            const completionResponse = await client.textCompletion(completionRequest);
            assert(completionResponse.getText().includes('code-model'), 'Should use completion model');
            
            // Test embedding model
            const embeddingRequest = new EmbeddingRequest('embed-model', 'Hello world');
            const embeddingResponse = await client.generateEmbeddings(embeddingRequest);
            assert.strictEqual(embeddingResponse.model, 'embed-model', 'Should use embedding model');
        });
    });
});