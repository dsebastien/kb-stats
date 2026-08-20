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
const HEAT_RAMP = ["#171c26", "#232e63", "#2a3a8a", "#4256c4", "#6273de", "#93a2f2"];

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
  return `
    <div class="overflow-x-auto pb-2">
      <div class="heat-months" style="grid-template-columns: repeat(${columns.length}, 13px)">${labels}</div>
      <div class="flex gap-[3px]">${columns.join("")}</div>
    </div>
    <div class="flex items-center gap-1.5 mt-3 text-xs" style="color:var(--muted)">
      Fewer ${legend} more notes created per day
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
      <div class="flex-1 h-5 rounded-r overflow-hidden" style="background:rgba(247,243,236,0.04)">
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

  const noteTypes = Object.entries(o.note_types).slice(0, 12);
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
      --bg: #0e1117;
      --surface: #151a23;
      --border: rgba(247, 243, 236, 0.07);
      --text: #f7f3ec;
      --muted: #8a8f99;
      --accent: #f08a3e;
      --primary: #2a3a8a;
      --series-orange: #d9701f;
      --series-indigo: #6273de;
      --series-green: #2e9e6b;
    }
    html { color-scheme: dark; scroll-behavior: smooth; }
    body { background: var(--bg); color: var(--text); font-family: "Noto Sans", "Inter", "Segoe UI", system-ui, sans-serif; }
    .font-mono, .stat-number { font-family: "JetBrains Mono", "Fira Code", monospace; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 0.75rem; transition: transform .25s ease, border-color .25s ease; }
    .card:hover { transform: translateY(-2px); border-color: rgba(240, 138, 62, 0.35); }
    .stat-number { font-size: 2rem; font-weight: 600; color: var(--text); }
    .stat-accent { color: var(--accent); }
    .section-title { font-size: 1.5rem; font-weight: 800; }
    .section-title .hash { color: var(--accent); }
    .hero-glow { background: radial-gradient(ellipse 80% 60% at 50% -10%, rgba(42, 58, 138, 0.55), transparent 70%), radial-gradient(ellipse 40% 30% at 80% 10%, rgba(240, 138, 62, 0.12), transparent 70%); }
    .chip { background: rgba(98, 115, 222, 0.12); border: 1px solid rgba(98, 115, 222, 0.3); border-radius: 9999px; transition: border-color .2s; }
    .chip:hover { border-color: var(--accent); }
    .heat-col { display: flex; flex-direction: column; gap: 3px; }
    .heat-cell { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
    .heat-months { display: grid; grid-auto-flow: column; font-size: 0.7rem; color: var(--muted); margin-bottom: 4px; }
    .bar-fill { transform-origin: left; animation: growbar 1s ease both; }
    @keyframes growbar { from { transform: scaleX(0); } }
    .reveal { opacity: 0; transform: translateY(14px); transition: opacity .6s ease, transform .6s ease; }
    .reveal.visible { opacity: 1; transform: none; }
    @media (prefers-reduced-motion: reduce) {
      .reveal { opacity: 1; transform: none; transition: none; }
      .bar-fill { animation: none; }
      html { scroll-behavior: auto; }
    }
    a { color: var(--accent); }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <!-- Hero -->
  <header class="hero-glow border-b" style="border-color:var(--border)">
    <div class="max-w-6xl mx-auto px-4 pt-16 pb-12 text-center">
      <p class="text-sm font-semibold uppercase tracking-[0.25em]" style="color:var(--accent)">Knowii · DeveloPassion</p>
      <h1 class="text-4xl md:text-5xl font-extrabold mt-3">Knowledge Base Statistics</h1>
      <p class="mt-4 max-w-2xl mx-auto" style="color:var(--muted)">
        A living window into <a href="https://notes.dsebastien.net">notes.dsebastien.net</a> —
        Sébastien Dubois' public Obsidian vault. ${vaultYears} years of daily knowledge work, measured.
      </p>
      <p class="mt-2 text-xs font-mono" style="color:var(--muted)">${stats.generated_at ? `Generated ${stats.generated_at} · updates automatically` : ""}</p>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-10">
        ${statCard("Notes", "0", "and growing daily", { countup: o.total_notes, accent: true })}
        ${statCard("Words", "0", `≈ ${o.books_equivalent.toFixed(0)} books`, { countup: o.total_words, accent: true })}
        ${statCard("Internal links", "0", `${o.links.internal.average} per note`, { countup: o.links.internal.count, accent: true })}
        ${statCard("Day streak", "0", `longest: ${fmt(streak.longest)} days`, { countup: streak.current, accent: true })}
      </div>
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
      <h2 class="section-title reveal"><span class="hash">#</span> Growth over time</h2>
      <div class="grid lg:grid-cols-2 gap-6 mt-6">
        <div class="card p-6 reveal">
          <h3 class="font-bold">Cumulative notes</h3>
          <p class="text-sm mb-4" style="color:var(--muted)">Every note ever created, stacked up month after month</p>
          <canvas id="growthChart" height="220" role="img" aria-label="Cumulative number of notes created per month"></canvas>
          ${dataTable("Cumulative notes by month", growthSeries)}
        </div>
        <div class="card p-6 reveal">
          <h3 class="font-bold">Notes published per month</h3>
          <p class="text-sm mb-4" style="color:var(--muted)">Additions to the public garden</p>
          <canvas id="publishedChart" height="220" role="img" aria-label="Notes published per month"></canvas>
          ${dataTable("Notes published by month", publishedMonthly)}
        </div>
      </div>
    </section>

    <!-- Activity heatmap -->
    <section class="mt-14">
      <h2 class="section-title reveal"><span class="hash">#</span> Creation activity — last 12 months</h2>
      <div class="card p-6 mt-6 reveal">
        ${buildHeatmap(activity.created_by_day)}
      </div>
    </section>

    ${ratio ? `
    <!-- Public vs private -->
    <section class="mt-14">
      <h2 class="section-title reveal"><span class="hash">#</span> Public by default</h2>
      <div class="card p-6 mt-6 reveal">
        <div class="flex flex-col md:flex-row md:items-center gap-6">
          <div class="text-center md:text-left shrink-0">
            <p class="text-5xl font-extrabold font-mono" style="color:var(--accent)">${ratio.percentage}%</p>
            <p class="text-sm mt-1" style="color:var(--muted)">of all notes are published</p>
          </div>
          <div class="flex-1">
            <div class="flex h-6 rounded overflow-hidden" style="gap:2px" role="img" aria-label="${fmt(ratio.public)} public notes versus ${fmt(ratio.private)} private notes">
              <div style="width:${ratio.percentage}%;background:var(--series-orange)"></div>
              <div class="flex-1" style="background:rgba(138,143,153,0.35)"></div>
            </div>
            <div class="flex justify-between text-sm mt-2" style="color:var(--muted)">
              <span><span class="inline-block w-2.5 h-2.5 rounded-sm mr-1.5" style="background:var(--series-orange)"></span>${fmt(ratio.public)} public notes</span>
              <span>${fmt(ratio.private)} private notes <span class="inline-block w-2.5 h-2.5 rounded-sm ml-1.5" style="background:rgba(138,143,153,0.35)"></span></span>
            </div>
            <p class="text-sm mt-3" style="color:var(--muted)">Learning in public: half of everything captured ends up freely readable by anyone.</p>
          </div>
        </div>
      </div>
    </section>` : ""}

    <!-- What's inside -->
    <section class="mt-14">
      <h2 class="section-title reveal"><span class="hash">#</span> What's inside</h2>
      <div class="grid lg:grid-cols-2 gap-6 mt-6">
        <div class="card p-6 reveal">
          <h3 class="font-bold mb-4">Notes by type <span class="text-sm font-normal" style="color:var(--muted)">(top 12)</span></h3>
          <div class="space-y-2.5">
            ${noteTypes.map(([, d]) => barRow(d.formatted_name.replace(/ Type$/, ""), d.count, maxType, "var(--series-indigo)")).join("")}
          </div>
        </div>
        <div class="flex flex-col gap-6">
          <div class="card p-6 reveal">
            <h3 class="font-bold mb-4">Note age distribution</h3>
            <div class="space-y-2.5">
              ${ageEntries.map(([k, v]) => barRow(AGE_LABELS[k] || k, v, maxAge, "var(--series-green)")).join("")}
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
      <h2 class="section-title reveal"><span class="hash">#</span> The AI layer</h2>
      <p class="mt-2 text-sm max-w-2xl reveal" style="color:var(--muted)">This vault is not just written — it is tended. A living AI team of agents and skills maintains, connects, and grows the knowledge base every day.</p>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        ${statCard("AI skills", "0", "specialized capabilities", { countup: ai.skills, accent: true })}
        ${statCard("AI agents", "0", "personas with memory", { countup: ai.agents, accent: true })}
        ${statCard("LLM wikis", "0", "AI-curated knowledge bases", { countup: ai.wikis, accent: true })}
      </div>
    </section>

    <!-- Rhythms -->
    <section class="mt-14">
      <h2 class="section-title reveal"><span class="hash">#</span> Rhythms</h2>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mt-6">
        ${PERIOD_ORDER.filter((k) => o.periodic_notes[k]).map((k) => {
          const d = o.periodic_notes[k];
          return statCard(`${k} notes`, fmt(d.count), `avg ${fmt(d.average_words)} words`);
        }).join("")}
      </div>
      <div class="card p-6 mt-6 reveal">
        <h3 class="font-bold">Journaling discipline</h3>
        <p class="text-sm mt-2" style="color:var(--muted)">
          Current daily-note streak: <strong style="color:var(--accent)">${fmt(streak.current)} days</strong> ·
          Longest streak ever: <strong style="color:var(--accent)">${fmt(streak.longest)} days</strong>
          ${streak.longest > 365 ? ` — that's ${(streak.longest / 365).toFixed(1)} years without missing a single day.` : ""}
        </p>
      </div>
    </section>

    <!-- Folders -->
    <section class="mt-14">
      <h2 class="section-title reveal"><span class="hash">#</span> Biggest knowledge areas</h2>
      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
        ${Object.entries(o.folders.top_folders).map(([folder, d]) => `
          <div class="card p-5 reveal">
            <h3 class="text-sm font-bold truncate" title="${folder}">${folder.split("/").pop()}</h3>
            <p class="text-xs truncate" style="color:var(--muted)">${folder}</p>
            <div class="grid grid-cols-3 gap-2 mt-3 text-center">
              <div><p class="text-lg font-mono font-semibold" style="color:var(--series-indigo)">${fmt(d.note_count)}</p><p class="text-xs" style="color:var(--muted)">notes</p></div>
              <div><p class="text-lg font-mono font-semibold" style="color:var(--series-indigo)">${fmt(d.words)}</p><p class="text-xs" style="color:var(--muted)">words</p></div>
              <div><p class="text-lg font-mono font-semibold" style="color:var(--series-indigo)">${d.growth_rate}</p><p class="text-xs" style="color:var(--muted)">new/month</p></div>
            </div>
          </div>`).join("")}
      </div>
    </section>

    <!-- Engine room -->
    <section class="mt-14">
      <h2 class="section-title reveal"><span class="hash">#</span> Engine room</h2>
      <div class="grid lg:grid-cols-2 gap-6 mt-6">
        <div class="card p-6 reveal">
          <h3 class="font-bold">Git commits per month</h3>
          <p class="text-sm mb-4" style="color:var(--muted)">Version-controlled knowledge — last 24 months</p>
          <canvas id="commitsChart" height="200" role="img" aria-label="Git commits per month over the last 24 months"></canvas>
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
      <h2 class="section-title reveal"><span class="hash">#</span> Freshness</h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
        ${["last_week", "last_month", "last_quarter", "last_year"].map((k) => {
          const d = o.content_age.updates[k];
          return statCard(`Updated ${k.replace("_", " ")}`, fmt(d.count), `${d.percentage}% of the vault`);
        }).join("")}
      </div>
    </section>
  </main>

  <footer class="border-t py-10" style="border-color:var(--border)">
    <div class="max-w-6xl mx-auto px-4 text-center text-sm" style="color:var(--muted)">
      <p>
        <a href="https://notes.dsebastien.net">Public notes</a> ·
        <a href="https://www.dsebastien.net">Blog</a> ·
        <a href="https://store.dsebastien.net">Store</a> ·
        <a href="https://github.com/dsebastien/kb-stats">Source</a>
      </p>
      <p class="mt-3">Rebuilt automatically from the vault by a Templater template + GitHub Actions. Crafted by <a href="https://www.dsebastien.net">Sébastien Dubois</a> / DeveloPassion.</p>
    </div>
  </footer>

  <script>
    var DATA = ${JSON.stringify(chartData)};
    var MUTED = "#8a8f99";
    var GRID = "rgba(247,243,236,0.06)";

    Chart.defaults.color = MUTED;
    Chart.defaults.font.family = '"Noto Sans", system-ui, sans-serif';
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.plugins.tooltip.backgroundColor = "#151a23";
    Chart.defaults.plugins.tooltip.borderColor = "rgba(247,243,236,0.15)";
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.titleColor = "#f7f3ec";
    Chart.defaults.plugins.tooltip.bodyColor = "#f7f3ec";

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
          borderColor: "#6273de",
          backgroundColor: "rgba(98,115,222,0.12)",
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
          borderColor: "#d9701f",
          backgroundColor: "rgba(217,112,31,0.12)",
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
