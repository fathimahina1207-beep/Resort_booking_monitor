# Yellamalai O'Valley Resort booking app

Files
- `app.py`               Python server (Flask + Neon PostgreSQL). Bookings, PINs, roles, resort name.
- `neon_schema.sql`      Database tables (run once in Neon SQL Editor; app.py also runs it on start).
- `index.html`           Page layout.
- `static/style.css`     Dark green and gold design.
- `static/app.js`        App screens and logic (talks to app.py through /api).
- `migrate_sqlite_to_neon.py`  Optional: copy old bookings from resort.db / resort-backup.db.
- `.env.example`         Settings template.

Set up Neon
1. Create a project at https://console.neon.tech and open **Connect** to copy the **pooled PostgreSQL connection string**. It starts with `postgresql://`; the HTTPS Data API URL is not a database connection string.
2. (Optional) Open SQL Editor and run `neon_schema.sql`.

Run
1. `pip install -r requirements.txt`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to the pooled PostgreSQL connection string from Neon.
3. Run `python app.py`; the app loads settings from `.env` (environment variables already set in the shell take precedence).
4. Open http://localhost:5000 (other phones on the same Wi-Fi: http://YOUR-PC-IP:5000)

Deploy: `gunicorn app:app` with the same settings configured as environment variables.

Change
- PINs: the Owner can change the Owner or Staff PIN in the app (Home > Change PIN, 4 to 8 digits). PINs saved there are stored hashed in Neon and replace OWNER_PIN / STAFF_PIN.
- Forgot the Owner PIN? Run in Neon SQL Editor: `DELETE FROM settings WHERE key IN ('owner_pin_hash','staff_pin_hash');` The PINs in OWNER_PIN / STAFF_PIN work again.
- Permissions: `STAFF_CAN` near the top of app.py. `editName` lets that role change the resort name (Owner can by default: Home > Resort name).
- Rooms and booking sources: `ROOMS` and `SOURCES` at the top of static/app.js.
- Data lives in Neon (backups: Neon branches / point-in-time restore). No local .db file is used any more.