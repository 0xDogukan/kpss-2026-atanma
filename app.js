/* KPSS 2026 Atanma Tahmini — uygulama mantığı.
   Veri: window.KPSS_DATA (yerleştirmeler), window.KPSS_RANK (puan → başarı sırası modelleri),
         window.KPSS_HEMSIRE (uzun dönem hemşire tablosu). */
'use strict';
(function () {
  const D = window.KPSS_DATA;
  const RK = window.KPSS_RANK;
  const HT = window.KPSS_HEMSIRE || null;
  const $ = (s, el = document) => el.querySelector(s);
  const LEVELS = ['lisans', 'onlisans', 'ortaogretim'];
  const LV = {
    lisans: { ad: 'Lisans', puan: 'KPSSP3' },
    onlisans: { ad: 'Ön Lisans', puan: 'KPSSP93' },
    ortaogretim: { ad: 'Ortaöğretim', puan: 'KPSSP94' },
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
    const main = document.querySelector('main');
    if (main && !box.parentNode) main.prepend(box);
  });

  if (!D || !RK) {
    document.querySelector('main').innerHTML = '<p class="loading">Veri dosyaları yüklenemedi. <code>web/data</code> klasörünün <code>index.html</code> ile aynı yerde olduğundan emin ol.</p>';
    return;
  }

  // ---------------------------------------------------------------- biçimlendirme
  const nf = (d) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const F0 = nf(0), F1 = nf(1), F2 = nf(2), F3 = nf(3), F5 = nf(5);
  const fInt = (x) => (x == null || !isFinite(x) ? '–' : F0.format(Math.round(x)));
  const fSc = (x, d = 3) => (x == null || !isFinite(x) ? '–' : nf(d).format(x));
  const fPct = (x, d = 0) => (x == null || !isFinite(x) ? '–' : '%' + nf(d).format(100 * x));
  const fProb = (x) => (x == null || !isFinite(x) ? '–' : x >= 0.995 ? '%99+' : x <= 0.005 ? '%1\'den az' :'%' + F0.format(100 * x));
  const DTF = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
  const fDate = (iso) => (iso ? DTF.format(new Date(iso + 'T12:00:00')) : '–');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SMALL = new Set(['VE', 'İLE', 'VEYA', 'DA', 'DE']);
  function trTitle(s) {
    if (!s) return '';
    return s.split(' ').map((w, i) => {
      if (i > 0 && SMALL.has(w)) return w.toLocaleLowerCase('tr-TR');
      const lw = w.toLocaleLowerCase('tr-TR');
      const j = lw.search(/[a-zçğıöşüâîû]/i);
      if (j < 0) return w;
      return lw.slice(0, j) + lw.charAt(j).toLocaleUpperCase('tr-TR') + lw.slice(j + 1);
    }).join(' ');
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
  function Phi(x) { // standart normal dağılım fonksiyonu
    const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }

  // ---------------------------------------------------------------- depolama
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };

  // ---------------------------------------------------------------- veri (temel + kullanıcı yüklemeleri)
  const P = D.placements.map((p) => Object.assign({}, p, { user: false }));
  const R = D.rows;
  const DICT = { kurum: D.dict.kurum.slice(), unvan: D.dict.unvan.slice(), grup: D.dict.grup.slice(), il: D.dict.il.slice() };
  const DIDX = {};
  for (const k of Object.keys(DICT)) { DIDX[k] = new Map(DICT[k].map((v, i) => [v, i])); }
  function dictIdx(kind, val) {
    val = val || '';
    let i = DIDX[kind].get(val);
    if (i == null) { i = DICT[kind].length; DICT[kind].push(val); DIDX[kind].set(val, i); }
    return i;
  }
  const BASE_ROWS = R.length;
  const BASE_P = P.length;

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
    let lo = 0, hi = n - 1; // a azalan
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
  function resetModels() { modelCache.clear(); }
  // y yılındaki puanı, aynı başarı sırasına karşılık gelen 2026 puanına çevirir
  function to2026(level, year, s) {
    if (s == null) return null;
    const a = model(level, year), b = model(level, CUR);
    if (!a || !b || year === CUR) return s;
    return scoreOn(b, rankOn(a, s));
  }

  // ---------------------------------------------------------------- durum
  const DEFAULTS = { level: 'lisans', score: '80,50000', rank: '', group: 'HEMŞİRE', il: '', mode: 'rank', kind: '', K: null, C0: '0',
    tab: 'gecmis', sel: null, place: null, q: '', sort: 'taban-asc', scope: 'group', page: 0, example: true };
  const state = Object.assign({}, DEFAULTS, store.get('kpss2026-state', {}));
  function save() {
    const { level, score, rank, group, il, mode, kind, K, C0, tab, sel, place, sort, scope, example } = state;
    store.set('kpss2026-state', { level, score, rank, group, il, mode, kind, K, C0, tab, sel, place, sort, scope, example });
  }

  // kullanıcı girdisinden türetilen değerler
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
  function grpIdx() { return state.group ? (DIDX.grup.get(state.group) ?? -2) : -1; }
  function ilIdx() { return state.il ? (DIDX.il.get(state.il) ?? -2) : -1; }

  // bir yerleştirmede kullanıcının eşiği (o yılın puan ölçeğinde)
  function threshold(p, level, u) {
    const lv = p.levels[level];
    if (!lv || u.score == null) return null;
    if (state.mode === 'raw' || !u.rank) return u.score;
    if (lv.scoreYear === CUR) return u.score;
    const m = model(level, lv.scoreYear);
    return m ? scoreOn(m, u.rank) : u.score;
  }
  function wq(arr, q) { // arr: [[değer, ağırlık]] artan sıralı
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
  function placementStats(pi, level, u, opts = {}) {
    const p = P[pi];
    const lv = p.levels[level];
    if (!lv) return null;
    const g = opts.group != null ? opts.group : grpIdx();
    const il = opts.il != null ? opts.il : ilIdx();
    const thr = threshold(p, level, u);
    let pos = 0, filled = 0, reach = 0, near = 0, bos = 0, maxTavan = null;
    const tabs = [];
    for (let i = lv.rows[0]; i < lv.rows[1]; i++) {
      const r = R[i];
      if (!rowMatch(r, g, il)) continue;
      pos += r[COL.kont];
      if (r[COL.min] == null || r[COL.yer] <= 0) { bos += r[COL.kont]; continue; }
      filled += r[COL.yer];
      tabs.push([r[COL.min], r[COL.yer]]);
      if (maxTavan == null || r[COL.max] > maxTavan) maxTavan = r[COL.max];
      if (thr != null) {
        if (thr >= r[COL.min]) reach += r[COL.yer];
        else if (thr >= r[COL.min] - NEAR) near += r[COL.yer];
      }
    }
    if (!pos) return null;
    tabs.sort((a, b) => a[0] - b[0]);
    return {
      pi, p, lv, pos, filled, reach, near, bos, thr, maxTavan,
      min: tabs.length ? tabs[0][0] : null, q25: tabs.length ? wq(tabs, 0.25) : null, med: tabs.length ? wq(tabs, 0.5) : null,
      q75: tabs.length ? wq(tabs, 0.75) : null, max: tabs.length ? tabs[tabs.length - 1][0] : null,
    };
  }
  function statusOf(st) {
    if (!st || st.thr == null || st.min == null) return 'none';
    if (st.thr >= st.med) return 'ok';
    if (st.thr >= st.min) return 'warn';
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
        if (!RECENCY[y]) continue; // 2016 döngüsü (güven düşük) ve henüz alım yapılmamış 2026 döngüsü hariç
        if (a.H < 10) continue;
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
    const lnC = Math.log(C), lnR = Math.log(R0);
    const z90 = 1.2816;
    return {
      pmax: Phi((fit.max.mu + lnC - lnR) / fit.max.sd),
      p50: Phi((fit.q50.mu + lnC - lnR) / fit.q50.sd),
      rmax: Math.exp(fit.max.mu) * C, rmaxLo: Math.exp(fit.max.mu - z90 * fit.max.sd) * C, rmaxHi: Math.exp(fit.max.mu + z90 * fit.max.sd) * C,
      r50: Math.exp(fit.q50.mu) * C,
    };
  }
  let fitCache = { key: null, fit: null };
  function currentFit() {
    const key = state.level + '|' + state.group + '|' + calib.length + '|' + P.length;
    if (fitCache.key !== key) fitCache = { key, fit: scenarioFit(state.level, grpIdx()) };
    return fitCache.fit;
  }
  function defaultK(fit) {
    if (!fit) return 1000;
    const ys = Object.keys(fit.cycleTotals).map(Number).filter((y) => RECENCY[y]).sort();
    const last = ys[ys.length - 1];
    return last ? Math.max(10, fit.cycleTotals[last]) : 1000;
  }
  function currentK(fit) {
    const k = parseIntTR(state.K);
    return k && k > 0 ? k : defaultK(fit);
  }

  // ---------------------------------------------------------------- arayüz: form
  const elScore = $('#in-score'), elRank = $('#in-rank'), elGroup = $('#in-group'), elIl = $('#in-il');
  function groupLabel(g) { return g ? trTitle(g) : 'Tüm unvanlar'; }
  function fillGroups() {
    const L = LEVELS.indexOf(state.level);
    const cnt = new Map();
    for (let i = 0; i < R.length; i++) { const r = R[i]; if (r[COL.level] !== L) continue; cnt.set(r[COL.grup], (cnt.get(r[COL.grup]) || 0) + r[COL.kont]); }
    const list = [...cnt.entries()].filter(([, n]) => n >= 1).sort((a, b) => b[1] - a[1]);
    const names = list.map(([gi]) => DICT.grup[gi]);
    if (state.group && !names.includes(state.group)) state.group = names[0] || '';
    elGroup.innerHTML = '<option value="">Tüm unvanlar</option>' + list.map(([gi, n]) =>
      `<option value="${esc(DICT.grup[gi])}">${esc(groupLabel(DICT.grup[gi]))} · ${fInt(n)}</option>`).join('');
    elGroup.value = state.group || '';
    $('#group-chips').innerHTML = list.slice(0, 6).map(([gi]) => {
      const g = DICT.grup[gi];
      return `<button type="button" class="chip" data-group="${esc(g)}" aria-pressed="${g === state.group}">${esc(groupLabel(g))}</button>`;
    }).join('');
  }
  function fillIl() {
    const iller = DICT.il.filter((x) => x).slice().sort((a, b) => a.localeCompare(b, 'tr'));
    elIl.innerHTML = '<option value="">Tüm iller</option>' + iller.map((x) => `<option value="${esc(x)}">${esc(trTitle(x))}</option>`).join('');
    elIl.value = state.il || '';
  }
  function fillKinds() {
    const kinds = [...new Set(P.map((p) => p.kind))].sort((a, b) => a.localeCompare(b, 'tr'));
    $('#in-kind').innerHTML = '<option value="">Tümü</option>' + kinds.map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
    $('#in-kind').value = state.kind || '';
  }
  function syncLevelButtons() {
    document.querySelectorAll('#level-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === state.level)));
  }

  // ---------------------------------------------------------------- özet şeridi
  function lastCycle(level) {
    let y = null;
    for (const p of P) { const lv = p.levels[level]; if (lv && lv.scoreYear < CUR && (y == null || lv.scoreYear > y)) y = lv.scoreYear; }
    return y;
  }
  function cycleAgg(level, y, u) {
    let pos = 0, reach = 0, near = 0, filled = 0;
    P.forEach((p, pi) => {
      const lv = p.levels[level];
      if (!lv || lv.scoreYear !== y) return;
      const st = placementStats(pi, level, u);
      if (!st) return;
      pos += st.pos; filled += st.filled; reach += st.reach; near += st.near;
    });
    return { pos, filled, reach, near };
  }
  function renderSummary(u) {
    const el = $('#summary');
    const lvl = LV[state.level];
    const gname = groupLabel(state.group);
    const cells = [];
    // 1 — başarı sırası
    if (u.rank) {
      const pct = u.n ? u.rank / u.n : null;
      const m26 = u.m26;
      const conf = u.estimated ? (m26 && m26.guven === 'yüksek' ? 'model tahmini (2026 belgeleriyle kalibre)' : 'kaba tahmin · sonuç belgendeki sırayı gir') : 'sonuç belgenden';
      cells.push(`<div><span class="k">Başarı sıran</span><span class="v">${u.estimated ? '≈ ' : ''}${fInt(u.rank)}</span>
        <span class="d">${u.n ? fInt(u.n) + ' aday içinde ilk ' + fPct(pct, pct < 0.1 ? 1 : 0) : ''} · ${conf}</span></div>`);
    } else {
      cells.push(`<div><span class="k">Başarı sıran</span><span class="v">–</span><span class="d">Puanını ya da sıranı gir.</span></div>`);
    }
    // 2 — eşdeğer puan
    const eqs = [2024, 2022, 2020].map((y) => { const m = model(state.level, y); return [y, m && u.rank ? scoreOn(m, u.rank) : null]; });
    if (u.rank && eqs[0][1] != null) {
      cells.push(`<div><span class="k">Eşdeğer puanın</span><span class="v">${fSc(eqs[0][1], 2)}<span class="unit">2024 ölçeği</span></span>
        <span class="d">${eqs.slice(1).filter((e) => e[1] != null).map((e) => e[0] + ': ' + fSc(e[1], 2)).join(' · ')} · aynı başarı sırası</span></div>`);
    } else {
      cells.push(`<div><span class="k">Eşdeğer puanın</span><span class="v">–</span><span class="d">Önceki yıllarda aynı sıraya karşılık gelen puan</span></div>`);
    }
    // 3 — son döngü
    const y = lastCycle(state.level);
    if (y && u.score != null) {
      const a = cycleAgg(state.level, y, u);
      const share = a.filled ? a.reach / a.filled : null;
      cells.push(`<div><span class="k">${y} puanlarıyla yapılan alımlarda</span><span class="v">${fPct(share)}</span>
        <span class="d">${esc(gname)} kadrolarının ${fInt(a.reach)} / ${fInt(a.filled)} tanesine ${state.mode === 'rank' ? 'bu sıralama' : 'bu puan'} yeterdi${state.il ? ' (' + esc(trTitle(state.il)) + ')' : ''}</span></div>`);
    } else {
      cells.push(`<div><span class="k">Son döngü</span><span class="v">–</span><span class="d"></span></div>`);
    }
    // 4 — senaryo
    const fit = currentFit();
    const K = currentK(fit);
    const C0 = parseIntTR(state.C0) || 0;
    const pr = u.rank ? predict(fit, K + C0, u.rank) : null;
    if (pr) {
      cells.push(`<div><span class="k">Atanma ihtimali</span><span class="v"><span class="hl">${fProb(pr.pmax)}</span></span>
        <span class="d">${fInt(K + C0)} ${esc(gname)} kadrosu açılırsa, her ili tercih eden aday için</span></div>`);
    } else {
      cells.push(`<div><span class="k">Atanma ihtimali</span><span class="v">–</span><span class="d">${fit && !fit.ok ? 'Bu unvan için yeterli geçmiş alım yok' : 'Senaryo için sıra gerekli'}</span></div>`);
    }
    el.innerHTML = cells.join('');
    $('#score-hint').textContent = u.rawScore == null && state.score ? 'Puan anlaşılamadı; örnek: 81,73954' :
      (u.rawScore != null && (u.rawScore < 40 || u.rawScore > 100) ? 'KPSS puanları 40–100 arasında olur.' : `${lvl.puan} · 2026`);
    const m26 = u.m26;
    $('#rank-hint').textContent = m26 ? (state.level === 'lisans'
      ? `2026 ${lvl.ad}: ${fInt(m26.n)} aday` + (m26.calibrated ? ` · ${m26.calibrated} ek kalibrasyon noktası` : '')
      : `${lvl.ad} 2026 sonuçları ${state.level === 'onlisans' ? '30 Ekim' : '19 Kasım'}'de; şimdilik 2024 verisine dayalı tahmin`) : '';
  }

  // ---------------------------------------------------------------- geçmiş: grafik + tablo
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
    if (!list.length) { host.innerHTML = '<p class="muted" style="padding:20px 0">Bu seçim için geçmiş yerleştirme bulunamadı.</p>'; $('#range-legend').innerHTML = ''; return; }
    const conv = (st, s) => (state.mode === 'rank' ? to2026(state.level, st.lv.scoreYear, s) : s);
    const pts = list.map((st) => ({ st, min: conv(st, st.min), q25: conv(st, st.q25), med: conv(st, st.med), q75: conv(st, st.q75), max: conv(st, st.max) }));
    const userY = u.score;
    let lo = Math.min(...pts.map((d) => d.min)), hi = Math.max(...pts.map((d) => d.max));
    if (userY != null) { lo = Math.min(lo, userY); hi = Math.max(hi, userY); }
    lo = Math.max(40, Math.floor(lo - 1)); hi = Math.min(100, Math.ceil(hi + 1));
    const W0 = host.clientWidth || 800;
    const step = 30;
    const ml = 44, mr = 16, mt = 26, mb = 64;
    const W = Math.max(W0, ml + mr + pts.length * step);
    const H = 340;
    const plotW = W - ml - mr, plotH = H - mt - mb;
    const x = (i) => ml + (i + 0.5) * (plotW / pts.length);
    const y = (v) => mt + (hi - v) / (hi - lo) * plotH;
    const maxPos = Math.max(...pts.map((d) => d.st.filled));
    const bw = (n) => Math.max(5, Math.min(18, 18 * Math.sqrt(n / maxPos)));
    const css = (v) => `var(--${v})`;
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Yerleştirmelere göre taban puan aralıkları">`;
    // ızgara
    const tickStep = hi - lo > 24 ? 5 : 2;
    for (let v = Math.ceil(lo / tickStep) * tickStep; v <= hi; v += tickStep) {
      s += `<line x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}" stroke="${css('rule')}" stroke-width="1"/>`;
      s += `<text x="${ml - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11">${v}</text>`;
    }
    // puan döngüsü ayırıcıları
    let prev = null;
    pts.forEach((d, i) => {
      const yr = d.st.lv.scoreYear;
      if (yr !== prev) {
        const xx = ml + i * (plotW / pts.length);
        if (prev != null) s += `<line x1="${xx}" x2="${xx}" y1="${mt - 8}" y2="${H - mb}" stroke="${css('muted')}" stroke-dasharray="3 4" stroke-width="1"/>`;
        s += `<text x="${xx + 4}" y="${mt - 10}" font-size="11" font-weight="600">${yr} puanı</text>`;
        prev = yr;
      }
    });
    // kullanıcı çizgisi (fosforlu kalem)
    if (userY != null) {
      s += `<rect x="${ml}" y="${y(userY) - 4}" width="${plotW}" height="8" fill="${css('mark-soft')}"/>`;
      s += `<line x1="${ml}" x2="${W - mr}" y1="${y(userY)}" y2="${y(userY)}" stroke="${css('mark')}" stroke-width="2.5"/>`;
    }
    // sütunlar
    pts.forEach((d, i) => {
      const st = statusOf(d.st);
      const col = css(st === 'ok' ? 'ok' : st === 'warn' ? 'warn' : st === 'bad' ? 'bad' : 'none');
      const cx = x(i), w = bw(d.st.filled);
      const sel = state.sel === d.st.p.id + '|' + d.st.p.date;
      if (sel) s += `<rect x="${cx - step / 2 + 1}" y="${mt}" width="${step - 2}" height="${plotH}" fill="${css('head')}"/>`;
      s += `<g class="col" data-sel="${esc(d.st.p.id + '|' + d.st.p.date)}" style="cursor:pointer">`;
      s += `<rect x="${cx - step / 2}" y="${mt}" width="${step}" height="${plotH}" fill="transparent"/>`;
      s += `<line x1="${cx}" x2="${cx}" y1="${y(d.max)}" y2="${y(d.min)}" stroke="${col}" stroke-width="1.5"/>`;
      s += `<rect x="${cx - w / 2}" y="${y(d.q75)}" width="${w}" height="${Math.max(2, y(d.q25) - y(d.q75))}" fill="${col}" fill-opacity="0.28" stroke="${col}" stroke-width="1.2" rx="2"/>`;
      s += `<line x1="${cx - w / 2}" x2="${cx + w / 2}" y1="${y(d.med)}" y2="${y(d.med)}" stroke="${css('ink')}" stroke-width="2"/>`;
      s += `<title>${esc(d.st.p.id)} · ${esc(d.st.p.kind)} · ${fDate(d.st.p.date)}\n${fInt(d.st.filled)} kadro · en düşük taban ${fSc(d.st.min)}${state.mode === 'rank' ? ' (2026 eşdeğeri ' + fSc(d.min, 2) + ')' : ''}\nmedyan ${fSc(d.st.med)} · en yüksek ${fSc(d.st.max)}</title>`;
      s += `</g>`;
      s += `<text x="${cx}" y="${H - mb + 14}" font-size="10.5" text-anchor="end" transform="rotate(-50 ${cx} ${H - mb + 14})">${esc(d.st.p.id)}</text>`;
    });
    s += `<text x="${ml}" y="${H - 6}" font-size="11">${state.mode === 'rank' ? 'Dikey eksen: 2026 ölçeğinde puan (aynı başarı sırasının 2026 karşılığı)' : 'Dikey eksen: ham taban puanı (her yerleştirme kendi yılının puanıyla)'}</text>`;
    s += '</svg>';
    host.innerHTML = s;
    host.querySelectorAll('g.col').forEach((g) => g.addEventListener('click', () => { state.sel = g.dataset.sel; save(); renderGecmis(); }));
    $('#range-legend').innerHTML = `<span><i class="sw ok"></i>Medyan tabana yetiyor</span><span><i class="sw warn"></i>En düşük tabana yetiyor / sınırda</span><span><i class="sw bad"></i>Yetmiyor</span><span><i class="sw mark"></i>Sen${userY != null ? ' (' + fSc(userY, 2) + ')' : ''}</span><span>Kutu genişliği: kadro sayısı</span>`;
  }
  function renderDetail(list, u) {
    const el = $('#range-detail');
    let st = list.find((s) => s.p.id + '|' + s.p.date === state.sel);
    if (!st && list.length) { // varsayılan: son puan döngüsünün en büyük alımı
      const lastY = Math.max(...list.map((s) => s.lv.scoreYear));
      st = list.filter((s) => s.lv.scoreYear === lastY).reduce((a, b) => (b.filled > a.filled ? b : a));
      state.sel = st.p.id + '|' + st.p.date;
    }
    if (!st) { el.innerHTML = ''; return; }
    const lv = st.lv;
    const conv = state.mode === 'rank' && lv.scoreYear !== CUR;
    const tmin = conv ? to2026(state.level, lv.scoreYear, st.min) : null;
    const m = model(state.level, lv.scoreYear);
    const rmin = m ? rankOn(m, st.min) : null;
    const share = st.filled ? st.reach / st.filled : 0;
    el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px 24px;align-items:baseline;justify-content:space-between">
      <div><strong>KPSS-${esc(st.p.id)}</strong> · ${esc(st.p.kind)} · sonuç ${fDate(st.p.date)} · ${lv.scoreYear} puanları${lv.tercih ? ' · ' + fInt(lv.tercih) + ' tercih yapan (' + LV[state.level].ad + ')' : ''}</div>
      <button class="btn" type="button" id="open-list">Kadro listesinde aç</button></div>
      <p style="margin-top:8px">${esc(groupLabel(state.group))}${state.il ? ' · ' + esc(trTitle(state.il)) : ''}: <strong>${fInt(st.filled)}</strong> kadro.
      En düşük taban <span class="num">${fSc(st.min, 5)}</span>${rmin ? ' (≈ ' + fInt(rmin) + '. sıra' + (conv ? ', 2026 ölçeğinde ' + fSc(tmin, 2) : '') + ')' : ''},
      medyan <span class="num">${fSc(st.med, 3)}</span>, en yüksek taban <span class="num">${fSc(st.max, 3)}</span>.</p>
      <p style="margin-top:4px">${st.thr != null ? `Senin ${state.mode === 'rank' && lv.scoreYear !== CUR ? lv.scoreYear + ' ölçeğindeki eşdeğer puanın <span class="num hl">' + fSc(st.thr, 3) + '</span>' : 'puanın <span class="num hl">' + fSc(st.thr, 3) + '</span>'} ile bu kadroların <strong>${fInt(st.reach)}</strong> tanesine (${fPct(share)}) yerleşebilirdin${st.near ? '; ' + fInt(st.near) + ' kadroda sınırdaydın (0,75 puandan yakın)' : ''}.` : 'Karşılaştırma için puanını gir.'}</p>`;
    $('#open-list').addEventListener('click', () => { state.place = st.p.id + '|' + st.p.date; state.page = 0; selectTab('liste'); });
  }
  function renderPlacementTable(list, u) {
    const rows = list.slice().reverse();
    const conv = state.mode === 'rank';
    let h = `<thead><tr><th>Yerleştirme</th><th>Tür</th><th class="r">Puan yılı</th><th class="r">Kadro</th><th class="r">En düşük taban</th>${conv ? '<th class="r">2026 karşılığı</th>' : ''}<th class="r">Medyan</th><th class="r">En yüksek taban</th><th>Senin durumun</th></tr></thead><tbody>`;
    for (const st of rows) {
      const share = st.filled ? st.reach / st.filled : 0;
      const nshare = st.filled ? st.near / st.filled : 0;
      const stt = statusOf(st);
      const key = st.p.id + '|' + st.p.date;
      h += `<tr class="clickable${state.sel === key ? ' sel' : ''}" data-sel="${esc(key)}">
        <td><strong>${esc(st.p.id)}</strong><div class="small muted">${fDate(st.p.date)}</div></td>
        <td class="small">${esc(st.p.kind)}</td>
        <td class="r num">${st.lv.scoreYear}</td>
        <td class="r num">${fInt(st.filled)}${st.bos ? '<div class="small muted">+' + fInt(st.bos) + ' boş</div>' : ''}</td>
        <td class="r num">${fSc(st.min)}</td>
        ${conv ? `<td class="r num">${fSc(to2026(state.level, st.lv.scoreYear, st.min), 2)}</td>` : ''}
        <td class="r num">${fSc(st.med)}</td>
        <td class="r num">${fSc(st.max)}</td>
        <td style="min-width:11rem"><div style="display:flex;gap:8px;align-items:center"><span class="pill ${stt}">${STATUS_TXT[stt]}</span>
          <div class="meter" style="flex:1"><i style="width:${(100 * share).toFixed(1)}%"></i><i style="left:${(100 * share).toFixed(1)}%;width:${(100 * nshare).toFixed(1)}%"></i></div></div>
          <div class="small muted tnum">${fInt(st.reach)} / ${fInt(st.filled)} kadro (${fPct(share)})</div></td></tr>`;
    }
    h += '</tbody>';
    const t = $('#tbl-placements');
    t.innerHTML = rows.length ? h : '<tbody><tr><td class="muted">Bu seçim için yerleştirme yok.</td></tr></tbody>';
    t.querySelectorAll('tr[data-sel]').forEach((tr) => tr.addEventListener('click', () => { state.sel = tr.dataset.sel; save(); renderGecmis(); }));
  }
  function renderHemsire() {
    const card = $('#hemsire-card');
    const show = HT && state.level === 'lisans' && state.group === 'HEMŞİRE';
    card.hidden = !show;
    if (!show) return;
    $('#hemsire-src').textContent = HT.kaynak + '. 2018 ve sonrası satırlar ÖSYM PDF\'leriyle doğrulandı (kadro sayıları ve en düşük tabanlar birebir aynı).';
    let h = '<thead><tr><th>Alım</th><th>Tarih</th><th class="r">Toplam kadro</th><th class="r">Lisans kadro</th><th class="r">Hemşire</th><th class="r">Lisans içinde</th><th class="r">En düşük taban</th></tr></thead><tbody>';
    for (const c of HT.donguler) {
      h += `<tr class="group-row"><td colspan="2">${esc(c.puan)} <span class="small muted" style="font-weight:400">${esc(c.not)}</span></td><td class="r num">${fInt(c.toplam)}</td><td class="r num">${fInt(c.lisans)}</td><td class="r num">${fInt(c.hemsire)}</td><td class="r num">${fPct(c.hemsire / c.lisans)}</td><td></td></tr>`;
      for (const r of c.satirlar) {
        h += `<tr><td>${esc(r[0])}</td><td class="num small">${esc(r[1] || '')}</td><td class="r num">${fInt(r[2])}</td><td class="r num">${fInt(r[3])}</td><td class="r num"><strong>${fInt(r[4])}</strong></td><td class="r num">${r[3] ? fPct(r[4] / r[3]) : ''}</td><td class="r num">${r[5] == null ? '' : fSc(r[5])}</td></tr>`;
      }
    }
    $('#tbl-hemsire').innerHTML = h + '</tbody>';
  }
  function renderGecmis() {
    const u = user();
    const list = visiblePlacements(u);
    $('#gecmis-title').textContent = `${groupLabel(state.group)} · ${LV[state.level].ad}: geçmiş yerleştirmelerde taban puanlar`;
    renderRangeChart(list, u);
    renderDetail(list, u);
    renderPlacementTable(list, u);
    renderHemsire();
  }

  // ---------------------------------------------------------------- senaryo paneli
  const KMIN = 10, KMAX = 60000;
  const k2slider = (k) => Math.round(1000 * (Math.log10(Math.max(KMIN, Math.min(KMAX, k))) - Math.log10(KMIN)) / (Math.log10(KMAX) - Math.log10(KMIN)));
  const slider2k = (v) => Math.round(10 ** (Math.log10(KMIN) + (v / 1000) * (Math.log10(KMAX) - Math.log10(KMIN))));
  function renderScenario() {
    const u = user();
    const fit = currentFit();
    const K = currentK(fit);
    const C0 = parseIntTR(state.C0) || 0;
    const gname = groupLabel(state.group);
    $('#ihtimal-title').textContent = `Şu kadar atama olursa: ${gname} · ${LV[state.level].ad}`;
    $('#in-k').value = k2slider(K);
    if (document.activeElement !== $('#in-k-num')) $('#in-k-num').value = F0.format(K);
    // hazır değerler
    const presets = [];
    if (fit && fit.pts.length) {
      const lastY = Math.max(...fit.pts.map((p) => p.y));
      fit.pts.filter((p) => p.y === lastY).sort((a, b) => b.H - a.H).slice(0, 2).forEach((p) => presets.push([P[p.pi].id + ' kadar', p.H]));
      Object.keys(fit.cycleTotals).map(Number).filter((y) => RECENCY[y]).sort((a, b) => b - a).slice(0, 2)
        .forEach((y) => presets.push([y + ' puanlarıyla toplam', fit.cycleTotals[y]]));
    }
    if (state.level === 'lisans' && state.group === 'HEMŞİRE') presets.push(['Basın tahmini (resmî değil)', 17500]);
    $('#k-presets').innerHTML = presets.map(([l, v]) => `<button type="button" class="chip" data-k="${v}" aria-pressed="${v === K}">${esc(l)} · ${fInt(v)}</button>`).join('');
    const big = $('#scen-big'), kv = $('#scen-kv'), note = $('#scen-note');
    if (!fit || !fit.ok) {
      big.innerHTML = `<div class="item"><span class="eyebrow">Atanma ihtimali</span><span class="val">–</span><span class="small muted">Bu unvan ve düzeyde en az iki anlamlı geçmiş alım yok. "Tüm unvanlar" ya da başka bir unvan seç.</span></div>`;
      kv.innerHTML = ''; note.textContent = ''; $('#prob-chart').innerHTML = ''; $('#tbl-scen').innerHTML = '';
      return;
    }
    const pr = u.rank ? predict(fit, K + C0, u.rank) : null;
    const cls = (p) => (p >= 0.7 ? 'ok' : p >= 0.35 ? 'warn' : 'bad');
    if (pr) {
      big.innerHTML = `<div class="item"><span class="eyebrow">Her ili tercih eden aday için</span><span class="val ${cls(pr.pmax)}">${fProb(pr.pmax)}</span><span class="small muted">en az bir kadroya yerleşme</span></div>
        <div class="item"><span class="eyebrow">Tipik (medyan) kadro için</span><span class="val ${cls(pr.p50)}">${fProb(pr.p50)}</span><span class="small muted">kadroların yarısının tabanını geçme</span></div>`;
      const m26 = model(state.level, CUR);
      const s = (r) => (m26 ? fSc(scoreOn(m26, r), 2) : '–');
      kv.innerHTML = `<dt>Senin başarı sıran</dt><dd>${fInt(u.rank)}${u.estimated ? ' (tahmini)' : ''}</dd>
        <dt>Toplam ${esc(gname)} kadrosu</dt><dd>${fInt(K + C0)}</dd>
        <dt>Tahmini en düşük taban</dt><dd>≈ ${fInt(pr.rmax)}. sıra · ${s(pr.rmax)} puan</dd>
        <dt>%80 aralık</dt><dd>${fInt(pr.rmaxLo)} – ${fInt(pr.rmaxHi)}. sıra · ${s(pr.rmaxLo)} – ${s(pr.rmaxHi)}</dd>
        <dt>Tahmini medyan taban</dt><dd>≈ ${fInt(pr.r50)}. sıra · ${s(pr.r50)} puan</dd>`;
    } else {
      big.innerHTML = `<div class="item"><span class="eyebrow">Atanma ihtimali</span><span class="val">–</span><span class="small muted">Puanını ya da başarı sıranı gir.</span></div>`;
      kv.innerHTML = '';
    }
    const done26 = fit.cycleTotals[CUR] || 0;
    $('#in-c0').nextElementSibling.textContent = done26
      ? `Verilerde 2026 puanlarıyla bu unvana şimdiye kadar ${fInt(done26)} kişi yerleşmiş görünüyor; bunu buraya yazabilirsin.`
      : 'Örneğin KPSS-2026/2\'de bu unvandan kadro açılırsa ve sonra Sağlık Bakanlığı alımı gelirse ilkini buraya yaz.';
    note.innerHTML = `Model: en düşük taban sırası ≈ oran × toplam kadro. Ağırlıklı ortalama oran ${F1.format(Math.exp(fit.max.mu))} (medyan kadro için ${F1.format(Math.exp(fit.q50.mu))}), ${fit.pts.length} geçmiş alımdan. Nitelik (bölüm) şartları ve adayların il tercihleri modellenmez; "her ili tercih eden" senaryosu en iyimser durumdur.`;
    renderProbChart(fit, u, K, C0);
    // tablo
    let h = '<thead><tr><th>Alım</th><th>Tür</th><th class="r">Puan yılı</th><th class="r">Bu alımda</th><th class="r">Döngü toplamı</th><th class="r">En düşük taban sırası</th><th class="r">Oran</th><th class="r">Ağırlık</th></tr></thead><tbody>';
    fit.pts.slice().sort((a, b) => (P[b.pi].date < P[a.pi].date ? -1 : 1)).forEach((p) => {
      h += `<tr><td><strong>${esc(P[p.pi].id)}</strong> <span class="small muted">${fDate(P[p.pi].date)}</span></td><td class="small">${esc(P[p.pi].kind)}</td><td class="r num">${p.y}</td><td class="r num">${fInt(p.H)}</td><td class="r num">${fInt(p.C)}</td><td class="r num">${fInt(p.rmax)}</td><td class="r num">${F1.format(p.kmax)}</td><td class="r num">${F2.format(p.w)}</td></tr>`;
    });
    $('#tbl-scen').innerHTML = h + '</tbody>';
  }
  function renderProbChart(fit, u, K, C0) {
    const host = $('#prob-chart');
    if (!u.rank) { host.innerHTML = ''; return; }
    const W = Math.max(320, host.clientWidth || 600), H = 230;
    const ml = 40, mr = 14, mt = 12, mb = 36;
    const pw = W - ml - mr, ph = H - mt - mb;
    const kmin = 100, kmax = Math.max(50000, K * 1.5);
    const lx = (k) => ml + (Math.log10(k) - Math.log10(kmin)) / (Math.log10(kmax) - Math.log10(kmin)) * pw;
    const ly = (p) => mt + (1 - p) * ph;
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kadro sayısına göre atanma ihtimali">`;
    [0, 0.25, 0.5, 0.75, 1].forEach((p) => {
      s += `<line x1="${ml}" x2="${W - mr}" y1="${ly(p)}" y2="${ly(p)}" stroke="var(--rule)" stroke-width="1"/>`;
      s += `<text x="${ml - 6}" y="${ly(p) + 4}" text-anchor="end" font-size="11">%${p * 100}</text>`;
    });
    [100, 300, 1000, 3000, 10000, 30000, 100000].filter((k) => k <= kmax).forEach((k) => {
      s += `<line x1="${lx(k)}" x2="${lx(k)}" y1="${mt}" y2="${H - mb}" stroke="var(--rule)" stroke-width="1"/>`;
      s += `<text x="${lx(k)}" y="${H - mb + 15}" text-anchor="middle" font-size="11">${k >= 1000 ? F0.format(k / 1000) + ' bin' : k}</text>`;
    });
    const path = (key, color) => {
      let d = '';
      for (let i = 0; i <= 80; i++) {
        const k = 10 ** (Math.log10(kmin) + i / 80 * (Math.log10(kmax) - Math.log10(kmin)));
        const pr = predict(fit, k + C0, u.rank);
        d += (i ? 'L' : 'M') + lx(k).toFixed(1) + ' ' + ly(pr[key]).toFixed(1);
      }
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.4"/>`;
    };
    s += path('p50', 'var(--ok)') + path('pmax', 'var(--accent)');
    const xk = lx(Math.min(kmax, Math.max(kmin, K)));
    s += `<line x1="${xk}" x2="${xk}" y1="${mt}" y2="${H - mb}" stroke="var(--mark)" stroke-width="3"/>`;
    const pr = predict(fit, K + C0, u.rank);
    s += `<circle cx="${xk}" cy="${ly(pr.pmax)}" r="5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>`;
    s += `<circle cx="${xk}" cy="${ly(pr.p50)}" r="5" fill="var(--ok)" stroke="var(--surface)" stroke-width="2"/>`;
    s += `<text x="${ml}" y="${H - 4}" font-size="11">Yatay eksen: 2026 puanlarıyla bu unvana açılan toplam kadro (logaritmik)</text>`;
    host.innerHTML = s + '</svg>';
  }

  // ---------------------------------------------------------------- kadro listesi
  function placeKey(p) { return p.id + '|' + p.date; }
  function fillPlaceSelect() {
    const opts = P.map((p, pi) => ({ p, pi })).filter(({ p }) => p.levels[state.level]).sort((a, b) => (a.p.date < b.p.date ? 1 : -1));
    if (!opts.find((o) => placeKey(o.p) === state.place)) state.place = opts.length ? placeKey(opts[0].p) : null;
    $('#in-place').innerHTML = opts.map(({ p }) => `<option value="${esc(placeKey(p))}">${esc(p.id)} · ${esc(p.kind)} · ${fDate(p.date)}</option>`).join('');
    $('#in-place').value = state.place || '';
  }
  function renderList() {
    fillPlaceSelect();
    const u = user();
    const pi = P.findIndex((p) => placeKey(p) === state.place);
    const t = $('#tbl-list');
    if (pi < 0) { t.innerHTML = ''; $('#list-pager').innerHTML = ''; return; }
    const p = P[pi], lv = p.levels[state.level];
    const thr = threshold(p, state.level, u);
    const g = state.scope === 'group' ? grpIdx() : -1, il = ilIdx();
    const q = (state.q || '').trim().toLocaleUpperCase('tr-TR');
    const items = [];
    for (let i = lv.rows[0]; i < lv.rows[1]; i++) {
      const r = R[i];
      if (!rowMatch(r, g, il)) continue;
      if (q) {
        const hay = (r[COL.kod] + ' ' + DICT.kurum[r[COL.kurum]] + ' ' + DICT.il[r[COL.il]] + ' ' + DICT.unvan[r[COL.unvan]]).toLocaleUpperCase('tr-TR');
        if (!hay.includes(q)) continue;
      }
      items.push(r);
    }
    const sorters = {
      'taban-asc': (a, b) => (a[COL.min] ?? 999) - (b[COL.min] ?? 999),
      'taban-desc': (a, b) => (b[COL.min] ?? -1) - (a[COL.min] ?? -1),
      'kont-desc': (a, b) => b[COL.kont] - a[COL.kont],
      il: (a, b) => DICT.il[a[COL.il]].localeCompare(DICT.il[b[COL.il]], 'tr') || (a[COL.min] ?? 999) - (b[COL.min] ?? 999),
    };
    items.sort(sorters[state.sort] || sorters['taban-asc']);
    const per = 100, pages = Math.max(1, Math.ceil(items.length / per));
    state.page = Math.min(state.page, pages - 1);
    const m = model(state.level, lv.scoreYear);
    let h = `<thead><tr><th>Kadro kodu</th><th>Kurum</th><th>İl</th><th>Unvan</th><th class="r">Kont.</th><th class="r">Yerleşen</th><th class="r">Taban</th><th class="r">Tavan</th><th class="r">Taban sırası</th><th>Durum</th></tr></thead><tbody>`;
    for (const r of items.slice(state.page * per, state.page * per + per)) {
      let st = 'none';
      if (r[COL.min] != null && thr != null) st = thr >= r[COL.min] ? 'ok' : thr >= r[COL.min] - NEAR ? 'warn' : 'bad';
      const lbl = r[COL.min] == null ? 'Boş kaldı' : st === 'ok' ? 'Yeterdi' : st === 'warn' ? 'Sınırda' : st === 'bad' ? 'Yetmezdi' : '–';
      h += `<tr><td class="code">${esc(r[COL.kod])}</td><td>${esc(DICT.kurum[r[COL.kurum]])}</td><td>${esc(trTitle(DICT.il[r[COL.il]]))}</td>
        <td>${esc(trTitle(DICT.unvan[r[COL.unvan]]))}</td><td class="r num">${r[COL.kont]}</td><td class="r num">${r[COL.yer]}</td>
        <td class="r num">${fSc(r[COL.min], 5)}</td><td class="r num">${fSc(r[COL.max], 5)}</td><td class="r num">${r[COL.min] != null && m ? fInt(rankOn(m, r[COL.min])) : '–'}</td>
        <td><span class="pill ${r[COL.min] == null ? 'none' : st}">${lbl}</span></td></tr>`;
    }
    t.innerHTML = items.length ? h + '</tbody>' : '<tbody><tr><td class="muted">Eşleşen kadro yok.</td></tr></tbody>';
    $('#list-pager').innerHTML = `<span class="small muted">${fInt(items.length)} kadro · ${lv.scoreYear} puanları · eşik ${thr != null ? '<span class="num hl">' + fSc(thr, 3) + '</span>' + (state.mode === 'rank' && lv.scoreYear !== CUR ? ' (sıralama eşdeğerin)' : '') : '–'}</span>
      <span style="display:flex;gap:8px;align-items:center"><button class="btn" type="button" id="pg-prev" ${state.page <= 0 ? 'disabled' : ''}>Önceki</button>
      <span class="small tnum">${state.page + 1} / ${pages}</span><button class="btn" type="button" id="pg-next" ${state.page >= pages - 1 ? 'disabled' : ''}>Sonraki</button></span>`;
    $('#pg-prev').addEventListener('click', () => { state.page--; renderList(); });
    $('#pg-next').addEventListener('click', () => { state.page++; renderList(); });
  }

  // ---------------------------------------------------------------- 2026 paneli
  const TIMELINE = [
    ['2026-07-09', '9–16 Tem 2026', 'KPSS-2026/1 tercihleri', 'Bazı kurumların kadrolarına 1. yerleştirme (2024 puanlarıyla).'],
    ['2026-07-24', '24 Tem 2026', 'KPSS-2026/1 sonuçları', '2.083 kadro: 977 lisans, 828 ön lisans, 278 ortaöğretim.'],
    ['2026-09-06', '6 Eyl 2026', '2026-KPSS Lisans sınavı', 'Genel Yetenek-Genel Kültür; alan bilgisi 12–13 Eylül.'],
    ['2026-10-04', '4 Eki 2026', '2026-KPSS Ön Lisans sınavı', ''],
    ['2026-10-07', '7 Eki 2026', 'Lisans sonuçları açıklandı', 'KPSSP3 için 1.559.934 aday; sonuç belgesinde başarı sırası var.'],
    ['2026-10-25', '25 Eki 2026', '2026-KPSS Ortaöğretim sınavı', ''],
    ['2026-10-30', '30 Eki 2026', 'Ön Lisans sonuçları', 'KPSSP93 başarı sıranı buradaki kalibrasyona ekleyebilirsin.'],
    ['2026-11-01', '1 Kas 2026', 'DHBT', 'Sonuçlar 25 Kasım 2026.'],
    ['2026-11-19', '19 Kas 2026', 'Ortaöğretim sonuçları', 'KPSSP94.'],
    ['2026-12-17', '17–24 Ara 2026', 'KPSS-2026/2 tercihleri', '2026 puanlarıyla ilk merkezi yerleştirme. Kadro sayısı tercih kılavuzuyla açıklanacak.'],
    ['2027-01-15', '2027', 'Sonraki alımlar', '2026 puanları iki yıl geçerli: Ekim 2028\'e kadarki yerleştirmelerde kullanılır. Sağlık Bakanlığı için resmî tarih yok.'],
  ];
  function render2026() {
    const today = new Date().toISOString().slice(0, 10);
    let nextDone = false;
    $('#timeline').innerHTML = TIMELINE.map(([d, when, what, sub]) => {
      const done = d < today;
      let cls = done ? 'done' : '';
      if (!done && !nextDone) { cls = 'next'; nextDone = true; }
      return `<li class="${cls}"><span class="when">${esc(when)}</span><span><strong>${esc(what)}</strong>${sub ? '<div class="small muted">' + esc(sub) + '</div>' : ''}</span></li>`;
    }).join('');
    const pi = P.findIndex((p) => p.id === '2026/1' && !p.user);
    if (pi < 0) return;
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
    // unvan grupları
    const u = user();
    const lv = p.levels[state.level];
    $('#k2026-title').textContent = `KPSS-2026/1 · ${LV[state.level].ad}: unvanlara göre kadrolar ve tabanlar`;
    if (!lv) { $('#tbl-2026-groups').innerHTML = ''; return; }
    const byG = new Map();
    for (let i = lv.rows[0]; i < lv.rows[1]; i++) {
      const r = R[i];
      if (!byG.has(r[COL.grup])) byG.set(r[COL.grup], []);
      byG.get(r[COL.grup]).push(r);
    }
    const thr = threshold(p, state.level, u);
    const groups = [...byG.entries()].map(([gi, rs]) => {
      const tabs = rs.filter((r) => r[COL.min] != null && r[COL.yer] > 0).map((r) => [r[COL.min], r[COL.yer]]).sort((a, b) => a[0] - b[0]);
      const kont = rs.reduce((s, r) => s + r[COL.kont], 0);
      const filled = tabs.reduce((s, t) => s + t[1], 0);
      const reach = thr == null ? 0 : tabs.filter((t) => thr >= t[0]).reduce((s, t) => s + t[1], 0);
      return { g: DICT.grup[gi], kont, filled, reach, min: tabs.length ? tabs[0][0] : null, med: tabs.length ? wq(tabs, 0.5) : null, max: tabs.length ? tabs[tabs.length - 1][0] : null };
    }).sort((a, b) => b.kont - a.kont);
    let h2 = '<thead><tr><th>Unvan</th><th class="r">Kontenjan</th><th class="r">En düşük taban</th><th class="r">Medyan</th><th class="r">En yüksek</th><th>Senin durumun</th></tr></thead><tbody>';
    for (const g of groups) {
      const share = g.filled ? g.reach / g.filled : 0;
      const st = g.min == null || thr == null ? 'none' : thr >= g.med ? 'ok' : thr >= g.min ? 'warn' : 'bad';
      h2 += `<tr${g.g === state.group ? ' class="sel"' : ''}><td>${esc(trTitle(g.g))}</td><td class="r num">${fInt(g.kont)}</td><td class="r num">${fSc(g.min)}</td><td class="r num">${fSc(g.med)}</td><td class="r num">${fSc(g.max)}</td>
        <td><span class="pill ${st}">${STATUS_TXT[st]}</span> <span class="small muted tnum">${fInt(g.reach)} / ${fInt(g.filled)}</span></td></tr>`;
    }
    $('#tbl-2026-groups').innerHTML = h2 + '</tbody>';
    $('#news').innerHTML = `<ul>
      <li><strong>KPSS-2026/2:</strong> tercihler 17–24 Aralık 2026 (ÖSYM takvimi). Kadro sayısı tercih kılavuzu yayımlanınca belli olacak; basında yaklaşık 2.500 kadro bekleniyor (resmî değil). Önceki 2. yerleştirmeler: 2025/2'de 3.732, 2024/2'de 1.615, 2023/2'de 3.742 kadro. <a href="https://www.osym.gov.tr/Sayfa/SinavTakvimi" target="_blank" rel="noopener">ÖSYM sınav takvimi</a></li>
      <li><strong>Sağlık Bakanlığı:</strong> 2026 için KPSS ile yapılacak sözleşmeli sağlık personeli alımına dair resmî kontenjan ve tarih açıklanmadı. Basında yer alan 26.673 sözleşmeli pozisyonun büyük bölümü uzman doktor ve doktor kadrosudur (KPSS ile yerleştirilmez). Bazı siteler hemşire için 17.500 ve üzeri tahmin ediyor; bunlar resmî değildir. <a href="https://www.isinolsa.com/2026-saglik-bakanligi-atamasinda-brans-brans-kontenjan-tahmini-hemsire-ebe-ve-7-meslek-icin-kac-kadro-gelebilir/" target="_blank" rel="noopener">Basın tahmini</a></li>
      <li><strong>Puan geçerliliği:</strong> 2026-KPSS sonuçları açıklandığı tarihten itibaren iki yıl geçerlidir. 2026 Lisans puanı alan adayların 2024 Ön Lisans/Ortaöğretim puanlarının geçerliliği, 2026 Lisans sonucunun açıklandığı tarihte sona erer (2026 Lisans kılavuzu, madde 1.12).</li>
      <li><strong>Geçmiş örüntü:</strong> Her puan döngüsünde Haziran–Temmuz ve Aralık–Ocak'ta iki merkezi yerleştirme, ayrıca kurum bazlı (Sağlık, MEB, Tarım ve Orman vb.) alımlar yapıldı. ${cycleSummary(2024)}</li></ul>`;
  }
  function cycleSummary(y) {
    const ids = new Set();
    let k = 0;
    P.forEach((p) => { if (p.user) return; for (const lv of Object.values(p.levels)) { if (lv.scoreYear === y) { ids.add(p.id); k += lv.kontenjan; } } });
    return `${y} puanlarıyla yapılan ${ids.size} yerleştirmede (lisans, ön lisans ve ortaöğretim) toplam ${fInt(k)} kadro açıldı.`;
  }

  // ---------------------------------------------------------------- veri ekle
  let uploads = store.get('kpss2026-uploads', []);
  function normHeader(h) {
    return String(h || '').trim().toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
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
    for (const [y, d] of Object.entries(ex)) if (d <= t && (best == null || +y > best)) best = +y;
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
      unvan: col('kadro_unvani', 'kadro_adi', 'unvan'), grup: col('unvan_grubu'), kont: col('kontenjan'), yer: col('yerlesen'), bos: col('bos'),
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
          const y = ci.yer >= 0 ? (parseIntTR(r[ci.yer]) ?? (mn != null ? k : 0)) : (mn != null ? k : 0);
          const unv = ci.unvan >= 0 ? String(r[ci.unvan] || '').trim().toLocaleUpperCase('tr-TR') : '';
          const grp = ci.grup >= 0 && r[ci.grup] ? String(r[ci.grup]).trim().toLocaleUpperCase('tr-TR') : unv.replace(/\s*\(.*$/, '');
          const ilv = ci.il >= 0 ? String(r[ci.il] || '').trim().toLocaleUpperCase('tr-TR') : '';
          const b = ci.birim >= 0 ? String(r[ci.birim] || '').toLocaleUpperCase('tr-TR') : '';
          R.push([pidx, LEVELS.indexOf(lvl), ci.kod >= 0 ? String(r[ci.kod] || '') : '', dictIdx('kurum', ci.kurum >= 0 ? String(r[ci.kurum] || '').trim() : ''),
            dictIdx('il', ilv), b.includes('MERKEZ') ? 1 : b.includes('TAŞRA') ? 2 : 0, dictIdx('unvan', unv), dictIdx('grup', grp), k, y, mn,
            ci.max >= 0 ? parseScore(r[ci.max]) : mn]);
          kont += k; yer += y; added++;
        }
        pl.levels[lvl] = { scoreYear: lv.py || scoreYearFor(lvl, gp.date), tercih: null, kontenjan: kont, yerlesen: yer, bos: kont - yer, rows: [start, R.length] };
      }
      P.push(pl);
    }
    return { added, skipped };
  }
  function loadUploads() {
    const msgs = [];
    for (const up of uploads) {
      try { const r = ingest(up.name, up.text); msgs.push(`${up.name}: ${r.added} satır`); } catch (e) { msgs.push(`${up.name}: ${e.message}`); }
    }
    return msgs;
  }
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
      msg.innerHTML = `<div class="msg ok">${esc(file.name)}: ${fInt(r.added)} kadro satırı eklendi${r.skipped ? ', ' + fInt(r.skipped) + ' satır atlandı (zaten var ya da düzey okunamadı)' : ''}.${ok ? '' : ' Dosya büyük olduğu için tarayıcıya kaydedilemedi; sayfa yenilenince yeniden yüklemen gerekir.'}</div>`;
      fitCache.key = null;
      refreshAll();
    } catch (e) {
      msg.innerHTML = `<div class="msg bad">${esc(e.message)}</div>`;
    }
  }
  function renderVeri() {
    let h = '<thead><tr><th>Düzey</th><th class="r">Puan</th><th class="r">Başarı sırası</th><th class="r">Aday sayısı</th><th></th></tr></thead><tbody>';
    calib.forEach((c, i) => {
      h += `<tr><td>${LV[c.level].ad}</td><td class="r num">${fSc(c.score, 5)}</td><td class="r num">${fInt(c.rank)}</td><td class="r num">${fInt(c.n)}</td><td><button class="btn" type="button" data-del-cal="${i}">Sil</button></td></tr>`;
    });
    $('#tbl-cal').innerHTML = calib.length ? h + '</tbody>' : '<tbody><tr><td class="small muted" style="padding:12px 16px">Henüz eklenmiş nokta yok. Lisans 2026 modeli 13 sonuç belgesiyle zaten kalibre edildi.</td></tr></tbody>';
    document.querySelectorAll('[data-del-cal]').forEach((b) => b.addEventListener('click', () => {
      calib.splice(+b.dataset.delCal, 1); store.set('kpss2026-cal', calib); resetModels(); fitCache.key = null; refreshAll();
    }));
    let h2 = '<thead><tr><th>Dosya</th><th>Eklenme</th><th></th></tr></thead><tbody>';
    uploads.forEach((up, i) => { h2 += `<tr><td>${esc(up.name)}</td><td class="small">${esc((up.at || '').slice(0, 10))}</td><td><button class="btn" type="button" data-del-up="${i}">Kaldır</button></td></tr>`; });
    $('#tbl-uploads').innerHTML = uploads.length ? h2 + '</tbody>' : '';
    document.querySelectorAll('[data-del-up]').forEach((b) => b.addEventListener('click', () => {
      uploads.splice(+b.dataset.delUp, 1); store.set('kpss2026-uploads', uploads);
      $('#file-msg').innerHTML = '<div class="msg ok">Kaldırıldı. Değişikliğin uygulanması için sayfayı yenile.</div>';
      renderVeri();
    }));
  }

  // ---------------------------------------------------------------- yöntem
  function renderMethod() {
    const nP = BASE_P, nR = BASE_ROWS;
    const first = P[0], last = P[BASE_P - 1];
    const m26 = RK.models['lisans-2026'];
    const totalK = R.slice(0, BASE_ROWS).reduce((s, r) => s + r[COL.kont], 0);
    $('#stamp').innerHTML = `<span>Veri: ÖSYM yerleştirme sonuçları</span><span><b>${fInt(nP)}</b> yerleştirme · <b>${fInt(nR)}</b> kadro satırı</span><span>KPSS-${esc(first.id)} → KPSS-${esc(last.id)}</span>`;
    $('#foot-data').innerHTML = `Veri seti ${esc(D.generated)} tarihinde ÖSYM'nin yayımladığı "En Küçük ve En Büyük Puanlar" ve "Sayısal Bilgiler" belgelerinden üretildi (${fInt(totalK)} kadro).`;
    $('#method').innerHTML = `
      <h2>Yöntem ve kaynaklar</h2>
      <h3>1. Veri</h3>
      <p>ÖSYM'nin sitesinde yayımlanan ${fInt(nP)} yerleştirmenin (KPSS-${esc(first.id)}, ${fDate(first.date)} → KPSS-${esc(last.id)}, ${fDate(last.date)}) "En Küçük ve En Büyük Puanlar" PDF'leri satır satır ayrıştırıldı: kadro kodu, kurum, il, kadro unvanı, kontenjan, yerleşen sayısı, en küçük (taban) ve en büyük (tavan) puan. Toplam ${fInt(nR)} satır, ${fInt(totalK)} kadro.</p>
      <ul>
        <li>Her yerleştirme ve düzey için ayrıştırılan kontenjan ve yerleşen toplamları, ÖSYM'nin "Sayısal Bilgiler" özetiyle karşılaştırıldı: 181 dönem-düzey kaydının tamamı birebir tutuyor.</li>
        <li>Lisans hemşire kadroları için 2018–2025 arası 20 alımın kadro sayısı ve en düşük tabanı, kullanıcının paylaştığı tabloyla 20/20 aynı.</li>
        <li>2020/7 Tarım ve Orman yerleştirmesi yerine, onun yerini alan Şubat 2021 "yeni yerleştirme" sonucu kullanıldı. Kadro unvanlarındaki branş parantezleri (ör. "Mühendis (Makine)") unvan grubunda birleştirildi.</li>
        <li>Her yerleştirmenin hangi yılın puanını kullandığı, tercih döneminden önce açıklanan son sınav sonucuna göre belirlendi (ör. KPSS-2026/1: 2024 puanları; KPSS-2026/2: 2026 puanları).</li>
      </ul>
      <h3>2. Puan → başarı sırası</h3>
      <p>KPSS puanı, ağırlıklı standart puanın (ASP) doğrusal dönüşümüdür: <code>KPSS = 70 + 30·[2(ASP−X) − S] / [2(B−X) − S]</code> (2026 Lisans Kılavuzu, 3.10). Kullanıcının paylaştığı 13 adet 2026 sonuç belgesindeki doğru/yanlış sayıları bu formülle puanı 0,0002 hata payıyla veriyor; belgelerdeki 39 (puan, başarı sırası) noktası P1, P2 ve P3 için aynı standart eğri üzerine düşüyor. Bu eğri ${fInt(m26.n)} adaylık 2026 Lisans dağılımını oluşturur.</p>
      <p>Önceki yıllar için aynı eğri şekli, o yılın ölçeğiyle (en yüksek puanın standart konumu) ve aday sayısıyla uyarlandı. Model 2018 ve 2020 Ön Lisans/Ortaöğretim için ÖSYM değerlendirme raporlarındaki gerçek puan dağılımlarını üst bölgede %5–20 farkla yeniden üretiyor. 2022 ve 2024 Lisans ölçekleri test istatistiklerinden tahmin edildiği için bu yılların sıralama karşılıkları yaklaşık değerdir.</p>
      <h3>3. Yıllar arası karşılaştırma</h3>
      <p>Varsayılan karşılaştırma başarı sırasına dayanır: geçmiş bir yerleştirmede "bu sıralamayla yerleşebilir miydim?" sorusu, senin 2026 sıranın o yılın puan ölçeğindeki karşılığıyla (eşdeğer puan) yanıtlanır. Kadro sayıları mutlak olduğu için aday sayısı arttıkça aynı puan daha geride bir sıraya düşer; ham puan karşılaştırması bu farkı göz ardı eder ve seçenek olarak ayrıca sunulur.</p>
      <h3>4. Atanma ihtimali</h3>
      <p>Her puan döngüsünde, bir unvana o güne kadar yerleşen toplam kişi (C) ile o alımdaki en düşük tabanın başarı sırası (r) arasındaki oran (r/C) hesaplanır. Örneğin lisans hemşire kadrolarında bu oran 2018–2024 döngülerinde 15 ile 37 arasındadır. 2026 senaryosu için ağırlıklı ortalama oran ve oranların yayılımı (log-normal) kullanılır: ihtimal = P(oran × kadro ≥ senin sıran). "Tipik kadro" ihtimali aynı yöntemle medyan taban için hesaplanır.</p>
      <h3>5. Sınırlar</h3>
      <ul>
        <li>Nitelik kodları (mezun olunan bölüm, sertifika, yaş vb.) modellenmez; bir unvanın tüm kadrolarına başvurabildiğin varsayılır.</li>
        <li>Adayların tercih davranışı (il seçimi, tercih sayısı) bilinmez. "Her ili tercih eden aday" ihtimali en iyimser senaryodur.</li>
        <li>Önceki yerleştirmelerde yerleşen adayların 2026 döngüsünde yeniden başvurup başvurmayacağı bilinmez; model bunu geçmiş döngülerdeki ortalama davranışla yansıtır.</li>
        <li>2026 Ön Lisans ve Ortaöğretim modelleri sonuçlar açıklanana kadar 2024 aday sayısına dayanan kaba tahminlerdir. Sonuç belgendeki başarı sıranı girmen ya da Veri ekle bölümünden kalibrasyon noktası eklemen önerilir.</li>
        <li>2024 Lisans sonuçları, 4 sorunun yargı kararıyla iptali sonrası 7 Kasım 2024'te yeniden hesaplandı; 2024/2 ve sonrası yerleştirmeler bu puanlarla yapıldı.</li>
      </ul>
      <h3>6. Kaynaklar</h3>
      <ul>
        <li><a href="https://www.osym.gov.tr/SinavGrubu/Menu/341" target="_blank" rel="noopener">ÖSYM KPSS Sayısal Bilgiler</a> (yerleştirme sonuçları ve en küçük/en büyük puanlar)</li>
        <li><a href="https://www.osym.gov.tr/2026kpss-lisans-kilavuz-ve-basvuru-bilgileri" target="_blank" rel="noopener">2026-KPSS Lisans Kılavuzu</a> (puan hesaplama formülü)</li>
        <li><a href="https://www.osym.gov.tr/2026-kpss-lisans-sinavi-sonuclarina-iliskin-sayisal-bilgiler" target="_blank" rel="noopener">2026-KPSS Lisans sayısal bilgiler</a> (test ortalamaları ve standart sapmaları)</li>
        <li><a href="https://www.osym.gov.tr/BilgiKategori/Index/2" target="_blank" rel="noopener">ÖSYM değerlendirme raporları</a> (2018 ve 2020 Ön Lisans/Ortaöğretim puan dağılımları)</li>
        <li><a href="https://www.osym.gov.tr/Sayfa/SinavTakvimi" target="_blank" rel="noopener">ÖSYM 2026 sınav takvimi</a></li>
      </ul>`;
  }

  // ---------------------------------------------------------------- sekmeler ve olaylar
  const TABS = ['gecmis', 'ihtimal', 'liste', 'kadro2026', 'veri', 'yontem'];
  function selectTab(id, push = true) {
    if (!TABS.includes(id)) id = 'gecmis';
    state.tab = id;
    TABS.forEach((t) => {
      $('#' + t).hidden = t !== id;
      $('#t-' + t).setAttribute('aria-selected', String(t === id));
    });
    if (push) { try { history.replaceState(null, '', '#' + id); } catch (e) { /* yoksay */ } }
    save();
    renderTab();
  }
  function renderTab() {
    if (state.tab === 'gecmis') renderGecmis();
    else if (state.tab === 'ihtimal') renderScenario();
    else if (state.tab === 'liste') renderList();
    else if (state.tab === 'kadro2026') render2026();
    else if (state.tab === 'veri') renderVeri();
  }
  function refreshAll() {
    renderSummary(user());
    renderTab();
    $('#example-flag').hidden = !state.example;
  }
  let timer = null;
  function soon() { clearTimeout(timer); timer = setTimeout(() => { save(); refreshAll(); }, 140); }
  function markEdited() { state.example = false; $('#example-flag').hidden = true; }

  function init() {
    loadUploads();
    fillKinds(); fillIl(); fillGroups(); syncLevelButtons();
    elScore.value = state.score || '';
    elRank.value = state.rank || '';
    $('#in-mode').value = state.mode;
    $('#in-sort').value = state.sort;
    $('#in-scope').value = state.scope;
    $('#in-c0').value = state.C0 || '0';
    renderMethod();
    document.querySelectorAll('#level-seg button').forEach((b) => b.addEventListener('click', () => {
      state.level = b.dataset.level; state.sel = null; state.place = null; state.K = null; syncLevelButtons(); fillGroups(); save(); refreshAll();
    }));
    elScore.addEventListener('input', () => { state.score = elScore.value; markEdited(); soon(); });
    elRank.addEventListener('input', () => { state.rank = elRank.value; markEdited(); soon(); });
    elGroup.addEventListener('change', () => { state.group = elGroup.value; state.K = null; state.sel = null; fillGroups(); save(); refreshAll(); });
    $('#group-chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-group]'); if (!b) return;
      state.group = b.dataset.group; state.K = null; state.sel = null; fillGroups(); save(); refreshAll();
    });
    elIl.addEventListener('change', () => { state.il = elIl.value; save(); refreshAll(); });
    $('#in-mode').addEventListener('change', (e) => { state.mode = e.target.value; save(); refreshAll(); });
    $('#in-kind').addEventListener('change', (e) => { state.kind = e.target.value; save(); refreshAll(); });
    $('#in-k').addEventListener('input', (e) => { state.K = String(slider2k(+e.target.value)); soon(); });
    $('#in-k-num').addEventListener('change', (e) => { const k = parseIntTR(e.target.value); state.K = k ? String(k) : null; save(); refreshAll(); });
    $('#k-presets').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; state.K = b.dataset.k; save(); refreshAll(); });
    $('#in-c0').addEventListener('input', (e) => { state.C0 = e.target.value; soon(); });
    $('#in-place').addEventListener('change', (e) => { state.place = e.target.value; state.page = 0; save(); renderList(); });
    $('#in-q').addEventListener('input', (e) => { state.q = e.target.value; state.page = 0; clearTimeout(timer); timer = setTimeout(renderList, 180); });
    $('#in-sort').addEventListener('change', (e) => { state.sort = e.target.value; state.page = 0; save(); renderList(); });
    $('#in-scope').addEventListener('change', (e) => { state.scope = e.target.value; state.page = 0; save(); renderList(); });
    $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[role="tab"]'); if (b) selectTab(b.id.slice(2)); });
    $('#tabs').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = TABS.indexOf(state.tab) + (e.key === 'ArrowRight' ? 1 : -1);
      const id = TABS[(i + TABS.length) % TABS.length];
      selectTab(id); $('#t-' + id).focus();
    });
    $('#aday-form').addEventListener('submit', (e) => e.preventDefault());
    $('#cal-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const c = { level: $('#cal-level').value, year: CUR, score: parseScore($('#cal-score').value), rank: parseIntTR($('#cal-rank').value), n: parseIntTR($('#cal-n').value) };
      if (!c.score || c.score < 40 || c.score > 100 || !c.rank) { $('#cal-msg').innerHTML = '<div class="msg bad">Puan (40–100) ve başarı sırası gerekli.</div>'; return; }
      calib.push(c); store.set('kpss2026-cal', calib); resetModels(); fitCache.key = null;
      $('#cal-msg').innerHTML = '<div class="msg ok">Eklendi. Model güncellendi.</div>';
      $('#cal-score').value = ''; $('#cal-rank').value = '';
      refreshAll();
    });
    const drop = $('#drop');
    $('#in-file').addEventListener('change', (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
    $('#copy-tpl').addEventListener('click', async () => {
      const txt = $('#tpl').textContent;
      try { await navigator.clipboard.writeText(txt); $('#copy-tpl').textContent = 'Kopyalandı'; }
      catch (e) { const r = document.createRange(); r.selectNodeContents($('#tpl')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); $('#copy-tpl').textContent = 'Seçildi, kopyala'; }
    });
    let rz = null;
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (state.tab === 'gecmis') renderGecmis(); if (state.tab === 'ihtimal') renderScenario(); }, 200); });
    const hash = (location.hash || '').replace('#', '');
    selectTab(TABS.includes(hash) ? hash : state.tab, false);
    refreshAll();
  }
  init();
})();
