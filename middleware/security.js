// middleware/security.js
// Handles the security check for proxy endpoints based on .env settings.

const SECURITY_MODE = process.env.SECURITY || 'none';
const SHARED_PASSWORD = process.env.PASSWORD;

/**
 * Middleware to protect proxy routes if security is enabled.
 */
exports.securityMiddleware = (req, res, next) => {
    if (SECURITY_MODE === 'none') {
        return next(); // No security, proceed
    }

    if (SECURITY_MODE === 'password') {
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

        if (token && token === SHARED_PASSWORD) {
            return next(); // Correct password, proceed
        } else {
            return res.status(401).json({ error: 'Invalid or missing password. Provide it in the Authorization header as "Bearer <password>".' });
        }
    }

    // Fallback for invalid security mode
    return res.status(500).json({ error: 'Server security is misconfigured.' });
};