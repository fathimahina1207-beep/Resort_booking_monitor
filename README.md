# Sunrise Resort booking app

Files
- `app.py`        Python server (Flask + SQLite). Stores bookings, PINs, roles, resort name.
- `index.html`    Page layout.
- `static/style.css`  Dark green and gold design.
- `static/app.js`     App screens and logic (talks to app.py through /api).

Run
1. `pip install -r requirements.txt`
2. `OWNER_PIN=4321 STAFF_PIN=1111 SECRET_KEY=some-long-random-text python app.py`
3. Open http://localhost:5000 (other phones on the same Wi-Fi: http://YOUR-PC-IP:5000)

Change
- PINs: environment variables OWNER_PIN and STAFF_PIN.
- Staff permissions: `STAFF_CAN` near the top of app.py.
- Rooms and booking sources: `ROOMS` and `SOURCES` at the top of static/app.js.
- Data is saved in resort.db next to app.py. Back this file up.
