const express = require('express');
const { body } = require('express-validator');
const { handleRegister, handleLogin } = require('../controllers/authController');

const authRouter = express.Router();

authRouter.post('/register', [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 })
], handleRegister);

authRouter.post('/login', [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
], handleLogin);

module.exports = authRouter;