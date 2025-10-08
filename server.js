const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const { initDatabase } = require('./config/database');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const leadRoutes = require('./routes/leads');
const webhookRoutes = require('./routes/webhook');
const app = express();
const PORT = process.env.PORT || 8080;

app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

// Rate limiting más permisivo para webhooks
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300 // Más solicitudes permitidas para webhooks
});

// ========== CORS CONFIGURATION - CORREGIDO ==========
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'https://www.crm3alluma.com.ar',
  'https://crm3alluma.com.ar'
];

app.use(cors({
  origin: function(origin, callback) {
    // Permitir requests sin origin (Postman, curl, apps móviles, webhooks)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('❌ CORS bloqueado para origen:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
}));
// ========== FIN CORS CONFIGURATION ==========

// Middleware
// app.use(limiter);
app.use(helmet());
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/presupuestos', presupuestosRoutes);  // ← NUEVO
app.use('/api/webhook', webhookLimiter, webhookRoutes);
// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Peugeot CRM API is running',
    timestamp: new Date().toISOString()
  });
});

// Initialize database and start server
initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Peugeot CRM API running on port ${PORT}`);
    console.log(`🔗 Webhook endpoint: http://localhost:${PORT}/api/webhook/zapier/meta-lead`);
    console.log(`🌍 CORS habilitado para:`, allowedOrigins.join(', '));
  });
}).catch(err => {
  console.error('❌ Failed to initialize database:', err);
  process.exit(1);
});