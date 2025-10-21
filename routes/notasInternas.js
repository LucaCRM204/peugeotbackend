const express = require('express');
const { getDB } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Obtener notas de un lead
router.get('/lead/:leadId', authenticateToken, async (req, res) => {
  try {
    const { leadId } = req.params;
    const pool = getDB();
    
    const [notas] = await pool.query(`
      SELECT * FROM notas_internas 
      WHERE lead_id = ? 
      ORDER BY timestamp DESC
    `, [leadId]);
    
    res.json(notas);
  } catch (err) {
    console.error('Error al obtener notas:', err);
    res.status(500).json({ error: 'Error al obtener notas internas' });
  }
});

// Crear nota
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { lead_id, texto } = req.body;
    const userId = req.user.userId || req.user.id;
    const userName = req.user.name;
    
    if (!lead_id || !texto) {
      return res.status(400).json({ error: 'Lead ID y texto son obligatorios' });
    }
    
    const pool = getDB();
    const [result] = await pool.query(`
      INSERT INTO notas_internas (lead_id, texto, usuario, user_id)
      VALUES (?, ?, ?, ?)
    `, [lead_id, texto, userName, userId]);
    
    const [newNota] = await pool.query(
      'SELECT * FROM notas_internas WHERE id = ?',
      [result.insertId]
    );
    
    res.status(201).json(newNota[0]);
  } catch (err) {
    console.error('Error al crear nota:', err);
    res.status(500).json({ error: 'Error al crear nota interna' });
  }
});

// Eliminar nota
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId || req.user.id;
    const pool = getDB();
    
    // Verificar que la nota pertenece al usuario o que sea gerente+
    const [nota] = await pool.query('SELECT user_id FROM notas_internas WHERE id = ?', [id]);
    const [user] = await pool.query('SELECT role FROM users WHERE id = ?', [userId]);
    
    if (nota.length === 0) {
      return res.status(404).json({ error: 'Nota no encontrada' });
    }
    
    const canDelete = nota[0].user_id === userId || 
                      ['owner', 'director', 'gerente'].includes(user[0]?.role);
    
    if (!canDelete) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar esta nota' });
    }
    
    await pool.query('DELETE FROM notas_internas WHERE id = ?', [id]);
    res.json({ ok: true, message: 'Nota eliminada correctamente' });
  } catch (err) {
    console.error('Error al eliminar nota:', err);
    res.status(500).json({ error: 'Error al eliminar nota' });
  }
});

module.exports = router;