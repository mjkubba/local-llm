/**
 * @fileoverview Configuration management for LM Studio extension
 * Exports configuration classes and utilities for managing extension settings.
 */

module.exports = {
    ...require('./extensionConfig'),
    ...require('./configManager')
};