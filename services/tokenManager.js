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
 * Also checks for and disables any tokens that have expired since the last run.
 */
async function initialize() {
    console.log('[Token Manager] Initializing...');
    try {
        const tokens = await pool('user_tokens').select('id', 'name', 'token', 'rpm', 'is_enabled', 'expires_at');
        state.tokens.clear();
        const now = new Date();
        const expiredTokenIds = [];

        for (const tokenData of tokens) {
            // Check if the token is active but has an expiration date that has passed
            if (tokenData.is_enabled && tokenData.expires_at && new Date(tokenData.expires_at) < now) {
                console.warn(`[Token Manager] Token '${tokenData.name}' (ID: ${tokenData.id}) has expired. Marking as disabled.`);
                expiredTokenIds.push(tokenData.id);
                tokenData.is_enabled = false; // Mark as disabled in memory
            }
            state.tokens.set(tokenData.token, tokenData);
        }

        // If we found any expired tokens, update their status in the database
        if (expiredTokenIds.length > 0) {
            await pool('user_tokens').whereIn('id', expiredTokenIds).update({ is_enabled: false, updated_at: pool.fn.now() });
            console.log(`[Token Manager] Successfully disabled ${expiredTokenIds.length} expired token(s) in the database.`);
        }

        console.log(`[Token Manager] Loaded ${state.tokens.size} tokens into memory.`);
    } catch (error) {
        console.error('[Token Manager] CRITICAL: Error initializing tokens. Check DB connection and table.', error);
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

    // NEW: Live check for expiration
    if (tokenData.expires_at && new Date(tokenData.expires_at) < new Date()) {
        return { success: false, status: 403, message: 'Token has expired.' };
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
    return await pool('user_tokens').select('id', 'name', 'token', 'rpm', 'is_enabled', 'created_at', 'updated_at', 'expires_at').orderBy('name');
}

/**
 * Saves or updates a user token.
 * @param {object} tokenData - The token data from the admin form.
 * @returns {object} The full token object that was saved.
 */
async function saveToken(tokenData) {
    // Add expires_at to destructuring
    const { id, name, rpm, is_enabled, regenerate, expires_at } = tokenData;
    let tokenValue;
    let savedToken;

    // If expires_at is an empty string, convert it to null for the database
    const expirationDate = expires_at ? expires_at : null;

    if (id && !regenerate) { // Update existing token
        const existing = await pool('user_tokens').where('id', id).first();
        if (!existing) throw new Error('Token not found for update.');
        tokenValue = existing.token;

        const [updatedToken] = await pool('user_tokens').where('id', id).update({
            name,
            rpm,
            is_enabled,
            expires_at: expirationDate,
            updated_at: pool.fn.now()
        }).returning('*');
        savedToken = updatedToken;
        // Update in-memory cache
        state.tokens.set(savedToken.token, savedToken);

    } else { // Create new token or regenerate existing
        tokenValue = crypto.randomBytes(24).toString('hex');
        if (id && regenerate) { // Regenerate
            // Remove old token from cache
            const oldToken = await pool('user_tokens').where('id', id).first();
            if (oldToken) {
                state.tokens.delete(oldToken.token);
            }

            const [updatedToken] = await pool('user_tokens').where('id', id).update({
                name,
                rpm,
                is_enabled,
                token: tokenValue,
                expires_at: expirationDate,
                updated_at: pool.fn.now()
            }).returning('*');
            savedToken = updatedToken;
        } else { // Create new
            const [newToken] = await pool('user_tokens').insert({
                name,
                token: tokenValue,
                rpm,
                is_enabled,
                expires_at: expirationDate
            }).returning('*');
            savedToken = newToken;
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
    const token = await pool('user_tokens').where('id', id).first();
    if (token) {
        state.tokens.delete(token.token);
        state.requests.delete(token.token); // Also clear any rate limit data
    }
    // Then, delete from the database
    await pool('user_tokens').where('id', id).del();
}

module.exports = {
    initialize,
    verifyAndRateLimit,
    getAdminTokens,
    saveToken,
    deleteToken,
};
