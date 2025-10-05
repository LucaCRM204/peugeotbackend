const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB } = require('../config/database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'peugeot_crm_secret_2024';

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password, allowInactiveUsers } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
    }

    const pool = getDB();
    const [result] = await pool.query(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (result.length === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const user = result[0];

    if (!allowInactiveUsers && !user.active) {
      return res.status(403).json({ error: 'Usuario desactivado. Contacta al administrador.' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password: _, ...userWithoutPassword } = user;

    res.json({
      ok: true,
      token,
      user: userWithoutPassword
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Verificar token
router.get('/verify', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    const pool = getDB();
    const [result] = await pool.query(
      'SELECT id, name, email, role, reportsTo, active FROM users WHERE id = ?',
      [decoded.id]
    );

    if (result.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ ok: true, user: result[0] });
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({ error: 'Token inválido' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(403).json({ error: 'Token expirado' });
    }
    console.error('Verify error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;