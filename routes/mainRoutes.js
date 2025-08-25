// routes/mainRoutes.js
// Defines the route for the public-facing main page.

const express = require('express');
const router = express.Router();
const mainController = require('../controllers/mainController');

// GET / - Renders the main page with provider information.
router.get('/', mainController.renderMainPage);

module.exports = router;