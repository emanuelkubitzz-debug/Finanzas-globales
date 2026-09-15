document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('currency-form');
    const amountInput = document.getElementById('amount');
    const fromSelect = document.getElementById('from');
    const toSelect = document.getElementById('to');
    const resultBox = document.getElementById('result-box');
    const convertedAmountEl = document.getElementById('converted-amount');
    const appliedRateEl = document.getElementById('applied-rate');

    // URL de tu backend
    const API_URL = 'http://localhost:3000/api/convert';

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
            const response = await fetch(`\({API_URL}?from=\){from}&to=\({to}&amount=\){amount}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Error al realizar la conversión');
            }

            // Mostrar el resultado neto (después de tu 5% de comisión) y la tasa aplicada
            convertedAmountEl.textContent = `\({data.netResult}\){data.to} (Comisión 5% aplicada: \({data.commission}\){data.to})`;
            appliedRateEl.textContent = `1 \({data.from} =\){data.rate} ${data.to}`;
            resultBox.classList.remove('hidden');

        } catch (error) {
            console.error('Error:', error);
            alert(error.message);
        }
    });
});
