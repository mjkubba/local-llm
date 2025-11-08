/**
 * @fileoverview Logging system for debugging and troubleshooting
 * Provides structured logging with different levels and output channels.
 */

const vscode = require('vscode');

/**
 * Log levels for filtering and categorization
 * @readonly
 * @enum {string}
 */
const LOG_LEVELS = {
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug',
    TRACE: 'trace'
};

/**
 * Log level priorities for filtering
 * @readonly
 */
const LOG_PRIORITIES = {
    [LOG_LEVELS.ERROR]: 0,
    [LOG_LEVELS.WARN]: 1,
    [LOG_LEVELS.INFO]: 2,
    [LOG_LEVELS.DEBUG]: 3,
    [LOG_LEVELS.TRACE]: 4
};

/**
 * Logger class for structured logging
 * @class
 */
class Logger {
    /**
     * Create a Logger instance
     * @param {string} name - Logger name/category
     * @param {string} [level=LOG_LEVELS.INFO] - Minimum log level
     */
    constructor(name, level = LOG_LEVELS.INFO) {
        this.name = name;
        this.level = level;
        this._outputChannel = null;
        this._isEnabled = true;
    }

    /**
     * Set the VS Code output channel for logging
     * @param {vscode.OutputChannel} outputChannel - VS Code output channel
     */
    setOutputChannel(outputChannel) {
        this._outputChannel = outputChannel;
    }

    /**
     * Set the minimum log level
     * @param {string} level - Log level from LOG_LEVELS
     */
    setLevel(level) {
        if (!Object.values(LOG_LEVELS).includes(level)) {
            throw new Error(`Invalid log level: ${level}`);
        }
        this.level = level;
    }

    /**
     * Enable or disable logging
     * @param {boolean} enabled - Whether logging is enabled
     */
    setEnabled(enabled) {
        this._isEnabled = enabled;
    }

    /**
     * Check if a log level should be output
     * @private
     * @param {string} level - Log level to check
     * @returns {boolean} True if level should be logged
     */
    _shouldLog(level) {
        if (!this._isEnabled) {
            return false;
        }
        
        const currentPriority = LOG_PRIORITIES[this.level];
        const messagePriority = LOG_PRIORITIES[level];
        
        return messagePriority <= currentPriority;
    }

    /**
     * Format log message with timestamp and metadata
     * @private
     * @param {string} level - Log level
     * @param {string} message - Log message
     * @param {Object} [metadata] - Additional metadata
     * @returns {string} Formatted log message
     */
    _formatMessage(level, message, metadata = {}) {
        const timestamp = new Date().toISOString();
        const levelStr = level.toUpperCase().padEnd(5);
        const nameStr = this.name.padEnd(15);
        
        let formatted = `[${timestamp}] ${levelStr} ${nameStr} ${message}`;
        
        if (metadata && Object.keys(metadata).length > 0) {
            formatted += ` | ${JSON.stringify(metadata)}`;
        }
        
        return formatted;
    }

    /**
     * Write log message to output channels
     * @private
     * @param {string} level - Log level
     * @param {string} message - Log message
     * @param {Object} [metadata] - Additional metadata
     */
    _writeLog(level, message, metadata = {}) {
        if (!this._shouldLog(level)) {
            return;
        }

        const formatted = this._formatMessage(level, message, metadata);
        
        // Write to VS Code output channel
        if (this._outputChannel) {
            this._outputChannel.appendLine(formatted);
        }
        
        // Also write to console for development
        const consoleFn = this._getConsoleFunction(level);
        consoleFn(formatted);
    }

    /**
     * Get appropriate console function for log level
     * @private
     * @param {string} level - Log level
     * @returns {Function} Console function
     */
    _getConsoleFunction(level) {
        switch (level) {
            case LOG_LEVELS.ERROR:
                return console.error;
            case LOG_LEVELS.WARN:
                return console.warn;
            case LOG_LEVELS.INFO:
                return console.info;
            case LOG_LEVELS.DEBUG:
            case LOG_LEVELS.TRACE:
                return console.debug;
            default:
                return console.log;
        }
    }

    /**
     * Log error message
     * @param {string} message - Error message
     * @param {Error|Object} [error] - Error object or metadata
     */
    error(message, error = null) {
        const metadata = this._extractErrorMetadata(error);
        this._writeLog(LOG_LEVELS.ERROR, message, metadata);
    }

    /**
     * Log warning message
     * @param {string} message - Warning message
     * @param {Object} [metadata] - Additional metadata
     */
    warn(message, metadata = {}) {
        this._writeLog(LOG_LEVELS.WARN, message, metadata);
    }

    /**
     * Log info message
     * @param {string} message - Info message
     * @param {Object} [metadata] - Additional metadata
     */
    info(message, metadata = {}) {
        this._writeLog(LOG_LEVELS.INFO, message, metadata);
    }

