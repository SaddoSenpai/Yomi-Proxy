// routes/proxyRoutes.js
// Dynamically creates explicit, absolute proxy endpoints for each available provider.

const express = require('express');
const router = express.Router(); // This is our main router
const keyManager = require('../services/keyManager');
const proxyController = require('../controllers/proxyController');
const { securityMiddleware } = require('../middleware/security');

// Get the list of providers that have keys configured in the .env file
const availableProviders = keyManager.getAvailableProviders();

// --- THE FIX: Define the full, absolute path directly on the main router ---
// Instead of creating a nested router, we build the full string for the endpoint
// and register it directly. This removes any ambiguity.
availableProviders.forEach(provider => {
    
    // Example: This will create the string "/deepseek/v1/chat/completions"
    const fullEndpointPath = `/${provider}/v1/chat/completions`;

    // Register the full path directly with the POST method.
    router.post(fullEndpointPath, securityMiddleware, (req, res) => {
        // Pass the provider name to the controller so it knows which API to call.
        proxyController.proxyRequest(req, res, provider);
    });
    
    console.log(`[Router] Created proxy endpoint: POST ${fullEndpointPath}`);
});

module.exports = router;