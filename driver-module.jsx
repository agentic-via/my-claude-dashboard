import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Truck, Check, X, MapPin, Package, AlertTriangle, Plus, Trash2, Camera,
  RotateCcw, Lock, Route, Loader2, ClipboardList,
} from "lucide-react";

/* ==================================================================
   Truck Loading — DRIVER workspace
   Standalone demo. Phone-first. Own sample data and storage key.
   ================================================================== */

const KEY = "tl-driver-demo:v1";
const MIN = 60000;

const uid = () => Math.random().toString(36).slice(2, 9);
const now = () => new Date().toISOString();
const num = (x) => Number(x) || 0;
const usd = (n) => "$" + num(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");
const dmy = (iso) => (iso ? new Date(iso).toLocaleDateString([], { day: "2-digit", month: "short" }) : "—");

const isPickup = (st) => st.kind === "pickup";
const isDrop = (st) => (st.kind || "drop") === "drop";
const isOpen = (st) => st.status === "wait";

const OUTCOMES = [
  { k: "done", label: "Delivered" },
  { k: "attempted", label: "Couldn't deliver" },
  { k: "refused", label: "Refused" },
  { k: "cancelled", label: "Cancelled" },
  { k: "rescheduled", label: "Rebooked" },
];
const OUT = Object.fromEntries(OUTCOMES.map((o) => [o.k, o]));

const REASONS = {
  attempted: ["Nobody on site", "Site closed", "No dock space", "Access blocked", "Out of hours", "Breakdown"],
  refused: ["Consignee refused", "Damage found on arrival", "Wrong goods", "Paperwork mismatch", "Short shipment"],
  cancelled: ["Client cancelled", "Returning to shipper"],
  rescheduled: ["Rebooked by client", "Rebooked by dispatch"],
};

function labelsOf(stops) {
  let p = 0, d = 0;
  const m = {};
  stops.forEach((x) => { m[x.id] = isPickup(x) ? `P${++p}` : `${++d}`; });
  return m;
}
const titleOf = (st, L) => (isPickup(st) ? `Pickup ${L[st.id]}` : `Load ${L[st.id]}`);

/* ---------------- navigation ---------------- */

function navHref(address, provider, avoidTolls, pin) {
  const dest = (pin && pin.lat != null) ? `${pin.lat},${pin.lng}` : address;
  const d = encodeURIComponent(dest || "");
  if (provider === "apple") return `https://maps.apple.com/?daddr=${d}&dirflg=d`;
  return `https://www.google.com/maps/dir/?api=1&destination=${d}&travelmode=driving${avoidTolls ? "&avoid=tolls" : ""}`;
}

function grabPosition() {
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5) }),
      () => res(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });
}

function shrink(file, max = 620) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error("read"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error("decode"));
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL("image/jpeg", 0.55));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/* ---------------- sample data ---------------- */

function seedState() {
  const s = (kind, name, address, extra = {}) => ({
    id: uid(), kind, name, address, window: "", ref: "", contact: "", contactPhone: "",
    status: "wait", arrivedAt: null, departedAt: null, deliveredAt: null, paperPhoto: null, ...extra,
  });

  const stops = [
    s("pickup", "Meridian Warehouse 3", "8200 Wallisville Rd, Houston, TX 77029",
      { window: "08:00", ref: "ACP03013P", contact: "S. Whitfield", contactPhone: "+1 713 555 0110" }),
    s("pickup", "Meridian Yard 7", "12000 Bay Area Blvd, Pasadena, TX 77507",
      { window: "10:30", ref: "ACP03014P", contact: "S. Whitfield" }),
    s("drop", "Katy Distribution", "1500 Katy Fwy, Katy, TX 77094",
      { window: "12:00–15:00", ref: "PO-4471", contact: "R. Dhillon", contactPhone: "+1 281 555 0170",
        pin: { lat: 29.7856, lng: -95.8244, how: "client dropped pin — receiving door at the rear" } }),
    s("drop", "Sugar Land Depot", "50 Industrial Blvd, Sugar Land, TX 77478",
      { window: "13:00–16:00", ref: "PO-4488", contact: "M. Torres" }),
    s("drop", "Baytown Terminal", "4500 Decker Dr, Baytown, TX 77520", { ref: "PO-4490" }),
  ];

  return {
    driver: {
      id: "d1", name: "Harjit Singh", payType: "percent", payRate: 25,
      mapPref: "google", avoidTolls: true,
      licenceExpiry: new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10),
      medicalExpiry: new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10),
    },
    vehicle: { id: "v1", unitNo: "T-104", trailerNo: "TR-2290", type: "Tractor + 53' dry van", capacityLb: 44000, odometer: 418200 },
    policy: { driverSeesPay: true },
    trip: {
      id: uid(), tripNo: "TL-1042", client: "Meridian Freight Co.",
      date: new Date().toISOString().slice(0, 10),
      status: "assigned", stops, items: [],
      flatRate: 650, extraStopRate: 75, fuelPct: 18,
      notes: "Gate code 4471. Dock 3 at the warehouse, ask for Sam.",
      audit: [], pings: [], routeChange: null, endOdometer: "",
    },
  };
}

async function load() {
  try {
    const r = await window.storage.get(KEY);
    if (!r) return seedState();
    const p = JSON.parse(r.value);
    const b = seedState();
    return { driver: p.driver || b.driver, vehicle: p.vehicle || b.vehicle, policy: p.policy || b.policy, trip: p.trip || b.trip };
  } catch { return seedState(); }
}
async function save(st) {
  try { await window.storage.set(KEY, JSON.stringify(st)); }
  catch (e) { console.error("save failed", e); }
}

/* ---------------- pay ---------------- */

function grossOf(trip) {
  const worked = (trip.stops || []).filter((x) => x.status === "done").length;
  const extras = Math.max(0, worked - 2);
  const linehaul = num(trip.flatRate) + extras * num(trip.extraStopRate);
  return linehaul + linehaul * num(trip.fuelPct) / 100;
}
function payOf(trip, driver) {
  const g = grossOf(trip);
  if (driver.payType === "flat") return num(driver.payRate);
  if (driver.payType === "per_stop") return num(driver.payRate) * (trip.stops || []).length;
  return g * num(driver.payRate) / 100;
}

