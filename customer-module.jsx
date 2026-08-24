import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Truck, Package, FileText, Printer, Plus, Check, X, Search,
  AlertTriangle, Menu, ClipboardList, Receipt, Camera, RotateCcw,
  MessageSquare, ChevronRight,
} from "lucide-react";

/* ==================================================================
   Truck Loading — CUSTOMER portal
   What the client company sees. Own sample data and storage key.
   They see their own shipments only: no rates paid to drivers,
   no margin, no other clients.
   ================================================================== */

const KEY = "tl-customer-demo:v1";
const DAY = 86400000;
const MIN = 60000;

const uid = () => Math.random().toString(36).slice(2, 9);
const now = () => new Date().toISOString();
const num = (x) => Number(x) || 0;
const usd = (n) => "$" + num(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");
const dmy = (iso) => (iso ? new Date(iso).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }) : "—");
const ago = (min) => new Date(Date.now() - min * MIN).toISOString();
const inDays = (d) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);

const isPickup = (st) => st.kind === "pickup";
const isDrop = (st) => (st.kind || "drop") === "drop";

const SIG = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="52"><path d="M8 38 C22 10, 34 46, 46 24 S72 8, 84 32 S106 44, 120 20 S150 12, 168 34" fill="none" stroke="#16202B" stroke-width="2.2" stroke-linecap="round"/></svg>`
);

const STATUS = {
  requested: { label: "Requested", tone: "wait", blurb: "Waiting for the carrier to confirm" },
  booked: { label: "Booked", tone: "wait", blurb: "Confirmed and scheduled" },
  running: { label: "In transit", tone: "now", blurb: "On the road" },
  delivered: { label: "Delivered", tone: "done", blurb: "All stops complete" },
  exception: { label: "Needs attention", tone: "exc", blurb: "One or more stops could not be delivered" },
};

function shipStatus(s) {
  if (s.status === "requested" || s.status === "booked") return s.status;
  const drops = (s.stops || []).filter(isDrop);
  if (drops.some((x) => x.status === "refused" || x.status === "attempted")) return "exception";
  if (drops.every((x) => x.status === "done")) return "delivered";
  return "running";
}

/* ---------------- sample data ---------------- */

function seedState() {
  const s = (kind, name, address, extra = {}) => ({
    id: uid(), kind, name, address, window: "", ref: "",
    status: "wait", arrivedAt: null, departedAt: null, deliveredAt: null, ...extra,
  });
  const it = (d, q, w, sn, po, from, to) => ({
    id: uid(), description: d, qty: q, weight: w, serialNo: sn, poNumber: po, fromStopId: from, stopId: to,
  });

  /* live shipment */
  const a = [
    s("pickup", "Meridian Warehouse 3", "8200 Wallisville Rd, Houston, TX 77029",
      { ref: "ACP03013P", status: "done", arrivedAt: ago(330), departedAt: ago(140) }),
    s("pickup", "Meridian Yard 7", "12000 Bay Area Blvd, Pasadena, TX 77507",
      { ref: "ACP03014P", status: "done", arrivedAt: ago(120), departedAt: ago(75) }),
    s("drop", "Katy Distribution", "1500 Katy Fwy, Katy, TX 77094",
      { ref: "PO-4471", window: "12:00–15:00", status: "done", arrivedAt: ago(55), deliveredAt: ago(20), receiver: "R. Dhillon", sig: SIG }),
    s("drop", "Sugar Land Depot", "50 Industrial Blvd, Sugar Land, TX 77478", { ref: "PO-4488", window: "13:00–16:00" }),
    s("drop", "Baytown Terminal", "4500 Decker Dr, Baytown, TX 77520", { ref: "PO-4490" }),
  ];
  const shipA = {
    id: uid(), ref: "TL-1042", status: "running", date: new Date().toISOString().slice(0, 10),
    carrier: "NQ Visiorence LLC", driverName: "Harjit Singh", unitNo: "T-104", trailerNo: "TR-2290",
    stops: a,
    items: [
      it("Steel racking, palletised", "12", "1450", "SN-88213", "PO-4471", a[0].id, a[2].id),
      it("Anchor bolt cartons", "6", "310", "SN-88214", "PO-4471", a[0].id, a[2].id),
      it("Conveyor rollers, crated", "4", "880", "SN-90455", "PO-4488", a[0].id, a[3].id),
      it("Motor assembly", "1", "540", "SN-90456", "PO-4488", a[1].id, a[3].id),
      it("Spare drive belts", "2", "140", "SN-90512", "PO-4490", a[1].id, a[4].id),
    ],
    updates: [
      { id: uid(), at: ago(330), text: "Driver arrived at Meridian Warehouse 3" },
      { id: uid(), at: ago(140), text: "Loaded and departed Meridian Warehouse 3" },
      { id: uid(), at: ago(75), text: "Loaded and departed Meridian Yard 7" },
      { id: uid(), at: ago(20), text: "Delivered to Katy Distribution, signed by R. Dhillon" },
    ],
    claims: [],
  };

  /* one with a refusal */
  const b = [
    s("pickup", "Meridian Warehouse 3", "8200 Wallisville Rd, Houston, TX 77029",
      { ref: "ACP02990P", status: "done", arrivedAt: ago(1500), departedAt: ago(1400) }),
    s("drop", "Conroe Fabrication", "1200 N Loop 336 W, Conroe, TX 77304",
      { ref: "PO-5510", status: "done", arrivedAt: ago(1300), deliveredAt: ago(1260), receiver: "T. Novak", sig: SIG }),
    s("drop", "Beaumont Depot", "2100 S 11th St, Beaumont, TX 77701",
      { ref: "PO-5511", status: "refused", arrivedAt: ago(1200), deliveredAt: ago(1170),
        reason: "Damage found on arrival", notes: "Two coils dented on the outer wrap. Consignee refused both." }),
  ];
  const shipB = {
    id: uid(), ref: "TL-1041", status: "closed", date: new Date(Date.now() - DAY).toISOString().slice(0, 10),
    carrier: "NQ Visiorence LLC", driverName: "Ana Ruiz", unitNo: "T-111", trailerNo: "FB-880",
    stops: b,
    items: [
      it("Steel coil, banded", "2", "4400", "NS-1120", "PO-5510", b[0].id, b[1].id),
      it("Steel coil, banded", "2", "4400", "NS-1121", "PO-5511", b[0].id, b[2].id),
    ],
    updates: [
      { id: uid(), at: ago(1260), text: "Delivered to Conroe Fabrication, signed by T. Novak" },
      { id: uid(), at: ago(1170), text: "Beaumont Depot refused delivery — damage found on arrival" },
    ],
    claims: [],
  };

  /* completed and invoiced */
  const c = [
    s("pickup", "Meridian Warehouse 3", "8200 Wallisville Rd, Houston, TX 77029", { ref: "ACP02880P", status: "done", arrivedAt: ago(4400), departedAt: ago(4300) }),
    s("drop", "Katy Distribution", "1500 Katy Fwy, Katy, TX 77094", { ref: "PO-3013", status: "done", arrivedAt: ago(4200), deliveredAt: ago(4150), receiver: "J. Alvarez", sig: SIG }),
    s("drop", "Sugar Land Depot", "50 Industrial Blvd, Sugar Land, TX 77478", { ref: "PO-3014", status: "done", arrivedAt: ago(4100), deliveredAt: ago(4060), receiver: "K. Osei", sig: SIG }),
  ];
  const shipC = {
    id: uid(), ref: "TL-1039", status: "closed", date: new Date(Date.now() - 3 * DAY).toISOString().slice(0, 10),
    carrier: "NQ Visiorence LLC", driverName: "Marcus Bell", unitNo: "T-107", trailerNo: "",
    stops: c,
    items: [
      it("Tool inspection crates", "8", "960", "ACP-2201", "PO-3013", c[0].id, c[1].id),
      it("Safety joints", "1", "120", "ACP-2202", "PO-3014", c[0].id, c[2].id),
    ],
    updates: [{ id: uid(), at: ago(4060), text: "All stops delivered" }],
    claims: [],
  };

  const invoices = [
    {
      id: uid(), no: "1044", date: inDays(-2), due: inDays(13), status: "open",
      shipmentRefs: ["TL-1039", "TL-1041"],
      lines: [
        { d: "Truck Loading — weekly haul", sub: "TL-1039, TL-1041 · 2 pickups, 5 drops", qty: 2, rate: 660, amt: 1320 },
        { d: "Extra stop charge", sub: "Beyond 2 stops per trip", qty: 3, rate: 75, amt: 225 },
        { d: "Detention", sub: "Katy Distribution · 70 min beyond free time", qty: 1.25, rate: 60, amt: 75 },
        { d: "Failed delivery attempt", sub: "Beaumont Depot — refused, damage found on arrival", qty: 1, rate: 100, amt: 100 },
        { d: "Fuel surcharge", sub: "18% of linehaul", qty: 1, rate: 278.10, amt: 278.10 },
      ],
    },
    {
      id: uid(), no: "1038", date: inDays(-24), due: inDays(-9), status: "paid",
      shipmentRefs: ["TL-1030", "TL-1031", "TL-1032"],
      lines: [
        { d: "Truck Loading — weekly haul", sub: "3 trips", qty: 3, rate: 650, amt: 1950 },
        { d: "Fuel surcharge", sub: "18% of linehaul", qty: 1, rate: 351, amt: 351 },
      ],
    },
  ];

  return {
    company: {
      name: "Meridian Freight Co.", contact: "S. Whitfield",
      email: "dispatch@meridian.example", phone: "+1 713 555 0110",
      address: "8200 Wallisville Rd, Houston, TX 77029",
      carrierPhone: "+1 602 621 0535", carrierEmail: "nqvisiorencellc@gmail.com",
    },
    shipments: [shipA, shipB, shipC],
    invoices,
  };
}

async function load() {
  try {
    const r = await window.storage.get(KEY);
    if (!r) return seedState();
    const p = JSON.parse(r.value);
    const b = seedState();
    return { company: p.company || b.company, shipments: p.shipments || b.shipments, invoices: p.invoices || b.invoices };
  } catch { return seedState(); }
}
async function save(st) {
  try { await window.storage.set(KEY, JSON.stringify(st)); }
  catch (e) { console.error("save failed", e); }
}

function shrink(file, max = 560) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error("read"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error("decode"));
      img.onload = () => {
        const sc = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL("image/jpeg", 0.55));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/* ================================================================== */

const CSS = `
:root{
  --ink:#16202B; --ink2:#2A3A4B; --mute:#6B7A88;
  --dock:#DFE1DE; --card:#F8F9F7; --line:#C3C7C2;
  --hiviz:#F2B705; --sea:#2B5F8A; --go:#2E7D53; --stop:#B3392F;
}
*{box-sizing:border-box}
.cw{ background:var(--dock); color:var(--ink); min-height:100vh;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif; font-size:15px; line-height:1.45 }
.cw-display{ font-family:"Arial Narrow","Roboto Condensed",system-ui,sans-serif;
  text-transform:uppercase; letter-spacing:.06em; font-weight:800; line-height:1.05 }
