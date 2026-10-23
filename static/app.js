var TREKKING_COST = 1000;
var WHOLE = "All rooms";
function roomsOf(b){
  if (!b.room || b.room === WHOLE) return ROOMS.slice();
  return ROOMS.filter(function(r){ return String(b.room).split(",").indexOf(r) >= 0; });
}
function roomsText(b){ var r = roomsOf(b); return r.length === ROOMS.length ? "All rooms" : r.join(", "); }
function rateNow(){ return Number(rates.ALL) || Number(rates.R101) || 0; }
var ROOMS = ["R101","R102","R103","R104"];
var SOURCES = ["Walk-in","Website","MakeMyTrip","Phone"];
var KEY = "resort_bookings_v1";
var TABS = [["Home","Dashboard"],["New booking","New booking"],["Calendar","Room calendar"],["Reports","Reports"]];
var bookings = [], tab = "Home", period = "7", msg = "";
var role = null, editId = null, payId = null;
var resortName = "Yellamalai O'Valley Resort", nameEdit = false, rateEdit = false, pinEdit = false;
var perms = {}, rates = {};

async function api(path, method, body){
  var r = await fetch(path, { method: method || "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  var data = await r.json().catch(function(){ return {}; });
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
async function loadAll(){
  var s = await api("/api/settings"); resortName = s.resort_name; rates = s.room_rates || {}; document.title = resortName;
  bookings = (await api("/api/bookings")).bookings;
}
function save(){}
function iso(d){ return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function today(){ return iso(new Date()); }
function addDays(s,n){ var d = new Date(s+"T00:00:00"); d.setDate(d.getDate()+n); return iso(d); }
function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
function money(n){ return "₹" + Number(n).toLocaleString("en-IN"); }
function active(){ return bookings.filter(function(b){ return b.status !== "Cancelled"; }); }
function stays(b,d){ return b.checkIn <= d && d < b.checkOut; }
function inPeriod(b){
  if (period === "all") return true;
  var from = period === "1" ? today() : addDays(today(), -(Number(period)-1));
  return b.bookingDate >= from && b.bookingDate <= today();
}
function go(t){ editId = null; payId = null; tab = t; period = period; render(); window.scrollTo(0,0); }

function render(){
  if (!role) { showLogin(); return; }
  render0();
}
function render0(){
  var cur = TABS.filter(function(t){ return t[0] === tab; })[0];
  document.getElementById("title").textContent = cur[1];
  document.getElementById("brand").textContent = resortName.toUpperCase();
  document.getElementById("tabs").innerHTML = visibleTabs().map(function(t){
    return '<button class="' + (t[0] === tab ? "on" : "") + '" onclick="go(\'' + t[0] + '\')">' + t[0] + '</button>';
  }).join("");
  document.getElementById("main").innerHTML = payId ? payView() : editId ? editView() : ({ "Home": home, "New booking": formView, "Calendar": calendar, "Reports": reports })[tab]();
}

function home(){
  var t = today(), a = active();
  var stat = function(l,v,hi){ return '<div class="stat' + (hi ? " hi" : "") + '"><div class="l">' + l + '</div><div class="v">' + v + '</div></div>'; };
  var todayN = a.filter(function(b){ return b.bookingDate === t; }).length;
  var occ = a.filter(function(b){ return stays(b,t); }).length;
  var rev = a.reduce(function(s,b){ return s + b.advance + b.amount; }, 0);
  var ins = a.filter(function(b){ return b.checkIn === t; }).length;
  var h = roleBar() + '<div class="grid">' + stat("Bookings today", todayN, true) + stat("Booked today", occ ? "Yes" : "No") + stat("Revenue", money(rev)) + stat("Check-ins", ins) + '</div>';

  var days = [], counts = [];
  for (var i = 6; i >= 0; i--) {
    var d = addDays(t, -i);
    days.push(d);
    counts.push(a.filter(function(b){ return b.bookingDate === d; }).length);
  }
  var max = Math.max.apply(null, counts.concat([1])), top = counts.indexOf(Math.max.apply(null, counts));
  var wk = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  h += '<div class="card"><h2>Bookings by booking date</h2><div class="chart">' + days.map(function(d,i){
    var hgt = counts[i] ? Math.round(counts[i]/max*100) + 14 : 4;
    return '<div class="c"><span class="n">' + counts[i] + '</span><div class="b' + (counts[i] && i === top ? " top" : "") + '" style="height:' + hgt + 'px"></div><small>' + wk[new Date(d+"T00:00:00").getDay()] + '</small></div>';
  }).join("") + '</div></div>';

  var list = bookings.slice().reverse().slice(0,20);
  h += '<div class="card"><h2>Latest bookings</h2>';
  if (!list.length) h += '<div class="empty">No bookings yet. Tap New booking to add one.</div>';
  list.forEach(function(b){
    h += '<div class="lb"><span>' + esc(b.guest) + ' · ' + roomsText(b) + ' · ' + b.checkIn + (b.trekking ? ' · Trekking' : '') + (b.status === "Cancelled" ? ' · Cancelled' : '') + '</span>' + rowBtns(b) + '</div>';
  });
  return h + '</div>';
}

function formView(){
  setTimeout(calcAmount, 0);
  var opt = function(arr){ return arr.map(function(x){ return '<option>' + x + '</option>'; }).join(""); };
  return '<label>Guest name<input id="guest" placeholder="Guest name"></label>' +
    '<label>Phone<input id="phone" type="tel" placeholder="Phone"></label>' +
    '<label>Check-in date<input id="ci" onchange="calcAmount()" type="date" value="' + today() + '"></label>' +
    '<label>Check-out date<input id="co" onchange="calcAmount()" type="date" value="' + addDays(today(),1) + '"></label>' +
    '<label style="margin-bottom:6px">Rooms for this family</label><div class="rooms">' + ROOMS.map(function(r){ return '<label><input type="checkbox" class="rm" value="' + r + '" checked> ' + r + '</label>'; }).join("") + '</div>' +
    '<label>Source<select id="src">' + opt(SOURCES) + '</select></label>' +
    '<label style="flex-direction:row;align-items:center;gap:10px;text-transform:none;letter-spacing:0;font-size:14px;color:var(--ink)"><input id="trek" type="checkbox" onchange="calcAmount()" style="width:22px;height:22px"> Trekking add-on (+' + money(TREKKING_COST) + ')</label>' +
    '<label>Amount (after advance)<input id="amt" type="number" min="0" placeholder="Amount"></label>' +
    '<label>Advance paid<input id="adv" oninput="calcAmount()" type="number" min="0" placeholder="Advance paid"></label>' +
    '<div class="empty" id="rateNote" style="margin-bottom:8px"></div><div class="err" id="err"></div><button class="btn" onclick="addB()">CONFIRM BOOKING</button>';
}

async function addB(){
  var g = document.getElementById("guest").value.trim();
  var ci = document.getElementById("ci").value, co = document.getElementById("co").value;
  var src = document.getElementById("src").value;
  var picked = Array.prototype.map.call(document.querySelectorAll(".rm:checked"), function(x){ return x.value; });
  var amt = Number(document.getElementById("amt").value), adv = Number(document.getElementById("adv").value) || 0;
  var err = document.getElementById("err");
  if (!g) { err.textContent = "Enter the guest name."; return; }
  if (!ci || !co || co <= ci) { err.textContent = "Check-out must be after check-in."; return; }
  if (!(amt >= 0) || amt + adv <= 0) { err.textContent = "Enter the advance or the amount."; return; }
  if (!picked.length) { err.textContent = "Pick at least one room."; return; }
  var busy = picked.filter(function(r){ return active().some(function(b){ return ci < b.checkOut && b.checkIn < co && roomsOf(b).indexOf(r) >= 0; }); });
  if (busy.length) { err.textContent = busy.join(", ") + " already booked for those dates."; return; }
  try {
    await api("/api/bookings", "POST", { bookingDate: today(), guest: g, phone: document.getElementById("phone").value.trim(), rooms: picked, checkIn: ci, checkOut: co, amount: amt, advance: adv, source: src, trekking: document.getElementById("trek").checked });
    await loadAll(); tab = "Home"; render();
  } catch(e){ err.textContent = e.message; }
}

async function cancelB(id){
  try { await api("/api/bookings/" + id + "/cancel", "POST"); await loadAll(); render(); } catch(e){ alert(e.message); }
}

var calMonth = null, calSel = null;
var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
var WEEK = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
function shiftMonth(n){
  var d = new Date((calMonth || today().slice(0,7)) + "-01T00:00:00");
  d.setMonth(d.getMonth() + n);
  calMonth = iso(d).slice(0,7); calSel = null; render();
}
function thisMonth(){ calMonth = null; calSel = null; render(); }
function selDay(d){ calSel = d; render(); }
function calendar(){
  var t = today(), a = active(), m = calMonth || t.slice(0,7);
  var y = Number(m.slice(0,4)), mo = Number(m.slice(5,7)), n = new Date(y, mo, 0).getDate(), first = new Date(y, mo - 1, 1).getDay();
  var sel = calSel && calSel.slice(0,7) === m ? calSel : (m === t.slice(0,7) ? t : null);
  var nFull = 0, nPart = 0, nFree = 0, cells = "";
  var filledOn = function(d){ return ROOMS.filter(function(r){ return a.some(function(b){ return stays(b, d) && roomsOf(b).indexOf(r) >= 0; }); }).length; };
  for (var i = 0; i < first; i++) cells += '<div></div>';
  for (var day = 1; day <= n; day++) {
    var d = m + "-" + (day < 10 ? "0" : "") + day, c = filledOn(d);
    if (c === 0) nFree++; else if (c >= ROOMS.length) nFull++; else nPart++;
    cells += '<div class="dc' + (c === 0 ? "" : c >= ROOMS.length ? " full" : " part") + (d === t ? " today" : "") + (d === sel ? " sel" : "") + '" onclick="selDay(\'' + d + '\')">' + day + '</div>';
  }
  var h = '<div class="card"><div class="mnav"><button class="mini" onclick="shiftMonth(-1)" aria-label="Previous month">&#8249;</button><span class="mt">' + MONTHS[mo-1] + ' ' + y + '</span><button class="mini" onclick="shiftMonth(1)" aria-label="Next month">&#8250;</button></div>';
  h += '<div class="mcal wk">' + ["S","M","T","W","T","F","S"].map(function(x){ return '<div>' + x + '</div>'; }).join("") + '</div>';
  h += '<div class="mcal">' + cells + '</div>';
  h += '<div class="legrow"><div><span class="dot free"></span>Free<b>' + nFree + '</b></div><div><span class="dot part"></span>Some rooms<b>' + nPart + '</b></div><div><span class="dot full"></span>All rooms<b>' + nFull + '</b></div></div>';
  if (m !== t.slice(0,7)) h += '<div style="text-align:center;margin-top:12px"><button class="chip" onclick="thisMonth()">Back to this month</button></div>';
  h += '</div>';
  if (sel) {
    var dd = new Date(sel + "T00:00:00"), bks = a.filter(function(x){ return stays(x, sel); });
    h += '<div class="card"><h2>' + WEEK[dd.getDay()] + ', ' + dd.getDate() + ' ' + MONTHS[dd.getMonth()].slice(0,3) + ' ' + dd.getFullYear() + '</h2>';
    h += ROOMS.map(function(r, k){
      var bk = bks.filter(function(x){ return roomsOf(x).indexOf(r) >= 0; })[0];
      return '<div class="lb"' + (k === 0 ? ' style="border-top:0"' : '') + '><span><b style="color:var(--ink)">' + r + '</b></span>' +
        (bk ? '<span style="color:var(--gold);font-weight:600">Filled</span>' : '<span>Free</span>') + '</div>';
    }).join("") + '</div>';
  }
  return h;
}

function setPeriod(p){ period = p; render(); }

function reports(){
  var a = active().filter(inPeriod);
  var h = '<div class="chips">' + [["1","Today"],["7","Last 7 days"],["30","This month"],["all","All"]].map(function(p){
    return '<button class="chip' + (period === p[0] ? " on" : "") + '" onclick="setPeriod(\'' + p[0] + '\')">' + p[1] + '</button>';
  }).join("") + '</div>';

  var by = {};
  a.forEach(function(b){ var d = by[b.bookingDate] || (by[b.bookingDate] = { n: 0, r: 0 }); d.n++; d.r += b.advance + b.amount; });
  var ks = Object.keys(by).sort().reverse().slice(0,10);
  h += '<div class="card"><h2>Bookings by booking date</h2><div class="tr h"><div>Booking date</div><div>Bookings</div><div>Revenue</div></div>' +
    (ks.length ? ks.map(function(k){ return '<div class="tr"><div>' + k + '</div><div>' + by[k].n + '</div><div>' + money(by[k].r) + '</div></div>'; }).join("") : '<div class="empty">No bookings in this period.</div>') + '</div>';

  var all = active(), occ = "";
  for (var i = 0; i < 3; i++) {
    var d = addDays(today(), i), bk = all.filter(function(b){ return stays(b,d); })[0];
    occ += '<div class="tr"><div>' + d + '</div><div>' + (bk ? esc(bk.guest) : 'Free') + '</div><div>' + (bk ? 'Booked' : '-') + '</div></div>';
  }
  h += '<div class="card"><h2>Bookings by stay date</h2><div class="tr h"><div>Stay date</div><div>Guest</div><div>Status</div></div>' + occ + '</div>';

  var bs = {}; SOURCES.forEach(function(s){ bs[s] = 0; });
  a.forEach(function(b){ bs[b.source] = (bs[b.source] || 0) + b.advance + b.amount; });
  var mx = Math.max.apply(null, Object.keys(bs).map(function(k){ return bs[k]; }).concat([1]));
  h += '<div class="card"><h2>Revenue by source</h2>' + Object.keys(bs).map(function(s){
    return '<div class="src"><div class="n">' + esc(s) + '</div><div class="t"><div class="f" style="width:' + Math.round(bs[s]/mx*100) + '%"></div></div><div class="a">' + money(bs[s]) + '</div></div>';
  }).join("") + '</div>';

  h += '<div style="display:flex;gap:12px"><button class="btn" onclick="csv()">EXPORT EXCEL</button><button class="btn out" onclick="pdf()">EXPORT PDF</button></div><div id="csvbox"></div>';
  return h;
}

function csv(){
  var rows = [["Booking ID","Booking date","Guest","Phone","Rooms","Check-in","Check-out","Amount","Advance","Source","Trekking","Status"]];
  bookings.forEach(function(b){ rows.push([b.id,b.bookingDate,b.guest,b.phone,roomsText(b),b.checkIn,b.checkOut,b.amount,b.advance,b.source,b.trekking ? "Yes" : "No",b.status]); });
  var text = rows.map(function(r){ return r.map(function(c){ return '"' + String(c).replace(/"/g,'""') + '"'; }).join(","); }).join("\n");
  document.getElementById("csvbox").innerHTML = '<div class="empty" style="margin-top:10px">Copied. Paste into Excel or Google Sheets.</div><textarea id="csvtxt" readonly>' + esc(text) + '</textarea>';
  try { navigator.clipboard.writeText(text); } catch(e){}
  document.getElementById("csvtxt").select();
}
function pdf(){ try { window.print(); } catch(e){} }

function showLogin(){
  document.getElementById("title").textContent = "Sign in";
  document.getElementById("brand").textContent = resortName.toUpperCase();
  document.getElementById("tabs").innerHTML = "";
  document.getElementById("main").innerHTML = '<label>Role<select id="rl"><option>Staff</option><option>Owner</option></select></label><label>PIN<input id="pin" type="password" inputmode="numeric" placeholder="PIN"></label><div class="err" id="err"></div><button class="btn" onclick="login()">SIGN IN</button><div class="empty" style="margin-top:12px">Ask the owner for your PIN.</div>';
}
async function login(){
  var r = document.getElementById("rl").value, p = document.getElementById("pin").value;
  try {
    var res = await api("/api/login", "POST", { role: r, pin: p });
    role = res.role; perms = res.can; await loadAll(); tab = "Home"; render();
  } catch(e){ document.getElementById("err").textContent = e.message; }
}
async function logout(){
  try { await api("/api/logout", "POST"); } catch(e){}
  role = null; editId = null; render();
}
function can(a){ return role === "Owner" || (role === "Staff" && perms[a]); }
function visibleTabs(){ return TABS.filter(function(t){ return t[0] !== "Reports" || can("reports"); }); }
function roleBar(){
  var h = '<div class="lb" style="border-top:0;padding-top:0;flex-direction:column;align-items:stretch;gap:10px"><span>Signed in as <b style="color:var(--ink)">' + role + '</b></span><span style="display:flex;gap:8px;flex-wrap:wrap">' + (can("editName") ? '<button class="mini" onclick="toggleName()">Resort name</button>' : '') + (role === "Owner" ? '<button class="mini" onclick="toggleRates()">Rate</button><button class="mini" onclick="togglePin()">Change PIN</button>' : '') + '<button class="mini" onclick="logout()">Sign out</button></span></div>';
  if (can("editName") && nameEdit) h += '<div class="card"><label>Resort name<input id="rname" value="' + esc(resortName) + '"></label><div style="display:flex;gap:12px"><button class="btn" onclick="saveName()">SAVE NAME</button><button class="btn out" onclick="toggleName()">CLOSE</button></div></div>';
  if (role === "Owner" && rateEdit) h += '<div class="card"><h2>Rate per night (all 4 rooms)</h2><label>Rate<input id="rate_all" type="number" min="0" value="' + (rateNow() || "") + '" placeholder="Rate per night"></label><div style="display:flex;gap:12px"><button class="btn" onclick="saveRates()">SAVE RATE</button><button class="btn out" onclick="toggleRates()">CLOSE</button></div></div>';
  if (role === "Owner" && pinEdit) h += '<div class="card"><h2>Change PIN</h2><label>Change PIN for<select id="pwho"><option>Staff</option><option>Owner</option></select></label><label>Your current Owner PIN<input id="pcur" type="password" inputmode="numeric" autocomplete="off" placeholder="Current Owner PIN"></label><label>New PIN (4 to 8 digits)<input id="pnew" type="password" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="New PIN"></label><label>Repeat new PIN<input id="pnew2" type="password" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="Repeat new PIN"></label><div class="err" id="perr"></div><div style="display:flex;gap:12px"><button class="btn" onclick="savePin()">SAVE PIN</button><button class="btn out" onclick="togglePin()">CLOSE</button></div></div>';
  return h;
}
function togglePin(){ if (role !== "Owner") return; pinEdit = !pinEdit; render(); }
async function savePin(){
  if (role !== "Owner") return;
  var who = document.getElementById("pwho").value, cur = document.getElementById("pcur").value.trim();
  var np = document.getElementById("pnew").value.trim(), np2 = document.getElementById("pnew2").value.trim();
  var e = document.getElementById("perr");
  if (!cur) { e.textContent = "Enter your current Owner PIN."; return; }
  if (!/^\d{4,8}$/.test(np)) { e.textContent = "New PIN must be 4 to 8 digits."; return; }
  if (np !== np2) { e.textContent = "The two new PINs do not match."; return; }
  try {
    await api("/api/pins", "POST", { role: who, currentPin: cur, newPin: np });
    pinEdit = false; render(); alert(who + " PIN changed.");
  } catch(ex){ e.textContent = ex.message; }
}
function toggleRates(){ if (role !== "Owner") return; rateEdit = !rateEdit; render(); }
async function saveRates(){
  if (role !== "Owner") return;
  var out = { ALL: Number(document.getElementById("rate_all").value) || 0 };
  try {
    var s = await api("/api/settings", "PUT", { room_rates: out });
    rates = s.room_rates; rateEdit = false; render();
  } catch(e){ alert(e.message); }
}
function toggleName(){ if (!can("editName")) return; nameEdit = !nameEdit; render(); }
async function saveName(){
  if (!can("editName")) return;
  var v = document.getElementById("rname").value.trim();
  if (!v) return;
  try {
    var s = await api("/api/settings", "PUT", { resort_name: v });
    resortName = s.resort_name; document.title = resortName; nameEdit = false; render();
  } catch(e){ alert(e.message); }
}
function rowBtns(b){
  if (b.status === "Cancelled") return '';
  return '<span style="display:flex;gap:6px;align-items:center"><span style="color:var(--gold)">' + (b.amount > 0 ? 'Bal ' + money(b.amount) : 'Paid') + '</span>' + (can("recordPayment") && b.amount > 0 ? '<button class="mini" onclick="openPay(\'' + b.id + '\')">Receive</button>' : '') + (can("editAmount") ? '<button class="mini" onclick="openEdit(\'' + b.id + '\')">Edit</button>' : '') + (can("cancel") ? '<button class="mini" onclick="cancelB(\'' + b.id + '\')">Cancel</button>' : '') + '</span>';
}
function openEdit(id){ editId = id; render(); window.scrollTo(0,0); }
function closeEdit(){ editId = null; render(); }
function editView(){
  var b = bookings.filter(function(x){ return x.id === editId; })[0];
  var hist = (b.log || []).slice().reverse().map(function(l){ return '<div class="lb"><span>' + esc(l) + '</span></div>'; }).join("");
  return '<div class="card"><h2>' + esc(b.guest) + '</h2><div class="empty">' + roomsText(b) + ' · ' + b.checkIn + ' → ' + b.checkOut + ' · ' + esc(b.source) + (b.trekking ? ' · Trekking' : '') + '</div></div>' +
    '<label style="flex-direction:row;align-items:center;gap:10px;text-transform:none;letter-spacing:0;font-size:14px;color:var(--ink)"><input id="etrek" type="checkbox" onchange="toggleTrek()" ' + (b.trekking ? 'checked ' : '') + 'style="width:22px;height:22px"> Trekking add-on (+' + money(TREKKING_COST) + ')</label>' +
    '<label>Total amount (room + trekking, auto)<input id="etot" type="number" readonly data-base="' + (b.advance + b.amount - (b.trekking ? TREKKING_COST : 0)) + '" value="' + (b.advance + b.amount) + '"></label>' +
    '<label>Advance paid (total so far)<input id="eadv" oninput="calcEdit()" type="number" min="0" value="' + b.advance + '"></label>' +
    '<label>Amount (remaining, auto)<input id="eamt" type="number" readonly value="' + b.amount + '"></label>' +
    '<label>Reason for change<input id="ern" placeholder="Reason"></label>' +
    '<div class="err" id="err"></div><div style="display:flex;gap:12px"><button class="btn" onclick="saveEdit()">SAVE CHANGES</button><button class="btn out" onclick="closeEdit()">BACK</button></div>' +
    '<div class="card" style="margin-top:14px"><h2>Change history</h2>' + (hist || '<div class="empty">No changes yet.</div>') + '</div>';
}
function toggleTrek(){
  var t = document.getElementById("etot"), on = document.getElementById("etrek").checked;
  t.value = Math.max(0, (Number(t.getAttribute("data-base")) || 0) + (on ? TREKKING_COST : 0));
  calcEdit();
}
function calcEdit(){
  var tot = Number(document.getElementById("etot").value) || 0, adv = Number(document.getElementById("eadv").value) || 0;
  document.getElementById("eamt").value = Math.max(0, tot - adv);
}
async function saveEdit(){
  var b = bookings.filter(function(x){ return x.id === editId; })[0];
  var tot = Number(document.getElementById("etot").value), adv = Number(document.getElementById("eadv").value) || 0;
  var amt = tot - adv, trek = document.getElementById("etrek").checked;
  var rn = document.getElementById("ern").value.trim(), err = document.getElementById("err");
  if (trek !== !!b.trekking && !rn) rn = "Guest's choice";
  if (!(tot >= 0)) { err.textContent = "Enter a valid total amount."; return; }
  if (!(amt >= 0)) { err.textContent = "Advance cannot be more than the total."; return; }
  if (amt === b.amount && adv === b.advance && trek === !!b.trekking) { editId = null; render(); return; }
  if (amt !== b.amount && !rn) { err.textContent = "Add a reason for changing the amount."; return; }
  try {
    await api("/api/bookings/" + b.id, "PATCH", { amount: amt, advance: adv, reason: rn, trekking: trek });
    await loadAll(); editId = null; render();
  } catch(e){ err.textContent = e.message; }
}

api("/api/me")
  .then(function(m){ role = m.role; perms = m.can; return loadAll(); })
  .then(render)
  .catch(function(){
    role = null;
    api("/api/settings").then(function(s){ resortName = s.resort_name; document.title = resortName; render(); }).catch(render);
  });

function openPay(id){ payId = id; render(); window.scrollTo(0,0); }
function closePay(){ payId = null; render(); }
function payView(){
  var b = bookings.filter(function(x){ return x.id === payId; })[0];
  var bal = b.amount;
  var hist = (b.log || []).slice().reverse().map(function(l){ return '<div class="lb"><span>' + esc(l) + '</span></div>'; }).join("");
  return '<div class="card"><h2>' + esc(b.guest) + '</h2>' +
    '<div class="lb"><span>Total (advance + amount)</span><span>' + money(b.advance + b.amount) + '</span></div>' +
    '<div class="lb"><span>Paid so far</span><span>' + money(b.advance) + '</span></div>' +
    '<div class="lb"><span>Balance to collect</span><span style="color:var(--gold)">' + money(bal) + '</span></div></div>' +
    '<label>Payment received now<input id="pamt" type="number" min="1" max="' + bal + '" placeholder="Amount received"></label>' +
    '<label>Note (cash, UPI, card)<input id="pnote" placeholder="Note"></label>' +
    '<div class="err" id="err"></div><div style="display:flex;gap:12px"><button class="btn" onclick="savePay()">SAVE PAYMENT</button><button class="btn out" onclick="closePay()">BACK</button></div>' +
    '<div class="card" style="margin-top:14px"><h2>History</h2>' + (hist || '<div class="empty">No changes yet.</div>') + '</div>';
}
async function savePay(){
  var b = bookings.filter(function(x){ return x.id === payId; })[0];
  var amt = Number(document.getElementById("pamt").value), err = document.getElementById("err");
  if (!(amt > 0)) { err.textContent = "Enter the amount received."; return; }
  if (amt > b.amount) { err.textContent = "Payment is more than the balance."; return; }
  try {
    await api("/api/bookings/" + b.id + "/payment", "POST", { amount: amt, note: document.getElementById("pnote").value.trim() });
    await loadAll(); payId = null; render();
  } catch(e){ err.textContent = e.message; }
}

function calcAmount(){
  var ci = document.getElementById("ci"), co = document.getElementById("co"), note = document.getElementById("rateNote");
  if (!ci || !co || !note) return;
  var rate = rateNow();
  var trek = document.getElementById("trek") && document.getElementById("trek").checked ? TREKKING_COST : 0;
  var nights = Math.round((new Date(co.value + "T00:00:00") - new Date(ci.value + "T00:00:00")) / 86400000);
  if (!rate || !(nights > 0)) { note.textContent = rate ? "" : "No rate set. Enter the amount yourself" + (trek ? " (include trekking " + money(trek) + ")" : "") + "."; return; }
  var adv = Number(document.getElementById("adv").value) || 0, total = rate * nights + trek;
  document.getElementById("amt").value = Math.max(0, total - adv);
  note.textContent = "Rate " + money(rate) + " x " + nights + " night" + (nights > 1 ? "s" : "") + (trek ? " + trekking " + money(trek) : "") + " = " + money(total) + ". Amount = total minus advance.";
}