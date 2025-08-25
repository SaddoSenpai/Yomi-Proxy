// middleware/adminAuth.js
// Middleware to ensure only authenticated admins can access certain routes.

/**
 * Checks if the user is logged in as an admin.
 */
exports.adminAuth = (req, res, next) => {
    if (req.session && req.session.isAdmin) {
        return next(); // Admin is logged in, proceed
    } else {
        res.redirect('/admin'); // Not logged in, redirect to login page
    }
};