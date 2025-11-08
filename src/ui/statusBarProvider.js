/**
 * @fileoverview Status bar provider for LM Studio extension
 * Manages status bar display showing current model, connection status, and performance metrics
 */

const vscode = require('vscode');
const { EventEmitter } = require('events');

/**
 * Status bar provider for displaying LM Studio connection and model information
 * @class
 */
class StatusBarProvider extends EventEmitter {
    /**
     * Create a StatusBarProvider instance
     * @param {ConfigurationManager} configManager - Configuration manager instance
     * @param {LocalLLMClient} client - LM Studio client instance
     */
    constructor(configManager, client) {
        super();
        this.configManager = configManager;
        this.client = client;
        this.statusBarItem = null;
        this.disposables = [];
        this.currentModel = null;
        this.connectionStatus = 'disconnected';
        this.performanceMetrics = null;
        this.isOperationInProgress = false;
        
        // Connection status tracking
        this.lastHealthCheck = null;
        this.healthCheckInterval = null;
    }

    /**
     * Initialize and register the status bar provider
     * @param {vscode.ExtensionContext} context - Extension context
     */
    register(context) {
        // Create status bar item
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right, 
            100
        );
        
        // Set initial state
        this.updateStatusBar();
        this.statusBarItem.show();
        
        // Register disposables
        context.subscriptions.push(this.statusBarItem);
        this.disposables.push(this.statusBarItem);
        
        // Listen for configuration changes
        this.disposables.push(
            this.configManager.onConfigurationChanged(this.onConfigurationChanged.bind(this))
        );
        
        // Start health check monitoring
        this.startHealthCheckMonitoring();
        
