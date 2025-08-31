// services/customProviderManager.js
// Manages database interactions for custom providers.

const pool = require('../config/db');
const keyManager = require('./keyManager');

/**
 * Fetches all custom providers from the database.
 */
async function getAll() {
    const result = await pool.query('SELECT * FROM custom_providers ORDER BY display_name');
    return result.rows;
}

/**
 * Saves or updates a custom provider.
 * After saving, it triggers the keyManager to re-initialize.
 * @param {object} providerData - The provider data from the admin form.
 */
async function save(providerData) {
    // --- CLAUDE INTEGRATION: Add provider_type to destructuring ---
    const { 
        id, 
        provider_type,
        provider_id, 
        display_name, 
        api_base_url, 
        api_keys, 
        model_id, 
        model_display_name, 
        is_enabled, 
        enforced_model_name, 
        max_context_tokens, 
        max_output_tokens 
    } = providerData;

    let criticalChange = false;

    if (id) { // This is an UPDATE
        const { rows } = await pool.query('SELECT api_base_url, api_keys, model_id, provider_type FROM custom_providers WHERE id = $1', [id]);
        if (rows.length > 0) {
            const oldProvider = rows[0];
            if (oldProvider.api_base_url !== api_base_url || oldProvider.api_keys !== api_keys || oldProvider.model_id !== model_id || oldProvider.provider_type !== provider_type) {
                console.log('[Custom Provider] Critical change detected (URL, keys, model ID, or type). Full key re-validation will be triggered.');
                criticalChange = true;
            } else {
                console.log('[Custom Provider] Non-critical change detected. Key validation will be skipped.');
            }
        }

        await pool.query(
            `UPDATE custom_providers SET 
                provider_id = $1, display_name = $2, api_base_url = $3, api_keys = $4, 
                model_id = $5, model_display_name = $6, is_enabled = $7, enforced_model_name = $8, 
                max_context_tokens = $9, max_output_tokens = $10, provider_type = $11, updated_at = NOW() 
             WHERE id = $12`,
            [provider_id, display_name, api_base_url, api_keys, model_id, model_display_name, is_enabled, enforced_model_name, max_context_tokens, max_output_tokens, provider_type, id]
        );
    } else { // This is an INSERT
        criticalChange = true; // A new provider is always a critical change.
        await pool.query(
            `INSERT INTO custom_providers 
                (provider_id, display_name, api_base_url, api_keys, model_id, model_display_name, is_enabled, enforced_model_name, max_context_tokens, max_output_tokens, provider_type) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [provider_id, display_name, api_base_url, api_keys, model_id, model_display_name, is_enabled, enforced_model_name, max_context_tokens, max_output_tokens, provider_type]
        );
    }
    
    await keyManager.initialize();

    if (criticalChange) {
        await keyManager.checkAllKeys();
    }
}

/**
 * Deletes a custom provider by its ID.
 * After deleting, it triggers the keyManager to re-initialize.
 * @param {number} id - The ID of the provider to delete.
 */
async function remove(id) {
    await pool.query('DELETE FROM custom_providers WHERE id = $1', [id]);
    // Re-initialize to remove the provider from memory
    await keyManager.initialize();
}

module.exports = {
    getAll,
    save,
    remove,
};