/* ================================================================== */

const CSS = `
:root{
  --ink:#16202B; --ink2:#2A3A4B; --mute:#6B7A88;
  --dock:#DFE1DE; --card:#F8F9F7; --line:#C3C7C2;
  --hiviz:#F2B705; --sea:#2B5F8A; --go:#2E7D53; --stop:#B3392F;
}
*{box-sizing:border-box}
.dr{ background:var(--dock); color:var(--ink); min-height:100vh; padding-bottom:44px;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif; font-size:16px; line-height:1.45 }
.dr-display{ font-family:"Arial Narrow","Roboto Condensed",system-ui,sans-serif;
  text-transform:uppercase; letter-spacing:.06em; font-weight:800; line-height:1.05 }
.dr-data{ font-family:ui-monospace,"SF Mono",Menlo,monospace; font-variant-numeric:tabular-nums }
.dr-eyebrow{ font-size:10px; letter-spacing:.18em; text-transform:uppercase; color:var(--mute); font-weight:700 }
.dr-note{ font-size:12.5px; color:var(--mute); margin:6px 0 0 }

.dr-bar{ background:var(--ink); color:#fff; padding:12px 14px; display:flex; align-items:center; gap:10px; position:sticky; top:0; z-index:20 }
.dr-bar h1{ margin:0; font-size:17px }
.dr-wrap{ max-width:560px; margin:0 auto; padding:14px }

.dr-card{ background:var(--card); border:1px solid var(--line); border-radius:3px; padding:14px; margin-bottom:12px }
.dr-hr{ border:0; border-top:1px dashed var(--line); margin:12px 0 }

/* big targets — this is used in a truck cab */
.dr-btn{ display:flex; align-items:center; justify-content:center; gap:9px; width:100%; padding:16px; border:0; border-radius:3px;
  background:var(--ink); color:#fff; font-size:15px; font-weight:800; letter-spacing:.07em; text-transform:uppercase;
  cursor:pointer; font-family:"Arial Narrow","Roboto Condensed",system-ui,sans-serif; margin-bottom:10px; text-decoration:none }
.dr-btn[data-v="go"]{ background:var(--go) }
.dr-btn[data-v="hiviz"]{ background:var(--hiviz); color:var(--ink) }
.dr-btn[data-v="ghost"]{ background:none; color:var(--ink); border:1px solid var(--line) }
.dr-btn[data-v="stop"]{ background:var(--stop) }
.dr-btn:disabled{ background:#AEB6BD; cursor:not-allowed }
.dr-btn-sm{ padding:10px 13px; font-size:12.5px; width:auto; margin-bottom:0 }
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{ outline:3px solid var(--sea); outline-offset:2px }

.dr-fld{ margin-bottom:11px }
.dr-fld label{ display:block; font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--mute); font-weight:700; margin-bottom:4px }
.dr-fld input,.dr-fld select,.dr-fld textarea{ width:100%; padding:12px; border:1px solid var(--line); border-radius:2px; background:#fff;
  font-size:16px; font-family:ui-monospace,Menlo,monospace; color:var(--ink) }
.dr-row{ display:flex; gap:8px } .dr-row>*{ flex:1 }

.dr-tag{ display:inline-block; padding:2px 7px; border-radius:2px; font-size:10px; font-weight:800; letter-spacing:.09em; text-transform:uppercase }
.dr-tag[data-t="done"]{ background:#DCEEE3; color:var(--go) }
.dr-tag[data-t="now"]{ background:#FFF0C2; color:#6B5200 }
.dr-tag[data-t="wait"]{ background:#E4E7E4; color:var(--mute) }
.dr-tag[data-t="exc"]{ background:#F8E3E1; color:var(--stop) }

.dr-kv{ display:grid; grid-template-columns:1fr auto; gap:3px 10px; font-size:13.5px }
.dr-kv i{ font-style:normal; color:var(--mute) }

.dr-prog{ background:var(--card); border:1px solid var(--line); border-radius:3px; padding:11px 12px; margin-bottom:12px }
.dr-segs{ display:flex; gap:2px; height:10px; margin-top:8px }
.dr-seg{ flex:1; border-radius:2px; background:#D2D6D2; min-width:4px; position:relative }
.dr-seg[data-s="done"]{ background:var(--go) }
.dr-seg[data-s="exc"]{ background:var(--stop) }
.dr-seg[data-s="now"]{ background:var(--hiviz); box-shadow:0 0 0 2px var(--ink) }
.dr-seg[data-k="pickup"]::after{ content:""; position:absolute; left:50%; top:-5px; transform:translateX(-50%);
  width:0;height:0;border-left:3px solid transparent;border-right:3px solid transparent;border-bottom:4px solid var(--sea) }

.dr-stop{ border:1px solid var(--line); background:#fff; border-radius:2px; padding:12px; margin-bottom:8px; display:flex; gap:10px; align-items:flex-start }
.dr-stop[data-s="done"]{ border-left:4px solid var(--go) }
.dr-stop[data-s="now"]{ border-left:4px solid var(--hiviz) }
.dr-stop[data-s="exc"]{ border-left:4px solid var(--stop) }
.dr-stop[data-s="wait"]{ opacity:.62 }
.dr-seq{ width:32px;height:32px;flex:0 0 32px;border-radius:50%;background:var(--ink);color:#fff;
  display:grid;place-items:center;font-family:ui-monospace,monospace;font-size:14px;font-weight:700 }

/* hazard stripe — only where he is blocked */
.dr-block{ border:2px solid var(--ink); border-radius:3px; margin-bottom:12px; overflow:hidden }
.dr-block-top{ height:10px; background:repeating-linear-gradient(45deg,var(--hiviz) 0 10px,var(--ink) 10px 20px) }
.dr-block[data-soft="1"]{ border-width:1px; border-color:var(--line) }
.dr-block[data-soft="1"] .dr-block-top{ height:4px; background:var(--hiviz) }
.dr-block-body{ background:#FFF8E1; padding:12px 13px }
.dr-block[data-soft="1"] .dr-block-body{ background:#FDFBF2 }
.dr-block-body p{ margin:0 0 6px; font-size:13.5px; font-weight:700; display:flex; gap:6px; align-items:center }
.dr-block-body ul{ margin:0; padding-left:18px; font-size:13.5px }

.dr-alert{ border:2px solid var(--sea); background:#EAF1F8; border-radius:3px; padding:13px; margin-bottom:12px }
.dr-alert[data-tone="stop"]{ border-color:var(--stop); background:#FDF1F0 }
.dr-alert h4{ margin:0 0 5px; font-size:15px }

.dr-thumb{ width:100%; max-height:200px; object-fit:cover; border:1px solid var(--line); border-radius:2px; display:block }
.dr-sig{ border:1px dashed var(--ink); border-radius:2px; background:#fff; touch-action:none; width:100%; display:block }
.dr-item{ border:1px solid var(--line); border-left:4px solid var(--sea); background:#fff; border-radius:2px; padding:11px; margin-bottom:8px }
.dr-cap{ height:8px; background:#D2D6D2; border-radius:4px; overflow:hidden; margin:8px 0 4px }
.dr-cap div{ height:100% }
.dr-empty{ text-align:center; padding:28px 14px; color:var(--mute) }
`;

