const { validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const sql = require('../db');
const jwt = require('jsonwebtoken')
const { revokeRefreshToken } = require('../gmailAuth');
const { getConnection } = require('../sync/gmailConnections');

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // matches the JWT's own 24h expiry

// Cross-site because the frontend and backend are on different Vercel
// project domains (different eTLD+1 under the public-suffix-listed
// vercel.app) — that requires SameSite=None, which browsers only honor
// alongside Secure. Locally the frontend/backend share the "localhost"
// site across ports, so Lax already covers it without needing https.
function sessionCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  };
}



const handleRegister = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const hash = await bcrypt.hash(password, 10);

    try {
        await sql`insert into users (email, password) values (${email}, ${hash})`;
        res.status(201).json({ message: 'User registered successfully!' });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Email already registered' });
        }
        console.error(error);
        res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
}

const handleLogin = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    let user;
    try {
        const rows = await sql`select * from users where email = ${email}`;
        user = rows[0];
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }

    // Same error for "no such user" and "wrong password" — telling them
    // apart lets an attacker enumerate which emails are registered.
    const invalidCredentials = () => res.status(401).json({ error: 'Invalid email or password' });

    if (!user) {
        return invalidCredentials();
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
        return invalidCredentials();
    }

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' })

    // The token itself never touches the response body — only the cookie
    // carries it, and it's httpOnly so client JS can't read it either.
    res.cookie('token', token, sessionCookieOptions());
    res.json({ message: 'Login successful!' });
};

const handleLogout = (req, res) => {
    res.clearCookie('token', sessionCookieOptions());
    res.json({ message: 'Logged out.' });
};

// Irreversible, so it requires the current password rather than trusting
// the session alone — a session cookie can outlive the moment the user
// actually meant to authorize something this destructive.
const handleDeleteAccount = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { password } = req.body;

    let user;
    try {
        const rows = await sql`select id, password from users where id = ${req.user.id}`;
        user = rows[0];
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }

    if (!user) {
        res.clearCookie('token', sessionCookieOptions());
        return res.status(404).json({ error: 'Account not found.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        return res.status(401).json({ error: 'Incorrect password.' });
    }

    try {
        // Revoke the Gmail grant at Google before the row (and the refresh
        // token stored on it) disappears — best-effort, same as disconnect.
        const connection = await getConnection(req.user.id);
        if (connection) {
            try {
                await revokeRefreshToken(connection.refreshToken);
            } catch (err) {
                console.warn(`Account deletion: Gmail revoke failed for user ${req.user.id}:`, err.message);
            }
        }
        // Cascades to jobs, gmail_connections, message_classifications.
        await sql`delete from users where id = ${req.user.id}`;
    } catch (error) {
        console.error('Account deletion failed:', error);
        return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }

    res.clearCookie('token', sessionCookieOptions());
    res.json({ message: 'Account deleted.' });
};

module.exports = {
    handleRegister,
    handleLogin,
    handleLogout,
    handleDeleteAccount,
}
