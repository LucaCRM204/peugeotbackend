const express = require('express');
const { getDB } = require('../config/database');

const router = express.Router();

router.post('/facebook-lead', async (req, res) => {
  try {
    const {
      nombre, telefono, email, modelo,
      utm_source, utm_campaign, form_id, ad_id,
      zapier_secret
    } = req.body;

    if (zapier_secret !== process.env.ZAPIER_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!nombre || !telefono) {
      return res.status(400).json({ error: 'Nombre y teléfono son obligatorios' });
    }

    const pool = getDB();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [vendedoresResult] = await connection.query(`
        SELECT id FROM users 
        WHERE role = 'vendedor' AND active = 1 
        ORDER BY id
      `);

      const vendedores = vendedoresResult;
      let vendedorId = null;

      if (vendedores.length > 0) {
        const [lastLeadResult] = await connection.query(
          'SELECT vendedor FROM leads ORDER BY id DESC LIMIT 1'
        );
        
        if (lastLeadResult.length > 0 && lastLeadResult[0].vendedor) {
          const lastVendedorId = lastLeadResult[0].vendedor;
          const currentIndex = vendedores.findIndex(v => v.id === lastVendedorId);
          const nextIndex = (currentIndex + 1) % vendedores.length;
          vendedorId = vendedores[nextIndex].id;
        } else {
          vendedorId = vendedores[0].id;
        }
      }

      const [result] = await connection.query(`
        INSERT INTO leads (
          nombre, telefono, email, modelo, fuente, vendedor, 
          notas, estado, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        nombre, telefono, email || null,
        modelo || 'Consulta general', 'meta', vendedorId,
        `Campaña: ${utm_campaign || 'N/A'}\nForm ID: ${form_id || 'N/A'}\nAd ID: ${ad_id || 'N/A'}`,
        'nuevo'
      ]);

      const leadId = result.insertId;

      await connection.query(
        'INSERT INTO lead_history (leadId, estado, usuario) VALUES (?, ?, ?)',
        [leadId, 'nuevo', 'Sistema - Facebook']
      );

      await connection.commit();

      res.status(201).json({
        ok: true,
        leadId,
        mensaje: 'Lead creado exitosamente',
        vendedorAsignado: vendedorId
      });

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

  } catch (error) {
    console.error('Error en webhook:', error);
    res.status(500).json({ 
      error: 'Error al procesar lead',
      detalle: error.message 
    });
  }
});

router.get('/facebook-lead', (req, res) => {
  res.json({ 
    status: 'active',
    message: 'Webhook funcionando',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;