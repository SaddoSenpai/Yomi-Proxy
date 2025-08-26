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
    const { id, provider_id, display_name, api_base_url, api_keys, model_id, model_display_name, is_enabled } = providerData;

    if (id) { // Update
        await pool.query(
            `UPDATE custom_providers SET 
                provider_id = $1, display_name = $2, api_base_url = $3, api_keys = $4, 
                model_id = $5, model_display_name = $6, is_enabled = $7, updated_at = NOW() 
             WHERE id = $8`,
            [provider_id, display_name, api_base_url, api_keys, model_id, model_display_name, is_enabled, id]
        );
    } else { // Insert
        await pool.query(
            `INSERT INTO custom_providers 
                (provider_id, display_name, api_base_url, api_keys, model_id, model_display_name, is_enabled) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [provider_id, display_name, api_base_url, api_keys, model_id, model_display_name, is_enabled]
        );
    }
    // Crucially, re-initialize the key manager to load the changes into memory
    await keyManager.initialize();
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