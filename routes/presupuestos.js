const express = require('express');
const { getDB } = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Obtener todos los presupuestos
router.get('/', authenticateToken, async (req, res) => {
  try {
    const pool = getDB();
    const [result] = await pool.query(`
      SELECT * FROM presupuestos 
      WHERE activo = 1 
      ORDER BY created_at DESC
    `);
    res.json(result);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al obtener presupuestos' });
  }
});

// Crear presupuesto (solo owner)
router.post('/', authenticateToken, authorizeRoles('owner', 'dueño'), async (req, res) => {
  try {
    const {
      modelo,
      marca,
      imagen_url,
      precio_contado,
      especificaciones_tecnicas,
      planes_cuotas,
      bonificaciones,
      anticipo
    } = req.body;

    if (!modelo || !marca) {
      return res.status(400).json({ error: 'Modelo y marca son obligatorios' });
    }

    const pool = getDB();
    const [result] = await pool.query(`
      INSERT INTO presupuestos (
        modelo, marca, imagen_url, precio_contado, 
        especificaciones_tecnicas, planes_cuotas, bonificaciones, 
        anticipo, activo, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `, [
      modelo,
      marca,
      imagen_url || null,
      precio_contado || null,
      especificaciones_tecnicas || null,
      JSON.stringify(planes_cuotas) || null,
      bonificaciones || null,
      anticipo || null,
      req.user.id
    ]);

    const [newPresupuesto] = await pool.query(
      'SELECT * FROM presupuestos WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json(newPresupuesto[0]);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al crear presupuesto' });
  }
});

// Actualizar presupuesto (solo owner)
router.put('/:id', authenticateToken, authorizeRoles('owner', 'dueño'), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      modelo,
      marca,
      imagen_url,
      precio_contado,
      especificaciones_tecnicas,
      planes_cuotas,
      bonificaciones,
      anticipo,
      activo
    } = req.body;

    const pool = getDB();
    await pool.query(`
      UPDATE presupuestos SET
        modelo = ?,
        marca = ?,
        imagen_url = ?,
        precio_contado = ?,
        especificaciones_tecnicas = ?,
        planes_cuotas = ?,
        bonificaciones = ?,
        anticipo = ?,
        activo = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      modelo,
      marca,
      imagen_url || null,
      precio_contado || null,
      especificaciones_tecnicas || null,
      JSON.stringify(planes_cuotas) || null,
      bonificaciones || null,
      anticipo || null,
      activo ? 1 : 0,
      id
    ]);

    const [updatedPresupuesto] = await pool.query(
      'SELECT * FROM presupuestos WHERE id = ?',
      [id]
    );

    if (updatedPresupuesto.length === 0) {
      return res.status(404).json({ error: 'Presupuesto no encontrado' });
    }

    res.json(updatedPresupuesto[0]);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al actualizar presupuesto' });
  }
});

// Eliminar presupuesto (solo owner)
router.delete('/:id', authenticateToken, authorizeRoles('owner', 'dueño'), async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getDB();
    
    await pool.query('DELETE FROM presupuestos WHERE id = ?', [id]);
    
    res.json({ ok: true, message: 'Presupuesto eliminado correctamente' });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al eliminar presupuesto' });
  }
});

module.exports = router;