// ==========================================
// SCRIPT PRINCIPAL - NEXUS FINANCE (FRONTEND)
// ==========================================

const API_BASE_URL = 'http://localhost:3000/api';

// Función auxiliar para obtener el token JWT guardado
function obtenerToken() {
    return localStorage.getItem('token');
}

// Función auxiliar para guardar token
function guardarToken(token) {
    localStorage.setItem('token', token);
}

// Función auxiliar para cerrar sesión
function cerrarSesion() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
}

// Formatear moneda
function formatearMoneda(monto, moneda) {
    return new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: moneda
    }).format(monto);
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
    const swapBtn = document.getElementById('swap-currencies'); // Botón opcional para invertir

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

            // Mostrar estado de carga
            const submitBtn = form.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Convirtiendo...';

            try {
                // Petición al backend con query params (CORREGIDO)
                const response = await fetch(`${API_BASE_URL}/convert?from=${from}&to=${to}&amount=${amount}`);
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Error al realizar la conversión');
                }

                // Renderizar resultado en pantalla (CORREGIDO)
                convertedAmountEl.textContent = `${data.netResult} ${data.to} (Comisión 5%: ${data.commission} ${data.to})`;
                appliedRateEl.textContent = `1 ${data.from} = ${data.rate} ${data.to}`;
                resultBox.classList.remove('hidden');
                resultBox.classList.add('visible');

            } catch (error) {
                console.error('Error:', error);
                alert(error.message);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        });
    }

    // Botón para intercambiar monedas (opcional)
    if (swapBtn) {
        swapBtn.addEventListener('click', () => {
            const temp = fromSelect.value;
            fromSelect.value = toSelect.value;
            toSelect.value = temp;
        });
    }

    // 2. LÓGICA DE LOS BOTONES DE PAGO (STRIPE Y PAYPAL)
    
    // Stripe
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
                    body: JSON.stringify({ 
                        montoTotal: parseFloat(monto), 
                        titulo: 'Recarga de Saldo - Nexus Finance' 
                    })
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

    // PayPal
    const btnPaypal = document.getElementById('btn-paypal');
    if (btnPaypal) {
        btnPaypal.addEventListener('click', async () => {
            const monto = prompt('Ingresa el monto a recargar en USD (ej: 50):', '50');
            if (!monto || isNaN(monto) || monto <= 0) return;

            const token = obtenerToken();
            if (!token) {
                alert('Debes iniciar sesión para realizar una recarga.');
                return;
            }

            try {
                const response = await fetch(`${API_BASE_URL}/checkout/paypal`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ 
                        montoTotal: parseFloat(monto),
                        descripcion: 'Recarga de Saldo - Nexus Finance'
                    })
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Error al conectar con PayPal');

                if (data.approvalUrl) {
                    window.location.href = data.approvalUrl; // Redirige a PayPal para aprobación
                }
            } catch (error) {
                console.error('Error en PayPal:', error.message);
                alert(`No se pudo procesar el pago: ${error.message}`);
            }
        });
    }

    // 3. CARGAR HISTORIAL Y DATOS AL INICIAR EL DASHBOARD
    const tablaHistorial = document.getElementById('transactions-table-body');
    if (tablaHistorial) {
        cargarHistorialTransacciones();
    }

    // 4. CARGAR DATOS DEL USUARIO (si existe el contenedor)
    const userInfoContainer = document.getElementById('user-info');
    if (userInfoContainer) {
        cargarDatosUsuario();
    }

    // 5. BOTÓN DE CERRAR SESIÓN
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', cerrarSesion);
    }
});

