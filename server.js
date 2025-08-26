// server.js
// Main entry point for the Yomi Proxy application.

require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const fileUpload = require('express-fileupload');
const cors = require('cors');
const keyManager = require('./services/keyManager');
const tokenManager = require('./services/tokenManager');
const mainRoutes = require('./routes/mainRoutes');
const adminRoutes = require('./routes/adminRoutes');
const proxyController = require('./controllers/proxyController');
const { securityMiddleware } = require('./middleware/security');

// --- ADDED: For persistent database sessions ---
const pgSession = require('connect-pg-simple')(session);
const pool = require('./config/db'); // Your existing database pool

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

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

// --- DYNAMIC PROXY ROUTE ---
// This single route handles all built-in and custom providers.
const dynamicProxyRoute = '/:providerId/v1/chat/completions';

app.post(dynamicProxyRoute, securityMiddleware, (req, res) => {
    const { providerId } = req.params;
    const availableProviders = keyManager.getAvailableProviders();

    if (availableProviders.includes(providerId)) {
        console.log(`[Router] Dynamic route matched for provider: ${providerId}`);
        proxyController.proxyRequest(req, res, providerId);
    } else {
        console.warn(`[Router] 404 - No provider found for ID: ${providerId}`);
        res.status(404).json({ error: `Provider '${providerId}' not found or is not enabled.` });
    }
});

console.log(`[Router] Created DYNAMIC proxy endpoint: POST ${dynamicProxyRoute}`);


// Now, define the static file server
app.use(express.static('public'));

// --- MODIFIED: Session middleware now uses the database ---
app.use(session({
    store: new pgSession({
        pool: pool,                // Connection pool
        tableName: 'user_sessions' // Use a custom table name
    }),
    // IMPORTANT: Change this secret to a long, random string in your .env file
    secret: process.env.SESSION_SECRET || 'yomi-proxy-secret-key-change-me',
    resave: false,
    saveUninitialized: false, // Set to false for best practice
    cookie: {
        secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    }
}));

// Other Route Definitions
app.use('/', mainRoutes);
app.use('/admin', adminRoutes);

// --- Application Startup ---
async function startServer() {
    console.log('--- Yomi Proxy Starting Up ---');
    
    // Initialize managers that load data into memory
    await tokenManager.initialize();
    await keyManager.initialize();
    await keyManager.checkAllKeys();

    app.listen(PORT, () => {
        console.log(`\n[OK] Yomi Proxy is running on http://localhost:${PORT}`);
        if (keyManager.getAvailableProviders().length === 0) {
            console.warn('[CRITICAL WARN] No API keys or custom providers found! The proxy endpoints will not work.');
        }
    });
}

startServer();