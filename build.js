// kb-stats build script — renders index.html from stats.json
// Knowii-branded dark stats page for https://stats.notes.dsebastien.net
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
function fmt(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function formatBytes(bytes, decimals = 2) {
  if (!bytes) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

function sortedEntries(obj) {
  return Object.entries(obj || {}).sort(([a], [b]) => a.localeCompare(b));
}

function cumulative(entries) {
  let sum = 0;
  return entries.map(([k, v]) => [k, (sum += v)]);
}

// ---------------------------------------------------------------
// GitHub-style activity heatmap, rendered server-side
// ---------------------------------------------------------------
// Magenta opacity ramp on the dark well — clean, monotonic lightness
const HEAT_RAMP = [
  "rgba(255,255,255,0.06)",
  "rgba(255,20,147,0.18)",
  "rgba(255,20,147,0.35)",
  "rgba(255,20,147,0.55)",
  "rgba(255,20,147,0.78)",
  "#ff1493",
];

function heatColor(count, max) {
  if (!count) return HEAT_RAMP[0];
  const idx = 1 + Math.min(4, Math.floor((count / max) * 5));
  return HEAT_RAMP[Math.min(idx, 5)];
}

function buildHeatmap(createdByDay) {
  const days = createdByDay || {};
  const max = Math.max(1, ...Object.values(days));
  const today = new Date();
  // Start 52 full weeks back, aligned to Monday
  const start = new Date(today);
  start.setDate(start.getDate() - 364);
  while (start.getDay() !== 1) start.setDate(start.getDate() - 1);

  // Totals + busiest day (within the displayed window)
  let total = 0;
  let busiest = null;
  {
    const cur = new Date(start);
    while (cur <= today) {
      const key = cur.toISOString().slice(0, 10);
      const count = days[key] || 0;
      total += count;
      if (count > 0 && (!busiest || count > busiest.count)) busiest = { key, count };
      cur.setDate(cur.getDate() + 1);
    }
  }

  const columns = [];
  const monthLabels = [];
  let cursor = new Date(start);
  let weekIndex = 0;
  let lastMonth = -1;
  while (cursor <= today) {
    const cells = [];
    for (let d = 0; d < 7; d++) {
      if (cursor > today) break;
      const key = cursor.toISOString().slice(0, 10);
      const count = days[key] || 0;
      if (cursor.getDate() <= 7 && cursor.getMonth() !== lastMonth && d === 0) {
        lastMonth = cursor.getMonth();
        monthLabels.push({ week: weekIndex, label: cursor.toLocaleString("en-US", { month: "short" }) });
      }
      cells.push(`<div class="heat-cell" style="background:${heatColor(count, max)}" title="${key}: ${count} note${count === 1 ? "" : "s"} created"></div>`);
      cursor.setDate(cursor.getDate() + 1);
    }
    columns.push(`<div class="heat-col">${cells.join("")}</div>`);
    weekIndex++;
  }

  const labels = monthLabels
    .map((m) => `<span style="grid-column-start:${m.week + 1}">${m.label}</span>`)
    .join("");
  const legend = HEAT_RAMP.map((c) => `<span class="heat-cell" style="background:${c}"></span>`).join("");
  const busiestDate = busiest
    ? new Date(busiest.key + "T12:00:00").toLocaleString("en-US", { month: "long", day: "numeric" })
    : null;
  const dayLabel = (t) => `<div class="heat-daylabel">${t}</div>`;

  return `
    <div class="overflow-x-auto">
      <div class="heat-wrap">
        <div class="heat-months" style="grid-template-columns: repeat(${columns.length}, var(--heat-step))">${labels}</div>
        <div class="flex" style="gap:var(--heat-gap)">
          <div class="heat-days">${dayLabel("Mon")}${dayLabel("")}${dayLabel("Wed")}${dayLabel("")}${dayLabel("Fri")}${dayLabel("")}${dayLabel("")}</div>
          ${columns.join("")}
        </div>
        <div class="flex items-center justify-between mt-4 text-xs" style="color:var(--muted)">
          <span><strong style="color:var(--text)">${fmt(total)}</strong> notes created in the last 12 months${busiestDate ? ` · busiest day: <strong style="color:var(--accent-text)">${busiestDate}</strong> (${busiest.count} notes)` : ""}</span>
          <span class="flex items-center gap-1">Less ${legend} More</span>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------
// Small server-rendered components
// ---------------------------------------------------------------
function statCard(label, value, subtext, opts = {}) {
  const accentClass = opts.accent ? "stat-accent" : "";
  const countup = opts.countup ? `data-countup="${opts.countup}"` : "";
  return `
    <div class="card p-5 text-center reveal">
      <p class="text-sm uppercase tracking-wider" style="color:var(--muted)">${label}</p>
      <p class="stat-number ${accentClass} mt-2" ${countup}>${value}</p>
      ${subtext ? `<p class="text-sm mt-1" style="color:var(--muted)">${subtext}</p>` : ""}
    </div>`;
}

function barRow(label, count, max, hue) {
  const pct = Math.max(1.5, (count / max) * 100);
  return `
    <div class="flex items-center gap-3 group">
      <span class="w-44 shrink-0 text-sm text-right truncate" style="color:var(--text)">${label}</span>
      <div class="flex-1 h-5 rounded-r overflow-hidden" style="background:rgba(0,0,0,0.25)">
        <div class="h-full rounded-r bar-fill" style="width:${pct}%;background:${hue}"></div>
      </div>
      <span class="w-16 shrink-0 text-sm font-mono" style="color:var(--muted)">${fmt(count)}</span>
    </div>`;
}

function dataTable(caption, rows) {
  return `
    <details class="mt-3 text-sm" style="color:var(--muted)">
      <summary class="cursor-pointer hover:text-[var(--accent)]">Data table</summary>
      <div class="max-h-64 overflow-y-auto mt-2">
        <table class="w-full text-left"><caption class="sr-only">${caption}</caption>
          <thead><tr><th class="py-1 pr-4 font-semibold">Period</th><th class="py-1 font-semibold">Value</th></tr></thead>
          <tbody>${rows.map(([k, v]) => `<tr><td class="py-0.5 pr-4">${k}</td><td class="py-0.5 font-mono">${fmt(v)}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    </details>`;
}

// ---------------------------------------------------------------
// Page generation
// ---------------------------------------------------------------
function generateHtml(stats, outputFilePath) {
  const o = stats.overall;
  const p = stats.publication;
  const activity = o.activity || {};
  const ai = o.ai || { skills: 0, agents: 0, wikis: 0 };
  const streak = activity.daily_note_streak || { current: 0, longest: 0 };
  const ratio = p.public_ratio || null;

  // Derived series
  const createdMonthly = sortedEntries(activity.created_by_month);
  const growthSeries = cumulative(createdMonthly);
  const publishedMonthly = sortedEntries(p.published_by_month);
  const commitsMonthly = sortedEntries(activity.git_commits_by_month).slice(-24);
  const ageDist = activity.age_distribution || {};
  const vaultAgeDays = o.content_age.oldest_note.days || 1;
  const wordsPerDay = Math.round(o.total_words / vaultAgeDays);
  const vaultYears = (vaultAgeDays / 365).toFixed(1);
  const readingDays = (o.reading_time.minutes / 60 / 24).toFixed(1);

  const allNoteTypes = Object.entries(o.note_types);
  const noteTypes = allNoteTypes.slice(0, 12);
  const restNoteTypes = allNoteTypes.slice(12);
  const maxType = Math.max(...noteTypes.map(([, d]) => d.count));
  const ageEntries = Object.entries(ageDist);
  const maxAge = Math.max(1, ...ageEntries.map(([, v]) => v));
  const AGE_LABELS = { "0-1m": "≤ 1 month", "1-6m": "1–6 months", "6-12m": "6–12 months", "1-2y": "1–2 years", "2y+": "2+ years" };

  const topics = Object.entries(p.topics || {});
  const maxTopic = Math.max(1, ...topics.map(([, d]) => d.count));

  const chartData = {
    growth: { labels: growthSeries.map(([k]) => k), values: growthSeries.map(([, v]) => v) },
    published: { labels: publishedMonthly.map(([k]) => k), values: publishedMonthly.map(([, v]) => v) },
    commits: { labels: commitsMonthly.map(([k]) => k), values: commitsMonthly.map(([, v]) => v) },
  };

  const PERIOD_ORDER = ["daily", "weekly", "monthly", "quarterly", "yearly"];

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Knowledge Base Stats</title>
  <meta name="description" content="Live statistics about Sébastien Dubois' public knowledge base at notes.dsebastien.net — ${fmt(o.total_notes)} notes, ${fmt(o.total_words)} words, and counting.">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📊</text></svg>">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <style>
    :root {
      --bg: #37404c;
      --surface: #3f4957;
      --surface-elevated: #475363;
      --well: #2b323c;
      --border: rgba(255, 255, 255, 0.1);
      --text: #ffffff;
      --muted: rgba(255, 255, 255, 0.64);
      --accent: #e5007d;
      --accent-text: #ff4fa8;
      --series-magenta: #ff1493;
      --series-blue: #4f94d4;
      --series-green: #2e9e6b;
    }
    html { color-scheme: dark; scroll-behavior: smooth; }
    body { background: var(--bg); color: var(--text); font-family: "Noto Sans", "Inter", "Segoe UI", system-ui, sans-serif; }
    .font-mono { font-family: "JetBrains Mono", "Fira Code", monospace; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 1rem; transition: transform .25s ease, box-shadow .25s ease; }
    .card:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25); }
    .chart-well { background: var(--well); border-radius: 0.75rem; padding: 1rem; }
    .stat-number { font-size: 2.25rem; font-weight: 700; color: var(--text); line-height: 1.1; }
    .stat-accent { color: var(--accent-text); }
    .section-title { font-size: 1.75rem; font-weight: 800; }
    .section-title::after { content: ""; display: block; width: 3rem; height: 0.25rem; border-radius: 9999px; background: var(--accent); margin-top: 0.5rem; }
    .hero-gradient { background: linear-gradient(to bottom right, rgba(229, 0, 125, 0.12), rgba(168, 85, 247, 0.12), var(--bg)); position: relative; overflow: hidden; }
    .hero-headline-accent { background: linear-gradient(90deg, #ff1493, #e5007d 50%, #a855f7); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 0 18px rgba(255, 20, 147, 0.35)); }
    .pill { display: inline-flex; align-items: center; gap: 0.5rem; border-radius: 9999px; border: 1px solid rgba(229, 0, 125, 0.35); background: rgba(229, 0, 125, 0.12); padding: 0.25rem 1rem; font-size: 0.875rem; font-weight: 600; }
    .chip { background: rgba(255, 255, 255, 0.08); border-radius: 0.5rem; font-weight: 500; transition: background .2s; }
    .chip:hover { background: rgba(255, 255, 255, 0.14); }
    .btn-primary { background: var(--accent); color: #fff; font-weight: 700; border-radius: 0.5rem; padding: 0.75rem 1.75rem; display: inline-block; box-shadow: 0 4px 14px rgba(229, 0, 125, 0.35); transition: filter .2s, transform .2s; }
    .btn-primary:hover { filter: brightness(1.12); transform: translateY(-1px); text-decoration: none; }
    .btn-secondary { background: rgba(255, 255, 255, 0.1); color: var(--text); font-weight: 700; border-radius: 0.5rem; padding: 0.75rem 1.75rem; display: inline-block; transition: background .2s; }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.16); text-decoration: none; }
    .particle { position: absolute; border-radius: 9999px; background: var(--accent-text); opacity: 0.5; animation: float 5s ease-in-out infinite; }
    @keyframes float { 0%, 100% { transform: translateY(0); opacity: 0.35; } 50% { transform: translateY(-14px); opacity: 0.7; } }
    #backToTop { position: fixed; bottom: 1.5rem; right: 1.5rem; width: 3.25rem; height: 3.25rem; border-radius: 9999px; background: var(--accent); color: #fff; font-size: 1.4rem; font-weight: 700; border: none; cursor: pointer; box-shadow: 0 4px 14px rgba(229, 0, 125, 0.4); opacity: 0; pointer-events: none; transition: opacity .3s, transform .2s; z-index: 50; }
    #backToTop.show { opacity: 1; pointer-events: auto; }
    #backToTop:hover { transform: translateY(-2px); }
    :root { --heat-cell: 14px; --heat-gap: 3px; --heat-step: calc(var(--heat-cell) + var(--heat-gap)); }
    .heat-wrap { width: max-content; margin: 0 auto; }
    .heat-col { display: flex; flex-direction: column; gap: var(--heat-gap); }
    .heat-cell { width: var(--heat-cell); height: var(--heat-cell); border-radius: 3px; display: inline-block; }
    .heat-cell:hover { outline: 1px solid rgba(255, 255, 255, 0.5); }
    .heat-days { display: flex; flex-direction: column; gap: var(--heat-gap); margin-right: 6px; }
    .heat-daylabel { height: var(--heat-cell); font-size: 10px; line-height: var(--heat-cell); color: var(--muted); text-align: right; width: 26px; }
    .heat-months { display: grid; grid-auto-flow: column; font-size: 0.7rem; color: var(--muted); margin-bottom: 6px; margin-left: 32px; }
    @media (max-width: 900px) { :root { --heat-cell: 10px; } }
    .bar-fill { transform-origin: left; animation: growbar 1s ease both; }
    @keyframes growbar { from { transform: scaleX(0); } }
    .reveal { opacity: 0; transform: translateY(14px); transition: opacity .6s ease, transform .6s ease; }
    .reveal.visible { opacity: 1; transform: none; }
    @media (prefers-reduced-motion: reduce) {
      .reveal { opacity: 1; transform: none; transition: none; }
      .bar-fill { animation: none; }
      html { scroll-behavior: auto; }
    }
    a { color: var(--accent-text); }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <!-- Hero -->
  <header class="hero-gradient border-b" style="border-color:var(--border)">
    <div class="particle" style="width:8px;height:8px;left:12%;top:22%"></div>
    <div class="particle" style="width:5px;height:5px;left:28%;top:12%;animation-delay:1.2s"></div>
    <div class="particle" style="width:6px;height:6px;left:64%;top:15%;animation-delay:.6s"></div>
    <div class="particle" style="width:9px;height:9px;left:81%;top:30%;animation-delay:1.8s"></div>
    <div class="particle" style="width:4px;height:4px;left:48%;top:8%;animation-delay:2.4s"></div>
    <div class="particle" style="width:5px;height:5px;left:91%;top:12%;animation-delay:.3s"></div>
    <div class="max-w-6xl mx-auto px-4 pt-14 pb-14 text-center relative">
      <span class="pill" style="color:var(--accent-text)">📊 Live vault metrics · by Sébastien Dubois</span>
      <h1 class="text-4xl md:text-6xl font-extrabold mt-5">Knowledge Base <span class="hero-headline-accent">Statistics</span></h1>
      <p class="mt-5 text-lg max-w-2xl mx-auto" style="color:var(--muted)">
        A living window into <a href="https://notes.dsebastien.net">notes.dsebastien.net</a> —
        Sébastien Dubois' public Obsidian vault. ${vaultYears} years of daily knowledge work, measured.
      </p>
      <div class="flex flex-wrap justify-center gap-x-12 gap-y-6 mt-10">
        <div class="text-center">
          <p class="text-4xl font-bold" style="color:var(--accent-text)" data-countup="${o.total_notes}">0</p>
          <p class="text-sm mt-1" style="color:var(--muted)">Notes</p>
        </div>
        <div class="text-center">
          <p class="text-4xl font-bold" style="color:#4ade80" data-countup="${o.total_words}">0</p>
          <p class="text-sm mt-1" style="color:var(--muted)">Words · ≈ ${o.books_equivalent.toFixed(0)} books</p>
        </div>
        <div class="text-center">
          <p class="text-4xl font-bold" style="color:#fbbf24" data-countup="${o.links.internal.count}">0</p>
          <p class="text-sm mt-1" style="color:var(--muted)">Internal links</p>
        </div>
        <div class="text-center">
          <p class="text-4xl font-bold" data-countup="${streak.current}">0</p>
          <p class="text-sm mt-1" style="color:var(--muted)">Day streak · longest ${fmt(streak.longest)}</p>
        </div>
      </div>
      <p class="mt-8 text-xs font-mono" style="color:var(--muted)">${stats.generated_at ? `Generated ${stats.generated_at} · updates automatically` : ""}</p>
    </div>
  </header>

  <main class="max-w-6xl mx-auto px-4 pb-16">

    <!-- Fun equivalents ticker -->
    <section class="mt-10 reveal">
      <div class="card px-6 py-4 flex flex-wrap justify-center gap-x-10 gap-y-2 text-sm" style="color:var(--muted)">
        <span>📚 Equivalent to <strong style="color:var(--text)">${o.books_equivalent.toFixed(1)} books</strong></span>
        <span>⏱️ <strong style="color:var(--text)">${readingDays} days</strong> of non-stop reading</span>
        <span>✍️ <strong style="color:var(--text)">${fmt(wordsPerDay)} words</strong> written per day on average</span>
        <span>🔀 <strong style="color:var(--text)">${fmt(o.size.git_commits)}</strong> git commits</span>
      </div>
    </section>

    <!-- Growth -->
    <section class="mt-14">
      <h2 class="section-title reveal">Growth over time</h2>
      <div class="grid lg:grid-cols-2 gap-6 mt-6">
        <div class="card p-6 reveal">
          <h3 class="font-bold">Cumulative notes</h3>
          <p class="text-sm mb-4" style="color:var(--muted)">Every note ever created, stacked up month after month</p>
          <div class="chart-well"><canvas id="growthChart" height="220" role="img" aria-label="Cumulative number of notes created per month"></canvas></div>
          ${dataTable("Cumulative notes by month", growthSeries)}
        </div>
        <div class="card p-6 reveal">
          <h3 class="font-bold">Notes published per month</h3>
          <p class="text-sm mb-4" style="color:var(--muted)">Additions to the public garden</p>
          <div class="chart-well"><canvas id="publishedChart" height="220" role="img" aria-label="Notes published per month"></canvas></div>
          ${dataTable("Notes published by month", publishedMonthly)}
        </div>
      </div>
    </section>

    <!-- Activity heatmap -->
    <section class="mt-14">
      <h2 class="section-title reveal">Creation activity</h2>
      <p class="mt-2 text-sm reveal" style="color:var(--muted)">One square per day, last 12 months — darker to brighter magenta = more notes created.</p>
      <div class="card p-6 md:p-8 mt-6 reveal">
        ${buildHeatmap(activity.created_by_day)}
      </div>
    </section>

    ${ratio ? `
    <!-- Public vs private -->
    <section class="mt-14">
      <h2 class="section-title reveal">Public by default</h2>
      <div class="card p-6 mt-6 reveal">
        <div class="flex flex-col md:flex-row md:items-center gap-6">
          <div class="text-center md:text-left shrink-0">
            <p class="text-5xl font-extrabold font-mono" style="color:var(--accent-text)">${ratio.percentage}%</p>
            <p class="text-sm mt-1" style="color:var(--muted)">of all notes are published</p>
          </div>
          <div class="flex-1">
            <div class="flex h-6 rounded overflow-hidden" style="gap:2px" role="img" aria-label="${fmt(ratio.public)} public notes versus ${fmt(ratio.private)} private notes">
              <div style="width:${ratio.percentage}%;background:var(--accent)"></div>
              <div class="flex-1" style="background:rgba(255,255,255,0.2)"></div>
            </div>
            <div class="flex justify-between text-sm mt-2" style="color:var(--muted)">
              <span><span class="inline-block w-2.5 h-2.5 rounded-sm mr-1.5" style="background:var(--accent)"></span>${fmt(ratio.public)} public notes</span>
              <span>${fmt(ratio.private)} private notes <span class="inline-block w-2.5 h-2.5 rounded-sm ml-1.5" style="background:rgba(255,255,255,0.2)"></span></span>
            </div>
            <p class="text-sm mt-3" style="color:var(--muted)">Learning in public: half of everything captured ends up freely readable by anyone.</p>
          </div>
        </div>
      </div>
    </section>` : ""}

    <!-- What's inside -->
    <section class="mt-14">
      <h2 class="section-title reveal">What's inside</h2>
      <div class="grid lg:grid-cols-2 gap-6 mt-6">
        <div class="card p-6 reveal">
          <h3 class="font-bold mb-4">Notes by type</h3>
          <div class="chart-well space-y-2.5">
            ${noteTypes.map(([, d]) => barRow(d.formatted_name.replace(/ Type$/, ""), d.count, maxType, "var(--series-magenta)")).join("")}
            ${restNoteTypes.length ? `
            <details class="pt-1">
              <summary class="cursor-pointer text-sm font-semibold select-none" style="color:var(--accent-text)">Show all ${allNoteTypes.length} types</summary>
              <div class="space-y-2.5 mt-3">
                ${restNoteTypes.map(([, d]) => barRow(d.formatted_name.replace(/ Type$/, ""), d.count, maxType, "var(--series-magenta)")).join("")}
              </div>
            </details>` : ""}
          </div>
        </div>
        <div class="flex flex-col gap-6">
          <div class="card p-6 reveal">
            <h3 class="font-bold mb-4">Note age distribution</h3>
            <div class="chart-well space-y-2.5">
              ${ageEntries.map(([k, v]) => barRow(AGE_LABELS[k] || k, v, maxAge, "var(--series-blue)")).join("")}
            </div>
            <p class="text-sm mt-4" style="color:var(--muted)">A living garden: ${(((ageDist["0-1m"] || 0) + (ageDist["1-6m"] || 0)) / Math.max(1, o.total_notes) * 100).toFixed(0)}% of notes are less than 6 months old.</p>
          </div>
          <div class="card p-6 reveal">
            <h3 class="font-bold mb-3">Published topics</h3>
            <div class="flex flex-wrap gap-2">
              ${topics.map(([, d]) => {
                const scale = 0.8 + 0.5 * Math.log1p(d.count / maxTopic);
                return `<span class="chip px-3 py-1" style="font-size:${scale.toFixed(2)}rem">${d.formatted_name} <span class="font-mono text-xs" style="color:var(--muted)">${fmt(d.count)}</span></span>`;
              }).join("")}
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- AI assistant -->
    <section class="mt-14">
      <h2 class="section-title reveal">The AI layer</h2>
      <p class="mt-2 text-sm max-w-2xl reveal" style="color:var(--muted)">This vault is not just written — it is tended. A living AI team of agents and skills maintains, connects, and grows the knowledge base every day.</p>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        ${statCard("AI skills", "0", "specialized capabilities", { countup: ai.skills, accent: true })}
        ${statCard("AI agents", "0", "personas with memory", { countup: ai.agents, accent: true })}
        ${statCard("LLM wikis", "0", "AI-curated knowledge bases", { countup: ai.wikis, accent: true })}
      </div>
    </section>

    <!-- Rhythms -->
    <section class="mt-14">
      <h2 class="section-title reveal">Rhythms</h2>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mt-6">
        ${PERIOD_ORDER.filter((k) => o.periodic_notes[k]).map((k) => {
          const d = o.periodic_notes[k];
          return statCard(`${k} notes`, fmt(d.count), `avg ${fmt(d.average_words)} words`);
        }).join("")}
      </div>
      <div class="card p-6 mt-6 reveal">
        <h3 class="font-bold">Journaling discipline</h3>
        <p class="text-sm mt-2" style="color:var(--muted)">
          Current daily-note streak: <strong style="color:var(--accent-text)">${fmt(streak.current)} days</strong> ·
          Longest streak ever: <strong style="color:var(--accent-text)">${fmt(streak.longest)} days</strong>
          ${streak.longest > 365 ? ` — that's ${(streak.longest / 365).toFixed(1)} years without missing a single day.` : ""}
        </p>
      </div>
    </section>

    <!-- Folders -->
    <section class="mt-14">
      <h2 class="section-title reveal">Biggest knowledge areas</h2>
      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
        ${Object.entries(o.folders.top_folders).map(([folder, d]) => `
          <div class="card p-5 reveal">
            <h3 class="text-sm font-bold truncate" title="${folder}">${folder.split("/").pop()}</h3>
            <p class="text-xs truncate" style="color:var(--muted)">${folder}</p>
            <div class="grid grid-cols-3 gap-2 mt-3 text-center">
              <div><p class="text-lg font-mono font-semibold" style="color:var(--text)">${fmt(d.note_count)}</p><p class="text-xs" style="color:var(--muted)">notes</p></div>
              <div><p class="text-lg font-mono font-semibold" style="color:var(--text)">${fmt(d.words)}</p><p class="text-xs" style="color:var(--muted)">words</p></div>
              <div><p class="text-lg font-mono font-semibold" style="color:var(--text)">${d.growth_rate}</p><p class="text-xs" style="color:var(--muted)">new/month</p></div>
            </div>
          </div>`).join("")}
      </div>
    </section>

    <!-- Engine room -->
    <section class="mt-14">
      <h2 class="section-title reveal">Engine room</h2>
      <div class="grid lg:grid-cols-2 gap-6 mt-6">
        <div class="card p-6 reveal">
          <h3 class="font-bold">Git commits per month</h3>
          <p class="text-sm mb-4" style="color:var(--muted)">Version-controlled knowledge — last 24 months</p>
          <div class="chart-well"><canvas id="commitsChart" height="200" role="img" aria-label="Git commits per month over the last 24 months"></canvas></div>
        </div>
        <div class="grid grid-cols-2 gap-4 content-start">
          ${statCard("Vault size", formatBytes(o.size.total_bytes), `${formatBytes(o.size.md_files_bytes)} of markdown`)}
          ${statCard("Attachments", fmt(o.special_files.attachments.public), "public images & files")}
          ${statCard("Maps of Content", fmt(o.mocs.count), `${o.mocs.average_links} links each`)}
          ${statCard("Unique tags", fmt(o.tags.total), `${o.tags.average_per_note} per note`)}
          ${statCard("Canvases", fmt(o.special_files.canvases), "visual thinking")}
          ${statCard("Templates", fmt(o.special_files.templates), "automation building blocks")}
        </div>
      </div>
    </section>

    <!-- Freshness -->
    <section class="mt-14">
      <h2 class="section-title reveal">Freshness</h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
        ${["last_week", "last_month", "last_quarter", "last_year"].map((k) => {
          const d = o.content_age.updates[k];
          return statCard(`Updated ${k.replace("_", " ")}`, fmt(d.count), `${d.percentage}% of the vault`);
        }).join("")}
      </div>
    </section>
    <!-- CTA -->
    <section class="mt-16 reveal">
      <div class="card p-8 md:p-10 text-center" style="border-color:rgba(255,20,147,0.35)">
        <h2 class="text-2xl md:text-3xl font-extrabold">Want a knowledge base like this?</h2>
        <p class="mt-3 max-w-2xl mx-auto" style="color:var(--muted)">
          This entire system runs on the <strong style="color:var(--text)">Obsidian Starter Kit</strong> —
          the same structure, templates and workflows behind every number on this page.
        </p>
        <div class="flex flex-col sm:flex-row gap-4 justify-center mt-6">
          <a class="btn-primary" href="https://store.dsebastien.net/product/obsidian-starter-kit" style="color:#fff">Get the Obsidian Starter Kit</a>
          <a class="btn-secondary" href="https://store.dsebastien.net/product/knowii-community">Join the Knowii Community</a>
        </div>
      </div>
    </section>
  </main>

  <footer class="border-t py-10" style="border-color:var(--border)">
    <div class="max-w-6xl mx-auto px-4 text-center text-sm" style="color:var(--muted)">
      <p>
        <a href="https://notes.dsebastien.net">Public notes</a> ·
        <a href="https://www.dsebastien.net">Blog</a> ·
        <a href="https://store.dsebastien.net">Store</a>
      </p>
      <p class="mt-3">Crafted by <a href="https://www.dsebastien.net">Sébastien Dubois</a> / DeveloPassion.</p>
    </div>
  </footer>

  <button id="backToTop" aria-label="Back to top" onclick="window.scrollTo({top:0,behavior:'smooth'})">↑</button>

  <script>
    var DATA = ${JSON.stringify(chartData)};
    var MUTED = "rgba(255,255,255,0.64)";
    var GRID = "rgba(255,255,255,0.07)";

    Chart.defaults.color = MUTED;
    Chart.defaults.font.family = '"Noto Sans", system-ui, sans-serif';
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.plugins.tooltip.backgroundColor = "#2b323c";
    Chart.defaults.plugins.tooltip.borderColor = "rgba(255,255,255,0.2)";
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.titleColor = "#ffffff";
    Chart.defaults.plugins.tooltip.bodyColor = "#ffffff";

    function lineOpts(stepped) {
      return {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
          y: { beginAtZero: true, grid: { color: GRID }, border: { display: false } }
        }
      };
    }

    new Chart(document.getElementById("growthChart"), {
      type: "line",
      data: {
        labels: DATA.growth.labels,
        datasets: [{
          label: "Notes",
          data: DATA.growth.values,
          borderColor: "#4f94d4",
          backgroundColor: "rgba(79,148,212,0.15)",
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: true, tension: 0.3
        }]
      },
      options: lineOpts()
    });

    new Chart(document.getElementById("publishedChart"), {
      type: "line",
      data: {
        labels: DATA.published.labels,
        datasets: [{
          label: "Published",
          data: DATA.published.values,
          borderColor: "#ff1493",
          backgroundColor: "rgba(255,20,147,0.14)",
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: true, tension: 0.3
        }]
      },
      options: lineOpts()
    });

    new Chart(document.getElementById("commitsChart"), {
      type: "bar",
      data: {
        labels: DATA.commits.labels,
        datasets: [{
          label: "Commits",
          data: DATA.commits.values,
          backgroundColor: "#2e9e6b",
          borderRadius: 4, maxBarThickness: 18
        }]
      },
      options: lineOpts()
    });

    // Reveal on scroll
    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });
    document.querySelectorAll(".reveal").forEach(function (el) { revealObserver.observe(el); });

    // Count-up animation
    function animateCount(el) {
      var target = parseInt(el.getAttribute("data-countup"), 10) || 0;
      if (reduceMotion) { el.textContent = target.toLocaleString("en-US"); return; }
      var duration = 1400;
      var start = null;
      function step(ts) {
        if (start === null) start = ts;
        var progress = Math.min((ts - start) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(target * eased).toLocaleString("en-US");
        if (progress < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    var countObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCount(entry.target);
          countObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });
    document.querySelectorAll("[data-countup]").forEach(function (el) { countObserver.observe(el); });

    // Back-to-top FAB
    var fab = document.getElementById("backToTop");
    window.addEventListener("scroll", function () {
      fab.classList.toggle("show", window.scrollY > 600);
    }, { passive: true });
  </script>
</body>
</html>
`;

  fs.writeFileSync(outputFilePath, htmlContent);
  console.log(`HTML file generated: ${outputFilePath}`);
}

// Main execution
const jsonFile = path.join(__dirname, "stats.json");
const outputHtmlFile = path.join(__dirname, "index.html");

if (fs.existsSync(jsonFile)) {
  const stats = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
  generateHtml(stats, outputHtmlFile);
} else {
  console.error(`JSON file not found: ${jsonFile}`);
  process.exit(1);
}
