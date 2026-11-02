const express = require('express');
const cors = require('cors');

const app = express();

// Middlewares
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

// ==========================================
// 1. ENDPOINT DE ESTADO (Health Check)
// ==========================================
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Backend de Nexus Finance funcionando correctamente 🚀' });
});

// ==========================================
// 2. ENDPOINT DE PERFIL DE USUARIO
// ==========================================
app.get('/api/user/profile', (req, res) => {
    // Aquí validarías el token del header 'Authorization: Bearer <token>'
    // Datos simulados de ejemplo para que coincidan con la UI
    res.json({
        nombre: 'Emanuel',
        balance: 1540.50
    });
});

// ==========================================
// 3. ENDPOINT DE CONVERSIÓN DE DIVISAS
// ==========================================
// Coincide con: `${API_BASE_URL}/convert?from=${from}&to=${to}&amount=${amount}`
app.get('/api/convert', (req, res) => {
    try {
        const { from, to, amount } = req.query;
        const parsedAmount = parseFloat(amount);

        if (!parsedAmount || parsedAmount <= 0) {
            return res.status(400).json({ error: 'Ingresa un monto válido para la conversión.' });
        }

        // Tasa de cambio simulada (ejemplo: 1 USD = 0.85 EUR)
        const rate = 0.85; 
        const feePercentage = 0.05; // 5% de comisión

        const commission = parsedAmount * feePercentage;
        const netAmountAfterFee = parsedAmount - commission;
        const netResult = netAmountAfterFee * rate;

        res.json({
            rate: rate,
            commission: commission.toFixed(2),
            netResult: netResult.toFixed(2)
        });

    } catch (err) {
        res.status(500).json({ error: 'Error interno en el servidor al convertir.' });
    }
});

// ==========================================
// 4. ENDPOINTS DE PAGO / RECARGAS (Stripe & PayPal)
// ==========================================
app.post('/api/checkout/stripe', (req, res) => {
    try {
        const { montoTotal, titulo } = req.body;
        
        // Aquí integrarías el SDK real de Stripe para generar la sesión de pago
        // Simulamos una URL de redirección de Stripe
        res.json({
            success: true,
            url: 'https://checkout.stripe.com/pay/mock_session_id'
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al procesar pago con Stripe' });
    }
});

app.post('/api/checkout/paypal', (req, res) => {
    try {
        const { montoTotal, descripcion } = req.body;
        
        // Aquí integrarías la API de PayPal para crear la orden
        // Simulamos una URL de aprobación de PayPal
        res.json({
            success: true,
            approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=mock_token'
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al procesar pago con PayPal' });
    }
});

// ==========================================
// 5. ENDPOINT DE HISTORIAL DE TRANSACCIONES
// ==========================================
app.get('/api/transactions', (req, res) => {
    try {
        // Puedes retornar un array vacío [] como tu script ya lo maneja cuando no hay transacciones,
        // o devolver datos de prueba simulados:
        const transactions = [
            {
                id: 1,
                tipo: 'Recarga',
                detalle: 'Recarga vía Stripe',
                monto: '+$100.00 USD',
                fecha: '2026-10-26'
            }
        ];

        res.json(transactions);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener transacciones' });
    }
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================
app.listen(PORT, () => {
    console.log(`Servidor de Nexus Finance corriendo en http://localhost:${PORT}`);
});
