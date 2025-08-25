// server.js
// Main entry point for the Yomi Proxy application.

require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const fileUpload = require('express-fileupload');
const cors = require('cors');
const keyManager = require('./services/keyManager');
const tokenManager = require('./services/tokenManager'); // <-- ADDED
const mainRoutes = require('./routes/mainRoutes');
const adminRoutes = require('./routes/adminRoutes');
const proxyController = require('./controllers/proxyController');
const { securityMiddleware } = require('./middleware/security');

const app = express();
const PORT = process.env.PORT || 3000;

// Universal Request Logger
app.use((req, res, next) => {
    console.log('\n--- INCOMING REQUEST RECEIVED ---');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Method: ${req.method}`);
    console.log(`Path: ${req.path}`);
    console.log('---------------------------------');
    next();
});

// --- Middleware Setup ---
app.use(cors());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());
app.set('view engine', 'ejs');

// Define API routes *before* static files
keyManager.initialize();
tokenManager.initialize(); // <-- ADDED
const availableProviders = keyManager.getAvailableProviders();
console.log('[DEBUG] Providers found by keyManager:', availableProviders);

availableProviders.forEach(provider => {
    const fullEndpointPath = `/${provider}/v1/chat/completions`;
    app.post(fullEndpointPath, securityMiddleware, (req, res) => {
        console.log(`[OK] Route handler for ${fullEndpointPath} executed.`);
        proxyController.proxyRequest(req, res, provider);
    });
    console.log(`[Router] Created DIRECT proxy endpoint: POST ${fullEndpointPath}`);
});

// Now, define the static file server
app.use(express.static('public'));

// Session middleware
app.use(session({
    secret: 'yomi-proxy-secret-key-change-me',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// Other Route Definitions
app.use('/', mainRoutes);
app.use('/admin', adminRoutes);

// --- Application Startup ---
async function startServer() {
    console.log('--- Yomi Proxy Starting Up ---');
    
    await keyManager.checkAllKeys();

    app.listen(PORT, () => {
        console.log(`\n[OK] Yomi Proxy is running on http://localhost:${PORT}`);
        if (availableProviders.length === 0) {
            console.warn('[CRITICAL WARN] No API keys found! The proxy endpoints were NOT created. Check your Replit Secrets.');
        }
    });
}

startServer();