// Función para obtener el historial de transacciones del usuario (COMPLETA)
async function cargarHistorialTransacciones() {
    const token = obtenerToken();
    if (!token) {
        console.warn('No hay token disponible para cargar historial');
        return;
    }

    const tbody = document.getElementById('transactions-table-body');
    const loadingRow = document.getElementById('loading-row');
    
    // Mostrar estado de carga si existe
    if (loadingRow) loadingRow.style.display = 'table-row';

    try {
        const response = await fetch(`${API_BASE_URL}/transactions`, {
            method: 'GET',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Error al cargar historial');
        }

        const transactions = Array.isArray(data) ? data : data.transactions || [];

        tbody.innerHTML = '';

        if (transactions.length === 0) {
            // Estado vacío
            tbody.innerHTML = `
                <tr class="empty-state">
                    <td colspan="5" style="text-align: center; padding: 2rem; color: #666;">
                        <div style="font-size: 3rem; margin-bottom: 0.5rem;">📭</div>
                        <div>No hay transacciones registradas</div>
                        <div style="font-size: 0.9rem; margin-top: 0.5rem; color: #999;">
                            Realiza tu primera conversión para verla aquí
                        </div>
                    </td>
                </tr>
            `;
        } else {
            // Renderizar transacciones
            transactions.forEach(tx => {
                const row = document.createElement('tr');
                
                // Determinar clase según tipo
                const typeClass = tx.tipo === 'recarga' ? 'type-deposit' : 
                                 tx.tipo === 'retiro' ? 'type-withdrawal' : 'type-conversion';
                
                // Formatear fecha
                const fecha = new Date(tx.fecha).toLocaleDateString('es-ES', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });

                row.innerHTML = `
                    <td class="tx-id">#${tx.id || tx._id?.slice(-6) || 'N/A'}</td>
                    <td class="tx-date">${fecha}</td>
                    <td class="tx-type ${typeClass}">
                        ${tx.tipo ? tx.tipo.charAt(0).toUpperCase() + tx.tipo.slice(1) : 'Conversión'}
                    </td>
                    <td class="tx-amount">
                        ${tx.montoEntrada ? formatearMoneda(tx.montoEntrada, tx.monedaEntrada) : '-'}
                        ${tx.montoSalida ? `→ ${formatearMoneda(tx.montoSalida, tx.monedaSalida)}` : ''}
                    </td>
                    <td class="tx-status">
                        <span class="status-badge ${tx.estado || 'completada'}">${tx.estado || 'Completada'}</span>
                    </td>
                `;
                
                tbody.appendChild(row);
            });
        }

    } catch (error) {
        console.error('Error cargando historial:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 2rem; color: #e74c3c;">
                    Error al cargar el historial: ${error.message}
                </td>
            </tr>
        `;
    } finally {
        if (loadingRow) loadingRow.style.display = 'none';
    }
}

// Función para cargar datos del usuario (balance, nombre, etc.)
async function cargarDatosUsuario() {
    const token = obtenerToken();
    if (!token) return;

    try {
        const response = await fetch(`${API_BASE_URL}/user/profile`, {
            method: 'GET',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        
        if (!response.ok) throw new Error(data.error);

        // Actualizar UI con datos del usuario
        const balanceEl = document.getElementById('user-balance');
        const nameEl = document.getElementById('user-name');
        
        if (balanceEl && data.balance !== undefined) {
            balanceEl.textContent = formatearMoneda(data.balance, 'USD');
        }
        
        if (nameEl && data.nombre) {
            nameEl.textContent = data.nombre;
        }

        // Guardar datos en localStorage para uso offline
        localStorage.setItem('user', JSON.stringify(data));

    } catch (error) {
        console.error('Error cargando datos de usuario:', error);
    }
}

// Función para verificar autenticación en páginas protegidas
function verificarAutenticacion() {
    const token = obtenerToken();
    const publicPages = ['/login.html', '/register.html', '/index.html', '/'];
    const currentPage = window.location.pathname;

    if (!token && !publicPages.includes(currentPage)) {
        window.location.href = '/login.html';
        return false;
    }
    
    return true;
}

// Verificar auth al cargar (opcional, descomentar si se necesita protección de rutas)
// verificarAutenticacion();

// Exportar funciones útiles para uso global si es necesario
window.NexusFinance = {
    obtenerToken,
    cerrarSesion,
    formatearMoneda,
    cargarHistorialTransacciones
};
