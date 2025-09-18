// controllers/mainController.js
// Controller for rendering the public-facing main page.

const keyManager = require('../services/keyManager');
const logService = require('../services/logService');
const promptService = require('../services/promptService');
const pool = require('../config/db'); // <-- IMPORT DATABASE POOL

/**
 * Renders the main page, passing in statistics about available providers.
 */
exports.renderMainPage = async (req, res) => {
    try {
        const providerStats = keyManager.getProviderStats();
        const providers = Object.values(providerStats);
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const securityMode = process.env.SECURITY || 'none';
        const logState = logService.getLogState();

        // --- NEW: Fetch announcement ---
        let announcementMessage = null;
        const result = await pool.query("SELECT value FROM app_config WHERE key = 'announcement_enabled'");
        if (result.rows.length > 0 && result.rows[0].value === 'true') {
            const messageResult = await pool.query("SELECT value FROM app_config WHERE key = 'announcement_message'");
            if (messageResult.rows.length > 0) {
                announcementMessage = messageResult.rows[0].value;
            }
        }

        res.render('index', { 
            providers, 
            baseUrl, 
            securityMode,
            loggingMode: logState.mode,
            loggingPurgeHours: logState.purgeHours,
            announcementMessage // Pass to the template
        });
    } catch (error) {
        console.error("Failed to render main page:", error);
        res.status(500).send("Error loading page.");
    }
};

/**
 * Renders the public commands page.
 */
exports.renderCommandsPage = async (req, res) => {
    try {
        const commands = await promptService.getCommands();
        const visibleCommands = commands.filter(cmd => cmd.command_type !== 'Prefill');
        res.render('commands', { commands: visibleCommands });
    } catch (error) {
        console.error('Failed to render commands page:', error);
        res.status(500).send('Error loading commands.');
    }
};