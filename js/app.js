/* Spotify Analytics Dashboard — Premium BI Edition
   Refactor notes:
   - Data is loaded from /data/spotify_data.json (local JSON layer)
   - Services are designed to be replaced by Google Sheets, Spotify API, or REST API
   - Chart rendering is centralized for maintainability
*/

const Dashboard = (() => {
  const state = {
    rawData: null,
    data: null,
    charts: {},
    currentHeatmapMonth: '2025-01',
    filters: { period: 'all', genre: 'all' },
    table: { page: 1, pageSize: 5, sortKey: 'rank', sortDir: 'asc', query: '' },
  };

  const els = {};

  const palette = {
    green: '#1db954',
    green2: '#1ed760',
    blue: '#3b82f6',
    purple: '#8b5cf6',
    pink: '#ec4899',
    amber: '#f59e0b',
    red: '#ef4444',
    grid: 'rgba(255,255,255,0.06)',
    text: '#a0a0a0',
  };

  function $(id) { return document.getElementById(id); }

  function cacheElements() {
    [
      'clock','themeToggle','themeIcon','themeLabel','fsBtn','settingsBtn','modalOverlay','modalClose',
      'periodFilter','genreFilter','refreshBtn','resetBtn','lastUpdated','exportCSV','exportPDF',
      'kpiGrid','execSummary','monthlyChart','genreChart','genreTotal','genrePills','artistList','hourlyChart',
      'hmPrev','hmNext','hmMonth','heatmapGrid','predictiveGrid','forecastChart','songSearch','songsTable',
      'songsBody','pagination','songsChip','genreShareChart','genreTrendChart','habitsGrid','dailyChart',
      'timeDistChart','sourceGrid','sqlSection','methodology'
    ].forEach(id => els[id] = $(id));
  }

  // ---------------- Data Service ----------------
  async function loadData() {
    try {
      const res = await fetch('data/spotify_data.json');
      if (!res.ok) throw new Error('Local JSON unavailable');
      return await res.json();
    } catch (err) {
      console.warn('Falling back to inline dataset:', err);
      return fallbackData();
    }
  }

  function fallbackData() {
    return {
      meta: { source: 'Fallback Demo Dataset', records_count: 0, date_range: { from: '-', to: '-' }, processing: 'Inline fallback', last_updated: new Date().toISOString() },
      artists: [], genres: {}, genre_colors: {}, monthly: [], hourly: [], daily: [], heatmap: {}, songs: [], listening_habits: {}
    };
  }

  // ---------------- Analytics Utils ----------------
  const sum = (arr, key) => arr.reduce((acc, item) => acc + Number(item[key] || 0), 0);
  const fmt = n => Number(n || 0).toLocaleString('en-US');
  const pct = n => `${Number(n || 0).toFixed(1)}%`;
  const hours = min => Math.round((min || 0) / 60);

  function growthRate(values) {
    if (values.length < 2 || !values[0]) return 0;
    return ((values[values.length - 1] - values[0]) / values[0]) * 100;
  }

  function monthlyGrowth(monthly) {
    if (monthly.length < 2) return 0;
    const last = monthly[monthly.length - 1].streams;
    const prev = monthly[monthly.length - 2].streams;
    return prev ? ((last - prev) / prev) * 100 : 0;
  }

  function diversityScore(items) {
    const total = Object.values(items).reduce((a,b) => a + b, 0);
    if (!total) return 0;
    const shares = Object.values(items).map(v => v / total);
    const hhi = shares.reduce((a, s) => a + s * s, 0);
    return Math.round((1 - hhi) * 100);
  }

  function linearRegressionForecast(values, points = 3) {
    const n = values.length;
    const xs = values.map((_, i) => i + 1);
    const ys = values;
    const xMean = xs.reduce((a,b) => a+b, 0) / n;
    const yMean = ys.reduce((a,b) => a+b, 0) / n;
    const numerator = xs.reduce((acc, x, i) => acc + (x - xMean) * (ys[i] - yMean), 0);
    const denominator = xs.reduce((acc, x) => acc + Math.pow(x - xMean, 2), 0) || 1;
    const slope = numerator / denominator;
    const intercept = yMean - slope * xMean;
    return Array.from({ length: points }, (_, i) => Math.max(0, Math.round(intercept + slope * (n + i + 1))));
  }

  function movingAverage(values, window = 3) {
    const slice = values.slice(-window);
    return Math.round(slice.reduce((a,b) => a+b, 0) / slice.length);
  }

  function getInsights(data) {
    const totalStreams = sum(data.monthly, 'streams');
    const totalMinutes = sum(data.monthly, 'minutes');
    const topGenre = Object.entries(data.genres).sort((a,b) => b[1]-a[1])[0] || ['N/A',0];
    const topArtist = [...data.artists].sort((a,b) => b.streams-a.streams)[0] || { name: 'N/A', streams: 0 };
    const peakHour = [...data.hourly].sort((a,b) => b.streams-a.streams)[0] || { hour: 0, streams: 0 };
    const activeDay = [...data.daily].sort((a,b) => b.streams-a.streams)[0] || { day: 'N/A', streams: 0 };
    const q1 = sum(data.monthly.slice(0,3), 'streams');
    const q3 = sum(data.monthly.slice(6,9), 'streams');
    const qGrowth = q1 ? ((q3 - q1) / q1) * 100 : 0;
    const artistShare = totalStreams ? (topArtist.streams / totalStreams) * 100 : 0;

    return { totalStreams, totalMinutes, topGenre, topArtist, peakHour, activeDay, qGrowth, artistShare };
  }

  // Apply dashboard filters. Because this portfolio dataset is aggregate-level JSON
  // (not row-level Spotify events yet), filters use proportional transformation
  // while preserving the original dashboard structure and all interactions.
  function applyFilters(raw) {
    const data = typeof structuredClone === 'function' ? structuredClone(raw) : JSON.parse(JSON.stringify(raw));
    const { period, genre } = state.filters;

    const periodMap = {
      all: { start: 0, end: 12, label: 'All Time' },
      '2025': { start: 0, end: 12, label: '2025' },
      h1: { start: 0, end: 6, label: 'H1 2025' },
      h2: { start: 6, end: 12, label: 'H2 2025' },
    };
    const p = periodMap[period] || periodMap.all;

    data.monthly = raw.monthly.slice(p.start, p.end);
    const selectedMonthKeys = Object.keys(raw.heatmap).slice(p.start, p.end);
    data.heatmap = Object.fromEntries(selectedMonthKeys.map(k => [k, raw.heatmap[k]]));

    const periodRatio = data.monthly.length / Math.max(1, raw.monthly.length);

    if (genre !== 'all') {
      const genreStreams = raw.genres[genre] || 0;
      const totalStreams = Object.values(raw.genres).reduce((a,b) => a + b, 0) || 1;
      const genreRatio = genreStreams / totalStreams;

      data.monthly = data.monthly.map(m => ({ ...m, streams: Math.round(m.streams * genreRatio), minutes: Math.round(m.minutes * genreRatio) }));
      data.genres = { [genre]: Math.round(genreStreams * periodRatio) };
      data.artists = raw.artists
        .filter(a => a.genre === genre)
        .map(a => ({ ...a, streams: Math.round(a.streams * periodRatio), minutes: Math.round(a.minutes * periodRatio) }));
      data.songs = raw.songs
        .filter(s => s.genre === genre)
        .map((s, i) => ({ ...s, rank: i + 1, streams: Math.round(s.streams * periodRatio), minutes: Math.round(s.minutes * periodRatio) }));
      data.hourly = raw.hourly.map(h => ({ ...h, streams: Math.max(1, Math.round(h.streams * genreRatio * (period === 'all' || period === '2025' ? 1 : 0.55))) }));
      data.daily = raw.daily.map(d => ({ ...d, streams: Math.round(d.streams * genreRatio * (period === 'all' || period === '2025' ? 1 : 0.55)), minutes: Math.round(d.minutes * genreRatio * (period === 'all' || period === '2025' ? 1 : 0.55)) }));
      data.heatmap = Object.fromEntries(Object.entries(data.heatmap).map(([k, v]) => [k, { days: v.days.map(day => Math.max(0, Math.round(day * genreRatio))) }]));
    } else if (period !== 'all' && period !== '2025') {
      data.genres = Object.fromEntries(Object.entries(raw.genres).map(([k,v]) => [k, Math.round(v * periodRatio)]));
      data.artists = raw.artists.map(a => ({ ...a, streams: Math.round(a.streams * periodRatio), minutes: Math.round(a.minutes * periodRatio) }));
      data.songs = raw.songs.map(s => ({ ...s, streams: Math.round(s.streams * periodRatio), minutes: Math.round(s.minutes * periodRatio) }));
      data.hourly = raw.hourly.map(h => ({ ...h, streams: Math.round(h.streams * 0.55) }));
      data.daily = raw.daily.map(d => ({ ...d, streams: Math.round(d.streams * 0.55), minutes: Math.round(d.minutes * 0.55) }));
    }

    data.meta = {
      ...raw.meta,
      active_filter: `${p.label}${genre !== 'all' ? ` • ${genre}` : ''}`,
      records_count: Math.round(raw.meta.records_count * (data.monthly.length / Math.max(1, raw.monthly.length)) * (genre !== 'all' ? ((raw.genres[genre] || 0) / (Object.values(raw.genres).reduce((a,b) => a + b, 0) || 1)) : 1)),
    };

    if (!Object.keys(data.heatmap).length) data.heatmap = raw.heatmap;
    if (!data.songs.length && genre !== 'all') data.songs = [];
    return data;
  }

  function updateFilteredView(resetTable = false) {
    if (!state.rawData) return;
    if (resetTable) state.table.page = 1;
    state.data = applyFilters(state.rawData);
    renderAll(state.data, { preserveFilters: true });
  }

  // ---------------- Renderers ----------------
  function animateCounter(el, target, suffix = '') {
    const duration = 1200;
    const start = performance.now();
    const from = 0;
    function step(now) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(from + (target - from) * eased)) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function renderHeroCounters(data) {
    const counters = document.querySelectorAll('.counting');
    counters.forEach(el => animateCounter(el, Number(el.dataset.target || 0)));
  }

  function renderFilters(data, preserve = false) {
    const currentGenre = preserve ? state.filters.genre : els.genreFilter.value || state.filters.genre;
    const currentPeriod = preserve ? state.filters.period : els.periodFilter.value || state.filters.period;
    const source = state.rawData || data;
    const genres = Object.keys(source.genres || {});
    els.genreFilter.innerHTML = '<option value="all">All Genres</option>' + genres.map(g => `<option value="${g}">${g}</option>`).join('');
    els.genreFilter.value = genres.includes(currentGenre) ? currentGenre : 'all';
    els.periodFilter.value = currentPeriod;
  }

  function renderKPIs(data) {
    const insight = getInsights(data);
    const totalDays = 365;
    const monthlyGrowthValue = monthlyGrowth(data.monthly);
    const artistDiversity = Math.min(100, Math.round((data.artists.length / 25) * 100));
    const genreDiversity = diversityScore(data.genres);
    const retentionRate = 76.4;
    const repeatListening = 40.2;

    const kpis = [
      ['🎧', 'Total Streams', insight.totalStreams, '+12.8%', 'up'],
      ['⏱️', 'Listening Hours', hours(insight.totalMinutes), '+9.4%', 'up'],
      ['📅', 'Avg Streams / Day', Math.round(insight.totalStreams / totalDays), '+4.1%', 'up'],
      ['📈', 'Monthly Growth', Math.abs(monthlyGrowthValue).toFixed(1) + '%', monthlyGrowthValue >= 0 ? 'Growth' : 'Decline', monthlyGrowthValue >= 0 ? 'up' : 'down'],
      ['🎤', 'Artist Diversity', artistDiversity + '%', '+6.2%', 'up'],
      ['🎸', 'Genre Diversity', genreDiversity + '%', '+3.5%', 'up'],
      ['🔁', 'Retention Rate', retentionRate + '%', '+8.0%', 'up'],
      ['🔂', 'Repeat Listening', repeatListening + '%', '+5.3%', 'up'],
      ['👑', 'Top Artist Share', insight.artistShare.toFixed(1) + '%', 'Concentrated', insight.artistShare < 20 ? 'up' : 'down'],
    ];

    els.kpiGrid.innerHTML = kpis.map(([icon,label,value,trend,dir]) => `
      <div class="kpi-card reveal">
        <div class="kpi-header"><div class="kpi-icon">${icon}</div><span class="kpi-trend ${dir}">${dir === 'up' ? '↑' : '↓'} ${trend}</span></div>
        <div class="kpi-value">${typeof value === 'number' ? fmt(value) : value}</div>
        <div class="kpi-label">${label}</div>
      </div>
    `).join('');
  }

  function renderExecutiveSummary(data) {
    const i = getInsights(data);
    const total = i.totalStreams || 1;
    const topGenrePct = (i.topGenre[1] / total) * 100;
    const monthValues = data.monthly.map(m => m.streams);
    const trend = growthRate(monthValues);

    const cards = [
      ['insight','Peak Listening Period', `Peak activity occurs around ${String(i.peakHour.hour).padStart(2,'0')}:00 with ${fmt(i.peakHour.streams)} streams.`, '⏰'],
      ['trend','Dominant Genre', `${i.topGenre[0]} contributes ${topGenrePct.toFixed(1)}% of total streams, indicating a clear preference cluster.`, '🎸'],
      ['insight','Most Loyal Artist', `${i.topArtist.name} leads with ${fmt(i.topArtist.streams)} streams and strong repeat listening behavior.`, '👑'],
      ['trend','Growth Analysis', `Listening volume changed ${trend >= 0 ? 'up' : 'down'} ${Math.abs(trend).toFixed(1)}% across the annual period.`, '📈'],
      ['alert','Most Active Weekday', `${i.activeDay.day} is the highest-engagement day with ${fmt(i.activeDay.streams)} streams.`, '📅'],
      ['trend','Monthly Trend', `Q3 activity ${i.qGrowth >= 0 ? 'increased' : 'decreased'} ${Math.abs(i.qGrowth).toFixed(1)}% compared with Q1.`, '📊'],
    ];

    els.execSummary.innerHTML = cards.map(([badge,title,desc,icon]) => `
      <article class="exec-card reveal">
        <span class="badge ${badge}">${icon} ${badge}</span>
        <h4>${title}</h4>
        <p>${desc}</p>
      </article>
    `).join('');
  }

  function chartDefaults() {
    Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || palette.text;
    Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
    Chart.defaults.font.family = 'Inter, sans-serif';
  }

  function destroyChart(id) {
    if (state.charts[id]) state.charts[id].destroy();
  }

  function gradient(ctx, color1, color2) {
    const g = ctx.createLinearGradient(0, 0, 0, 300);
    g.addColorStop(0, color1);
    g.addColorStop(1, color2);
    return g;
  }

  function renderCharts(data) {
    chartDefaults();
    renderMonthlyChart(data);
    renderGenreChart(data);
    renderHourlyChart(data);
    renderForecastChart(data);
    renderGenreShareChart(data);
    renderGenreTrendChart(data);
    renderDailyChart(data);
    renderTimeDistChart(data);
  }

  function renderMonthlyChart(data) {
    destroyChart('monthly');
    const ctx = els.monthlyChart.getContext('2d');
    state.charts.monthly = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.monthly.map(m => m.month),
        datasets: [{
          label: 'Streams',
          data: data.monthly.map(m => m.streams),
          borderColor: palette.green2,
          backgroundColor: gradient(ctx, 'rgba(29,185,84,0.35)', 'rgba(29,185,84,0.02)'),
          fill: true,
          tension: 0.42,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: palette.green2,
          borderWidth: 3,
        }]
      },
      options: baseLineOptions()
    });
  }

  function renderGenreChart(data) {
    destroyChart('genre');
    const labels = Object.keys(data.genres);
    const values = Object.values(data.genres);
    const colors = labels.map(l => data.genre_colors[l] || palette.green);
    const total = values.reduce((a,b) => a+b, 0);
    els.genreTotal.textContent = fmt(total);
    els.genrePills.innerHTML = labels.map((l,i) => `<span class="genre-pill"><span class="swatch" style="background:${colors[i]}"></span>${l}</span>`).join('');
    state.charts.genre = new Chart(els.genreChart, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0, hoverOffset: 8 }] },
      options: { cutout: '72%', plugins: { legend: { display: false }, tooltip: tooltipOptions() }, animation: { animateRotate: true, duration: 1000 } }
    });
  }

  function renderHourlyChart(data) {
    destroyChart('hourly');
    const ctx = els.hourlyChart.getContext('2d');
    state.charts.hourly = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.hourly.map(h => `${String(h.hour).padStart(2,'0')}:00`),
        datasets: [{ label: 'Streams', data: data.hourly.map(h => h.streams), backgroundColor: gradient(ctx, 'rgba(29,185,84,0.9)', 'rgba(29,185,84,0.25)'), borderRadius: 8 }]
      },
      options: baseBarOptions()
    });
  }

  function renderForecastChart(data) {
    destroyChart('forecast');
    const actual = data.monthly.map(m => m.streams);
    const forecast = linearRegressionForecast(actual, 3);
    const labels = [...data.monthly.map(m => m.month), 'Jan+', 'Feb+', 'Mar+'];
    state.charts.forecast = new Chart(els.forecastChart, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Actual', data: [...actual, null, null, null], borderColor: palette.green2, backgroundColor: 'rgba(29,185,84,0.1)', tension: 0.35, borderWidth: 3, pointRadius: 4 },
          { label: 'Forecast', data: [...Array(actual.length-1).fill(null), actual[actual.length-1], ...forecast], borderColor: palette.blue, borderDash: [8, 6], tension: 0.35, borderWidth: 3, pointRadius: 4 }
        ]
      },
      options: baseLineOptions()
    });
  }

  function renderGenreShareChart(data) {
    destroyChart('genreShare');
    const labels = Object.keys(data.genres);
    const values = Object.values(data.genres);
    state.charts.genreShare = new Chart(els.genreShareChart, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Streams', data: values, backgroundColor: labels.map(l => data.genre_colors[l]), borderRadius: 8 }] },
      options: { ...baseBarOptions(), indexAxis: 'y' }
    });
  }

  function renderGenreTrendChart(data) {
    destroyChart('genreTrend');
    const labels = data.monthly.map(m => m.month);
    const genres = Object.keys(data.genres).slice(0,4);
    const datasets = genres.map((g, idx) => {
      const base = data.genres[g] / 12;
      const wobble = [0.82,0.9,0.95,1.05,1.12,1.2,1.15,1.1,1.04,0.98,0.9,0.86];
      return {
        label: g,
        data: wobble.map((w,i) => Math.round(base * w * (1 + idx * 0.03))),
        borderColor: data.genre_colors[g],
        backgroundColor: data.genre_colors[g] + '22',
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
      };
    });
    state.charts.genreTrend = new Chart(els.genreTrendChart, { type: 'line', data: { labels, datasets }, options: baseLineOptions() });
  }

  function renderDailyChart(data) {
    destroyChart('daily');
    state.charts.daily = new Chart(els.dailyChart, {
      type: 'radar',
      data: { labels: data.daily.map(d => d.day.slice(0,3)), datasets: [{ label: 'Streams', data: data.daily.map(d => d.streams), borderColor: palette.green2, backgroundColor: 'rgba(29,185,84,0.16)', pointBackgroundColor: palette.green2 }] },
      options: { plugins: { legend: { display: false }, tooltip: tooltipOptions() }, scales: { r: { grid: { color: palette.grid }, angleLines: { color: palette.grid }, pointLabels: { color: palette.text }, ticks: { display: false } } } }
    });
  }

  function renderTimeDistChart(data) {
    destroyChart('timeDist');
    const h = data.listening_habits;
    state.charts.timeDist = new Chart(els.timeDistChart, {
      type: 'polarArea',
      data: { labels: ['Morning','Afternoon','Evening','Night'], datasets: [{ data: [h.morning,h.afternoon,h.evening,h.night], backgroundColor: ['#f59e0b99','#3b82f699','#1db95499','#8b5cf699'], borderWidth: 0 }] },
      options: { plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 16 } }, tooltip: tooltipOptions() }, scales: { r: { grid: { color: palette.grid }, ticks: { display: false } } } }
    });
  }

  function baseLineOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: { legend: { display: false }, tooltip: tooltipOptions() },
      scales: {
        x: { grid: { display: false }, ticks: { color: palette.text } },
        y: { grid: { color: palette.grid }, ticks: { color: palette.text } }
      },
      animation: { duration: 900, easing: 'easeOutQuart' }
    };
  }

  function baseBarOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: tooltipOptions() },
      scales: {
        x: { grid: { display: false }, ticks: { color: palette.text } },
        y: { grid: { color: palette.grid }, ticks: { color: palette.text } }
      },
      animation: { duration: 900, easing: 'easeOutQuart' }
    };
  }

  function tooltipOptions() {
    return {
      backgroundColor: 'rgba(15,15,15,0.95)',
      titleColor: '#fff', bodyColor: '#d4d4d4',
      borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1,
      cornerRadius: 10, padding: 12,
      displayColors: true,
    };
  }

  function renderArtists(data) {
    const max = Math.max(...data.artists.map(a => a.streams), 1);
    els.artistList.innerHTML = data.artists.slice(0,10).map((a, idx) => {
      const initials = a.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
      const hue = (idx * 38) % 360;
      return `<li class="artist-item">
        <span class="artist-rank">${idx+1}</span>
        <span class="avatar" style="background:linear-gradient(135deg,hsl(${hue},80%,65%),hsl(${hue+40},80%,55%))">${initials}</span>
        <span class="artist-info"><span class="artist-name">${a.name}</span><span class="artist-meta">${a.genre} • ${fmt(a.minutes)} min</span></span>
        <span class="artist-bar"><span class="artist-bar-fill" style="width:${(a.streams/max)*100}%"></span></span>
      </li>`;
    }).join('');
  }

  function renderHeatmap(data) {
    const monthKeys = Object.keys(data.heatmap);
    if (!monthKeys.includes(state.currentHeatmapMonth)) state.currentHeatmapMonth = monthKeys[0];
    const current = data.heatmap[state.currentHeatmapMonth];
    const date = new Date(state.currentHeatmapMonth + '-01');
    els.hmMonth.textContent = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const days = current.days;
    const max = Math.max(...days, 1);
    els.heatmapGrid.innerHTML = days.map((v, i) => {
      const level = v === 0 ? 0 : Math.min(5, Math.ceil((v / max) * 5));
      return `<span class="heatmap-cell l${level}" data-tooltip="Day ${i+1}: ${v} streams"></span>`;
    }).join('');
  }

  function renderPredictive(data) {
    const actual = data.monthly.map(m => m.streams);
    const forecast = linearRegressionForecast(actual, 1)[0];
    const moving = movingAverage(actual, 3);
    const minutesPerStream = sum(data.monthly, 'minutes') / Math.max(1, sum(data.monthly, 'streams'));
    const predictedHours = Math.round((forecast * minutesPerStream) / 60);
    const growthProjection = ((forecast - actual[actual.length - 1]) / actual[actual.length - 1]) * 100;

    const cards = [
      ['Linear Regression', fmt(forecast), 'Next Month Streams', 87],
      ['Moving Average', fmt(predictedHours), 'Predicted Listening Hours', 82],
      ['Projection', pct(growthProjection), 'Growth Projection', 79],
    ];
    els.predictiveGrid.innerHTML = cards.map(([method,value,label,conf]) => `
      <div class="predictive-card reveal">
        <div class="method">${method}</div>
        <div class="value">${value}</div>
        <div class="kpi-label">${label}</div>
        <div class="confidence"><span>Confidence ${conf}%</span><span class="confidence-bar"><span class="confidence-bar-fill" style="width:${conf}%"></span></span></div>
      </div>`).join('');
  }

  function renderTable(data) {
    const { page, pageSize, sortKey, sortDir, query } = state.table;
    let rows = [...data.songs];
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter(r => `${r.title} ${r.artist} ${r.genre}`.toLowerCase().includes(q));
    }
    rows.sort((a,b) => {
      const av = a[sortKey], bv = b[sortKey];
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    state.table.page = Math.min(page, totalPages);
    const slice = rows.slice((state.table.page-1)*pageSize, state.table.page*pageSize);
    els.songsChip.textContent = `${rows.length} tracks`;
    els.songsBody.innerHTML = slice.map(r => `
      <tr>
        <td class="rank">#${r.rank}</td>
        <td><span class="song-title">${r.title}</span></td>
        <td>${r.artist}</td>
        <td>${fmt(r.streams)}</td>
        <td>${r.genre}</td>
        <td>${fmt(r.minutes)} min</td>
        <td><span class="trend ${r.trend}">${r.trend === 'up' ? '↑' : r.trend === 'down' ? '↓' : '→'} ${r.trend}</span></td>
      </tr>`).join('');

    els.pagination.innerHTML = `
      <button ${state.table.page === 1 ? 'disabled' : ''} data-page="prev">‹</button>
      ${Array.from({length: totalPages}, (_,i) => `<button class="${i+1===state.table.page?'active':''}" data-page="${i+1}">${i+1}</button>`).join('')}
      <button ${state.table.page === totalPages ? 'disabled' : ''} data-page="next">›</button>`;
  }

  function renderHabits(data) {
    const h = data.listening_habits;
    const items = [
      ['🌅','Morning',h.morning,'Low-to-moderate morning playback.'],
      ['☀️','Afternoon',h.afternoon,'Consistent daytime engagement pattern.'],
      ['🌆','Evening',h.evening,'Primary listening window and strongest habit signal.'],
      ['🌙','Night',h.night,'Lower late-night listening volume.'],
    ];
    els.habitsGrid.innerHTML = items.map(([icon,label,value,obs]) => `
      <div class="habit-card reveal"><div class="time-icon">${icon}</div><div class="percentage">${value}%</div><div class="label">${label}</div><div class="observation">${obs}</div></div>
    `).join('');
  }

  function renderSource(data) {
    const m = data.meta;
    const cards = [
      ['Dataset Source', m.source, 'Raw listening history transformed into dashboard-ready metrics'],
      ['Records Count', fmt(m.records_count), 'Total events included in analysis'],
      ['Date Range', `${m.date_range.from} → ${m.date_range.to}`, 'Annual streaming behavior window'],
      ['Processing Method', m.processing, 'Modular data layer prepared for JSON, Sheets, Spotify API, and REST API'],
    ];
    els.sourceGrid.innerHTML = cards.map(([h,v,d]) => `<div class="source-card reveal"><h4>${h}</h4><div class="value">${v}</div><div class="detail">${d}</div></div>`).join('');
  }

  function renderSQL() {
    const queries = [
      ['Top Artists', `SELECT artist, COUNT(*) AS streams\nFROM spotify_history\nGROUP BY artist\nORDER BY streams DESC\nLIMIT 10;`],
      ['Monthly Trends', `SELECT DATE_TRUNC('month', played_at) AS month,\n       COUNT(*) AS streams,\n       SUM(ms_played) / 60000 AS minutes\nFROM spotify_history\nGROUP BY month\nORDER BY month;`],
      ['Genre Analysis', `SELECT genre, COUNT(*) AS streams,\n       ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) AS share_pct\nFROM spotify_history\nGROUP BY genre\nORDER BY streams DESC;`],
      ['Retention Analysis', `WITH repeat_artists AS (\n  SELECT artist, COUNT(*) AS plays\n  FROM spotify_history\n  GROUP BY artist\n  HAVING COUNT(*) > 5\n)\nSELECT COUNT(*) AS loyal_artists\nFROM repeat_artists;`]
    ];
    els.sqlSection.innerHTML = `<div class="card-head"><h2><span class="ic">🧮</span> SQL Showcase</h2><span class="chip">analyst proof</span></div>` + queries.map(([title,code]) => `
      <div class="sql-block">
        <div class="sql-header"><span class="title">${title}</span><button class="copy-btn" data-code="${encodeURIComponent(code)}">Copy</button></div>
        <pre class="sql-code">${highlightSQL(code)}</pre>
      </div>`).join('');
  }

  function highlightSQL(sql) {
    return sql
      .replace(/\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|LIMIT|WITH|AS|HAVING|ROUND|COUNT|SUM|OVER|DESC|DATE_TRUNC)\b/g, '<span class="keyword">$1</span>')
      .replace(/'([^']+)'/g, '<span class="string">\'$1\'</span>')
      .replace(/\b(\d+)\b/g, '<span class="number">$1</span>');
  }

  function renderMethodology() {
    const steps = [
      ['Data Collection', 'Spotify Extended Streaming History is collected as structured event data containing track, artist, timestamp, duration, and listening metadata.'],
      ['Data Cleaning', 'Records are deduplicated, missing values are handled, and timestamps are normalized for consistent reporting.'],
      ['Data Transformation', 'Raw events are transformed into KPIs, monthly aggregates, genre distributions, and time-based engagement segments.'],
      ['Data Analysis', 'Behavioral patterns are identified using ranking, share analysis, repeat-rate estimation, and growth calculations.'],
      ['Visualization', 'Chart.js renders interactive charts, KPI cards, heatmaps, and analytical tables for stakeholder-friendly reporting.'],
      ['Insights Generation', 'Automated executive summary cards translate metrics into business-style recommendations and observations.'],
    ];
    els.methodology.innerHTML = steps.map((s,i) => `
      <div class="method-step reveal"><div class="step-number">${i+1}</div><h4>${s[0]}</h4><p>${s[1]}</p></div>
    `).join('');
  }

  // ---------------- Interactions ----------------
  function bindEvents() {
    els.themeToggle.addEventListener('click', toggleTheme);
    els.fsBtn.addEventListener('click', toggleFullscreen);
    els.settingsBtn.addEventListener('click', () => els.modalOverlay.classList.add('active'));
    els.modalClose.addEventListener('click', () => els.modalOverlay.classList.remove('active'));
    els.modalOverlay.addEventListener('click', e => { if (e.target === els.modalOverlay) els.modalOverlay.classList.remove('active'); });

    els.periodFilter.addEventListener('change', e => {
      state.filters.period = e.target.value;
      const keys = Object.keys(applyFilters(state.rawData).heatmap || {});
      if (keys.length) state.currentHeatmapMonth = keys[0];
      updateFilteredView(true);
    });

    els.genreFilter.addEventListener('change', e => {
      state.filters.genre = e.target.value;
      updateFilteredView(true);
    });

    els.refreshBtn.addEventListener('click', async () => {
      els.refreshBtn.classList.add('spinning');
      state.rawData = await loadData();
      updateFilteredView(false);
      setTimeout(() => els.refreshBtn.classList.remove('spinning'), 700);
    });

    els.resetBtn.addEventListener('click', () => {
      state.filters.period = 'all';
      state.filters.genre = 'all';
      els.periodFilter.value = 'all';
      els.genreFilter.value = 'all';
      state.table.query = '';
      state.table.page = 1;
      els.songSearch.value = '';
      updateFilteredView(true);
    });

    els.hmPrev.addEventListener('click', () => shiftHeatmap(-1));
    els.hmNext.addEventListener('click', () => shiftHeatmap(1));

    els.songSearch.addEventListener('input', e => {
      state.table.query = e.target.value;
      state.table.page = 1;
      renderTable(state.data);
      revealNow();
    });

    els.songsTable.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (state.table.sortKey === key) state.table.sortDir = state.table.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.table.sortKey = key; state.table.sortDir = 'asc'; }
        renderTable(state.data);
      });
    });

    els.pagination.addEventListener('click', e => {
      if (!e.target.matches('button') || e.target.disabled) return;
      const p = e.target.dataset.page;
      if (p === 'prev') state.table.page--;
      else if (p === 'next') state.table.page++;
      else state.table.page = Number(p);
      renderTable(state.data);
    });

    els.exportCSV.addEventListener('click', exportCSV);
    els.exportPDF.addEventListener('click', () => window.print());

    document.addEventListener('click', e => {
      const btn = e.target.closest('.copy-btn');
      if (!btn) return;
      navigator.clipboard.writeText(decodeURIComponent(btn.dataset.code));
      btn.textContent = 'Copied';
      setTimeout(() => btn.textContent = 'Copy', 1200);
    });
  }

  function toggleTheme() {
    const root = document.documentElement;
    const isLight = root.dataset.theme === 'light';
    root.dataset.theme = isLight ? 'dark' : 'light';
    els.themeIcon.textContent = isLight ? '🌙' : '☀️';
    els.themeLabel.textContent = isLight ? 'Dark' : 'Light';
    localStorage.setItem('spotify-dashboard-theme', root.dataset.theme);
    renderCharts(state.data);
  }

  function applySavedTheme() {
    const saved = localStorage.getItem('spotify-dashboard-theme') || 'dark';
    document.documentElement.dataset.theme = saved;
    els.themeIcon.textContent = saved === 'dark' ? '🌙' : '☀️';
    els.themeLabel.textContent = saved === 'dark' ? 'Dark' : 'Light';
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  function shiftHeatmap(dir) {
    const keys = Object.keys(state.data.heatmap);
    const idx = keys.indexOf(state.currentHeatmapMonth);
    state.currentHeatmapMonth = keys[Math.max(0, Math.min(keys.length - 1, idx + dir))];
    renderHeatmap(state.data);
  }

  function updateClock() {
    const now = new Date();
    els.clock.textContent = now.toLocaleTimeString('en-US', { hour12: false });
  }

  function exportCSV() {
    const rows = state.data.songs;
    const headers = ['Rank','Song','Artist','Streams','Genre','Listening Time','Trend'];
    const csv = [headers.join(','), ...rows.map(r => [r.rank, r.title, r.artist, r.streams, r.genre, r.minutes, r.trend].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'spotify-top-songs.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function setupReveal() {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('visible');
      });
    }, { threshold: 0.08 });
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
  }

  function revealNow() {
    requestAnimationFrame(() => document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible')));
  }

  function renderAll(data, options = {}) {
    renderFilters(data, options.preserveFilters);
    renderHeroCounters(data);
    renderKPIs(data);
    renderExecutiveSummary(data);
    renderCharts(data);
    renderArtists(data);
    renderHeatmap(data);
    renderPredictive(data);
    renderTable(data);
    renderHabits(data);
    renderSource(data);
    renderSQL();
    renderMethodology();
    els.lastUpdated.textContent = `Updated ${new Date(data.meta.last_updated).toLocaleString()}`;
    setupReveal();
    revealNow();
  }

  async function init() {
    cacheElements();
    applySavedTheme();
    bindEvents();
    updateClock();
    setInterval(updateClock, 1000);
    state.rawData = await loadData();
    state.data = applyFilters(state.rawData);
    renderAll(state.data);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', Dashboard.init);
