# Storms Tracker

A polished React + Vite weather dashboard that combines the **National Weather Service API** and **NASA EONET** to show live storm alerts, point forecasts, and open severe storm events.

## Highlights

- Search by latitude/longitude or use browser geolocation
- Live NWS forecast, hourly trend, and active alert cards
- NASA EONET severe-storm event feed
- Saved locations stored locally in the browser
- Auto-refresh, manual refresh, filtering, and search
- Responsive dark UI that works well as a public GitHub repo showcase

## Tech Stack

- React
- Vite
- Tailwind CSS
- National Weather Service API
- NASA EONET v3

## Run locally

```bash
npm install
npm run dev
```

## Build for production

```bash
npm run build
```

## Notes for GitHub

Before publishing the repository:

- Make sure no API keys or secrets are committed
- Add a screenshot to the README if you want the repo to look more complete
- If you deploy the app, add the live demo link near the top of this file

## Data sources

- NWS API documentation: https://www.weather.gov/documentation/services-web-api
- NWS alerts documentation: https://www.weather.gov/documentation/services-web-alerts
- NASA EONET: https://eonet.gsfc.nasa.gov/
