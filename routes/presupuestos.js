const router = require('express').Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { generarPresupuestoPDF } = require('../services/pdfGenerator');
const fs = require('fs');

// Función para verificar si es Owner
async function isOwner(userId) {
  try {
    const [users] = await pool.execute('SELECT role FROM users WHERE id = ?', [userId]);
    if (users.length === 0) return false;
    return ['owner', 'dueño'].includes(users[0].role);
  } catch (error) {
    console.error('Error checking owner:', error);
    return false;
  }
}

// GET todas las plantillas (todos los usuarios autenticados pueden ver)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [plantillas] = await pool.execute(
      'SELECT * FROM presupuestos_plantillas WHERE activo = 1 ORDER BY marca, modelo'
    );
    res.json({ ok: true, plantillas });
  } catch (error) {
    console.error('Error GET /presupuestos:', error);
    res.status(500).json({ error: 'Error al obtener plantillas' });
  }
});

// GET una plantilla específica
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const [plantillas] = await pool.execute(
      'SELECT * FROM presupuestos_plantillas WHERE id = ? AND activo = 1',
      [req.params.id]
    );
    
    if (plantillas.length === 0) {
      return res.status(404).json({ error: 'Plantilla no encontrada' });
    }
    
    res.json({ ok: true, plantilla: plantillas[0] });
  } catch (error) {
    console.error('Error GET /presupuestos/:id:', error);
    res.status(500).json({ error: 'Error al obtener plantilla' });
  }
});

// POST crear plantilla (solo Owner)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    // Verificar que sea Owner
    if (!(await isOwner(userId))) {
      return res.status(403).json({ 
        error: 'Solo el Dueño puede crear plantillas de presupuesto' 
      });
    }

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

    const [result] = await pool.execute(
      `INSERT INTO presupuestos_plantillas 
       (modelo, marca, imagen_url, precio_contado, especificaciones_tecnicas, 
        planes_cuotas, bonificaciones, anticipo, created_by, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        modelo,
        marca,
        imagen_url || null,
        precio_contado || null,
        especificaciones_tecnicas || null,
        JSON.stringify(planes_cuotas) || null,
        bonificaciones || null,
        anticipo || null,
        userId
      ]
    );

    const [newPlantilla] = await pool.execute(
      'SELECT * FROM presupuestos_plantillas WHERE id = ?',
      [result.insertId]
    );

    res.json({ ok: true, plantilla: newPlantilla[0] });
  } catch (error) {
    console.error('Error POST /presupuestos:', error);
    res.status(500).json({ error: 'Error al crear plantilla' });
  }
});

// PUT actualizar plantilla (solo Owner)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    if (!(await isOwner(userId))) {
      return res.status(403).json({ 
        error: 'Solo el Dueño puede editar plantillas de presupuesto' 
      });
    }

    const { id } = req.params;
    const updates = req.body;
    
    const allowedFields = [
      'modelo', 'marca', 'imagen_url', 'precio_contado', 
      'especificaciones_tecnicas', 'planes_cuotas', 'bonificaciones', 
      'anticipo', 'activo'
    ];
    
    const setClause = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        if (key === 'planes_cuotas' && typeof value === 'object') {
          setClause.push(`${key} = ?`);
          values.push(JSON.stringify(value));
        } else {
          setClause.push(`${key} = ?`);
          values.push(value);
        }
      }
    }
    
    if (setClause.length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }
    
    values.push(id);
    
    await pool.execute(
      `UPDATE presupuestos_plantillas SET ${setClause.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );
    
    const [updated] = await pool.execute(
      'SELECT * FROM presupuestos_plantillas WHERE id = ?',
      [id]
    );
    
    res.json({ ok: true, plantilla: updated[0] });
  } catch (error) {
    console.error('Error PUT /presupuestos/:id:', error);
    res.status(500).json({ error: 'Error al actualizar plantilla' });
  }
});

// DELETE plantilla (solo Owner - soft delete)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    if (!(await isOwner(userId))) {
      return res.status(403).json({ 
        error: 'Solo el Dueño puede eliminar plantillas de presupuesto' 
      });
    }

    const { id } = req.params;
    
    await pool.execute(
      'UPDATE presupuestos_plantillas SET activo = 0, updated_at = NOW() WHERE id = ?',
      [id]
    );
    
    res.json({ ok: true, message: 'Plantilla eliminada exitosamente' });
  } catch (error) {
    console.error('Error DELETE /presupuestos/:id:', error);
    res.status(500).json({ error: 'Error al eliminar plantilla' });
  }
});

// POST generar PDF del presupuesto
router.post('/generar-pdf', authenticateToken, async (req, res) => {
  try {
    console.log(`User ${req.user.username || 'unknown'} (ID: ${req.user.userId || req.user.id}) accessing POST /generar-pdf`);
    
    const { filePath, fileName } = await generarPresupuestoPDF(req.body);
    
    // Enviar el archivo
    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error('Error sending file:', err);
      }
      // Eliminar archivo temporal inmediatamente después de enviarlo
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) {
          console.error('Error deleting temp file:', unlinkErr);
        } else {
          console.log('Temp file deleted successfully:', fileName);
        }
      });
    });
    
  } catch (error) {
    console.error('Error POST /presupuestos/generar-pdf:', error);
    res.status(500).json({ error: 'Error al generar PDF' });
  }
});

module.exports = router;