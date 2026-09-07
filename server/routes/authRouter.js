const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { handleRegister, handleLogin } = require('../controllers/authController');

const authRouter = express.Router();

// Slows down credential-stuffing / brute-force attempts against these two
// endpoints specifically, without rate-limiting the rest of the API.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts, please try again later.' },
});

authRouter.post('/register', authLimiter, [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 })
], handleRegister);

authRouter.post('/login', authLimiter, [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
], handleLogin);

module.exports = authRouter;