// controllers/mainController.js
// Controller for rendering the public-facing main page.

const keyManager = require('../services/keyManager');

/**
 * Renders the main page, passing in statistics about available providers.
 */
exports.renderMainPage = (req, res) => {
    const providerStats = keyManager.getProviderStats();
    const providers = Object.values(providerStats);
    
    // Get the base URL to display on the page
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    res.render('index', { providers, baseUrl });
};