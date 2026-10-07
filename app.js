/* KPSS 2026 Atanma Tahmini — uygulama mantığı.
   Veri: window.KPSS_DATA (yerleştirmeler), window.KPSS_RANK (puan → başarı sırası modelleri),
         window.KPSS_HEMSIRE (uzun dönem hemşire tablosu), window.KPSS_NITELIK (kılavuz nitelik kodları). */
'use strict';
(function () {
  // Aynı uygulama iki sayfada çalışır: index.html (KPSS) ve ekpss.html (window.SITE.exam = 'ekpss'). EKPSS'de puan → sıra
  // modeli yoktur: karşılaştırma puanla yapılır, atanma ihtimali yerine son yerleştirmelerde puanın yettiği kadro oranı gösterilir.
  const EK = (window.SITE || {}).exam === 'ekpss';
  const D = EK ? window.EKPSS_DATA : window.KPSS_DATA;
  const RK = EK ? { models: {} } : window.KPSS_RANK;
  const HT = EK ? null : window.KPSS_HEMSIRE || null;
  const NIT = (EK ? window.EKPSS_NITELIK : window.KPSS_NITELIK) || {};
  const PFX = EK ? 'EKPSS-' : 'KPSS-';
  const STORE_KEY = EK ? 'ekpss-state' : 'kpss2026-state';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); }; // öğe o sayfada yoksa geç
  const LEVELS = ['lisans', 'onlisans', 'ortaogretim'];
  const LV = {
    lisans: { ad: 'Lisans', puan: EK ? 'EKPSS Lisans' : 'KPSSP3', edu: '4', generic: 4001, kodBas: '3' },
    onlisans: { ad: 'Ön Lisans', puan: EK ? 'EKPSS Ön Lisans' : 'KPSSP93', edu: '3', generic: 3001, kodBas: '2' },
    ortaogretim: { ad: 'Ortaöğretim', puan: EK ? 'EKPSS Ortaöğretim' : 'KPSSP94', edu: '2', generic: 2001, kodBas: '1' },
  };
  const CUR = 2026;
  const COL = { p: 0, level: 1, kod: 2, kurum: 3, il: 4, birim: 5, unvan: 6, grup: 7, kont: 8, yer: 9, min: 10, max: 11 };
  const RECENCY = { 2024: 1, 2022: 0.75, 2020: 0.55, 2018: 0.4 };
  const NEAR = 0.75; // "sınırda" bandı (puan)

  window.addEventListener('error', (e) => {
    const box = document.getElementById('app-error') || document.createElement('div');
    box.id = 'app-error';
    box.className = 'msg bad';
    box.style.margin = '12px 0';
    box.textContent = 'Sayfada bir hata oluştu: ' + (e.message || 'bilinmeyen hata') + '. Sayfayı yenilemeyi dene; sorun sürerse "Veri ekle" bölümündeki yüklemeleri kaldır.';
    const host = document.querySelector('.hero');
    if (host && !box.parentNode) host.before(box);
  });
  if (!D || !RK) {
    document.querySelector('#search').innerHTML = '<p class="msg bad">Veri dosyaları yüklenemedi. <code>data</code> klasörünün <code>index.html</code> ile aynı yerde olduğundan emin ol.</p>';
    return;
  }

  // ---------------------------------------------------------------- biçimlendirme
  const nf = (d) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const F0 = nf(0), F1 = nf(1);
  const fInt = (x) => (x == null || !isFinite(x) ? '–' : F0.format(Math.round(x)));
  const fSc = (x, d = 3) => (x == null || !isFinite(x) ? '–' : nf(d).format(x));
  const fPct = (x, d = 0) => (x == null || !isFinite(x) ? '–' : '%' + nf(d).format(100 * x));
  const fProb = (x) => (x == null || !isFinite(x) ? '–' : x >= 0.995 ? '%99+' : x <= 0.005 ? '%1\'den az' : '%' + F0.format(100 * x));
  const DTF = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
  const fDate = (iso) => (iso ? DTF.format(new Date(iso + 'T12:00:00')) : '–');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const up = (s) => String(s || '').toLocaleUpperCase('tr-TR');
  const low = (s) => String(s || '').toLocaleLowerCase('tr-TR');
  const SMALL = new Set(['VE', 'İLE', 'VEYA', 'DA', 'DE']);
  function trTitle(s) {
    if (!s) return '';
    const cap = (w) => {
      const lw = low(w);
      const j = lw.search(/[a-zçğıöşüâîû]/i);
      if (j < 0) return w;
      return lw.slice(0, j) + lw.charAt(j).toLocaleUpperCase('tr-TR') + lw.slice(j + 1);
    };
    return s.split(' ').map((w, i) => (i > 0 && SMALL.has(w) ? low(w) : w.split('-').map(cap).join('-'))).join(' ');
  }
  function parseScore(str) {
    if (str == null) return null;
    let s = String(str).trim().replace(/\s/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const v = parseFloat(s);
    return isFinite(v) ? v : null;
  }
  function parseIntTR(str) {
    if (str == null) return null;
    const s = String(str).replace(/[^\d]/g, '');
    if (!s) return null;
    const v = parseInt(s, 10);
    return isFinite(v) ? v : null;
  }
  function Phi(x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // Düğmeye basınca ilgili bölümü gösterir; soft: bölüm zaten ekranın üst kısmındaysa kaydırmaz.
  function goTo(el, soft = false) {
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (soft && top >= 0 && top < innerHeight * 0.4) return;
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }
  function focusField(sel) {
    const el = $(sel);
    if (!el) return;
    goTo(el.closest('.field') || el);
    el.focus({ preventScroll: true });
  }
  const ICON = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8.4 8.4l4.2 4.2M12.6 8.4l-4.2 4.2"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  };
  // Sonuç olmayan her yerde aynı büyük kutu: başlık, açıklama (HTML) ve data-act ile çalışan öneri düğmeleri.
  function emptyHTML({ icon = 'search', tone = '', title, text = '', actions = [], compact = false, flat = false }) {
    const cls = ['empty', tone, compact ? 'compact' : '', flat ? 'flat' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" role="status"><span class="empty-ico" aria-hidden="true">${ICON[icon]}</span>
      <p class="empty-title">${esc(title)}</p>${text ? `<p class="empty-text">${text}</p>` : ''}
      ${actions.length ? `<div class="empty-acts">${actions.map(([label, act, primary, val]) =>
        `<button type="button" class="btn${primary ? ' btn-primary' : ''}" data-act="${act}"${val ? ` data-val="${esc(val)}"` : ''}>${esc(label)}</button>`).join('')}</div>` : ''}</div>`;
  }

  // ---------------------------------------------------------------- depolama
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };

  // ---------------------------------------------------------------- veri
  const P = D.placements.map((p) => Object.assign({}, p, { user: false }));
  const R = D.rows;
  const DICT = { kurum: D.dict.kurum.slice(), unvan: D.dict.unvan.slice(), grup: D.dict.grup.slice(), il: D.dict.il.slice() };
  const DIDX = {};
  for (const k of Object.keys(DICT)) DIDX[k] = new Map(DICT[k].map((v, i) => [v, i]));
  function dictIdx(kind, val) {
    val = val || '';
    let i = DIDX[kind].get(val);
    if (i == null) { i = DICT[kind].length; DICT[kind].push(val); DIDX[kind].set(val, i); }
    return i;
  }
  const BASE_ROWS = R.length;
  const BASE_P = P.length;
  const placeKey = (p) => p.id + '|' + p.date;

  // ---------------------------------------------------------------- sıralama modelleri
  let calib = store.get('kpss2026-cal', []);
  const modelCache = new Map();
  function rankOn(m, s) {
    if (!m || s == null) return null;
    const n = m.ranks.length;
    const i = (s - m.grid_start) / m.grid_step;
    if (i <= 0) return m.ranks[0];
    if (i >= n - 1) return m.ranks[n - 1];
    const i0 = Math.floor(i), f = i - i0;
    return m.ranks[i0] * (1 - f) + m.ranks[i0 + 1] * f;
  }
  function scoreOn(m, r) {
    if (!m || r == null) return null;
    const a = m.ranks, n = a.length;
    if (r >= a[0]) return m.grid_start;
    if (r <= a[n - 1]) return m.grid_start + (n - 1) * m.grid_step;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (a[mid] >= r) lo = mid; else hi = mid; }
    const f = (a[lo] - r) / Math.max(1e-9, a[lo] - a[hi]);
    return m.grid_start + (lo + f) * m.grid_step;
  }
  function model(level, year) {
    const key = level + '-' + year;
    if (modelCache.has(key)) return modelCache.get(key);
    const base = RK.models[key];
    let m = base || null;
    if (base) {
      const pts = calib.filter((c) => c.level === level && c.year === year && c.score && c.rank);
      if (pts.length) {
        const nUser = (pts.find((c) => c.n) || {}).n || base.n;
        const sN = nUser / base.n;
        const xs = pts.map((c) => c.score);
        const ys = pts.map((c) => Math.log(c.rank / Math.max(1, rankOn(base, c.score) * sN)));
        let a = ys.reduce((s, v) => s + v, 0) / ys.length, b = 0;
        if (pts.length >= 3) {
          const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
          const sxx = xs.reduce((s, v) => s + (v - mx) ** 2, 0);
          if (sxx > 1) { b = xs.reduce((s, v, i) => s + (v - mx) * (ys[i] - a), 0) / sxx; a = a - b * mx; }
        }
        const lo = Math.min(...xs) - 3, hi = Math.max(...xs) + 3;
        const ranks = base.ranks.map((r, i) => {
          const s = base.grid_start + i * base.grid_step;
          const sc = Math.min(Math.max(s, lo), hi);
          return Math.max(1, Math.min(nUser, r * sN * Math.exp(a + b * sc)));
        });
        for (let i = 1; i < ranks.length; i++) if (ranks[i] > ranks[i - 1]) ranks[i] = ranks[i - 1];
        m = Object.assign({}, base, { n: nUser, ranks, calibrated: pts.length });
      }
    }
    modelCache.set(key, m);
    return m;
  }
  function to2026(level, year, s) {
    if (s == null) return null;
    const a = model(level, year), b = model(level, CUR);
    if (!a || !b || year === CUR) return s;
    return scoreOn(b, rankOn(a, s));
  }

  // ---------------------------------------------------------------- durum
  const DEFAULTS = { level: 'lisans', score: EK ? '82,00000' : '80,50000', rank: '', group: EK ? 'MEMUR' : 'HEMŞİRE', il: '', mode: EK ? 'raw' : 'rank', kind: '', K: null, C0: '0',
    tab: 'gecmis', sel: null, place: null, q: '', sort: 'taban-asc', scope: 'group', page: 0, example: true, showAll: false,
    bolum: '', nkod: '', nhas: [], nstrict: false, nplace: 'all', bpage: 0, qyear: 'all' };
  const state = Object.assign({}, DEFAULTS, store.get(STORE_KEY, {}));
  if (EK) state.mode = 'raw';
  function save() {
    const keep = ['level', 'score', 'rank', 'group', 'il', 'mode', 'kind', 'K', 'C0', 'tab', 'sel', 'place', 'sort', 'scope', 'example', 'bolum', 'nkod', 'nhas', 'nstrict', 'nplace', 'qyear'];
    const o = {};
    for (const k of keep) o[k] = state[k];
    store.set(STORE_KEY, o);
  }
  function user() {
    const level = state.level;
    const m26 = model(level, CUR);
    const score = parseScore(state.score);
    let rank = parseIntTR(state.rank);
    let estimated = false;
    if (!rank && score != null && m26) { rank = Math.max(1, Math.round(rankOn(m26, score))); estimated = true; }
    if (rank && m26) rank = Math.min(rank, m26.n);
    const effScore = score != null ? score : (rank && m26 ? scoreOn(m26, rank) : null);
    return { level, score: effScore, rawScore: score, rank, estimated, n: m26 ? m26.n : null, m26 };
  }
  const grpIdx = () => (state.group ? (DIDX.grup.get(state.group) ?? -2) : -1);
  const ilIdx = () => (state.il ? (DIDX.il.get(state.il) ?? -2) : -1);
  const groupLabel = (g) => (g ? trTitle(g) : 'Tüm kadrolar');

  function threshold(p, level, u) {
    const lv = p.levels[level];
    if (!lv || u.score == null) return null;
    if (state.mode === 'raw' || !u.rank) return u.score;
    if (lv.scoreYear === CUR) return u.score;
    const m = model(level, lv.scoreYear);
    return m ? scoreOn(m, u.rank) : u.score;
  }
  function wq(arr, q) {
    let tot = 0; for (const a of arr) tot += a[1];
    let acc = 0;
    for (const a of arr) { acc += a[1]; if (acc >= q * tot - 1e-9) return a[0]; }
    return arr.length ? arr[arr.length - 1][0] : null;
  }
  function rowMatch(r, g, il) {
    if (g !== -1 && r[COL.grup] !== g) return false;
    if (il !== -1 && r[COL.il] !== il) return false;
    return true;
  }
  function placementStats(pi, level, u) {
    const p = P[pi];
    const lv = p.levels[level];
    if (!lv) return null;
    const g = grpIdx(), il = ilIdx();
    const thr = threshold(p, level, u);
    let pos = 0, filled = 0, reach = 0, near = 0, bos = 0;
    const tabs = [];
    for (let i = lv.rows[0]; i < lv.rows[1]; i++) {
      const r = R[i];
      if (!rowMatch(r, g, il)) continue;
      pos += r[COL.kont];
      if (r[COL.min] == null || r[COL.yer] <= 0) { bos += r[COL.kont]; continue; }
      filled += r[COL.yer];
      tabs.push([r[COL.min], r[COL.yer]]);
      if (thr != null) {
        if (thr >= r[COL.min]) reach += r[COL.yer];
        else if (thr >= r[COL.min] - NEAR) near += r[COL.yer];
      }
    }
    if (!pos) return null;
    tabs.sort((a, b) => a[0] - b[0]);
    return {
      pi, p, lv, pos, filled, reach, near, bos, thr,
      min: tabs.length ? tabs[0][0] : null, med: tabs.length ? wq(tabs, 0.5) : null, max: tabs.length ? tabs[tabs.length - 1][0] : null,
    };
  }
  function statusOf(st) {
    if (!st || st.thr == null || st.min == null) return 'none';
    if (st.thr >= st.med) return 'ok';
    if (st.thr >= st.min - NEAR) return 'warn';
    return 'bad';
  }
  const STATUS_TXT = { ok: 'Rahat', warn: 'Sınırda', bad: 'Yetmezdi', none: 'Veri yok' };

  // ---------------------------------------------------------------- senaryo modeli
  function scenarioFit(level, g) {
    const byCycle = new Map();
    P.forEach((p, pi) => {
      const lv = p.levels[level];
      if (!lv) return;
      const y = lv.scoreYear;
      const m = model(level, y);
      if (!m) return;
      let H = 0;
      const rk = [];
      for (let i = lv.rows[0]; i < lv.rows[1]; i++) {
        const r = R[i];
        if (g >= 0 && r[COL.grup] !== g) continue;
        if (r[COL.min] == null || r[COL.yer] <= 0) continue;
        H += r[COL.yer];
        rk.push([rankOn(m, r[COL.min]), r[COL.yer]]);
      }
      if (!H) return;
      if (!byCycle.has(y)) byCycle.set(y, []);
      byCycle.get(y).push({ pi, date: p.date, H, rk });
    });
    const pts = [];
    const cycleTotals = {};
    for (const [y, arr] of byCycle) {
      arr.sort((a, b) => (a.date < b.date ? -1 : 1));
      let C = 0;
      for (const a of arr) {
        C += a.H;
        if (!RECENCY[y] || a.H < 10) continue;
        a.rk.sort((u, v) => u[0] - v[0]);
        const rmax = wq(a.rk, 0.98), r50 = wq(a.rk, 0.5);
        pts.push({ pi: a.pi, y, H: a.H, C, rmax, r50, kmax: rmax / C, k50: r50 / C, w: Math.sqrt(a.H) * RECENCY[y] });
      }
      cycleTotals[y] = C;
    }
    if (pts.length < 2) return { pts, cycleTotals, ok: false };
    const fitOne = (key) => {
      const W = pts.reduce((s, p) => s + p.w, 0);
      const mu = pts.reduce((s, p) => s + p.w * Math.log(p[key]), 0) / W;
      const v = pts.reduce((s, p) => s + p.w * (Math.log(p[key]) - mu) ** 2, 0) / W;
      return { mu, sd: Math.max(0.25, Math.sqrt(v + 0.15 * 0.15)) };
    };
    return { pts, cycleTotals, ok: true, max: fitOne('kmax'), q50: fitOne('k50') };
  }
  function predict(fit, C, R0) {
    if (!fit || !fit.ok || !(C > 0) || !(R0 > 0)) return null;
    const lnC = Math.log(C), lnR = Math.log(R0), z90 = 1.2816;
    return {
      pmax: Phi((fit.max.mu + lnC - lnR) / fit.max.sd),
      p50: Phi((fit.q50.mu + lnC - lnR) / fit.q50.sd),
      rmax: Math.exp(fit.max.mu) * C, rmaxLo: Math.exp(fit.max.mu - z90 * fit.max.sd) * C, rmaxHi: Math.exp(fit.max.mu + z90 * fit.max.sd) * C,
      r50: Math.exp(fit.q50.mu) * C,
    };
  }
  const fitCache = { key: null, fit: null };
  function currentFit() {
    const key = state.level + '|' + state.group + '|' + calib.length + '|' + P.length;
    if (fitCache.key !== key) { fitCache.key = key; fitCache.fit = scenarioFit(state.level, grpIdx()); }
    return fitCache.fit;
  }
  function resetModels() { modelCache.clear(); fitCache.key = null; }
  function defaultK(fit) {
    if (!fit) return 1000;
    const ys = Object.keys(fit.cycleTotals).map(Number).filter((y) => RECENCY[y]).sort();
    const last = ys[ys.length - 1];
    return last ? Math.max(10, fit.cycleTotals[last]) : 1000;
  }
  function currentK(fit) { const k = parseIntTR(state.K); return k && k > 0 ? k : defaultK(fit); }
  const KMIN = 10, KMAX = 60000;
  const k2slider = (k) => Math.round(1000 * (Math.log10(Math.max(KMIN, Math.min(KMAX, k))) - Math.log10(KMIN)) / (Math.log10(KMAX) - Math.log10(KMIN)));
  const slider2k = (v) => {
    const k = 10 ** (Math.log10(KMIN) + (v / 1000) * (Math.log10(KMAX) - Math.log10(KMIN)));
    const mag = 10 ** Math.max(0, Math.floor(Math.log10(k)) - 1);
    return Math.round(k / mag) * mag;
  };

  // ---------------------------------------------------------------- form
  const elScore = $('#in-score'), elRank = $('#in-rank'), elGroup = $('#in-group'), elIl = $('#in-il');
  function fillGroups() {
    const L = LEVELS.indexOf(state.level);
    const cnt = new Map();
    for (let i = 0; i < R.length; i++) { const r = R[i]; if (r[COL.level] !== L) continue; cnt.set(r[COL.grup], (cnt.get(r[COL.grup]) || 0) + r[COL.kont]); }
    const list = [...cnt.entries()].sort((a, b) => b[1] - a[1]);
    const names = list.map(([gi]) => DICT.grup[gi]);
    if (state.group && !names.includes(state.group)) state.group = names[0] || '';
    elGroup.innerHTML = '<option value="">Tüm kadrolar</option>' + list.map(([gi, n]) =>
      `<option value="${esc(DICT.grup[gi])}">${esc(groupLabel(DICT.grup[gi]))} (${fInt(n)} kadro)</option>`).join('');
    elGroup.value = state.group || '';
    renderGroupChips();
  }
  // Kadro kısayolları: bölüm yazıldıysa bölümünün başvurabildiği kadrolar, yoksa en çok alım yapılanlar.
  const chipMemo = { key: null, val: null };
  function groupChipList() {
    const q = up(state.bolum).trim(), typed = typedCodes();
    const key = [state.level, q, typed.join(','), (state.nhas || []).join(','), R.length].join('|');
    if (chipMemo.key === key) return chipMemo.val;
    const cnt = new Map();
    if (NIT_PIDS.length && (q.length >= 3 || typed.some(isEduCode))) {
      for (const it of findKadros(NIT_PIDS, q, typed, { score: null })) {
        if (it.r && !it.missing.length) cnt.set(it.r[COL.grup], (cnt.get(it.r[COL.grup]) || 0) + it.r[COL.kont]);
      }
    }
    const fromBolum = cnt.size > 0;
    if (!fromBolum) {
      const L = LEVELS.indexOf(state.level);
      for (const r of R) if (r[COL.level] === L) cnt.set(r[COL.grup], (cnt.get(r[COL.grup]) || 0) + r[COL.kont]);
    }
    chipMemo.key = key;
    chipMemo.val = { fromBolum, groups: [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([gi]) => DICT.grup[gi]) };
    return chipMemo.val;
  }
  function renderGroupChips() {
    const { fromBolum, groups } = groupChipList();
    $('#group-chips').innerHTML = `<span class="chips-lbl">${fromBolum ? 'Bölümüne uygun:' : 'Sık seçilenler:'}</span>` + groups.slice(0, 6).map((g) =>
      `<button type="button" class="chip" data-group="${esc(g)}" aria-pressed="${g === state.group}">${esc(groupLabel(g))}</button>`).join('');
    const off = fromBolum && !!state.group && !groups.includes(state.group);
    const warn = $('#v-warn');
    warn.hidden = !off;
    warn.innerHTML = off ? `<b>${esc(groupLabel(state.group))}</b> kadroları bölümünle eşleşmiyor. Bölümüne uygun bir kadro seç: ${groups.slice(0, 3).map((g) =>
      `<button type="button" class="btn-link" data-group="${esc(g)}">${esc(groupLabel(g))}</button>`).join(', ')}.` : '';
  }
  function fillIl() {
    const iller = DICT.il.filter((x) => x).slice().sort((a, b) => a.localeCompare(b, 'tr'));
    elIl.innerHTML = '<option value="">Tüm iller</option>' + iller.map((x) => `<option value="${esc(x)}">${esc(trTitle(x))}</option>`).join('');
    elIl.value = state.il || '';
  }
  function fillKinds() {
    if (!$('#in-kind')) return;
    const kinds = [...new Set(P.map((p) => p.kind))].sort((a, b) => a.localeCompare(b, 'tr'));
    $('#in-kind').innerHTML = '<option value="">Tüm alım türleri</option>' + kinds.map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
    $('#in-kind').value = state.kind || '';
  }
  function syncSegs() {
    $$('#level-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === state.level)));
    $$('#mode-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
    $('#puan-tag').textContent = LV[state.level].puan;
  }

  // ---------------------------------------------------------------- sonuç kartı
  function verdictOf(p) {
    if (p == null) return { t: 'Sonuç için puanını yaz', c: 'none' };
    if (p >= 0.85) return { t: 'Yüksek ihtimal', c: 'ok' };
    if (p >= 0.6) return { t: 'İyi ihtimal', c: 'ok' };
    if (p >= 0.35) return { t: 'Orta ihtimal', c: 'warn' };
    if (p >= 0.15) return { t: 'Düşük ihtimal', c: 'bad' };
    return { t: 'Çok düşük ihtimal', c: 'bad' };
  }
  function gaugeSVG(p, cls, label = 'atanma ihtimali', fmt = fProb) {
    const cx = 110, cy = 110, r = 86, sw = 18;
    const pt = (t) => [cx + r * Math.cos(Math.PI * (1 - t)), cy - r * Math.sin(Math.PI * (1 - t))];
    const [x0, y0] = pt(0), [x1, y1] = pt(1);
    let s = `<svg viewBox="0 0 220 132" role="img" aria-label="${esc(label)} ${p == null ? 'hesaplanamadı' : esc(fmt(p))}">`;
    s += `<path d="M${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1}" fill="none" stroke="var(--line)" stroke-width="${sw}" stroke-linecap="round"/>`;
    if (p != null && p > 0.004) {
      const t = Math.max(0.01, Math.min(1, p));
      const [xe, ye] = pt(t);
      s += `<path d="M${x0} ${y0} A${r} ${r} 0 0 1 ${xe.toFixed(2)} ${ye.toFixed(2)}" fill="none" stroke="var(--${cls})" stroke-width="${sw}" stroke-linecap="round"/>`;
    }
    s += `<text x="${cx}" y="${cy - 14}" text-anchor="middle" font-size="40" font-weight="800" style="fill:var(--ink)">${p == null ? '–' : esc(fmt(p))}</text>`;
    s += `<text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="13" font-weight="600">${esc(label)}</text>`;
    s += `<text x="${x0}" y="${cy + 18}" text-anchor="middle" font-size="11">%0</text><text x="${x1}" y="${cy + 18}" text-anchor="middle" font-size="11">%100</text>`;
    return s + '</svg>';
  }
  function lastCycle(level) {
    let y = null;
    for (const p of P) { const lv = p.levels[level]; if (lv && lv.scoreYear < CUR && (y == null || lv.scoreYear > y)) y = lv.scoreYear; }
    return y;
  }
  function cycleAgg(level, y, u) {
    let reach = 0, filled = 0;
    P.forEach((p, pi) => {
      const lv = p.levels[level];
      if (!lv || lv.scoreYear !== y) return;
      const st = placementStats(pi, level, u);
      if (st) { filled += st.filled; reach += st.reach; }
    });
    return { reach, filled };
  }
  function renderVerdict(u) {
    if (EK) return renderEkVerdict(u);
    const fit = currentFit();
    const K = currentK(fit);
    const C0 = parseIntTR(state.C0) || 0;
    const gname = groupLabel(state.group);
    const pr = u.rank ? predict(fit, K + C0, u.rank) : null;
    const v = verdictOf(pr ? pr.pmax : null);
    $('#example-flag').hidden = !state.example;
    $('#v-body').hidden = !u.rank;
    $('#v-empty').innerHTML = u.rank ? '' : emptyHTML({ icon: 'edit', compact: true, title: 'Puanını yaz',
      text: 'Atanma ihtimalini hesaplamak için yukarıdaki <b>Bilgilerin</b> bölümüne 2026 KPSS puanını ya da başarı sıranı yaz.', actions: [['Puanını yaz', 'focus-score', true]] });
    $('#gauge').innerHTML = gaugeSVG(pr ? pr.pmax : null, v.c);
    const pill = $('#v-pill');
    pill.className = 'pill pill-lg ' + v.c;
    pill.textContent = v.t;
    const m26 = model(state.level, CUR);
    const sc = (r) => (m26 ? fSc(scoreOn(m26, r), 2) : '–');
    if (!u.rank) {
      $('#v-sentence').textContent = 'Puanını ya da başarı sıranı yazınca sonucun burada görünecek.';
      $('#v-sub').textContent = '';
    } else if (!pr) {
      $('#v-sentence').innerHTML = `<b>${esc(gname)}</b> için tahmin yapacak kadar geçmiş alım yok.`;
      $('#v-sub').innerHTML = 'Başka bir kadro seç ya da aşağıdaki geçmiş alımlara göz at. <button type="button" class="btn-link" data-act="focus-group">Kadro seç</button>';
    } else {
      $('#v-sentence').innerHTML = `<b>${esc(gname)}</b> kadrosuna 2026 puanlarıyla toplam <b>${fInt(K + C0)}</b> kişi alınırsa, tüm illeri tercih ettiğinde atanma ihtimalin <b>${fProb(pr.pmax)}</b>.`;
      $('#v-sub').textContent = `Kadroların yarısının tabanını geçme ihtimalin ${fProb(pr.p50)}. Tahmini en düşük taban yaklaşık ${sc(pr.rmax)} puan (${fInt(pr.rmax)}. sıra).`;
    }
    $('#k-label').textContent = `2026 puanlarıyla ${gname} kadrosuna kaç kişi alınırsa?`;
    if (document.activeElement !== $('#in-k')) $('#in-k').value = k2slider(K);
    $('#k-out').textContent = fInt(K) + ' kişi';
    const presets = [];
    if (fit && fit.pts.length) {
      const lastY = Math.max(...fit.pts.map((p) => p.y));
      fit.pts.filter((p) => p.y === lastY).sort((a, b) => b.H - a.H).slice(0, 2).forEach((p) => presets.push([P[p.pi].id + ' kadar', p.H]));
      Object.keys(fit.cycleTotals).map(Number).filter((y) => RECENCY[y]).sort((a, b) => b - a).slice(0, 2)
        .forEach((y) => presets.push([y + ' dönemi toplamı', fit.cycleTotals[y]]));
    }
    if (state.level === 'lisans' && state.group === 'HEMŞİRE') presets.push(['Basın tahmini · resmî değil', 17500]);
    const seen = new Set();
    $('#k-presets').innerHTML = presets.filter(([, val]) => (seen.has(val) ? false : seen.add(val))).map(([l, val]) =>
      `<button type="button" class="chip" data-k="${val}" aria-pressed="${val === K}">${esc(l)} · ${fInt(val)}</button>`).join('');
    const done26 = fit ? fit.cycleTotals[CUR] || 0 : 0;
    $('#k-hint').textContent = done26
      ? `Verilerde 2026 puanlarıyla bu kadroya şimdiye kadar ${fInt(done26)} kişi yerleşmiş; istersen bunu yaz.`
      : 'Örneğin KPSS-2026/2\'de bu kadrodan alım yapılırsa ve sonra Sağlık Bakanlığı alımı gelirse, ilkini buraya yaz.';
    const tiles = [];
    if (u.rank) {
      const pct = u.n ? u.rank / u.n : null;
      tiles.push(`<div class="stat"><span class="k">Başarı sıran</span><span class="v">${u.estimated ? '≈ ' : ''}${fInt(u.rank)}</span>
        <span class="d">${u.n ? fInt(u.n) + ' aday içinde ilk ' + fPct(pct, pct < 0.1 ? 1 : 0) : ''}${u.estimated ? ' · puanından tahmin' : ' · sonuç belgenden'}</span></div>`);
    } else {
      tiles.push('<div class="stat"><span class="k">Başarı sıran</span><span class="v">–</span><span class="d">Puanını yaz</span></div>');
    }
    const y = lastCycle(state.level);
    if (y && u.score != null) {
      const a = cycleAgg(state.level, y, u);
      tiles.push(`<div class="stat"><span class="k">${y} puanlarıyla yapılan alımlarda</span><span class="v">${fPct(a.filled ? a.reach / a.filled : null)}</span>
        <span class="d">${fInt(a.filled)} ${esc(low(gname))} kadrosunun ${fInt(a.reach)} tanesine yeterdi${state.il ? ' (' + esc(trTitle(state.il)) + ')' : ''}</span></div>`);
    } else {
      tiles.push('<div class="stat"><span class="k">Geçen dönem</span><span class="v">–</span><span class="d"></span></div>');
    }
    const m24 = model(state.level, 2024);
    if (u.rank && m24) {
      tiles.push(`<div class="stat"><span class="k">2024'teki karşılığın <details class="tip"><summary aria-label="Bu ne demek?">?</summary><div>Aynı başarı sırasının 2024 sınavındaki puan karşılığı. 2026'da sınava yaklaşık 230 bin kişi daha fazla girdiği için aynı sıra 2024'te daha düşük bir puana denk gelir.</div></details></span>
        <span class="v">${fSc(scoreOn(m24, u.rank), 2)}</span><span class="d">Aynı sıralama 2024 sınavında bu puana denk gelirdi</span></div>`);
    } else {
      tiles.push('<div class="stat"><span class="k">2024\'teki karşılığın</span><span class="v">–</span><span class="d"></span></div>');
    }
    $('#stats').innerHTML = tiles.join('');
    renderFormHints(u);
    renderProbChart();
  }
  function renderFormHints(u) {
    const lvl = LV[state.level];
    const bad = u.rawScore != null && (u.rawScore < (EK ? 0 : 40) || u.rawScore > 100);
    const sh = $('#score-hint');
    sh.className = 'hint' + (bad || (u.rawScore == null && state.score) ? ' err' : state.example ? ' ex' : '');
    sh.textContent = u.rawScore == null && state.score ? 'Puan anlaşılamadı; örnek: 81,73954'
      : bad ? (EK ? 'EKPSS puanı 100\'den büyük olamaz.' : 'KPSS puanları 40 ile 100 arasında olur.')
      : state.example ? 'Şu an örnek puan gösteriliyor; kendi puanını yaz.' : `Sonuç belgendeki ${lvl.puan} puanı`;
    const rh = $('#rank-hint');
    if (!rh) return;
    const m26 = model(state.level, CUR);
    rh.textContent = state.level === 'lisans'
      ? (parseIntTR(state.rank) ? `2026 Lisans'ta ${fInt(m26 ? m26.n : null)} aday var.` : 'Boş bırakırsan puanından tahmin ederiz.')
      : `${lvl.ad} 2026 sonuçları ${state.level === 'onlisans' ? '30 Ekim' : '19 Kasım'}'de açıklanacak; şimdilik tahmin 2024 verisine dayanıyor.`;
  }
  // EKPSS: sıralama modeli olmadığı için ihtimal yerine puanının son yerleştirmelerde bu kadronun kaç kadrosuna yettiği
  function renderEkVerdict(u) {
    $('#example-flag').hidden = !state.example;
    renderFormHints(u);
    const noScore = u.score == null;
    $('#v-body').hidden = noScore;
    $('#v-empty').innerHTML = noScore ? emptyHTML({ icon: 'edit', compact: true, title: 'Puanını yaz', actions: [['Puanını yaz', 'focus-score', true]],
      text: 'Geçmiş tabanlarla karşılaştırmak için yukarıdaki <b>Bilgilerin</b> bölümüne EKPSS puanını yaz.' }) : '';
    if (noScore) return;
    const gname = groupLabel(state.group);
    const list = visiblePlacements(u);
    const pill = $('#v-pill');
    if (!list.length) {
      $('#gauge').innerHTML = gaugeSVG(null, 'none', 'kadroya yeterdi', fPct);
      pill.className = 'pill pill-lg none';
      pill.textContent = 'Veri yok';
      $('#v-sentence').innerHTML = `<b>${esc(gname)}</b> için ${state.il ? esc(trTitle(state.il)) + ' ilinde ' : ''}geçmiş EKPSS yerleştirmesi bulunamadı.`;
      $('#v-sub').innerHTML = '<button type="button" class="btn-link" data-act="focus-group">Başka bir kadro seç</button>';
      $('#stats').innerHTML = '';
      return;
    }
    const share = (st) => (st.filled ? st.reach / st.filled : 0);
    const last = list[list.length - 1];
    const [txt, cls] = { ok: ['Puanın yeterdi', 'ok'], warn: ['Sınırda', 'warn'], bad: ['Puanın yetmezdi', 'bad'], none: ['Veri yok', 'none'] }[statusOf(last)];
    $('#gauge').innerHTML = gaugeSVG(share(last), cls, 'kadroya yeterdi', fPct);
    pill.className = 'pill pill-lg ' + cls;
    pill.textContent = txt;
    $('#v-sentence').innerHTML = `${esc(PFX + last.p.id)} yerleştirmesinde ${state.group ? `<b>${esc(gname)}</b> kadrolarının` : 'tüm kadroların'} <b>${fInt(last.reach)}</b> / ${fInt(last.filled)} tanesine (${fPct(share(last))}) puanın yeterdi.`;
    $('#v-sub').textContent = `En düşük taban ${fSc(last.min, 2)}, ortadaki taban ${fSc(last.med, 2)}. Bu yerleştirme ${last.lv.scoreYear} EKPSS puanlarıyla yapıldı; sınavlar yıldan yıla farklı olduğu için karşılaştırma yaklaşıktır.`;
    $('#stats').innerHTML = list.slice(-3).reverse().map((st) => `<div class="stat"><span class="k">${esc(PFX + st.p.id)} · ${st.lv.scoreYear} puanı</span>
      <span class="v">${fPct(share(st))}</span><span class="d">${fInt(st.reach)} / ${fInt(st.filled)} kadroya yeterdi · en düşük taban ${fSc(st.min, 2)}</span></div>`).join('');
  }

  // ---------------------------------------------------------------- geçmiş alımlar
  function visiblePlacements(u) {
    const out = [];
    P.forEach((p, pi) => {
      if (state.kind && p.kind !== state.kind) return;
      const st = placementStats(pi, state.level, u);
      if (st && st.filled > 0) out.push(st);
    });
    out.sort((a, b) => (a.p.date < b.p.date ? -1 : 1));
    return out;
  }
  function renderRangeChart(list, u) {
    const host = $('#range-chart');
    if (!list.length) {
      const acts = [];
      if (state.il) acts.push([trTitle(state.il) + ' filtresini kaldır', 'clear-il', true]);
      if (state.kind) acts.push(['Tüm alım türlerini göster', 'clear-kind', !acts.length]);
      acts.push(['Başka bir kadro seç', 'focus-group', !acts.length]);
      host.innerHTML = emptyHTML({ compact: true, flat: true, title: 'Geçmiş alım bulunamadı',
        text: `<b>${esc(groupLabel(state.group))}</b> için bu seçimle ${esc(LV[state.level].ad.toLocaleLowerCase('tr-TR'))} düzeyinde geçmiş yerleştirme yok.`, actions: acts });
      $('#range-legend').innerHTML = '';
      return;
    }
    const conv = (st, s) => (state.mode === 'rank' ? to2026(state.level, st.lv.scoreYear, s) : s);
    const pts = list.map((st) => ({ st, min: conv(st, st.min), med: conv(st, st.med), max: conv(st, st.max) }));
    const userY = u.score;
    let lo = Math.min(...pts.map((d) => d.min)), hi = Math.max(...pts.map((d) => d.max));
    if (userY != null) { lo = Math.min(lo, userY); hi = Math.max(hi, userY); }
    lo = Math.max(40, Math.floor(lo - 1)); hi = Math.min(100, Math.ceil(hi + 1));
    const W0 = host.clientWidth || 800;
    const step = 28, ml = 40, mr = 12, mt = 26, mb = 58;
    const W = Math.max(W0, ml + mr + pts.length * step);
    const H = 320, plotW = W - ml - mr, plotH = H - mt - mb;
    const x = (i) => ml + (i + 0.5) * (plotW / pts.length);
    const y = (v) => mt + (hi - v) / (hi - lo) * plotH;
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Yerleştirmelere göre taban puan aralıkları">`;
    const tickStep = hi - lo > 24 ? 5 : 2;
    for (let v = Math.ceil(lo / tickStep) * tickStep; v <= hi; v += tickStep) {
      s += `<line x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/>`;
      s += `<text x="${ml - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11">${v}</text>`;
    }
    let prev = null;
    pts.forEach((d, i) => {
      const yr = d.st.lv.scoreYear;
      if (yr !== prev) {
        const xx = ml + i * (plotW / pts.length);
        if (prev != null) s += `<line x1="${xx}" x2="${xx}" y1="${mt - 8}" y2="${H - mb}" stroke="var(--line)" stroke-width="2"/>`;
        s += `<text x="${xx + 5}" y="${mt - 10}" font-size="11" font-weight="700">${yr} puanı</text>`;
        prev = yr;
      }
    });
    if (userY != null) {
      s += `<rect x="${ml}" y="${y(userY) - 5}" width="${plotW}" height="10" rx="5" fill="var(--mark-soft)"/>`;
      s += `<line x1="${ml}" x2="${W - mr}" y1="${y(userY)}" y2="${y(userY)}" stroke="var(--mark)" stroke-width="3" stroke-linecap="round"/>`;
    }
    pts.forEach((d, i) => {
      const st = statusOf(d.st);
      const col = `var(--${st})`;
      const cx = x(i);
      const key = placeKey(d.st.p);
      if (state.sel === key) s += `<rect x="${cx - step / 2 + 2}" y="${mt}" width="${step - 4}" height="${plotH}" rx="6" fill="var(--brand-soft)"/>`;
      s += `<g class="col" data-sel="${esc(key)}" style="cursor:pointer">`;
      s += `<rect x="${cx - step / 2}" y="${mt}" width="${step}" height="${plotH}" fill="transparent"/>`;
      s += `<line x1="${cx}" x2="${cx}" y1="${y(d.max)}" y2="${y(d.min)}" stroke="${col}" stroke-opacity="0.35" stroke-width="9" stroke-linecap="round"/>`;
      s += `<circle cx="${cx}" cy="${y(d.min)}" r="3.2" fill="${col}"/>`;
      s += `<circle cx="${cx}" cy="${y(d.med)}" r="5.5" fill="var(--surface)" stroke="${col}" stroke-width="3"/>`;
      s += `<title>${PFX}${esc(d.st.p.id)} · ${esc(d.st.p.kind)} · ${fDate(d.st.p.date)}\n${fInt(d.st.filled)} kadro · en düşük taban ${fSc(d.st.min)}${state.mode === 'rank' && d.st.lv.scoreYear !== CUR ? ' (2026 karşılığı ' + fSc(d.min, 2) + ')' : ''}\nortadaki taban ${fSc(d.st.med)}</title>`;
      s += '</g>';
      s += `<text x="${cx}" y="${H - mb + 13}" font-size="10.5" text-anchor="end" transform="rotate(-50 ${cx} ${H - mb + 13})">${esc(d.st.p.id)}</text>`;
    });
    s += `<text x="${ml}" y="${H - 4}" font-size="11">${state.mode === 'rank' ? 'Puanlar 2026 ölçeğine çevrildi (aynı başarı sırasının 2026 karşılığı)' : 'Her alım kendi yılının puanıyla'}</text>`;
    host.innerHTML = s + '</svg>';
    $$('g.col', host).forEach((g) => g.addEventListener('click', () => { state.sel = g.dataset.sel; save(); renderGecmis(); }));
    $('#range-legend').innerHTML = `<span><i class="sw ok"></i>Ortadaki tabana yetiyor</span><span><i class="sw warn"></i>En düşük tabana yakın</span><span><i class="sw bad"></i>Yetmiyor</span><span><i class="sw mark"></i>Sen${userY != null ? ' · ' + fSc(userY, 2) : ''}</span>`;
  }
  function renderDetail(list) {
    const el = $('#range-detail');
    let st = list.find((s) => placeKey(s.p) === state.sel);
    if (!st && list.length) {
      const lastY = Math.max(...list.map((s) => s.lv.scoreYear));
      st = list.filter((s) => s.lv.scoreYear === lastY).reduce((a, b) => (b.filled > a.filled ? b : a));
      state.sel = placeKey(st.p);
    }
    if (!st) { el.innerHTML = ''; return; }
    const lv = st.lv;
    const conv = state.mode === 'rank' && lv.scoreYear !== CUR;
    const m = model(state.level, lv.scoreYear);
    const rmin = m ? rankOn(m, st.min) : null;
    const share = st.filled ? st.reach / st.filled : 0;
    const stt = statusOf(st);
    el.innerHTML = `<div class="detail-head"><div><b>${PFX}${esc(st.p.id)}</b> · ${esc(st.p.kind)} · ${fDate(st.p.date)} <span class="badge">${lv.scoreYear} puanı</span></div>
      <button class="btn-link" type="button" id="open-list">Kadroları gör →</button></div>
      <p>${esc(groupLabel(state.group))}${state.il ? ' · ' + esc(trTitle(state.il)) : ''}: <b>${fInt(st.filled)}</b> kadro. En düşük taban <b class="tnum">${fSc(st.min, 3)}</b>${rmin ? ' (yaklaşık ' + fInt(rmin) + '. sıra' + (conv ? ', 2026 karşılığı ' + fSc(to2026(state.level, lv.scoreYear, st.min), 2) : '') + ')' : ''}, ortadaki taban <b class="tnum">${fSc(st.med, 3)}</b>.</p>
      <p>${st.thr != null ? `<span class="pill ${stt}">${STATUS_TXT[stt]}</span> ${conv ? lv.scoreYear + ' ölçeğindeki karşılığın <span class="hl tnum">' + fSc(st.thr, 2) + '</span>' : 'Puanın <span class="hl tnum">' + fSc(st.thr, 2) + '</span>'} ile bu kadroların <b>${fInt(st.reach)}</b> tanesine (${fPct(share)}) yerleşebilirdin.` : 'Karşılaştırma için puanını yaz.'}</p>`;
    $('#open-list').addEventListener('click', () => openList(placeKey(st.p)));
  }
  function renderCards(list) {
    const rows = list.slice().reverse();
    const shown = state.showAll ? rows : rows.slice(0, 9);
    $('#pl-cards').innerHTML = shown.map((st) => {
      const share = st.filled ? st.reach / st.filled : 0;
      const nshare = st.filled ? st.near / st.filled : 0;
      const stt = statusOf(st);
      const key = placeKey(st.p);
      const conv = state.mode === 'rank' && st.lv.scoreYear !== CUR;
      return `<article class="card pl-card${state.sel === key ? ' sel' : ''}" data-sel="${esc(key)}" tabindex="0">
        <div class="pl-top"><div><strong>${PFX}${esc(st.p.id)}</strong><span class="kind">${esc(st.p.kind)} · ${fDate(st.p.date)}</span></div><span class="badge">${st.lv.scoreYear} puanı</span></div>
        <dl class="pl-nums">
          <div><dt>Kadro</dt><dd>${fInt(st.filled)}${st.bos ? '<small>+' + fInt(st.bos) + ' boş kaldı</small>' : ''}</dd></div>
          <div><dt>En düşük taban</dt><dd>${fSc(st.min, 2)}${conv ? '<small>2026: ' + fSc(to2026(state.level, st.lv.scoreYear, st.min), 2) + '</small>' : ''}</dd></div>
          <div><dt>Ortadaki taban</dt><dd>${fSc(st.med, 2)}</dd></div>
        </dl>
        <div class="bar" aria-hidden="true"><i style="width:${(100 * share).toFixed(1)}%"></i><i style="left:${(100 * share).toFixed(1)}%;width:${(100 * nshare).toFixed(1)}%"></i></div>
        <p class="pl-you"><span class="pill ${stt}">${STATUS_TXT[stt]}</span><span>${fInt(st.filled)} kadronun <b>${fInt(st.reach)}</b> tanesine yeterdi (${fPct(share)})</span></p>
        <button class="btn-link" type="button" data-open="${esc(key)}">Kadroları gör →</button>
      </article>`;
    }).join('');
    const more = $('#more-cards');
    more.hidden = rows.length <= 9;
    more.textContent = state.showAll ? 'Daha az göster' : `Tüm alımları göster (${rows.length})`;
    $$('#pl-cards [data-open]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openList(b.dataset.open); }));
    $$('#pl-cards .pl-card').forEach((c) => {
      const pick = () => { state.sel = c.dataset.sel; save(); renderGecmis(); goTo($('#range-chart'), true); };
      c.addEventListener('click', pick);
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
  }
  function renderHemsire() {
    const card = $('#hemsire-card');
    if (!card) return;
    const show = HT && state.level === 'lisans' && state.group === 'HEMŞİRE';
    card.hidden = !show;
    if (!show) return;
    $('#hemsire-src').textContent = HT.kaynak + '. 2018 ve sonrası satırlar ÖSYM belgeleriyle doğrulandı (kadro sayıları ve en düşük tabanlar birebir aynı).';
    let h = '<thead><tr><th>Alım</th><th>Tarih</th><th class="r">Toplam kadro</th><th class="r">Lisans kadro</th><th class="r">Hemşire</th><th class="r">Lisans içinde</th><th class="r">En düşük taban</th></tr></thead><tbody>';
    for (const c of HT.donguler) {
      h += `<tr class="group-row"><td colspan="2">${esc(c.puan)} <span class="small muted" style="font-weight:400">${esc(c.not)}</span></td><td class="r num">${fInt(c.toplam)}</td><td class="r num">${fInt(c.lisans)}</td><td class="r num">${fInt(c.hemsire)}</td><td class="r num">${fPct(c.hemsire / c.lisans)}</td><td></td></tr>`;
      for (const r of c.satirlar) {
        h += `<tr><td>${esc(r[0])}</td><td class="small num">${esc(r[1] || '')}</td><td class="r num">${fInt(r[2])}</td><td class="r num">${fInt(r[3])}</td><td class="r num"><b>${fInt(r[4])}</b></td><td class="r num">${r[3] ? fPct(r[4] / r[3]) : ''}</td><td class="r num">${r[5] == null ? '' : fSc(r[5])}</td></tr>`;
      }
    }
    $('#tbl-hemsire').innerHTML = h + '</tbody>';
  }
  function renderGecmis() {
    const u = user();
    const list = visiblePlacements(u);
    $('#gecmis-title').textContent = `${groupLabel(state.group)} · ${LV[state.level].ad}: geçmiş alımlarda taban puanlar`;
    renderRangeChart(list, u);
    renderDetail(list);
    renderCards(list);
    renderHemsire();
  }

  // ---------------------------------------------------------------- ihtimal grafiği (sonuç kartında, açılınca çizilir)
  function renderProbChart() {
    if (EK || !$('#prob-more').open) return;
    const u = user();
    const fit = currentFit();
    const K = currentK(fit);
    const C0 = parseIntTR(state.C0) || 0;
    const gname = groupLabel(state.group);
    if (!fit || !fit.ok) {
      $('#prob-chart').innerHTML = emptyHTML({ icon: 'info', compact: true, flat: true, title: 'Yeterli geçmiş alım yok', text: `<b>${esc(gname)}</b> için ihtimal grafiği çizilemiyor.` });
      $('#scen-kv').innerHTML = '';
      return;
    }
    const pr = u.rank ? predict(fit, K + C0, u.rank) : null;
    const m26 = model(state.level, CUR);
    const s = (r) => (m26 ? fSc(scoreOn(m26, r), 2) : '–');
    $('#scen-kv').innerHTML = pr ? `<dt>Başarı sıran</dt><dd>${fInt(u.rank)}${u.estimated ? ' (tahmini)' : ''}</dd>
      <dt>Toplam ${esc(gname)} kadrosu</dt><dd>${fInt(K + C0)}</dd>
      <dt>Tüm illeri tercih eden için</dt><dd>${fProb(pr.pmax)}</dd>
      <dt>Tipik kadro için</dt><dd>${fProb(pr.p50)}</dd>
      <dt>Tahmini en düşük taban</dt><dd>≈ ${s(pr.rmax)} puan · ${fInt(pr.rmax)}. sıra</dd>
      <dt>%80 güven aralığı</dt><dd>${s(pr.rmaxLo)} – ${s(pr.rmaxHi)} puan</dd>
      <dt>Tahmini ortadaki taban</dt><dd>≈ ${s(pr.r50)} puan</dd>` : '<dt>Durum</dt><dd>Puanını yaz</dd>';
    const host = $('#prob-chart');
    if (u.rank) {
      const W = Math.max(300, host.clientWidth || 560), H = 240, ml = 40, mr = 14, mt = 12, mb = 38;
      const pw = W - ml - mr, ph = H - mt - mb;
      const kmin = 100, kmax = Math.max(50000, K * 1.5);
      const lx = (k) => ml + (Math.log10(k) - Math.log10(kmin)) / (Math.log10(kmax) - Math.log10(kmin)) * pw;
      const ly = (p) => mt + (1 - p) * ph;
      let g = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kadro sayısına göre atanma ihtimali">`;
      [0, 0.25, 0.5, 0.75, 1].forEach((p) => { g += `<line x1="${ml}" x2="${W - mr}" y1="${ly(p)}" y2="${ly(p)}" stroke="var(--line)"/><text x="${ml - 6}" y="${ly(p) + 4}" text-anchor="end" font-size="11">%${p * 100}</text>`; });
      [100, 300, 1000, 3000, 10000, 30000].filter((k) => k <= kmax).forEach((k) => { g += `<line x1="${lx(k)}" x2="${lx(k)}" y1="${mt}" y2="${H - mb}" stroke="var(--line)"/><text x="${lx(k)}" y="${H - mb + 15}" text-anchor="middle" font-size="11">${k >= 1000 ? F0.format(k / 1000) + ' bin' : k}</text>`; });
      const path = (key) => { let d = ''; for (let i = 0; i <= 80; i++) { const k = 10 ** (Math.log10(kmin) + i / 80 * (Math.log10(kmax) - Math.log10(kmin))); d += (i ? 'L' : 'M') + lx(k).toFixed(1) + ' ' + ly(predict(fit, k + C0, u.rank)[key]).toFixed(1); } return d; };
      g += `<path d="${path('p50')}" fill="none" stroke="var(--ok)" stroke-width="2.5"/><path d="${path('pmax')}" fill="none" stroke="var(--brand)" stroke-width="2.5"/>`;
      const xk = lx(Math.min(kmax, Math.max(kmin, K)));
      g += `<line x1="${xk}" x2="${xk}" y1="${mt}" y2="${H - mb}" stroke="var(--mark)" stroke-width="3"/>`;
      if (pr) g += `<circle cx="${xk}" cy="${ly(pr.pmax)}" r="5" fill="var(--brand)" stroke="var(--surface)" stroke-width="2"/><circle cx="${xk}" cy="${ly(pr.p50)}" r="5" fill="var(--ok)" stroke="var(--surface)" stroke-width="2"/>`;
      g += `<text x="${ml}" y="${H - 4}" font-size="11">Açılan kadro sayısı (logaritmik)</text>`;
      host.innerHTML = g + '</svg>';
    } else host.innerHTML = '';
  }
  // Yöntem sekmesi: modelin dayandığı geçmiş alımlar
  function renderModelTable() {
    const fit = currentFit();
    const gname = groupLabel(state.group);
    $('#ihtimal-title').textContent = `Modelin dayandığı geçmiş alımlar · ${gname} (${LV[state.level].ad})`;
    if (!fit || !fit.ok) {
      $('#scen-note').textContent = `${gname} için tahmin yapacak kadar geçmiş alım yok.`;
      $('#tbl-scen').innerHTML = '';
      return;
    }
    $('#scen-note').textContent = `Geçmiş dönemlerde en düşük tabanın başarı sırası, o döneme kadar bu kadroya yerleşen kişi sayısının ortalama ${F1.format(Math.exp(fit.max.mu))} katı oldu (${fit.pts.length} alım). Nitelik şartları ve il tercihleri modele girmez; "tüm illeri tercih eden" en iyimser senaryodur.`;
    let h = '<thead><tr><th>Alım</th><th>Tür</th><th class="r">Puan yılı</th><th class="r">Bu alımda</th><th class="r">Dönem toplamı</th><th class="r">En düşük taban sırası</th><th class="r">Oran</th></tr></thead><tbody>';
    fit.pts.slice().sort((a, b) => (P[b.pi].date < P[a.pi].date ? -1 : 1)).forEach((p) => {
      h += `<tr><td data-label="Alım" class="wide"><b>${PFX}${esc(P[p.pi].id)}</b> <span class="small muted">${fDate(P[p.pi].date)}</span></td><td data-label="Tür">${esc(P[p.pi].kind)}</td><td data-label="Puan yılı" class="r num">${p.y}</td><td data-label="Bu alımda" class="r num">${fInt(p.H)}</td><td data-label="Dönem toplamı" class="r num">${fInt(p.C)}</td><td data-label="En düşük taban sırası" class="r num">${fInt(p.rmax)}</td><td data-label="Oran" class="r num">${F1.format(p.kmax)}</td></tr>`;
    });
    $('#tbl-scen').innerHTML = h + '</tbody>';
  }

  // ---------------------------------------------------------------- nitelik şartları
  const NIT_GUIDE = [
    { k: 'edu', ad: 'Mezuniyet (bölüm / alan)', cls: 'edu', test: (t) => /mezun/i.test(t),
      nasil: 'İlgili bölüm ya da alandan mezun olmak gerekir. Birden fazla bölüm yazıyorsa birinden mezun olman yeterli. Tercih tarihinde mezun olmuş olman şart.' },
    { k: 'bilgisayar', ad: 'Bilgisayar işletmenliği sertifikası', cls: 'cert', test: (t) => /bilgisayar işletmenliği sertifika/i.test(t),
      nasil: 'MEB onaylı olmalı. Halk Eğitim Merkezlerinin ücretsiz kurslarından ya da MEB\'e bağlı özel kurslardan alınır; kurs bitirme belgeni e-Devlet\'ten kontrol edebilirsin. Tercihlerin son gününe kadar alınmış olmalı.' },
    { k: 'surucu', ad: 'Sürücü belgesi', cls: 'cert', test: (t) => /sürücü belgesi/i.test(t),
      nasil: 'İstenen sınıfta (ör. B, C, D) sürücü belgesi gerekir; sürücü kursu ve MEB sürücü sınavlarıyla alınır. Bazı kadrolar belgenin en az 5 yıllık olmasını ister. Tercihlerin son günü itibarıyla sahip olmalısın.' },
    { k: 'guvenlik', ad: 'Özel güvenlik kimlik kartı', cls: 'cert', test: (t) => /güvenlik görevlisi kimlik/i.test(t),
      nasil: 'Özel güvenlik temel eğitimini tamamlayıp Emniyet Genel Müdürlüğünün özel güvenlik sınavını geçenlere verilir. Kartın tercih tarihinde geçerli olması gerekir.' },
    { k: 'dil', ad: 'Yabancı dil puanı', cls: 'cert', test: (t) => /\bYDS\b|yabancı dil|dil yeterli/i.test(t),
      nasil: 'ÖSYM\'nin YDS / e-YDS sınavlarından ya da eşdeğer sayılan sınavlardan istenen düzeyde puan: A 90–100, B 80–89, C 70–79, D 60–69, E 50–59. Çoğu kadroda son 5 yıl içinde alınmış olmalı.' },
    { k: 'ruhsat', ad: 'Ruhsat / meslek belgesi', cls: 'cert', test: (t) => /ruhsat/i.test(t),
      nasil: 'Mesleğin yasal belgesi gerekir; örneğin avukatlık ruhsatı hukuk mezuniyeti ve avukatlık stajının tamamlanmasıyla alınır.' },
    { k: 'sertifika', ad: 'Diğer sertifika ve belgeler', cls: 'cert', test: (t) => /sertifika|belgesi|belgeye/i.test(t),
      nasil: 'Kılavuzda yazan kurumdan (çoğunlukla MEB onaylı kurslar ya da ilgili bakanlık) alınan belge gerekir. Tercihlerin son gününe kadar alınmış olmalı.' },
    { k: 'cinsiyet', ad: 'Cinsiyet', cls: 'fixed', test: (t) => /cinsiyet/i.test(t),
      nasil: 'Kadroya özel bir şarttır; sonradan sağlanamaz.' },
    { k: 'ozel', ad: 'Kurumun özel şartları', cls: 'info', test: (t) => /bakınız/i.test(t),
      nasil: 'Ayrıntı tercih kılavuzunun "Başvurma Özel Şartları" bölümünde yazar (yaş, boy-kilo, sağlık, askerlik, ikamet gibi). Tercihten önce mutlaka oku.' },
    { k: 'kosul', ad: 'Çalışma koşulu (bilgi)', cls: 'info', test: (t) => /vardiya|nöbet|arazi|seyahat|uygulanmaktadır/i.test(t),
      nasil: 'Bir belge şartı değil; kadronun çalışma düzenini bildirir (ör. vardiyalı çalışma).' },
    { k: 'diger', ad: 'Diğer şartlar', cls: 'info', test: () => true,
      nasil: 'Kılavuzdaki açıklamayı dikkatle oku; şartı belgeyle kanıtlayabilmen gerekir.' },
  ];
  const catMemo = new Map();
  function catOf(text) {
    let c = catMemo.get(text);
    if (!c) { c = NIT_GUIDE.find((g) => g.test(text || '')); catMemo.set(text, c); }
    return c;
  }
  const NIT_PIDS = Object.keys(NIT).sort((a, b) => (a < b ? 1 : -1));
  const nitIndex = {};
  function rowIndexFor(pid) {
    if (nitIndex[pid]) return nitIndex[pid];
    const map = new Map();
    const pi = P.findIndex((p) => p.id === pid && !p.user);
    if (pi >= 0) for (const lv of Object.values(P[pi].levels)) for (let i = lv.rows[0]; i < lv.rows[1]; i++) map.set(R[i][COL.kod], i);
    nitIndex[pid] = map;
    return map;
  }
  function nitShort(text) {
    const g = String(text || '').match(/herhangi bir (lisans|önlisans) program/i);
    if (g) return 'Herhangi bir ' + low(g[1]) + ' bölümü';
    if (/herhangi bir alanından/i.test(text)) return 'Herhangi bir lise alanı';
    const t = String(text || '').replace(/\s*mezun olmak\.?$/i, '').replace(/\s*sahibi olmak\.?$/i, '')
      .replace(/ lisans programından| önlisans programından| lisans programlarının birinden| önlisans programlarının birinden/gi, '');
    return t.length > 60 ? t.slice(0, 58) + '…' : t;
  }
  // mine: kullanıcının karşıladığı mezuniyet kodları, q: aranan bölüm (büyük harf) — verilirse o şart "✓ bölüm adı" olarak yazılır
  function reqChips(pid, kod, mine = null, q = '') {
    const n = NIT[pid];
    if (!n) return '';
    const codes = n.kodlar[kod] || [];
    if (!codes.length) return '<span class="small muted">Kılavuzda şart kodu yok</span>';
    return '<div class="req">' + codes.map((c) => {
      const txt = n.sozluk[String(c)] || ('Kod ' + c);
      const cat = catOf(txt);
      if (mine && mine.has(c)) {
        const names = progNames(txt);
        const name = (q && (names.find((p) => up(p) === q) || names.find((p) => up(p).startsWith(q)))) || nitShort(txt);
        return `<span class="req-chip ok" title="${esc(c + ' · ' + txt)}">✓ ${esc(name)}</span>`;
      }
      const label = cat.k === 'ozel' ? 'Özel şart: ' + txt.replace(/^Bakınız:\s*Başvurma Özel Şartları\s*-\s*/i, '') : nitShort(txt);
      return `<span class="req-chip ${cat.cls}" title="${esc(c + ' · ' + txt + ' — Nasıl sağlanır: ' + cat.nasil)}">${esc(label)}</span>`;
    }).join('') + '</div>';
  }
  function renderNitelik() {
    const sel = $('#in-nplace');
    if (!state.nplace || (state.nplace !== 'all' && !NIT[state.nplace])) state.nplace = 'all';
    sel.innerHTML = `<option value="all">Son ${NIT_PIDS.length} kılavuzun tümü</option>` + NIT_PIDS.map((pid) => { const p = P.find((x) => x.id === pid && !x.user); return `<option value="${esc(pid)}">${PFX}${esc(pid)}${p ? ' · ' + esc(p.kind) : ''}</option>`; }).join('');
    sel.value = state.nplace;
    $('#in-nstrict').checked = !!state.nstrict;
    renderBolum();
    renderGroupReqs();
    $('#nit-guide').innerHTML = NIT_GUIDE.filter((g) => g.k !== 'diger').map((g) =>
      `<div class="guide"><h4><span class="req-chip ${g.cls}">${esc(g.ad)}</span></h4><p>${esc(g.nasil)}</p></div>`).join('');
  }
  const scopePids = () => (state.nplace && state.nplace !== 'all' && NIT[state.nplace] ? [state.nplace] : NIT_PIDS);
  const isEduCode = (c) => '234'.includes(String(c)[0]);
  const isHard = (txt) => !['ozel', 'kosul', 'diger', 'edu'].includes(catOf(txt).k);
  // "Bilgilerin" formundaki belge seçimi: bu düzeyde en çok istenen belge şartları (düzey başına bir kez sayılır).
  const docMemo = {};
  function docCounts(level) {
    if (docMemo[level]) return docMemo[level];
    const lv = LV[level];
    const cnt = new Map();
    for (const pid of NIT_PIDS) {
      const n = NIT[pid];
      for (const [kod, codes] of Object.entries(n.kodlar)) {
        if (kod[0] !== lv.kodBas) continue;
        for (const c of codes) {
          if (isEduCode(c)) continue;
          const t = n.sozluk[String(c)];
          if (!t || !isHard(t)) continue;
          const e = cnt.get(c) || { n: 0, t };
          e.n++;
          cnt.set(c, e);
        }
      }
    }
    return (docMemo[level] = [...cnt.entries()].sort((a, b) => b[1].n - a[1].n));
  }
  function renderHasChips() {
    const have = new Set((state.nhas || []).map(Number));
    const all = docCounts(state.level);
    const top = all.slice(0, 10).concat(all.slice(10).filter(([c]) => have.has(c)));
    const short = (t) => { const s = nitShort(t).replace(/\.$/, ''); return s.length > 40 ? s.slice(0, 38) + '…' : s; };
    $('#nhas-chips').innerHTML = top.length ? top.map(([c, e]) =>
      `<button type="button" class="chip doc" data-has="${c}" aria-pressed="${have.has(c)}" title="${esc(c + ' · ' + e.t)}">${esc(short(e.t))} · ${c}</button>`).join('')
      : '<span class="small muted">Bu düzeyde belge şartı bulunmadı.</span>';
    $('#docs-sum').textContent = 'Sahip olduğun belge ve şartları seç' + (have.size ? ` · ${have.size} seçili` : '');
  }
  const typedCodes = () => (String(state.nkod || '').match(/\d{4}/g) || []).map(Number);
  // Bölüm adını bu düzeyin mezuniyet kodlarıyla eşleştirir (tüm kılavuzlar; kod numaraları kılavuzlar arasında ortak).
  const bolumMemo = { key: null, map: null };
  function matchBolum(q) {
    const lv = LV[state.level];
    const key = state.level + '|' + q;
    if (bolumMemo.key === key) return bolumMemo.map;
    const found = new Map();
    if (q.length >= 3) {
      for (const pid of NIT_PIDS) {
        for (const [c, t] of Object.entries(NIT[pid].sozluk)) {
          if (c[0] !== lv.edu || c === String(lv.generic) || found.has(+c)) continue;
          const rank = progRank(t, q);
          if (rank >= 0) found.set(+c, [rank, t]);
        }
      }
    }
    // Bölüm adı tam yazıldıysa ("İşletme") yalnız bu programı içeren kodlar; yarım yazıldıysa ("Hemşire") bu adla başlayanlar.
    // Sıra: en alakalı önce (aranan adla başlayan programı çok olan, sonra kısa açıklamalı kodlar)
    const exact = [...found.values()].some(([r]) => r < 1);
    const map = new Map([...found.entries()].filter(([, [r]]) => !exact || r < 1)
      .sort((a, b) => a[1][0] - b[1][0] || a[1][1].length - b[1][1].length).map(([c, [, t]]) => [c, t]));
    bolumMemo.key = key;
    bolumMemo.map = map;
    return map;
  }
  // Bölümden eşleşen + elle yazılan mezuniyet kodları (kod → açıklama)
  function eduMatches(q, typed) {
    const map = new Map(matchBolum(q));
    for (const c of typed.filter(isEduCode)) {
      if (map.has(c)) continue;
      const pid = NIT_PIDS.find((p) => NIT[p].sozluk[String(c)]);
      map.set(c, pid ? NIT[pid].sozluk[String(c)] : 'Kod ' + c);
    }
    return map;
  }
  function renderBolumHint() {
    const el = $('#bolum-hint');
    const q = up(state.bolum).trim(), typed = typedCodes();
    el.className = 'hint';
    if (q.length < 3 && !typed.some(isEduCode)) {
      el.textContent = q ? 'En az 3 harf yaz.' : 'Bölüm adını tercih kılavuzundaki mezuniyet kodlarıyla eşleştiririz.';
      return;
    }
    const m = [...eduMatches(q, typed).entries()];
    if (!m.length) {
      const sug = q.length >= 3 ? suggestBolum(q) : [];
      el.className = 'hint err';
      el.innerHTML = 'Bu adla bölüm bulunamadı. ' + (sug.length
        ? 'Bunu mu demek istedin: ' + sug.map((p) => `<button type="button" class="btn-link" data-act="set-bolum" data-val="${esc(p)}">${esc(p)}</button>`).join(', ') + '?'
        : 'Yazımı kontrol et ya da mezuniyet kodunu yaz (ör. 4605).');
      return;
    }
    if (q.length < 3) {
      el.innerHTML = 'Mezuniyet kodun: ' + m.slice(0, 2).map(([c, t]) => `<b>${c}</b> ${esc(nitShort(t))}`).join(' · ');
      return;
    }
    const names = new Set();
    for (const [, tx] of m) for (const p of progNames(tx)) if (up(p).startsWith(q)) names.add(p);
    const exactName = [...names].find((p) => up(p) === q);
    const shown = exactName ? [exactName] : [...names].slice(0, 3);
    el.innerHTML = `Eşleşen bölüm: ${shown.map((p) => `<b>${esc(p)}</b>`).join(', ')}${!exactName && names.size > 3 ? ` ve ${names.size - 3} bölüm daha` : ''}`
      + ` · ${m.length} mezuniyet kodu (${m.slice(0, 4).map(([c]) => c).join(', ')}${m.length > 4 ? '…' : ''})`;
  }
  // Mezuniyet açıklamasındaki program adları ("A, B veya C lisans programlarının birinden mezun olmak" → [A, B, C])
  function progNames(text) {
    const body = String(text || '').replace(/ortaöğretim kurumlarının/i, '').replace(/\s*(lisans|önlisans|ön lisans)?\s*program(lar)?(ının birinden|ından)?\s*mezun olmak\.?$/i, '')
      .replace(/\s*(dalının|dalından|alanının|alanından)\s*(birinden)?\s*mezun olmak\.?$/i, '');
    return body.split(/,\s*|\s+veya\s+|\s+ya da\s+|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  }
  // Program adlarından biri aranan kelimeyle BAŞLIYORSA eşleşir ("İşletme" → İşletme, İşletme-Ekonomi; Gemi Makineleri İşletme Müh. değil).
  // 0 = adı birebir aynı, 1 = adı bununla başlıyor, -1 = eşleşmiyor
  // Küçük değer = daha alakalı: adı birebir aynı olan program varsa 0'a, aranan adla başlayan program sayısı arttıkça aşağı yakın.
  function progRank(text, q) {
    let exact = false, hits = 0;
    for (const p of progNames(text)) {
      const u = up(p);
      if (!u.startsWith(q)) continue;
      hits++;
      if (u === q) exact = true;
    }
    return hits ? (exact ? 0 : 1) + 1 / (1 + hits) : -1;
  }
  const progMatch = (text, q) => progRank(text, q) >= 0;
  // Yazım hatasına öneri: bu düzeyin program adları içinde en yakın 3 ad (ör. "Hemşirlik" → Hemşirelik)
  const namesMemo = {};
  function suggestBolum(q) {
    const lv = LV[state.level];
    if (!namesMemo[state.level]) {
      const set = new Set();
      for (const pid of NIT_PIDS) for (const [c, t] of Object.entries(NIT[pid].sozluk)) if (c[0] === lv.edu && c !== String(lv.generic)) progNames(t).forEach((p) => { if (p.length >= 3 && p.length <= 60) set.add(p); });
      namesMemo[state.level] = [...set];
    }
    const lev = (a, b) => {
      let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
      for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
      }
      return prev[b.length];
    };
    const tol = Math.max(1, Math.floor(q.length / 4));
    return namesMemo[state.level].map((p) => {
      const u = up(p);
      const d = Math.min(lev(q, u.slice(0, q.length)), lev(q, u.slice(0, q.length + 1)), lev(q, u.slice(0, Math.max(1, q.length - 1))));
      return [p, d + (u.length - q.length) / 200];
    }).filter(([, d]) => d <= tol + 0.99).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([p]) => p);
  }
  function renderBolum() {
    const card = $('#bolum-card'), info = $('#bolum-codes'), emp = $('#bolum-empty');
    const bolum = String(state.bolum || '').trim();
    const q = up(bolum);
    const typed = typedCodes();
    const docs = (state.nhas || []).length;
    $('#nit-using').innerHTML = `<span>Bölüm: <b>${esc(bolum || '—')}</b></span><span>Kodlar: <b>${typed.length ? esc(typed.join(', ')) : '—'}</b></span><span>Belgeler: <b>${docs ? fInt(docs) + ' seçili' : '—'}</b></span><button type="button" class="btn-link" data-act="focus-bolum">Bilgilerini değiştir</button>`;
    const stop = (html) => { card.hidden = true; info.textContent = ''; emp.innerHTML = html; };
    if (q.length < 3 && !typed.some(isEduCode)) {
      return stop(emptyHTML({ icon: 'edit', compact: true, title: 'Bölümünü yaz',
        text: 'Başvurabileceğin kadroları görmek için yukarıdaki <b>Bilgilerin</b> bölümüne mezun olduğun bölümü ya da mezuniyet nitelik kodunu yaz.', actions: [['Bölümünü yaz', 'focus-bolum', true]] }));
    }
    const all = findKadros(scopePids(), q, typed, user());
    const matchedAll = eduMatches(q, typed);
    const items = state.nstrict ? all.filter((it) => !it.missing.length) : all;
    if (!items.length) {
      const acts = [];
      if (state.nstrict && all.length) acts.push(['Eksik şartlı kadroları da göster', 'nit-loose', true]);
      if (state.nplace !== 'all') acts.push(['Tüm kılavuzlarda ara', 'nit-all', !acts.length]);
      acts.push(['Bölümünü düzelt', 'focus-bolum', !acts.length]);
      return stop(emptyHTML({ title: 'Sonuç yok', actions: acts,
        text: matchedAll.size ? 'Seçtiğin kılavuzlarda bölümünle başvurabileceğin kadro bulunamadı.' : `<b>“${esc(bolum)}”</b> adında bir bölüm bulamadık; yazımı kontrol et ya da mezuniyet kodunu yaz.` }));
    }
    emp.innerHTML = '';
    const order = { ok: 0, warn: 1, bad: 2, none: 3 };
    const tb = (it) => (it.r && it.r[COL.min] != null ? it.r[COL.min] : 999);
    items.sort((a, b) => ((a.missing.length > 0) - (b.missing.length > 0)) || (order[a.reach] - order[b.reach]) || (b.own - a.own) || (tb(a) - tb(b)));
    const ok = items.filter((i) => !i.missing.length);
    const okReach = ok.filter((i) => i.reach === 'ok').length;
    const codesTxt = [...matchedAll.entries()].slice(0, 5).map(([c, t]) => `<b>${c}</b> (${esc(nitShort(t))})`).join(', ');
    info.innerHTML = (matchedAll.size ? 'Mezuniyet kodun: ' + codesTxt + (matchedAll.size > 5 ? ' ve ' + (matchedAll.size - 5) + ' kod daha' : '') + '. ' : 'Eşleşen mezuniyet kodu bulunamadı; yalnız her bölüme açık kadrolar listelendi. ')
      + `<b>${fInt(ok.length)}</b> kadronun tüm şartlarını sağlıyorsun; bunların <b>${fInt(okReach)}</b> tanesinde ${state.mode === 'rank' ? 'sıralaman' : 'puanın'} o dönemin tabanını geçiyordu.`
      + (items.length > ok.length ? ` ${fInt(items.length - ok.length)} kadroda eksik şartın var (kırmızı).` : '');
    card.hidden = !items.length;
    const per = 50, pages = Math.max(1, Math.ceil(items.length / per));
    state.bpage = Math.min(state.bpage, pages - 1);
    const REACH = { ok: 'Puanın yeterdi', warn: 'Sınırda', bad: 'Puanın yetmezdi', none: '–' };
    let h = '<thead><tr><th>Kadro</th><th>Kurum · il</th><th class="r">Kont.</th><th class="r">Taban</th><th>Şartlar</th><th>Durum</th></tr></thead><tbody>';
    for (const it of items.slice(state.bpage * per, state.bpage * per + per)) {
      const r = it.r, n = NIT[it.pid];
      const chips = '<div class="req">' + (n.kodlar[it.kod] || []).map((c) => {
        const txt = n.sozluk[String(c)] || ('Kod ' + c);
        const cat = catOf(txt);
        const miss = it.missing.includes(c);
        const label = cat.k === 'ozel' ? 'Özel şart: ' + txt.replace(/^Bakınız:\s*Başvurma Özel Şartları\s*-\s*/i, '') : nitShort(txt);
        return `<span class="req-chip ${miss ? 'miss' : cat.cls}" title="${esc(c + ' · ' + txt + ' — Nasıl sağlanır: ' + cat.nasil)}">${esc(label)}</span>`;
      }).join('') + '</div>';
      h += `<tr><td data-label="Kadro"><b>${esc(r ? trTitle(DICT.unvan[r[COL.unvan]]) : '–')}</b><div class="code">${esc(it.kod)} · ${PFX}${esc(it.pid)}</div>${it.own ? '<span class="pill ok">Bölümüne özel</span>' : '<span class="pill none">Her bölüme açık</span>'}</td>
        <td data-label="Kurum · il">${r ? esc(DICT.kurum[r[COL.kurum]]) + '<div class="small muted">' + esc(trTitle(DICT.il[r[COL.il]])) + '</div>' : '–'}</td>
        <td data-label="Kontenjan" class="r num">${r ? r[COL.kont] : '–'}</td><td data-label="Taban" class="r num">${r ? fSc(r[COL.min], 3) : '–'}</td>
        <td data-label="Şartlar" class="wide">${chips}</td>
        <td data-label="Durum">${it.missing.length ? '<span class="pill bad">Eksik şart</span>' : '<span class="pill ok">Başvurabilirsin</span>'} <span class="pill ${it.reach}">${REACH[it.reach]}</span></td></tr>`;
    }
    $('#tbl-bolum').innerHTML = h + '</tbody>';
    $('#bolum-pager').innerHTML = `<span class="small muted">${fInt(items.length)} kadro · taban, o dönemde yerleşen son kişinin puanı</span>
      <span style="display:flex;gap:8px;align-items:center"><button class="btn" type="button" id="bp-prev" ${state.bpage <= 0 ? 'disabled' : ''}>Önceki</button><span class="small tnum">${state.bpage + 1} / ${pages}</span><button class="btn" type="button" id="bp-next" ${state.bpage >= pages - 1 ? 'disabled' : ''}>Sonraki</button></span>`;
    $('#bp-prev').addEventListener('click', () => { state.bpage--; renderBolum(); });
    $('#bp-next').addEventListener('click', () => { state.bpage++; renderBolum(); });
  }
  // ---------------------------------------------------------------- hızlı arama
  // Verilen kılavuzlarda, bölüm/kod ile eğitim şartı tutan kadroları; eksik şartları ve taban durumuyla döndürür.
  function findKadros(pids, q, typed, u) {
    const lv = LV[state.level];
    const mine = new Set([...typed.filter(isEduCode), ...matchBolum(q).keys()]);
    const have = new Set([...(state.nhas || []).map(Number), ...typed.filter((c) => !isEduCode(c))]);
    const items = [];
    for (const pid of pids) {
      const n = NIT[pid];
      const idx = rowIndexFor(pid);
      const p = P.find((x) => x.id === pid && !x.user);
      const thr = p ? threshold(p, state.level, u) : null;
      for (const [kod, codes] of Object.entries(n.kodlar)) {
        if (kod[0] !== lv.kodBas) continue;
        const edu = codes.filter((c) => String(c)[0] === lv.edu);
        const own = edu.some((c) => mine.has(c));
        if (!own && !edu.includes(lv.generic)) continue;
        const missing = codes.filter((c) => !isEduCode(c) && isHard(n.sozluk[String(c)] || '') && !have.has(c));
        const ri = idx.get(kod);
        const r = ri != null ? R[ri] : null;
        const reach = r && r[COL.min] != null && thr != null ? (thr >= r[COL.min] ? 'ok' : thr >= r[COL.min] - NEAR ? 'warn' : 'bad') : 'none';
        items.push({ pid, kod, own, missing, r, reach, thr });
      }
    }
    return items;
  }
  let qsLimit = 0, qsNear = false; // 0 = ilk sayfa; qsNear: sınırda kalanları da göster
  const qsFirst = () => (innerWidth < 640 ? 5 : 8);
  const resetQuick = () => { qsLimit = 0; qsNear = false; };
  // Hızlı arama için eksik zorunlu bilgi: puan ya da bölüm/mezuniyet kodu.
  function quickNeed() {
    if (user().score == null) return '#in-score';
    if (up(state.bolum).trim().length < 3 && !typedCodes().some(isEduCode)) return '#in-bolum';
    return null;
  }
  const QS_WHERE = EK ? { all: '2025–2026 EKPSS yerleştirmelerinde', 2026: '2026-EKPSS yerleştirmesinde', past: '2025-EKPSS yerleştirmesinde' }
    : { all: '2025–2026 alımlarında', 2026: 'KPSS-2026/1 alımında', past: '2025 alımlarında' };
  function renderQuick() {
    $$('#qs-year button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.y === state.qyear)));
    const sum = $('#qs-summary'), box = $('#qs-results'), more = $('#qs-more');
    const show = (summary, cards = '') => { sum.innerHTML = summary; box.innerHTML = cards; more.hidden = true; };
    if (!NIT_PIDS.length) return show(emptyHTML({ icon: 'info', tone: 'warn', title: 'Nitelik verisi yüklenemedi', text: 'Sayfayı yenilemeyi dene.' }));
    const need = quickNeed();
    if (need === '#in-score') {
      return show(emptyHTML({ icon: 'edit', title: 'Önce puanını yaz', actions: [['Puanını yaz', 'focus-score', true]],
        text: `Yukarıdaki <b>Bilgilerin</b> bölümüne ${EK ? 'EKPSS' : '2026 KPSS'} puanını ve mezun olduğun bölümü yaz; girebileceğin kadrolar burada listelenir.` }));
    }
    if (need === '#in-bolum') {
      return show(emptyHTML({ icon: 'edit', title: 'Bölümünü yaz', actions: [['Bölümünü yaz', 'focus-bolum', true]],
        text: 'Kadroların çoğu belirli bölümlerden mezun ister. Bölümünü (ör. <b>Hemşirelik</b>, <b>İşletme</b>) ya da mezuniyet nitelik kodunu (ör. <b>4605</b>) yaz.' }));
    }
    const u = user();
    const q = up(state.bolum).trim(), typed = typedCodes();
    const pids = NIT_PIDS.filter((pid) => state.qyear === 'all' || (state.qyear === '2026' ? pid.startsWith('2026') : !pid.startsWith('2026')));
    const items = findKadros(pids, q, typed, u);
    const byTaban = (a, b) => b.r[COL.min] - a.r[COL.min];
    const ok = items.filter((it) => !it.missing.length && it.reach === 'ok').sort(byTaban);
    const near = items.filter((it) => !it.missing.length && it.reach === 'warn').sort(byTaban);
    const miss = items.filter((it) => it.missing.length && it.reach === 'ok').length;
    const noMatch = !eduMatches(q, typed).size;
    const where = QS_WHERE[state.qyear] || QS_WHERE.all;
    if (!ok.length && !(qsNear && near.length)) {
      const acts = [];
      if (state.qyear !== 'all') acts.push(['Tüm dönemlerde ara', 'qs-all', true]);
      if (near.length) acts.push([`Sınırda kalan ${fInt(near.length)} kadroyu göster`, 'qs-near', !acts.length]);
      if (miss) acts.push([`Belgesi eksik ${fInt(miss)} kadroya bak`, 'go-nitelik', !acts.length]);
      const sug = noMatch && q.length >= 3 ? suggestBolum(q) : [];
      if (sug.length) acts.unshift([`“${sug[0]}” ile ara`, 'set-bolum', true, sug[0]]);
      if (noMatch) acts.push(['Bölüm adını düzelt', 'focus-bolum', !acts.length]);
      return show(emptyHTML({ title: 'Sonuç yok', actions: acts,
        text: `${esc(where)} bu bilgilerle tabanını geçtiğin ve tüm şartlarını sağladığın kadro bulunamadı.`
          + (noMatch ? ` <b>“${esc(String(state.bolum).trim())}”</b> adında bir bölüm bulamadık; yazımı kontrol et.` : '')
          + (acts.length ? ' Şunları deneyebilirsin:' : ' Puanını ya da bölümünü değiştirip yeniden dene.') }));
    }
    const extras = [];
    if (near.length) extras.push(`<button type="button" class="chip" data-act="qs-near" aria-pressed="${qsNear}">${qsNear ? 'Sınırda kalanları gizle' : `+ Sınırda kalan ${fInt(near.length)} kadro`}</button>`);
    if (miss) extras.push(`<button type="button" class="chip" data-act="go-nitelik">Belgesi eksik ${fInt(miss)} kadro →</button>`);
    sum.innerHTML = `<div class="qs-sum${ok.length ? '' : ' warn'}">
        <p class="qs-count"><b>${fInt(ok.length)}</b><span>kadroya girebilirdin${ok.length ? '' : ` · sınırda kalan ${fInt(near.length)} kadro aşağıda`}</span></p>
        ${extras.length ? `<div class="qs-extra">${extras.join('')}</div>` : ''}
        <p class="qs-note">${esc(where)}, ${state.mode === 'rank' ? 'sıralamana' : 'puanına'} göre; en yüksek tabandan başlayarak. Tabanlar o dönemin sonuçlarıdır, yeni alımlarda değişebilir.${noMatch ? ' <b>Bölüm adın eşleşmedi; yalnız her bölüme açık kadrolar listelendi.</b>' : ''}${state.example ? ' <b>Örnek puan kullanılıyor; kendi puanını yaz.</b>' : ''}</p>
      </div>`;
    const list = qsNear ? ok.concat(near) : ok;
    const lim = qsLimit || qsFirst();
    const mine = new Set(eduMatches(q, typed).keys());
    box.innerHTML = list.slice(0, lim).map((it) => qsCard(it, mine, q)).join('');
    more.hidden = list.length <= lim;
    if (!more.hidden) more.textContent = `Daha fazla göster (${fInt(list.length - lim)} kadro daha)`;
  }
  function qsCard(it, mine, q) {
    const r = it.r, diff = it.thr - r[COL.min];
    const near = it.reach !== 'ok';
    return `<article class="qs-item${near ? ' near' : ''}">
      <div class="qs-top"><span class="t">${esc(trTitle(DICT.unvan[r[COL.unvan]]))}</span>
        <span class="margin ${near ? 'warn' : 'ok'}" title="O dönemin karşılığındaki puanın ile taban arasındaki fark">${near ? fSc(-diff, 2) + ' puan eksik' : diff < 0.005 ? 'Tabana eşit' : '+' + fSc(diff, 2) + ' puan'}</span></div>
      <span class="kurum">${esc(DICT.kurum[r[COL.kurum]])}</span>
      <div class="qs-meta"><b>${esc(trTitle(DICT.il[r[COL.il]]))}</b><span>${r[COL.kont]} kontenjan</span><span>${PFX}${esc(it.pid)}</span><span class="code">${esc(it.kod)}</span></div>
      <div class="qs-scores"><span>Taban <b class="tnum">${fSc(r[COL.min], 2)}</b></span><span>Senin karşılığın <b class="tnum hl">${fSc(it.thr, 2)}</b></span></div>
      ${reqChips(it.pid, it.kod, mine, q)}</article>`;
  }
  function syncInputs() {
    for (const [sel, k] of [['#in-score', 'score'], ['#in-rank', 'rank'], ['#in-bolum', 'bolum'], ['#in-nkod', 'nkod']]) {
      const el = $(sel);
      if (el && document.activeElement !== el) el.value = state[k] || '';
    }
  }
  function renderGroupReqs() {
    const g = grpIdx();
    const gname = groupLabel(state.group);
    $('#nit-group-title').textContent = `${gname} kadrolarının istediği şartlar`;
    const lv = LV[state.level];
    const cnt = new Map();
    let total = 0;
    const used = [];
    for (const pid of NIT_PIDS) {
      const n = NIT[pid];
      const idx = rowIndexFor(pid);
      let local = 0;
      for (const [kod, codes] of Object.entries(n.kodlar)) {
        if (kod[0] !== lv.kodBas) continue;
        const ri = idx.get(kod);
        if (ri == null) continue;
        if (g !== -1 && R[ri][COL.grup] !== g) continue;
        total++; local++;
        for (const c of codes) {
          const t = n.sozluk[String(c)] || ('Kod ' + c);
          const key = c + '|' + t;
          cnt.set(key, (cnt.get(key) || 0) + 1);
        }
      }
      if (local) used.push(`${PFX}${pid} (${fInt(local)})`);
    }
    $('#nit-group-sub').textContent = total ? `${used.join(', ')} kılavuzlarındaki ${fInt(total)} ${low(lv.ad)} kadrosuna göre. Yüzde, şartı isteyen kadroların oranı.` : '';
    if (!total) {
      $('#nit-group').innerHTML = emptyHTML({ icon: 'info', compact: true, flat: true, title: 'Kılavuz verisi yok', text: `Son kılavuzlarda <b>${esc(gname)}</b> kadrosu bulunmuyor.`, actions: [['Başka bir kadro seç', 'focus-group']] });
      return;
    }
    const top = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    $('#nit-group').innerHTML = top.map(([key, n]) => {
      const code = key.split('|')[0], txt = key.slice(key.indexOf('|') + 1);
      const cat = catOf(txt);
      return `<div class="nit-row"><div class="share">${fPct(n / total)}<small>${fInt(n)} kadro</small></div>
        <div><div class="req"><span class="req-chip ${cat.cls}">${esc(cat.ad)}</span><span class="code">kod ${esc(code)}</span></div>
        <div style="margin-top:4px">${esc(txt)}</div><div class="how"><b>Nasıl sağlanır?</b> ${esc(cat.nasil)}</div></div></div>`;
    }).join('');
  }

  // ---------------------------------------------------------------- kadro listesi
  function fillPlaceSelect() {
    const opts = P.filter((p) => p.levels[state.level]).sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!opts.find((p) => placeKey(p) === state.place)) state.place = opts.length ? placeKey(opts[0]) : null;
    $('#in-place').innerHTML = opts.map((p) => `<option value="${esc(placeKey(p))}">${PFX}${esc(p.id)} · ${esc(p.kind)} · ${fDate(p.date)}${NIT[p.id] && !p.user ? ' · nitelikler var' : ''}</option>`).join('');
    $('#in-place').value = state.place || '';
  }
  function openList(key) {
    state.place = key; state.page = 0;
    selectTab('liste');
    goTo($('#liste'));
  }
  function renderList() {
    fillPlaceSelect();
    const u = user();
    const pi = P.findIndex((p) => placeKey(p) === state.place);
    const t = $('#tbl-list');
    $('#list-empty').innerHTML = '';
    if (pi < 0) { t.innerHTML = ''; $('#list-pager').innerHTML = ''; return; }
    const p = P[pi], lv = p.levels[state.level];
    const thr = threshold(p, state.level, u);
    const g = state.scope === 'group' ? grpIdx() : -1, il = ilIdx();
    const q = up(state.q).trim();
    const hasNit = !!NIT[p.id] && !p.user;
    const items = [];
    for (let i = lv.rows[0]; i < lv.rows[1]; i++) {
      const r = R[i];
      if (!rowMatch(r, g, il)) continue;
      if (q && !up(r[COL.kod] + ' ' + DICT.kurum[r[COL.kurum]] + ' ' + DICT.il[r[COL.il]] + ' ' + DICT.unvan[r[COL.unvan]]).includes(q)) continue;
      items.push(r);
    }
    const sorters = {
      'taban-asc': (a, b) => (a[COL.min] ?? 999) - (b[COL.min] ?? 999),
      'taban-desc': (a, b) => (b[COL.min] ?? -1) - (a[COL.min] ?? -1),
      'kont-desc': (a, b) => b[COL.kont] - a[COL.kont],
      il: (a, b) => DICT.il[a[COL.il]].localeCompare(DICT.il[b[COL.il]], 'tr') || (a[COL.min] ?? 999) - (b[COL.min] ?? 999),
    };
    items.sort(sorters[state.sort] || sorters['taban-asc']);
    const per = 60, pages = Math.max(1, Math.ceil(items.length / per));
    state.page = Math.min(state.page, pages - 1);
    const m = model(state.level, lv.scoreYear);
    let h = `<thead><tr><th>Kadro</th><th>Kurum · il</th><th class="r">Kont.</th><th class="r">Taban</th><th class="r">Tavan</th>${EK ? '' : '<th class="r">Taban sırası</th>'}${hasNit ? '<th>Nitelik şartları</th>' : ''}<th>Senin için</th></tr></thead><tbody>`;
    for (const r of items.slice(state.page * per, state.page * per + per)) {
      let st = 'none';
      if (r[COL.min] != null && thr != null) st = thr >= r[COL.min] ? 'ok' : thr >= r[COL.min] - NEAR ? 'warn' : 'bad';
      const lbl = r[COL.min] == null ? 'Boş kaldı' : st === 'ok' ? 'Yeterdi' : st === 'warn' ? 'Sınırda' : st === 'bad' ? 'Yetmezdi' : '–';
      h += `<tr><td data-label="Kadro"><b>${esc(trTitle(DICT.unvan[r[COL.unvan]]))}</b><div class="code">${esc(r[COL.kod])}</div></td>
        <td data-label="Kurum · il">${esc(DICT.kurum[r[COL.kurum]])}<div class="small muted">${esc(trTitle(DICT.il[r[COL.il]]))}</div></td>
        <td data-label="Kontenjan" class="r num">${r[COL.kont]}</td><td data-label="Taban" class="r num">${fSc(r[COL.min], 3)}</td><td data-label="Tavan" class="r num">${fSc(r[COL.max], 3)}</td>
        ${EK ? '' : `<td data-label="Taban sırası" class="r num">${r[COL.min] != null && m ? fInt(rankOn(m, r[COL.min])) : '–'}</td>`}
        ${hasNit ? `<td data-label="Nitelik şartları" class="wide">${reqChips(p.id, r[COL.kod])}</td>` : ''}
        <td data-label="Senin için"><span class="pill ${r[COL.min] == null ? 'none' : st}">${lbl}</span></td></tr>`;
    }
    t.innerHTML = items.length ? h + '</tbody>' : '';
    if (!items.length) {
      const acts = [];
      if (state.q) acts.push(['Aramayı temizle', 'list-clear-q', true]);
      if (state.scope === 'group') acts.push(['Tüm unvanları göster', 'list-all', !acts.length]);
      if (state.il) acts.push([trTitle(state.il) + ' filtresini kaldır', 'clear-il', !acts.length]);
      $('#list-empty').innerHTML = emptyHTML({ compact: true, flat: true, title: 'Eşleşen kadro yok', actions: acts,
        text: state.q ? `<b>“${esc(state.q)}”</b> aramasıyla bu yerleştirmede kadro bulunamadı.` : `Bu yerleştirmede <b>${esc(groupLabel(state.group))}</b> kadrosu yok.` });
    }
    $('#list-pager').innerHTML = `<span class="small muted">${fInt(items.length)} kadro · ${lv.scoreYear} puanlarıyla${thr != null ? ' · karşılaştırılan puanın <span class="hl tnum">' + fSc(thr, 2) + '</span>' : ''}${hasNit ? ' · şartların üzerine gelince açıklaması görünür' : ' · bu dönem için nitelik verisi eklenmedi'}</span>
      <span style="display:flex;gap:8px;align-items:center"><button class="btn" type="button" id="pg-prev" ${state.page <= 0 ? 'disabled' : ''}>Önceki</button><span class="small tnum">${state.page + 1} / ${pages}</span><button class="btn" type="button" id="pg-next" ${state.page >= pages - 1 ? 'disabled' : ''}>Sonraki</button></span>`;
    $('#pg-prev').addEventListener('click', () => { state.page--; renderList(); });
    $('#pg-next').addEventListener('click', () => { state.page++; renderList(); });
  }

  // ---------------------------------------------------------------- 2026
  const TIMELINE = [
    ['2026-07-09', '9–16 Temmuz 2026', 'KPSS-2026/1 tercihleri', 'Bazı kurumların kadrolarına 1. yerleştirme (2024 puanlarıyla).'],
    ['2026-07-24', '24 Temmuz 2026', 'KPSS-2026/1 sonuçları', '2.083 kadro: 977 lisans, 828 ön lisans, 278 ortaöğretim.'],
    ['2026-09-06', '6 Eylül 2026', '2026-KPSS Lisans sınavı', 'Genel Yetenek-Genel Kültür; alan bilgisi 12–13 Eylül.'],
    ['2026-10-04', '4 Ekim 2026', '2026-KPSS Ön Lisans sınavı', ''],
    ['2026-10-07', '7 Ekim 2026', 'Lisans sonuçları açıklandı', 'KPSSP3 için 1.559.934 aday; sonuç belgesinde başarı sırası var.'],
    ['2026-10-25', '25 Ekim 2026', '2026-KPSS Ortaöğretim sınavı', ''],
    ['2026-10-30', '30 Ekim 2026', 'Ön Lisans sonuçları', 'Başarı sıranı "Veri ekle" bölümüne yazarak tahmini güncelleyebilirsin.'],
    ['2026-11-01', '1 Kasım 2026', 'DHBT', 'Sonuçlar 25 Kasım 2026.'],
    ['2026-11-19', '19 Kasım 2026', 'Ortaöğretim sonuçları', 'KPSSP94.'],
    ['2026-12-17', '17–24 Aralık 2026', 'KPSS-2026/2 tercihleri', '2026 puanlarıyla ilk merkezi yerleştirme. Kadro sayısı tercih kılavuzuyla açıklanacak.'],
    ['2027-01-15', '2027', 'Sonraki alımlar', '2026 puanları iki yıl geçerli; Sağlık Bakanlığı için resmî tarih yok.'],
  ];
  function cycleSummary(y) {
    const ids = new Set();
    let k = 0;
    P.forEach((p) => { if (p.user) return; for (const lv of Object.values(p.levels)) { if (lv.scoreYear === y) { ids.add(p.id); k += lv.kontenjan; } } });
    return `${y} puanlarıyla yapılan ${ids.size} yerleştirmede toplam ${fInt(k)} kadro açıldı.`;
  }
  function render2026() {
    const today = new Date().toISOString().slice(0, 10);
    let nextDone = false;
    $('#timeline').innerHTML = TIMELINE.map(([d, when, what, sub]) => {
      const done = d < today;
      let cls = done ? 'done' : '';
      if (!done && !nextDone) { cls = 'next'; nextDone = true; }
      return `<li class="${cls}"><span><span class="when">${esc(when)}</span><b>${esc(what)}</b>${sub ? '<div class="small muted">' + esc(sub) + '</div>' : ''}</span></li>`;
    }).join('');
    const pi = P.findIndex((p) => p.id === '2026/1' && !p.user);
    if (pi >= 0) {
      const p = P[pi];
      $('#k2026-sub').textContent = `Sonuç tarihi ${fDate(p.date)} · ${p.kind} · 2024 puanlarıyla`;
      let h = '<thead><tr><th>Düzey</th><th class="r">Tercih yapan</th><th class="r">Kontenjan</th><th class="r">Yerleşen</th><th class="r">Boş</th></tr></thead><tbody>';
      let tot = [0, 0, 0, 0];
      LEVELS.forEach((l) => {
        const lv = p.levels[l];
        if (!lv) return;
        tot = [tot[0] + (lv.tercih || 0), tot[1] + lv.kontenjan, tot[2] + lv.yerlesen, tot[3] + lv.bos];
        h += `<tr><td>${LV[l].ad} <span class="small muted">${LV[l].puan}</span></td><td class="r num">${fInt(lv.tercih)}</td><td class="r num">${fInt(lv.kontenjan)}</td><td class="r num">${fInt(lv.yerlesen)}</td><td class="r num">${fInt(lv.bos)}</td></tr>`;
      });
      h += `<tr class="group-row"><td>Toplam</td><td class="r num">${fInt(tot[0])}</td><td class="r num">${fInt(tot[1])}</td><td class="r num">${fInt(tot[2])}</td><td class="r num">${fInt(tot[3])}</td></tr>`;
      $('#tbl-2026-levels').innerHTML = h + '</tbody>';
      const u = user();
      const lv = p.levels[state.level];
      $('#k2026-title').textContent = `KPSS-2026/1 · ${LV[state.level].ad}: kadrolar ve tabanlar`;
      if (lv) {
        const byG = new Map();
        for (let i = lv.rows[0]; i < lv.rows[1]; i++) { const r = R[i]; if (!byG.has(r[COL.grup])) byG.set(r[COL.grup], []); byG.get(r[COL.grup]).push(r); }
        const thr = threshold(p, state.level, u);
        const groups = [...byG.entries()].map(([gi, rs]) => {
          const tabs = rs.filter((r) => r[COL.min] != null && r[COL.yer] > 0).map((r) => [r[COL.min], r[COL.yer]]).sort((a, b) => a[0] - b[0]);
          const filled = tabs.reduce((s, t2) => s + t2[1], 0);
          const reach = thr == null ? 0 : tabs.filter((t2) => thr >= t2[0]).reduce((s, t2) => s + t2[1], 0);
          return { g: DICT.grup[gi], kont: rs.reduce((s, r) => s + r[COL.kont], 0), filled, reach, min: tabs.length ? tabs[0][0] : null, med: tabs.length ? wq(tabs, 0.5) : null, max: tabs.length ? tabs[tabs.length - 1][0] : null };
        }).sort((a, b) => b.kont - a.kont);
        let h2 = '<thead><tr><th>Kadro</th><th class="r">Kontenjan</th><th class="r">En düşük taban</th><th class="r">Ortadaki</th><th class="r">En yüksek</th><th>Senin için</th></tr></thead><tbody>';
        for (const gg of groups) {
          const st = gg.min == null || thr == null ? 'none' : thr >= gg.med ? 'ok' : thr >= gg.min - NEAR ? 'warn' : 'bad';
          h2 += `<tr${gg.g === state.group ? ' class="sel"' : ''}><td data-label="Kadro" class="wide"><b>${esc(trTitle(gg.g))}</b></td><td data-label="Kontenjan" class="r num">${fInt(gg.kont)}</td><td data-label="En düşük taban" class="r num">${fSc(gg.min)}</td><td data-label="Ortadaki" class="r num">${fSc(gg.med)}</td><td data-label="En yüksek" class="r num">${fSc(gg.max)}</td>
            <td data-label="Senin için"><span class="pill ${st}">${STATUS_TXT[st]}</span> <span class="small muted tnum">${fInt(gg.reach)} / ${fInt(gg.filled)}</span></td></tr>`;
        }
        $('#tbl-2026-groups').innerHTML = h2 + '</tbody>';
      } else $('#tbl-2026-groups').innerHTML = '';
    }
    $('#news').innerHTML = `<ul>
      <li><b>KPSS-2026/2:</b> tercihler 17–24 Aralık 2026 (ÖSYM takvimi). Kadro sayısı tercih kılavuzuyla açıklanacak; basında yaklaşık 2.500 kadro bekleniyor (resmî değil). Önceki 2. yerleştirmeler: 2025/2'de 3.732, 2024/2'de 1.615, 2023/2'de 3.742 kadro. <a href="https://www.osym.gov.tr/Sayfa/SinavTakvimi" target="_blank" rel="noopener">ÖSYM sınav takvimi</a></li>
      <li><b>Sağlık Bakanlığı:</b> 2026 için KPSS ile yapılacak sözleşmeli sağlık personeli alımına dair resmî kontenjan ve tarih açıklanmadı. Basındaki 26.673 sözleşmeli pozisyonun büyük bölümü uzman doktor ve doktor kadrosudur (KPSS ile yerleştirilmez). Bazı siteler hemşire için 17.500 ve üzeri tahmin ediyor; bunlar resmî değildir.</li>
      <li><b>Puan geçerliliği:</b> 2026-KPSS sonuçları iki yıl geçerlidir. 2026 Lisans sınavına giren adayların 2024 Ön Lisans/Ortaöğretim puanları, Lisans sonucunun açıklandığı tarihte geçersiz olur (2026 Lisans Kılavuzu, 1.12).</li>
      <li><b>Geçmiş örüntü:</b> Her puan döneminde yaz ve kış aylarında iki merkezi yerleştirme ile kurum bazlı (Sağlık, MEB, Tarım ve Orman vb.) alımlar yapıldı. ${cycleSummary(2024)}</li></ul>`;
  }

  // ---------------------------------------------------------------- veri ekle
  const uploads = store.get('kpss2026-uploads', []);
  function normHeader(h) {
    return low(String(h || '').trim()).replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }
  function parseCSV(text) {
    const first = text.split(/\r?\n/)[0] || '';
    const delim = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : (first.includes('\t') ? '\t' : ',');
    const rows = [];
    let cur = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; continue; }
      if (c === '"') q = true;
      else if (c === delim) { cur.push(field); field = ''; }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field || cur.length) { cur.push(field); rows.push(cur); }
    return rows.filter((r) => r.some((x) => x.trim()));
  }
  function levelOf(v) {
    const s = normHeader(v);
    if (/on_?lisans|p93/.test(s)) return 'onlisans';
    if (/orta|p94|lise/.test(s)) return 'ortaogretim';
    if (/lisans|p3/.test(s)) return 'lisans';
    return null;
  }
  function scoreYearFor(level, dateIso) {
    const ex = D.examResults[level];
    const t = new Date(new Date(dateIso + 'T12:00:00').getTime() - 15 * 864e5).toISOString().slice(0, 10);
    let best = null;
    for (const [yy, d] of Object.entries(ex)) if (d <= t && (best == null || +yy > best)) best = +yy;
    return best;
  }
  function ingest(name, text) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('Dosyada veri satırı bulunamadı.');
    const hdr = rows[0].map(normHeader);
    const col = (...names) => { for (const n of names) { const i = hdr.indexOf(n); if (i >= 0) return i; } return -1; };
    const ci = {
      donem: col('donem', 'yerlestirme', 'alim'), tarih: col('sonuc_tarihi', 'tarih'), tur: col('yerlestirme_turu', 'tur'), duzey: col('duzey', 'ogrenim_duzeyi', 'puan_turu'),
      py: col('puan_yili'), kod: col('kadro_kodu', 'program_kodu', 'kod'), kurum: col('kurum', 'program_adi', 'kurum_adi'), il: col('il'), birim: col('birim'),
      unvan: col('kadro_unvani', 'kadro_adi', 'unvan'), grup: col('unvan_grubu'), kont: col('kontenjan'), yer: col('yerlesen'),
      min: col('en_kucuk_puan', 'taban', 'en_kucuk'), max: col('en_buyuk_puan', 'tavan', 'en_buyuk'),
    };
    const missing = ['donem', 'duzey', 'kont', 'min'].filter((k) => ci[k] < 0);
    if (missing.length) throw new Error('Eksik sütun: ' + missing.join(', ') + '. Başlık satırını şablonla karşılaştır.');
    const groups = new Map();
    let added = 0, skipped = 0;
    for (const r of rows.slice(1)) {
      const lvl = levelOf(r[ci.duzey]);
      const pid = String(r[ci.donem] || '').trim().replace(/^KPSS[- ]?/i, '');
      if (!lvl || !pid) { skipped++; continue; }
      const date = ci.tarih >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(r[ci.tarih]).trim()) ? String(r[ci.tarih]).trim() : new Date().toISOString().slice(0, 10);
      const key = pid + '|' + date;
      if (!groups.has(key)) groups.set(key, { id: pid, date, kind: ci.tur >= 0 ? (r[ci.tur] || 'Kullanıcı verisi') : 'Kullanıcı verisi', levels: {} });
      const gp = groups.get(key);
      if (!gp.levels[lvl]) gp.levels[lvl] = { rows: [], py: null };
      const py = ci.py >= 0 ? parseIntTR(r[ci.py]) : null;
      if (py) gp.levels[lvl].py = py;
      gp.levels[lvl].rows.push(r);
    }
    for (const gp of groups.values()) {
      if (P.some((p) => !p.user && p.id === gp.id)) { skipped += Object.values(gp.levels).reduce((s, l) => s + l.rows.length, 0); continue; }
      const pidx = P.length;
      const pl = { id: gp.id, date: gp.date, kind: gp.kind, title: 'Kullanıcı verisi: ' + name, user: true, levels: {} };
      for (const [lvl, lv] of Object.entries(gp.levels)) {
        const start = R.length;
        let kont = 0, yer = 0;
        for (const r of lv.rows) {
          const k = parseIntTR(r[ci.kont]) || 0;
          const mn = parseScore(r[ci.min]);
          const yy = ci.yer >= 0 ? (parseIntTR(r[ci.yer]) ?? (mn != null ? k : 0)) : (mn != null ? k : 0);
          const unv = ci.unvan >= 0 ? up(String(r[ci.unvan] || '').trim()) : '';
          const grp = ci.grup >= 0 && r[ci.grup] ? up(String(r[ci.grup]).trim()) : unv.replace(/\s*\(.*$/, '');
          const ilv = ci.il >= 0 ? up(String(r[ci.il] || '').trim()) : '';
          const b = ci.birim >= 0 ? up(r[ci.birim]) : '';
          R.push([pidx, LEVELS.indexOf(lvl), ci.kod >= 0 ? String(r[ci.kod] || '') : '', dictIdx('kurum', ci.kurum >= 0 ? String(r[ci.kurum] || '').trim() : ''),
            dictIdx('il', ilv), b.includes('MERKEZ') ? 1 : b.includes('TAŞRA') ? 2 : 0, dictIdx('unvan', unv), dictIdx('grup', grp), k, yy, mn,
            ci.max >= 0 ? parseScore(r[ci.max]) : mn]);
          kont += k; yer += yy; added++;
        }
        pl.levels[lvl] = { scoreYear: lv.py || scoreYearFor(lvl, gp.date), tercih: null, kontenjan: kont, yerlesen: yer, bos: kont - yer, rows: [start, R.length] };
      }
      P.push(pl);
    }
    return { added, skipped };
  }
  function loadUploads() { for (const u of uploads) { try { ingest(u.name, u.text); } catch (e) { /* bozuk yükleme atlanır */ } } }
  async function readFile(file) {
    if (/\.xlsx?$/i.test(file.name)) {
      if (!window.XLSX) {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
          s.onload = res; s.onerror = () => rej(new Error('Excel okuyucu yüklenemedi (internet gerekli). Dosyayı CSV olarak kaydedip yükle.'));
          document.head.appendChild(s);
        });
      }
      const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
      return window.XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: ';' });
    }
    return await file.text();
  }
  async function handleFile(file) {
    const msg = $('#file-msg');
    try {
      const text = await readFile(file);
      const r = ingest(file.name, text);
      uploads.push({ name: file.name, text, at: new Date().toISOString() });
      const ok = store.set('kpss2026-uploads', uploads);
      msg.innerHTML = `<div class="msg ok">${esc(file.name)}: ${fInt(r.added)} kadro satırı eklendi${r.skipped ? ', ' + fInt(r.skipped) + ' satır atlandı' : ''}.${ok ? '' : ' Dosya büyük olduğu için tarayıcıya kaydedilemedi; sayfa yenilenince yeniden yüklemen gerekir.'}</div>`;
      fitCache.key = null;
      fillKinds();
      refreshAll();
    } catch (e) { msg.innerHTML = `<div class="msg bad">${esc(e.message)}</div>`; }
  }
  function renderVeri() {
    let h = '<thead><tr><th>Düzey</th><th class="r">Puan</th><th class="r">Başarı sırası</th><th class="r">Aday sayısı</th><th></th></tr></thead><tbody>';
    calib.forEach((c, i) => { h += `<tr><td>${LV[c.level].ad}</td><td class="r num">${fSc(c.score, 5)}</td><td class="r num">${fInt(c.rank)}</td><td class="r num">${fInt(c.n)}</td><td><button class="btn" type="button" data-del-cal="${i}">Sil</button></td></tr>`; });
    $('#tbl-cal').innerHTML = calib.length ? h + '</tbody>' : '<tbody><tr><td class="small muted" style="padding:12px 18px">Henüz eklenmiş nokta yok. Lisans 2026 tahmini 13 sonuç belgesiyle zaten ayarlandı.</td></tr></tbody>';
    $$('[data-del-cal]').forEach((b) => b.addEventListener('click', () => { calib.splice(+b.dataset.delCal, 1); store.set('kpss2026-cal', calib); resetModels(); refreshAll(); }));
    let h2 = '<thead><tr><th>Dosya</th><th>Eklenme</th><th></th></tr></thead><tbody>';
    uploads.forEach((u, i) => { h2 += `<tr><td>${esc(u.name)}</td><td class="small">${esc((u.at || '').slice(0, 10))}</td><td><button class="btn" type="button" data-del-up="${i}">Kaldır</button></td></tr>`; });
    $('#tbl-uploads').innerHTML = uploads.length ? h2 + '</tbody>' : '';
    $$('[data-del-up]').forEach((b) => b.addEventListener('click', () => {
      uploads.splice(+b.dataset.delUp, 1); store.set('kpss2026-uploads', uploads);
      $('#file-msg').innerHTML = '<div class="msg ok">Kaldırıldı. Değişikliğin uygulanması için sayfayı yenile.</div>';
      renderVeri();
    }));
  }

  // ---------------------------------------------------------------- yöntem
  function renderMethod() {
    if (EK) return renderEkMethod();
    const first = P[0], last = P[BASE_P - 1];
    const m26 = RK.models['lisans-2026'];
    const totalK = R.slice(0, BASE_ROWS).reduce((s, r) => s + r[COL.kont], 0);
    const nitN = NIT_PIDS.reduce((s, p) => s + Object.keys(NIT[p].kodlar).length, 0);
    $('#trust-data').textContent = `${BASE_P} ÖSYM yerleştirmesi · ${fInt(BASE_ROWS)} kadro satırı`;
    $('#foot-data').textContent = `Veri seti ${D.generated} tarihinde ÖSYM'nin "En Küçük ve En Büyük Puanlar", "Sayısal Bilgiler" ve tercih kılavuzu belgelerinden üretildi (${fInt(totalK)} kadro).`;
    $('#method').innerHTML = `
      <h3>Veri</h3>
      <p>ÖSYM'nin yayımladığı ${BASE_P} yerleştirmenin (${PFX}${esc(first.id)}, ${fDate(first.date)} → ${PFX}${esc(last.id)}, ${fDate(last.date)}) "En Küçük ve En Büyük Puanlar" belgeleri satır satır okundu: kadro kodu, kurum, il, kadro unvanı, kontenjan, yerleşen sayısı, taban ve tavan puan. Toplam ${fInt(BASE_ROWS)} satır, ${fInt(totalK)} kadro. Her yerleştirmede kontenjan ve yerleşen toplamları ÖSYM'nin özet belgeleriyle birebir aynı.</p>
      <p>Nitelik şartları ${NIT_PIDS.map((p) => PFX + esc(p)).join(', ')} tercih kılavuzlarındaki kadro tablolarından ve nitelik kodu listelerinden alındı (${fInt(nitN)} kadro).</p>
      <h3>Puandan başarı sırasına</h3>
      <p>KPSS puanı, ağırlıklı standart puanın doğrusal bir dönüşümüdür: <code>KPSS = 70 + 30·[2(ASP−X) − S] / [2(B−X) − S]</code> (2026 Lisans Kılavuzu). 13 adet 2026 sonuç belgesindeki doğru/yanlış sayıları bu formülle puanı 0,0002 farkla veriyor; belgelerdeki 39 puan–sıra noktası ${fInt(m26.n)} adaylık 2026 dağılımını oluşturuyor. Önceki yıllar aynı eğri şekliyle, o yılın ölçeği ve aday sayısıyla uyarlandı ve 2018–2020 ÖSYM puan dağılımlarıyla sınandı.</p>
      <h3>Yıllar arası karşılaştırma</h3>
      <p>Sınavların zorluğu ve aday sayısı her yıl değiştiği için "Sıralamana göre" seçeneği, 2026 başarı sıranın o yıldaki puan karşılığını kullanır. "Puanına göre" seçeneği puanını doğrudan karşılaştırır.</p>
      <h3>Atanma ihtimali</h3>
      <p>Her puan döneminde, bir kadroya o güne kadar yerleşen toplam kişi ile o alımdaki en düşük tabanın başarı sırası arasındaki oran hesaplanır (hemşirede 8 ile 39 arası, ağırlıklı ortalama 21 civarı). 2026 için ihtimal, bu oranların dağılımıyla hesaplanır. "Tüm illeri tercih eden aday" en iyimser durumdur.</p>
      <h3>Sınırlar</h3>
      <ul>
        <li>Adayların il tercihleri bilinmez; nitelik şartlarını sağladığın varsayılır.</li>
        <li>2022 ve 2024 puan ölçekleri test istatistiklerinden tahmin edildi; sıralama karşılıkları yaklaşıktır.</li>
        <li>2026 Ön Lisans ve Ortaöğretim tahminleri sonuçlar açıklanana kadar kabadır.</li>
        <li>2024 Lisans sonuçları 4 sorunun yargı kararıyla iptali sonrası 7 Kasım 2024'te yeniden hesaplandı.</li>
      </ul>
      <h3>Kaynaklar</h3>
      <ul>
        <li><a href="https://www.osym.gov.tr/SinavGrubu/Menu/341" target="_blank" rel="noopener">ÖSYM KPSS Sayısal Bilgiler</a> (yerleştirme sonuçları, en küçük/en büyük puanlar)</li>
        <li><a href="https://www.osym.gov.tr/SinavGrubu/Menu/338" target="_blank" rel="noopener">ÖSYM KPSS Kılavuzlar</a> (tercih kılavuzları ve nitelik kodları)</li>
        <li><a href="https://www.osym.gov.tr/2026kpss-lisans-kilavuz-ve-basvuru-bilgileri" target="_blank" rel="noopener">2026-KPSS Lisans Kılavuzu</a> (puan formülü)</li>
        <li><a href="https://www.osym.gov.tr/BilgiKategori/Index/2" target="_blank" rel="noopener">ÖSYM değerlendirme raporları</a> (2018–2020 puan dağılımları)</li>
        <li><a href="https://www.osym.gov.tr/Sayfa/SinavTakvimi" target="_blank" rel="noopener">ÖSYM 2026 sınav takvimi</a></li>
      </ul>`;
  }

  function renderEkMethod() {
    const first = P[0], last = P[BASE_P - 1];
    const totalK = R.slice(0, BASE_ROWS).reduce((s, r) => s + r[COL.kont], 0);
    const nitN = NIT_PIDS.reduce((s, p) => s + Object.keys(NIT[p].kodlar).length, 0);
    $('#trust-data').textContent = `${BASE_P} EKPSS yerleştirmesi · ${fInt(BASE_ROWS)} kadro satırı`;
    $('#foot-data').textContent = `Veri seti ${D.generated} tarihinde ÖSYM'nin EKPSS "En Küçük ve En Büyük Puanlar", "Sayısal Bilgiler" ve tercih kılavuzu belgelerinden üretildi (${fInt(totalK)} kadro).`;
    $('#method').innerHTML = `
      <h3>Veri</h3>
      <p>ÖSYM'nin yayımladığı ${BASE_P} EKPSS yerleştirmesinin (${esc(PFX + first.id)}, ${fDate(first.date)} → ${esc(PFX + last.id)}, ${fDate(last.date)}) "En Küçük ve En Büyük Puanlar" belgeleri satır satır okundu: kadro kodu, kurum, il, kadro unvanı, kontenjan, yerleşen sayısı, taban ve tavan puan. Toplam ${fInt(BASE_ROWS)} satır, ${fInt(totalK)} kadro. Her yerleştirme ve düzeyde kontenjan ve yerleşen toplamları ÖSYM'nin sayısal bilgiler belgeleriyle birebir aynı.</p>
      <p>Nitelik şartları ${NIT_PIDS.map((p) => esc(PFX + p)).join(', ')} tercih kılavuzlarındaki kadro tablolarından ve nitelik kodu listelerinden alındı (${fInt(nitN)} kadro).</p>
      <h3>Karşılaştırma</h3>
      <p>ÖSYM, EKPSS için başarı sırası ya da puan dağılımı yayımlamadığından karşılaştırma doğrudan puanla yapılır: puanın, her yerleştirmenin kendi tabanlarıyla karşılaştırılır. EKPSS iki yılda bir yapılır; 2025 ve 2026 yerleştirmeleri 2024 puanlarıyla yapıldı, 2026 puanların bir sonraki yerleştirmede kullanılacak. Sınavın zorluğu yıldan yıla değiştiği için sonuçlar yaklaşıktır.</p>
      <h3>Sınırlar</h3>
      <ul>
        <li>Kadro sayısına göre atanma ihtimali hesaplanmaz (KPSS sayfasındaki model başarı sırasına dayanır).</li>
        <li>2018/2–2022 tablolarında il bilgisi yok; il seçiliyken bu yıllar sayılmaz.</li>
        <li>Kura ile yapılan yerleştirmeler (ilköğretim mezunları) dahil değildir.</li>
        <li>"Girebileceğin kadrolar" yalnız yazdığın bölüme, kodlara ve seçtiğin belgelere göre süzer; kuruma özel şartları kılavuzdan kontrol et.</li>
      </ul>
      <h3>Kaynaklar</h3>
      <ul>
        <li><a href="https://www.osym.gov.tr/SinavGrubu/Menu/356" target="_blank" rel="noopener">ÖSYM EKPSS Sayısal Bilgiler</a> (yerleştirme sonuçları, en küçük/en büyük puanlar)</li>
        <li><a href="https://www.osym.gov.tr/SinavGrubu/Menu/353" target="_blank" rel="noopener">ÖSYM EKPSS Kılavuzlar</a> (tercih kılavuzları ve nitelik kodları)</li>
      </ul>`;
  }

  // ---------------------------------------------------------------- sekmeler ve olaylar
  const TABS = EK ? ['gecmis', 'liste', 'nitelik', 'yontem'] : ['gecmis', 'liste', 'nitelik', 'kadro2026', 'yontem'];
  const TAB_ALIAS = { ihtimal: 'yontem', veri: 'yontem' }; // eski bağlantılar
  function selectTab(id, push = true) {
    id = TAB_ALIAS[id] || id;
    if (!TABS.includes(id)) id = 'gecmis';
    state.tab = id;
    TABS.forEach((t) => { $('#' + t).hidden = t !== id; $('#t-' + t).setAttribute('aria-selected', String(t === id)); });
    if (push) { try { history.replaceState(null, '', '#' + id); } catch (e) { /* yoksay */ } }
    save();
    renderTab();
  }
  function renderTab() {
    const t = state.tab;
    if (t === 'gecmis') renderGecmis();
    else if (t === 'liste') renderList();
    else if (t === 'nitelik') renderNitelik();
    else if (t === 'kadro2026') render2026();
    else if (t === 'yontem' && !EK) { renderModelTable(); renderVeri(); }
  }
  function refreshAll() { syncInputs(); renderHasChips(); renderBolumHint(); renderGroupChips(); renderVerdict(user()); renderQuick(); renderTab(); }
  // Boş durum ve kısayol düğmelerinin (data-act) işleri
  const ACTIONS = {
    'set-bolum': (b) => { state.bolum = b.dataset.val; state.bpage = 0; resetQuick(); save(); refreshAll(); },
    'focus-score': () => focusField('#in-score'),
    'focus-bolum': () => focusField('#in-bolum'),
    'focus-group': () => focusField('#in-group'),
    'qs-all': () => { state.qyear = 'all'; resetQuick(); save(); renderQuick(); },
    'qs-near': () => { qsNear = !qsNear; qsLimit = 0; renderQuick(); },
    'go-nitelik': () => { state.nstrict = false; state.bpage = 0; selectTab('nitelik'); goTo($('#nitelik')); },
    'clear-il': () => { state.il = ''; elIl.value = ''; save(); refreshAll(); },
    'clear-kind': () => { state.kind = ''; fillKinds(); save(); refreshAll(); },
    'list-clear-q': () => { state.q = ''; $('#in-q').value = ''; state.page = 0; save(); renderList(); },
    'list-all': () => { state.scope = 'all'; $('#in-scope').value = 'all'; state.page = 0; save(); renderList(); },
    'nit-loose': () => { state.nstrict = false; state.bpage = 0; save(); renderNitelik(); },
    'nit-all': () => { state.nplace = 'all'; state.bpage = 0; save(); renderNitelik(); },
  };
  let timer = null;
  function soon(fn = refreshAll, ms = 140) { clearTimeout(timer); timer = setTimeout(() => { save(); fn(); }, ms); }

  function init() {
    if (!EK) loadUploads(); // kullanıcı yüklemeleri KPSS verisine aittir
    fillKinds(); fillIl(); fillGroups(); syncSegs();
    elScore.value = state.score || '';
    if (elRank) elRank.value = state.rank || '';
    $('#in-sort').value = state.sort;
    $('#in-scope').value = state.scope;
    if ($('#in-c0')) $('#in-c0').value = state.C0 || '0';
    renderMethod();
    $$('#level-seg button').forEach((b) => b.addEventListener('click', () => {
      state.level = b.dataset.level; state.sel = null; state.place = null; state.K = null; state.bpage = 0; resetQuick();
      syncSegs(); fillGroups(); save(); refreshAll();
    }));
    $$('#mode-seg button').forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.mode; syncSegs(); save(); refreshAll(); }));
    elScore.addEventListener('input', () => { state.score = elScore.value; state.example = false; resetQuick(); soon(); });
    if (elRank) elRank.addEventListener('input', () => { state.rank = elRank.value; state.example = false; resetQuick(); soon(); });
    elGroup.addEventListener('change', () => { state.group = elGroup.value; state.K = null; state.sel = null; fillGroups(); save(); refreshAll(); });
    $('#verdict').addEventListener('click', (e) => {
      const b = e.target.closest('[data-group]'); if (!b) return;
      state.group = b.dataset.group; state.K = null; state.sel = null; fillGroups(); save(); refreshAll();
    });
    elIl.addEventListener('change', () => { state.il = elIl.value; save(); refreshAll(); });
    on('#in-kind', 'change', (e) => { state.kind = e.target.value; save(); refreshAll(); });
    on('#in-k', 'input', (e) => {
      state.K = String(slider2k(+e.target.value));
      $('#k-out').textContent = fInt(+state.K) + ' kişi';
      soon(refreshAll, 90);
    });
    on('#k-presets', 'click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; state.K = b.dataset.k; save(); refreshAll(); });
    on('#in-c0', 'input', (e) => { state.C0 = e.target.value; soon(); });
    $('#more-cards').addEventListener('click', () => { state.showAll = !state.showAll; renderGecmis(); });
    $('#in-place').addEventListener('change', (e) => { state.place = e.target.value; state.page = 0; save(); renderList(); });
    $('#in-q').addEventListener('input', (e) => { state.q = e.target.value; state.page = 0; soon(renderList, 180); });
    $('#in-sort').addEventListener('change', (e) => { state.sort = e.target.value; state.page = 0; save(); renderList(); });
    $('#in-scope').addEventListener('change', (e) => { state.scope = e.target.value; state.page = 0; save(); renderList(); });
    $('#in-bolum').addEventListener('input', (e) => { state.bolum = e.target.value; state.bpage = 0; resetQuick(); soon(refreshAll, 220); });
    $('#in-nkod').addEventListener('input', (e) => { state.nkod = e.target.value; state.bpage = 0; resetQuick(); soon(refreshAll, 220); });
    $('#in-nplace').addEventListener('change', (e) => { state.nplace = e.target.value; state.bpage = 0; save(); renderBolum(); });
    $('#qs-year').addEventListener('click', (e) => { const b = e.target.closest('[data-y]'); if (!b) return; state.qyear = b.dataset.y; resetQuick(); save(); renderQuick(); });
    $('#qs-more').addEventListener('click', () => { qsLimit = (qsLimit || qsFirst()) + 24; renderQuick(); });
    $('#search-form').addEventListener('submit', (e) => {
      e.preventDefault();
      clearTimeout(timer); resetQuick(); save(); refreshAll();
      const need = quickNeed();
      if (need) { focusField(need); return; }
      if (e.target.contains(document.activeElement)) document.activeElement.blur();
      goTo($('#quick'));
    });
    on('#prob-more', 'toggle', renderProbChart);
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b && ACTIONS[b.dataset.act]) { e.preventDefault(); ACTIONS[b.dataset.act](b); }
    });
    window.addEventListener('hashchange', () => {
      const h = location.hash.slice(1), t = TAB_ALIAS[h] || h;
      if (TABS.includes(t)) { selectTab(t, false); goTo($('#' + t)); }
    });
    $('#in-nstrict').addEventListener('change', (e) => { state.nstrict = e.target.checked; state.bpage = 0; save(); renderBolum(); });
    $('#nhas-chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-has]'); if (!b) return;
      const c = +b.dataset.has, set = new Set((state.nhas || []).map(Number));
      if (set.has(c)) set.delete(c); else set.add(c);
      state.nhas = [...set]; state.bpage = 0; resetQuick(); save(); refreshAll();
    });
    $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[role="tab"]'); if (b) { selectTab(b.id.slice(2)); goTo($('#' + state.tab), true); } });
    $('#tabs').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = TABS.indexOf(state.tab) + (e.key === 'ArrowRight' ? 1 : -1);
      const id = TABS[(i + TABS.length) % TABS.length];
      selectTab(id); $('#t-' + id).focus();
    });
    on('#cal-form', 'submit', (e) => {
      e.preventDefault();
      const c = { level: $('#cal-level').value, year: CUR, score: parseScore($('#cal-score').value), rank: parseIntTR($('#cal-rank').value), n: parseIntTR($('#cal-n').value) };
      if (!c.score || c.score < 40 || c.score > 100 || !c.rank) { $('#cal-msg').innerHTML = '<div class="msg bad">Puan (40–100) ve başarı sırası gerekli.</div>'; return; }
      calib.push(c); store.set('kpss2026-cal', calib); resetModels();
      $('#cal-msg').innerHTML = '<div class="msg ok">Eklendi; tahminler güncellendi.</div>';
      $('#cal-score').value = ''; $('#cal-rank').value = '';
      refreshAll();
    });
    const drop = $('#drop');
    on('#in-file', 'change', (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; });
    if (drop) ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    if (drop) ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    if (drop) drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
    on('#copy-tpl', 'click', async () => {
      const txt = $('#tpl').textContent;
      try { await navigator.clipboard.writeText(txt); $('#copy-tpl').textContent = 'Kopyalandı'; }
      catch (e) { const r = document.createRange(); r.selectNodeContents($('#tpl')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); $('#copy-tpl').textContent = 'Seçildi, kopyala'; }
    });
    document.addEventListener('click', (e) => { $$('details.tip[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; }); });
    let rz = null;
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (state.tab === 'gecmis') renderGecmis(); renderProbChart(); }, 200); });
    const hash = (location.hash || '').replace('#', '');
    selectTab(TABS.includes(TAB_ALIAS[hash] || hash) ? hash : state.tab, false);
    refreshAll();
  }
  init();
})();
