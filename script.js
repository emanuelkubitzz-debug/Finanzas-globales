
const API_BASE_URL = 'http://localhost:3000/api';

// Utilidades
const $ = (id) => document.getElementById(id);
const formatCurrency = (amount, currency = 'USD') => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);

// Auth
function getToken() { return localStorage.getItem('token'); }
function logout() {
    localStorage.clear();
    window.location.href = 'login.html';
}

// Verificar auth
if (!getToken() && !window.location.pathname.includes('login')) {
    window.location.href = 'login.html';
}

// Theme Toggle
const themeToggle = $('theme-toggle');
if (themeToggle) {
    themeToggle.addEventListener('click', () => {
        const html = document.documentElement;
        const current = html.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        themeToggle.innerHTML = next === 'dark' ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
    });
}

// Cargar datos usuario
async function loadUserData() {
    if (!getToken()) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/user/profile`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        
        if (!response.ok) throw new Error('Error cargando usuario');
        
        const data = await response.json();
        localStorage.setItem('user', JSON.stringify(data));
        
        // Actualizar UI
        const userName = $('user-name');
        const userBalance = $('user-balance');
        
        if (userName) userName.textContent = data.nombre || 'Usuario';
        if (userBalance) userBalance.textContent = formatCurrency(data.balance || 0);
        
    } catch (err) {
        console.error('Error:', err);
    }
}

// Conversor
let currentConversion = null;

async function performConversion() {
    const amount = parseFloat($('amount').value);
    const from = $('from').value;
    const to = $('to').value;
    
    if (!amount || amount <= 0) {
        alert('Ingresa un monto válido');
        return;
    }
    
    if (from === to) {
        alert('Selecciona monedas diferentes');
        return;
    }
    
    const btn = $('btn-convert');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Calculando...';
    btn.disabled = true;
    
    try {
        const response = await fetch(
            `${API_BASE_URL}/convert?from=${from}&to=${to}&amount=${amount}`,
            { headers: { 'Authorization': `Bearer ${getToken()}` } }
        );
        
        const data = await response.json();
        
        if (!response.ok) throw new Error(data.error);
        
        // Mostrar resultado
        $('result-amount').value = data.netResult;
        $('applied-rate').textContent = `1 ${from} = ${data.rate} ${to}`;
        $('commission').textContent = `$${data.commission} ${to}`;
        
        // Actualizar nombres
        updateCurrencyNames();
        
        currentConversion = { from, to, amount, ...data };
        
    } catch (err) {
        alert(err.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function updateCurrencyNames() {
    const fromName = $('from').options[$('from').selectedIndex].text.split(' ')[1];
    const toName = $('to').options[$('to').selectedIndex].text.split(' ')[1];
    
    document.querySelector('.currency-box.from .currency-name').textContent = fromName;
    document.querySelector('.currency-box.to .currency-name').textContent = toName;
}

// Event listeners conversor
if ($('btn-convert')) {
    $('btn-convert').addEventListener('click', performConversion);
}

if ($('swap-currencies')) {
    $('swap-currencies').addEventListener('click', () => {
        const from = $('from');
        const to = $('to');
        const temp = from.value;
        from.value = to.value;
        to.value = temp;
        updateCurrencyNames();
        
        // Animación
        $('swap-currencies').style.transform = 'rotate(180deg)';
        setTimeout(() => $('swap-currencies').style.transform = '', 300);
    });
}

if ($('from')) {
    $('from').addEventListener('change', updateCurrencyNames);
    $('to').addEventListener('change', updateCurrencyNames);
}

// Pagos
function initPayments() {
    const stripeCard = document.querySelector('[data-provider="stripe"]');
    const paypalCard = document.querySelector('[data-provider="paypal"]');
    
    if (stripeCard) {
        stripeCard.addEventListener('click', () => openDepositModal('stripe'));
    }
    
    if (paypalCard) {
        paypalCard.addEventListener('click', () => openDepositModal('paypal'));
    }
}

function openDepositModal(provider) {
    const modal = $('deposit-modal');
    const confirmBtn = $('confirm-deposit');
    
    modal.classList.add('active');
    
    // Presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            $('custom-amount').value = btn.dataset.amount;
        });
    });
    
    confirmBtn.onclick = async () => {
        const amount = $('custom-amount').value;
        if (!amount || amount <= 0) {
            alert('Ingresa un monto válido');
            return;
        }
        
        if (provider === 'stripe') {
            await processStripe(amount);
        } else {
            await processPayPal(amount);
        }
        
        modal.classList.remove('active');
    };
    
    // Cerrar modal
    document.querySelector('.modal-close').onclick = () => {
        modal.classList.remove('active');
    };
    
    modal.onclick = (e) => {
        if (e.target === modal) modal.classList.remove('active');
    };
}

async function processStripe(amount) {
    try {
        const response = await fetch(`${API_BASE_URL}/checkout/stripe`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify({
                montoTotal: parseFloat(amount),
                titulo: 'Recarga Nexus Finance'
            })
        });
        
        const data = await response.json();
        if (data.url) window.location.href = data.url;
        
    } catch (err) {
        alert('Error con Stripe: ' + err.message);
    }
}

async function processPayPal(amount) {
    try {
        const response = await fetch(`${API_BASE_URL}/checkout/paypal`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify({
                montoTotal: parseFloat(amount),
                descripcion: 'Recarga Nexus Finance'
            })
        });
        
        const data = await response.json();
        if (data.approvalUrl) window.location.href = data.approvalUrl;
        
    } catch (err) {
        alert('Error con PayPal: ' + err.message);
    }
}

// Historial
async function loadTransactions() {
    if (!getToken()) return;
    
    const container = $('transactions-list');
    if (!container) return;
    
    container.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>';
    
    try {
        const response = await fetch(`${API_BASE_URL}/transactions`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        
        const data = await response.json();
        
        if (!data || data.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>No hay transacciones recientes</p>
                </div>
            `;
            return;
        }
        
        // Actualizar contador