.cw-data{ font-family:ui-monospace,"SF Mono",Menlo,monospace; font-variant-numeric:tabular-nums }
.cw-eyebrow{ font-size:10px; letter-spacing:.18em; text-transform:uppercase; color:var(--mute); font-weight:700 }
.cw-note{ font-size:12px; color:var(--mute); margin:6px 0 0 }

.cw-shell{ display:flex; min-height:100vh }
.cw-nav{ display:none }
.cw-main{ flex:1; min-width:0; max-width:800px; margin:0 auto; padding:14px; padding-bottom:44px }
.cw-bar{ background:var(--ink); color:#fff; padding:12px 14px; display:flex; align-items:center; gap:10px; position:sticky; top:0; z-index:20 }
.cw-bar h1{ margin:0; font-size:17px }
.cw-burger{ background:none; border:0; color:#fff; cursor:pointer; display:flex; padding:2px }
.cw-item{ display:flex; align-items:center; gap:10px; width:100%; padding:11px 13px; border:0; border-radius:3px;
  background:none; color:#C6D2DC; font-size:13.5px; font-weight:700; cursor:pointer; text-align:left; margin-bottom:2px }
.cw-item[data-on="1"]{ background:var(--hiviz); color:var(--ink) }
.cw-item:hover{ background:rgba(255,255,255,.07) }
.cw-item[data-on="1"]:hover{ background:var(--hiviz) }
.cw-cta{ background:var(--go); color:#fff; margin-bottom:10px }
.cw-navhead{ font-size:10px; letter-spacing:.16em; text-transform:uppercase; color:#7E93A5; font-weight:800; padding:14px 13px 5px }
.cw-scrim{ position:fixed; inset:0; background:rgba(10,16,22,.55); z-index:40 }
.cw-drawer{ position:fixed; top:0; left:0; bottom:0; width:244px; background:var(--ink); z-index:41; padding:12px; overflow:auto }
@media (min-width:760px){
  .cw-nav{ display:block; width:226px; flex:0 0 226px; background:var(--ink); padding:12px; position:sticky; top:0; height:100vh; overflow:auto }
  .cw-burger{ display:none }
  .cw-main{ padding:20px 24px }
}

.cw-card{ background:var(--card); border:1px solid var(--line); border-radius:3px; padding:14px; margin-bottom:12px }
.cw-card h3{ margin:0 0 3px; font-size:16px }
.cw-hr{ border:0; border-top:1px dashed var(--line); margin:12px 0 }

.cw-btn{ display:flex; align-items:center; justify-content:center; gap:8px; width:100%; padding:13px; border:0; border-radius:3px;
  background:var(--ink); color:#fff; font-size:13.5px; font-weight:800; letter-spacing:.07em; text-transform:uppercase;
  cursor:pointer; font-family:"Arial Narrow","Roboto Condensed",system-ui,sans-serif; margin-bottom:10px; text-decoration:none }
.cw-btn[data-v="go"]{ background:var(--go) } .cw-btn[data-v="hiviz"]{ background:var(--hiviz); color:var(--ink) }
.cw-btn[data-v="ghost"]{ background:none; color:var(--ink); border:1px solid var(--line) }
.cw-btn:disabled{ background:#AEB6BD; cursor:not-allowed }
.cw-btn-sm{ width:auto; padding:8px 12px; font-size:11.5px; margin-bottom:0 }
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{ outline:3px solid var(--sea); outline-offset:2px }

.cw-fld{ margin-bottom:10px }
.cw-fld label{ display:block; font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--mute); font-weight:700; margin-bottom:4px }
.cw-fld input,.cw-fld select,.cw-fld textarea{ width:100%; padding:10px; border:1px solid var(--line); border-radius:2px; background:#fff;
  font-size:15px; font-family:ui-monospace,Menlo,monospace; color:var(--ink) }
.cw-row{ display:flex; gap:8px } .cw-row>*{ flex:1 }

.cw-tag{ display:inline-block; padding:2px 7px; border-radius:2px; font-size:10px; font-weight:800; letter-spacing:.09em; text-transform:uppercase }
.cw-tag[data-t="done"]{ background:#DCEEE3; color:var(--go) }
.cw-tag[data-t="now"]{ background:#FFF0C2; color:#6B5200 }
.cw-tag[data-t="wait"]{ background:#E4E7E4; color:var(--mute) }
.cw-tag[data-t="exc"]{ background:#F8E3E1; color:var(--stop) }

.cw-kv{ display:grid; grid-template-columns:1fr auto; gap:3px 10px; font-size:13px }
.cw-kv i{ font-style:normal; color:var(--mute) }

.cw-row2{ display:flex; gap:8px; align-items:baseline; padding:6px 0; border-bottom:1px dashed var(--line) }
.cw-shiprow{ display:flex; gap:11px; align-items:flex-start; width:100%; text-align:left; cursor:pointer;
  background:var(--card); border:1px solid var(--line); border-radius:3px; padding:12px; margin-bottom:8px }
.cw-shiprow:hover{ border-color:var(--sea) }
.cw-seq{ width:30px;height:30px;flex:0 0 30px;border-radius:50%;background:var(--ink);color:#fff;
  display:grid;place-items:center;font-family:ui-monospace,monospace;font-size:13px;font-weight:700 }
.cw-mini{ display:flex; gap:2px; height:5px; margin-top:7px }
.cw-mini div{ flex:1; border-radius:1px; background:#D2D6D2 }

/* delivery timeline */
.cw-tl{ position:relative; padding-left:26px }
.cw-tl::before{ content:""; position:absolute; left:9px; top:6px; bottom:6px; width:2px; background:var(--line) }
.cw-tlrow{ position:relative; padding:7px 0 }
.cw-tlrow::before{ content:""; position:absolute; left:-22px; top:12px; width:11px; height:11px; border-radius:50%;
  background:#fff; border:2px solid var(--line) }
.cw-tlrow[data-s="done"]::before{ background:var(--go); border-color:var(--go) }
.cw-tlrow[data-s="exc"]::before{ background:var(--stop); border-color:var(--stop) }
.cw-tlrow[data-s="now"]::before{ background:var(--hiviz); border-color:var(--ink) }

.cw-alert{ border:2px solid var(--stop); background:#FDF1F0; border-radius:3px; padding:12px; margin-bottom:12px }
.cw-alert h4{ margin:0 0 4px; font-size:14px }
.cw-empty{ text-align:center; padding:26px 14px; color:var(--mute) }
.cw-thumb{ width:100%; max-height:180px; object-fit:cover; border:1px solid var(--line); border-radius:2px; display:block }

.cw-doc{ background:#fff; border:1px solid var(--ink); padding:16px; font-family:ui-monospace,Menlo,monospace; font-size:11px; color:#000 }
.cw-doc h2{ font-size:15px; margin:0; letter-spacing:.1em }
.cw-doc table{ width:100%; border-collapse:collapse; margin:8px 0; font-size:10px }
.cw-doc th,.cw-doc td{ border:1px solid #999; padding:4px; text-align:left }
.cw-doc th{ background:#EEE }
.cw-dochd{ display:flex; justify-content:space-between; border-bottom:2px solid #000; padding-bottom:6px; margin-bottom:8px }

@media print{
  body *{ visibility:hidden !important }
  .cw-print,.cw-print *{ visibility:visible !important }
  .cw-print{ position:absolute; left:0; top:0; width:100% }
  .cw-noprint{ display:none !important }
}
`;

/* ================================================================== */
/* Pieces                                                             */
/* ================================================================== */
/* ==================================================================
   US ADDRESS AUTOFILL — shared block
   Inserted into each standalone module (they can't import each other).
   ================================================================== */

const US_STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"],
  ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"],
  ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
  ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"],
  ["PA", "Pennsylvania"], ["PR", "Puerto Rico"], ["RI", "Rhode Island"], ["SC", "South Carolina"],
  ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"],
  ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];
const STATE_SET = new Set(US_STATES.map(([a]) => a));
const STATE_BY_NAME = Object.fromEntries(US_STATES.map(([a, n]) => [n.toLowerCase(), a]));

/* Canada and other non-US input is rejected — this build is US-only. */
const CA_PROV = new Set(["ON","QC","BC","AB","MB","SK","NS","NB","NL","PE","YT","NT","NU"]);
const CA_POSTAL = /\b[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d\b/;

function nonUS(text) {
  const t = (text || "").trim();
  if (!t) return null;
  if (CA_POSTAL.test(t)) return "That looks like a Canadian postal code. This system handles US addresses only.";
  const m = t.match(/[,\s]+([A-Za-z]{2})\s*(?:[A-Za-z]\d[A-Za-z].*)?$/);
  if (m && CA_PROV.has(m[1].toUpperCase()) && !STATE_SET.has(m[1].toUpperCase())) {
    return `"${m[1].toUpperCase()}" is a Canadian province. US addresses only.`;
  }
  if (/\b(canada|ontario|quebec|british columbia|alberta|manitoba|saskatchewan|nova scotia)\b/i.test(t)) {
    return "This system handles US addresses only.";
  }
  return null;
}


/* USPS-style abbreviations — what freight offices actually type */
const SUFFIX = {
  street: "St", st: "St", avenue: "Ave", ave: "Ave", road: "Rd", rd: "Rd",
  boulevard: "Blvd", blvd: "Blvd", drive: "Dr", dr: "Dr", lane: "Ln", ln: "Ln",
  parkway: "Pkwy", pkwy: "Pkwy", highway: "Hwy", hwy: "Hwy", court: "Ct", ct: "Ct",
  circle: "Cir", place: "Pl", terrace: "Ter", trail: "Trl", freeway: "Fwy", fwy: "Fwy",
  expressway: "Expy", suite: "Ste", ste: "Ste", apartment: "Apt", building: "Bldg",
  north: "N", south: "S", east: "E", west: "W",
  northeast: "NE", northwest: "NW", southeast: "SE", southwest: "SW",
};

function tidyLine(line) {
  return line.split(/\s+/).map((w) => {
    const bare = w.replace(/[.,]/g, "").toLowerCase();
    if (SUFFIX[bare]) return SUFFIX[bare];
    if (/^\d+$/.test(w)) return w;
    if (/^[A-Z]{2,}$/.test(w) && w.length <= 4) return w;      // I-45, US, NW
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ").trim();
}

/* pull street / city / state / zip out of whatever they typed or pasted */
function parseUS(text) {
  const raw = (text || "").replace(/\s+/g, " ").trim();
  if (!raw) return { line1: "", city: "", state: "", zip: "" };

  let rest = raw, zip = "";
  const z = rest.match(/\b(\d{5})(?:-(\d{4}))?\b\s*(?:USA|US|United States)?\s*$/i);
  if (z) { zip = z[2] ? `${z[1]}-${z[2]}` : z[1]; rest = rest.slice(0, z.index).trim(); }
  rest = rest.replace(/,?\s*(USA|United States)\s*$/i, "").trim();

  let state = "";
  const st = rest.match(/[,\s]+([A-Za-z]{2})\s*$/);
  if (st && STATE_SET.has(st[1].toUpperCase())) {
    state = st[1].toUpperCase();
    rest = rest.slice(0, st.index).trim();
  } else {
    for (const [name, ab] of Object.entries(STATE_BY_NAME)) {
      const re = new RegExp(`[,\\s]+${name}\\s*$`, "i");
      if (re.test(rest)) { state = ab; rest = rest.replace(re, "").trim(); break; }
    }
  }

  const parts = rest.split(",").map((p) => p.trim()).filter(Boolean);
  let city = "", line1 = rest;
  if (parts.length >= 2) { city = parts[parts.length - 1]; line1 = parts.slice(0, -1).join(", "); }

  return {
    line1: tidyLine(line1.replace(/,$/, "")),
    city: city ? tidyLine(city) : "",
    state, zip,
  };
}

function joinUS(p) {
  const tail = [p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [p.line1, tail].filter(Boolean).join(", ");
}

function addressIssues(p) {
  const out = [];
  if (!p.line1) out.push("No street address.");
  if (!p.city) out.push("No city.");
  if (!p.state) out.push("No state.");
  else if (!STATE_SET.has(p.state)) out.push(`"${p.state}" isn't a US state code.`);
  if (p.zip && !/^\d{5}(-\d{4})?$/.test(p.zip)) out.push("ZIP should be 5 digits, or ZIP+4.");
  return out;
}

/* Ask the model, with web search, for real matching US addresses. */
async function lookupUS(query) {
  const prompt = `A freight dispatcher typed this partial US address or business name:

"${query}"

Search the web and return up to 4 real, currently valid street addresses that match.
CRITICAL: only addresses inside the United States. Never return Canadian, Mexican or other
non-US addresses — return [] instead.
Prefer commercial, industrial and warehouse addresses — this is for truck deliveries.

Reply with ONLY a JSON array, no markdown fences, no preamble:
[{"label":"<business or site name, or empty>","line1":"<street>","city":"<city>","state":"<2-letter>","zip":"<5 digit>"}]

If nothing credible matches, return [].`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });
  const data = await r.json();
  const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  const arr = JSON.parse(m[0]);
  return Array.isArray(arr) ? arr.filter((a) => a.line1 && a.state) : [];
}

function AddressField({ label, value, onChange, placeholder }) {
  const [text, setText] = useState(value || "");
  const [sugs, setSugs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [touched, setTouched] = useState(false);
  const timer = useRef(null);
  const seq = useRef(0);
  const lastQ = useRef("");
  const focused = useRef(false);

  useEffect(() => { setText(value || ""); }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const parts = parseUS(text);
  const foreign = nonUS(text);
  const issues = foreign ? [foreign] : (touched && text.trim() ? addressIssues(parts) : []);

  const run = async (q) => {
    const mine = ++seq.current;
    setBusy(true); setErr(null);
    try {
      const out = await lookupUS(q);
      if (mine === seq.current) setSugs(out);
    } catch {
      if (mine === seq.current) { setSugs([]); setErr("Couldn't reach address lookup. Type it in full."); }
    }
    if (mine === seq.current) setBusy(false);
  };

  const onType = (v) => {
    setText(v); onChange(v); setTouched(true);
    clearTimeout(timer.current);
    if (nonUS(v)) { setSugs([]); return; }
    const q = v.trim();
    if (q.length < 6) { setSugs([]); return; }
    /* already looked this up, or it's the address we just filled in */
    if (q === lastQ.current) return;
    timer.current = setTimeout(() => {
      if (!focused.current) return;          // they moved on — don't search
      lastQ.current = q;
      run(q);
    }, 900);
  };

  const take = (a) => {
    const full = joinUS({ line1: a.line1, city: a.city, state: a.state, zip: a.zip });
    clearTimeout(timer.current);             // kill the pending search
    seq.current++;                           // ignore any reply still in flight
    lastQ.current = full;                    // and never re-search what we just filled
    setText(full); onChange(full); setSugs([]); setBusy(false); setTouched(true);
  };

  const dismiss = () => {
    clearTimeout(timer.current);
    seq.current++;
    lastQ.current = text.trim();
    setSugs([]); setBusy(false);
  };

  return (
    <div className={"cw-fld"}>
      <label>{label}</label>
      <div style={{ position: "relative" }}>
        <input value={text} onChange={(e) => onType(e.target.value)}
          onFocus={() => { focused.current = true; }}
          onBlur={() => { focused.current = false; setTouched(true); }}
          onKeyDown={(e) => { if (e.key === "Escape") dismiss(); }}
          placeholder={placeholder || "US street or business name"} />
        {busy && (
          <span style={{ position: "absolute", right: 9, top: 11, color: "var(--mute)", fontSize: 11 }}>
            searching…
          </span>
        )}
      </div>

      {sugs.length > 0 && (
        <div style={{ border: "1px solid var(--line)", borderTop: 0, background: "#fff", borderRadius: "0 0 3px 3px" }}>
          {sugs.map((a, i) => (
            <button key={i} onClick={() => take(a)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "9px 10px",
                background: "none", border: 0, borderBottom: "1px dashed var(--line)", cursor: "pointer",
              }}>
              {a.label && <b style={{ fontSize: 12.5, display: "block" }}>{a.label}</b>}
              <span style={{ fontSize: 12.5, fontFamily: "ui-monospace, Menlo, monospace" }}>
                {a.line1}, {a.city}, {a.state} {a.zip}
              </span>
            </button>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", fontSize: 10.5, color: "var(--mute)" }}>
            <span style={{ flex: 1 }}>Found by web search — check it before dispatching a truck.</span>
            <button onClick={dismiss}
              style={{ background: "none", border: 0, cursor: "pointer", color: "var(--sea)", fontWeight: 800, fontSize: 10.5 }}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {text.trim() && (parts.city || parts.state || parts.zip) && (
        <p className={"cw-note"} style={{ margin: "5px 0 0", fontFamily: "ui-monospace, Menlo, monospace" }}>
          {parts.line1 || "—"} · {parts.city || "—"} · {parts.state || "—"} {parts.zip}
        </p>
      )}
      {issues.length > 0 && (
        <p className={"cw-note"} style={{ color: "var(--stop)", fontWeight: 700 }}>
          {issues.join(" ")}
        </p>
      )}
      {err && <p className={"cw-note"} style={{ color: "var(--stop)" }}>{err}</p>}
    </div>
  );
}


function Field({ label, value, onChange, type = "text", mode, placeholder }) {
  return (
    <div className="cw-fld">
      <label>{label}</label>
      <input type={type} inputMode={mode} placeholder={placeholder}
        value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function stopState(x, ship) {

/* ---- dropped pins ---- */
const SHORT_LINK = /(maps\.app\.goo\.gl|goo\.gl\/maps|maps\.apple\/p\/|share\.google)/i;

function parsePin(raw) {
  const t = (raw || "").trim();
  if (!t) return null;
  let dec = t;
  try { dec = decodeURIComponent(t); } catch { /* keep raw */ }

  const coord = (la, ln) => {
    const lat = parseFloat(la), lng = parseFloat(ln);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
  };
  const inUS = (c) => c && c.lat > 24 && c.lat < 50 && c.lng > -125 && c.lng < -66;

  let m, c = null, how = "";
  if ((m = dec.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/))) { c = coord(m[1], m[2]); how = "Google place"; }
  else if ((m = dec.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/))) { c = coord(m[1], m[2]); how = "Google map centre"; }
  else if ((m = dec.match(/(?:^|[?&])(?:ll|sll|coordinate)=(-?\d+\.?\d*),(-?\d+\.?\d*)/))) { c = coord(m[1], m[2]); how = "Apple pin"; }
  else if ((m = dec.match(/(?:daddr|q|destination)=(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/))) { c = coord(m[1], m[2]); how = "link coordinates"; }
  else if ((m = dec.match(/geo:(-?\d+\.?\d*),(-?\d+\.?\d*)/))) { c = coord(m[1], m[2]); how = "Android pin"; }
  else if ((m = dec.match(/(?:^|\s)(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})(?:\s|$)/))) { c = coord(m[1], m[2]); how = "pasted coordinates"; }

  if (c) {
    if (!inUS(c)) return { outside: true };
    return { ...c, how };
  }
  if (SHORT_LINK.test(dec)) return { short: true };
  return { unknown: true };
}

function PinPaste({ value, onApply }) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const p = raw.trim() ? parsePin(raw) : null;

  if (!open) {
    return (
      <div style={{ marginBottom: 10 }}>
        <button className={"cw-btn " + "cw-btn-sm"} data-v="ghost" onClick={() => setOpen(true)}>
          <MapPin size={13} /> {value?.lat != null ? "Change dropped pin" : "Paste a dropped pin"}
        </button>
        {value?.lat != null && (
          <p className={"cw-note"} style={{ margin: "5px 0 0", fontFamily: "ui-monospace, Menlo, monospace" }}>
            Pin set: {value.lat}, {value.lng}{value.how ? ` · ${value.how}` : ""}
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 3, padding: 10, marginBottom: 10, background: "#fff" }}>
      <div className={"cw-eyebrow"} style={{ marginBottom: 6 }}>Paste whatever the client sent</div>
      <textarea rows={3} value={raw} onChange={(e) => setRaw(e.target.value)}
        style={{ width: "100%", padding: 10, border: "1px solid var(--line)", borderRadius: 2,
          fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12.5 }}
        placeholder="Google or Apple maps link, or plain coordinates like 29.7604, -95.3698" />

      {p?.short && (
        <p className={"cw-note"} style={{ color: "var(--stop)" }}>
          That's a shortened link — a browser can't open it. Tap it on your phone, let it open in maps,
          then share the full link or the address instead.
        </p>
      )}
      {p?.outside && (
        <p className={"cw-note"} style={{ color: "var(--stop)", fontWeight: 700 }}>
          Those coordinates are outside the United States. US only.
        </p>
      )}
      {p?.unknown && (
        <p className={"cw-note"} style={{ color: "var(--stop)" }}>
          Nothing recognisable in that. Paste coordinates or a full maps link.
        </p>
      )}
      {p && p.lat != null && (
        <>
          <div style={{ background: "#F1F4F1", padding: 8, borderRadius: 2, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12.5 }}>
            <b>{p.lat}, {p.lng}</b>
            <div style={{ color: "var(--mute)", fontSize: 11 }}>Read as: {p.how}</div>
          </div>
          <button className={"cw-btn " + "cw-btn-sm"} data-v="go" style={{ marginTop: 8 }}
            onClick={() => { onApply(p); setRaw(""); setOpen(false); }}>
            <Check size={13} /> Use this pin
          </button>
        </>
      )}
      <button className={"cw-btn " + "cw-btn-sm"} data-v="ghost" style={{ marginTop: 8 }}
        onClick={() => { setOpen(false); setRaw(""); }}>
        <X size={13} /> Cancel
      </button>
    </div>
  );
}

  if (x.status === "done") return "done";
  if (x.status === "refused" || x.status === "attempted") return "exc";
  const firstOpen = (ship.stops || []).find((y) => y.status === "wait");
  return firstOpen?.id === x.id && shipStatus(ship) === "running" ? "now" : "wait";
}

/* ================================================================== */
/* Track                                                              */
/* ================================================================== */

function ShipRow({ ship, onOpen }) {
  const stt = shipStatus(ship);
  const meta = STATUS[stt];
  const drops = (ship.stops || []).filter(isDrop);
  const done = drops.filter((x) => x.status === "done").length;
  const firstOpen = (ship.stops || []).find((x) => x.status === "wait");

  return (
    <button className="cw-shiprow" onClick={() => onOpen(ship.id)}>
      <div className="cw-seq" style={{
        background: stt === "delivered" ? "var(--go)" : stt === "exception" ? "var(--stop)" : "var(--ink)",
      }}>{stt === "delivered" ? "✓" : stt === "exception" ? "!" : done}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 7, alignItems: "baseline" }}>
          <b className="cw-data" style={{ fontSize: 13.5 }}>{ship.ref}</b>
          <span className="cw-note" style={{ margin: 0, flex: 1 }}>{dmy(ship.date)}</span>
          <span className="cw-tag" data-t={meta.tone}>{meta.label}</span>
        </div>
        <p className="cw-note" style={{ margin: "3px 0 0" }}>
          {done} of {drops.length} delivered
          {firstOpen ? ` · next: ${firstOpen.name}` : ""}
        </p>
        <div className="cw-mini">
          {(ship.stops || []).map((x) => (
            <div key={x.id} style={{
              background: x.status === "done" ? "var(--go)"
                : (x.status === "refused" || x.status === "attempted") ? "var(--stop)"
                  : firstOpen?.id === x.id ? "var(--hiviz)" : "#D2D6D2",
            }} />
          ))}
        </div>
      </div>
      <ChevronRight size={16} color="var(--mute)" style={{ flex: "0 0 16px", marginTop: 6 }} />
    </button>
  );
}

function Track({ shipments, onOpen, onNew }) {
  const [q, setQ] = useState("");
  const active = shipments.filter((s) => ["running", "booked", "requested"].includes(shipStatus(s)));
  const problems = shipments.filter((s) => shipStatus(s) === "exception");

  const match = (s) => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return s.ref.toLowerCase().includes(t)
      || (s.stops || []).some((x) => (x.name + x.ref).toLowerCase().includes(t))
      || (s.items || []).some((i) => (i.poNumber + i.serialNo + i.description).toLowerCase().includes(t));
  };
  const shown = shipments.filter(match);

  return (
    <>
      <button className="cw-btn" data-v="go" onClick={onNew}><Plus size={16} /> Request a pickup</button>

      {problems.length > 0 && (
        <div className="cw-alert cw-noprint">
          <h4 className="cw-display"><AlertTriangle size={14} /> {problems.length} shipment needs attention</h4>
          {problems.map((s) => {
            const bad = (s.stops || []).find((x) => x.status === "refused" || x.status === "attempted");
            return (
              <button key={s.id} onClick={() => onOpen(s.id)}
                style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: 0, cursor: "pointer", padding: "6px 0" }}>
                <b style={{ fontSize: 13 }}>{s.ref} · {bad?.name}</b>
                <div className="cw-note" style={{ margin: 0 }}>{bad?.reason}</div>
              </button>
            );
          })}
        </div>
      )}

      <div className="cw-fld">
        <label>Find a shipment</label>
        <div style={{ position: "relative" }}>
          <Search size={15} style={{ position: "absolute", left: 10, top: 12, color: "var(--mute)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 32 }}
            placeholder="PO number, serial, site or reference" />
        </div>
      </div>

      {active.length > 0 && (
        <>
          <div className="cw-eyebrow" style={{ margin: "4px 0 8px" }}>On the move</div>
          {active.filter(match).map((s) => <ShipRow key={s.id} ship={s} onOpen={onOpen} />)}
        </>
      )}

      <div className="cw-eyebrow" style={{ margin: "16px 0 8px" }}>All shipments</div>
      {shown.length === 0
        ? <div className="cw-empty"><Package size={26} /><p>Nothing matches that.</p></div>
        : shown.map((s) => <ShipRow key={s.id} ship={s} onOpen={onOpen} />)}
    </>
  );
}

/* ================================================================== */
/* Shipment detail                                                    */
/* ================================================================== */

function ClaimForm({ ship, stop, onSubmit, onCancel }) {
  const [kind, setKind] = useState("damage");
  const [detail, setDetail] = useState("");
  const [photo, setPhoto] = useState(null);
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="cw-card" style={{ borderLeft: "4px solid var(--stop)" }}>
      <div className="cw-eyebrow">Raise an issue</div>
      <h3 className="cw-display" style={{ fontSize: 18 }}>{stop.name}</h3>
      <p className="cw-note">{ship.ref} · delivered {hhmm(stop.deliveredAt)} {dmy(stop.deliveredAt)}</p>
      <hr className="cw-hr" />
      <div className="cw-fld">
        <label>What's wrong</label>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="damage">Goods damaged</option>
          <option value="short">Something missing / short</option>
          <option value="wrong">Wrong goods delivered</option>
          <option value="late">Delivered outside the window</option>
          <option value="other">Something else</option>
        </select>
      </div>
      <div className="cw-fld">
        <label>Detail</label>
        <textarea rows={4} value={detail} onChange={(e) => setDetail(e.target.value)}
          placeholder="What you found, and when you found it" />
      </div>
      <div style={{ marginBottom: 10 }}>
        <div className="cw-eyebrow" style={{ marginBottom: 6 }}>Photo (helps a lot)</div>
        {photo ? (
          <>
            <img src={photo} alt="claim" className="cw-thumb" />
            <button className="cw-btn cw-btn-sm" data-v="ghost" style={{ marginTop: 6 }} onClick={() => setPhoto(null)}>
              <RotateCcw size={13} /> Remove
            </button>
          </>
        ) : (
          <button className="cw-btn" data-v="ghost" disabled={busy} onClick={() => ref.current?.click()}>
            <Camera size={16} /> {busy ? "Processing…" : "Attach photo"}
          </button>
        )}
        <input ref={ref} type="file" accept="image/*" style={{ display: "none" }}
          onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            setBusy(true);
            try { setPhoto(await shrink(f)); } catch { alert("Couldn't read that photo."); }
            setBusy(false); e.target.value = "";
          }} />
      </div>
      <p className="cw-note">
        The carrier's signed proof of delivery for this stop is attached automatically.
      </p>
      <button className="cw-btn" data-v="go" disabled={!detail.trim()}
        onClick={() => onSubmit({ id: uid(), at: now(), stopId: stop.id, kind, detail: detail.trim(), photo, status: "open" })}>
        <Check size={16} /> Send to the carrier
      </button>
      <button className="cw-btn cw-btn-sm" data-v="ghost" onClick={onCancel}>Cancel</button>
    </div>
  );
}

function ShipDetail({ ship, company, onBack, onDoc, onClaim }) {
  const [claiming, setClaiming] = useState(null);
  const stt = shipStatus(ship);
  const meta = STATUS[stt];
  const drops = (ship.stops || []).filter(isDrop);
  const pickups = (ship.stops || []).filter(isPickup);
  const totalWt = (ship.items || []).reduce((a, b) => a + num(b.weight), 0);

  if (claiming) {
    return (
      <ClaimForm ship={ship} stop={claiming}
        onCancel={() => setClaiming(null)}
        onSubmit={(c) => { onClaim(ship.id, c); setClaiming(null); }} />
    );
  }

  return (
    <>
      <button className="cw-btn cw-btn-sm" data-v="ghost" style={{ marginBottom: 12 }} onClick={onBack}>
        <X size={13} /> All shipments
      </button>

      <div className="cw-card">
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div className="cw-eyebrow">Shipment</div>
            <h3 className="cw-display" style={{ fontSize: 21 }}>{ship.ref}</h3>
          </div>
          <span className="cw-tag" data-t={meta.tone}>{meta.label}</span>
        </div>
        <p className="cw-note">{meta.blurb}</p>
        <hr className="cw-hr" />
        <div className="cw-kv cw-data">
          <div><i>Date</i></div><div>{dmy(ship.date)}</div>
          <div><i>Carrier</i></div><div>{ship.carrier}</div>
          <div><i>Driver</i></div><div>{ship.driverName}</div>
          <div><i>Vehicle</i></div><div>{ship.unitNo}{ship.trailerNo ? ` / ${ship.trailerNo}` : ""}</div>
          <div><i>Collected from</i></div><div>{pickups.length} site{pickups.length === 1 ? "" : "s"}</div>
          <div><i>Delivering to</i></div><div>{drops.length} site{drops.length === 1 ? "" : "s"}</div>
          <div><i>Total weight</i></div><div>{totalWt.toLocaleString()} lb</div>
        </div>
      </div>

      <div className="cw-card">
        <div className="cw-eyebrow">Progress</div>
        <h3 className="cw-display" style={{ fontSize: 18 }}>
          {drops.filter((x) => x.status === "done").length} of {drops.length} delivered
        </h3>
        <hr className="cw-hr" />
        <div className="cw-tl">
          {(ship.stops || []).map((x) => {
            const s = stopState(x, ship);
            const cnt = isPickup(x)
              ? (ship.items || []).filter((i) => i.fromStopId === x.id).length
              : (ship.items || []).filter((i) => i.stopId === x.id).length;
            return (
              <div key={x.id} className="cw-tlrow" data-s={s}>
                <b style={{ fontSize: 14 }}>{isPickup(x) ? "Collected from" : "Delivering to"} {x.name}</b>
                <p className="cw-note" style={{ margin: "2px 0 4px" }}>
                  {x.address}{x.window ? ` · window ${x.window}` : ""}{x.ref ? ` · ${x.ref}` : ""}
                </p>
                <span className="cw-tag" data-t={s === "wait" ? "wait" : s}>
                  {x.status === "done"
                    ? (isPickup(x) ? `Collected ${hhmm(x.departedAt)}` : `Signed by ${x.receiver} · ${hhmm(x.deliveredAt)}`)
                    : (x.status === "refused" || x.status === "attempted")
                      ? `Not delivered · ${x.reason}`
                      : s === "now" ? "Driver on the way" : "Scheduled"}
                </span>{" "}
                <span className="cw-note cw-data">{cnt} item{cnt === 1 ? "" : "s"}</span>

                {x.notes && (
                  <p className="cw-note" style={{ color: "var(--stop)", fontWeight: 700 }}>{x.notes}</p>
                )}
                {x.sig && (
                  <img src={x.sig} alt="signature" style={{ height: 32, border: "1px solid var(--line)", background: "#fff", marginTop: 6, display: "block" }} />
                )}
                {isDrop(x) && (x.status === "done" || x.status === "refused" || x.status === "attempted") && (
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    <button className="cw-btn cw-btn-sm" data-v="ghost" onClick={() => onDoc(x.id)}>
                      <FileText size={13} /> Proof of delivery
                    </button>
                    <button className="cw-btn cw-btn-sm" data-v="ghost" onClick={() => setClaiming(x)}>
                      <AlertTriangle size={13} /> Raise an issue
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <hr className="cw-hr" />
        <button className="cw-btn" data-v="ghost" onClick={() => onDoc(null)}>
          <FileText size={15} /> Full shipment document
        </button>
      </div>

      {(ship.claims || []).length > 0 && (
        <div className="cw-card" style={{ borderLeft: "4px solid var(--stop)" }}>
          <div className="cw-eyebrow">Your issues</div>
          <h3 className="cw-display" style={{ fontSize: 17 }}>{ship.claims.length} raised</h3>
          <hr className="cw-hr" />
          {ship.claims.map((c) => {
            const st = (ship.stops || []).find((x) => x.id === c.stopId);
            return (
              <div key={c.id} style={{ padding: "7px 0", borderBottom: "1px dashed var(--line)" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <b style={{ fontSize: 13 }}>{st?.name}</b>
                  <span className="cw-note" style={{ margin: 0, flex: 1 }}>{dmy(c.at)}</span>
                  <span className="cw-tag" data-t="exc">{c.status}</span>
                </div>
                <p className="cw-note" style={{ margin: "3px 0 0" }}>{c.kind} — {c.detail}</p>
                {c.photo && <img src={c.photo} alt="claim" style={{ width: 80, height: 58, objectFit: "cover", border: "1px solid var(--line)", marginTop: 6 }} />}
              </div>
            );
          })}
          <p className="cw-note">The carrier has been notified. They'll respond by email.</p>
        </div>
      )}

      <div className="cw-card">
        <div className="cw-eyebrow">Goods on this shipment</div>
        <h3 className="cw-display" style={{ fontSize: 17 }}>{(ship.items || []).length} lines</h3>
        <hr className="cw-hr" />
        {(ship.items || []).map((i) => {
          const to = (ship.stops || []).find((x) => x.id === i.stopId);
          return (
            <div key={i.id} className="cw-row2">
              <span style={{ flex: 1, fontSize: 13 }}>
                <b>{i.description}</b>
                <span className="cw-note cw-data" style={{ display: "block", margin: 0 }}>
                  {i.poNumber} · {i.serialNo} · {i.qty} pcs · {i.weight} lb
                </span>
              </span>
              <span className="cw-note" style={{ margin: 0, fontSize: 11, flex: "0 0 auto" }}>{to?.name}</span>
            </div>
          );
        })}
      </div>

      {(ship.updates || []).length > 0 && (
        <div className="cw-card">
          <div className="cw-eyebrow">Updates</div>
          <hr className="cw-hr" />
          {[...ship.updates].reverse().map((u) => (
            <div key={u.id} className="cw-row2">
              <span className="cw-data" style={{ flex: "0 0 46px", fontSize: 11.5, color: "var(--mute)" }}>{hhmm(u.at)}</span>
              <span style={{ flex: 1, fontSize: 12.5 }}>{u.text}</span>
            </div>
          ))}
        </div>
      )}

      <div className="cw-card">
        <div className="cw-eyebrow">Need the carrier?</div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <a className="cw-btn cw-btn-sm" href={`tel:${company.carrierPhone}`}>
            <MessageSquare size={13} /> Call {ship.carrier.split(" ")[0]}
          </a>
          <a className="cw-btn cw-btn-sm" data-v="ghost"
            href={`mailto:${company.carrierEmail}?subject=${encodeURIComponent(`Query about ${ship.ref}`)}`}>
            Email about {ship.ref}
          </a>
        </div>
      </div>
    </>
  );
}

/* ================================================================== */
/* Documents                                                          */
/* ================================================================== */

function ShipDoc({ ship, stop, company, onBack }) {
  const items = stop ? (ship.items || []).filter((i) => i.stopId === stop.id) : (ship.items || []);
  const wt = items.reduce((a, b) => a + num(b.weight), 0);
  const originIds = new Set(items.map((i) => i.fromStopId));
  const origins = (ship.stops || []).filter((x) => isPickup(x) && originIds.has(x.id));
  const drops = (ship.stops || []).filter(isDrop);

  return (
    <>
      <div className="cw-noprint" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className="cw-btn cw-btn-sm" data-v="ghost" onClick={onBack}><X size={13} /> Back</button>
        <button className="cw-btn cw-btn-sm" onClick={() => window.print()}><Printer size={13} /> Print / Save PDF</button>
      </div>

      <div className="cw-doc cw-print">
        <div className="cw-dochd">
          <div>
            <h2>{stop ? "PROOF OF DELIVERY" : "SHIPMENT RECORD"}</h2>
            <div>{ship.ref}{stop ? ` — ${stop.name}` : ` — ${drops.length} DELIVERY POINTS`}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div>Carrier: {ship.carrier}</div>
            <div>Date: {dmy(ship.date)}</div>
            <div>Customer: {company.name}</div>
          </div>
        </div>

        {stop && stop.status !== "done" && (
          <div style={{ border: "2px solid #000", padding: 6, marginBottom: 8, fontWeight: "bold" }}>
            NOT DELIVERED — {String(stop.reason || "").toUpperCase()}
            {stop.notes ? <div style={{ fontWeight: "normal", marginTop: 3 }}>{stop.notes}</div> : null}
          </div>
        )}

        <table><tbody>
          <tr><th style={{ width: "50%" }}>COLLECTED FROM</th><th>DELIVERED TO</th></tr>
          <tr>
            <td>{(origins.length ? origins : (ship.stops || []).filter(isPickup)).map((o) => (
              <div key={o.id}>{o.name} — {o.address}</div>
            ))}</td>
            <td>{stop ? <>{stop.name}<br />{stop.address}</>
              : drops.map((x) => <div key={x.id}>{x.name} — {x.address}</div>)}</td>
          </tr>
        </tbody></table>

        <table><tbody>
          <tr><th>DRIVER</th><th>UNIT</th><th>TRAILER</th></tr>
          <tr><td>{ship.driverName}</td><td>{ship.unitNo}</td><td>{ship.trailerNo || "—"}</td></tr>
        </tbody></table>

        <table>
          <thead><tr><th>#</th><th>DESCRIPTION</th><th>QTY</th><th>WEIGHT</th><th>SERIAL</th><th>PO</th></tr></thead>
          <tbody>
            {items.map((i, n) => (
              <tr key={i.id}>
                <td>{n + 1}</td><td>{i.description}</td><td>{i.qty}</td>
                <td>{i.weight} lb</td><td>{i.serialNo}</td><td>{i.poNumber}</td>
              </tr>
            ))}
            <tr><td colSpan={2}><b>TOTAL</b></td><td colSpan={4}><b>{wt.toLocaleString()} lb · {items.length} lines</b></td></tr>
          </tbody>
        </table>

        {!stop && (
          <table>
            <thead><tr><th>DELIVERY POINT</th><th>OUTCOME</th><th>SIGNED BY</th><th>TIME</th></tr></thead>
            <tbody>
              {drops.map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td>{x.status === "done" ? "Delivered" : x.status === "wait" ? "Scheduled" : `Not delivered — ${x.reason}`}</td>
                  <td>{x.receiver || "—"}</td>
                  <td>{x.deliveredAt ? `${hhmm(x.deliveredAt)} ${dmy(x.deliveredAt)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {stop && (
          <table><tbody>
            <tr><th>RECEIVED BY</th><th>TIME</th><th>SIGNATURE</th></tr>
            <tr>
              <td>{stop.receiver || "—"}</td>
              <td>{stop.deliveredAt ? `${hhmm(stop.deliveredAt)} ${dmy(stop.deliveredAt)}` : "—"}</td>
              <td style={{ height: 54 }}>{stop.sig ? <img src={stop.sig} alt="signature" style={{ height: 42 }} /> : "—"}</td>
            </tr>
          </tbody></table>
        )}

        <div style={{ marginTop: 6, fontSize: 9 }}>
          Goods received in apparent good order except as noted. Subject to the carrier's terms and conditions.
        </div>
      </div>
    </>
  );
}

function Documents({ shipments, onOpenDoc }) {
  const [q, setQ] = useState("");
  const rows = [];
  shipments.forEach((s) => {
    (s.stops || []).filter(isDrop).forEach((x) => {
      if (x.status === "done" || x.status === "refused" || x.status === "attempted") {
        rows.push({ ship: s, stop: x });
      }
    });
  });
  const t = q.trim().toLowerCase();
  const shown = t ? rows.filter(({ ship, stop }) =>
    (ship.ref + stop.name + stop.ref).toLowerCase().includes(t)
    || (ship.items || []).some((i) => (i.poNumber + i.serialNo).toLowerCase().includes(t))) : rows;

  return (
    <>
      <div className="cw-card">
        <div className="cw-eyebrow"><FileText size={11} /> Paperwork</div>
        <h3 className="cw-display" style={{ fontSize: 19 }}>{rows.length} delivery documents</h3>
        <p className="cw-note">
          Every completed stop has a signed proof of delivery. Search by PO or serial number.
        </p>
        <hr className="cw-hr" />
        <div style={{ position: "relative" }}>
          <Search size={15} style={{ position: "absolute", left: 10, top: 12, color: "var(--mute)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} style={{
            width: "100%", padding: "10px 10px 10px 32px", border: "1px solid var(--line)",
            borderRadius: 2, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 15,
          }} placeholder="PO-4471, SN-88213, Katy…" />
        </div>
      </div>

      {shown.length === 0
        ? <div className="cw-empty"><FileText size={26} /><p>Nothing matches that.</p></div>
        : shown.map(({ ship, stop }) => (
          <button key={stop.id} className="cw-shiprow" onClick={() => onOpenDoc(ship.id, stop.id)}>
            <div className="cw-seq" style={{ background: stop.status === "done" ? "var(--go)" : "var(--stop)" }}>
              {stop.status === "done" ? "✓" : "!"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 13.5 }}>{stop.name}</b>
              <p className="cw-note cw-data" style={{ margin: "3px 0 0" }}>
                {ship.ref} · {stop.ref} · {dmy(stop.deliveredAt)}
              </p>
              <span className="cw-tag" data-t={stop.status === "done" ? "done" : "exc"} style={{ marginTop: 5, display: "inline-block" }}>
                {stop.status === "done" ? `Signed by ${stop.receiver}` : "Not delivered"}
              </span>
            </div>
            <ChevronRight size={16} color="var(--mute)" style={{ flex: "0 0 16px", marginTop: 6 }} />
          </button>
        ))}
    </>
  );
}

/* ================================================================== */
/* Invoices                                                           */
/* ================================================================== */

function InvoiceDoc({ inv, company, onBack }) {
  const total = inv.lines.reduce((a, l) => a + num(l.amt), 0);
  const overdue = inv.status === "open" && new Date(inv.due) < new Date();

  return (
    <>
      <div className="cw-noprint" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className="cw-btn cw-btn-sm" data-v="ghost" onClick={onBack}><X size={13} /> Back</button>
        <button className="cw-btn cw-btn-sm" onClick={() => window.print()}><Printer size={13} /> Print / Save PDF</button>
      </div>

      <div className="cw-doc cw-print">
        <div className="cw-dochd">
          <div>
            <h2>INVOICE</h2>
            <div>NQ Visiorence LLC</div>
            <div>509 Crownpoint Ln, Arlington TX 76002</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div>Invoice no.: {inv.no}</div>
            <div>Date: {dmy(inv.date)}</div>
            <div>Due: {dmy(inv.due)}</div>
            <div><b>{overdue ? "OVERDUE" : inv.status.toUpperCase()}</b></div>
          </div>
        </div>

        <table><tbody>
          <tr><th style={{ width: "50%" }}>BILL TO</th><th>SHIPMENTS COVERED</th></tr>
          <tr>
            <td>{company.name}<br />{company.address}<br />{company.contact}</td>
            <td>{inv.shipmentRefs.join(", ")}</td>
          </tr>
        </tbody></table>

        <table>
          <thead><tr><th>#</th><th>DESCRIPTION</th><th>QTY</th><th>RATE</th><th>AMOUNT</th></tr></thead>
          <tbody>
            {inv.lines.map((l, n) => (
              <tr key={n}>
                <td>{n + 1}</td>
                <td>{l.d}{l.sub ? <div style={{ color: "#555" }}>{l.sub}</div> : null}</td>
                <td>{l.qty}</td><td>{usd(l.rate)}</td><td>{usd(l.amt)}</td>
              </tr>
            ))}
            <tr><td colSpan={3}></td><td><b>TOTAL</b></td><td><b>{usd(total)}</b></td></tr>
          </tbody>
        </table>

        <div style={{ marginTop: 6, fontSize: 9 }}>
          Payment terms Net 15. Detention is charged in 15-minute blocks beyond the free time agreed in your rate schedule.
          Queries on any line should be raised within 7 days.
        </div>
      </div>
    </>
  );
}

function Invoices({ invoices, company, onOpen }) {
  const open = invoices.filter((i) => i.status === "open");
  const owed = open.reduce((a, i) => a + i.lines.reduce((b, l) => b + num(l.amt), 0), 0);

  return (
    <>
      <div className="cw-card" style={{ borderLeft: `4px solid ${owed ? "var(--hiviz)" : "var(--go)"}` }}>
        <div className="cw-eyebrow"><Receipt size={11} /> Account</div>
        <h3 className="cw-display" style={{ fontSize: 20 }}>{usd(owed)} outstanding</h3>
        <p className="cw-note">
          {open.length} open invoice{open.length === 1 ? "" : "s"} · terms Net 15
        </p>
      </div>

      {invoices.map((i) => {
        const total = i.lines.reduce((a, l) => a + num(l.amt), 0);
        const overdue = i.status === "open" && new Date(i.due) < new Date();
        return (
          <button key={i.id} className="cw-shiprow" onClick={() => onOpen(i.id)}>
            <div className="cw-seq" style={{ background: i.status === "paid" ? "var(--go)" : overdue ? "var(--stop)" : "var(--ink)" }}>
              {i.status === "paid" ? "✓" : "$"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 7, alignItems: "baseline" }}>
                <b className="cw-data" style={{ fontSize: 13.5 }}>Invoice {i.no}</b>
                <span className="cw-note" style={{ margin: 0, flex: 1 }}>{dmy(i.date)}</span>
                <span className="cw-tag" data-t={i.status === "paid" ? "done" : overdue ? "exc" : "now"}>
                  {i.status === "paid" ? "Paid" : overdue ? "Overdue" : "Open"}
                </span>
              </div>
              <p className="cw-note cw-data" style={{ margin: "3px 0 0" }}>
                {usd(total)} · due {dmy(i.due)} · {i.shipmentRefs.length} shipment{i.shipmentRefs.length === 1 ? "" : "s"}
              </p>
            </div>
            <ChevronRight size={16} color="var(--mute)" style={{ flex: "0 0 16px", marginTop: 6 }} />
          </button>
        );
      })}

      <p className="cw-note" style={{ textAlign: "center", marginTop: 14 }}>
        Something look wrong? Open the invoice and email the carrier — queries within 7 days.
      </p>
    </>
  );
}

/* ================================================================== */
/* Request a pickup                                                   */
/* ================================================================== */

function RequestPickup({ company, onCreate, onCancel }) {
  const [f, setF] = useState({
    fromName: "", fromAddress: "", when: new Date().toISOString().slice(0, 10), window: "",
    ref: "", notes: "",
  });
  const [drops, setDrops] = useState([{ id: uid(), name: "", address: "", pin: null, ref: "", window: "" }]);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const setDrop = (id, k) => (v) => setDrops(drops.map((d) => (d.id === id ? { ...d, [k]: v } : d)));

  const ok = f.fromAddress.trim() && drops.some((d) => d.address.trim());

  return (
    <div className="cw-card" style={{ borderLeft: "4px solid var(--go)" }}>
      <div className="cw-eyebrow">Request</div>
      <h3 className="cw-display" style={{ fontSize: 20 }}>Book a pickup</h3>
      <p className="cw-note">
        This goes to {company.name === "Meridian Freight Co." ? "NQ Visiorence" : "your carrier"} as a request.
        They'll confirm the time and rate before anything is scheduled.
      </p>
      <hr className="cw-hr" />

      <div className="cw-eyebrow" style={{ marginBottom: 6 }}>Collect from</div>
      <Field label="Site name" value={f.fromName} onChange={set("fromName")} placeholder="Warehouse 3" />
      <AddressField label="Address" value={f.fromAddress} onChange={set("fromAddress")}
        placeholder="Street and city, or the site name" />
      <PinPaste value={f.fromPin} onApply={(p) => setF({ ...f, fromPin: p })} />
      <div className="cw-row">
        <Field label="Date" type="date" value={f.when} onChange={set("when")} />
        <Field label="Ready from" value={f.window} onChange={set("window")} placeholder="08:00" />
      </div>
      <Field label="Your reference / PO" value={f.ref} onChange={set("ref")} placeholder="ACP03013P" />

      <hr className="cw-hr" />
      <div className="cw-eyebrow" style={{ marginBottom: 6 }}>Deliver to</div>
      {drops.map((d, i) => (
        <div key={d.id} style={{ border: "1px solid var(--line)", borderLeft: "4px solid var(--ink)", borderRadius: 3, padding: 10, marginBottom: 8, background: "#fff" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
            <div className="cw-seq" style={{ width: 22, height: 22, flex: "0 0 22px", fontSize: 11 }}>{i + 1}</div>
            <b style={{ fontSize: 13 }}>Delivery {i + 1}</b>
            {drops.length > 1 && (
              <button onClick={() => setDrops(drops.filter((x) => x.id !== d.id))} aria-label="Remove"
                style={{ marginLeft: "auto", background: "none", border: "1px solid var(--line)", borderRadius: 2, padding: "3px 6px", cursor: "pointer", color: "var(--stop)" }}>×</button>
            )}
          </div>
          <Field label="Site name" value={d.name} onChange={setDrop(d.id, "name")} />
          <AddressField label="Address" value={d.address} onChange={setDrop(d.id, "address")} />
          <PinPaste value={d.pin} onApply={(p) => setDrop(d.id, "pin")(p)} />
          <div className="cw-row">
            <Field label="Window" value={d.window} onChange={setDrop(d.id, "window")} placeholder="09:00–12:00" />
            <Field label="PO number" value={d.ref} onChange={setDrop(d.id, "ref")} placeholder="PO-4471" />
          </div>
        </div>
      ))}
      <button className="cw-btn cw-btn-sm" data-v="ghost" style={{ marginBottom: 12 }}
        onClick={() => setDrops([...drops, { id: uid(), name: "", address: "", pin: null, ref: "", window: "" }])}>
        <Plus size={13} /> Add another delivery
      </button>

      <div className="cw-fld">
        <label>Anything the driver should know</label>
        <textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })}
          placeholder="Gate code, dock number, forklift available, weight" />
      </div>

      <p className="cw-note">
        No rate is shown yet — the carrier confirms pricing when they accept.
      </p>

      <button className="cw-btn" data-v="go" disabled={!ok}
        onClick={() => onCreate({
          id: uid(), ref: `REQ-${Math.floor(Math.random() * 900 + 100)}`, status: "requested",
          date: f.when, carrier: "NQ Visiorence LLC", driverName: "To be assigned", unitNo: "—", trailerNo: "",
          stops: [
            { id: uid(), kind: "pickup", name: f.fromName.trim() || "Collection point", address: f.fromAddress.trim(), pin: f.fromPin || null, ref: f.ref.trim(), window: f.window.trim(), status: "wait" },
            ...drops.filter((d) => d.address.trim()).map((d) => ({
              id: uid(), kind: "drop", name: d.name.trim() || "Delivery point",
              address: d.address.trim(), pin: d.pin || null, ref: d.ref.trim(), window: d.window.trim(), status: "wait",
            })),
          ],
          items: [], claims: [],
          updates: [{ id: uid(), at: now(), text: "Pickup requested — waiting for the carrier to confirm" }],
          notes: f.notes.trim(),
        })}>
        <Check size={16} /> Send request
      </button>
      <button className="cw-btn cw-btn-sm" data-v="ghost" onClick={onCancel}>Cancel</button>
    </div>
  );
}

/* ================================================================== */
/* Shell                                                              */
/* ================================================================== */

const NAV = [
  { k: "track", label: "Track shipments", icon: <Package size={16} /> },
  { k: "docs", label: "Documents", icon: <FileText size={16} /> },
  { k: "invoices", label: "Invoices", icon: <Receipt size={16} /> },
];

function NavList({ view, go, onClose, onNew, company }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px 12px" }}>
        <Truck size={20} color="#F2B705" />
        <h1 className="cw-display" style={{ margin: 0, fontSize: 16, color: "#fff" }}>Truck Loading</h1>
        {onClose && (
          <button onClick={onClose} aria-label="Close"
            style={{ marginLeft: "auto", background: "none", border: 0, color: "#9FB0BF", cursor: "pointer" }}>
            <X size={18} />
          </button>
        )}
      </div>
      <button className="cw-item cw-cta" onClick={() => { onNew(); onClose?.(); }}>
        <Plus size={16} />Request a pickup
      </button>
      <div className="cw-navhead">Customer</div>
      {NAV.map((it) => (
        <button key={it.k} className="cw-item" data-on={view === it.k ? "1" : "0"}
          onClick={() => { go(it.k); onClose?.(); }}>{it.icon}{it.label}</button>
      ))}
      <div className="cw-navhead">Signed in</div>
      <div style={{ padding: "0 13px 12px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{company.name}</div>
        <div style={{ fontSize: 11, color: "#7E93A5" }}>{company.contact}</div>
      </div>
    </>
  );
}

export default function CustomerPortal() {
  const [view, setView] = useState("track");
  const [menu, setMenu] = useState(false);
  const [st, setSt] = useState(null);
  const [shipId, setShipId] = useState(null);
  const [docStop, setDocStop] = useState(undefined);
  const [invId, setInvId] = useState(null);

  useEffect(() => { load().then(setSt); }, []);
  const put = useCallback((patch) => {
    setSt((prev) => { const next = { ...prev, ...patch }; save(next); return next; });
  }, []);

  if (!st) {
    return <div className="cw"><style>{CSS}</style>
      <div className="cw-empty"><ClipboardList size={26} /><p>Opening your account…</p></div></div>;
  }

  const ship = st.shipments.find((s) => s.id === shipId);
  const inv = st.invoices.find((i) => i.id === invId);

  const addClaim = (id, c) => put({
    shipments: st.shipments.map((s) => (s.id === id
      ? { ...s, claims: [...(s.claims || []), c],
          updates: [...(s.updates || []), { id: uid(), at: now(), text: `You raised an issue: ${c.kind}` }] }
      : s)),
  });

  const page = () => {
    if (view === "request") {
      return <RequestPickup company={st.company} onCancel={() => setView("track")}
        onCreate={(s) => { put({ shipments: [s, ...st.shipments] }); setShipId(s.id); setDocStop(undefined); setView("detail"); }} />;
    }
    if (view === "doc" && ship) {
      return <ShipDoc ship={ship} company={st.company}
        stop={docStop ? ship.stops.find((x) => x.id === docStop) : null}
        onBack={() => setView(shipId ? "detail" : "docs")} />;
    }
    if (view === "detail" && ship) {
      return <ShipDetail ship={ship} company={st.company} onBack={() => setView("track")}
        onDoc={(sid) => { setDocStop(sid); setView("doc"); }}
        onClaim={addClaim} />;
    }
    if (view === "docs") {
      return <Documents shipments={st.shipments}
        onOpenDoc={(sid, stid) => { setShipId(sid); setDocStop(stid); setView("doc"); }} />;
    }
    if (view === "invoice" && inv) {
      return <InvoiceDoc inv={inv} company={st.company} onBack={() => setView("invoices")} />;
    }
    if (view === "invoices") {
      return <Invoices invoices={st.invoices} company={st.company}
        onOpen={(id) => { setInvId(id); setView("invoice"); }} />;
    }
    return <Track shipments={st.shipments}
      onOpen={(id) => { setShipId(id); setDocStop(undefined); setView("detail"); }}
      onNew={() => setView("request")} />;
  };

  const title = view === "request" ? "Request a pickup"
    : view === "doc" ? "Document"
      : view === "detail" ? (ship?.ref || "Shipment")
        : view === "docs" ? "Documents"
          : view === "invoice" ? `Invoice ${inv?.no || ""}`
            : view === "invoices" ? "Invoices" : "Track shipments";

  return (
    <div className="cw">
      <style>{CSS}</style>
      <div className="cw-shell">
        <nav className="cw-nav cw-noprint">
          <NavList view={view} go={setView} onNew={() => setView("request")} company={st.company} />
        </nav>
        {menu && (
          <>
            <div className="cw-scrim cw-noprint" onClick={() => setMenu(false)} />
            <nav className="cw-drawer cw-noprint">
              <NavList view={view} go={setView} onNew={() => setView("request")}
                company={st.company} onClose={() => setMenu(false)} />
            </nav>
          </>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="cw-bar cw-noprint">
            <button className="cw-burger" onClick={() => setMenu(true)} aria-label="Menu"><Menu size={20} /></button>
            <h1 className="cw-display">{title}</h1>
            <span className="cw-tag" data-t="wait" style={{ marginLeft: "auto" }}>Customer</span>
          </div>
          <div className="cw-main">{page()}</div>
        </div>
      </div>
    </div>
  );
}