        // Initial connection check
        this.checkConnectionStatus();
    }

    /**
     * Update the current active model
     * @param {Object|null} model - Model object or null if no model active
     */
    setActiveModel(model) {
        const previousModel = this.currentModel;
        this.currentModel = model;
        
        if (this.hasModelChanged(previousModel, model)) {
            this.updateStatusBar();
            this.emit('activeModelChanged', model);
        }
    }

    /**
     * Update connection status
     * @param {'connected'|'disconnected'|'checking'|'error'} status - Connection status
     */
    setConnectionStatus(status) {
        if (this.connectionStatus !== status) {
            this.connectionStatus = status;
            this.updateStatusBar();
            this.emit('connectionStatusChanged', status);
        }
    }

    /**
     * Update performance metrics from last operation
     * @param {Object} metrics - Performance metrics object
     * @param {number} metrics.tokensPerSecond - Tokens generated per second
     * @param {number} metrics.generationTime - Total generation time in ms
     * @param {number} metrics.timeToFirstToken - Time to first token in ms
     */
    setPerformanceMetrics(metrics) {
        this.performanceMetrics = {
            tokensPerSecond: metrics.tokensPerSecond || 0,
            generationTime: metrics.generationTime || 0,
            timeToFirstToken: metrics.timeToFirstToken || 0,
            timestamp: Date.now()
        };
        
        this.updateStatusBar();
        this.emit('performanceMetricsUpdated', this.performanceMetrics);
    }

    /**
     * Set operation in progress status
     * @param {boolean} inProgress - Whether an AI operation is in progress
     * @param {string} [operationType] - Type of operation (chat, completion, embedding)
     */
    setOperationInProgress(inProgress, operationType = null) {
        this.isOperationInProgress = inProgress;
        this.operationType = operationType;
        this.updateStatusBar();
        
        if (inProgress) {
            this.emit('operationStarted', operationType);
        } else {
            this.emit('operationCompleted', operationType);
        }
    }

    /**
     * Get current status information
     * @returns {Object} Current status object
     */
    getStatus() {
        return {
            connectionStatus: this.connectionStatus,
            currentModel: this.currentModel,
            performanceMetrics: this.performanceMetrics,
            isOperationInProgress: this.isOperationInProgress,
            operationType: this.operationType,
            lastHealthCheck: this.lastHealthCheck
        };
    }

    /**
     * Manually trigger connection status check
     * @returns {Promise<boolean>} Connection status
     */
    async checkConnectionStatus() {
        this.setConnectionStatus('checking');
        
        try {
            const isHealthy = await this.client.checkHealth();
            this.setConnectionStatus(isHealthy ? 'connected' : 'disconnected');
            this.lastHealthCheck = new Date();
            return isHealthy;
        } catch (error) {
            this.setConnectionStatus('error');
            this.lastHealthCheck = new Date();
            return false;
        }
    }

    /**
     * Update the status bar display
     * @private
     */
    updateStatusBar() {
        if (!this.statusBarItem) {
            return;
        }

        const { text, tooltip, command } = this.buildStatusBarContent();
        
        this.statusBarItem.text = text;
        this.statusBarItem.tooltip = tooltip;
        this.statusBarItem.command = command;
    }

    /**
     * Build status bar content based on current state
     * @private
     * @returns {Object} Status bar content object
     */
    buildStatusBarContent() {
        // Handle operation in progress
        if (this.isOperationInProgress) {
            return {
                text: `$(loading~spin) ${this.operationType || 'AI Operation'}...`,
                tooltip: `Local LLM: ${this.operationType || 'Operation'} in progress`,
                command: null // Disable clicking during operations
            };
        }

        // Handle different connection states
        switch (this.connectionStatus) {
            case 'checking':
                return {
                    text: '$(loading~spin) Local LLM: Checking...',
                    tooltip: 'Checking connection to Local LLM server server',
                    command: null
                };

            case 'error':
                const errorConfig = this.configManager.getConfiguration();
                return {
                    text: '$(error) Local LLM: Error',
                    tooltip: `Connection error to ${errorConfig.serverUrl}\n\nTroubleshooting:\n• Check if your AI server is running\n• Verify server URL in settings\n• Check firewall/antivirus settings\n• Try restarting your AI server\n\nClick to retry connection`,
                    command: 'lmstudio.testConnection'
                };

            case 'disconnected':
                const config = this.configManager.getConfiguration();
                return {
                    text: '$(circle-slash) Local LLM: Disconnected',
                    tooltip: `Not connected to Local LLM server\n\nServer: ${config.serverUrl}\n\nMake sure:\n• your AI server is running\n• Local Server is started\n• Port ${new URL(config.serverUrl).port || '1234'} is correct\n\nClick to test connection`,
                    command: 'lmstudio.testConnection'
                };

            case 'connected':
                if (this.currentModel) {
                    const modelText = this.formatModelName(this.currentModel.id);
                    const performanceText = this.formatPerformanceMetrics();
                    
                    return {
                        text: `$(robot) ${modelText}${performanceText}`,
                        tooltip: this.buildConnectedTooltip(),
                        command: 'lmstudio.quickModelSwitch'
                    };
                } else {
                    return {
                        text: '$(robot) Local LLM: No Model',
                        tooltip: 'Connected to Local LLM server - Click to select a model',
                        command: 'lmstudio.selectModel'
                    };
                }

            default:
                return {
                    text: '$(question) Local LLM: Unknown',
                    tooltip: 'Unknown status - Click to check connection',
                    command: 'lmstudio.testConnection'
                };
        }
    }

    /**
     * Format model name for display
     * @private
     * @param {string} modelId - Full model ID
     * @returns {string} Formatted model name
     */
    formatModelName(modelId) {
        // Extract a shorter, more readable name from the model ID
        if (!modelId) {
            return 'Unknown';
        }

        // Remove common prefixes and suffixes
        let name = modelId
            .replace(/^.*\//, '') // Remove path-like prefixes
            .replace(/\.gguf$/, '') // Remove .gguf extension
            .replace(/-q\d+_\d+/i, '') // Remove quantization suffixes like -q4_0
            .replace(/-\d+b/i, '') // Remove size suffixes like -7b
            .replace(/_/g, ' '); // Replace underscores with spaces

        // Limit length for status bar
        if (name.length > 20) {
            name = name.substring(0, 17) + '...';
        }

        return name;
    }

    /**
     * Format performance metrics for status bar
     * @private
     * @returns {string} Formatted performance text
     */
    formatPerformanceMetrics() {
        if (!this.performanceMetrics) {
            return '';
        }

        const { tokensPerSecond } = this.performanceMetrics;
        
        // Only show if metrics are recent (within last 30 seconds)
        const age = Date.now() - this.performanceMetrics.timestamp;
        if (age > 30000) {
            return '';
        }

        if (tokensPerSecond > 0) {
            return ` (${tokensPerSecond.toFixed(1)} t/s)`;
        }

        return '';
    }

    /**
     * Build detailed tooltip for connected state
     * @private
     * @returns {string} Tooltip text
     */
    buildConnectedTooltip() {
        const config = this.configManager.getConfiguration();
        let tooltip = `Connected to ${config.serverUrl}\n`;
        
        if (this.currentModel) {
            tooltip += `Active Model: ${this.currentModel.id}\n`;
            
            if (this.currentModel.arch) {
                tooltip += `Architecture: ${this.currentModel.arch}\n`;
            }
            
            if (this.currentModel.quantization) {
                tooltip += `Quantization: ${this.currentModel.quantization}\n`;
            }
            
            if (this.currentModel.max_context_length) {
                tooltip += `Context Length: ${this.currentModel.max_context_length.toLocaleString()}\n`;
            }
        }
        
        if (this.performanceMetrics) {
            const { tokensPerSecond, generationTime, timeToFirstToken } = this.performanceMetrics;
            tooltip += '\nLast Operation Performance:\n';
            
            if (tokensPerSecond > 0) {
                tooltip += `• Speed: ${tokensPerSecond.toFixed(1)} tokens/second\n`;
            }
            
            if (generationTime > 0) {
                tooltip += `• Generation Time: ${generationTime.toFixed(0)}ms\n`;
            }
            
            if (timeToFirstToken > 0) {
                tooltip += `• Time to First Token: ${timeToFirstToken.toFixed(0)}ms\n`;
            }
        }
        
        tooltip += '\nClick to switch models';
        
        return tooltip.trim();
    }

    /**
     * Handle configuration changes
     * @private
     * @param {ExtensionConfig} config - New configuration
     */
    onConfigurationChanged(config) {
        // Update client configuration
        this.client.updateConfig({
            baseUrl: config.serverUrl,
            timeout: config.connectionSettings.timeout,
            retryAttempts: config.connectionSettings.retryAttempts
        });
        
        // Update health check interval
        this.updateHealthCheckInterval(config.connectionSettings.healthCheckInterval);
        
        // Trigger connection check with new settings
        this.checkConnectionStatus();
    }

    /**
     * Start health check monitoring
     * @private
     */
    startHealthCheckMonitoring() {
        const config = this.configManager.getConfiguration();
        this.updateHealthCheckInterval(config.connectionSettings.healthCheckInterval);
    }

    /**
     * Update health check interval
     * @private
     * @param {number} interval - Health check interval in milliseconds
     */
    updateHealthCheckInterval(interval) {
        // Clear existing interval
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
        
        // Set new interval
        this.healthCheckInterval = setInterval(() => {
            // Only check if not currently in an operation
            if (!this.isOperationInProgress && this.connectionStatus === 'connected') {
                this.checkConnectionStatus();
            }
        }, interval);
        
        this.disposables.push({
            dispose: () => {
                if (this.healthCheckInterval) {
                    clearInterval(this.healthCheckInterval);
                    this.healthCheckInterval = null;
                }
            }
        });
    }

    /**
     * Check if model has changed
     * @private
     * @param {Object|null} previousModel - Previous model
     * @param {Object|null} currentModel - Current model
     * @returns {boolean} True if model changed
     */
    hasModelChanged(previousModel, currentModel) {
        if (!previousModel && !currentModel) {
            return false;
        }
        
        if (!previousModel || !currentModel) {
            return true;
        }
        
        return previousModel.id !== currentModel.id;
    }

    /**
     * Dispose of the status bar provider
     */
    dispose() {
        this.disposables.forEach(disposable => {
            if (disposable && typeof disposable.dispose === 'function') {
                disposable.dispose();
            }
        });
        
        this.disposables.length = 0;
        this.removeAllListeners();
        
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }
}

module.exports = {
    StatusBarProvider
};