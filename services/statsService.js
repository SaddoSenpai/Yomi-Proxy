// services/statsService.js
// Tracks application-wide statistics like prompt and token counts.

const stats = {
    promptCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
};

/**
 * Increments the total number of prompts processed.
 */
function incrementPromptCount() {
    stats.promptCount++;
}

/**
 * Adds token counts from a completed request to the totals.
 * @param {number} inputTokens - The number of input tokens.
 * @param {number} outputTokens - The number of output tokens.
 */
function addTokens(inputTokens = 0, outputTokens = 0) {
    stats.totalInputTokens += inputTokens;
    stats.totalOutputTokens += outputTokens;
}

/**
 * Returns the current statistics.
 * @returns {object} The stats object.
 */
function getStats() {
    return { ...stats };
}

module.exports = {
    incrementPromptCount,
    addTokens,
    getStats,
};