
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();

// -----------------------------------------------------------------------------
// 1. CONFIGURACIÓN Y VARIABLES DE ENTORNO
// -----------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'clave_secreta_super_segura_2026';
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5500';

// Inicializar cliente de Mercado Pago
const mpClient = MP_ACCESS_TOKEN ? new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN }) : null;

// -----------------------------------------------------------------------------
// 2. MIDDLEWARES DE SEGURIDAD
// -----------------------------------------------------------------------------
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10kb' }));

// Limitador de peticiones general (Previene abusos y DoS)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100,
  message: { error: 'Demasiadas solicitudes desde esta IP, reintenta más tarde.' }
});
app.use('/api/', apiLimiter);

// Limitador estricto para rutas de autenticación
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10,
  message: { error: 'Demasiados intentos de autenticación. Intenta en una hora.' }
});

// -----------------------------------------------------------------------------
// 3. BASE DE DATOS SQLITE (Persistencia local)
// -----------------------------------------------------------------------------
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Error al conectar con SQLite:', err.message);
  else console.log('Conectado a la base de datos SQLite.');
});

db.serialize(() => {
  // Tabla de usuarios
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tabla de billetera/saldo
  db.run(`
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE,
      balance_ars REAL DEFAULT 0.0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Tabla de transacciones de pago (Prevención de duplicados)
  db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// -----------------------------------------------------------------------------
// 4. MIDDLEWARE DE AUTENTICACIÓN JWT
// -----------------------------------------------------------------------------
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Acceso denegado: Token no proporcionado.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido o expirado.' });
    req.user = user;
    next();
  });
}

// -----------------------------------------------------------------------------
// 5. RUTAS DE AUTENTICACIÓN
// -----------------------------------------------------------------------------

// Registro de usuario
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos.' });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    db.run(`INSERT INTO users (email, password) VALUES (?, ?)`, [email, hashedPassword], function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'El correo electrónico ya está registrado.' });
        }
        return res.status(500).json({ error: 'Error al registrar el usuario.' });
      }

      const userId = this.lastID;
      db.run(`INSERT INTO wallets (user_id, balance_ars) VALUES (?, 0.0)`, [userId]);

      res.status(201).json({ mensaje: 'Usuario registrado exitosamente.' });
    });
  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Login de usuario
app.post('/api/auth/login', authLimiter, (req, res) => {
  const { email, password } = req.body;

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err || !user) return res.status(400).json({ error: 'Credenciales inválidas.' });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Credenciales inválidas.' });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '4h' });
    res.json({ token, user: { id: user.id, email: user.email } });
  });
});

// Consultar saldo de billetera (Ruta protegida)
app.get('/api/wallet', authenticateToken, (req, res) => {
  db.get(`SELECT balance_ars FROM wallets WHERE user_id = ?`, [req.user.id], (err, wallet) => {
    if (err) return res.status(500).json({ error: 'Error al obtener la billetera.' });
    res.json({
      userId: req.user.id,
      email: req.user.email,
      balance_ars: wallet ? wallet.balance_ars : 0.0
    });
  });
});

// -----------------------------------------------------------------------------
// 6. RUTAS DE MERCADO PAGO (PROCESAMIENTO DE PAGOS REALES)
// -----------------------------------------------------------------------------

// Crear link/preferencia de pago (Ruta protegida)
app.post('/api/checkout/create-preference', authenticateToken, async (req, res) => {
  if (!mpClient) return res.status(500).json({ error: 'Mercado Pago no está configurado en el servidor.' });

  const { monto, titulo } = req.body;
  if (!monto || monto <= 0) return res.status(400).json({ error: 'Monto inválido.' });

  try {
    const preference = new Preference(mpClient);
    const result = await preference.create({
      body: {
        items: [
          {
            id: 'recarga-saldo',
            title: titulo || 'Recarga de Saldo - Mercados Globales',
            unit_price: Number(monto),
            quantity: 1,
            currency_id: 'ARS'
          }
        ],
        back_urls: {
          success: `${FRONTEND_URL}/pago-exitoso.html`,
          failure: `${FRONTEND_URL}/pago-fallido.html`,
          pending: `${FRONTEND_URL}/pago-pendiente.html`
        },
        auto_return: 'approved',
        notification_url: `${BACKEND_URL}/api/webhook/mercadopago`,
        external_reference: String(req.user.id) // Vincula el pago al ID del usuario autenticado
      }
    });

    res.json({ id: result.id, init_point: result.init_point });
  } catch (error) {
    console.error('Error al crear preferencia de Mercado Pago:', error);
    res.status(500).json({ error: 'Error al generar la pasarela de pago.' });
  }
});

// Webhook de Mercado Pago (Recepción de notificaciones de cobro)
app.post('/api/webhook/mercadopago', async (req, res) => {
  const { query } = req;
  const topic = query.topic || query.type;

  // Confirmar recepción a Mercado Pago de inmediato
  res.sendStatus(200);

  if (topic === 'payment' && mpClient) {
    const paymentId = query['data.id'] || query.id;
    if (!paymentId) return;

    try {
      const payment = new Payment(mpClient);
      const paymentData = await payment.get({ id: paymentId });

      const status = paymentData.status;
      const userId = paymentData.external_reference;
      const monto = paymentData.transaction_amount;

      if (status === 'approved' && userId) {
        // Comprobar si el pago ya fue procesado previamente
        db.get(`SELECT id FROM payments WHERE payment_id = ?`, [paymentId], (err, row) => {
          if (err) return console.error('Error al verificar pago repetido:', err);
          if (row) return console.log(`[MP Webhook] El pago ID ${paymentId} ya fue acreditado.`);

          // Registrar el pago e incrementar el saldo del usuario
          db.run(
            `INSERT INTO payments (payment_id, user_id, amount, status) VALUES (?, ?, ?, ?)`,
            [paymentId, userId, monto, status],
            (err) => {
              if (err) return console.error('Error al registrar pago:', err);

              db.run(
                `UPDATE wallets SET balance_ars = balance_ars + ? WHERE user_id = ?`,
                [monto, userId],
                (err) => {
                  if (err) return console.error('Error al acreditar saldo:', err);
                  console.log(`✅ [MP Webhook] ¡Exito! Saldo de $${monto} ARS acreditado al usuario ${userId}`);
                }
              );
            }
          );
        });
      }
    } catch (error) {
      console.error('Error procesando el webhook de pago:', error);
    }
  }
});

// -----------------------------------------------------------------------------
// 7. ARRANQUE DEL SERVIDOR
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
