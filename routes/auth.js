const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB } = require('../config/database');
const { JWT_SECRET } = require('../middleware/auth');
const router = express.Router();

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password, allowInactiveUsers } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
    }

    const pool = getDB();
    
    // Permitir usuarios inactivos si allowInactiveUsers es true
    const activeFilter = allowInactiveUsers ? '' : 'AND active = 1';
    
    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1 ${activeFilter}`,
      [email]
    );

    const user = result.rows[0];
    
    if (!user) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    // Permitir login de supervisores y vendedores aunque estén inactivos
    const canLoginInactive = allowInactiveUsers || ['vendedor', 'supervisor'].includes(user.role);
    
    if (!user.active && !canLoginInactive) {
      return res.status(401).json({ error: 'Usuario inactivo. Contacta al administrador.' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const token = jwt.sign(
      { 
        userId: user.id,  // Usar userId para consistencia
        id: user.id,      // Compatibilidad
        email: user.email, 
        role: user.role,
        name: user.name 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // No enviar password en la respuesta
    delete user.password;

    res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        active: user.active,
        reportsTo: user.reportsto || null  // PostgreSQL usa lowercase
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  res.json({ ok: true, message: 'Sesión cerrada correctamente' });
});

module.exports = router;