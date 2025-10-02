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
    
    console.log('Intento de login para:', email);
    
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
      console.log('Usuario no encontrado o inactivo:', email);
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    console.log('Usuario encontrado:', { id: user.id, name: user.name, role: user.role, active: user.active });

    // Considera tanto booleanos como números para active
    const isActive = user.active === true || user.active === 1 || user.active === '1';

    // Permitir login de supervisores y vendedores aunque estén inactivos
    const canLoginInactive = allowInactiveUsers || ['vendedor', 'supervisor'].includes(user.role);
    
    if (!isActive && !canLoginInactive) {
      console.log('Usuario inactivo y sin permisos para login inactivo');
      return res.status(401).json({ error: 'Usuario inactivo. Contacta al administrador.' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      console.log('Contraseña incorrecta para:', email);
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const token = jwt.sign(
      { 
        userId: user.id,
        id: user.id,
        email: user.email, 
        role: user.role,
        name: user.name 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // No enviar password en la respuesta
    delete user.password;

    console.log('Login exitoso para:', email);

    res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        active: user.active,
        reportsTo: user.reportsTo || null
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

// TEMPORAL: Endpoint para debug - ELIMINAR EN PRODUCCIÓN
router.get('/debug/user/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const pool = getDB();
    const result = await pool.query(
      'SELECT id, name, email, role, active, "reportsTo" FROM users WHERE email = $1',
      [email]
    );
    
    if (result.rows.length === 0) {
      return res.json({ error: 'Usuario no encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;