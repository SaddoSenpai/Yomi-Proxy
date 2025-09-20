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
        const announcementEnabled = await pool('app_config').where('key', 'announcement_enabled').select('value').first();
        if (announcementEnabled && announcementEnabled.value === 'true') {
            const messageResult = await pool('app_config').where('key', 'announcement_message').select('value').first();
            if (messageResult) {
                announcementMessage = messageResult.value;
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
