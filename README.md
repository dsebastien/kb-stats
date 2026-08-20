# kb-stats

Statistics about my public knowledge base, published at [stats.notes.dsebastien.net](https://stats.notes.dsebastien.net).

## How it works

1. The `TPL Stats` Templater template in my Obsidian vault gathers vault metrics, writes `Stats.md` (published via Obsidian Publish) and `stats.json`, then commits and pushes `stats.json` to this repository automatically.
2. The [build-and-deploy workflow](.github/workflows/build-and-deploy.yml) runs on every push of `stats.json`: it executes `node build.js` to render `index.html` and deploys it to GitHub Pages.

No manual steps: run the template in Obsidian, and the site updates itself.

## Local build

```bash
node build.js   # reads ./stats.json, writes ./index.html
```
