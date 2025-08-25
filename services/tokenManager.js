// services/tokenManager.js
// Manages user tokens, authentication, and rate limiting.

const crypto = require('crypto');
const pool = require('../config/db');

// In-memory state for tokens and rate limiting
const state = {
    // Map<token_value, token_data_from_db>
    tokens: new Map(),
    // Map<token_value, [timestamp1, timestamp2, ...]>
    requests: new Map(),
};

/**
 * Initializes the token manager by loading all tokens from the database into memory.
 */
async function initialize() {
    console.log('[Token Manager] Initializing...');
    try {
        const result = await pool.query('SELECT id, name, token, rpm, is_enabled FROM user_tokens');
        state.tokens.clear();
        for (const tokenData of result.rows) {
            state.tokens.set(tokenData.token, tokenData);
        }
        console.log(`[Token Manager] Loaded ${state.tokens.size} tokens into memory.`);
    } catch (error) {
        console.error('[Token Manager] Error initializing tokens:', error.message);
        console.error('[Token Manager] This might be due to a missing or incorrect `user_tokens` table in the database.');
    }
    // Clean up old request timestamps every minute
    setInterval(cleanupRequestTimestamps, 60 * 1000);
}

/**
 * Verifies a token and checks its rate limit from the in-memory cache.
 * @param {string} tokenValue - The raw token provided by the user.
 * @returns {object} An object indicating success or failure.
 */
async function verifyAndRateLimit(tokenValue) {
    const tokenData = state.tokens.get(tokenValue);

    if (!tokenData) {
        return { success: false, status: 401, message: 'Invalid token.' };
    }

    if (!tokenData.is_enabled) {
        return { success: false, status: 403, message: 'Token is disabled.' };
    }

    // Rate Limiting Logic
    const now = Date.now();
    const requests = state.requests.get(tokenValue) || [];
    const rpm = tokenData.rpm;

    // Filter out requests older than 1 minute
    const recentRequests = requests.filter(timestamp => now - timestamp < 60000);

    if (recentRequests.length >= rpm) {
        return { success: false, status: 429, message: `Rate limit of ${rpm} RPM exceeded.` };
    }

    recentRequests.push(now);
    state.requests.set(tokenValue, recentRequests);

    return { success: true, tokenData: { name: tokenData.name } };
}

/**
 * Periodically cleans up request timestamps older than 1 minute to prevent memory leaks.
 */
function cleanupRequestTimestamps() {
    const now = Date.now();
    for (const [token, timestamps] of state.requests.entries()) {
        const recentTimestamps = timestamps.filter(ts => now - ts < 60000);
        if (recentTimestamps.length > 0) {
            state.requests.set(token, recentTimestamps);
        } else {
            state.requests.delete(token); // No recent requests, remove entry
        }
    }
}

/**
 * Returns all tokens for the admin panel.
 */
async function getAdminTokens() {
    const result = await pool.query('SELECT id, name, token, rpm, is_enabled, created_at, updated_at FROM user_tokens ORDER BY name');
    return result.rows;
}

/**
 * Saves or updates a user token.
 * @param {object} tokenData - The token data from the admin form.
 * @returns {object} The full token object that was saved.
 */
async function saveToken(tokenData) {
    const { id, name, rpm, is_enabled, regenerate } = tokenData;
    let tokenValue;
    let savedToken;

    if (id && !regenerate) { // Update existing token
        const existing = await pool.query('SELECT token FROM user_tokens WHERE id = $1', [id]);
        if (existing.rows.length === 0) throw new Error('Token not found for update.');
        tokenValue = existing.rows[0].token;

        const result = await pool.query(
            'UPDATE user_tokens SET name = $1, rpm = $2, is_enabled = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
            [name, rpm, is_enabled, id]
        );
        savedToken = result.rows[0];
        // Update in-memory cache
        state.tokens.set(savedToken.token, savedToken);

    } else { // Create new token or regenerate existing
        tokenValue = crypto.randomBytes(24).toString('hex');
        if (id && regenerate) { // Regenerate
            // Remove old token from cache
            const oldTokenResult = await pool.query('SELECT token FROM user_tokens WHERE id = $1', [id]);
            if (oldTokenResult.rows.length > 0) {
                state.tokens.delete(oldTokenResult.rows[0].token);
            }

            const result = await pool.query(
                'UPDATE user_tokens SET name = $1, rpm = $2, is_enabled = $3, token = $4, updated_at = NOW() WHERE id = $5 RETURNING *',
                [name, rpm, is_enabled, tokenValue, id]
            );
            savedToken = result.rows[0];
        } else { // Create new
            const result = await pool.query(
                'INSERT INTO user_tokens (name, token, rpm, is_enabled) VALUES ($1, $2, $3, $4) RETURNING *',
                [name, tokenValue, rpm, is_enabled]
            );
            savedToken = result.rows[0];
        }
        // Add new token to cache
        state.tokens.set(savedToken.token, savedToken);
    }
    return savedToken;
}

/**
 * Deletes a token from the database and memory.
 * @param {number} id - The ID of the token to delete.
 */
async function deleteToken(id) {
    // First, get the token value to remove it from the in-memory map
    const result = await pool.query('SELECT token FROM user_tokens WHERE id = $1', [id]);
    if (result.rows.length > 0) {
        const tokenValue = result.rows[0].token;
        state.tokens.delete(tokenValue);
        state.requests.delete(tokenValue); // Also clear any rate limit data
    }
    // Then, delete from the database
    await pool.query('DELETE FROM user_tokens WHERE id = $1', [id]);
}

module.exports = {
    initialize,
    verifyAndRateLimit,
    getAdminTokens,
    saveToken,
    deleteToken,
};