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

// Tasas de cambio simuladas (en producción usa una API como exchangerate-api.com)
const EXCHANGE_RATES = {
    USD: { EUR: 0.85, GBP: 0.73, MXN: 18.5, ARS: 350, COP: 3950, USD: 1 },
    EUR: { USD: 1.18, GBP: 0.86, MXN: 21.8, ARS: 412, COP: 4650, EUR: 1 },
    GBP: { USD: 1.37, EUR: 1.16, MXN: 25.3, ARS: 478, COP: 5400, GBP: 1 },
    MXN: { USD: 0.054, EUR: 0.046, GBP: 0.040, ARS: 18.9, COP: 213, MXN: 1 },
    ARS: { USD: 0.0029, EUR: 0.0024, GBP: 0.0021, MXN: 0.053, COP: 11.3, ARS: 1 },
    COP: { USD: 0.00025, EUR: 0.00021, GBP: 0.00019, MXN: 0.0047, ARS: 0.088, COP: 1 }
};

// -----------------------------------------------------------------------------
// 2. MIDDLEWARES DE SEGURIDAD
// -----------------------------------------------------------------------------
app.use(helmet());
app.use(cors({
    origin: FRONTEND_URL,
    credentials: true
}));
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
            nombre TEXT DEFAULT 'Usuario',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS wallets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE,
            balance_usd REAL DEFAULT 0.0,
            balance_eur REAL DEFAULT 0.0,
            balance_gbp REAL DEFAULT 0.0,
            balance_mxn REAL DEFAULT 0.0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            payment_id TEXT UNIQUE NOT NULL,
            user_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            provider TEXT NOT NULL, -- 'stripe' o 'paypal'
            status TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL, -- 'conversion', 'recarga', 'retiro'
            moneda_entrada TEXT,
            monto_entrada REAL,
            moneda_salida TEXT,
            monto_salida REAL,
            tasa_aplicada REAL,
            commission REAL DEFAULT 0,
            net_amount REAL,
            status TEXT DEFAULT 'completada',
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
// 5. RUTAS DE AUTENTICACIÓN Y USUARIO
// -----------------------------------------------------------------------------
app.post('/api/auth/register', authLimiter, async (req, res) => {
    const { email, password, nombre } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos.' });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        db.run(`INSERT INTO users (email, password, nombre) VALUES (?, ?, ?)`, 
            [email, hashedPassword, nombre || 'Usuario'], 
            function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ error: 'El correo electrónico ya está registrado.' });
                    }
                    return res.status(500).json({ error: 'Error al registrar el usuario.' });
                }

                const userId = this.lastID;
                db.run(`INSERT INTO wallets (user_id) VALUES (?)`, [userId]);

                res.status(201).json({ mensaje: 'Usuario registrado exitosamente.' });
            }
        );
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
        res.json({ token, user: { id: user.id, email: user.email, nombre: user.nombre } });
    });
});

// Perfil de usuario (NUEVO - para el frontend)
app.get('/api/user/profile', authenticateToken, (req, res) => {
    db.get(`SELECT id, email, nombre, created_at FROM users WHERE id = ?`, [req.user.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Usuario no encontrado.' });
        
        db.get(`SELECT * FROM wallets WHERE user_id = ?`, [req.user.id], (err, wallet) => {
            if (err) return res.status(500).json({ error: 'Error al obtener billetera.' });
            
            res.json({
                id: user.id,
                email: user.email,
                nombre: user.nombre,
                created_at: user.created_at,
                balance: wallet ? wallet.balance_usd : 0,
                wallets: wallet || {}
            });
        });
    });
});

// -----------------------------------------------------------------------------
// 6. RUTAS DE CONVERSIÓN DE MONEDAS (NUEVO)
// -----------------------------------------------------------------------------
app.get('/api/convert', authenticateToken, (req, res) => {
    const { from, to, amount } = req.query;
    
    if (!from || !to || !amount) {
        return res.status(400).json({ error: 'Faltan parámetros: from, to, amount' });
    }

    const monto = parseFloat(amount);
    if (isNaN(monto) || monto <= 0) {
        return res.status(400). json({ error: 'Monto inválido' });
    }

    // Verificar soporte de monedas
    if (!EXCHANGE_RATES[from] || !EXCHANGE_RATES[from][to]) {
        return res.status(400).json({ error: 'Moneda no soportada' });
    }

    const tasa = EXCHANGE_RATES[from][to];
    const montoConvertido = monto * tasa;
    const comision = montoConvertido * 0.05; // 5% comisión
    const neto = montoConvertido - comision;

    res.json({
        from,
        to,
        amount: monto,
        rate: tasa,
        converted: montoConvertido,
        commission: comision.toFixed(2),
        netResult: neto.toFixed(2),
        timestamp: new Date().toISOString()
    });
});

