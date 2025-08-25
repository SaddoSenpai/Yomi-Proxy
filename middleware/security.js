// middleware/security.js
// Handles the security check for proxy endpoints based on .env settings.

const tokenManager = require('../services/tokenManager'); // <-- ADDED

const SECURITY_MODE = process.env.SECURITY || 'none';
const SHARED_PASSWORD = process.env.PASSWORD;

/**
 * Middleware to protect proxy routes if security is enabled.
 */
exports.securityMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

    if (SECURITY_MODE === 'none') {
        return next(); // No security, proceed
    }

    if (SECURITY_MODE === 'password') {
        if (token && token === SHARED_PASSWORD) {
            return next(); // Correct password, proceed
        } else {
            return res.status(401).json({ error: 'Invalid or missing password. Provide it in the Authorization header as "Bearer <password>".' });
        }
    }

    // --- NEW: Token-based security ---
    if (SECURITY_MODE === 'token') {
        if (!token) {
            return res.status(401).json({ error: 'Missing user token. Provide it in the Authorization header as "Bearer <token>".' });
        }
        
        const result = await tokenManager.verifyAndRateLimit(token);

        if (result.success) {
            req.userTokenInfo = result.tokenData; // Attach token info for logging
            return next();
        } else {
            return res.status(result.status).json({ error: result.message });
        }
    }
    // --- END NEW ---

    // Fallback for invalid security mode
    return res.status(500).json({ error: `Server security is misconfigured. Mode '${SECURITY_MODE}' is not supported.` });
};