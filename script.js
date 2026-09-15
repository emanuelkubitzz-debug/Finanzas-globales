// ==========================================
// SCRIPT PRINCIPAL - NEXUS FINANCE (FRONTEND)
// ==========================================

const API_BASE_URL = 'http://localhost:3000/api';

// Función auxiliar para obtener el token JWT guardado
function obtenerToken() {
    return localStorage.getItem('token');
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. LÓGICA DEL CONVERSOR DE MONEDAS
    const form = document.getElementById('currency-form');
    const amountInput = document.getElementById('amount');
    const fromSelect = document.getElementById('from');
    const toSelect = document.getElementById('to');
    const resultBox = document.getElementById('result-box');
    const convertedAmountEl = document.getElementById('converted-amount');
    const appliedRateEl = document.getElementById('applied-rate');

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const amount = amountInput.value;
            const from = fromSelect.value;
            const to = toSelect.value;

            if (from === to) {
                alert('La moneda de origen y destino deben ser distintas.');
                return;
            }

            try {
                // Petición al backend con query params
                const response = await fetch(`\({API_BASE_URL}/convert?from=\){from}&to=\({to}&amount=\){amount}`);
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Error al realizar la conversión');
                }

                // Renderizar resultado en pantalla (mostrando el neto con la comisión aplicada)
                convertedAmountEl.textContent = `\({data.netResult}\){data.to} (Comisión 5%: \({data.commission}\){data.to})`;
                appliedRateEl.textContent = `1 \({data.from} =\){data.rate} ${data.to}`;
                resultBox.classList.remove('hidden');

            } catch (error) {
                console.error('Error:', error);
                alert(error.message);
            }
        });
    }

    // 2. LÓGICA DE LOS BOTONES DE PAGO (STRIPE Y PAYPAL)
    const btnStripe = document.getElementById('btn-stripe');
    if (btnStripe) {
        btnStripe.addEventListener('click', async () => {
            const monto = prompt('Ingresa el monto a recargar en USD (ej: 50):', '50');
            if (!monto || isNaN(monto) || monto <= 0) return;

            const token = obtenerToken();
            if (!token) {
                alert('Debes iniciar sesión para realizar una recarga.');
                return;
            }

            try {
                const response = await fetch(`${API_BASE_URL}/checkout/stripe`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ montoTotal: parseFloat(monto), titulo: 'Recarga de Saldo - Nexus Finance' })
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Error al conectar con Stripe');

                if (data.url) {
                    window.location.href = data.url; // Redirige al checkout oficial de Stripe
                }
            } catch (error) {
                console.error('Error en Stripe:', error.message);
                alert(`No se pudo procesar el pago: ${error.message}`);
            }
        });
    }

    // 3. CARGAR HISTORIAL Y DATOS AL INICIAR EL DASHBOARD (Si existe la tabla en el HTML)
    const tablaHistorial = document.getElementById('transactions-table-body');
    if (tablaHistorial) {
        cargarHistorialTransacciones();
    }
});

// Función para obtener el historial de transacciones del usuario
async function cargarHistorialTransacciones() {
    const token = obtenerToken();
    if (!token) return;

    try {
        const response = await fetch(`${API_BASE_URL}/transactions`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const transactions = await response.json();
        const tbody = document.getElementById('transactions-table-body');
        
        if (!response.ok) throw new Error(transactions.error || 'Error al cargar historial');

        tbody.innerHTML = '';

        if (transactions.length === 0) {
            tbody.innerHTML = `
