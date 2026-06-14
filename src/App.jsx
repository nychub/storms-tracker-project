import React, { useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_LOCATION = { lat: 39.7456, lon: -97.0892, label: 'Central Kansas' };
const NASA_EONET = 'https://eonet.gsfc.nasa.gov/api/v3/events?category=severeStorms&status=open&limit=12&days=30';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const FAVORITES_KEY = 'storms-tracker:favorites:v1';
const LAST_LOCATION_KEY = 'storms-tracker:last-location:v1';

const severityStyles = {
  Extreme: 'bg-rose-500/15 text-rose-100 ring-1 ring-rose-400/30',
  Severe: 'bg-orange-500/15 text-orange-100 ring-1 ring-orange-400/30',
  Moderate: 'bg-yellow-500/15 text-yellow-100 ring-1 ring-yellow-400/30',
  Minor: 'bg-emerald-500/15 text-emerald-100 ring-1 ring-emerald-400/30',
  Unknown: 'bg-slate-500/15 text-slate-200 ring-1 ring-slate-400/30',
};

const statusPill = {
  loading: 'bg-sky-500/15 text-sky-100 ring-1 ring-sky-400/30',
  live: 'bg-emerald-500/15 text-emerald-100 ring-1 ring-emerald-400/30',
  error: 'bg-rose-500/15 text-rose-100 ring-1 ring-rose-400/30',
};

const alertFilters = ['All', 'Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];

function fmtTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function fmtDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function isLikelyLatLon(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function pickSeverity(alert) {
  const sev = (alert?.properties?.severity || 'Unknown').trim();
  return severityStyles[sev] ? sev : 'Unknown';
}

function metricValue(text) {
  if (!text) return null;
  const match = String(text).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function storageGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures in private mode or blocked environments.
  }
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/geo+json, application/json;q=0.9, */*;q=0.8',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 180)}` : ''}`);
  }

  return res.json();
}

function StatCard({ label, value, subtext }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg shadow-slate-950/20 backdrop-blur">
      <div className="text-xs uppercase tracking-[0.24em] text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      {subtext ? <div className="mt-1 text-sm text-slate-300">{subtext}</div> : null}
    </div>
  );
}

function SectionTitle({ title, subtitle, action }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

function badgeTone(label) {
  if (label === 'Extreme') return 'bg-rose-500/15 text-rose-100 ring-1 ring-rose-400/30';
  if (label === 'Severe') return 'bg-orange-500/15 text-orange-100 ring-1 ring-orange-400/30';
  if (label === 'Moderate') return 'bg-yellow-500/15 text-yellow-100 ring-1 ring-yellow-400/30';
  if (label === 'Minor') return 'bg-emerald-500/15 text-emerald-100 ring-1 ring-emerald-400/30';
  return 'bg-slate-500/15 text-slate-200 ring-1 ring-slate-400/30';
}

function LoadingCard() {
  return <div className="h-28 animate-pulse rounded-3xl border border-white/10 bg-white/5" />;
}

export default function StormTrackerApp() {
  const initialLocation = storageGet(LAST_LOCATION_KEY, DEFAULT_LOCATION);

  const [latInput, setLatInput] = useState(String(initialLocation.lat));
  const [lonInput, setLonInput] = useState(String(initialLocation.lon));
  const [locationLabel, setLocationLabel] = useState(initialLocation.label || DEFAULT_LOCATION.label);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [favorites, setFavorites] = useState(() => storageGet(FAVORITES_KEY, []));

  const [point, setPoint] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [hourly, setHourly] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [events, setEvents] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);

  const controllerRef = useRef(null);
  const refreshTimerRef = useRef(null);

  const currentPeriod = forecast?.properties?.periods?.[0];
  const nextPeriods = useMemo(() => forecast?.properties?.periods?.slice(0, 6) || [], [forecast]);
  const hourlySlice = useMemo(() => hourly?.properties?.periods?.slice(0, 12) || [], [hourly]);

  const filteredAlerts = useMemo(() => {
    let list = alerts;
    if (selectedFilter !== 'All') {
      list = list.filter((alert) => pickSeverity(alert) === selectedFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((alert) => {
        const p = alert.properties || {};
        return [p.headline, p.event, p.description, p.instruction]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      });
    }

    return list;
  }, [alerts, searchQuery, selectedFilter]);

  const severeCount = alerts.filter((a) => ['Extreme', 'Severe'].includes(pickSeverity(a))).length;
  const advisoryCount = alerts.length - severeCount;
  const activeStormEvents = events.length;

  async function loadStormData(lat, lon, label = locationLabel) {
    if (!isLikelyLatLon(lat, lon)) {
      throw new Error('Enter a valid latitude and longitude.');
    }

    if (controllerRef.current) {
      controllerRef.current.abort();
    }

    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setStatus('loading');
    setError('');

    try {
      const pointData = await fetchJson(`https://api.weather.gov/points/${lat},${lon}`, { signal: controller.signal });
      const props = pointData?.properties || {};
      const rel = props.relativeLocation?.properties || {};
      const stateCode = rel.state || props.state || null;
      const city = rel.city || label || 'Selected location';
      const forecastUrl = props.forecast;
      const hourlyUrl = props.forecastHourly;

      const requests = [
        forecastUrl ? fetchJson(forecastUrl, { signal: controller.signal }) : Promise.resolve(null),
        hourlyUrl ? fetchJson(hourlyUrl, { signal: controller.signal }) : Promise.resolve(null),
        stateCode ? fetchJson(`https://api.weather.gov/alerts/active?area=${stateCode}`, { signal: controller.signal }) : Promise.resolve({ features: [] }),
        fetchJson(NASA_EONET, { signal: controller.signal }),
      ];

      const [forecastData, hourlyData, alertData, eonetData] = await Promise.all(requests);

      setPoint(pointData);
      setForecast(forecastData);
      setHourly(hourlyData);
      setAlerts(alertData?.features || []);
      setEvents(eonetData?.events || eonetData?.features || []);
      setLocationLabel(`${city}${stateCode ? `, ${stateCode}` : ''}`);
      setLastUpdated(new Date());
      setStatus('live');
      storageSet(LAST_LOCATION_KEY, { lat, lon, label: `${city}${stateCode ? `, ${stateCode}` : ''}` });
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Something went wrong while loading storm data.');
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadStormData(Number(latInput), Number(lonInput), locationLabel).catch(() => {});
    return () => {
      controllerRef.current?.abort();
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    if (!autoRefresh) return undefined;

    refreshTimerRef.current = setInterval(() => {
      loadStormData(Number(latInput), Number(lonInput), locationLabel).catch(() => {});
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(refreshTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, latInput, lonInput, locationLabel]);

  function handleSearchSubmit(e) {
    e.preventDefault();
    loadStormData(Number(latInput), Number(lonInput), 'Pinned location').catch(() => {});
  }

  function handleUseMyLocation() {
    if (!navigator.geolocation) {
      setError('Your browser does not support geolocation.');
      setStatus('error');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(4));
        const lon = Number(pos.coords.longitude.toFixed(4));
        setLatInput(String(lat));
        setLonInput(String(lon));
        loadStormData(lat, lon, 'Current location').catch(() => {});
      },
      (geoErr) => {
        setError(geoErr.message || 'Unable to get your location.');
        setStatus('error');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  function handleManualRefresh() {
    loadStormData(Number(latInput), Number(lonInput), locationLabel).catch(() => {});
  }

  function saveFavorite() {
    const next = [
      ...favorites,
      {
        lat: Number(latInput),
        lon: Number(lonInput),
        label: locationLabel || 'Saved location',
      },
    ]
      .filter((item) => isLikelyLatLon(item.lat, item.lon))
      .filter((item, index, arr) => arr.findIndex((f) => f.lat === item.lat && f.lon === item.lon) === index)
      .slice(0, 6);

    setFavorites(next);
    storageSet(FAVORITES_KEY, next);
  }

  function loadFavorite(favorite) {
    setLatInput(String(favorite.lat));
    setLonInput(String(favorite.lon));
    setLocationLabel(favorite.label);
    loadStormData(favorite.lat, favorite.lon, favorite.label).catch(() => {});
  }

  function removeFavorite(target) {
    const next = favorites.filter((favorite) => !(favorite.lat === target.lat && favorite.lon === target.lon));
    setFavorites(next);
    storageSet(FAVORITES_KEY, next);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-sky-950 shadow-2xl shadow-black/30">
          <div className="relative px-6 py-8 sm:px-10 sm:py-10">
            <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.25),transparent_22%),radial-gradient(circle_at_80%_0%,rgba(244,63,94,0.18),transparent_18%),radial-gradient(circle_at_80%_80%,rgba(34,197,94,0.12),transparent_20%)]" />

            <div className="relative flex flex-col gap-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.28em] text-slate-300">
                    Storms Tracker
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusPill[status] || statusPill.loading}`}>
                      {status}
                    </span>
                  </div>
                  <h1 className="mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl">Live storm alerts, forecasts, and NASA event tracking.</h1>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                    Built with the official NWS API for forecasts and active alerts, plus NASA EONET for open storm events.
                    Search by coordinates, use your current location, or save favorite places to revisit later.
                  </p>
                </div>

                <div className="grid gap-3 sm:min-w-[260px] sm:grid-cols-2 lg:grid-cols-1">
                  <StatCard label="Active alerts" value={alerts.length} subtext={`${severeCount} severe or extreme`} />
                  <StatCard label="EONET storm events" value={activeStormEvents} subtext="Open severe storm items" />
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
                <div className="rounded-3xl border border-white/10 bg-black/20 p-4 sm:p-6">
                  <form onSubmit={handleSearchSubmit} className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
                    <label className="block">
                      <span className="mb-1 block text-xs uppercase tracking-[0.24em] text-slate-400">Latitude</span>
                      <input
                        value={latInput}
                        onChange={(e) => setLatInput(e.target.value)}
                        inputMode="decimal"
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-sky-400/60"
                        placeholder="39.7456"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs uppercase tracking-[0.24em] text-slate-400">Longitude</span>
                      <input
                        value={lonInput}
                        onChange={(e) => setLonInput(e.target.value)}
                        inputMode="decimal"
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-sky-400/60"
                        placeholder="-97.0892"
                      />
                    </label>
                    <button type="submit" className="rounded-2xl bg-sky-500 px-5 py-3 font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-400">
                      Track location
                    </button>
                    <button type="button" onClick={handleUseMyLocation} className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white transition hover:bg-white/10">
                      Use my location
                    </button>
                  </form>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleManualRefresh}
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
                    >
                      Refresh now
                    </button>
                    <button
                      type="button"
                      onClick={() => setAutoRefresh((value) => !value)}
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
                    >
                      Auto-refresh: {autoRefresh ? 'On' : 'Off'}
                    </button>
                    <button
                      type="button"
                      onClick={saveFavorite}
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
                    >
                      Save location
                    </button>
                  </div>

                  <div className="mt-5 grid gap-4 sm:grid-cols-3">
                    <StatCard label="Tracked area" value={locationLabel} subtext={point?.properties?.cwa || 'NWS local forecast office'} />
                    <StatCard
                      label="Radar zone"
                      value={point?.properties?.gridId || 'NWS grid'}
                      subtext={point?.properties?.forecastOffice ? `${point.properties.forecastOffice} office` : 'Forecast grid from /points'}
                    />
                    <StatCard label="Updated" value={lastUpdated ? fmtTime(lastUpdated) : '—'} subtext={loading ? 'Refreshing now' : 'Last successful refresh'} />
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/20 p-4 sm:p-6">
                  <SectionTitle title="Current conditions" subtitle="From the NWS forecast endpoint for the selected point." />
                  <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-4">
                    <div className="text-sm text-slate-300">{currentPeriod?.name || 'Loading forecast...'}</div>
                    <div className="mt-2 text-3xl font-semibold text-white">
                      {currentPeriod?.temperature != null ? `${currentPeriod.temperature}°${currentPeriod.temperatureUnit || 'F'}` : '—'}
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      {currentPeriod?.detailedForecast || 'Forecast details will appear here once the API loads.'}
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-300">
                      <div className="rounded-2xl bg-slate-950/50 p-3">
                        <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Wind</div>
                        <div className="mt-1 font-medium text-white">{currentPeriod?.windSpeed || '—'}</div>
                      </div>
                      <div className="rounded-2xl bg-slate-950/50 p-3">
                        <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Chance of rain</div>
                        <div className="mt-1 font-medium text-white">
                          {currentPeriod?.probabilityOfPrecipitation?.value != null ? `${currentPeriod.probabilityOfPrecipitation.value}%` : '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {favorites.length ? (
                <div className="rounded-3xl border border-white/10 bg-black/20 p-4 sm:p-6">
                  <SectionTitle title="Saved locations" subtitle="Click one to reload its forecast and alerts." />
                  <div className="mt-4 flex flex-wrap gap-3">
                    {favorites.map((favorite) => (
                      <div key={`${favorite.lat}-${favorite.lon}`} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100">
                        <button type="button" className="font-medium hover:text-sky-300" onClick={() => loadFavorite(favorite)}>
                          {favorite.label}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFavorite(favorite)}
                          className="rounded-full px-2 py-0.5 text-xs text-slate-400 transition hover:bg-white/10 hover:text-white"
                          aria-label={`Remove ${favorite.label}`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {error ? <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}
            </div>
          </div>

          <div className="grid gap-6 border-t border-white/10 bg-slate-950/40 px-6 py-8 sm:px-10 xl:grid-cols-2">
            <section className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/20">
              <SectionTitle
                title="Active alerts"
                subtitle={stateAlertSubtitle(point, alerts.length)}
                action={<div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">{severeCount} severe · {advisoryCount} lower-level</div>}
              />

              <div className="mt-4 flex flex-wrap gap-2">
                {alertFilters.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setSelectedFilter(filter)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      selectedFilter === filter ? 'bg-sky-500 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>

              <div className="mt-4">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search alerts by text..."
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-sky-400/60"
                />
              </div>

              <div className="mt-5 space-y-3">
                {loading && !alerts.length ? (
                  <div className="space-y-3">
                    <LoadingCard />
                    <LoadingCard />
                    <LoadingCard />
                  </div>
                ) : filteredAlerts.length ? (
                  filteredAlerts.map((alert) => {
                    const p = alert.properties || {};
                    const sev = pickSeverity(alert);
                    return (
                      <article key={p.id || p.sent || p.event || p.headline} className="rounded-3xl border border-white/10 bg-slate-950/50 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${severityStyles[sev]}`}>{sev}</div>
                            <h3 className="mt-2 text-base font-semibold text-white">{p.headline || p.event || 'Weather alert'}</h3>
                            <div className="mt-1 text-sm text-slate-400">Issued {fmtTime(p.sent)} · Expires {fmtTime(p.effective || p.expires)}</div>
                          </div>
                          {p.instruction ? (
                            <div className="max-w-xs rounded-2xl border border-sky-400/20 bg-sky-500/10 p-3 text-xs leading-5 text-sky-50">{p.instruction}</div>
                          ) : null}
                        </div>
                        {p.description ? <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-300">{p.description}</p> : null}
                      </article>
                    );
                  })
                ) : (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/30 p-8 text-center text-sm text-slate-400">
                    No alerts match the current filter.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/20">
              <SectionTitle title="NASA storm events" subtitle="Open EONET severe-storm events, updated near real time." />
              <div className="mt-5 space-y-3">
                {loading && !events.length ? (
                  <div className="space-y-3">
                    <LoadingCard />
                    <LoadingCard />
                  </div>
                ) : events.length ? (
                  events.slice(0, 8).map((event) => {
                    const props = event.properties || event;
                    const category = Array.isArray(props.categories) ? props.categories[0] : props.categories?.[0] || props.categories || 'Storm';
                    const latestGeometry = Array.isArray(event.geometry) ? event.geometry[event.geometry.length - 1] : null;
                    return (
                      <article key={props.id || props.link || props.title} className="rounded-3xl border border-white/10 bg-slate-950/50 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="inline-flex rounded-full bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-100 ring-1 ring-cyan-400/30">
                              {String(category).replace(/([A-Z])/g, ' $1').trim()}
                            </div>
                            <h3 className="mt-2 text-base font-semibold text-white">{props.title || 'Storm event'}</h3>
                            <div className="mt-1 text-sm text-slate-400">
                              {fmtDate(latestGeometry?.date || props.date)} · {props.closed ? `Closed ${fmtDate(props.closed)}` : 'Open event'}
                            </div>
                          </div>
                          {props.magnitudeValue ? (
                            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-right text-xs text-slate-300">
                              <div className="uppercase tracking-[0.22em] text-slate-500">Magnitude</div>
                              <div className="mt-1 text-base font-semibold text-white">
                                {props.magnitudeValue} {props.magnitudeUnit || ''}
                              </div>
                            </div>
                          ) : null}
                        </div>
                        {props.description ? <p className="mt-3 text-sm leading-6 text-slate-300">{props.description}</p> : null}
                      </article>
                    );
                  })
                ) : (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/30 p-8 text-center text-sm text-slate-400">
                    No open NASA severe storm events are available right now.
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="grid gap-6 border-t border-white/10 bg-slate-950/40 px-6 py-8 sm:px-10 xl:grid-cols-2">
            <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <SectionTitle title="Next 6 forecast periods" subtitle="Quick glance from the NWS point forecast." />
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {loading && !nextPeriods.length ? (
                  <>
                    <LoadingCard />
                    <LoadingCard />
                    <LoadingCard />
                    <LoadingCard />
                  </>
                ) : nextPeriods.length ? (
                  nextPeriods.map((period) => (
                    <article key={period.number} className="rounded-3xl border border-white/10 bg-slate-950/50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">{period.name}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">{period.isDaytime ? 'Day' : 'Night'} · {fmtDate(period.startTime)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-semibold text-white">{period.temperature != null ? `${period.temperature}°` : '—'}</div>
                          <div className="text-xs text-slate-400">{period.temperatureUnit || ''}</div>
                        </div>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-300">{period.shortForecast}</p>
                    </article>
                  ))
                ) : (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/30 p-8 text-sm text-slate-400">Forecast periods will appear here once the API responds.</div>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <SectionTitle title="Hourly trend" subtitle="A compact look at the next 12 hours." />
              <div className="mt-5 space-y-3">
                {loading && !hourlySlice.length ? (
                  <div className="space-y-3">
                    <LoadingCard />
                    <LoadingCard />
                  </div>
                ) : hourlySlice.length ? (
                  hourlySlice.map((hour) => {
                    const precip = hour.probabilityOfPrecipitation?.value;
                    const temperature = hour.temperature;
                    const pressure = metricValue(hour.pressure?.value) || metricValue(hour.pressureTrend);
                    return (
                      <div key={hour.number} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-white">{fmtTime(hour.startTime)}</div>
                            <div className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">{hour.shortForecast}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xl font-semibold text-white">{temperature != null ? `${temperature}°` : '—'}</div>
                            <div className="text-xs text-slate-400">{hour.temperatureUnit || ''}</div>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-300">
                          <div className="rounded-xl bg-white/5 px-3 py-2">Rain {precip != null ? `${precip}%` : '—'}</div>
                          <div className="rounded-xl bg-white/5 px-3 py-2">Wind {hour.windSpeed || '—'}</div>
                          <div className="rounded-xl bg-white/5 px-3 py-2">Pressure {pressure != null ? `${pressure}` : '—'}</div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/30 p-8 text-sm text-slate-400">Hourly details will appear here once loaded.</div>
                )}
              </div>
            </section>
          </div>
        </div>

        <div className="mt-5 text-xs leading-5 text-slate-500">
          Data sources: National Weather Service API and NASA EONET. The app uses browser geolocation when allowed, and it stores saved locations locally in your browser only.
        </div>
      </div>
    </div>
  );
}

function stateAlertSubtitle(point, alertCount) {
  const props = point?.properties || {};
  const rel = props.relativeLocation?.properties || {};
  const state = rel.state || props.state;
  const city = rel.city || 'the selected location';
  if (!alertCount) return `No active warnings found near ${city}${state ? `, ${state}` : ''}.`;
  return `${alertCount} active alert${alertCount === 1 ? '' : 's'} near ${city}${state ? `, ${state}` : ''}.`;
}
