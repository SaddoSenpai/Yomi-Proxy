// services/keyManager.js
// Manages API keys, their statuses, rotation, and automatic deactivation.

const axios = require('axios');

// In-memory state to hold all provider and key information
const state = {
    providers: {}, // e.g., { gemini: { keys: [...], config: {...} } }
};

const RATE_LIMIT_THRESHOLD = 20; // Deactivate after 20 consecutive rate limit errors

/**
 * Initializes the key manager by reading keys and settings from environment variables.
 */
function initialize() {
    console.log('[Key Manager] Initializing...');
    const supportedProviders = ['GEMINI', 'DEEPSEEK', 'OPENAI', 'OPENROUTER', 'MISTRAL'];

    for (const provider of supportedProviders) {
        const keysEnv = process.env[`${provider}_KEY`];
        if (keysEnv) {
            const keys = keysEnv.split(',').map(k => k.trim()).filter(Boolean);
            if (keys.length > 0) {
                const providerName = provider.toLowerCase();
                state.providers[providerName] = {
                    keys: keys.map(key => ({
                        value: key,
                        status: 'unchecked', // Initial status
                        consecutiveFails: 0,
                    })),
                    currentIndex: 0,
                    config: {
                        maxContext: process.env[`MAX_CONTEXT_${provider}`] || 'Unlimited',
                        maxOutput: process.env[`MAX_OUTPUT_${provider}`] || 'Unlimited',
                    }
                };
                console.log(`[Key Manager] Loaded ${keys.length} key(s) for ${providerName}.`);
            }
        }
    }
}

/**
 * Tests a single API key to check its validity.
 * @param {string} provider - The name of the provider (e.g., 'gemini').
 * @param {object} key - The key object to test.
 */
async function testKey(provider, key) {
    let testUrl, testPayload, headers;
    const apiKey = key.value;

    try {
        switch (provider) {
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
                key.status = 'revoked'; // Unsupported provider for testing
                return;
        }

        await axios.post(testUrl, testPayload, { headers, timeout: 10000 });
        key.status = 'active';
    } catch (error) {
        const status = error.response?.status;
        if (status === 401 || status === 403) {
            key.status = 'revoked'; // Invalid key
        } else if (status === 402) {
            key.status = 'over_quota'; // Insufficient balance
        } else {
            key.status = 'revoked'; // Assume other errors mean the key is unusable
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
        for (const key of state.providers[providerName].keys) {
            promises.push(testKey(providerName, key));
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
 * Deactivates a key due to an error.
 * @param {string} provider - The provider name.
 * @param {string} keyValue - The value of the key to deactivate.
 * @param {string} reason - The reason for deactivation ('over_quota' or 'revoked').
 */
function deactivateKey(provider, keyValue, reason) {
    const key = state.providers[provider]?.keys.find(k => k.value === keyValue);
    if (key && key.status === 'active') {
        key.status = reason;
        console.log(`[Key Manager] Deactivated key for ${provider} due to: ${reason}. Key ending in ...${keyValue.slice(-4)}`);
    }
}

/**
 * Records a successful API call for a key, resetting its failure counter.
 * @param {string} provider - The provider name.
 * @param {string} keyValue - The value of the key.
 */
function recordSuccess(provider, keyValue) {
    const key = state.providers[provider]?.keys.find(k => k.value === keyValue);
    if (key) {
        key.consecutiveFails = 0;
    }
}

/**
 * Records a failed API call for a key, incrementing its failure counter.
 * Deactivates the key if the threshold is reached.
 * @param {string} provider - The provider name.
 * @param {string} keyValue - The value of the key.
 */
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
    deactivateKey,
    recordSuccess,
    recordFailure,
    getAvailableProviders,
    getProviderStats,
};