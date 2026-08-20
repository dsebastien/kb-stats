// Import required Node.js modules
const fs = require("fs");
const path = require("path");

// Function to format bytes
function formatBytes(bytes, decimals = 2) {
  if (!bytes) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// Function to format large numbers
function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

// Function to generate HTML content
function generateHtml(stats, outputFilePath) {
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Knowledge Base Stats</title>
  <meta name="description" content="Live statistics about the public knowledge base at notes.dsebastien.net">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📊</text></svg>">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
</head>
<body class="bg-gray-100 text-gray-800">
  <div class="container mx-auto p-4">
    <h1 class="text-3xl font-bold text-center mb-2">Knowledge Base Statistics</h1>
    <p class="text-center text-sm text-gray-500 mb-8">${stats.generated_at ? `Generated on ${stats.generated_at}` : ''}&nbsp;</p>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <!-- Overall Statistics -->
      <div class="bg-white p-6 shadow-lg rounded-lg">
        <h2 class="text-2xl font-semibold mb-4 text-gray-700 border-b pb-2">Overall Metrics</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          ${[
            ['Total Notes', fmt(stats.overall.total_notes)],
            ['Average Note Age', stats.overall.content_age.average_days.formatted || 'n/a'],
            ['Oldest Note', stats.overall.content_age.oldest_note.formatted, null, stats.overall.content_age.oldest_note.date],
            ['Newest Note', stats.overall.content_age.newest_note.formatted || '0 days', null, stats.overall.content_age.newest_note.date],
            ['Total Words', fmt(stats.overall.total_words), null, stats.overall.reading_time.formatted],
            ['Books Equivalent', stats.overall.books_equivalent.toFixed(1)],
            ['Internal Links', fmt(stats.overall.links.internal.count), null, `${stats.overall.links.internal.average} per note`],
            ['External Links', fmt(stats.overall.links.external.count), null, `${stats.overall.links.external.average} per note`],
            ['Maps of Content', fmt(stats.overall.mocs.count), null, `${stats.overall.mocs.average_links} links/MOC`],
            ...(stats.overall.people_notes ? [['People Notes', fmt(stats.overall.people_notes.count), null, `${stats.overall.people_notes.average_links} links per note`]] : []),
            ['Voice Notes', stats.overall.voice_notes],
            ['Total Tasks', fmt(stats.overall.total_tasks)],
            ['Total Folders', fmt(stats.overall.folders.count)]
          ].map(([label, value, type, subtext]) => `
            <div class="p-4 bg-gray-50 rounded-lg">
              <h3 class="text-center text-lg font-semibold">${label}</h3>
              <p class="text-center text-4xl font-bold text-blue-500 mt-2">${value}</p>
              ${subtext ? `<p class="text-center text-sm text-gray-600 mt-1">${subtext}</p>` : ''}
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Content Updates -->
      <div class="bg-white p-6 shadow-lg rounded-lg">
        <h2 class="text-2xl font-semibold mb-4 text-gray-700 border-b pb-2">Content Updates</h2>
        <div class="grid grid-cols-2 gap-4">
          ${['this_year', 'last_week', 'last_month', 'last_quarter', 'last_year'].map(period => `
            <div class="p-4 bg-gray-50 rounded-lg">
              <h3 class="text-center text-lg font-semibold">${period === 'this_year' ? 'This Year' : 
                'Last ' + period.split('_')[1].charAt(0).toUpperCase() + period.split('_')[1].slice(1)}</h3>
              <p class="text-center text-4xl font-bold text-blue-500 mt-2">${stats.overall.content_age.updates[period].count}</p>
              <p class="text-center text-sm text-gray-600 mt-1">${stats.overall.content_age.updates[period].percentage}%</p>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Notes by Type -->
      <div class="bg-white p-6 shadow-lg rounded-lg">
        <h2 class="text-2xl font-semibold mb-4 text-gray-700 border-b pb-2">Notes by Type</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
          ${Object.entries(stats.overall.note_types).map(([type, data]) => `
            <div class="p-4 bg-gray-50 rounded-lg">
              <h3 class="text-center text-lg font-semibold">${data.formatted_name}</h3>
              <p class="text-center text-4xl font-bold text-blue-500 mt-2">${data.count}</p>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Tag Cloud -->
      <div class="bg-white p-6 shadow-lg rounded-lg">
        <h2 class="text-2xl font-semibold mb-4 text-gray-700 border-b pb-2">Tag Cloud</h2>
        <div class="flex flex-wrap gap-2 justify-center">
          ${[
            ...Object.entries(stats.overall.note_types).map(([type, data]) => ({
              name: data.formatted_name,
              count: data.count,
              isType: true
            })),
            ...Object.entries(stats.publication.topics).map(([topic, data]) => ({
              name: data.formatted_name,
              count: data.count,
              isType: false
            }))
          ]
            .sort((a, b) => b.count - a.count)
            .map((tag, _, arr) => {
              // Get max count for normalization
              const maxCount = arr[0].count;
              // Normalize count between 0 and 1
              const normalizedCount = tag.count / maxCount;
              // Scale font size between 0.8rem and 2.5rem using a logarithmic scale
              const fontSize = 0.8 + (1.7 * Math.log1p(normalizedCount));
              // Scale opacity between 0.6 and 1
              const opacity = 0.6 + (0.4 * normalizedCount);
              return `
                <span class="px-2 py-1 rounded ${tag.isType ? 'bg-blue-100' : 'bg-green-100'}" 
                      style="font-size: ${fontSize}rem; opacity: ${opacity};">
                  ${tag.name}
                  <span class="text-xs ml-1 text-gray-500">${tag.count}</span>
                </span>
              `;
            }).join('')}
        </div>
      </div>

      <!-- Topics -->
      <div class="bg-white p-6 shadow-lg rounded-lg col-span-1 lg:col-span-2">
        <h2 class="text-2xl font-semibold mb-4 text-gray-700 border-b pb-2">Topics</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${Object.entries(stats.publication.topics).map(([topic, data]) => `
            <div class="p-4 bg-gray-50 rounded-lg">
              <h3 class="text-lg font-semibold mb-2 text-center">${data.formatted_name}</h3>
              <p class="text-center text-3xl font-bold text-blue-500">${data.count}</p>
              <p class="text-center text-sm text-gray-600 mt-1">${data.growth_rate}/month</p>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Folders -->
      <div class="bg-white p-6 shadow-lg rounded-lg col-span-1 lg:col-span-2">
        <h2 class="text-2xl font-semibold mb-4 text-gray-700 border-b pb-2">Top Folders</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${Object.entries(stats.overall.folders.top_folders).map(([folder, data]) => `
            <div class="p-4 bg-gray-50 rounded-lg">
              <h3 class="text-lg font-semibold mb-2 text-center">${folder}</h3>
              <div class="grid grid-cols-3 gap-2">
                <div class="text-center">
                  <p class="text-gray-600 text-sm">Notes</p>
                  <p class="text-xl font-bold text-blue-500">${data.note_count}</p>
                </div>
                <div class="text-center">
                  <p class="text-gray-600 text-sm">Words</p>
                  <p class="text-xl font-bold text-blue-500">${fmt(data.words)}</p>
                </div>
                <div class="text-center">
                  <p class="text-gray-600 text-sm">Links</p>
                  <p class="text-xl font-bold text-blue-500">${fmt(data.internal_links)}</p>
                </div>
              </div>
              <div class="mt-2 text-sm text-gray-600 text-center">
                Reading: ${data.reading_time.formatted}<br>
                Books: ${data.books_equivalent}<br>
                Growth: ${data.growth_rate}/month
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Tags -->
      <div class="bg-white p-6 shadow-lg rounded-lg">
        <h2 class="text-2xl font-semibold mb-4 text-gray-700 border-b pb-2">Tags</h2>
        <div class="grid grid-cols-2 gap-4">
          <div class="p-4 bg-gray-50 rounded-lg">
            <h3 class="text-center text-lg font-semibold">Total Unique Tags</h3>
            <p class="text-center text-4xl font-bold text-blue-500 mt-2">${stats.overall.tags.total}</p>
          </div>
          <div class="p-4 bg-gray-50 rounded-lg">
            <h3 class="text-center text-lg font-semibold">Notes Under Areas</h3>
            <p class="text-center text-4xl font-bold text-blue-500 mt-2">${stats.overall.tags.total_area_notes}</p>
          </div>
          <div class="p-4 bg-gray-50 rounded-lg">
            <h3 class="text-center text-lg font-semibold">Notes Without Tags</h3>
            <p class="text-center text-4xl font-bold text-blue-500 mt-2">${stats.overall.tags.notes_without_tags.count}</p>
            <p class="text-center text-sm text-gray-600 mt-1">${stats.overall.tags.notes_without_tags.percentage}%</p>
          </div>
          <div class="p-4 bg-gray-50 rounded-lg">
            <h3 class="text-center text-lg font-semibold">Average Tags per Note</h3>
            <p class="text-center text-4xl font-bold text-blue-500 mt-2">${stats.overall.tags.average_per_note}</p>
          </div>
        </div>
      </div>

      <!-- Periodic Notes -->
      <div class="bg-white p-6 shadow-lg rounded-lg">
        <h2 class="text-2xl font-semibold mb-4 text-gray-700 border-b pb-2">Periodic Notes</h2>
        <div class="grid grid-cols-1 gap-4">
          ${Object.entries(stats.overall.periodic_notes).map(([period, data]) => `
            <div class="p-4 bg-gray-50 rounded-lg">
              <h3 class="text-xl font-semibold mb-2">${period.charAt(0).toUpperCase() + period.slice(1)} Notes</h3>
              <div class="grid grid-cols-3 gap-4">
                <div class="text-center">
                  <p class="text-gray-600">Count</p>
                  <p class="text-2xl font-bold text-blue-500">${data.count}</p>
                </div>
                <div class="text-center">
                  <p class="text-gray-600">Words</p>
                  <p class="text-2xl font-bold text-blue-500">${fmt(data.words)}</p>
                </div>
                <div class="text-center">
                  <p class="text-gray-600">Avg Words</p>
                  <p class="text-2xl font-bold text-blue-500">${fmt(data.average_words)}</p>
                </div>
              </div>
              <div class="mt-2 text-sm text-gray-600 text-center">
                Reading Time: ${data.reading_time.formatted}<br>
                Books Equivalent: ${data.books_equivalent}
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Special Files -->
      <div class="bg-white p-6 shadow-lg rounded-lg">
        <h2 class="text-2xl font-semibold mb-4 text-gray-700 border-b pb-2">Special Files</h2>
        <div class="grid grid-cols-2 gap-4">
          <div class="p-4 bg-gray-50 rounded-lg">
            <h3 class="text-center text-lg font-semibold">Canvas Files</h3>
            <p class="text-center text-4xl font-bold text-blue-500 mt-2">${stats.overall.special_files.canvases}</p>
          </div>
          <div class="p-4 bg-gray-50 rounded-lg">
            <h3 class="text-center text-lg font-semibold">Templates</h3>
            <p class="text-center text-4xl font-bold text-blue-500 mt-2">${stats.overall.special_files.templates}</p>
          </div>
          <div class="p-4 bg-gray-50 rounded-lg">
            <h3 class="text-center text-lg font-semibold">Public Attachments</h3>
            <p class="text-center text-4xl font-bold text-blue-500 mt-2">${stats.overall.special_files.attachments.public}</p>
          </div>
          <div class="p-4 bg-gray-50 rounded-lg">
            <h3 class="text-center text-lg font-semibold">Private Attachments</h3>
            <p class="text-center text-4xl font-bold text-blue-500 mt-2">${stats.overall.special_files.attachments.private}</p>
          </div>
        </div>
      </div>

      <!-- Vault Size -->
      <div class="bg-white p-6 shadow-lg rounded-lg">
        <h2 class="text-2xl font-semibold mb-4 text-gray-700 border-b pb-2">Vault Size</h2>
        <div class="grid grid-cols-2 gap-4">
          <div class="p-4 bg-gray-50 rounded-lg">
            <h3 class="text-center text-lg font-semibold">Total Size</h3>
            <p class="text-center text-4xl font-bold text-blue-500 mt-2">${formatBytes(stats.overall.size.total_bytes)}</p>
          </div>
          <div class="p-4 bg-gray-50 rounded-lg">
            <h3 class="text-center text-lg font-semibold">Markdown Files</h3>
            <p class="text-center text-4xl font-bold text-blue-500 mt-2">${formatBytes(stats.overall.size.md_files_bytes)}</p>
          </div>
          <div class="p-4 bg-gray-50 rounded-lg">
            <h3 class="text-center text-lg font-semibold">Attachments</h3>
            <p class="text-center text-4xl font-bold text-blue-500 mt-2">${formatBytes(stats.overall.size.attachments_bytes)}</p>
          </div>
          <div class="p-4 bg-gray-50 rounded-lg">
            <h3 class="text-center text-lg font-semibold">Git Commits</h3>
            <p class="text-center text-4xl font-bold text-blue-500 mt-2">${fmt(stats.overall.size.git_commits)}</p>
          </div>
        </div>
      </div>

      <!-- Public Notes Metrics -->
      <div class="bg-white p-6 shadow-lg rounded-lg col-span-1 lg:col-span-2">
        <h2 class="text-2xl font-semibold mb-4 text-gray-700 border-b pb-2">Public Notes Metrics</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div class="p-4 bg-gray-50 rounded-lg">
            <h3 class="text-center text-lg font-semibold">Total Published</h3>
            <p class="text-center text-4xl font-bold text-blue-500 mt-2">${fmt(stats.publication.total_published)}</p>
          </div>
          <div class="p-4 bg-gray-50 rounded-lg">
            <h3 class="text-center text-lg font-semibold">Published Words</h3>
            <p class="text-center text-4xl font-bold text-blue-500 mt-2">${fmt(stats.publication.published_words)}</p>
            <p class="text-center text-sm text-gray-600 mt-1">${stats.publication.reading_time.formatted}</p>
          </div>
          <div class="p-4 bg-gray-50 rounded-lg">
            <h3 class="text-center text-lg font-semibold">Books Equivalent</h3>
            <p class="text-center text-4xl font-bold text-blue-500 mt-2">${stats.publication.books_equivalent.toFixed(1)}</p>
          </div>
          ${Object.entries(stats.publication.published_by_year).map(([year, count]) => `
            <div class="p-4 bg-gray-50 rounded-lg">
              <h3 class="text-center text-lg font-semibold">${year} Published</h3>
              <p class="text-center text-4xl font-bold text-blue-500 mt-2">${count}</p>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Published by Month Graph -->
      <div class="bg-white p-6 shadow-lg rounded-lg col-span-1 lg:col-span-2">
        <h2 class="text-2xl font-semibold mb-4 text-gray-700 border-b pb-2">Published by Month</h2>
        <canvas id="publishedByMonth"></canvas>
      </div>
    </div>
  </div>

  <script>
    const publishedByMonthData = Object.entries(${JSON.stringify(stats.publication.published_by_month)})
      .sort(([a], [b]) => new Date(a) - new Date(b));

    const ctx = document.getElementById('publishedByMonth').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: publishedByMonthData.map(([month]) => month),
        datasets: [{
          label: 'Published Notes',
          data: publishedByMonthData.map(([, count]) => count),
          borderColor: 'rgba(59, 130, 246, 0.8)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top' },
          title: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1 }
          }
        }
      }
    });
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
}
