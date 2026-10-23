"""Optional: copy old bookings from a SQLite file into Neon.
Usage: DATABASE_URL='postgresql://...' python migrate_sqlite_to_neon.py resort-backup.db
Safe to re-run (existing booking ids are skipped). The resort name is NOT copied."""
import json, os, sqlite3, sys
import psycopg2
from psycopg2.extras import Json

src = sqlite3.connect(sys.argv[1] if len(sys.argv) > 1 else "resort.db")
src.row_factory = sqlite3.Row
pg = psycopg2.connect(os.environ["DATABASE_URL"])
n = 0
with pg, pg.cursor() as c:
    for r in src.execute("SELECT * FROM bookings ORDER BY rowid"):
        r = dict(r)
        c.execute(
            "INSERT INTO bookings (id, booking_date, guest, phone, room, check_in, check_out, amount, advance,"
            " source, status, log, trekking) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
            " ON CONFLICT (id) DO NOTHING",
            (r["id"], r["booking_date"], r["guest"], r["phone"] or "", r["room"], r["check_in"], r["check_out"],
             r["amount"], r["advance"], r["source"], r["status"] or "Confirmed",
             Json(json.loads(r["log"] or "[]")), bool(r.get("trekking", 0))))
        n += c.rowcount
    for row in src.execute("SELECT value FROM settings WHERE key='room_rates'"):
        c.execute("INSERT INTO settings (key, value) VALUES ('room_rates', %s) ON CONFLICT (key) DO NOTHING", (row[0],))
print(f"Copied {n} booking(s).")