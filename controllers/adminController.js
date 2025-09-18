// controllers/adminController.js
// Handles all logic for the admin panel, including auth, stats, structure, and commands.

const statsService = require('../services/statsService');
const promptService = require('../services/promptService');
const keyManager = require('../services/keyManager');
const tokenManager = require('../services/tokenManager');
const customProviderManager = require('../services/customProviderManager');
const logService = require('../services/logService');
const pool = require('../config/db');

const ADMIN_PASS = process.env.ADMIN_PASS || 'yomi123';

// --- Page Rendering ---
exports.renderLoginPage = (req, res) => res.render('admin-login');
exports.renderDashboard = (req, res) => {
    const availableProviders = keyManager.getAvailableProviders();
    res.render('admin', { availableProviders });
};

// --- Authentication ---
exports.handleLogin = (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASS) {
        req.session.isAdmin = true;
        res.redirect('/admin/dashboard');
    } else {
        res.status(401).send('Incorrect password');
    }
};
exports.handleLogout = (req, res) => {
    req.session.destroy(() => res.redirect('/admin'));
};

// --- API: Stats ---
exports.getStats = (req, res) => res.json(statsService.getStats());
exports.getServerTime = (req, res) => {
    res.json({ serverTime: new Date().toISOString() });
};

// --- API: Announcement ---
exports.getAnnouncement = async (req, res) => {
    // --- ADDED: Logging ---
    console.log('[adminController] Reached getAnnouncement function successfully.');
    try {
        const result = await pool.query("SELECT key, value FROM app_config WHERE key IN ('announcement_message', 'announcement_enabled')");
        const announcement = result.rows.reduce((acc, row) => {
            acc[row.key] = row.value;
            return acc;
        }, {});
        res.json({
            message: announcement.announcement_message || '',
            enabled: announcement.announcement_enabled === 'true'
        });
    } catch (error) {
        console.error('[adminController] Error fetching announcement:', error);
        res.status(500).json({ error: 'Failed to fetch announcement.' });
    }
};

exports.updateAnnouncement = async (req, res) => {
    // --- ADDED: Logging ---
    console.log('[adminController] Reached updateAnnouncement function successfully.');
    const { message, enabled } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("UPDATE app_config SET value = $1 WHERE key = 'announcement_message'", [message]);
        await client.query("UPDATE app_config SET value = $1 WHERE key = 'announcement_enabled'", [enabled]);
        await client.query('COMMIT');
        res.json({ success: true, message: 'Announcement updated successfully.' });
    } catch (error) {
        console.error('[adminController] Error updating announcement:', error);
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Failed to update announcement.' });
    } finally {
        client.release();
    }
};

// --- API: Structure ---
exports.getStructure = async (req, res) => {
    try {
        const provider = req.query.provider || 'default';
        const structure = await promptService.getStructure(provider);
        res.json({ blocks: structure });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch structure.' });
    }
};
exports.updateStructure = async (req, res) => {
    try {
        const provider = req.query.provider || 'default';
        const { blocks } = req.body;
        if (!Array.isArray(blocks)) return res.status(400).json({ error: 'blocks array is required' });
        await promptService.setStructure(provider, blocks);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update structure.' });
    }
};

// --- API: Commands ---
exports.getCommands = async (req, res) => {
    try {
        const commands = await promptService.getCommands();
        res.json({ commands });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch commands.' });
    }
};
exports.saveCommand = async (req, res) => {
    try {
        await promptService.saveCommand(req.body);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save command.', detail: error.message });
    }
};
exports.deleteCommand = async (req, res) => {
    try {
        await promptService.deleteCommand(req.params.id);
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete command.' });
    }
};

// --- API: User Tokens ---
exports.getTokens = async (req, res) => {
    try {
        const tokens = await tokenManager.getAdminTokens();
        res.json({ tokens });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tokens.' });
    }
};
exports.saveToken = async (req, res) => {
    try {
        const savedToken = await tokenManager.saveToken(req.body);
        res.json({ success: true, token: savedToken });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save token.', detail: error.message });
    }
};
exports.deleteToken = async (req, res) => {
    try {
        await tokenManager.deleteToken(req.params.id);
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete token.' });
    }
};

