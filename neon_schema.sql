-- Yellamalai O'Valley Resort : Neon (PostgreSQL) schema
-- Run once in Neon Console -> SQL Editor (app.py also runs this automatically on start; it is safe to re-run).

CREATE TABLE IF NOT EXISTS bookings (
    seq           BIGINT GENERATED ALWAYS AS IDENTITY,          -- keeps insertion order
    id            TEXT PRIMARY KEY,                              -- e.g. B1792662038144
    booking_date  DATE             NOT NULL DEFAULT CURRENT_DATE,
    guest         TEXT             NOT NULL,
    phone         TEXT             NOT NULL DEFAULT '',
    room          TEXT             NOT NULL,                     -- 'R101,R102' (comma separated) or 'All rooms'
    check_in      DATE             NOT NULL,
    check_out     DATE             NOT NULL,
    amount        DOUBLE PRECISION NOT NULL DEFAULT 0,           -- balance still to collect
    advance       DOUBLE PRECISION NOT NULL DEFAULT 0,           -- paid so far
    source        TEXT,
    status        TEXT             NOT NULL DEFAULT 'Confirmed', -- Confirmed / Cancelled
    log           JSONB            NOT NULL DEFAULT '[]'::jsonb, -- change & payment history
    trekking      BOOLEAN          NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ      NOT NULL DEFAULT now(),
    CONSTRAINT chk_stay_dates CHECK (check_out > check_in),
    CONSTRAINT chk_money      CHECK (amount >= 0 AND advance >= 0)
);

CREATE INDEX IF NOT EXISTS idx_bookings_stay  ON bookings (check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_bookings_bdate ON bookings (booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_seq   ON bookings (seq);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT INTO settings (key, value)
VALUES ('resort_name', 'Yellamalai O''Valley Resort')
ON CONFLICT (key) DO NOTHING;

-- Useful one-liners
-- Change the resort name by SQL (the Owner can also do it inside the app):
--   UPDATE settings SET value = 'Yellamalai O''Valley Resort' WHERE key = 'resort_name';
-- Set the nightly rate for all rooms:
--   INSERT INTO settings (key, value) VALUES ('room_rates', '{"ALL": 3000}')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
