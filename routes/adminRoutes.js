// routes/adminRoutes.js
// Defines all routes related to the admin panel.

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { adminAuth } = require('../middleware/adminAuth');

// --- Admin Pages (Publicly accessible parts of the admin area) ---
router.get('/', adminController.renderLoginPage);
router.post('/login', adminController.handleLogin);
router.get('/logout', adminController.handleLogout);

// --- Protected Admin Page ---
// This route now also uses the same middleware for consistency.
router.get('/dashboard', adminAuth, adminController.renderDashboard);

// --- API ROUTE PROTECTION ---
// MODIFIED: Apply the adminAuth middleware to ALL routes that start with /api
// This is more robust than applying it to each route individually.
router.use('/api', adminAuth);

// --- Admin API Endpoints (Now automatically protected by the line above) ---
router.get('/api/stats', adminController.getStats);
router.get('/api/server-time', adminController.getServerTime);
router.post('/api/recheck-keys', adminController.recheckApiKeys); // <-- NEW ROUTE

// Structure
router.get('/api/structure', adminController.getStructure);
router.put('/api/structure', adminController.updateStructure);
router.get('/api/summarizer-structure', adminController.getSummarizerStructure);
router.put('/api/summarizer-structure', adminController.updateSummarizerStructure);

// Commands
router.get('/api/commands', adminController.getCommands);
router.post('/api/commands', adminController.saveCommand);
router.delete('/api/commands/:id', adminController.deleteCommand);

// User Tokens
router.get('/api/tokens', adminController.getTokens);
router.post('/api/tokens', adminController.saveToken);
router.delete('/api/tokens/:id', adminController.deleteToken);

// Custom Providers
router.get('/api/custom-providers', adminController.getCustomProviders);
router.post('/api/custom-providers', adminController.saveCustomProvider);
router.delete('/api/custom-providers/:id', adminController.deleteCustomProvider);

// Logs
router.get('/api/logs', adminController.getLogs);
router.get('/api/logs/:id', adminController.getLogDetails);
router.delete('/api/logs/:id', adminController.deleteLog);
router.delete('/api/logs', adminController.deleteAllLogs);
router.get('/api/logging-settings', adminController.getLogSettings);
router.put('/api/logging-settings', adminController.updateLogSettings);

// Announcement
router.get('/api/announcement', adminController.getAnnouncement);
router.put('/api/announcement', adminController.updateAnnouncement);

// Import/Export
router.post('/api/import', adminController.importData);
router.get('/api/export', adminController.exportData);


module.exports = router;