// routes/adminRoutes.js
// Defines all routes related to the admin panel.

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { adminAuth } = require('../middleware/adminAuth');

// --- Admin Pages ---
router.get('/', adminController.renderLoginPage);
router.post('/login', adminController.handleLogin);
router.get('/dashboard', adminAuth, adminController.renderDashboard);
router.get('/logout', adminController.handleLogout);

// --- Admin API Endpoints (protected by adminAuth middleware) ---
router.get('/api/stats', adminAuth, adminController.getStats);

// Structure
router.get('/api/structure', adminAuth, adminController.getStructure);
router.put('/api/structure', adminAuth, adminController.updateStructure);

// Commands
router.get('/api/commands', adminAuth, adminController.getCommands);
router.post('/api/commands', adminAuth, adminController.saveCommand);
router.delete('/api/commands/:id', adminAuth, adminController.deleteCommand);

// User Tokens (NEW)
router.get('/api/tokens', adminAuth, adminController.getTokens);
router.post('/api/tokens', adminAuth, adminController.saveToken);
router.delete('/api/tokens/:id', adminAuth, adminController.deleteToken);

// Import/Export
router.post('/api/import', adminAuth, adminController.importData);
router.get('/api/export', adminAuth, adminController.exportData);


module.exports = router;