    /**
     * Log debug message
     * @param {string} message - Debug message
     * @param {Object} [metadata] - Additional metadata
     */
    debug(message, metadata = {}) {
        this._writeLog(LOG_LEVELS.DEBUG, message, metadata);
    }

    /**
     * Log trace message
     * @param {string} message - Trace message
     * @param {Object} [metadata] - Additional metadata
     */
    trace(message, metadata = {}) {
        this._writeLog(LOG_LEVELS.TRACE, message, metadata);
    }

    /**
     * Log API request
     * @param {string} method - HTTP method
     * @param {string} url - Request URL
     * @param {Object} [options] - Request options
     */
    logApiRequest(method, url, options = {}) {
        this.debug(`API Request: ${method} ${url}`, {
            method,
            url,
            headers: options.headers,
            bodySize: options.body ? options.body.length : 0
        });
    }

    /**
     * Log API response
     * @param {string} method - HTTP method
     * @param {string} url - Request URL
     * @param {number} status - Response status code
     * @param {number} duration - Request duration in ms
     */
    logApiResponse(method, url, status, duration) {
        const level = status >= 400 ? LOG_LEVELS.WARN : LOG_LEVELS.DEBUG;
        this._writeLog(level, `API Response: ${method} ${url} ${status} (${duration}ms)`, {
            method,
            url,
            status,
            duration
        });
    }

    /**
     * Log performance metrics
     * @param {string} operation - Operation name
     * @param {number} duration - Duration in milliseconds
     * @param {Object} [metadata] - Additional metadata
     */
    logPerformance(operation, duration, metadata = {}) {
        this.info(`Performance: ${operation} completed in ${duration}ms`, {
            operation,
            duration,
            ...metadata
        });
    }

    /**
     * Extract metadata from error object
     * @private
     * @param {Error|Object} error - Error object
     * @returns {Object} Error metadata
     */
    _extractErrorMetadata(error) {
        if (!error) {
            return {};
        }

        if (error instanceof Error) {
            return {
                name: error.name,
                message: error.message,
                code: error.code,
                category: error.category,
                stack: error.stack
            };
        }

        return error;
    }

    /**
     * Create a child logger with additional context
     * @param {string} childName - Child logger name
     * @returns {Logger} Child logger instance
     */
    child(childName) {
        const fullName = `${this.name}.${childName}`;
        const childLogger = new Logger(fullName, this.level);
        childLogger.setOutputChannel(this._outputChannel);
        childLogger.setEnabled(this._isEnabled);
        return childLogger;
    }
}

/**
 * Global logger manager
 * @class
 */
class LoggerManager {
    /**
     * Create a LoggerManager instance
     */
    constructor() {
        this._loggers = new Map();
        this._outputChannel = null;
        this._globalLevel = LOG_LEVELS.INFO;
    }

    /**
     * Initialize the logger manager with VS Code output channel
     * @param {vscode.ExtensionContext} context - VS Code extension context
     */
    initialize(context) {
        this._outputChannel = vscode.window.createOutputChannel('LM Studio');
        context.subscriptions.push(this._outputChannel);
        
        // Update all existing loggers
        for (const logger of this._loggers.values()) {
            logger.setOutputChannel(this._outputChannel);
        }
    }

    /**
     * Get or create a logger
     * @param {string} name - Logger name
     * @returns {Logger} Logger instance
     */
    getLogger(name) {
        if (!this._loggers.has(name)) {
            const logger = new Logger(name, this._globalLevel);
            if (this._outputChannel) {
                logger.setOutputChannel(this._outputChannel);
            }
            this._loggers.set(name, logger);
        }
        
        return this._loggers.get(name);
    }

    /**
     * Set global log level for all loggers
     * @param {string} level - Log level from LOG_LEVELS
     */
    setGlobalLevel(level) {
        this._globalLevel = level;
        for (const logger of this._loggers.values()) {
            logger.setLevel(level);
        }
    }

    /**
     * Enable or disable all loggers
     * @param {boolean} enabled - Whether logging is enabled
     */
    setGlobalEnabled(enabled) {
        for (const logger of this._loggers.values()) {
            logger.setEnabled(enabled);
        }
    }

    /**
     * Show the output channel
     */
    show() {
        if (this._outputChannel) {
            this._outputChannel.show();
        }
    }

    /**
     * Clear all log output
     */
    clear() {
        if (this._outputChannel) {
            this._outputChannel.clear();
        }
    }

    /**
     * Dispose of all resources
     */
    dispose() {
        this._loggers.clear();
        if (this._outputChannel) {
            this._outputChannel.dispose();
        }
    }
}

// Global logger manager instance
const loggerManager = new LoggerManager();

/**
 * Get a logger instance
 * @param {string} name - Logger name
 * @returns {Logger} Logger instance
 */
function getLogger(name) {
    return loggerManager.getLogger(name);
}

module.exports = {
    Logger,
    LoggerManager,
    LOG_LEVELS,
    getLogger,
    loggerManager
};