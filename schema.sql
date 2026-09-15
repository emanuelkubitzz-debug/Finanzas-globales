-- 1. Tabla de Monedas
CREATE TABLE IF NOT EXISTS currencies (
    id SERIAL PRIMARY KEY,
    code VARCHAR(3) UNIQUE NOT NULL,
    name VARCHAR(50) NOT NULL,
    symbol VARCHAR(5) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_currencies_code ON currencies(code);

-- 2. Tabla de Tasas de Cambio
CREATE TABLE IF NOT EXISTS exchange_rates (
    id SERIAL PRIMARY KEY,
    from_currency_id INT NOT NULL REFERENCES currencies(id) ON DELETE CASCADE,
    to_currency_id INT NOT NULL REFERENCES currencies(id) ON DELETE CASCADE,
    rate NUMERIC(18, 6) NOT NULL CHECK (rate > 0),
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_different_currencies CHECK (from_currency_id <> to_currency_id)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_pair_date 
ON exchange_rates(from_currency_id, to_currency_id, recorded_at DESC);

-- 3. Tabla de Historial de Conversiones
CREATE TABLE IF NOT EXISTS conversion_logs (
    id SERIAL PRIMARY KEY,
    from_currency_id INT NOT NULL REFERENCES currencies(id),
    to_currency_id INT NOT NULL REFERENCES currencies(id),
    amount_from NUMERIC(16, 2) NOT NULL CHECK (amount_from > 0),
    amount_to NUMERIC(16, 2) NOT NULL CHECK (amount_to > 0),
    rate_applied NUMERIC(18, 6) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Datos iniciales
INSERT INTO currencies (code, name, symbol) VALUES
('USD', 'Dólar Estadounidense', '$'),
('EUR', 'Euro', '€'),
('ARS', 'Peso Argentino', '$'),
('BRL', 'Real Brasileño', 'R$'),
('MXN', 'Peso Mexicano', '$')
ON CONFLICT (code) DO NOTHING;

INSERT INTO exchange_rates (from_currency_id, to_currency_id, rate) VALUES 
((SELECT id FROM currencies WHERE code = 'USD'), (SELECT id FROM currencies WHERE code = 'EUR'), 0.920000),
((SELECT id FROM currencies WHERE code = 'USD'), (SELECT id FROM currencies WHERE code = 'ARS'), 985.500000),
((SELECT id FROM currencies WHERE code = 'USD'), (SELECT id FROM currencies WHERE code = 'BRL'), 5.450000);
