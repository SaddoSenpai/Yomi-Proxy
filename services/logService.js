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
 * @param {string} characterName - The detected character name.
 * @param {string} detectedCommands - Comma-separated list of commands.
 */
async function createLogEntry(reqId, provider, tokenName, requestPayload, characterName, detectedCommands) {
    if (state.mode === 'disabled') return;

    try {
        await pool('request_logs').insert({
            request_id: reqId,
            provider,
            token_name: tokenName,
            request_payload: requestPayload,
            status_code: 0, // 0 for pending
            character_name: characterName,
            detected_commands: detectedCommands
        });
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
        await pool('request_logs').where('request_id', reqId).update({
            status_code: statusCode,
            response_payload: responsePayload
        });
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
    const logs = await pool('request_logs')
        .select('id', 'request_id', 'provider', 'token_name', 'status_code', 'created_at', 'character_name', 'detected_commands')
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset);
    const totalResult = await pool('request_logs').count('* as count').first();
    return {
        logs,
        total: parseInt(totalResult.count, 10)
    };
}

/**
 * Fetches the full details for a single log.
 * @param {number} id - The database ID of the log.
 */
async function getLogDetails(id) {
    return await pool('request_logs').where('id', id).first();
}

/**
 * Deletes a single log by its ID.
 * @param {number} id - The database ID of the log.
 */
async function deleteLog(id) {
    await pool('request_logs').where('id', id).del();
}

/**
 * Deletes all logs from the database.
 */
async function deleteAllLogs() {
    await pool('request_logs').truncate();
}

/**
 * Fetches the current logging settings from the database.
 */
async function getLogSettings() {
    const rows = await pool('app_config').where('key', 'like', 'logging_%');
    const settings = {};
    rows.forEach(row => {
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
    try {
        await pool.transaction(async trx => {
            await trx('app_config').where('key', 'logging_mode').update({ value: mode });
            await trx('app_config').where('key', 'logging_purge_hours').update({ value: purgeHours });
        });

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
        console.error('[Log Service] Failed to update settings.', error);
        throw error;
    }
}

/**
 * Deletes logs older than the configured purgeHours.
 */
async function purgeOldLogs() {
    if (state.mode !== 'auto_purge') return;
    console.log('[Log Service] Running scheduled log purge...');
    try {
        const count = await pool('request_logs')
            .where('created_at', '<', pool.raw(`NOW() - INTERVAL '${state.purgeHours} hours'`))
            .del();
        if (count > 0) {
            console.log(`[Log Service] Purged ${count} old log(s).`);
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