/* ================================================================== */
/* Pieces                                                             */
/* ================================================================== */

function Blocked({ reasons, soft }) {
  if (!reasons.length) return null;
  return (
    <div className="dr-block" data-soft={soft ? "1" : undefined}>
      <div className="dr-block-top" />
      <div className="dr-block-body">
        <p><AlertTriangle size={15} />{soft ? "Worth checking before you go" : "You can't leave yet"}</p>
        <ul>{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        {soft && <p style={{ marginTop: 8, fontWeight: 400, fontSize: 12.5 }}>None of this stops you — carry on if it's right.</p>}
      </div>
    </div>
  );
}

function PhotoField({ label, value, onChange, hint }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try { onChange(await shrink(f)); } catch { alert("Couldn't read that photo. Try again."); }
    setBusy(false);
    e.target.value = "";
  };
  return (
    <div style={{ marginBottom: 11 }}>
      <div className="dr-eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      {value ? (
        <>
          <img src={value} alt={label} className="dr-thumb" />
          <button className="dr-btn dr-btn-sm" data-v="ghost" style={{ marginTop: 7 }} onClick={() => onChange(null)}>
            <RotateCcw size={13} /> Retake
          </button>
        </>
      ) : (
        <>
          <button className="dr-btn" data-v="ghost" onClick={() => ref.current?.click()} disabled={busy}>
            <Camera size={17} /> {busy ? "Processing…" : "Take photo"}
          </button>
          {hint && <p className="dr-note">{hint}</p>}
        </>
      )}
      <input ref={ref} type="file" accept="image/*" capture="environment" onChange={pick} style={{ display: "none" }} />
    </div>
  );
}

function SignaturePad({ value, onChange }) {
  const cv = useRef(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    c.width = w * dpr; c.height = 160 * dpr;
    const x = c.getContext("2d");
    x.scale(dpr, dpr);
    x.lineWidth = 2.4; x.lineCap = "round"; x.strokeStyle = "#16202B";
    x.fillStyle = "#fff"; x.fillRect(0, 0, w, 160);
  }, []);

  const pos = (e) => {
    const r = cv.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e) => { e.preventDefault(); drawing.current = true; const p = pos(e); const x = cv.current.getContext("2d"); x.beginPath(); x.moveTo(p.x, p.y); };
  const move = (e) => { if (!drawing.current) return; e.preventDefault(); const p = pos(e); const x = cv.current.getContext("2d"); x.lineTo(p.x, p.y); x.stroke(); dirty.current = true; };
  const up = () => { if (!drawing.current) return; drawing.current = false; if (dirty.current) onChange(cv.current.toDataURL("image/png")); };
  const clear = () => {
    const c = cv.current, x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, c.clientWidth, 160);
    dirty.current = false; onChange(null);
  };

  if (value) {
    return (
      <div style={{ marginBottom: 11 }}>
        <div className="dr-eyebrow" style={{ marginBottom: 6 }}>Signature</div>
        <img src={value} alt="signature" style={{ width: "100%", border: "1px solid var(--line)", background: "#fff" }} />
        <button className="dr-btn dr-btn-sm" data-v="ghost" style={{ marginTop: 7 }} onClick={clear}>
          <RotateCcw size={13} /> Sign again
        </button>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 11 }}>
      <div className="dr-eyebrow" style={{ marginBottom: 6 }}>Signature</div>
      <canvas ref={cv} className="dr-sig" style={{ height: 160 }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
      <p className="dr-note">Hand the phone to whoever is receiving the load.</p>
    </div>
  );
}

