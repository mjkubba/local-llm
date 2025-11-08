const assert = require('assert');
const { LocalLLMClient } = require('../../services/localLLMClient');
const { ChatCompletionRequest, CompletionRequest } = require('../../models/apiModels');

/**
 * Performance tests for API interactions
 * These tests measure response times and resource usage
 */
suite('Performance Test Suite', () => {
    let client;
    
    setup(() => {
        client = new LocalLLMClient();
        
        // Mock fast responses for performance testing
        global.fetch = async (url, options) => {
            const startTime = Date.now();
            
            // Simulate network latency
            await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
            
            if (url.includes('/v1/models')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        data: Array.from({ length: 10 }, (_, i) => ({
                            id: `model-${i}`,
                            object: 'model',
                            type: i < 8 ? 'llm' : 'embeddings',
                            compatibility_type: i < 8 ? 'chat' : 'embedding',
                            state: i < 5 ? 'loaded' : 'not-loaded',
                            max_context_length: 4096
                        }))
                    })
                };
            }
            
            if (url.includes('/v1/chat/completions')) {
                const body = JSON.parse(options.body);
                const responseTime = Date.now() - startTime;
                
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        id: 'perf-test',
                        choices: [{
                            message: {
                                role: 'assistant',
                                content: 'Performance test response'
                            }
                        }],
                        usage: {
                            prompt_tokens: body.messages.reduce((acc, msg) => acc + msg.content.length / 4, 0),
                            completion_tokens: 5,
                            total_tokens: body.messages.reduce((acc, msg) => acc + msg.content.length / 4, 0) + 5
                        },
                        stats: {
                            tokens_per_second: 25.0,
                            time_to_first_token: responseTime,
                            generation_time: responseTime + 100
                        }
                    })
                };
            }
            
            if (url.includes('/v1/completions')) {
                const responseTime = Date.now() - startTime;
                
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        choices: [{ text: 'Completion result' }],
                        usage: { total_tokens: 10 },
                        stats: {
                            tokens_per_second: 30.0,
                            generation_time: responseTime + 50
                        }
                    })
                };
            }
            
            return { ok: false, status: 404 };
        };
    });

    suite('Connection Performance', () => {
        test('should connect within acceptable time', async () => {
            const startTime = Date.now();
            const isHealthy = await client.checkHealth();
            const endTime = Date.now();
            
            assert.strictEqual(isHealthy, true, 'Should connect successfully');
            assert(endTime - startTime < 1000, 'Connection should be fast (< 1s)');
        });

        test('should handle multiple concurrent connections', async () => {
            const concurrentRequests = 5;
            const startTime = Date.now();
            
            const promises = Array.from({ length: concurrentRequests }, () => 
                client.checkHealth()
            );
            
            const results = await Promise.all(promises);
            const endTime = Date.now();
            
            assert(results.every(result => result === true), 'All connections should succeed');
            assert(endTime - startTime < 2000, 'Concurrent connections should be efficient');
        });
    });

    suite('Model Loading Performance', () => {
        test('should load model list efficiently', async () => {
            const iterations = 3;
            const times = [];
            
            for (let i = 0; i < iterations; i++) {
                const startTime = Date.now();
                const models = await client.getModels();
                const endTime = Date.now();
                
                times.push(endTime - startTime);
                assert.strictEqual(models.length, 10, 'Should load all models');
            }
            
            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
            assert(avgTime < 500, `Average model loading time should be < 500ms (was ${avgTime}ms)`);
        });

        test('should filter models efficiently', async () => {
            const startTime = Date.now();
            
            // Load models once
            const allModels = await client.getModels();
            const midTime = Date.now();
            
            // Filter operations should be fast
            const chatModels = await client.getChatModels();
            const loadedModels = await client.getLoadedModels();
            const endTime = Date.now();
            
            const loadTime = midTime - startTime;
            const filterTime = endTime - midTime;
            
            assert.strictEqual(allModels.length, 10, 'Should load all models');
            assert.strictEqual(chatModels.length, 8, 'Should filter chat models');
            assert.strictEqual(loadedModels.length, 5, 'Should filter loaded models');
            assert(filterTime < loadTime / 2, 'Filtering should be faster than loading');
        });
    });

    suite('Chat Performance', () => {
        test('should handle chat requests efficiently', async () => {
            const request = new ChatCompletionRequest('model-0', [
                { role: 'user', content: 'Hello' }
            ]);
            
            const startTime = Date.now();
            const response = await client.chatCompletion(request);
            const endTime = Date.now();
            
            const totalTime = endTime - startTime;
            
            assert(response.getContent().length > 0, 'Should get response');
            assert(totalTime < 1000, `Chat response should be fast (was ${totalTime}ms)`);
            assert(response.stats.tokens_per_second > 0, 'Should report performance stats');
        });

        test('should handle multiple chat requests', async () => {
            const requests = Array.from({ length: 3 }, (_, i) => 
                new ChatCompletionRequest('model-0', [
                    { role: 'user', content: `Message ${i}` }
                ])
            );
            
            const startTime = Date.now();
            const responses = await Promise.all(
                requests.map(req => client.chatCompletion(req))
            );
            const endTime = Date.now();
            
            const totalTime = endTime - startTime;
            
            assert.strictEqual(responses.length, 3, 'Should handle all requests');
            assert(responses.every(r => r.getContent().length > 0), 'All responses should have content');
            assert(totalTime < 2000, `Multiple requests should be efficient (was ${totalTime}ms)`);
        });

        test('should measure tokens per second accurately', async () => {
            const longMessage = 'This is a longer message that should generate more tokens and allow us to measure performance more accurately. '.repeat(10);
            
            const request = new ChatCompletionRequest('model-0', [
                { role: 'user', content: longMessage }
            ]);
            
            const response = await client.chatCompletion(request);
            
            assert(response.stats.tokens_per_second > 0, 'Should report tokens per second');
            assert(response.stats.generation_time > 0, 'Should report generation time');
            assert(response.usage.total_tokens > 50, 'Should process significant token count');
        });
    });

    suite('Completion Performance', () => {
        test('should handle text completion efficiently', async () => {
            const request = new CompletionRequest('model-0', 'Complete this text:');
            
            const startTime = Date.now();
            const response = await client.textCompletion(request);
            const endTime = Date.now();
            
            const totalTime = endTime - startTime;
            
            assert(response.getText().length > 0, 'Should get completion');
            assert(totalTime < 800, `Completion should be fast (was ${totalTime}ms)`);
        });

        test('should handle batch completions', async () => {
            const prompts = [
                'Write a function to',
                'Create a class that',
                'Implement an algorithm for'
            ];
            
            const requests = prompts.map(prompt => 
                new CompletionRequest('model-0', prompt)
            );
            
            const startTime = Date.now();
            const responses = await Promise.all(
                requests.map(req => client.textCompletion(req))
            );
            const endTime = Date.now();
            
            const totalTime = endTime - startTime;
            
            assert.strictEqual(responses.length, 3, 'Should handle all completions');
            assert(responses.every(r => r.getText().length > 0), 'All completions should have text');
            assert(totalTime < 1500, `Batch completions should be efficient (was ${totalTime}ms)`);
        });
    });

    suite('Memory Performance', () => {
        test('should not leak memory during repeated operations', async () => {
            const initialMemory = process.memoryUsage().heapUsed;
            
            // Perform many operations
            for (let i = 0; i < 50; i++) {
                await client.getModels();
                
                const request = new ChatCompletionRequest('model-0', [
                    { role: 'user', content: `Test message ${i}` }
                ]);
                await client.chatCompletion(request);
            }
            
            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }
            
            const finalMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = finalMemory - initialMemory;
            
            // Memory increase should be reasonable (< 10MB)
            assert(memoryIncrease < 10 * 1024 * 1024, 
                `Memory increase should be reasonable (was ${Math.round(memoryIncrease / 1024 / 1024)}MB)`);
        });

        test('should handle large responses efficiently', async () => {
            // Mock large response
            const originalFetch = global.fetch;
            global.fetch = async (url, options) => {
                if (url.includes('/v1/chat/completions')) {
                    const largeContent = 'This is a very long response. '.repeat(1000);
                    
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            choices: [{
                                message: {
                                    role: 'assistant',
                                    content: largeContent
                                }
                            }],
                            usage: { total_tokens: 5000 },
                            stats: { tokens_per_second: 25.0 }
                        })
                    };
                }
                return originalFetch(url, options);
            };
            
            const request = new ChatCompletionRequest('model-0', [
                { role: 'user', content: 'Generate a long response' }
            ]);
            
            const startTime = Date.now();
            const response = await client.chatCompletion(request);
            const endTime = Date.now();
            
            const totalTime = endTime - startTime;
            
            assert(response.getContent().length > 10000, 'Should handle large response');
            assert(totalTime < 2000, 'Should process large response efficiently');
            
            // Restore original fetch
            global.fetch = originalFetch;
        });
    });

    suite('Error Handling Performance', () => {
        test('should handle errors quickly', async () => {
            // Mock error response
            const originalFetch = global.fetch;
            global.fetch = async () => {
                throw new Error('Connection failed');
            };
            
            const startTime = Date.now();
            
            try {
                await client.getModels();
                assert.fail('Should have thrown error');
            } catch (error) {
                const endTime = Date.now();
                const errorTime = endTime - startTime;
                
                assert(errorTime < 500, 'Error handling should be fast');
                assert(error.message.includes('Connection failed'), 'Should preserve error message');
            }
            
            // Restore original fetch
            global.fetch = originalFetch;
        });

        test('should retry efficiently', async () => {
            let attempts = 0;
            const originalFetch = global.fetch;
            
            global.fetch = async (url, options) => {
                attempts++;
                if (attempts <= 2) {
                    throw new Error('Temporary failure');
                }
                return originalFetch(url, options);
            };
            
            const startTime = Date.now();
            const models = await client.getModels();
            const endTime = Date.now();
            
            const totalTime = endTime - startTime;
            
            assert.strictEqual(attempts, 3, 'Should retry correct number of times');
            assert(models.length > 0, 'Should eventually succeed');
            assert(totalTime < 1000, 'Retries should not take too long');
            
            // Restore original fetch
            global.fetch = originalFetch;
        });
    });

    suite('Throughput Performance', () => {
        test('should handle high request volume', async () => {
            const requestCount = 20;
            const startTime = Date.now();
            
            const promises = Array.from({ length: requestCount }, async (_, i) => {
                const request = new ChatCompletionRequest('model-0', [
                    { role: 'user', content: `Request ${i}` }
                ]);
                return client.chatCompletion(request);
            });
            
            const responses = await Promise.all(promises);
            const endTime = Date.now();
            
            const totalTime = endTime - startTime;
            const requestsPerSecond = (requestCount / totalTime) * 1000;
            
            assert.strictEqual(responses.length, requestCount, 'Should handle all requests');
            assert(requestsPerSecond > 5, `Should handle at least 5 req/sec (was ${requestsPerSecond.toFixed(2)})`);
        });

        test('should maintain consistent response times', async () => {
            const iterations = 15;
            const responseTimes = [];
            
            for (let i = 0; i < iterations; i++) {
                const startTime = Date.now();
                await client.getModels();
                const endTime = Date.now();
                responseTimes.push(endTime - startTime);
            }
            
            const avgTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
            const variance = responseTimes.reduce((acc, time) => acc + Math.pow(time - avgTime, 2), 0) / responseTimes.length;
            const stdDev = Math.sqrt(variance);
            
            assert(avgTime < 300, `Average response time should be reasonable (was ${avgTime}ms)`);
            assert(stdDev < avgTime * 0.5, `Response times should be consistent (stddev: ${stdDev}ms)`);
        });
    });

    suite('Resource Usage Performance', () => {
        test('should efficiently handle large payloads', async () => {
            // Create large message content
            const largeContent = 'This is a test message. '.repeat(500); // ~12KB
            
            const request = new ChatCompletionRequest('model-0', [
                { role: 'user', content: largeContent }
            ]);
            
            const startTime = Date.now();
            const response = await client.chatCompletion(request);
            const endTime = Date.now();
            
            const processingTime = endTime - startTime;
            
            assert(response.getContent().length > 0, 'Should handle large payload');
            assert(processingTime < 2000, `Should process large payload efficiently (was ${processingTime}ms)`);
        });

        test('should handle rapid sequential requests', async () => {
            const sequentialCount = 10;
            const times = [];
            
            for (let i = 0; i < sequentialCount; i++) {
                const startTime = Date.now();
                
                const request = new ChatCompletionRequest('model-0', [
                    { role: 'user', content: `Sequential request ${i}` }
                ]);
                
                await client.chatCompletion(request);
                const endTime = Date.now();
                times.push(endTime - startTime);
            }
            
            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
            const lastThree = times.slice(-3);
            const lastThreeAvg = lastThree.reduce((a, b) => a + b, 0) / lastThree.length;
            
            // Performance should not degrade significantly over time
            assert(lastThreeAvg <= avgTime * 1.5, 'Performance should not degrade significantly');
        });
    });

    suite('Streaming Performance', () => {
        test('should handle streaming responses efficiently', async () => {
            // Mock streaming response
            const originalFetch = global.fetch;
            global.fetch = async (url, options) => {
                if (url.includes('/v1/chat/completions') && options.stream) {
                    const chunks = Array.from({ length: 20 }, (_, i) => 
                        `data: {"choices":[{"delta":{"content":"chunk${i}"}}]}\n\n`
                    );
                    chunks.push('data: [DONE]\n\n');
                    
                    const stream = new ReadableStream({
                        start(controller) {
                            chunks.forEach((chunk, index) => {
                                setTimeout(() => {
                                    controller.enqueue(new TextEncoder().encode(chunk));
                                    if (index === chunks.length - 1) {
                                        controller.close();
                                    }
                                }, index * 10); // 10ms between chunks
                            });
                        }
                    });
                    
                    return { ok: true, status: 200, body: stream };
                }
                return originalFetch(url, options);
            };
            
            const receivedChunks = [];
            const startTime = Date.now();
            
            const request = new ChatCompletionRequest('model-0', [
                { role: 'user', content: 'Stream test' }
            ]);
            
            await client.streamChatCompletion(request, (chunk) => {
                receivedChunks.push(chunk);
            });
            
            const endTime = Date.now();
            const totalTime = endTime - startTime;
            
            assert(receivedChunks.length > 0, 'Should receive streaming chunks');
            assert(totalTime < 1000, `Streaming should be efficient (was ${totalTime}ms)`);
            
            // Restore original fetch
            global.fetch = originalFetch;
        });
    });
});