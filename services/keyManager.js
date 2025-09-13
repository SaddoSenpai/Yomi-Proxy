// services/keyManager.js
// Manages API keys, their statuses, rotation, and automatic deactivation.

const axios = require('axios');
const pool = require('../config/db');

// In-memory state to hold all provider and key information
const state = {
    providers: {}, // e.g., { gemini: { keys: [...], config: {...} } }
};

const RATE_LIMIT_THRESHOLD = 20; // Deactivate after 20 consecutive rate limit errors

/**
 * Initializes the key manager by reading keys and settings from environment variables
 * and custom providers from the database.
 */
async function initialize() {
    console.log('[Key Manager] Initializing...');
    state.providers = {}; // Clear existing providers before re-loading

    // 1. Load built-in providers from .env
    const supportedProviders = ['GEMINI', 'DEEPSEEK', 'OPENAI', 'OPENROUTER', 'MISTRAL', 'CLAUDE'];
    for (const provider of supportedProviders) {
        const keysEnv = process.env[`${provider}_KEY`];
        if (keysEnv) {
            const keys = keysEnv.split(',').map(k => k.trim()).filter(Boolean);
            if (keys.length > 0) {
                const providerName = provider.toLowerCase();
                state.providers[providerName] = {
                    keys: keys.map(key => ({
                        value: key,
                        status: 'unchecked',
                        consecutiveFails: 0,
                    })),
                    currentIndex: 0,
                    config: {
                        isCustom: false,
                        providerType: providerName === 'claude' ? 'claude' : 'openai',
                        apiBaseUrl: providerName === 'claude' ? 'https://api.anthropic.com' : null,
                        modelId: providerName === 'claude' ? 'claude-3-opus-20240229' : null,
                        maxContext: process.env[`MAX_CONTEXT_${provider}`] || 'Unlimited',
                        maxOutput: process.env[`MAX_OUTPUT_${provider}`] || 'Unlimited',
                    }
                };
                console.log(`[Key Manager] Loaded ${keys.length} key(s) for built-in provider: ${providerName}.`);
            }
        }
    }

    // 2. Load custom providers from the database
    try {
        const { rows } = await pool.query('SELECT * FROM custom_providers WHERE is_enabled = true');
        for (const provider of rows) {
            const keys = (provider.api_keys || '').split(',').map(k => k.trim()).filter(Boolean);
            if (keys.length > 0) {
                state.providers[provider.provider_id] = {
                    keys: keys.map(key => ({
                        value: key,
                        status: 'unchecked',
                        consecutiveFails: 0,
                    })),
                    currentIndex: 0,
                    config: {
                        isCustom: true,
                        providerType: provider.provider_type || 'openai',
                        displayName: provider.display_name,
                        modelDisplayName: provider.model_display_name,
                        apiBaseUrl: provider.api_base_url.replace(/\/$/, ''),
                        modelId: provider.model_id,
                        enforcedModelName: provider.enforced_model_name,
                        maxContext: provider.max_context_tokens || 'Unlimited',
                        maxOutput: provider.max_output_tokens || 'Unlimited',
                    }
                };
                console.log(`[Key Manager] Loaded ${keys.length} key(s) for custom provider: ${provider.provider_id}.`);
            }
        }
    } catch (error) {
        console.error('[Key Manager] CRITICAL: Could not load custom providers from database. Check DB connection and table.', error);
        throw error;
    }
    console.log('[Key Manager] Initialization complete.');
}

async function testClaudeKey(providerConfig, key) {
    const testUrl = `${providerConfig.apiBaseUrl}/v1/messages`;
    const testPayload = {
        model: providerConfig.modelId, // Use the model from the config
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 2
    };
    const headers = {
        'Content-Type': 'application/json',
        'x-api-key': key.value,
        'anthropic-version': '2023-06-01'
    };

    try {
        // MODIFIED: Increased timeout from 10000 to 20000
        await axios.post(testUrl, testPayload, { headers, timeout: 20000 });
        key.status = 'active';
    } catch (error) {
        const status = error.response?.status;
        if (status === 401 || status === 403) {
            key.status = 'revoked';
        } else if (status === 402) {
            key.status = 'over_quota';
        } else {
            key.status = 'revoked';
            console.warn(`[Key Test] Claude key for provider '${providerConfig.displayName}' failed with status ${status || 'N/A'}. Error: ${error.message}`);
        }
    }
}


/**
 * Tests a single API key for a custom provider.
 * @param {object} providerConfig - The configuration for the custom provider.
 * @param {object} key - The key object to test.
 */
