const express = require('express');
const cors = require('cors');

const app = express();

// Middlewares
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

// ==========================================
middleware para simular verificación de Token
// ==========================================
function verificarTokenMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    // Para desarrollo, permitimos pasar si hay token, o puedes bloquear estrictamente:
    if (!token) {
        // Si prefieres estricto: return res.status(401).json({ error: 'Token no proporcionado o inválido' });
    }
    
    // Simulamos un usuario autenticado predeterminado
    req.user = { id: 'user_123', nombre: 'Emanuel Jesús Kubitz' };
    next();
}

// ==========================================
// 1. ENDPOINT DE CONVERSIÓN DE DIVISAS
// ==========================================
// Coincide con: `${API_BASE_URL}/convert?from=${from}&to=${to}&amount=${amount}`
app.get('/api/convert', (req, res) => {
    try {
        const { from, to, amount } = req.query;
        const parsedAmount = parseFloat(amount);

        if (!parsedAmount || parsedAmount <= 0) {
            return res.status(400).json({ error: 'Ingresa un monto válido para la conversión.' });
        }

        // Tasa de cambio simulada (ej: 1 USD = 0.85 EUR)
        const rate = 0.85; 
        const feePercentage = 0.05; // 5% de comisión

        const commission = parsedAmount * feePercentage;
        const netAmountAfterFee = parsedAmount - commission;
        const netResult = netAmountAfterFee * rate;

        // Retornamos las propiedades exactas que tu frontend espera leer
        res.json({
            from: from,
            to: to,
            rate: rate,
            commission: commission.toFixed(2),
            netResult: netResult.toFixed(2)
        });

    } catch (err) {
        res.status(500).json({ error: 'Error interno en el servidor al convertir.' });
    }
});

// ==========================================
// 2. ENDPOINT DE PERFIL DE USUARIO
// ==========================================
app.get('/api/user/profile', verificarTokenMiddleware, (req, res) => {
    try {
        res.json({
            nombre: req.user.nombre,
            balance: 1540.50, // Balance simulado en USD
            email: 'emanuel@nexusfinance.com'
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener el perfil del usuario.' });
    }
});

// ==========================================
// 3. ENDPOINTS DE PAGO / RECARGAS (Stripe & PayPal)
// ==========================================
app.post('/api/checkout/stripe', verificarTokenMiddleware, (req, res) => {
    try {
        const { montoTotal, titulo } = req.body;
        
        if (!montoTotal || montoTotal <= 0) {
            return res.status(400).json({ error: 'Monto de recarga inválido.' });
        }

        // Aquí integrarías el SDK oficial de Stripe
        // Respondemos con la URL simulada que tu frontend redirigirá (`window.location.href = data.url`)
        res.json({
            success: true,
            url: 'https://checkout.stripe.com/pay/mock_success_session'
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al procesar la sesión de Stripe.' });
    }
});

app.post('/api/checkout/paypal', verificarTokenMiddleware, (req, res) => {
    try {
        const { montoTotal, descripcion } = req.body;
        
        if (!montoTotal || montoTotal <= 0) {
            return res.status(400).json({ error: 'Monto de recarga inválido.' });
        }

        // Aquí integrarías la API de PayPal
        // Respondemos con la URL de aprobación que espera tu script
        res.json({
            success: true,
            approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=mock_paypal_token'
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al procesar la orden de PayPal.' });
    }
});

// ==========================================
// 4. ENDPOINT DE HISTORIAL DE TRANSACCIONES
// ==========================================
app.get('/api/transactions', verificarTokenMiddleware, (req, res) => {
    try {
        // Datos simulados estructurados para que tu bucle en `script.js` los pinte perfectamente en la tabla
        const transactions = [
            {
                id: '109283',
                fecha: new Date().toISOString(),
                tipo: 'recarga',
                montoEntrada: 100.00,
                monedaEntrada: 'USD',
                montoSalida: null,
                monedaSalida: null,
                estado: 'completada'
            },
            {
                id: '109284',
                fecha: new Date(Date.now() - 86400000).toISOString(), // Ayer
                tipo: 'conversión',
                montoEntrada: 50.00,
                monedaEntrada: 'USD',
                montoSalida: 40.37,
                monedaSalida: 'EUR',
                estado: 'completada'
            }
        ];

        res.json(transactions);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener el historial de transacciones.' });
    }
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================
app.listen(PORT, () => {
    console.log(`Servidor de Nexus Finance ejecutándose en http://localhost:${PORT}`);
});
