// services/customProviderManager.js
// Manages database interactions for custom providers.

const pool = require('../config/db');
const keyManager = require('./keyManager');

/**
 * Fetches all custom providers from the database.
 */
async function getAll() {
    return await pool('custom_providers').orderBy('display_name');
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
        const oldProvider = await pool('custom_providers').where('id', id).first();
        if (oldProvider) {
            if (oldProvider.api_base_url !== api_base_url || oldProvider.api_keys !== api_keys || oldProvider.model_id !== model_id || oldProvider.provider_type !== provider_type) {
                console.log('[Custom Provider] Critical change detected (URL, keys, model ID, or type). Full key re-validation will be triggered.');
                criticalChange = true;
            } else {
                console.log('[Custom Provider] Non-critical change detected. Key validation will be skipped.');
            }
        }

        await pool('custom_providers').where('id', id).update({
            provider_id,
            display_name,
            api_base_url,
            api_keys,
            model_id,
            model_display_name,
            is_enabled,
            enforced_model_name,
            max_context_tokens,
            max_output_tokens,
            provider_type,
            updated_at: pool.fn.now()
        });
    } else { // This is an INSERT
        criticalChange = true; // A new provider is always a critical change.
        await pool('custom_providers').insert({
            provider_id,
            display_name,
            api_base_url,
            api_keys,
            model_id,
            model_display_name,
            is_enabled,
            enforced_model_name,
            max_context_tokens,
            max_output_tokens,
            provider_type
        });
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
    await pool('custom_providers').where('id', id).del();
    // Re-initialize to remove the provider from memory
    await keyManager.initialize();
}

module.exports = {
    getAll,
    save,
    remove,
};