async function testCustomKey(providerConfig, key) {
    if (providerConfig.providerType === 'claude') {
        return await testClaudeKey(providerConfig, key);
    }
    
    // Default to OpenAI-compatible test
    const testUrl = `${providerConfig.apiBaseUrl}/v1/chat/completions`;
    const testPayload = {
        model: providerConfig.modelId,
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 1
    };
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key.value}`
    };

    try {
        // MODIFIED: Increased timeout from 10000 to 20000
        await axios.post(testUrl, testPayload, { headers, timeout: 20000 });
        key.status = 'active';
    } catch (error) {
        const status = error.response?.status;
        if (status === 401 || status === 403) {
            key.status = 'revoked';
        } else if (status === 402) {
            key.status = 'over_quota';
        } else {
            key.status = 'revoked';
            console.warn(`[Key Test] Custom key for ${providerConfig.displayName} failed with status ${status || 'N/A'}. Error: ${error.message}`);
        }
    }
}


/**
 * Tests a single API key to check its validity for built-in providers.
 * @param {string} provider - The name of the provider (e.g., 'gemini').
 * @param {object} key - The key object to test.
 */
async function testKey(provider, key) {
    let testUrl, testPayload, headers;
    const apiKey = key.value;

    try {
        switch (provider) {
            case 'claude':
                const claudeConfig = state.providers['claude'].config;
                return await testClaudeKey(claudeConfig, key);
            case 'gemini':
                testUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;
                testPayload = { contents: [{ parts: [{ text: "hello" }] }] };
                headers = { 'Content-Type': 'application/json' };
                break;
            case 'deepseek':
                testUrl = 'https://api.deepseek.com/chat/completions';
                testPayload = { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hello' }], max_tokens: 1 };
                headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
                break;
            case 'openai':
                testUrl = 'https://api.openai.com/v1/chat/completions';
                testPayload = { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'hello' }], max_tokens: 1 };
                headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
                break;
            case 'openrouter':
                testUrl = 'https://openrouter.ai/api/v1/chat/completions';
                testPayload = { model: 'mistralai/mistral-7b-instruct:free', messages: [{ role: 'user', content: 'hello' }], max_tokens: 1 };
                headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
                break;
            case 'mistral':
                testUrl = 'https://api.mistral.ai/v1/chat/completions';
                testPayload = { model: 'mistral-tiny', messages: [{ role: 'user', content: 'hello' }], max_tokens: 1 };
                headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
                break;
            default:
                key.status = 'revoked';
                return;
        }

        // MODIFIED: Increased timeout from 10000 to 20000
        await axios.post(testUrl, testPayload, { headers, timeout: 20000 });
        key.status = 'active';
    } catch (error) {
        const status = error.response?.status;
        if (status === 401 || status === 403) {
            key.status = 'revoked';
        } else if (status === 402) {
            key.status = 'over_quota';
        } else {
            key.status = 'revoked';
            console.warn(`[Key Test] Key for ${provider} failed with status ${status || 'N/A'}. Error: ${error.message}`);
        }
    }
}

/**
 * Iterates through all loaded keys and tests them.
 */
async function checkAllKeys() {
    console.log('[Key Manager] Performing startup key validation...');
    const promises = [];
    for (const providerName in state.providers) {
        const providerData = state.providers[providerName];
        for (const key of providerData.keys) {
            if (providerData.config.isCustom) {
                promises.push(testCustomKey(providerData.config, key));
            } else {
                promises.push(testKey(providerName, key));
            }
        }
    }
    await Promise.all(promises);
    console.log('[Key Manager] Startup key validation complete.');
}

/**
 * Gets the next available active key for a provider using round-robin.
 * @param {string} provider - The name of the provider.
 * @returns {object|null} The key object or null if no active keys are available.
 */
function getRotatingKey(provider) {
    const providerData = state.providers[provider];
    if (!providerData || providerData.keys.length === 0) return null;

    const totalKeys = providerData.keys.length;
    for (let i = 0; i < totalKeys; i++) {
        const keyIndex = (providerData.currentIndex + i) % totalKeys;
        const key = providerData.keys[keyIndex];
        if (key.status === 'active') {
            providerData.currentIndex = (keyIndex + 1) % totalKeys;
            return key;
        }
    }
    return null; // No active keys found
}

/**
 * Returns the configuration for a specific provider.
 * @param {string} provider - The name of the provider.
 * @returns {object|null}
 */
function getProviderConfig(provider) {
    const config = state.providers[provider]?.config || null;
    if (config) {
        return { ...config, name: provider };
    }
    return null;
}

function deactivateKey(provider, keyValue, reason) {
    const key = state.providers[provider]?.keys.find(k => k.value === keyValue);
    if (key && key.status === 'active') {
        key.status = reason;
        console.log(`[Key Manager] Deactivated key for ${provider} due to: ${reason}. Key ending in ...${keyValue.slice(-4)}`);
    }
}

function recordSuccess(provider, keyValue) {
    const key = state.providers[provider]?.keys.find(k => k.value === keyValue);
    if (key) {
        key.consecutiveFails = 0;
    }
}

function recordFailure(provider, keyValue) {
    const key = state.providers[provider]?.keys.find(k => k.value === keyValue);
    if (key && key.status === 'active') {
        key.consecutiveFails++;
        console.warn(`[Key Manager] Rate limit failure #${key.consecutiveFails} for ${provider} key ...${keyValue.slice(-4)}`);
        if (key.consecutiveFails >= RATE_LIMIT_THRESHOLD) {
            deactivateKey(provider, keyValue, 'revoked');
            console.error(`[Key Manager] Deactivated key for ${provider} after ${RATE_LIMIT_THRESHOLD} consecutive rate limit errors.`);
        }
    }
}

/**
 * Returns a list of available providers.
 * @returns {string[]} An array of provider names.
 */
function getAvailableProviders() {
    return Object.keys(state.providers);
}

/**
 * Returns statistics for the main page display.
 * @returns {object} An object containing provider stats.
 */
function getProviderStats() {
    const stats = {};
    for (const providerName in state.providers) {
        const providerData = state.providers[providerName];
        stats[providerName] = {
            ...providerData.config,
            name: providerName,
            keys: {
                active: providerData.keys.filter(k => k.status === 'active').length,
                over_quota: providerData.keys.filter(k => k.status === 'over_quota').length,
                revoked: providerData.keys.filter(k => k.status === 'revoked' || k.status === 'unchecked').length,
            }
        };
    }
    return stats;
}

module.exports = {
    initialize,
    checkAllKeys,
    getRotatingKey,
    getProviderConfig,
    deactivateKey,
    recordSuccess,
    recordFailure,
    getAvailableProviders,
    getProviderStats,
};