// Ejecutar conversión y guardar en historial (NUEVO)
app.post('/api/convert', authenticateToken, (req, res) => {
    const { from, to, amount } = req.body;
    const userId = req.user.id;

    if (!from || !to || !amount) {
        return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    const monto = parseFloat(amount);
    if (isNaN(monto) || monto <= 0) {
        return res.status(400).json({ error: 'Monto inválido' });
    }

    if (!EXCHANGE_RATES[from] || !EXCHANGE_RATES[from][to]) {
        return res.status(400).json({ error: 'Moneda no soportada' });
    }

    const tasa = EXCHANGE_RATES[from][to];
    const montoSalida = monto * tasa;
    const comision = montoSalida * 0.05;
    const neto = montoSalida - comision;

    // Guardar en historial
    db.run(`
        INSERT INTO transactions 
        (user_id, type, moneda_entrada, monto_entrada, moneda_salida, monto_salida, tasa_aplicada, commission, net_amount)
        VALUES (?, 'conversion', ?, ?, ?, ?, ?, ?, ?)
    `, [userId, from, monto, to, neto, tasa, comision, neto], function(err) {
        if (err) {
            console.error('Error guardando transacción:', err);
            return res.status(500).json({ error: 'Error al guardar la transacción' });
        }

        res.json({
            success: true,
            transactionId: this.lastID,
            from,
            to,
            amount: monto,
            rate: tasa,
            commission: comision.toFixed(2),
            netResult: neto.toFixed(2),
            timestamp: new Date().toISOString()
        });
    });
});

// -----------------------------------------------------------------------------
// 7. PASARELAS DE PAGO (PAYPAL & STRIPE)
// -----------------------------------------------------------------------------

// -- PayPal --
app.post('/api/checkout/paypal', authenticateToken, async (req, res) => {
    if (!paypalClient) return res.status(500).json({ error: 'PayPal no está configurado.' });

    const { montoTotal, descripcion } = req.body;
    if (!montoTotal || montoTotal <= 0) return res.status(400).json({ error: 'Monto inválido.' });

    const request = new checkoutNodeJSSDK.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [{
            amount: { 
                currency_code: 'USD', 
                value: Number(montoTotal).toFixed(2) 
            },
            description: descripcion || 'Recarga de Saldo - Nexus Finance',
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
        res.json({ 
            id: order.result.id, 
            approvalUrl: approvalLink 
        });
    } catch (error) {
        console.error('Error al crear orden en PayPal:', error);
        res.status(500).json({ error: 'Error al generar orden de PayPal.' });
    }
});

app.post('/api/checkout/capture-paypal', authenticateToken, async (req, res) => {
    if (!paypalClient) return res.status(500).json({ error: 'PayPal no está configurado.' });

    const { orderID } = req.body;
    if (!orderID) return res.status(400).json({ error: 'ID de orden requerido.' });

    const request = new checkoutNodeJSSDK.orders.OrdersCaptureRequest(orderID);
    request.requestBody({});

    try {
        const capture = await paypalClient.execute(request);
        const purchaseUnit = capture.result.purchase_units[0];
        const captureData = purchaseUnit.payments.captures[0];
        const captureId = captureData.id;
        const amount = Number(captureData.amount.value);
        const status = capture.result.status;
        const userId = req.user.id;

        if (status === 'COMPLETED') {
            // Verificar si ya fue procesado
            db.get(`SELECT id FROM payments WHERE payment_id = ?`, [captureId], (err, row) => {
                if (row) return res.json({ mensaje: 'El pago ya fue acreditado.', status });

                // Registrar pago
                db.run(`INSERT INTO payments (payment_id, user_id, amount, provider, status) VALUES (?, ?, ?, ?, ?)`,
                    [captureId, userId, amount, 'paypal', status], (err) => {
                        if (err) return res.status(500).json({ error: 'Error al registrar pago.' });

                        // Actualizar saldo
                        db.run(`UPDATE wallets SET balance_usd = balance_usd + ? WHERE user_id = ?`,
                            [amount, userId], (err) => {
                                if (err) return res.status(500).json({ error: 'Error al actualizar saldo.' });
                                
                                // Registrar en transacciones
                                db.run(`
                                    INSERT INTO transactions (user_id, type, moneda_entrada, monto_entrada, moneda_salida, monto_salida, status)
                                    VALUES (?, 'recarga', 'USD', ?, 'USD', ?, 'completada')
                                `, [userId, amount, amount]);
                                
                                res.json({ 
                                    mensaje: 'Pago acreditado con éxito.', 
                                    status, 
                                    amount,
                                    transactionId: captureId
                                });
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
                        description: `Recarga de saldo (Comisión plataforma: $${comisionPlataforma.toFixed(2)})`
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

// Webhook de Stripe para confirmar pagos (opcional pero recomendado)
app.post('/api/webhooks/stripe', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        console.log(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = parseInt(session.client_reference_id);
        const amount = parseFloat(session.metadata.netoAsignar);
        
        // Actualizar saldo del usuario
        db.run(`UPDATE wallets SET balance_usd = balance_usd + ? WHERE user_id = ?`,
            [amount, userId], (err) => {
                if (err) console.error('Error actualizando saldo:', err);
                
                // Registrar pago
                db.run(`INSERT INTO payments (payment_id, user_id, amount, provider, status) VALUES (?, ?, ?, ?, ?)`,
                    [session.payment_intent, userId, amount, 'stripe', 'COMPLETED']);
                    
                // Registrar transacción
                db.run(`
                    INSERT INTO transactions (user_id, type, moneda_entrada, monto_entrada, moneda_salida, monto_salida, status)
                    VALUES (?, 'recarga', 'USD', ?, 'USD', ?, 'completada')
                `, [userId, amount, amount]);
            });
    }

    res.json({received: true});
});

// -----------------------------------------------------------------------------
// 8. HISTORIAL DE TRANSACCIONES
// -----------------------------------------------------------------------------
app.get('/api/transactions', authenticateToken, (req, res) => {
    const userId = req.user.id;

    db.all(
        `SELECT 
            id,
            type as tipo,
            moneda_entrada as monedaEntrada,
            monto_entrada as montoEntrada,
            moneda_salida as monedaSalida,
            monto_salida as montoSalida,
            tasa_aplicada as tasaAplicada,
            commission,
            net_amount as netAmount,
            status as estado,
            created_at as fecha
         FROM transactions 
         WHERE user_id = ? 
         ORDER BY created_at DESC 
         LIMIT 50`,
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

// Billetera del usuario
app.get('/api/wallet', authenticateToken, (req, res) => {
    db.get(`SELECT * FROM wallets WHERE user_id = ?`, [req.user.id], (err, wallet) => {
        if (err) return res.status(500).json({ error: 'Error al obtener la billetera.' });
        
        if (!wallet) {
            // Crear billetera si no existe
            db.run(`INSERT INTO wallets (user_id) VALUES (?)`, [req.user.id], function(err) {
                if (err) return res.status(500).json({ error: 'Error al crear billetera.' });
                res.json({
                    userId: req.user.id,
                    email: req.user.email,
                    balance_usd: 0,
                    balance_eur: 0,
                    balance_gbp: 0,
                    balance_mxn: 0
                });
            });
        } else {
            res.json({
                userId: req.user.id,
                email: req.user.email,
                balance_usd: wallet.balance_usd,
                balance_eur: wallet.balance_eur,
                balance_gbp: wallet.balance_gbp,
                balance_mxn: wallet.balance_mxn
            });
        }
    });
});

// -----------------------------------------------------------------------------
// 9. MANEJO DE ERRORES Y ARRANQUE
// -----------------------------------------------------------------------------
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor Nexus Finance escuchando en http://localhost:${PORT}`);
    console.log(`📁 Base de datos: ${dbPath}`);
    console.log(`🌐 Frontend permitido: ${FRONTEND_URL}`);
});
