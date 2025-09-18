// middleware/adminAuth.js
// Middleware to ensure only authenticated admins can access certain routes.

/**
 * Checks if the user is logged in as an admin.
 * Differentiates between API requests (expecting JSON) and page requests (expecting HTML) on failure.
 */
exports.adminAuth = (req, res, next) => {
    // --- ADDED: Verbose logging for debugging ---
    console.log('\n--- [adminAuth Middleware] ---');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Request URL: ${req.originalUrl}`);
    console.log(`Session Exists: ${!!req.session}`);
    console.log(`Is Admin in Session: ${req.session ? !!req.session.isAdmin : 'N/A'}`);
    console.log(`Request Accepts JSON: ${req.accepts('json')}`);
    console.log('----------------------------\n');
    // --- END: Verbose logging ---

    // If the session is valid and the user is an admin, continue to the requested route.
    if (req.session && req.session.isAdmin) {
        console.log('[adminAuth] SUCCESS: User is authenticated. Proceeding...');
        return next();
    }

    // If not authenticated, check what kind of content the request is asking for.
    if (req.accepts('json')) {
        // The request is from our JavaScript 'fetch' call which wants a JSON response.
        console.error('[adminAuth] FAILURE: API request is NOT authenticated. Sending 401 JSON error.');
        return res.status(401).json({ error: 'Unauthorized. Your session may have expired. Please log in again.' });
    } else {
        // The request is from a browser navigating directly to a page.
        console.warn('[adminAuth] FAILURE: Page request is NOT authenticated. Redirecting to /admin.');
        res.redirect('/admin');
    }
};