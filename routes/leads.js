const router = require('express').Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

// Función para obtener equipo del usuario basado en jerarquía
async function getUserTeam(userId) {
  try {
    const [users] = await pool.execute('SELECT * FROM users');
    const userMap = new Map(users.map(u => [u.id, u]));
    
    let currentUser = userMap.get(userId);
    if (!currentUser) return 'roberto';
    
    if (['owner', 'director'].includes(currentUser.role)) {
      return 'both';
    }
    
    while (currentUser && currentUser.reportsTo) {
      currentUser = userMap.get(currentUser.reportsTo);
      if (!currentUser) break;
      
      if (currentUser.role === 'gerente') {
        if (currentUser.name === 'Daniel Mottino') return 'daniel';
        if (currentUser.name === 'Roberto Sauer') return 'roberto';
      }
    }
    
    return 'roberto';
  } catch (error) {
    console.error('Error getUserTeam:', error);
    return 'roberto';
  }
}

// Función para verificar permisos de eliminación
async function canDeleteLead(userId) {
  try {
    const [users] = await pool.execute('SELECT role FROM users WHERE id = ?', [userId]);
    if (users.length === 0) return false;
    
    const userRole = users[0].role;
    return ['owner', 'dueño'].includes(userRole);
  } catch (error) {
    console.error('Error checking delete permissions:', error);
    return false;
  }
}

// GET todos los leads
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [leads] = await pool.execute('SELECT * FROM leads ORDER BY last_status_change DESC');
    res.json({ ok: true, leads });
  } catch (error) {
    console.error('Error GET /leads:', error);
    res.status(500).json({ error: 'Error al obtener leads' });
  }
});

// GET un lead
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const userTeam = await getUserTeam(req.user.userId);
    
    let query = 'SELECT * FROM leads WHERE id = ?';
    let params = [req.params.id];
    
    if (userTeam !== 'both') {
      query += ' AND equipo = ?';
      params.push(userTeam);
    }
    
    const [leads] = await pool.execute(query, params);
    if (leads.length === 0) {
      return res.status(404).json({ error: 'Lead no encontrado' });
    }
    res.json({ ok: true, lead: leads[0] });
  } catch (error) {
    console.error('Error GET /leads/:id:', error);
    res.status(500).json({ error: 'Error al obtener lead' });
  }
});

