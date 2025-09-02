// services/logService.js
// Service for logging requests to the database and managing settings.

const pool = require('../config/db');

// In-memory state for logging configuration
const state = {
    mode: 'disabled', // 'disabled', 'enabled', 'auto_purge'
    purgeHours: 24,
    isInitialized: false,
    purgeInterval: null
};

/**
 * Initializes the log service by loading settings and starting the purge timer if needed.
 */
async function initialize() {
    console.log('[Log Service] Initializing...');
    try {
        const settings = await getLogSettings();
        state.mode = settings.logging_mode || 'disabled';
        state.purgeHours = parseInt(settings.logging_purge_hours, 10) || 24;
        
        console.log(`[Log Service] Logging mode set to: ${state.mode}`);
        if (state.mode === 'auto_purge') {
            console.log(`[Log Service] Auto-purging logs older than ${state.purgeHours} hours.`);
            startPurgeTimer();
        }
        state.isInitialized = true;
    } catch (error) {
        console.error('[Log Service] CRITICAL: Could not initialize logging settings from DB.', error);
    }
}

/**
 * Creates an initial log entry for a new request.
 * @param {string} reqId - The unique ID of the request.
 * @param {string} provider - The provider being requested.
 * @param {string} tokenName - The name of the user token, if any.
 * @param {object} requestPayload - The JSON body of the request.
 */
async function createLogEntry(reqId, provider, tokenName, requestPayload) {
    if (state.mode === 'disabled') return;

    try {
        await pool.query(
            `INSERT INTO request_logs (request_id, provider, token_name, request_payload, status_code) 
             VALUES ($1, $2, $3, $4, $5)`,
            [reqId, provider, tokenName, requestPayload, 0] // 0 for pending
        );
    } catch (error) {
        console.error(`[Log Service] Failed to create log entry for request ${reqId}.`, error);
    }
}

/**
 * Updates a log entry with the final status and response.
 * @param {string} reqId - The unique ID of the request.
 * @param {number} statusCode - The final HTTP status code.
 * @param {object} responsePayload - The JSON body of the response.
 */
async function updateLogEntry(reqId, statusCode, responsePayload) {
    if (state.mode === 'disabled') return;

    try {
        await pool.query(
            `UPDATE request_logs SET status_code = $1, response_payload = $2 
             WHERE request_id = $3`,
            [statusCode, responsePayload, reqId]
        );
    } catch (error) {
        console.error(`[Log Service] Failed to update log entry for request ${reqId}.`, error);
    }
}

/**
 * Fetches logs from the database with pagination.
 * @param {number} page - The page number to fetch.
 * @param {number} limit - The number of logs per page.
 */
async function getLogs(page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const logsResult = await pool.query(
        'SELECT id, request_id, provider, token_name, status_code, created_at FROM request_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
    );
    const totalResult = await pool.query('SELECT COUNT(*) FROM request_logs');
    return {
        logs: logsResult.rows,
        total: parseInt(totalResult.rows[0].count, 10)
    };
}

/**
 * Fetches the full details for a single log.
 * @param {number} id - The database ID of the log.
 */
async function getLogDetails(id) {
    const result = await pool.query('SELECT * FROM request_logs WHERE id = $1', [id]);
    return result.rows[0];
}

/**
 * Deletes a single log by its ID.
 * @param {number} id - The database ID of the log.
 */
async function deleteLog(id) {
    await pool.query('DELETE FROM request_logs WHERE id = $1', [id]);
}

/**
 * Deletes all logs from the database.
 */
async function deleteAllLogs() {
    await pool.query('TRUNCATE TABLE request_logs');
}

/**
 * Fetches the current logging settings from the database.
 */
async function getLogSettings() {
    const result = await pool.query('SELECT key, value FROM app_config WHERE key LIKE \'logging_%\'');
    const settings = {};
    result.rows.forEach(row => {
        settings[row.key] = row.value;
    });
    return settings;
}

/**
 * Updates the logging settings in the database and in memory.
 * @param {string} mode - The new logging mode.
 * @param {number} purgeHours - The new number of hours for auto-purge.
 */
async function updateLogSettings(mode, purgeHours) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('UPDATE app_config SET value = $1 WHERE key = \'logging_mode\'', [mode]);
        await client.query('UPDATE app_config SET value = $1 WHERE key = \'logging_purge_hours\'', [purgeHours]);
        await client.query('COMMIT');

        // Update in-memory state
        state.mode = mode;
        state.purgeHours = parseInt(purgeHours, 10) || 24; // Ensure value is an integer
        
        // Adjust purge timer based on new settings
        stopPurgeTimer();
        if (state.mode === 'auto_purge') {
            startPurgeTimer();
        }
        console.log(`[Log Service] Settings updated. Mode: ${state.mode}, Purge Hours: ${state.purgeHours}`);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Log Service] Failed to update settings.', error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Deletes logs older than the configured purgeHours.
 */
async function purgeOldLogs() {
    if (state.mode !== 'auto_purge') return;
    console.log('[Log Service] Running scheduled log purge...');
    try {
        const result = await pool.query(
            `DELETE FROM request_logs WHERE created_at < NOW() - INTERVAL '${state.purgeHours} hours'`
        );
        if (result.rowCount > 0) {
            console.log(`[Log Service] Purged ${result.rowCount} old log(s).`);
        }
    } catch (error) {
        console.error('[Log Service] Error during scheduled log purge.', error);
    }
}

function startPurgeTimer() {
    if (state.purgeInterval) clearInterval(state.purgeInterval);
    // Run purge check every hour
    state.purgeInterval = setInterval(purgeOldLogs, 60 * 60 * 1000);
}

function stopPurgeTimer() {
    if (state.purgeInterval) {
        clearInterval(state.purgeInterval);
        state.purgeInterval = null;
    }
}

/**
 * Returns the current in-memory logging state.
 * @returns {object} The current logging configuration.
 */
function getLogState() {
    return { ...state };
}

module.exports = {
    initialize,
    createLogEntry,
    updateLogEntry,
    getLogs,
    getLogDetails,
    deleteLog,
    deleteAllLogs,
    getLogSettings,
    updateLogSettings,
    getLogState,
};