function NavButton({ address, label, driver, onDriver, pin }) {
  const prov = driver.mapPref || "google";
  const avoid = driver.avoidTolls !== false;
  const usingPin = pin && pin.lat != null;
  return (
    <div style={{ marginBottom: 11 }}>
      <a href={navHref(address, prov, avoid, pin)} target="_blank" rel="noreferrer" className="dr-btn" data-v="ghost">
        <Route size={17} /> {label}
      </a>
      {usingPin && (
        <p className="dr-note dr-data" style={{ margin: "5px 0 0" }}>
          Going to the exact pin ({pin.lat}, {pin.lng}), not the street address.
        </p>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
        {[["google", "Google Maps"], ["apple", "Apple Maps"]].map(([k, l]) => (
          <button key={k} onClick={() => onDriver({ ...driver, mapPref: k })} aria-pressed={prov === k}
            style={{
              flex: 1, padding: "10px 6px", borderRadius: 3, cursor: "pointer", fontSize: 12.5, fontWeight: 800,
              border: prov === k ? "2px solid var(--ink)" : "1px solid var(--line)",
              background: prov === k ? "var(--hiviz)" : "#fff", color: "var(--ink)",
            }}>{l}</button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <button onClick={() => onDriver({ ...driver, avoidTolls: !avoid })} aria-pressed={avoid}
          style={{
            width: 42, height: 23, borderRadius: 12, border: "1px solid var(--line)", flex: "0 0 42px",
            background: avoid ? "var(--go)" : "#CFD4D0", position: "relative", cursor: "pointer",
          }}>
          <span style={{ position: "absolute", top: 2, left: avoid ? 21 : 2, width: 17, height: 17, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
        </button>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{avoid ? "Avoiding tolls" : "Tolls allowed"}</span>
      </div>
      {prov === "apple" && avoid && (
        <p className="dr-note" style={{ color: "var(--stop)" }}>
          Apple Maps ignores this from a link. Switch to Google above, or set it once in
          Settings → Maps → Driving → Avoid Tolls.
        </p>
      )}
    </div>
  );
}

function ItemCard({ it, stops, labels, onRemove }) {
  const to = stops.find((x) => x.id === it.stopId);
  const v = (x) => (String(x ?? "").trim() ? x : "—");
  return (
    <div className="dr-item">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Package size={16} color="var(--sea)" />
        <b style={{ fontSize: 14.5 }}>{it.description || "Unlabelled item"}</b>
        {onRemove && (
          <button onClick={onRemove} aria-label="Remove"
            style={{ marginLeft: "auto", background: "none", border: 0, cursor: "pointer", color: "var(--stop)" }}>
            <Trash2 size={16} />
          </button>
        )}
      </div>
      <div className="dr-data" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 10px", fontSize: 12.5 }}>
        <div><span style={{ color: "var(--mute)" }}>Qty</span> {v(it.qty)}</div>
        <div><span style={{ color: "var(--mute)" }}>Weight</span> {it.weight ? `${it.weight} lb` : "—"}</div>
        <div><span style={{ color: "var(--mute)" }}>Serial</span> {v(it.serialNo)}</div>
        <div><span style={{ color: "var(--mute)" }}>PO</span> {v(it.poNumber)}</div>
        <div style={{ gridColumn: "1 / -1" }}>
          <span style={{ color: "var(--mute)" }}>Drops at</span> {to ? `Load ${labels[to.id]} · ${to.name}` : "Not assigned"}
        </div>
      </div>
    </div>
  );
}

const BLANK = { description: "", qty: "", weight: "", serialNo: "", poNumber: "", stopId: "" };

function ItemForm({ drops, labels, onAdd }) {
  const [f, setF] = useState(BLANK);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const has = Object.values(f).some((v) => String(v).trim());

  return (
    <div className="dr-card" style={{ borderLeft: "4px solid var(--sea)" }}>
      <div className="dr-eyebrow">Add to manifest · everything optional</div>
      <h3 className="dr-display" style={{ margin: "3px 0 0", fontSize: 17 }}>New line item</h3>
      <p className="dr-note" style={{ marginTop: 2 }}>Fill in what you have. Blanks print as “—”.</p>
      <hr className="dr-hr" />
      <div className="dr-fld"><label>Description</label>
        <input value={f.description} onChange={set("description")} placeholder="Steel racking, palletised" /></div>
      <div className="dr-row">
        <div className="dr-fld"><label>Qty</label>
          <input value={f.qty} onChange={set("qty")} inputMode="numeric" placeholder="12" /></div>
        <div className="dr-fld"><label>Weight (lb)</label>
          <input value={f.weight} onChange={set("weight")} inputMode="numeric" placeholder="1450" /></div>
      </div>
      <div className="dr-row">
        <div className="dr-fld"><label>Serial</label>
          <input value={f.serialNo} onChange={set("serialNo")} placeholder="SN-88213" /></div>
        <div className="dr-fld"><label>PO number</label>
          <input value={f.poNumber} onChange={set("poNumber")} placeholder="PO-4471" /></div>
      </div>
      <div className="dr-fld"><label>Which stop does this drop at?</label>
        <select value={f.stopId} onChange={set("stopId")}>
          <option value="">Not assigned yet</option>
          {drops.map((x) => <option key={x.id} value={x.id}>Load {labels[x.id]} — {x.name}</option>)}
        </select></div>
      <button className="dr-btn" data-v="hiviz" disabled={!has}
        onClick={() => { onAdd({ ...f, id: uid() }); setF(BLANK); }}>
        <Plus size={17} /> Add item
      </button>
    </div>
  );
}

/* ================================================================== */
/* Delivery form                                                      */
/* ================================================================== */

function DeliverForm({ trip, stop, labels, onDone, onCancel }) {
  const [outcome, setOutcome] = useState("done");
  const [unattended, setUnattended] = useState(false);
  const [receiver, setReceiver] = useState("");
  const [sig, setSig] = useState(null);
  const [pod, setPod] = useState(null);
  const [pod2, setPod2] = useState(null);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const items = (trip.items || []).filter((i) => i.stopId === stop.id);
  const deliver = outcome === "done";

  const blocks = [];
  if (deliver) {
    if (!pod) blocks.push("Photo of the goods is missing.");
    if (unattended) {
      if (!pod2) blocks.push("Second photo needed — the door, dock or seal.");
      if (!notes.trim()) blocks.push("Say where exactly you left it.");
    } else {
      if (!receiver.trim()) blocks.push("Receiver's name is missing.");
      if (!sig) blocks.push("Nobody has signed.");
    }
  } else if (!reason) {
    blocks.push("Pick a reason so dispatch knows what happened.");
  }

  return (
    <div className="dr-card" style={{ borderLeft: `4px solid ${deliver ? "var(--hiviz)" : "var(--stop)"}` }}>
      <div className="dr-eyebrow">Load {labels[stop.id]} · closing out</div>
      <h3 className="dr-display" style={{ margin: "3px 0 0", fontSize: 19 }}>{stop.name}</h3>
      <p className="dr-note">{stop.address}</p>
      <hr className="dr-hr" />

      <div className="dr-eyebrow" style={{ marginBottom: 7 }}>What happened here?</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 13 }}>
        {OUTCOMES.map((o) => (
          <button key={o.k} onClick={() => { setOutcome(o.k); setReason(""); }} aria-pressed={outcome === o.k}
            style={{
              padding: "10px 12px", borderRadius: 3, cursor: "pointer", fontSize: 12.5, fontWeight: 800,
              border: outcome === o.k ? "2px solid var(--ink)" : "1px solid var(--line)",
              background: outcome === o.k ? (o.k === "done" ? "var(--go)" : "var(--stop)") : "#fff",
              color: outcome === o.k ? "#fff" : "var(--ink)",
            }}>{o.label}</button>
        ))}
      </div>

      <div className="dr-eyebrow" style={{ marginBottom: 6 }}>Freight for this stop ({items.length})</div>
      {items.length === 0
        ? <p className="dr-note">Nothing was assigned to this stop.</p>
        : items.map((i) => <ItemCard key={i.id} it={i} stops={trip.stops} labels={labels} />)}
      <hr className="dr-hr" />

      {deliver ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 13 }}>
            <button onClick={() => setUnattended(!unattended)} aria-pressed={unattended}
              style={{
                width: 42, height: 23, borderRadius: 12, border: "1px solid var(--line)", flex: "0 0 42px",
                background: unattended ? "var(--sea)" : "#CFD4D0", position: "relative", cursor: "pointer",
              }}>
              <span style={{ position: "absolute", top: 2, left: unattended ? 21 : 2, width: 17, height: 17, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
            </button>
            <span style={{ fontSize: 13, fontWeight: 700 }}>No one here to sign (drop trailer / after hours)</span>
          </div>

          <PhotoField label="Proof of delivery" value={pod} onChange={setPod} hint="Show the goods where you left them." />

          {unattended ? (
            <>
              <PhotoField label="Second photo — wider shot or seal" value={pod2} onChange={setPod2}
                hint="Enough to show the door, dock number or trailer seal." />
              <div className="dr-fld"><label>Where exactly did you leave it?</label>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Dock 4, roller door closed, seal 88213 applied" /></div>
              <p className="dr-note">
                No signature on this one. The BOL will say “Unattended delivery” and carry both photos.
              </p>
            </>
          ) : (
            <>
              <div className="dr-fld"><label>Received by (print name)</label>
                <input value={receiver} onChange={(e) => setReceiver(e.target.value)} placeholder="Name of person accepting" /></div>
              <SignaturePad value={sig} onChange={setSig} />
              <div className="dr-fld"><label>Damage or exceptions (optional)</label>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Leave blank if all clear" /></div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="dr-fld"><label>Reason</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">— pick one —</option>
              {(REASONS[outcome] || []).map((r) => <option key={r} value={r}>{r}</option>)}
            </select></div>
          <PhotoField label="Photo (recommended)" value={pod} onChange={setPod}
            hint="A closed gate, an empty dock, damaged goods — whatever proves it." />
          <div className="dr-fld"><label>What happened, in your words</label>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Arrived 16:10, shutters down, called twice, no answer" /></div>
          <p className="dr-note">Freight for this stop stays on your truck. Dispatch decides where it goes.</p>
        </>
      )}

      <Blocked reasons={blocks} />
      <button className="dr-btn" data-v={deliver ? "go" : "stop"} disabled={blocks.length > 0}
        onClick={() => onDone({
          status: outcome, pod, pod2: unattended ? pod2 : null,
          unattended: deliver && unattended,
          receiver: deliver && !unattended ? receiver.trim() : "",
          sig: deliver && !unattended ? sig : null,
          reason, notes: notes.trim(),
        })}>
        {deliver ? <><Check size={17} /> Confirm delivery</> : <><AlertTriangle size={17} /> Record exception</>}
      </button>
      <button className="dr-btn dr-btn-sm" data-v="ghost" style={{ width: "100%" }} onClick={onCancel}>
        <X size={14} /> Go back
      </button>
    </div>
  );
}

/* ================================================================== */
/* Main                                                               */
/* ================================================================== */

export default function DriverWorkspace() {
  const [st, setSt] = useState(null);
  const [delivering, setDelivering] = useState(null);
  const [pinging, setPinging] = useState(false);

  useEffect(() => { load().then(setSt); }, []);
  const put = useCallback((patch) => {
    setSt((prev) => { const next = { ...prev, ...patch }; save(next); return next; });
  }, []);

  if (!st) {
    return <div className="dr"><style>{CSS}</style><div className="dr-empty"><ClipboardList size={26} /><p>Loading your run…</p></div></div>;
  }

  const { trip, driver, vehicle, policy } = st;
  const stops = trip.stops || [];
  const L = labelsOf(stops);
  const workable = stops.filter((x) => x.status !== "moved");
  const current = stops.find(isOpen);
  const delivered = stops.filter((x) => isDrop(x) && x.status === "done").length;

  const setTrip = (p) => put({ trip: { ...trip, ...p } });
  const setDriver = (d) => put({ driver: d });
  const log = (what) => [...(trip.audit || []), { id: uid(), at: now(), who: driver.name, what }];
  const ping = (label, pos) => [...(trip.pings || []), { id: uid(), at: now(), label, pos }];

  /* freight physically on the truck */
  const picked = new Set(stops.filter((x) => isPickup(x) && x.status === "done").map((x) => x.id));
  const dropped = new Set(stops.filter((x) => isDrop(x) && x.status !== "wait").map((x) => x.id));
  const onboard = (trip.items || []).filter((i) => picked.has(i.fromStopId) && !dropped.has(i.stopId));
  const onboardWt = onboard.reduce((a, b) => a + num(b.weight), 0);

  const progress = (
    <div className="dr-prog">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <b className="dr-display" style={{ fontSize: 15 }}>
          {current ? titleOf(current, L) : "All stops done"}
        </b>
        <span className="dr-note dr-data" style={{ margin: 0, flex: 1 }}>
          {current ? `stop ${workable.indexOf(current) + 1} of ${workable.length}` : `${workable.length} stops`}
        </span>
      </div>
      <div className="dr-segs">
        {workable.map((x) => (
          <div key={x.id} className="dr-seg" data-k={x.kind}
            data-s={x.status === "done" ? "done"
              : (x.status === "attempted" || x.status === "refused") ? "exc"
                : current?.id === x.id && trip.status !== "assigned" ? "now" : ""} />
        ))}
      </div>
    </div>
  );

  const header = (
    <div className="dr-bar">
      <Truck size={20} color="#F2B705" />
      <h1 className="dr-display">{trip.tripNo}</h1>
      <span className="dr-tag" data-t="wait" style={{ marginLeft: "auto" }}>{driver.name.split(" ")[0]}</span>
    </div>
  );

  const shell = (body) => (
    <div className="dr">
      <style>{CSS}</style>
      {header}
      <div className="dr-wrap">{body}</div>
    </div>
  );

  const resetBtn = (
    <button className="dr-btn dr-btn-sm" data-v="ghost" style={{ width: "100%", marginTop: 14 }}
      onClick={() => { const f = seedState(); setSt(f); save(f); setDelivering(null); }}>
      <RotateCcw size={13} /> Reset demo
    </button>
  );

  /* ---------- 1. assigned ---------- */
  if (trip.status === "assigned") {
    const first = stops[0];
    const medical = trip && driver.medicalExpiry
      ? Math.round((new Date(driver.medicalExpiry + "T00:00:00") - new Date()) / 86400000) : null;

    return shell(
      <>
        {progress}
        {medical !== null && medical <= 30 && (
          <div className="dr-alert" data-tone="stop">
            <h4 className="dr-display"><AlertTriangle size={14} /> Paperwork check</h4>
            <p style={{ fontSize: 13.5, margin: 0 }}>
              Your medical certificate expires in {medical} days. Book the appointment.
            </p>
          </div>
        )}

        <div className="dr-card">
          <div className="dr-eyebrow">Assigned to you · {dmy(trip.date)}</div>
          <h3 className="dr-display" style={{ margin: "3px 0 0", fontSize: 22 }}>{trip.client}</h3>
          <p className="dr-note">
            {stops.filter(isPickup).length} pickups · {stops.filter(isDrop).length} drops
          </p>
          <hr className="dr-hr" />
          {stops.map((x) => (
            <div key={x.id} className="dr-stop" data-s="wait" style={{ opacity: 1 }}>
              <div className="dr-seq" style={{ background: isPickup(x) ? "var(--sea)" : "var(--ink)" }}>{L[x.id]}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 14 }}>{isPickup(x) ? "Collect from" : "Deliver to"} {x.name}</b>
                <p className="dr-note" style={{ margin: "2px 0 0" }}>{x.address}{x.window ? ` · ${x.window}` : ""}</p>
              </div>
            </div>
          ))}
          {trip.notes && (
            <>
              <hr className="dr-hr" />
              <div className="dr-eyebrow">From dispatch</div>
              <p style={{ fontSize: 14, margin: "4px 0 0" }}>{trip.notes}</p>
            </>
          )}
          <hr className="dr-hr" />
          <div className="dr-kv dr-data">
            <div><i>Your truck</i></div><div>{vehicle.unitNo} / {vehicle.trailerNo}</div>
            <div><i>Capacity</i></div><div>{vehicle.capacityLb.toLocaleString()} lb</div>
          </div>
          {policy.driverSeesPay && (
            <>
              <hr className="dr-hr" />
              <div style={{ background: "#EDF3EE", border: "1px solid var(--go)", borderRadius: 3, padding: 11 }}>
                <div className="dr-eyebrow" style={{ color: "var(--go)" }}>This run pays you about</div>
                <div className="dr-data" style={{ fontSize: 25, fontWeight: 700 }}>{usd(payOf(trip, driver))}</div>
                <p className="dr-note" style={{ margin: 0 }}>Final figure depends on how the day goes.</p>
              </div>
            </>
          )}
          <hr className="dr-hr" />
          <NavButton address={first?.address} label={`Navigate to ${titleOf(first, L)}`} driver={driver} onDriver={setDriver} pin={first?.pin} />
          <button className="dr-btn" data-v="go"
            onClick={() => setTrip({ status: "running", audit: log("Accepted trip") })}>
            <Check size={17} /> Accept this run
          </button>
        </div>
        {resetBtn}
      </>
    );
  }

  /* ---------- 5. closed ---------- */
  if (trip.status === "closed") {
    return shell(
      <>
        {progress}
        <div className="dr-card" style={{ borderLeft: "4px solid var(--go)" }}>
          <div className="dr-eyebrow">Locked</div>
          <h3 className="dr-display" style={{ margin: "3px 0 0", fontSize: 22 }}>{trip.tripNo} closed</h3>
          <p className="dr-note">{hhmm(trip.closedAt)} · {dmy(trip.closedAt)}</p>
          <hr className="dr-hr" />
          <div className="dr-kv dr-data">
            <div><i>Delivered</i></div><div>{delivered}</div>
            <div><i>Exceptions</i></div><div>{stops.filter((x) => x.status === "attempted" || x.status === "refused").length}</div>
            <div><i>Odometer</i></div><div>{trip.endOdometer ? `${num(trip.endOdometer).toLocaleString()} mi` : "—"}</div>
          </div>
          {policy.driverSeesPay && (
            <>
              <hr className="dr-hr" />
              <div style={{ background: "#EDF3EE", border: "1px solid var(--go)", borderRadius: 3, padding: 11 }}>
                <div className="dr-eyebrow" style={{ color: "var(--go)" }}>You earned</div>
                <div className="dr-data" style={{ fontSize: 25, fontWeight: 700 }}>{usd(payOf(trip, driver))}</div>
              </div>
            </>
          )}
          <p className="dr-note">Nothing more to do. Dispatch will bill it.</p>
        </div>
        {resetBtn}
      </>
    );
  }

  /* ---------- 4. ready to close ---------- */
  if (trip.status === "ready_to_close") {
    return shell(
      <>
        {progress}
        <div className="dr-card">
          <div className="dr-eyebrow">Every stop accounted for</div>
          <h3 className="dr-display" style={{ margin: "3px 0 0", fontSize: 22 }}>Run finished</h3>
          <hr className="dr-hr" />
          <div className="dr-kv dr-data">
            <div><i>Delivered</i></div><div>{delivered}</div>
            <div><i>Exceptions</i></div><div>{stops.filter((x) => x.status === "attempted" || x.status === "refused").length}</div>
            <div><i>Items carried</i></div><div>{(trip.items || []).length}</div>
          </div>
          {onboard.length > 0 && (
            <p className="dr-note" style={{ color: "var(--stop)", fontWeight: 700 }}>
              {onboard.length} item{onboard.length === 1 ? "" : "s"} still on your truck. Dispatch has been told.
            </p>
          )}
          <hr className="dr-hr" />
          <div className="dr-fld">
            <label>Odometer now (mi)</label>
            <input value={trip.endOdometer} inputMode="numeric"
              onChange={(e) => setTrip({ endOdometer: e.target.value })}
              placeholder={String(vehicle.odometer)} />
          </div>
          <p className="dr-note">Keeps the service schedule honest. Skip it if you'd rather.</p>
          <button className="dr-btn" data-v="go"
            onClick={() => setTrip({
              status: "closed", closedAt: now(),
              audit: log(`Closed out${trip.endOdometer ? ` at ${num(trip.endOdometer).toLocaleString()} mi` : ""}`),
            })}>
            <Lock size={17} /> Close out run
          </button>
        </div>
        {resetBtn}
      </>
    );
  }

  /* ---------- delivering ---------- */
  if (delivering) {
    const stop = stops.find((x) => x.id === delivering);
    return shell(
      <>
        {progress}
        <DeliverForm trip={trip} stop={stop} labels={L} onCancel={() => setDelivering(null)}
          onDone={(p) => {
            const ns = stops.map((x) => (x.id === stop.id ? { ...x, ...p, deliveredAt: now() } : x));
            const noneOpen = ns.filter((x) => x.status !== "moved").every((x) => !isOpen(x));
            const word = p.status === "done" ? (p.unattended ? "Delivered unattended" : "Delivered")
              : `${OUT[p.status].label}: ${p.reason}`;
            setTrip({
              stops: ns,
              audit: log(`${titleOf(stop, L)} (${stop.name}) — ${word}`),
              ...(noneOpen ? { status: "ready_to_close" } : {}),
            });
            setDelivering(null);
          }} />
      </>
    );
  }

  /* ---------- at a pickup: loading ---------- */
  if (current && isPickup(current) && current.arrivedAt) {
    const drops = stops.filter(isDrop).filter(isOpen);
    const mine = (trip.items || []).filter((i) => i.fromStopId === current.id);
    const cap = num(vehicle.capacityLb);
    const warn = [];
    if (!current.paperPhoto) warn.push("No photo of the paperwork they gave you.");
    if (mine.length === 0) warn.push("Nothing added from this pickup yet.");
    if (cap && onboardWt > cap) warn.push(`Over capacity: ${onboardWt.toLocaleString()} lb on a ${cap.toLocaleString()} lb unit.`);
    drops.filter((x) => !(trip.items || []).some((i) => i.stopId === x.id))
      .forEach((x) => warn.push(`Load ${L[x.id]} (${x.name}) has nothing assigned yet.`));

    return shell(
      <>
        {progress}
        <div className="dr-card">
          <div className="dr-eyebrow">{titleOf(current, L)} · loading</div>
          <h3 className="dr-display" style={{ margin: "3px 0 0", fontSize: 20 }}>{current.name}</h3>
          <p className="dr-note">
            {current.address}{current.ref ? ` · ref ${current.ref}` : ""} · Unit {vehicle.unitNo}
          </p>
          {cap > 0 && (
            <>
              <div className="dr-cap">
                <div style={{
                  width: `${Math.min(100, onboardWt / cap * 100)}%`,
                  background: onboardWt > cap ? "var(--stop)" : onboardWt > cap * 0.9 ? "var(--hiviz)" : "var(--go)",
                }} />
              </div>
              <p className="dr-note dr-data" style={{ margin: 0 }}>
                {onboardWt.toLocaleString()} of {cap.toLocaleString()} lb on board
              </p>
            </>
          )}
          <hr className="dr-hr" />
          <PhotoField label="The document they gave you here" value={current.paperPhoto}
            onChange={(v) => setTrip({ stops: stops.map((x) => (x.id === current.id ? { ...x, paperPhoto: v } : x)) })}
            hint="Each pickup has its own paperwork. Get the whole sheet." />
        </div>

        <div className="dr-card">
          <div className="dr-eyebrow">Loaded here</div>
          <h3 className="dr-display" style={{ margin: "3px 0 0", fontSize: 19 }}>
            {mine.length} item{mine.length === 1 ? "" : "s"} · {mine.reduce((a, b) => a + num(b.weight), 0).toLocaleString()} lb
          </h3>
          <hr className="dr-hr" />
          {mine.length === 0 ? <p className="dr-note">Nothing added yet.</p>
            : mine.map((i) => (
              <ItemCard key={i.id} it={i} stops={stops} labels={L}
                onRemove={() => setTrip({ items: trip.items.filter((x) => x.id !== i.id) })} />
            ))}
        </div>

        <ItemForm drops={drops} labels={L}
          onAdd={(it) => setTrip({ items: [...(trip.items || []), { ...it, fromStopId: current.id }] })} />

        <Blocked reasons={warn} soft />
        <button className="dr-btn" data-v="go"
          onClick={async () => {
            const pos = await grabPosition();
            const ns = stops.map((x) => (x.id === current.id ? { ...x, status: "done", departedAt: now() } : x));
            const noneOpen = ns.filter((x) => x.status !== "moved").every((x) => !isOpen(x));
            setTrip({
              stops: ns,
              pings: ping(`Left ${current.name}, loaded`, pos),
              audit: log(`${titleOf(current, L)} (${current.name}) — collected ${mine.length} item(s)`),
              ...(noneOpen ? { status: "ready_to_close" } : {}),
            });
          }}>
          <Truck size={17} /> Loaded here — move on
        </button>
      </>
    );
  }

  /* ---------- the route ---------- */
  const rc = trip.routeChange;
  return shell(
    <>
      {progress}

      {rc && !rc.ack && (
        <div className="dr-alert">
          <h4 className="dr-display"><AlertTriangle size={14} /> Dispatch changed your route</h4>
          <p style={{ fontSize: 13.5, margin: "0 0 4px" }}>{rc.note}</p>
          <p className="dr-note" style={{ margin: "0 0 10px" }}>Sent {hhmm(rc.at)}</p>
          <button className="dr-btn dr-btn-sm" data-v="go"
            onClick={() => setTrip({ routeChange: { ...rc, ack: now() }, audit: log("Acknowledged route change") })}>
            <Check size={14} /> Got it
          </button>
        </div>
      )}

      {onboard.length > 0 && (
        <div className="dr-card" style={{ borderLeft: "4px solid var(--sea)" }}>
          <div className="dr-eyebrow"><Package size={11} /> On your truck right now</div>
          <h3 className="dr-display" style={{ margin: "3px 0 0", fontSize: 18 }}>
            {onboard.length} item{onboard.length === 1 ? "" : "s"} · {onboardWt.toLocaleString()} lb
          </h3>
          <hr className="dr-hr" />
          {onboard.map((i) => {
            const to = stops.find((x) => x.id === i.stopId);
            return (
              <div key={i.id} className="dr-data" style={{ fontSize: 12.5, padding: "4px 0", borderBottom: "1px dashed var(--line)" }}>
                {i.description || "Unlabelled"} → {to ? `Load ${L[to.id]} · ${to.name}` : "unassigned"}
              </div>
            );
          })}
        </div>
      )}

      <div className="dr-card">
        <div className="dr-eyebrow">{trip.client}</div>
        <h3 className="dr-display" style={{ margin: "3px 0 0", fontSize: 19 }}>
          {delivered} delivered · {workable.filter(isOpen).length} left
        </h3>
        <hr className="dr-hr" />
        {workable.map((x) => {
          const state = x.status === "done" ? "done"
            : (x.status === "attempted" || x.status === "refused") ? "exc"
              : current?.id === x.id ? "now" : "wait";
          const cnt = isPickup(x)
            ? (trip.items || []).filter((i) => i.fromStopId === x.id).length
            : (trip.items || []).filter((i) => i.stopId === x.id).length;
          return (
            <div key={x.id} className="dr-stop" data-s={state}>
              <div className="dr-seq" style={{
                background: state === "done" ? "var(--go)" : state === "exc" ? "var(--stop)"
                  : state === "now" ? "var(--hiviz)" : isPickup(x) ? "var(--sea)" : "var(--ink)",
                color: state === "now" ? "var(--ink)" : "#fff",
              }}>
                {state === "done" ? "✓" : state === "exc" ? "!" : L[x.id]}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 14.5 }}>{isPickup(x) ? "Collect from" : "Deliver to"} {x.name}</b>
                <p className="dr-note" style={{ margin: "2px 0 6px" }}>{x.address}{x.window ? ` · ${x.window}` : ""}</p>
                <span className="dr-tag" data-t={state === "wait" ? "wait" : state}>
                  {state === "done" ? (isPickup(x) ? `Collected ${hhmm(x.departedAt)}`
                    : x.unattended ? `Left unattended ${hhmm(x.deliveredAt)}` : `Signed ${hhmm(x.deliveredAt)}`)
                    : state === "exc" ? `${OUT[x.status]?.label}${x.reason ? ` · ${x.reason}` : ""}`
                      : state === "now" ? "You're here next" : "Waiting"}
                </span>{" "}
                <span className="dr-note dr-data">{cnt} item{cnt === 1 ? "" : "s"}</span>

                {state === "now" && (
                  <div style={{ marginTop: 10 }}>
                    <NavButton address={x.address} label={`Navigate to ${titleOf(x, L)}`} driver={driver} onDriver={setDriver} pin={x.pin} />
                    <button className="dr-btn" data-v="hiviz"
                      onClick={async () => {
                        const pos = await grabPosition();
                        setTrip({
                          stops: stops.map((y) => (y.id === x.id ? { ...y, arrivedAt: now() } : y)),
                          pings: ping(`Arrived at ${x.name}`, pos),
                        });
                        if (isDrop(x)) setDelivering(x.id);
                      }}>
                      <MapPin size={17} /> Arrived at {titleOf(x, L)}
                    </button>
                    {isDrop(x) && (
                      <button className="dr-btn dr-btn-sm" data-v="ghost" style={{ width: "100%" }}
                        onClick={() => setDelivering(x.id)}>
                        <AlertTriangle size={14} /> Can't deliver here
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button className="dr-btn dr-btn-sm" data-v="ghost" style={{ width: "100%" }} disabled={pinging}
        onClick={async () => {
          setPinging(true);
          const pos = await grabPosition();
          setTrip({ pings: ping("Check-in", pos) });
          setPinging(false);
        }}>
        {pinging ? <Loader2 size={14} /> : <MapPin size={14} />} {pinging ? "Getting position…" : "Check in with dispatch"}
      </button>

      <p className="dr-note" style={{ textAlign: "center", marginTop: 10 }}>
        <Lock size={12} style={{ verticalAlign: "-2px" }} /> Stops are worked in order — pickups before their drops.
      </p>
      {resetBtn}
    </>
  );
}
