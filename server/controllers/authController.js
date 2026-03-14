const { validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const client = require('../supabaseClient');
const jwt = require('jsonwebtoken')



const handleRegister = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const hash = await bcrypt.hash(password, 10);

    const { data, error } = await client
        .from('users')
        .insert([{ email, password: hash }]);

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.status(201).json({ message: 'User registered successfully!' });

}

const handleLogin = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const { data, error } = await client
        .from('users')
        .select()
        .eq('email', email)
        .single();

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    if (!data) {
        return res.status(401).json({ error: 'User not found' });
    }

    const isMatch = await bcrypt.compare(password, data.password);

    if (!isMatch) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: data.id, email: data.email }, process.env.JWT_SECRET, { expiresIn: '24h' })

    res.json({ message: 'Login successful!', token });
};

module.exports = {
    handleRegister,
    handleLogin
}