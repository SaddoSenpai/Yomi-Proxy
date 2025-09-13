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
        const result = await pool.query('SELECT id, name, token, rpm, is_enabled, expires_at FROM user_tokens');
        state.tokens.clear();
        const now = new Date();
        const expiredTokenIds = [];

        for (const tokenData of result.rows) {
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
            await pool.query('UPDATE user_tokens SET is_enabled = false, updated_at = NOW() WHERE id = ANY($1)', [expiredTokenIds]);
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
    const result = await pool.query('SELECT id, name, token, rpm, is_enabled, created_at, updated_at, expires_at FROM user_tokens ORDER BY name');
    return result.rows;
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
        const existing = await pool.query('SELECT token FROM user_tokens WHERE id = $1', [id]);
        if (existing.rows.length === 0) throw new Error('Token not found for update.');
        tokenValue = existing.rows[0].token;

        const result = await pool.query(
            'UPDATE user_tokens SET name = $1, rpm = $2, is_enabled = $3, expires_at = $4, updated_at = NOW() WHERE id = $5 RETURNING *',
            [name, rpm, is_enabled, expirationDate, id]
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
                'UPDATE user_tokens SET name = $1, rpm = $2, is_enabled = $3, token = $4, expires_at = $5, updated_at = NOW() WHERE id = $6 RETURNING *',
                [name, rpm, is_enabled, tokenValue, expirationDate, id]
            );
            savedToken = result.rows[0];
        } else { // Create new
            const result = await pool.query(
                'INSERT INTO user_tokens (name, token, rpm, is_enabled, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING *',
                [name, tokenValue, rpm, is_enabled, expirationDate]
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