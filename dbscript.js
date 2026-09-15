const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Conexión a PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // O usa host, user, password, database individualmente
});

// Ruta principal para realizar conversiones
app.get('/api/convert', async (req, res) => {
  const { from, to, amount } = req.query;

  if (!from || !to || !amount) {
    return res.status(400).json({ error: 'Parámetros incompletos (from, to, amount son requeridos)' });
  }

  try {
    const query = `
      SELECT r.rate 
      FROM exchange_rates r
      JOIN currencies c1 ON r.from_currency_id = c1.id
      JOIN currencies c2 ON r.to_currency_id = c2.id
      WHERE c1.code = $1 AND c2.code = $2
      ORDER BY r.recorded_at DESC
      LIMIT 1;
    `;

    const result = await pool.query(query, [from.toUpperCase(), to.toUpperCase()]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tasa de cambio no encontrada para ese par de monedas' });
    }

    const rate = Number(result.rows[0].rate);
    const convertedAmount = Number((amount * rate).toFixed(2));

    res.json({
      from,
      to,
      amount: Number(amount),
      rate,
      result: convertedAmount
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});
