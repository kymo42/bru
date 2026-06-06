/**
 * Financial Stress Tracker
 * Cloudflare Worker
 *
 * Routes:
 *   GET  /          → HTML dashboard
 *   GET  /api/data  → JSON data (from KV)
 *   PUT  /api/data  → Update data (requires API secret header)
 *   GET  /api/health → Health check
 */

const SITE_TITLE = "Financial Stress Tracker";
const API_SECRET_HEADER = "x-update-secret";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" || path === "") {
      return serveHTML(env);
    }
    if (path === "/api/data" && request.method === "GET") {
      return serveData(env);
    }
    if (path === "/api/data" && request.method === "PUT") {
      return updateData(request, env);
    }
    if (path === "/api/health") {
      return new Response(JSON.stringify({ status: "ok", ts: Date.now() }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not found", { status: 404 });
  },
};

// ─── Data handlers ────────────────────────────────────────────────

async function serveData(env) {
  const raw = await env.BRU_DATA.get("stress_data");
  if (!raw) {
    return new Response(JSON.stringify({ error: "No data yet" }), {
      status: 503,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
  return new Response(raw, {
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

async function updateData(request, env) {
  const secret = request.headers.get(API_SECRET_HEADER);
  if (secret !== env.UPDATE_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const body = await request.text();
  // Validate it's valid JSON
  try {
    JSON.parse(body);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  await env.BRU_DATA.put("stress_data", body);
  return new Response(JSON.stringify({ ok: true, updated: new Date().toISOString() }), {
    headers: { "Content-Type": "application/json" },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600",
  };
}

// ─── HTML Dashboard ───────────────────────────────────────────────

async function serveHTML(env) {
  const raw = await env.BRU_DATA.get("stress_data");
  const data = raw ? JSON.parse(raw) : null;

  const html = buildHTML(data);
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

function buildHTML(data) {
  const lastUpdated = data?.last_updated ?? "Never";
  const rbaLatest = data?.rba_personal_credit?.slice(-1)[0] ?? null;
  const rbaChange = data?.rba_12mo_change ?? null;
  const insolvency = data?.insolvency ?? {};
  const ccvPrice = data?.ccv_price ?? null;
  const ccvData = data?.ccv_static ?? null;
  const ccpPrice = data?.ccp_price ?? null;
  const pokieData = data?.pokie_static ?? {};
  const overallLevel = data?.overall_stress_level ?? 7;
  const stressLevels = data?.stress_levels ?? [];
  const despScale = data?.desperation_scale ?? [];
  const rbaHistory = data?.rba_personal_credit ?? [];
  const breakdown = data?.stress_breakdown ?? {
    insolvency: { label: "Personal Insolvency", score: 75, detail: "+15.3% YoY" },
    pawn: { label: "Pawn & Alt. Credit", score: 80, detail: "CCV loan book +20%" },
    credit: { label: "Consumer Credit (RBA)", score: 50, detail: "Stable" },
    pokie: { label: "Poker Machine Losses", score: 75, detail: "Elevated structural demand" }
  };

  // Build donut chart segments
  const segments = [
    { label: breakdown.insolvency.label, value: breakdown.insolvency.score, detail: breakdown.insolvency.detail, color: "#a3a3a3" },
    { label: breakdown.pawn.label, value: breakdown.pawn.score, detail: breakdown.pawn.detail, color: "#737373" },
    { label: breakdown.credit.label, value: breakdown.credit.score, detail: breakdown.credit.detail, color: "#525252" },
    { label: breakdown.pokie.label, value: breakdown.pokie.score, detail: breakdown.pokie.detail, color: "#404040" }
  ];

  const totalScore = segments.reduce((sum, s) => sum + s.value, 0);
  const circumference = 2 * Math.PI * 40; // r=40
  let cumulativePercent = 0;
  
  const donutCircles = segments.map((seg) => {
    const percent = seg.value / totalScore;
    const dashArray = percent * circumference;
    const dashOffset = -cumulativePercent * circumference;
    cumulativePercent += percent;
    
    return `<circle cx="50" cy="50" r="40" fill="none" stroke="${seg.color}" stroke-width="16" 
      stroke-dasharray="${dashArray} ${circumference}" stroke-dashoffset="${dashOffset}" 
      transform="rotate(-90 50 50)" />`;
  }).join("");

  const donutLegend = segments.map(seg => `
    <div style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:6px;">
      <div style="width:12px;height:12px;border-radius:2px;background:${seg.color};"></div>
      <div style="flex:1;">
        <div style="font-weight:600;color:var(--text);">${seg.label}</div>
        <div style="color:var(--muted);font-size:11px;">${seg.detail} (Index: ${seg.value}/100)</div>
      </div>
    </div>
  `).join("");

  // Build sparkline data for RBA credit
  const sparkData = rbaHistory.slice(-24).map(([d, v]) => v);
  const sparkMin = Math.min(...sparkData);
  const sparkMax = Math.max(...sparkData);
  const sparkNorm = sparkData.map(v => ((v - sparkMin) / (sparkMax - sparkMin || 1)) * 60);
  const sparkPoints = sparkNorm.map((v, i) => `${(i / (sparkNorm.length - 1)) * 280},${60 - v}`).join(" ");

  const levelBar = "█".repeat(overallLevel) + "░".repeat(10 - overallLevel);
  const levelColor = overallLevel >= 8 ? "#a3a3a3" : overallLevel >= 6 ? "#737373" : overallLevel >= 4 ? "#525252" : "#404040";

  // Stress signals table rows
  const signalRows = stressLevels.map(s => {
    const arrow = s.trend === "rising" ? "📈" : s.trend === "falling" ? "📉" : "↔️";
    const trendClass = s.trend === "rising" ? "rising" : s.trend === "falling" ? "falling" : "stable";
    return `<tr>
      <td class="level-cell"><span class="level-badge">${s.level}</span></td>
      <td>${s.emoji} ${s.label}</td>
      <td class="${trendClass}">${arrow} ${s.status}</td>
      <td class="detail-cell">${s.detail}</td>
    </tr>`;
  }).join("");

  // Desperation scale cards
  const scaleCards = despScale.map(d => {
    const exploitClass = d.exploitability.toLowerCase().includes("extreme") ? "exploit-extreme"
      : d.exploitability.toLowerCase().includes("very high") ? "exploit-veryhigh"
      : d.exploitability.toLowerCase().includes("high") ? "exploit-high"
      : d.exploitability.toLowerCase().includes("medium") ? "exploit-medium"
      : "exploit-low";
    return `
    <div class="scale-card ${exploitClass}">
      <div class="scale-header">
        <span class="scale-level">L${d.level}</span>
        <span class="scale-emoji">${d.emoji}</span>
        <span class="scale-title">${d.label}</span>
      </div>
      <div class="scale-body">
        <div class="scale-row"><span class="scale-label">APR</span><span class="scale-value">${d.typical_apr}</span></div>
        <div class="scale-row exploit-row"><span class="scale-label">Exploit</span><span class="scale-value">${d.exploitability}</span></div>
        <div class="scale-row"><span class="scale-label">Signal</span><span class="scale-value">${d.economic_signal}</span></div>
        <div class="scale-row"><span class="scale-label">Data</span><span class="scale-value dimmed">${d.data_proxy}</span></div>
        ${d.notes ? `<div class="scale-row notes-row"><span class="scale-label">Note</span><span class="scale-value">${d.notes}</span></div>` : ""}
      </div>
    </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${SITE_TITLE}</title>
  <meta name="description" content="Real-time tracker of household financial stress using pawn shop activity, personal insolvency data, and credit metrics as economic indicators."/>
  <style>
    :root {
      --bg: #0d0d0d;
      --bg2: #141414;
      --bg3: #1c1c1c;
      --border: #2a2a2a;
      --text: #e5e5e5;
      --muted: #808080;
      --accent: #a3a3a3;
      --accent2: #d4d4d4;
      --red: #737373;
      --orange: #808080;
      --yellow: #8c8c8c;
      --green: #666666;
      --rising: #a3a3a3;
      --falling: #525252;
      --stable: #737373;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: 'Inter', -apple-system, sans-serif; font-size: 14px; line-height: 1.6; }
    a { color: var(--accent2); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* Layout */
    .header { background: var(--bg2); border-bottom: 1px solid var(--border); padding: 20px 32px; display: flex; align-items: center; gap: 16px; }
    .header-logo { font-size: 24px; font-weight: 800; color: var(--accent); letter-spacing: -1px; }
    .header-title { font-size: 16px; font-weight: 600; color: var(--text); }
    .header-sub { font-size: 12px; color: var(--muted); }
    .header-right { margin-left: auto; text-align: right; }
    .updated { font-size: 12px; color: var(--muted); }

    .container { max-width: 1200px; margin: 0 auto; padding: 24px 24px; }

    /* Grid */
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    @media (max-width: 900px) { .grid-3 { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 600px) { .grid-3, .grid-2 { grid-template-columns: 1fr; } }

    /* Cards */
    .card { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
    .card-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 8px; }
    .card-value { font-size: 32px; font-weight: 800; letter-spacing: -1px; }
    .card-sub { font-size: 12px; color: var(--muted); margin-top: 4px; }
    .card-badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 700; background: rgba(128,128,128,0.15); color: var(--orange); margin-top: 6px; }
    .card-badge.green { background: rgba(102,102,102,0.15); color: var(--green); }

    /* Stress meter */
    .stress-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 24px; }
    .stress-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 12px; }
    .stress-level { font-size: 48px; font-weight: 900; letter-spacing: -2px; color: ${levelColor}; }
    .stress-bar { font-family: monospace; font-size: 22px; letter-spacing: 2px; color: ${levelColor}; margin: 8px 0; }
    .stress-label { font-size: 12px; color: var(--muted); }
    .stress-row { display: flex; align-items: flex-end; gap: 24px; flex-wrap: wrap; }
    .stress-drivers { font-size: 13px; color: var(--text); margin-top: 12px; line-height: 1.8; }

    /* Sparkline */
    .spark-container { margin-top: 12px; }
    .spark-label { font-size: 11px; color: var(--muted); margin-bottom: 4px; }
    svg.sparkline { display: block; }

    /* Signal table */
    .section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 12px; margin-top: 32px; }
    table.signals { width: 100%; border-collapse: collapse; }
    table.signals th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); padding: 8px 12px; border-bottom: 1px solid var(--border); }
    table.signals td { padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
    table.signals tr:last-child td { border-bottom: none; }
    table.signals tr:hover td { background: var(--bg3); }
    .level-badge { display: inline-block; width: 24px; height: 24px; border-radius: 6px; background: var(--bg3); border: 1px solid var(--border); text-align: center; line-height: 24px; font-size: 11px; font-weight: 700; color: var(--accent); }
    .rising { color: var(--orange); font-weight: 600; }
    .falling { color: var(--green); font-weight: 600; }
    .stable { color: var(--muted); }
    .detail-cell { color: var(--muted); font-size: 12px; max-width: 320px; }
    .level-cell { width: 40px; }

    /* Desperation scale */
    .scale-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; margin-top: 16px; }
    .scale-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 16px; position: relative; overflow: hidden; }
    .scale-card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 12px; }
    .exploit-low::before { background: var(--green); }
    .exploit-medium::before { background: var(--yellow); }
    .exploit-high::before { background: var(--orange); }
    .exploit-veryhigh::before { background: var(--red); }
    .exploit-extreme::before { background: #404040; }
    .scale-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .scale-level { font-size: 11px; font-weight: 800; color: var(--accent); background: var(--bg3); padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border); }
    .scale-emoji { font-size: 20px; }
    .scale-title { font-weight: 700; font-size: 13px; }
    .scale-body { display: flex; flex-direction: column; gap: 6px; }
    .scale-row { display: flex; gap: 8px; font-size: 12px; }
    .scale-label { color: var(--muted); min-width: 52px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; padding-top: 1px; }
    .scale-value { color: var(--text); flex: 1; }
    .dimmed { color: var(--muted); }
    .exploit-row .scale-value { font-weight: 600; }
    .exploit-extreme .exploit-row .scale-value { color: #a3a3a3; }
    .exploit-veryhigh .exploit-row .scale-value { color: var(--red); }
    .exploit-high .exploit-row .scale-value { color: var(--orange); }
    .exploit-medium .exploit-row .scale-value { color: var(--yellow); }
    .exploit-low .exploit-row .scale-value { color: var(--green); }
    .notes-row .scale-value { color: var(--muted); font-style: italic; }

    /* Ticker strip */
    .ticker { background: var(--bg3); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); padding: 8px 0; overflow: hidden; white-space: nowrap; margin-bottom: 24px; font-size: 12px; color: var(--muted); }
    .ticker-inner { display: inline-block; animation: scroll 40s linear infinite; }
    .ticker-item { display: inline-block; margin: 0 32px; }
    .ticker-item .val { color: var(--text); font-weight: 600; }
    .ticker-item .up { color: var(--orange); }
    .ticker-item .down { color: var(--green); }
    @keyframes scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }

    /* Footer */
    .footer { background: var(--bg2); border-top: 1px solid var(--border); padding: 24px 32px; font-size: 12px; color: var(--muted); margin-top: 40px; }
    .footer a { color: var(--muted); }
    .footer-row { display: flex; gap: 24px; flex-wrap: wrap; align-items: center; }

    /* Methodology note */
    .methodology { background: var(--bg3); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; margin-top: 32px; font-size: 12px; color: var(--muted); line-height: 1.8; }
    .methodology strong { color: var(--text); }
  </style>
</head>
<body>

<div class="header">
  <div>
    <div class="header-logo">Stress Index</div>
    <div class="header-title">Financial Stress Tracker</div>
    <div class="header-sub">Pokies, pawn shops, payday loans & insolvency as economic indicators</div>
  </div>
  <div class="header-right">
    <div class="updated">Last updated: ${lastUpdated}</div>
    <div class="updated">Auto-refreshes daily</div>
  </div>
</div>

<div class="ticker">
  <div class="ticker-inner">
    ${[
      `ASX:CCV ${ccvPrice ? `<span class="val">$${ccvPrice}</span>` : "N/A"} Cash Converters`,
      `ASX:CCP ${ccpPrice ? `<span class="val">$${ccpPrice}</span>` : "N/A"} Credit Corp`,
      `RBA Personal Credit <span class="val">${rbaLatest ? `$${rbaLatest[1]}B` : "N/A"}</span>`,
      `Personal Insolvencies FY2024 <span class="val up">12,447</span> <span class="up">+15.3%↑</span>`,
      `CCV Loan Book Growth FY2023 <span class="val up">+20%↑</span>`,
      `Pawnbroking Industry <span class="val">$655.7M</span> revenue 841 businesses`,
      `ASX:CCV ${ccvPrice ? `<span class="val">$${ccvPrice}</span>` : "N/A"} Cash Converters`,
      `ASX:CCP ${ccpPrice ? `<span class="val">$${ccpPrice}</span>` : "N/A"} Credit Corp`,
      `RBA Personal Credit <span class="val">${rbaLatest ? `$${rbaLatest[1]}B` : "N/A"}</span>`,
      `Personal Insolvencies FY2024 <span class="val up">12,447</span> <span class="up">+15.3%↑</span>`,
    ].map(t => `<span class="ticker-item">${t}</span>`).join("")}
  </div>
</div>

<div class="container">

  <!-- Overall stress level -->
  <div class="stress-card">
    <div class="stress-title">Overall Financial Stress Level</div>
    <div class="stress-row" style="align-items: flex-start;">
      <div style="flex: 1; min-width: 250px;">
        <div class="stress-level" style="color:${levelColor}">${overallLevel}<span style="font-size:20px;color:var(--muted)">/10</span></div>
        <div class="stress-bar">${levelBar}</div>
        <div class="stress-label">HIGH STRESS — Multiple indicators elevated</div>
        
        <div style="margin-top: 20px; font-size: 13px; color: var(--text); line-height: 1.7;">
          <strong>Index Methodology:</strong><br/>
          The Overall Stress Level (1–10) is a composite index derived from four key pillars of household financial distress. 
          Unlike mainstream indicators (e.g., unemployment), these metrics capture <em>fringe credit dependency</em> — 
          when households exhaust traditional banking options and turn to high-cost, high-exploitability alternatives. 
          A rising score indicates accelerating reliance on debt to cover essential living costs.
        </div>
      </div>

      <div style="flex: 1; min-width: 260px; display: flex; flex-direction: column; align-items: center; padding: 0 16px;">
        <div style="position: relative; width: 120px; height: 120px; margin-bottom: 16px;">
          <svg width="100" height="100" viewBox="0 0 100 100" style="transform: scale(1.2);">
            ${donutCircles}
            <text x="50" y="50" text-anchor="middle" dominant-baseline="middle" font-size="14" font-weight="800" fill="${levelColor}">${overallLevel}</text>
          </svg>
        </div>
        <div style="width: 100%;">
          ${donutLegend}
        </div>
      </div>

      ${sparkData.length > 1 ? `
      <div style="flex: 1; min-width: 250px;">
        <div class="spark-label">RBA Other Personal Credit (24mo, $B)</div>
        <svg class="sparkline" width="100%" height="70" viewBox="0 0 300 70" preserveAspectRatio="none">
          <defs>
            <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${levelColor}" stop-opacity="0.3"/>
              <stop offset="100%" stop-color="${levelColor}" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <polyline points="${sparkPoints}" fill="none" stroke="${levelColor}" stroke-width="2" stroke-linejoin="round"/>
        </svg>
        <div class="spark-label" style="text-align:right">
          ${rbaLatest ? `Latest: $${rbaLatest[1]}B` : ""} 
          ${rbaChange !== null ? `(12mo: ${rbaChange > 0 ? "+" : ""}${rbaChange?.toFixed(1)}B)` : ""}
        </div>
      </div>` : ""}
    </div>
  </div>

  <!-- Top stat cards -->
  <div class="grid-3">
    <div class="card">
      <div class="card-title">🏪 Pawnbroking Industry</div>
      <div class="card-value">$655M</div>
      <div class="card-sub">Annual revenue (IBISWorld 2024)</div>
      <div class="card-sub">841 businesses nationally</div>
      <span class="card-badge">+3.3% p.a. growth</span>
    </div>
    <div class="card">
      <div class="card-title">⚖️ Personal Insolvencies</div>
      <div class="card-value">12,447</div>
      <div class="card-sub">FY2024 total (AFSA)</div>
      <div class="card-sub">Up from 10,799 in FY2023</div>
      <span class="card-badge">+15.3% YoY ↑</span>
    </div>
    <div class="card">
      <div class="card-title">📊 RBA Personal Credit</div>
      <div class="card-value">${rbaLatest ? `$${rbaLatest[1]}B` : "..."}</div>
      <div class="card-sub">Other personal credit outstanding</div>
      <div class="card-sub">${rbaLatest ? rbaLatest[0] : ""}</div>
      ${rbaChange !== null ? `<span class="card-badge">12mo: ${rbaChange > 0 ? "+" : ""}${rbaChange?.toFixed(1)}B</span>` : ""}
    </div>
  </div>

  <div class="grid-3">
    <div class="card">
      <div class="card-title">🏦 ASX:CCV Cash Converters</div>
      <div class="card-value">${ccvPrice ? `$${ccvPrice}` : "N/A"}</div>
      <div class="card-sub">Revenue: $310M FY2024</div>
      <div class="card-sub">165 Australian stores</div>
      <span class="card-badge">Loan book +20% FY2023</span>
    </div>
    <div class="card">
      <div class="card-title">📞 ASX:CCP Credit Corp</div>
      <div class="card-value">${ccpPrice ? `$${ccpPrice}` : "N/A"}</div>
      <div class="card-sub">Largest debt buyer in Australia</div>
      <div class="card-sub">PDL acquisitions at record levels</div>
      <span class="card-badge">Lagging indicator ↑</span>
    </div>
    <div class="card">
      <div class="card-title">💵 SACC Loans (Payday)</div>
      <div class="card-value">~1.77M</div>
      <div class="card-sub">Loans originated p.a. (ASIC 2017)</div>
      <div class="card-sub">48–400%+ effective APR</div>
      <span class="card-badge">NCCP capped</span>
    </div>
  </div>

  <div class="grid-3">
    <div class="card">
      <div class="card-title">🎰 Poker Machines (Pubs/Clubs)</div>
      <div class="card-value">${pokieData.nsw_annual_net_loss || "~$4.5B+"}</div>
      <div class="card-sub">NSW annual net loss (estimate)</div>
      <div class="card-sub">${pokieData.major_operators || "AVC, HTP, Stellar Group"}</div>
      <span class="card-badge">${pokieData.market_share || "Multi-pub operators hold ~60% of licenses"}</span>
    </div>
    <div class="card">
      <div class="card-title">🏢 ASX:ALL Aristocrat</div>
      <div class="card-value">Dominant</div>
      <div class="card-sub">Largest pokie manufacturer in AU/NZ</div>
      <div class="card-sub">Acquired Ainsworth (ASX:ALG) in 2022</div>
      <span class="card-badge">Hardware demand proxy</span>
    </div>
    <div class="card">
      <div class="card-title">🎲 Venue Gaming Health</div>
      <div class="card-value">Elevated</div>
      <div class="card-sub">Structural demand remains high</div>
      <div class="card-sub">Despite cost-of-living pressures</div>
      <span class="card-badge">Lagging indicator ↑</span>
    </div>
  </div>

  <!-- Signal table -->
  <div class="section-title">📡 Indicator Signals by Level</div>
  <div class="card" style="padding:0; overflow:hidden; margin-bottom:24px;">
    <table class="signals">
      <thead>
        <tr>
          <th>Lvl</th>
          <th>Category</th>
          <th>Trend</th>
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        ${signalRows}
      </tbody>
    </table>
  </div>

  <!-- Desperation scale -->
  <div class="section-title">🪜 The Desperation Scale — 10 Levels of Financial Need</div>
  <p style="color:var(--muted);font-size:12px;margin-bottom:16px;">
    Each level represents a progressively more desperate credit product. When higher levels show growth, society is under financial stress. The left border colour indicates exploitability of the borrower.
  </p>
  <div style="display:flex;gap:16px;margin-bottom:16px;font-size:11px;flex-wrap:wrap;">
    <span style="color:var(--green)">■ Low exploit</span>
    <span style="color:var(--yellow)">■ Medium</span>
    <span style="color:var(--orange)">■ High</span>
    <span style="color:var(--red)">■ Very High</span>
    <span style="color:#a3a3a3">■ Extreme</span>
  </div>
  <div class="scale-grid">
    ${scaleCards}
  </div>

  <!-- Methodology -->
  <div class="methodology">
    <strong>Methodology & Data Sources</strong><br/>
    This tracker monitors the alternative credit ecosystem as a proxy for household financial stress. The core thesis: when people resort to higher-level credit products (pawnbroking, payday loans), it signals broader economic distress that mainstream indicators often miss or lag.<br/><br/>
    <strong>Data sources:</strong>
    <a href="https://www.rba.gov.au/statistics/tables/csv/d2-data.csv">RBA D2 CSV (monthly)</a> ·
    <a href="https://www.afsa.gov.au/about-us/statistics-and-insights">AFSA Insolvency Stats</a> ·
    <a href="https://www.asx.com.au/markets/company/ccv">ASX:CCV filings</a> ·
    <a href="https://www.ibisworld.com/au/industry/pawnbroking/4522/">IBISWorld Pawnbroking</a> ·
    <a href="https://asic.gov.au">ASIC SACC reports</a><br/><br/>
    <strong>COVID caveat:</strong> Government stimulus (JobKeeper 2020-21) suppressed demand for fringe credit temporarily. The 2022+ surge reflects unwinding of stimulus + cost-of-living crisis.
    Built by <a href="https://github.com/kymo42/bru">kymo42</a> · Updates daily via GitHub Actions
  </div>

</div>

<div class="footer">
  <div class="footer-row">
    <span>Financial Stress Tracker</span>
    <span>Data: RBA · AFSA · ASX · IBISWorld · ASIC</span>
    <a href="https://github.com/kymo42/bru">GitHub</a>
    <a href="/api/data">Raw JSON</a>
    <span style="margin-left:auto">Not financial advice. For research purposes.</span>
  </div>
</div>

</body>
</html>`;
}
