require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const checkoutNodeJSSDK = require('@paypal/checkout-server-sdk');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'tu_stripe_secret_key');

const app = express();

// -----------------------------------------------------------------------------
// 1. CONFIGURACIÓN Y VARIABLES DE ENTORNO
// -----------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'clave_secreta_super_segura_2026';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5500';

// Credenciales de PayPal
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';

function environment() {
    return new checkoutNodeJSSDK.core.SandboxEnvironment(
        PAYPAL_CLIENT_ID,
        PAYPAL_CLIENT_SECRET
    );
}

function client() {
    return new checkoutNodeJSSDK.core.PayPalHttpClient(environment());
}

const paypalClient = (PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET) ? client() : null;

// -----------------------------------------------------------------------------
// 2. MIDDLEWARES DE SEGURIDAD
// -----------------------------------------------------------------------------
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10kb' }));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Demasiadas solicitudes desde esta IP, reintenta más tarde.' }
});
app.use('/api/', apiLimiter);

const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Demasiados intentos de autenticación. Intenta en una hora.' }
});

// -----------------------------------------------------------------------------
// 3. BASE DE DATOS SQLITE
// -----------------------------------------------------------------------------
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Error al conectar con SQLite:', err.message);
    else console.log('Conectado a la base de datos SQLite.');
});

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS wallets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE,
            balance_usd REAL DEFAULT 0.0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

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

    db.run(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL, 
            amount REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'USD',
            commission REAL NOT NULL,
            net_amount REAL NOT NULL,
            status TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
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
// 5. RUTAS DE AUTENTICACIÓN Y BILLETERA
// -----------------------------------------------------------------------------
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
            db.run(`INSERT INTO wallets (user_id, balance_usd) VALUES (?, 0.0)`, [userId]);

            res.status(201).json({ mensaje: 'Usuario registrado exitosamente.' });
        });
    } catch (error) {
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

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

app.get('/api/wallet', authenticateToken, (req, res) => {
    db.get(`SELECT balance_usd FROM wallets WHERE user_id = ?`, [req.user.id], (err, wallet) => {
        if (err) return res.status(500).json({ error: 'Error al obtener la billetera.' });
        res.json({
            userId: req.user.id,
            email: req.user.email,
            balance_usd: wallet ? wallet.balance_usd : 0.0
        });
    });
});

// -----------------------------------------------------------------------------
// 6. PASARELAS DE PAGO (PAYPAL & STRIPE)
// -----------------------------------------------------------------------------

// -- PayPal --
app.post('/api/checkout/create-order', authenticateToken, async (req, res) => {
    if (!paypalClient) return res.status(500).json({ error: 'PayPal no está configurado.' });

    const { monto, titulo } = req.body;
    if (!monto || monto <= 0) return res.status(400).json({ error: 'Monto inválido.' });

    const request = new checkoutNodeJSSDK.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [{
            amount: { currency_code: 'USD', value: Number(monto).toFixed(2) },
            description: titulo || 'Recarga de Saldo - Billetera',
            custom_id: String(req.user.id)
        }],
        application_context: {
            return_url: `${FRONTEND_URL}/pago-exitoso.html`,
            cancel_url: `${FRONTEND_URL}/pago-fallido.html`
        }
    });

    try {
        const order = await paypalClient.execute(request);
        const approvalLink = order.result.links.find(link => link.rel === 'approve').href;
        res.json({ id: order.result.id, approvalUrl: approvalLink });
    } catch (error) {
        console.error('Error al crear orden en PayPal:', error);
        res.status(500).json({ error: 'Error al generar PayPal.' });
    }
});

app.post('/api/checkout/capture-order', authenticateToken, async (req, res) => {
    if (!paypalClient) return res.status(500).json({ error: 'PayPal no está configurado.' });

    const { orderID } = req.body;
    if (!orderID) return res.status(400).json({ error: 'ID de orden requerido.' });

    const request = new checkoutNodeJSSDK.orders.OrdersCaptureRequest(orderID);
    request.requestBody({});

    try {
        const capture = await paypalClient.execute(request);
        const purchaseUnit = capture.result.purchase_units[0];
        const captureId = purchaseUnit.payments.captures[0].id;
        const amount = Number(purchaseUnit.payments.captures[0].amount.value);
        const status = capture.result.status;
        const userId = req.user.id;

        if (status === 'COMPLETED') {
            db.get(`SELECT id FROM payments WHERE payment_id = ?`, [captureId], (err, row) => {
                if (row) return res.json({ mensaje: 'El pago ya fue acreditado.', status });

                db.run(`INSERT INTO payments (payment_id, user_id, amount, status) VALUES (?, ?, ?, ?)`,
                    [captureId, userId, amount, status], (err) => {
                        if (err) return res.status(500).json({ error: 'Error al registrar pago.' });

                        db.run(`UPDATE wallets SET balance_usd = balance_usd + ? WHERE user_id = ?`,
                            [amount, userId], (err) => {
                                if (err) return res.status(500).json({ error: 'Error al actualizar saldo.' });
                                res.json({ mensaje: 'Pago acreditado con éxito.', status, amount });
                            });
                    });
            });
        } else {
            res.status(400).json({ error: 'El pago no se completó.', status });
        }
    } catch (error) {
        console.error('Error al capturar orden de PayPal:', error);
        res.status(500).json({ error: 'Error al procesar la captura.' });
    }
});

// -- Stripe --
app.post('/api/checkout/stripe', authenticateToken, async (req, res) => {
    try {
        const { montoTotal, titulo } = req.body;
        
        if (!montoTotal || montoTotal <= 0) {
            return res.status(400).json({ error: 'Monto inválido.' });
        }

        const comisionPlataforma = montoTotal * 0.05;
        const montoNetoUsuario = montoTotal - comisionPlataforma;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: titulo || 'Recarga de Saldo - Nexus Finance',
                        description: 'Recarga de saldo en billetera (Incluye comisión)'
                    },
                    unit_amount: Math.round(montoTotal * 100),
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${FRONTEND_URL}/pago-exitoso.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${FRONTEND_URL}/pago-fallido.html`,
            client_reference_id: String(req.user.id),
            metadata: {
                userId: String(req.user.id),
                comision: comisionPlataforma.toFixed(2),
                netoAsignar: montoNetoUsuario.toFixed(2)
            }
        });

        res.json({ 
            url: session.url,
            comision: comisionPlataforma,
            netoAsignar: montoNetoUsuario
        });

    } catch (error) {
        console.error('Error al crear sesión de Stripe:', error);
        res.status(500).json({ error: 'Error al procesar el pago con Stripe.' });
    }
});

// -----------------------------------------------------------------------------
// 7. HISTORIAL DE TRANSACCIONES
// -----------------------------------------------------------------------------
app.get('/api/transactions', authenticateToken, (req, res) => {
    const userId = req.user.id;

    db.all(
        `SELECT type, amount, currency, commission, net_amount, status, created_at 
         FROM transactions 
         WHERE user_id = ? 
         ORDER BY created_at DESC LIMIT 10`,
        [userId],
        (err, rows) => {
            if (err) {
                console.error('Error al obtener transacciones:', err);
                return res.status(500).json({ error: 'Error al obtener el historial.' });
            }
            res.json(rows);
        }
    );
});

// -----------------------------------------------------------------------------
// 8. ARRANQUE DEL SERVIDOR
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`Servidor seguro escuchando en el puerto ${PORT}`);
});
