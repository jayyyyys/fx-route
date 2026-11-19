# FX Comparison dashboard

Static HTML/CSS/JS. No build step, no API keys. Keep all files in one folder.

| File | Role |
|---|---|
| `index.html` | Dashboard shell: sidebar, top bar, all views |
| `fx-app.js` | Dashboard UI logic (views, charts, guide, shortcuts) |
| `fx-core.js` | Engine: sources, consensus mid, routes, fees, self-check |
| `fx-inputs.html` | Rates & assumptions (providers, fees, risk, import/export) |
| `fx-theme.css` | Shared light/dark theme |

## Run locally
Open `index.html` in a browser, or serve the folder: `python -m http.server 8000` then go to http://localhost:8000.

## Publish (GitHub Pages)
Push the folder to a repo → Settings → Pages → Deploy from branch `main` / root.

## Data sources (all keyless, browser-callable)
Frankfurter v2 (central-bank blend + BNM + history), fawazahmed0 currency-api, ExchangeRate-API open access (attribution link required, kept in the footer), FloatRates, Coinbase fiat reference rates (the only intraday source). Each source is called no more often than it updates (see `minMs` in `fx-core.js`).

Demo and educational use only. Not financial advice.
