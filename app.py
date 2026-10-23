"""Yellamalai O'Valley Resort booking server (Flask + Neon PostgreSQL).

Run:  pip install -r requirements.txt
      DATABASE_URL='postgresql://...neon.tech/neondb?sslmode=require' \
      OWNER_PIN=4321 STAFF_PIN=1111 SECRET_KEY=any-long-text python app.py
Open: http://localhost:5000
"""
import json
import os
import re
import secrets
from contextlib import contextmanager
from datetime import date, datetime
from urllib.parse import urlsplit

import psycopg2
from psycopg2.extras import Json, RealDictCursor
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE, ".env"), override=True)

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is missing. Add your PostgreSQL connection string to the .env file."
    )
if urlsplit(DATABASE_URL).scheme not in {"postgres", "postgresql"}:
    raise RuntimeError(
        "DATABASE_URL must be a PostgreSQL connection string. In Neon Console, open "
        "Connect and copy the pooled connection string (postgresql://...), not the "
        "HTTPS Data API URL."
    )


DEFAULT_NAME = "Yellamalai O'Valley Resort"
OWNER_PIN = os.environ.get("OWNER_PIN", "1234")
STAFF_PIN = os.environ.get("STAFF_PIN", "1111")
# What the Staff role may do. The Owner can always do everything.
# editName = change the resort name (set True to let Staff do it too).
STAFF_CAN = {"editAmount": False, "recordPayment": True, "cancel": False, "reports": False, "editName": False}
OWNER_CAN = {"editAmount": True, "recordPayment": True, "cancel": True, "reports": True, "editName": True}

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.secret_key = os.environ.get("SECRET_KEY", "change-this-secret-key")
ROOMS = ["R101", "R102", "R103", "R104"]
TREKKING_COST = 1000
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PIN_RE = re.compile(r"^\d{4,8}$")
PIN_KEYS = {"Owner": "owner_pin_hash", "Staff": "staff_pin_hash"}


@contextmanager
def db():
    """One short-lived connection per request (best for Neon's pooled endpoint).
    Commits on success, rolls back on error."""
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor, connect_timeout=15)
    try:
        with conn:
            with conn.cursor() as cur:
                yield cur
    finally:
        conn.close()


def init_db():
    with open(os.path.join(BASE, "neon_schema.sql"), encoding="utf-8") as f:
        sql = f.read()
    with db() as c:
        c.execute(sql)