// --- API: Logs ---
exports.getLogs = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 20;
        const data = await logService.getLogs(page, limit);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch logs.' });
    }
};

exports.getLogDetails = async (req, res) => {
    try {
        const log = await logService.getLogDetails(req.params.id);
        if (!log) return res.status(404).json({ error: 'Log not found.' });
        res.json(log);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch log details.' });
    }
};

exports.deleteLog = async (req, res) => {
    try {
        await logService.deleteLog(req.params.id);
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete log.' });
    }
};

exports.deleteAllLogs = async (req, res) => {
    try {
        await logService.deleteAllLogs();
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete all logs.' });
    }
};

exports.getLogSettings = async (req, res) => {
    try {
        const settings = await logService.getLogSettings();
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch log settings.' });
    }
};

exports.updateLogSettings = async (req, res) => {
    try {
        const { mode, purgeHours } = req.body;
        await logService.updateLogSettings(mode, purgeHours);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update log settings.' });
    }
};

// --- API: Custom Providers ---
exports.getCustomProviders = async (req, res) => {
    try {
        const providers = await customProviderManager.getAll();
        res.json({ providers });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch custom providers.' });
    }
};

exports.saveCustomProvider = async (req, res) => {
    try {
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
        } = req.body;

        const providerData = {
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
        };

        await customProviderManager.save(providerData);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save custom provider.', detail: error.message });
    }
};

exports.deleteCustomProvider = async (req, res) => {
    try {
        await customProviderManager.remove(req.params.id);
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete custom provider.' });
    }
};

// --- API: Import/Export ---
exports.exportData = async (req, res) => {
    try {
        const provider = req.query.provider || 'default';
        const structure = await promptService.getStructure(provider);
        const commands = await promptService.getCommands();
        const exportData = {
            provider,
            structure,
            commands
        };
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="yomi_proxy_config_${provider}.json"`);
        res.json(exportData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to export data.' });
    }
};

exports.importData = async (req, res) => {
    const targetProvider = req.query.provider;
    if (!targetProvider) {
        return res.status(400).json({ error: 'No target provider specified for import. Please select one from the dropdown.' });
    }
    if (!req.files || !req.files.configFile) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    const client = await pool.connect();
    try {
        const file = req.files.configFile;
        const importData = JSON.parse(file.data.toString('utf8'));
        const { structure, commands } = importData;

        if (!Array.isArray(structure) || !Array.isArray(commands)) {
            throw new Error('Invalid import file format. Missing "structure" or "commands" array.');
        }

        await client.query('BEGIN');
        
        await client.query('DELETE FROM global_prompt_blocks WHERE provider = $1', [targetProvider]);
        for (let i = 0; i < structure.length; i++) {
            const block = structure[i];
            await client.query(
                'INSERT INTO global_prompt_blocks (provider, name, role, content, position, is_enabled, block_type) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [targetProvider, block.name, block.role, block.content, i, block.is_enabled, block.block_type]
            );
        }
        
        for (const cmd of commands) {
            await client.query(
                `INSERT INTO commands (command_tag, block_name, block_role, block_content, command_type)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (command_tag) DO UPDATE SET
                    block_name = EXCLUDED.block_name,
                    block_role = EXCLUDED.block_role,
                    block_content = EXCLUDED.block_content,
                    command_type = EXCLUDED.command_type,
                    updated_at = NOW()`,
                [cmd.command_tag.toUpperCase(), cmd.block_name, cmd.block_role, cmd.block_content, cmd.command_type]
            );
        }
        
        await client.query('COMMIT');
        res.json({ success: true, message: `Successfully imported config to provider '${targetProvider}'.` });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Import failed.', detail: error.message });
    } finally {
        client.release();
    }
};