const { validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const sql = require('../db');
const jwt = require('jsonwebtoken')



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

    res.json({ message: 'Login successful!', token });
};

module.exports = {
    handleRegister,
    handleLogin
}