// POST crear lead
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      nombre,
      telefono,
      modelo,
      formaPago = 'Contado',
      infoUsado = '',
      entrega = false,
      fecha = new Date().toISOString().split('T')[0],
      estado = 'nuevo',
      fuente = 'otro',
      notas = '',
      vendedor = null,
      equipo = 'roberto'
    } = req.body;

    if (!['roberto', 'daniel'].includes(equipo)) {
      return res.status(400).json({ error: 'Equipo inválido. Debe ser "roberto" o "daniel"' });
    }

    let notasCompletas = notas;
    if (infoUsado) {
      notasCompletas += `\nInfo usado: ${infoUsado}`;
    }
    if (entrega) {
      notasCompletas += `\nEntrega usado: Si`;
    }

    let assigned_to = vendedor;
    if (!assigned_to) {
      const [vendedoresResult] = await pool.execute(`
        SELECT u.id 
        FROM users u
        WHERE u.role = 'vendedor' 
        AND u.active = 1
        AND EXISTS (
          SELECT 1 FROM users gerente 
          WHERE gerente.role = 'gerente' 
          AND gerente.name = ?
          AND (
            u.reportsTo IN (
              SELECT supervisor.id FROM users supervisor 
              WHERE supervisor.role = 'supervisor' 
              AND supervisor.reportsTo = gerente.id
            )
          )
        )
      `, [equipo === 'daniel' ? 'Daniel Mottino' : 'Roberto Sauer']);
      
      if (vendedoresResult.length > 0) {
        const randomIndex = Math.floor(Math.random() * vendedoresResult.length);
        assigned_to = vendedoresResult[randomIndex].id;
      }
    }

    const created_by = req.user.userId;

    const [result] = await pool.execute(
      `INSERT INTO leads (nombre, telefono, modelo, formaPago, estado, fuente, notas, assigned_to, equipo, created_by, created_at, last_status_change) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [nombre, telefono, modelo, formaPago, estado, fuente, notasCompletas, assigned_to, equipo, created_by]
    );

    const [newLead] = await pool.execute('SELECT * FROM leads WHERE id = ?', [result.insertId]);
    res.json({ ok: true, lead: newLead[0] });
  } catch (error) {
    console.error('Error POST /leads:', error);
    res.status(500).json({ error: 'Error al crear lead' });
  }
});

// PUT actualizar lead
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const [currentUserData] = await pool.execute('SELECT role FROM users WHERE id = ?', [req.user.userId]);
    const userRole = currentUserData[0]?.role;
    
    if (!['vendedor'].includes(userRole)) {
      const userTeam = await getUserTeam(req.user.userId);
      if (userTeam !== 'both') {
        const [existingLead] = await pool.execute('SELECT equipo FROM leads WHERE id = ?', [id]);
        if (existingLead.length === 0) {
          return res.status(404).json({ error: 'Lead no encontrado' });
        }
        if (existingLead[0].equipo !== userTeam) {
          return res.status(403).json({ error: 'No tienes acceso a este lead' });
        }
      }
    } else {
      const [existingLead] = await pool.execute('SELECT assigned_to FROM leads WHERE id = ?', [id]);
      if (existingLead.length === 0) {
        return res.status(404).json({ error: 'Lead no encontrado' });
      }
      if (existingLead[0].assigned_to !== req.user.userId) {
        return res.status(403).json({ error: 'No tienes acceso a este lead' });
      }
    }
    
    // ✅ AGREGADO 'fecha' a los campos permitidos
    const allowedFields = ['nombre', 'telefono', 'modelo', 'formaPago', 'estado', 'fuente', 'notas', 'assigned_to', 'vendedor', 'equipo', 'fecha'];
    
    const setClause = [];
    const values = [];
    let isUpdatingStatus = false;
    
    for (const [key, value] of Object.entries(updates)) {
      const fieldName = key === 'vendedor' ? 'assigned_to' : key;
      
      if (allowedFields.includes(key)) {
        if (key === 'equipo' && !['roberto', 'daniel'].includes(value)) {
          return res.status(400).json({ error: 'Equipo inválido' });
        }
        
        if (key === 'estado') {
          isUpdatingStatus = true;
        }
        
        setClause.push(`${fieldName} = ?`);
        values.push(value === undefined ? null : value);
      }
    }
    
    if (isUpdatingStatus) {
      setClause.push('last_status_change = NOW()');
    }
    
    if (setClause.length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }
    
    values.push(id);
    
    await pool.execute(
      `UPDATE leads SET ${setClause.join(', ')} WHERE id = ?`,
      values
    );
    
    const [updated] = await pool.execute('SELECT * FROM leads WHERE id = ?', [id]);
    res.json({ ok: true, lead: updated[0] });
  } catch (error) {
    console.error('Error PUT /leads/:id:', error);
    res.status(500).json({ error: 'Error al actualizar lead' });
  }
});

// DELETE eliminar lead
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const hasDeletePermission = await canDeleteLead(userId);
    if (!hasDeletePermission) {
      return res.status(403).json({ 
        error: 'No tienes permisos para eliminar leads. Solo el Dueño puede realizar esta acción.'
      });
    }

    const [existingLead] = await pool.execute('SELECT * FROM leads WHERE id = ?', [id]);
    if (existingLead.length === 0) {
      return res.status(404).json({ error: 'Lead no encontrado' });
    }

    const userTeam = await getUserTeam(userId);
    if (userTeam !== 'both') {
      if (existingLead[0].equipo !== userTeam) {
        return res.status(403).json({ error: 'No tienes acceso a este lead' });
      }
    }

    const leadInfo = existingLead[0];
    
    await pool.execute('DELETE FROM leads WHERE id = ?', [id]);
    
    console.log(`Lead eliminado por usuario ${userId}:`, {
      leadId: id,
      cliente: leadInfo.nombre,
      telefono: leadInfo.telefono,
      modelo: leadInfo.modelo,
      vendedor: leadInfo.assigned_to,
      equipo: leadInfo.equipo,
      timestamp: new Date().toISOString()
    });

    res.json({ 
      ok: true, 
      message: 'Lead eliminado exitosamente',
      deletedLead: {
        id: leadInfo.id,
        nombre: leadInfo.nombre,
        telefono: leadInfo.telefono,
        modelo: leadInfo.modelo
      }
    });
  } catch (error) {
    console.error('Error DELETE /leads/:id:', error);
    res.status(500).json({ error: 'Error al eliminar lead' });
  }
});

// Endpoint webhook
router.post('/webhook/:equipo', authenticateToken, async (req, res) => {
  try {
    const equipoFromUrl = req.params.equipo;
    
    if (!['roberto', 'daniel'].includes(equipoFromUrl)) {
      return res.status(400).json({ error: 'Equipo inválido en URL' });
    }
    
    const leadData = { ...req.body, equipo: equipoFromUrl };
    
    req.body = leadData;
    return router.handle(req, res, 'post', '/');
  } catch (error) {
    console.error('Error POST /leads/webhook/:equipo:', error);
    res.status(500).json({ error: 'Error al crear lead desde webhook' });
  }
});

module.exports = router;