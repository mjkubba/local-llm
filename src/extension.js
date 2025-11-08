const vscode = require('vscode');
const { ConfigurationManager } = require('./config/configManager');
const { ConfigurationProvider } = require('./ui/configurationProvider');
const { CommandRegistry } = require('./commands/commandRegistry');
const { StatusBarProvider } = require('./ui/statusBarProvider');
const { ChatViewProvider } = require('./ui/chatViewProvider');
const { LocalLLMClient } = require('./services/localLLMClient');
const { loggerManager } = require('./services/logger');
const { errorHandler } = require('./services/errorHandler');
const { 
    initializeGlobalErrorBoundary, 
    disposeGlobalErrorBoundary,
    wrapWithErrorBoundary 
} = require('./services/globalErrorBoundary');
const { gracefulDegradationService } = require('./services/gracefulDegradation');
const { userGuidanceSystem } = require('./services/userGuidance');

/**
 * This method is called when your extension is activated
 * Your extension is activated the very first time the command is executed
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
    // Wrap the entire activation in error boundary
    return wrapWithErrorBoundary(async () => {
        console.log('LM Studio Kiro Extension is now active!');

        // Initialize logging system first
        loggerManager.initialize(context);
        const logger = loggerManager.getLogger('Extension');
        logger.info('Starting extension activation');

        // Initialize global error boundary
        initializeGlobalErrorBoundary();
        logger.info('Global error boundary initialized');

        try {
            // Initialize configuration management
            const configManager = new ConfigurationManager();
            await configManager.initialize();
            logger.info('Configuration manager initialized');
            
            // Initialize configuration UI provider
            const configProvider = new ConfigurationProvider(configManager);
            configProvider.register(context);
            logger.info('Configuration provider registered');
            
            // Initialize LM Studio client
            const config = configManager.getConfiguration();
            logger.info('Configuration loaded', { 
                serverUrl: config.serverUrl,
                serverUrlType: typeof config.serverUrl,
                timeout: config.connectionSettings.timeout,
                retryAttempts: config.connectionSettings.retryAttempts
            });
            
            const localLLMClient = new LocalLLMClient(config.serverUrl, {
                timeout: config.connectionSettings.timeout,
                retryAttempts: config.connectionSettings.retryAttempts
            });
            logger.info('LM Studio client initialized', { serverUrl: config.serverUrl });

            // Check initial connection to LM Studio
            const isConnected = await localLLMClient.checkHealth();
            if (!isConnected) {
                logger.warn('Could not connect to LM Studio', { serverUrl: config.serverUrl });
                
                // Show user-friendly notification
                const action = await vscode.window.showWarningMessage(
                    `Cannot connect to LM Studio at ${config.serverUrl}`,
                    'Open Settings',
                    'Help',
                    'Dismiss'
                );
                
                if (action === 'Open Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'lmstudio.serverUrl');
                } else if (action === 'Help') {
                    vscode.window.showInformationMessage(
                        'To use this extension:\n\n' +
                        '1. Download LM Studio from https://lmstudio.ai/\n' +
                        '2. Open LM Studio and go to "Local Server" tab\n' +
                        '3. Click "Start Server" (default: http://localhost:1234)\n' +
                        '4. Load at least one model\n' +
                        '5. Try the "LM Studio: Test Connection" command',
                        'Open LM Studio Website'
                    ).then(selection => {
                        if (selection === 'Open LM Studio Website') {
                            vscode.env.openExternal(vscode.Uri.parse('https://lmstudio.ai/'));
                        }
                    });
                }
            } else {
                logger.info('Successfully connected to LM Studio');
                vscode.window.showInformationMessage('LM Studio connected successfully!');
            }

            // Initialize command registry with all commands
            const commandRegistry = new CommandRegistry(configManager);
            await commandRegistry.initialize(context);
            logger.info('Command registry initialized');
            
            // Initialize status bar provider
            const statusBarProvider = new StatusBarProvider(configManager, localLLMClient);
            statusBarProvider.register(context);
            logger.info('Status bar provider registered');
            
            // Initialize chat view provider for sidebar
            const chatViewProvider = new ChatViewProvider(
                configManager,
                commandRegistry.getModelCommands(),
                localLLMClient,
                context.extensionUri
            );
            chatViewProvider.setStatusBarProvider(statusBarProvider);
            
            context.subscriptions.push(
                vscode.window.registerWebviewViewProvider(
                    'localllm.chatView',
                    chatViewProvider,
                    {
                        webviewOptions: {
                            retainContextWhenHidden: true
                        }
                    }
                )
            );
            logger.info('Chat view provider registered');
            
            // Initialize graceful degradation service
            gracefulDegradationService.initialize(localLLMClient, configManager);
            logger.info('Graceful degradation service initialized');
            
            // Connect error handler with status bar provider
            errorHandler.setStatusBarProvider(statusBarProvider);
            
            // Connect command registry with status bar provider
            commandRegistry.setStatusBarProvider(statusBarProvider);
            
            // Store instances in workspaceState (not globalState) for other components to use
            // Note: We don't use globalState.update() because these objects contain
            // circular references and timers that cannot be serialized to JSON
            // Instead, we attach them directly to the context object
            context.lmStudioExtension = {
                configManager,
                commandRegistry,
                localLLMClient,
                statusBarProvider,
                errorHandler,
                loggerManager,
                gracefulDegradationService,
                userGuidanceSystem
            };
            
            context.subscriptions.push(configManager);
            context.subscriptions.push(configProvider);
            context.subscriptions.push(commandRegistry);
            context.subscriptions.push(statusBarProvider);

            // Add cleanup for error handling systems
            context.subscriptions.push({
                dispose: () => {
                    gracefulDegradationService.dispose();
                    disposeGlobalErrorBoundary();
                    loggerManager.dispose();
                }
            });

            logger.info('LM Studio extension activated successfully');
            console.log('LM Studio extension activated successfully');
            
        } catch (error) {
            logger.error('Failed to activate LM Studio extension', error);
            console.error('Failed to activate LM Studio extension:', error);
            vscode.window.showErrorMessage(`Failed to activate LM Studio extension: ${error.message}`);
            throw error; // Re-throw to be handled by error boundary
        }
    }, { operation: 'extension_activation' })();
}



/**
 * This method is called when your extension is deactivated
 */
function deactivate() {
    try {
        const logger = loggerManager.getLogger('Extension');
        logger.info('Deactivating LM Studio extension');
        
        // Cleanup will be handled by context.subscriptions
        console.log('LM Studio Kiro Extension is now deactivated');
        
    } catch (error) {
        console.error('Error during extension deactivation:', error);
    }
}

module.exports = {
    activate,
    deactivate
};