def row_to_json(r):
    log = r["log"]
    if isinstance(log, str):
        log = json.loads(log or "[]")
    return {
        "id": r["id"], "bookingDate": str(r["booking_date"]), "guest": r["guest"],
        "phone": r["phone"], "room": r["room"], "checkIn": str(r["check_in"]),
        "checkOut": str(r["check_out"]), "amount": float(r["amount"]), "advance": float(r["advance"]),
        "source": r["source"], "status": r["status"], "trekking": bool(r["trekking"]), "log": log or [],
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


def pin_ok(role, pin):
    """PIN saved in the database (changed inside the app) wins; otherwise the OWNER_PIN / STAFF_PIN setting."""
    if role not in PIN_KEYS:
        return False
    with db() as c:
        c.execute("SELECT value FROM settings WHERE key=%s", (PIN_KEYS[role],))
        row = c.fetchone()
    if row:
        return check_password_hash(row["value"], pin)
    expected = {"Owner": OWNER_PIN, "Staff": STAFF_PIN}[role]
    return secrets.compare_digest(pin.encode(), expected.encode())


@app.get("/")
def home():
    return send_from_directory(BASE, "index.html")


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    role, pin = data.get("role"), str(data.get("pin", ""))
    if not pin_ok(role, pin):
        return err("Wrong PIN.", 401)
    session["role"] = role
    return jsonify({"role": role, "can": permissions()})


@app.post("/api/pins")
def change_pin():
    if session.get("role") != "Owner":
        return err("Only the owner can change PINs.", 403)
    d = request.get_json(silent=True) or {}
    target, current, new = d.get("role"), str(d.get("currentPin", "")), str(d.get("newPin", ""))
    if target not in PIN_KEYS:
        return err("Choose Owner or Staff.")
    if not pin_ok("Owner", current):
        return err("Your current Owner PIN is wrong.", 401)
    if not PIN_RE.match(new):
        return err("New PIN must be 4 to 8 digits.")
    other = "Staff" if target == "Owner" else "Owner"
    if pin_ok(other, new):
        return err("Owner and Staff PINs must be different.")
    with db() as c:
        c.execute("INSERT INTO settings (key, value) VALUES (%s, %s) "
                  "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                  (PIN_KEYS[target], generate_password_hash(new)))
    return jsonify({"ok": True})


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
        c.execute("SELECT key, value FROM settings")
        rows = {r["key"]: r["value"] for r in c.fetchall()}
    return {"resort_name": rows.get("resort_name", DEFAULT_NAME),
            "room_rates": json.loads(rows.get("room_rates", "{}"))}


def current_rate():
    rates = read_settings()["room_rates"]
    return float(rates.get("ALL") or rates.get("R101") or 0)


@app.get("/api/settings")
def get_settings():
    return jsonify(read_settings())


@app.put("/api/settings")
def put_settings():
    d = request.get_json(silent=True) or {}
    name, rates = None, None
    if "resort_name" in d:
        if not allowed("editName"):
            return err("You are not allowed to change the resort name.", 403)
        name = str(d["resort_name"]).strip()[:60]
        if not name:
            return err("Enter a resort name.")
    if "room_rates" in d:
        if session.get("role") != "Owner":
            return err("Only the owner can change rates.", 403)
        rates = {}
        try:
            for k, v in dict(d["room_rates"]).items():
                v = float(v or 0)
                if v < 0:
                    return err("Room rates cannot be negative.")
                rates[str(k)[:30]] = v
        except (TypeError, ValueError):
            return err("Room rates must be numbers.")
    with db() as c:
        if name is not None:
            c.execute("INSERT INTO settings (key, value) VALUES ('resort_name', %s) "
                      "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", (name,))
        if rates is not None:
            c.execute("INSERT INTO settings (key, value) VALUES ('room_rates', %s) "
                      "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", (json.dumps(rates),))
    return jsonify(read_settings())


@app.get("/api/bookings")
def list_bookings():
    if not session.get("role"):
        return err("Sign in first.", 401)
    with db() as c:
        c.execute("SELECT * FROM bookings ORDER BY seq")
        rows = c.fetchall()
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
    if advance < 0:
        return err("Advance cannot be negative.")
    rate = current_rate()
    if rate:  # amount is always calculated here, nobody types it
        try:
            nights = (date.fromisoformat(co) - date.fromisoformat(ci)).days
        except ValueError:
            return err("Enter valid dates.")
        total = rate * nights + (TREKKING_COST if d.get("trekking") else 0)
        if advance > total:
            return err("Advance cannot be more than the total.")
        amount = total - advance
    elif session.get("role") != "Owner":
        return err("The rate is not set. Ask the owner to set it.")
    if amount < 0 or amount + advance <= 0:
        return err("Check the amount and advance.")
    with db() as c:
        c.execute("SELECT pg_advisory_xact_lock(727001)")  # stops two phones double-booking at once
        c.execute("SELECT room FROM bookings WHERE status <> 'Cancelled' AND %s < check_out AND check_in < %s",
                  (ci, co))
        taken = set()
        for row in c.fetchall():
            taken |= room_set(row["room"])
        busy = [r for r in picked if r in taken]
        if busy:
            return err(", ".join(busy) + " already booked for those dates.", 409)
        bid = "B" + str(int(datetime.now().timestamp() * 1000))
        c.execute("INSERT INTO bookings (id, booking_date, guest, phone, room, check_in, check_out, "
                  "amount, advance, source, status, log, trekking) "
                  "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                  (bid, bd, guest, str(d.get("phone", ""))[:30], room, ci, co,
                   amount, advance, source, "Confirmed", Json([]), bool(d.get("trekking"))))
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
        c.execute("SELECT * FROM bookings WHERE id=%s FOR UPDATE", (bid,))
        b = c.fetchone()
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
        log = list(b["log"] or [])
        log.append(f"{datetime.now():%d/%m/%Y, %H:%M} · {session['role']} · Amount ₹{b['amount']:g} → ₹{amount:g}, "
                   f"Advance ₹{b['advance']:g} → ₹{advance:g}" + trek_note + (f" · {reason}" if reason else ""))
        c.execute("UPDATE bookings SET amount=%s, advance=%s, trekking=%s, log=%s WHERE id=%s",
                  (amount, advance, trek, Json(log), bid))
    return jsonify({"ok": True})


@app.post("/api/bookings/<bid>/cancel")
def cancel_booking(bid):
    if not allowed("cancel"):
        return err("You are not allowed to cancel bookings.", 403)
    with db() as c:
        c.execute("UPDATE bookings SET status='Cancelled' WHERE id=%s", (bid,))
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
        c.execute("SELECT * FROM bookings WHERE id=%s FOR UPDATE", (bid,))
        b = c.fetchone()
        if not b:
            return err("Booking not found.", 404)
        if b["status"] == "Cancelled":
            return err("This booking is cancelled.")
        balance = b["amount"]
        if pay <= 0 or pay > balance:
            return err("Payment must be more than 0 and not more than the balance.")
        log = list(b["log"] or [])
        log.append(f"{datetime.now():%d/%m/%Y, %H:%M} · {session['role']} · Payment ₹{pay:g} received, "
                   f"balance ₹{balance:g} → ₹{balance - pay:g}" + (f" · {note}" if note else ""))
        c.execute("UPDATE bookings SET amount=%s, advance=%s, log=%s WHERE id=%s",
                  (balance - pay, b["advance"] + pay, Json(log), bid))
    return jsonify({"ok": True})


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)