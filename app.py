"""Sunrise Resort booking server (Flask + SQLite).

Run:  pip install -r requirements.txt
      OWNER_PIN=4321 STAFF_PIN=1111 SECRET_KEY=any-long-text python app.py
Open: http://localhost:5000
"""
import json
import os
import re
import secrets
import sqlite3
from datetime import datetime

from flask import Flask, jsonify, request, send_from_directory, session

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "resort.db")

OWNER_PIN = os.environ.get("OWNER_PIN", "1234")
STAFF_PIN = os.environ.get("STAFF_PIN", "1111")
# What the Staff role may do. The Owner can always do everything.
STAFF_CAN = {"editAmount": False, "recordPayment": True, "cancel": False, "reports": False}
OWNER_CAN = {"editAmount": True, "recordPayment": True, "cancel": True, "reports": True}

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.secret_key = os.environ.get("SECRET_KEY", "change-this-secret-key")
ROOMS = ["R101", "R102", "R103", "R104"]
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS bookings (
            id TEXT PRIMARY KEY, booking_date TEXT, guest TEXT, phone TEXT,
            room TEXT, check_in TEXT, check_out TEXT, amount REAL, advance REAL,
            source TEXT, status TEXT, log TEXT DEFAULT '[]')""")
        cols = [r[1] for r in c.execute("PRAGMA table_info(bookings)")]
        if "trekking" not in cols:  # add-on column for existing databases
            c.execute("ALTER TABLE bookings ADD COLUMN trekking INTEGER DEFAULT 0")
        c.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)")
        c.execute("INSERT OR IGNORE INTO settings VALUES ('resort_name', 'Sunrise Resort')")


def row_to_json(r):
    return {
        "id": r["id"], "bookingDate": r["booking_date"], "guest": r["guest"],
        "phone": r["phone"], "room": r["room"], "checkIn": r["check_in"],
        "checkOut": r["check_out"], "amount": r["amount"], "advance": r["advance"],
        "source": r["source"], "status": r["status"], "trekking": bool(r["trekking"]), "log": json.loads(r["log"] or "[]"),
    }


def room_set(value):
    """Rooms of a booking. 'All rooms' (older bookings) means every room."""
    if not value or value == "All rooms":
        return set(ROOMS)
    return {x for x in str(value).split(",") if x in ROOMS}


def err(message, code=400):
    return jsonify({"error": message}), code


def permissions():
    role = session.get("role")
    if role == "Owner":
        return OWNER_CAN
    if role == "Staff":
        return STAFF_CAN
    return None


def allowed(action):
    p = permissions()
    return bool(p and p.get(action))


@app.get("/")
def home():
    return send_from_directory(BASE, "index.html")


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    role, pin = data.get("role"), str(data.get("pin", ""))
    expected = {"Owner": OWNER_PIN, "Staff": STAFF_PIN}.get(role)
    if expected is None or not secrets.compare_digest(pin, expected):
        return err("Wrong PIN.", 401)
    session["role"] = role
    return jsonify({"role": role, "can": permissions()})


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
def me():
    if not session.get("role"):
        return err("Not signed in.", 401)
    return jsonify({"role": session["role"], "can": permissions()})


def read_settings():
    with db() as c:
        rows = dict(c.execute("SELECT key, value FROM settings").fetchall())
    return {"resort_name": rows.get("resort_name", "Sunrise Resort"),
            "room_rates": json.loads(rows.get("room_rates", "{}"))}


@app.get("/api/settings")
def get_settings():
    return jsonify(read_settings())


@app.put("/api/settings")
def put_settings():
    if session.get("role") != "Owner":
        return err("Only the owner can change settings.", 403)
    d = request.get_json(silent=True) or {}
    with db() as c:
        if "resort_name" in d:
            name = str(d["resort_name"]).strip()[:60]
            if not name:
                return err("Enter a resort name.")
            c.execute("UPDATE settings SET value=? WHERE key='resort_name'", (name,))
        if "room_rates" in d:
            rates = {}
            try:
                for k, v in dict(d["room_rates"]).items():
                    v = float(v or 0)
                    if v < 0:
                        return err("Room rates cannot be negative.")
                    rates[str(k)[:30]] = v
            except (TypeError, ValueError):
                return err("Room rates must be numbers.")
            c.execute("INSERT OR REPLACE INTO settings VALUES ('room_rates', ?)", (json.dumps(rates),))
    return jsonify(read_settings())


@app.get("/api/bookings")
def list_bookings():
    if not session.get("role"):
        return err("Sign in first.", 401)
    with db() as c:
        rows = c.execute("SELECT * FROM bookings ORDER BY rowid").fetchall()
    return jsonify({"bookings": [row_to_json(r) for r in rows]})


@app.post("/api/bookings")
def add_booking():
    if not session.get("role"):
        return err("Sign in first.", 401)
    d = request.get_json(silent=True) or {}
    guest = str(d.get("guest", "")).strip()[:80]
    source = str(d.get("source", ""))
    asked = d.get("rooms")
    picked = [r for r in ROOMS if isinstance(asked, list) and r in asked] if asked is not None else list(ROOMS)
    if not picked:
        return err("Pick at least one room for this family.")
    room = ",".join(picked)
    ci, co, bd = d.get("checkIn", ""), d.get("checkOut", ""), d.get("bookingDate", "")
    try:
        amount, advance = float(d.get("amount", 0)), float(d.get("advance", 0) or 0)
    except (TypeError, ValueError):
        return err("Amount must be a number.")
    if not guest:
        return err("Enter the guest name.")
    if not (DATE_RE.match(str(ci)) and DATE_RE.match(str(co)) and co > ci):
        return err("Check-out must be after check-in.")
    if not DATE_RE.match(str(bd)):
        bd = datetime.now().strftime("%Y-%m-%d")
    if amount < 0 or advance < 0 or amount + advance <= 0:
        return err("Check the amount and advance.")
    with db() as c:
        taken = set()
        for row in c.execute(
                "SELECT room FROM bookings WHERE status!='Cancelled' AND ?<check_out AND check_in<?", (ci, co)):
            taken |= room_set(row["room"])
        busy = [r for r in picked if r in taken]
        if busy:
            return err(", ".join(busy) + " already booked for those dates.", 409)
        bid = "B" + str(int(datetime.now().timestamp() * 1000))
        c.execute("INSERT INTO bookings (id, booking_date, guest, phone, room, check_in, check_out, "
                  "amount, advance, source, status, log, trekking) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (bid, bd, guest, str(d.get("phone", ""))[:30], room, ci, co,
                   amount, advance, source, "Confirmed", "[]", 1 if d.get("trekking") else 0))
    return jsonify({"id": bid}), 201


@app.patch("/api/bookings/<bid>")
def edit_booking(bid):
    if not allowed("editAmount"):
        return err("You are not allowed to edit amounts.", 403)
    d = request.get_json(silent=True) or {}
    try:
        amount, advance = float(d.get("amount")), float(d.get("advance") or 0)
    except (TypeError, ValueError):
        return err("Enter a valid amount.")
    reason = str(d.get("reason", "")).strip()[:200]
    with db() as c:
        b = c.execute("SELECT * FROM bookings WHERE id=?", (bid,)).fetchone()
        if not b:
            return err("Booking not found.", 404)
        if amount < 0:
            return err("Enter a valid amount.")
        if advance < 0:
            return err("Advance cannot be negative.")
        if amount != b["amount"] and not reason:
            return err("Add a reason for changing the amount.")
        trek = bool(d["trekking"]) if "trekking" in d else bool(b["trekking"])
        trek_note = ""
        if trek != bool(b["trekking"]):
            trek_note = " · Trekking " + ("added" if trek else "removed")
        log = json.loads(b["log"] or "[]")
        log.append(f"{datetime.now():%d/%m/%Y, %H:%M} · {session['role']} · Amount ₹{b['amount']:g} → ₹{amount:g}, "
                   f"Advance ₹{b['advance']:g} → ₹{advance:g}" + trek_note + (f" · {reason}" if reason else ""))
        c.execute("UPDATE bookings SET amount=?, advance=?, trekking=?, log=? WHERE id=?",
                  (amount, advance, 1 if trek else 0, json.dumps(log), bid))
    return jsonify({"ok": True})


@app.post("/api/bookings/<bid>/cancel")
def cancel_booking(bid):
    if not allowed("cancel"):
        return err("You are not allowed to cancel bookings.", 403)
    with db() as c:
        c.execute("UPDATE bookings SET status='Cancelled' WHERE id=?", (bid,))
    return jsonify({"ok": True})


@app.post("/api/bookings/<bid>/payment")
def record_payment(bid):
    if not allowed("recordPayment"):
        return err("You are not allowed to record payments.", 403)
    d = request.get_json(silent=True) or {}
    try:
        pay = float(d.get("amount"))
    except (TypeError, ValueError):
        return err("Enter the amount received.")
    note = str(d.get("note", "")).strip()[:100]
    with db() as c:
        b = c.execute("SELECT * FROM bookings WHERE id=?", (bid,)).fetchone()
        if not b:
            return err("Booking not found.", 404)
        if b["status"] == "Cancelled":
            return err("This booking is cancelled.")
        balance = b["amount"]
        if pay <= 0 or pay > balance:
            return err("Payment must be more than 0 and not more than the balance.")
        log = json.loads(b["log"] or "[]")
        log.append(f"{datetime.now():%d/%m/%Y, %H:%M} · {session['role']} · Payment ₹{pay:g} received, "
                   f"balance ₹{balance:g} → ₹{balance - pay:g}" + (f" · {note}" if note else ""))
        c.execute("UPDATE bookings SET amount=?, advance=?, log=? WHERE id=?", (balance - pay, b["advance"] + pay, json.dumps(log), bid))
    return jsonify({"ok": True})


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)