/* fx-app.js - dashboard UI for index.html. Uses window.FX from fx-core.js. Plain JavaScript, no libraries. */
(function () {
  "use strict";
  var FX = window.FX;
  var $ = function (id) { return document.getElementById(id); };
  var esc = FX.esc;
  var REFRESH_MS = 60000;
  var TODO_KEY = "fxapp.todo.v1", THEME_KEY = "fxapp.theme", GUIDED_KEY = "fxapp.guided.v1";
  var PAIRS = [
    { b: "USD", q: "MYR" }, { b: "SGD", q: "MYR" }, { b: "THB", q: "MYR", unit: 100 },
    { b: "USD", q: "SGD" }, { b: "USD", q: "THB" }, { b: "SGD", q: "THB" }
  ];
  var VIEWS = { overview: "Overview", rates: "Bank rates", compare: "Compare", quote: "Your quote", checklist: "Checklist",
    sheet: "Full sheet", markets: "Rates & history", sources: "Sources & health", help: "How it works" };
  var CODE_HELP = {
    OUR: "OUR: you pay all transfer fees on top. The beneficiary receives the full amount. Use for supplier invoices.",
    SHA: "SHA: you pay your bank's fee on top; intermediary and receiving-bank fees are deducted on the way.",
    BEN: "BEN: all fees are deducted from the amount. You pay nothing extra; the beneficiary receives the least."
  };
  var FAM_NAME = { A: "Convert first", B: "Send, then convert", C: "Held abroad", D: "Via USD", P: "FX platform", R: "Dealer RFQ" };
  var TODO = [
    "Ask for a firm rate for the exact amount and value date, not the board rate.",
    "Ask whether the quote includes all charges (TT fee, cable charge, commission in lieu of exchange).",
    "Confirm the SWIFT charge code (OUR / SHA / BEN) and any intermediary bank.",
    "Confirm the cut-off time and value date in both countries.",
    "Confirm beneficiary name, account number, bank BIC and address.",
    "Check the purpose code and supporting documents the banks need.",
    "Ask how long the quote is valid and how to lock it.",
    "Type the firm quote into \"Your quote\" and compare before accepting."
  ];

  /* ---------- Settings: live (persisted) and worked example (scratch) ---------- */
  var S = FX.loadSettings();
  function makeExample() {
    var e = FX.clone(FX.DEFAULTS);
    e.scenario = { amount: 1000000, from: "SGD", to: "THB", holdAbroad: false };
    e.providers.forEach(function (p) { p.enabled = ["uob-sg", "th-bank-a", "fx-platform"].indexOf(p.id) >= 0; });
    e.providers.forEach(function (p) {
      if (p.id === "uob-sg") { p.mode = "quote"; p.quotePair = "SGD/THB"; p.quoteValue = 25.65; p.note = "Sheet example: UOB SG board rate 25.65."; }
      if (p.id === "th-bank-a") { p.mode = "quote"; p.quotePair = "SGD/THB"; p.quoteValue = 25.72; p.note = "Sheet example: Thai bank 25.72."; }
    });
    return e;
  }
  var EX = makeExample();
  var state = { mode: "live", perUsd: {}, health: {}, lastCheck: null, lastGood: null, nextAt: null, paused: false, busy: false,
    cachedAt: null, selected: null, model: null, view: "overview", hist: {}, histDays: 182, cardHist: {}, gapDismissed: false };
  function cfg() { return state.mode === "example" ? EX : S; }
  function persist() { if (state.mode === "live") FX.saveSettings(S); }
  var timer = null;
  var snap = FX.loadSnapshot();
  if (snap) { state.perUsd = snap.perUsd; state.cachedAt = snap.at; state.health = snap.health || {}; }

  /* ---------- Small helpers ---------- */
  function money(ccy, v, dp) { return ccy + " " + FX.fmtMoney(v, dp == null ? 2 : dp); }
  function perUsd() { return state.mode === "example" ? {} : state.perUsd; }
  function srcLabel(id) { var s = FX.SOURCES.filter(function (x) { return x.id === id; })[0]; return s ? s.label : id; }
  function fmtAsOf(d) { // date-only sources sit at 00:00 UTC; show them as a date
    if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return FX.dayMonUTC(d) + " (daily)";
    return FX.dayMon(d) + ", " + FX.hhmm(d);
  }
  var toastTimer = null;
  function toast(msg, actionLabel, action) {
    var t = $("toast");
    t.innerHTML = esc(msg) + (actionLabel ? ' <button type="button" class="btn small" id="toastAct" style="margin-left:8px">' + esc(actionLabel) + "</button>" : "");
    t.style.pointerEvents = actionLabel ? "auto" : "none";
    t.classList.add("show");
    if (actionLabel) $("toastAct").addEventListener("click", function () { action(); t.classList.remove("show"); });
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, actionLabel ? 7000 : 2600);
  }
  function midHow(info) {
    if (state.mode === "example") return "sheet example mid";
    if (info.how === "live" && !state.lastGood && state.cachedAt) return "saved rates from " + FX.hhmm(state.cachedAt) + " " + FX.dayMon(state.cachedAt);
    return info.how === "live" ? "live consensus" : info.how === "stale" ? "older source rates (stale)" : info.how === "fallback" ? "illustrative fallback" : "";
  }

  /* ---------- Model ---------- */
  function computeModel() {
    var now = new Date(), C = cfg(), sc = C.scenario;
    var mid = FX.makeMid(perUsd(), C, now);
    var m = { now: now, mid: mid, src: sc.from, tgt: sc.to, amount: +sc.amount, ok: true, C: C };
    if (sc.from === sc.to) { m.ok = false; m.msg = "Pick two different currencies."; return m; }
    if (!(m.amount > 0)) { m.ok = false; m.msg = "Enter an amount."; return m; }
    m.midInfo = mid.info(sc.from, sc.to);
    m.cons = FX.consensus(perUsd(), sc.from, sc.to, now, true);
    m.routes = FX.buildRoutes(C, mid);
    m.results = m.routes.map(function (r) { return FX.evaluate(r, m.amount, sc.from, sc.to, mid); });
    m.cmp = FX.compare(m.results, m.amount, sc.from, sc.to, mid, +C.risk.annualVolPct || 0);
    m.available = m.results.filter(function (r) { return r.ok; });
    m.unavailable = m.results.filter(function (r) { return !r.ok; });
    if (!state.selected || !m.available.some(function (r) { return r.route.id === state.selected; })) {
      state.selected = m.cmp.best ? m.cmp.best.route.id : null;
    }
    // Provider list for this pair (rates view, quote view, sheet)
    var oc = FX.COUNTRY_OF[m.src], dc = FX.COUNTRY_OF[m.tgt];
    m.provs = C.providers.filter(function (p) { return p.enabled && [oc, dc, "ANY", "ORIGIN"].indexOf(p.country) >= 0; }).map(function (p) {
      var pr = FX.providerRate(p, m.src, m.tgt, mid), recv = NaN;
      if (pr.ok) recv = (m.amount * (1 - (+p.feePct || 0) / 100) - (+p.feeFixed || 0)) * pr.rate;
      return { p: p, pr: pr, recv: recv };
    }).sort(function (a, b) { return (isFinite(b.recv) ? b.recv : -Infinity) - (isFinite(a.recv) ? a.recv : -Infinity); });
    return m;
  }

  /* ---------- Scenario bar ---------- */
  function fillSelects() {
    var opts = FX.ROUTE_CCYS.map(function (c) { return '<option value="' + c + '">' + c + "</option>"; }).join("");
    $("fromCcy").innerHTML = opts; $("toCcy").innerHTML = opts;
  }
  function syncInputs() {
    var C = cfg(), sc = C.scenario;
    $("fromCcy").value = sc.from; $("toCcy").value = sc.to;
    if (document.activeElement !== $("amt")) { $("amt").value = FX.fmtMoney(+sc.amount, sc.amount % 1 ? 2 : 0); $("amt").removeAttribute("aria-invalid"); }
    $("holdAbroad").checked = !!sc.holdAbroad;
    $("holdLabel").textContent = "We already hold " + sc.from + " in " + (FX.COUNTRY_NAME[FX.COUNTRY_OF[sc.to]] || sc.to);
    document.querySelectorAll("#codeSeg button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-code") === C.fees.code)); });
    document.querySelectorAll("#modeSeg button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-mode") === state.mode)); });
  }

  /* ---------- Charts ---------- */
  // Horizontal bars of net received. Baseline is not zero (differences are small), and the note says so.
  function barsHtml(m, short) {
    var list = m.results.filter(function (r) { return r.route.legs.length; });
    var ok = list.filter(function (r) { return r.ok; });
    if (!ok.length) return '<p class="hint">No route could be priced.</p>';
    var vals = ok.map(function (r) { return r.netPerAmount; });
    var hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals);
    var pad = (hi - lo) || hi * 0.001, base = lo - pad * 1.5;
    var rows = list.slice().sort(function (a, b) { return (b.ok ? b.netPerAmount : -Infinity) - (a.ok ? a.netPerAmount : -Infinity); }).map(function (r) {
      var f = r.route.family, isBest = m.cmp.best === r;
      var w = r.ok ? Math.max(3, (r.netPerAmount - base) / (hi - base) * 100) : 0;
      return '<div class="brow">' +
        '<div class="b-name"><span class="fam fam-' + f + '">' + f + '</span><span class="b-lbl" title="' + esc(r.route.title) + '">' + esc(r.route.short) + "</span></div>" +
        '<div class="b-track">' + (r.ok ? '<div style="height:100%;width:' + w.toFixed(1) + "%;border-radius:6px;background:var(--r" + f + ")" + (isBest ? ";box-shadow:inset 0 0 0 2px var(--accent)" : "") + '"></div>' : "") + "</div>" +
        '<div class="num b-val">' + (r.ok ? FX.fmtMoney(r.netPerAmount, 0) + (isBest ? ' <span class="tag good">Best</span>' : "") : '<span class="hint">no rate</span>') + "</div></div>";
    }).join("");
    return rows + '<p class="hint" style="margin-bottom:0">' + m.tgt + " received per " + money(m.src, m.amount, 0) + ", after fees. Bars start at " + FX.fmtMoney(base, 0) + ", not zero, so small gaps look bigger than they are." + (short ? "" : " Routes that move money first carry transit risk.") + "</p>";
  }
  function sparkSvg(rows) {
    if (!rows || rows.length < 2) return '<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"></svg>';
    var h = rows.map(function (r) { return r.rate; });
    var lo = Math.min.apply(null, h), hi = Math.max.apply(null, h), rng = hi - lo || 1;
    var d = h.map(function (v, i) { return (i ? "L" : "M") + (i / (h.length - 1) * 100).toFixed(2) + " " + (28 - (v - lo) / rng * 26).toFixed(2); }).join(" ");
    return '<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="' + d + '"/></svg>';
  }
  function lineChart(el, rows, nowMid) {
    var W = Math.max(280, el.clientWidth || 600), H = 230, L = 52, R = 14, T = 12, B = 26;
    var vals = rows.map(function (r) { return r.rate; }).concat(isFinite(nowMid) ? [nowMid] : []);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * 0.08 || hi * 0.001;
    lo -= pad; hi += pad;
    var t0 = rows[0].date.getTime(), t1 = rows[rows.length - 1].date.getTime(), span = t1 - t0 || 1;
    var x = function (t) { return L + (t - t0) / span * (W - L - R); };
    var y = function (v) { return T + (1 - (v - lo) / (hi - lo)) * (H - T - B); };
    var g = "", i;
    for (i = 0; i <= 4; i++) { var v = lo + (hi - lo) * i / 4, yy = y(v); g += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/><text x="' + (L - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + FX.fmtRate(v) + "</text>"; }
    var ticks = Math.min(6, Math.floor((W - L - R) / 90));
    for (i = 0; i <= ticks; i++) { var tt = t0 + span * i / ticks; g += '<text x="' + x(tt) + '" y="' + (H - 6) + '" text-anchor="middle">' + FX.dayMonUTC(new Date(tt)) + (span > 300 * 864e5 ? " " + String(new Date(tt).getUTCFullYear()).slice(2) : "") + "</text>"; }
    var path = rows.map(function (r, k) { return (k ? "L" : "M") + x(r.date.getTime()).toFixed(1) + " " + y(r.rate).toFixed(1); }).join(" ");
    var area = path + " L" + x(t1).toFixed(1) + " " + (H - B) + " L" + L + " " + (H - B) + " Z";
    var last = rows[rows.length - 1];
    el.innerHTML = '<svg class="chart" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Rate history line chart" tabindex="0">' + g +
      '<path class="area" d="' + area + '"/><path class="line" d="' + path + '"/>' +
      '<line class="hover-line" id="hl" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" visibility="hidden"/>' +
      '<circle class="now" cx="' + x(t1) + '" cy="' + y(last.rate) + '" r="4.5"/></svg>';
    var svg = el.querySelector("svg"), hl = svg.querySelector("#hl"), tip = $("histTip"), idx = rows.length - 1;
    function show(k) {
      idx = Math.max(0, Math.min(rows.length - 1, k));
      var r = rows[idx], xx = x(r.date.getTime());
      hl.setAttribute("x1", xx); hl.setAttribute("x2", xx); hl.setAttribute("visibility", "visible");
      tip.textContent = FX.dayMonUTC(r.date) + " " + r.date.getUTCFullYear() + ": " + FX.fmtRate(r.rate) + (isFinite(nowMid) ? " · today's mid is " + FX.fmtSigned(FX.bps(nowMid, r.rate), 1) + " bps vs this day" : "");
    }
    svg.addEventListener("pointermove", function (e) {
      var b = svg.getBoundingClientRect(), px = (e.clientX - b.left) / b.width * W, t = t0 + (px - L) / (W - L - R) * span, best = 0, bd = Infinity;
      rows.forEach(function (r, k) { var d = Math.abs(r.date.getTime() - t); if (d < bd) { bd = d; best = k; } });
      show(best);
    });
    svg.addEventListener("pointerleave", function () { hl.setAttribute("visibility", "hidden"); tip.textContent = ""; });
    svg.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { show(idx - 1); e.preventDefault(); } else if (e.key === "ArrowRight") { show(idx + 1); e.preventDefault(); }
    });
  }

  /* ---------- History loading ---------- */
  function histKey(b, q, d) { return b + "/" + q + "/" + d; }
  function loadHist(b, q, days) {
    var k = histKey(b, q, days);
    if (state.hist[k] && (state.hist[k].rows || state.hist[k].loading)) return;
    state.hist[k] = { loading: true };
    FX.fetchHistory(b, q, days).then(function (rows) { state.hist[k] = { rows: rows }; renderView(); },
      function (e) { state.hist[k] = { err: e.message, t: Date.now() }; renderView(); });
  }
  function getHist(b, q, days) {
    var k = histKey(b, q, days), h = state.hist[k];
    if (h && h.err && Date.now() - h.t > 120e3) { delete state.hist[k]; h = null; }
    if (!h) loadHist(b, q, days);
    return state.hist[k];
  }

  /* ---------- Overview ---------- */
  function renderOverview(m) {
    renderVerdict(m);
    if (!m.ok) { $("ovKpis").innerHTML = ""; $("ovBars").innerHTML = ""; $("ovSources").innerHTML = ""; $("ovTiming").innerHTML = ""; renderCards(m, "cards"); return; }
    var c = m.cmp, best = c.best, tgt = m.tgt, src = m.src;
    $("ovKpis").innerHTML =
      '<div class="kpi"><div class="k">Market mid</div><div class="v">' + FX.fmtRate(m.midInfo.mid) + '</div><div class="s">' + tgt + " per 1 " + src + " · " + esc(midHow(m.midInfo)) + "</div></div>" +
      '<div class="kpi hl"><div class="k">Best: they receive</div><div class="v">' + (best ? money(tgt, best.net, 0) : "—") + '</div><div class="s">' + (best ? esc(best.route.short) : "no route priced") + "</div></div>" +
      '<div class="kpi"><div class="k">Saved vs worst route</div><div class="v">' + (best && c.sorted.length > 1 ? money(tgt, best.netPerAmount - c.sorted[c.sorted.length - 1].netPerAmount, 0) : "—") + '</div><div class="s">' + m.available.length + " routes priced</div></div>" +
      '<div class="kpi"><div class="k">Best all-in cost</div><div class="v">' + (best ? FX.fmtBps(best.costBps) : "—") + '</div><div class="s">' + (best ? money(tgt, best.totalCost, 0) + " vs mid" : "") + "</div></div>";
    $("ovBars").innerHTML = barsHtml(m, true);
    // Sources agreement
    var cs = m.cons;
    if (state.mode === "example") $("ovSources").innerHTML = '<p class="hint">The sheet example uses a fixed mid of ' + FX.fmtRate(m.midInfo.mid) + ". Switch to Today's rates to compare live sources.</p>";
    else {
      var rows = cs.rows.slice().sort(function (a, b) { return a.rate - b.rate; });
      var lo = rows.length ? Math.min.apply(null, rows.map(function (r) { return r.dev; })) : 0, hi = rows.length ? Math.max.apply(null, rows.map(function (r) { return r.dev; })) : 0;
      var lim = Math.max(5, Math.abs(lo), Math.abs(hi));
      $("ovSources").innerHTML = (rows.length ? rows.map(function (r) {
        var pos = 50 + (isFinite(r.dev) ? r.dev / lim * 45 : 0);
        return '<div class="srow">' +
          '<span class="s-lbl">' + esc(srcLabel(r.src)) + '</span><span class="s-track"><span style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:var(--faint)"></span><span style="position:absolute;top:2px;width:10px;height:10px;border-radius:50%;left:calc(' + pos.toFixed(1) + '% - 5px);background:' + (r.used ? "var(--brand)" : "var(--bad-dot)") + '"></span></span>' +
          '<span class="num s-val">' + (isFinite(r.dev) ? FX.fmtSigned(r.dev, 1) + " bps" : "—") + (r.used ? "" : r.rejected ? ' <span class="tag bad">outlier</span>' : ' <span class="tag warn">stale</span>') + "</span></div>";
      }).join("") : '<p class="hint">No source rates yet.</p>') +
        '<p class="hint" style="margin-bottom:0">Distance from the consensus mid (centre line). ' + cs.used + " of " + FX.SOURCES.length + " sources used" + (isFinite(cs.disp) ? ", widest " + cs.disp.toFixed(1) + " bps" : "") + ".</p>";
    }
    // Timing
    $("ovPairLbl").textContent = src + "/" + tgt + ", last 6 months";
    if (state.mode === "example") { $("ovTiming").innerHTML = '<p class="hint">History is shown with Today\'s rates.</p>'; }
    else {
      var h = getHist(src, tgt, 182);
      if (!h || h.loading) $("ovTiming").innerHTML = '<p class="hint">Loading 6-month history…</p>';
      else if (h.err) $("ovTiming").innerHTML = '<p class="hint">History unavailable (' + esc(h.err) + "). It retries automatically.</p>";
      else {
        var st = FX.histStats(h.rows), now = m.midInfo.mid;
        var below = h.rows.filter(function (r) { return r.rate < now; }).length / h.rows.length * 100;
        var avg = h.rows.reduce(function (a, r) { return a + r.rate; }, 0) / h.rows.length;
        var word = below >= 75 ? "a strong day" : below >= 50 ? "better than average" : below >= 25 ? "below average" : "a weak day";
        $("ovTiming").innerHTML = '<p style="margin:0">Today is <b>' + word + "</b> to convert " + src + " into " + tgt + ": the mid is higher than on <b>" + below.toFixed(0) + "%</b> of days in the last 6 months.</p>" +
          '<div class="gauge" aria-hidden="true"><i style="left:' + Math.max(0, Math.min(100, below)).toFixed(1) + '%"></i></div>' +
          '<div class="keys" style="justify-content:space-between"><span>6M low ' + FX.fmtRate(st.lo) + "</span><span>avg " + FX.fmtRate(avg) + "</span><span>high " + FX.fmtRate(st.hi) + "</span></div>" +
          sparkSvg(h.rows) +
          '<p class="hint" style="margin-bottom:0">Realised volatility ' + st.annVolPct.toFixed(1) + "% a year (your risk setting: " + (+cfg().risk.annualVolPct) + "%). Past rates do not predict future rates.</p>";
      }
    }
    renderCards(m, "cards");
  }
  function renderVerdict(m) {
    var v = $("verdict");
    if (!m.ok) { v.className = "verdict bad"; v.innerHTML = '<div class="eyebrow">Check the scenario</div><div class="headline">' + esc(m.msg) + "</div>"; return; }
    var c = m.cmp, best = c.best, tgt = m.tgt, src = m.src;
    if (!best) {
      v.className = "verdict bad";
      v.innerHTML = '<div class="eyebrow">No result</div><div class="headline">No route could be priced for ' + src + " to " + tgt + '.</div><p>Enable at least one provider on <a href="fx-inputs.html#providers">Rates &amp; assumptions</a>, or fix typed quotes that failed the sanity check.</p>';
      return;
    }
    v.className = "verdict";
    var p = "They receive <b>" + money(tgt, best.net) + "</b> for " + money(src, best.sourceSpent) + " paid";
    if (c.runner) p += ", <b>" + money(tgt, c.edgeVsRunner) + "</b> (" + FX.fmtBps(c.edgeVsRunnerBps) + ") more than the next best, " + esc(c.runner.route.short);
    var html = '<div class="eyebrow">Recommended route</div><div class="headline"><span class="fam fam-' + best.route.family + '" style="vertical-align:middle;margin-right:6px">' + best.route.family + "</span>" + esc(best.route.title) + "</div><p>" + p + ".</p>";
    var cautions = [];
    if (c.withinNoise) cautions.push("Close call: a normal one-day market move (about " + money(tgt, c.band, 0) + ") is larger than this advantage.");
    else if (c.lossProb != null && c.lossProb >= 0.05) cautions.push("About " + (c.lossProb * 100).toFixed(1) + "% chance that market moves in transit erase this advantage.");
    if (best.route.legs.some(function (L) { return L.t === "convert" && L.how === "markup"; })) cautions.push("Uses an estimated margin, not a confirmed quote. Get a firm rate, then check it on Your quote.");
    if (m.midInfo.how !== "live" && state.mode === "live") cautions.push("The mid is from " + midHow(m.midInfo) + ", so amounts are less reliable.");
    cautions.forEach(function (t) { html += '<div class="caution">' + esc(t) + "</div>"; });
    html += '<div class="controls" style="margin-top:6px"><a class="btn small" href="#/compare">See all routes</a><a class="btn small" href="#/quote">Check a real quote</a></div>';
    v.innerHTML = html;
  }
  function renderCards(m, id) {
    var el = $(id), now = m.now, prev = {};
    el.querySelectorAll("[data-mid]").forEach(function (x) { prev[x.getAttribute("data-mid")] = x.textContent; });
    el.innerHTML = PAIRS.map(function (p) {
      var k = p.b + "/" + p.q, u = p.unit || 1, mid = FX.makeMid(perUsd(), cfg(), now).info(p.b, p.q), c = FX.consensus(perUsd(), p.b, p.q, now, true);
      var h = state.mode === "live" ? getHist(p.b, p.q, 30) : null, chgTxt = state.mode === "live" ? "loading…" : "example";
      if (h && h.rows) {
        var today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        var ref = h.rows.filter(function (r) { return r.date.getTime() < today; }).pop();
        if (ref && isFinite(mid.mid)) { var ch = FX.bps(mid.mid, ref.rate); chgTxt = '<span class="' + (ch > 0 ? "up" : ch < 0 ? "down" : "") + '">' + (ch > 0 ? "▲ " : ch < 0 ? "▼ " : "") + Math.abs(ch).toFixed(1) + " bps</span> vs " + FX.dayMonUTC(ref.date); }
        else chgTxt = "—";
      } else if (h && h.err) chgTxt = "no history";
      var pressed = (m.src === p.b && m.tgt === p.q) || (m.src === p.q && m.tgt === p.b);
      return '<button type="button" class="card" data-pair="' + k + '" aria-pressed="' + pressed + '"><div class="pair"><b>' + p.b + " / " + p.q + '</b><span class="unit">' + p.q + " per " + u + " " + p.b + '</span></div><div class="mid" data-mid="' + k + '">' + (isFinite(mid.mid) ? FX.fmtRate(mid.mid * u) : "—") +
        '</div><div class="meta"><span>' + chgTxt + "</span><span>" + (state.mode === "example" ? "fixed" : c.used + "/" + FX.SOURCES.length + " src") + "</span></div>" + sparkSvg(h && h.rows) + "</button>";
    }).join("");
    el.querySelectorAll("[data-mid]").forEach(function (x) { var k = x.getAttribute("data-mid"); if (prev[k] && prev[k] !== "—" && prev[k] !== x.textContent) x.classList.add("flash"); });
  }

  /* ---------- 1. Bank rates ---------- */
  function renderRates(m) {
    if (!m.ok) { $("provBody").innerHTML = '<tr><td colspan="7">' + esc(m.msg) + "</td></tr>"; $("ladder").innerHTML = ""; return; }
    var best = m.provs.filter(function (x) { return x.pr.ok; })[0];
    $("provBody").innerHTML = m.provs.map(function (x, i) {
      var where = x.p.country === "ANY" ? "Platform" : x.p.country === "ORIGIN" ? "Dealer desk (sending bank)" : FX.COUNTRY_NAME[x.p.country];
      var isBest = best && x === best;
      return '<tr class="' + (isBest ? "bestrow" : x.pr.ok ? "" : "dim") + '"><td>' + (x.pr.ok ? i + 1 : "—") + '</td><td><div class="src-name">' + esc(x.p.name) + '</div><div class="src-sub">' + esc(where) + " · " + esc(FX.KIND_LABEL[x.p.kind] || x.p.kind) + "</div></td>" +
        '<td class="num">' + FX.fmtRate(x.pr.rate) + '</td><td class="num">' + (isFinite(x.pr.markupBps) ? x.pr.markupBps.toFixed(1) + " bps" : "—") + '</td><td class="num">' + (isFinite(x.recv) ? money(m.tgt, x.recv, 0) : "—") +
        '</td><td class="num">' + (isBest ? '<span class="tag good">Best</span>' : isFinite(x.recv) && best ? FX.fmtSigned(x.recv - best.recv, 0) : "—") + "</td><td>" +
        (x.pr.ok ? (x.pr.how === "quote" ? '<span class="tag">your quote</span>' : '<span class="tag plain">mid − margin</span>') : '<span class="tag bad" title="' + esc(x.pr.msg) + '">rejected</span>') + "</td></tr>";
    }).join("") || '<tr><td colspan="7">No enabled provider for this pair. <a href="fx-inputs.html#providers">Add one</a>.</td></tr>';
    var ok = m.provs.filter(function (x) { return x.pr.ok; }), mx = Math.max.apply(null, ok.map(function (x) { return Math.abs(x.pr.markupBps); }).concat([1]));
    $("ladder").innerHTML = ok.slice().sort(function (a, b) { return a.pr.markupBps - b.pr.markupBps; }).map(function (x) {
      return '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr) 72px;gap:10px;align-items:center;margin:5px 0;font-size:.86rem"><span>' + esc(x.p.name) +
        '</span><span style="height:12px;border-radius:6px;background:var(--card-2);overflow:hidden"><span style="display:block;height:100%;width:' + Math.max(2, Math.abs(x.pr.markupBps) / mx * 100).toFixed(1) + '%;background:' + (x.pr.markupBps < 15 ? "var(--accent)" : x.pr.markupBps < 50 ? "var(--brand)" : "var(--warn-dot)") + '"></span></span><span class="num" style="text-align:right">' + x.pr.markupBps.toFixed(1) + " bps</span></div>";
    }).join("") || '<p class="hint">Nothing to show.</p>';
  }

  /* ---------- 2. Compare ---------- */
  function flowHtml(r, m, interactive) {
    var f = r.route.family, legs = r.route.legs, sc = m.C.scenario;
    var oName = FX.COUNTRY_NAME[FX.COUNTRY_OF[m.src]] || m.src;
    var body = "";
    if (legs.length) {
      var startWhere = f === "C" ? (FX.COUNTRY_NAME[FX.COUNTRY_OF[m.tgt]] || m.tgt) : f === "P" ? "Your account" : oName;
      body += '<span class="node"><span class="cc">' + esc(m.src) + "</span><small>" + esc(startWhere) + "</small></span>";
      legs.forEach(function (L) {
        body += '<span class="flow-arrow" aria-hidden="true">→</span>';
        if (L.t === "transfer") body += '<span class="node"><span class="cc">' + esc(L.ccy) + "</span><small>TT · " + esc(L.code) + " · " + L.days + "d</small></span>";
        else body += '<span class="node"><span class="cc t">' + esc(L.to) + "</span><small>Convert at " + esc(L.provider) + "</small></span>";
      });
    }
    var res = r.ok ? "Net <b>" + money(m.tgt, r.net, 0) + "</b> · rank " + r.rank + (m.cmp.best === r ? ' <span class="tag good">Best</span>' : "") : esc(r.err || "Not available");
    var tagName = interactive && r.ok ? "button" : "div";
    return "<" + tagName + (tagName === "button" ? ' type="button" data-sel="' + esc(r.route.id) + '" aria-pressed="' + (r.route.id === state.selected) + '"' : "") + ' class="flow bg-' + f + (r.ok ? "" : " na") + '">' +
      '<div class="flow-h"><span class="fam fam-' + f + '">' + f + "</span><span>" + esc(r.route.title) + "</span></div>" +
      (body ? '<div class="flow-body">' + body + "</div>" : "") + '<div class="flow-res">' + res + "</div></" + tagName + ">";
  }
  function legsHtml(r, amount) {
    var L0 = r.route.legs[0], src = L0 ? (L0.t === "convert" ? L0.from : L0.ccy) : "";
    var h = ['<span class="leg ccy">' + esc(src) + " " + FX.fmtMoney(amount, 0) + "</span>"];
    r.route.legs.forEach(function (L) {
      h.push('<span class="arrow" aria-hidden="true">→</span>');
      if (L.t === "convert") h.push('<span class="leg">Convert at ' + esc(L.provider) + " · " + FX.fmtRate(L.rate) + '</span><span class="arrow" aria-hidden="true">→</span><span class="leg ccy">' + esc(L.to) + "</span>");
      else h.push('<span class="leg tt">TT ' + esc(L.ccy) + " · " + esc(L.code) + " · " + L.days + " day" + (L.days === 1 ? "" : "s") + "</span>");
    });
    return h.join(" ");
  }
  function heroHtml(r, m, c) {
    var isBest = r === c.best, tgt = m.tgt;
    var notes = (r.route.notes || []).map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("");
    return '<article class="route hero' + (isBest ? " best" : "") + '" data-id="' + esc(r.route.id) + '">' +
      '<div class="h-top"><span class="r-rank">' + r.rank + '</span><span class="fam fam-' + r.route.family + '">' + r.route.family + "</span><h3>" + esc(r.route.title) + "</h3>" +
      (isBest ? '<span class="tag good">Best option</span>' : '<span class="tag warn">' + FX.fmtSigned(r.edgeVsBest, 0) + " " + tgt + " vs best</span>") + "</div>" +
      '<div class="legs">' + legsHtml(r, m.amount) + "</div>" +
      '<div class="h-net"><span>They receive</span><b>' + money(tgt, r.net) + "</b></div>" +
      '<div class="r-metrics"><div><div class="k">Effective rate</div><div class="v">' + FX.fmtRate(r.effRate) + '</div></div><div><div class="k">Cost vs mid</div><div class="v">' + FX.fmtBps(r.costBps) +
      '</div></div><div><div class="k">Arrives in</div><div class="v">' + (r.totalDays ? r.totalDays + " business day" + (r.totalDays === 1 ? "" : "s") : "same day") + "</div></div></div>" +
      (isBest ? "" : '<p class="h-vs">Best: ' + esc(c.best.route.short) + " · " + money(tgt, c.best.net, 0) + "</p>") +
      (notes ? '<details><summary class="hint">Notes</summary><ul class="r-notes">' + notes + "</ul></details>" : "") + "</article>";
  }
  function renderCompare(m) {
    if (!m.ok) { ["flows", "routeList", "naList", "bdBody", "codeBody"].forEach(function (id) { $(id).innerHTML = ""; }); $("naTitle").hidden = true; return; }
    var c = m.cmp, tgt = m.tgt;
    var heroR = c.sorted.filter(function (r) { return r.route.id === state.selected; })[0] || c.best;
    state.selected = heroR.route.id;
    var spread = Math.max(1e-9, c.best.net - c.sorted[c.sorted.length - 1].net);
    $("routeList").innerHTML = heroHtml(heroR, m, c);
    $("flows").innerHTML = c.sorted.filter(function (r) { return r !== heroR; }).map(function (r) {
      var isBest = r === c.best, gap = Math.min(1, Math.max(0, (c.best.net - r.net) / spread));
      var who = r.route.legs.filter(function (L) { return L.t === "convert"; }).map(function (L) { return esc(L.provider); }).join(" + ") || "Direct";
      return '<button type="button" class="tile' + (isBest ? " is-best" : "") + '" data-sel="' + esc(r.route.id) + '" style="--gap:' + gap.toFixed(2) + '"><span class="t-rank">' + r.rank + '</span><span class="t-title">' + esc(r.route.short || r.route.title) +
        '</span><span class="t-delta">' + (isBest ? "Best" : FX.fmtSigned(r.edgeVsBest, 0)) + '</span><span class="t-bar"><i></i></span><span class="t-who">' + who + "</span></button>";
    }).join("");
    $("naTitle").hidden = !m.unavailable.length;
    $("naList").innerHTML = m.unavailable.map(function (r) {
      return '<article class="route na"><div class="r-head"><span class="r-title"><span class="fam fam-' + r.route.family + '">' + r.route.family + "</span>" + esc(r.route.title) + '</span><span class="tag warn">Not available</span></div><p class="hint" style="margin:6px 0 0">' + esc(r.err) + "</p></article>";
    }).join("");
    renderBreakdown(m);
  }
  function renderBreakdown(m) {
    var C = m.C, r = m.available.filter(function (x) { return x.route.id === state.selected; })[0];
    $("codeHelp").textContent = CODE_HELP[C.fees.code];
    if (!r) { $("bdRoute").textContent = ""; $("bdBody").innerHTML = "<tr><td>No route selected.</td></tr>"; $("codeBody").innerHTML = ""; $("bicList").textContent = ""; $("split").innerHTML = ""; $("splitText").textContent = ""; return; }
    var src = m.src, tgt = m.tgt, mid = m.mid, rows = [];
    $("bdRoute").textContent = r.route.short;
    function row(k, v, cls) { rows.push('<tr class="' + (cls || "") + '"><td>' + k + '</td><td class="num">' + v + "</td></tr>"); }
    row("Amount you send", money(src, m.amount));
    r.feeLines.filter(function (f) { return f.how === "on top"; }).forEach(function (f) { row("+ " + esc(f.label) + " (on top)", money(src, f.src), "sub"); });
    row("Total you pay", money(src, r.sourceSpent), "total");
    r.feeLines.filter(function (f) { return f.how === "deducted"; }).forEach(function (f) { row("− " + esc(f.label) + " (deducted)", money(src, f.src), "sub"); });
    r.route.legs.filter(function (L) { return L.t === "convert"; }).forEach(function (L) {
      row("Rate: " + esc(L.provider) + " (" + (L.how === "quote" ? "your quote" : "mid − " + (+L.markupBps).toFixed(2) + " bps") + ")", "1 " + L.from + " = " + FX.fmtRate(L.rate) + " " + L.to + '<div class="src-sub">mid ' + FX.fmtRate(mid(L.from, L.to)) + "</div>");
    });
    row("FX margin cost", money(tgt, r.fxMargin));
    row("Fees cost (at mid)", money(tgt, r.fees));
    row("Total cost vs mid", money(tgt, r.totalCost) + '<div class="src-sub">' + FX.fmtBps(r.costBps) + "</div>", "total");
    row("They receive", money(tgt, r.net), "net");
    row("Effective rate", FX.fmtRate(r.effRate) + " " + tgt + " per " + src);
    row("Unconverted in transit", r.exposureDays ? r.exposureDays + " day(s) · 1-sigma move ≈ " + money(tgt, r.band, 0) : "None (converts before sending)");
    $("bdBody").innerHTML = rows.join("");
    var tot = Math.max(r.totalCost, 1e-9), mPct = Math.max(0, Math.min(100, r.fxMargin / tot * 100));
    $("split").innerHTML = '<span class="m" style="width:' + mPct.toFixed(1) + '%"></span><span class="f" style="width:' + (100 - mPct).toFixed(1) + '%"></span>';
    $("splitText").textContent = "FX margin " + mPct.toFixed(0) + "% · Fees " + (100 - mPct).toFixed(0) + "%";
    var hasTT = r.route.legs.some(function (L) { return L.t === "transfer"; });
    $("codeBody").innerHTML = !hasTT ? '<tr><td colspan="4">No SWIFT transfer on this route, so the charge code does not apply.</td></tr>' : ["OUR", "SHA", "BEN"].map(function (code) {
      var s2 = FX.clone(C); s2.fees.code = code;
      var rt = FX.buildRoutes(s2, mid).filter(function (x) { return x.id === r.route.id; })[0], e = rt && FX.evaluate(rt, m.amount, src, tgt, mid);
      if (!e || !e.ok) return "";
      return '<tr class="' + (code === C.fees.code ? "bestrow" : "") + '"><td><b>' + code + '</b></td><td class="num">' + money(src, e.sourceSpent) + '</td><td class="num">' + money(tgt, e.net) + '</td><td class="num">' + money(tgt, e.totalCost, 0) + "</td></tr>";
    }).join("");
    var seen = {};
    $("bicList").innerHTML = (r.route.legs.filter(function (L) { return L.t === "convert"; }).map(function (L) {
      var p = C.providers.filter(function (x) { return x.name === L.provider; })[0];
      if (!p || seen[p.id]) return ""; seen[p.id] = 1;
      return "<div><b>" + esc(p.name) + ":</b> " + (p.bic ? '<span class="tag">' + esc(p.bic) + "</span> verify with the bank" : 'not set. <a href="fx-inputs.html#providers">Add it</a>') + "</div>";
    }).join("") || "No bank on this route.") + "<p>You also need the beneficiary bank's BIC and account details.</p>";
  }

  /* ---------- 3. Your quote ---------- */
  var qUndo = null;
  function fillQuoteForm(m) {
    if (!m.ok) return;
    var sel = $("qProv"), cur = sel.value;
    sel.innerHTML = m.provs.map(function (x) { return '<option value="' + esc(x.p.id) + '">' + esc(x.p.name) + "</option>"; }).join("") + '<option value="">Other (not saved)</option>';
    if (sel.getAttribute("data-filled") && [].some.call(sel.options, function (o) { return o.value === cur; })) sel.value = cur;
    sel.setAttribute("data-filled", "1");
    var b = $("qBasis"), bc = b.value, u = $("qUnit").value;
    b.innerHTML = '<option value="direct">' + m.tgt + " per " + u + " " + m.src + '</option><option value="inverse">' + m.src + " per " + u + " " + m.tgt + "</option>";
    if (bc) b.value = bc;
  }
  function quoteCalc(m) {
    var raw = String($("qVal").value).replace(/[,\s]/g, ""), feeRaw = String($("qFee").value).replace(/[,\s]/g, "") || "0";
    if (raw === "") return { empty: true };
    if (!/^\d*\.?\d+$/.test(raw) || !(+raw > 0)) return { err: "Type the rate as a number, for example 25.65." };
    if (!/^\d*\.?\d+$/.test(feeRaw)) return { err: "Fee must be a number (0 if none)." };
    var p = { quoteBasis: $("qBasis").value, quoteUnit: +$("qUnit").value, quoteValue: +raw };
    var rate = FX.quoteToRate(p), mid = m.midInfo.mid, mk = (mid - rate) / mid * 10000, fee = +feeRaw;
    var recv = (m.amount - fee) * rate;
    return { rate: rate, mk: mk, fee: fee, recv: recv, mid: mid, sane: FX.sanity(mk), p: p };
  }
  function renderQuote(m) {
    fillQuoteForm(m);
    var out = $("qResult");
    if (!m.ok) { out.innerHTML = '<p class="hint">' + esc(m.msg) + "</p>"; return; }
    var q = quoteCalc(m);
    $("qErr").textContent = q.err || "";
    $("qVal").setAttribute("aria-invalid", String(!!q.err));
    $("qSave").disabled = !!(q.empty || q.err || !q.sane || !$("qProv").value);
    if (q.empty || q.err) { out.innerHTML = '<p class="hint">Mid now: 1 ' + m.src + " = " + FX.fmtRate(m.midInfo.mid) + " " + m.tgt + ". Enter a quote to see its margin.</p>"; return; }
    if (!q.sane) {
      var inv = q.p.quoteBasis === "direct" ? "inverse" : "direct", alt = FX.quoteToRate({ quoteBasis: inv, quoteUnit: q.p.quoteUnit, quoteValue: q.p.quoteValue });
      var altMk = (q.mid - alt) / q.mid * 10000, hint = FX.sanity(altMk) ? "It looks like the quote is the other way round. Switch \"Quoted as\" to " + (inv === "direct" ? m.tgt + " per " + m.src : m.src + " per " + m.tgt) + "." : "Check the unit (per 1 or per 100) and the direction.";
      out.innerHTML = '<span class="grade g4">Check the quote</span><p>This is ' + q.mk.toFixed(1) + " bps from the mid of " + FX.fmtRate(q.mid) + ", outside the sanity band.</p><p>" + esc(hint) + "</p>";
      return;
    }
    var g = q.mk < 15 ? ["g1", "Sharp"] : q.mk < 50 ? ["g2", "Fair"] : q.mk < 150 ? ["g3", "High"] : ["g4", "Very high"];
    var ok = m.provs.filter(function (x) { return x.pr.ok && x.p.id !== $("qProv").value; });
    var better = ok.filter(function (x) { return x.recv > q.recv; }), bestOther = ok[0];
    var costMid = m.amount * q.mid - q.recv;
    out.innerHTML = '<div><span class="grade ' + g[0] + '">' + g[1] + "</span></div>" +
      '<div class="big">' + q.mk.toFixed(1) + ' bps <span class="hint" style="font-size:.9rem;font-weight:400">margin vs mid</span></div>' +
      "<p style=\"margin:0\">Normalised: 1 " + m.src + " = <b>" + FX.fmtRate(q.rate) + "</b> " + m.tgt + " (mid " + FX.fmtRate(q.mid) + ", " + esc(midHow(m.midInfo)) + ").</p>" +
      '<div class="statrow" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div><div class="k">You receive</div><div class="v">' + money(m.tgt, q.recv, 0) + '</div></div><div><div class="k">Hidden cost vs mid</div><div class="v">' + money(m.tgt, costMid, 0) + "</div></div></div>" +
      "<p style=\"margin:4px 0 0\">" + (better.length ? better.length + " other provider" + (better.length > 1 ? "s" : "") + " in this tool would pay more, best " + esc(bestOther.p.name) + " by about " + money(m.tgt, bestOther.recv - q.recv, 0) + " (estimate)." : "No other provider in this tool beats this quote.") + "</p>" +
      '<p class="hint" style="margin:0">Excludes SWIFT fees; the Compare page includes them once you save the quote.</p>';
  }

  /* ---------- 4. Checklist ---------- */
  function buildChecks(m) {
    var L = [], C = m.C;
    function add(level, title, text) { L.push({ level: level, title: title, text: text }); }
    if (!m.ok || !m.cmp.best) return L;
    var c = m.cmp, best = c.best, now = m.now, src = m.src, tgt = m.tgt;
    if (state.mode === "example") add("info", "Sheet example", "Numbers use the fixed worked example, not today's market.");
    else if (m.midInfo.how === "fallback") add("bad", "Using illustrative fallback rates", "No source rates are available. Check Sources & health, or edit the fallback mids.");
    else if (m.midInfo.how === "stale") add("warn", "Market rates are old", "Sources are more than 2 business days old. Amounts are indicative only.");
    var usd = m.amount * m.mid(src, "USD");
    if (usd >= (+C.risk.rfqThresholdUsd || Infinity) && best.route.legs.some(function (x) { return x.t === "convert" && x.kind === "board"; })) add("info", "Dealer quote (RFQ) threshold reached", "About USD " + FX.fmtMoney(usd, 0) + " is above your RFQ threshold.");
    if (c.withinNoise) add("warn", "The winning margin is within market noise", "A one-day move of about " + tgt + " " + FX.fmtMoney(c.band, 0) + " could change the ranking.");
    if (best.exposureDays) add("info", "Money is unconverted in transit", best.exposureDays + " business day(s) exposed to " + src + "/" + tgt + " moves.");
    if (C.fees.code !== "OUR" && best.route.legs.some(function (x) { return x.t === "transfer"; })) add("warn", "Supplier invoice", "With " + C.fees.code + ", the beneficiary receives the invoice less charges. OUR delivers the full amount.");
    var day = now.getDay(), hm = FX.hhmm(now), cutoff = String(C.risk.cutoff || "15:00");
    if (day === 0 || day === 6) add("warn", "Weekend", "Transfers start on the next business day. The rate may change by then.");
    else if (hm > cutoff) add("warn", "Past the " + cutoff + " cut-off", "Instructions now are usually value-dated the next business day" + (day === 5 ? " (Monday)" : "") + ".");
    else add("good", "Before the " + cutoff + " cut-off", "Instructions sent now can usually go out today. Cut-offs vary by bank and currency.");
    add("info", "Public holidays are not modelled", "A holiday in either country adds at least a day to routes with a transfer.");
    add("info", "Supporting documents", "Purpose of payment and supporting documents are typically requested at this size.");
    (best.route.notes || []).forEach(function (n) { add("info", "About the recommended route", n); });
    m.unavailable.filter(function (r) { return /sanity band/.test(r.err || ""); }).forEach(function (r) { add("bad", "Typed quote rejected: " + r.route.short, r.err); });
    return L;
  }
  function renderChecklist(m) {
    var icon = { info: "i", warn: "!", bad: "×", good: "✓" };
    $("checkList").innerHTML = buildChecks(m).map(function (x) {
      return '<div class="check ' + x.level + '"><span class="ic" aria-hidden="true">' + icon[x.level] + "</span><div><b>" + esc(x.title) + "</b><span>" + esc(x.text) + "</span></div></div>";
    }).join("") || '<p class="hint">' + esc(m.msg || "No checks.") + "</p>";
    var done = loadTodo();
    $("todo").innerHTML = TODO.map(function (t, i) { return '<label><input type="checkbox" data-todo="' + i + '"' + (done[i] ? " checked" : "") + "><span>" + esc(t) + "</span></label>"; }).join("");
    todoProgress();
  }
  function loadTodo() { try { return JSON.parse(localStorage.getItem(TODO_KEY)) || {}; } catch (e) { return {}; } }
  function todoProgress() {
    var d = loadTodo(), n = TODO.filter(function (t, i) { return d[i]; }).length;
    $("todoBar").style.width = (n / TODO.length * 100) + "%";
    $("todoTxt").textContent = n + " of " + TODO.length + " done" + (n === TODO.length ? ". Ready to instruct." : ".");
  }

  /* ---------- Full sheet ---------- */
  function feeInput(k, v, label) { return '<input class="input mini" data-fk="' + k + '" value="' + esc(v) + '" inputmode="decimal" aria-label="' + esc(label) + '">'; }
  function renderSheet(m) {
    var C = m.C, live = state.mode === "live";
    $("sheetSub").textContent = live ? "Live mids as of " + (state.lastGood ? FX.dayMon(state.lastGood) + ", " + FX.hhmm(state.lastGood) : "the last saved check") + ". Provider rates are estimates unless typed." : "(Illustrative example only)";
    if (!m.ok) { $("sheetObj").textContent = m.msg; return; }
    $("sheetObj").textContent = "Compare the total cost (rate + fees) of converting " + money(m.src, m.amount, 0) + " to " + m.tgt + " under different routes, to find the most cost-effective option.";
    $("sheetFlows").innerHTML = m.results.map(function (r) { return flowHtml(r, m, false); }).join("");
    $("sheetMid").innerHTML = midRows(m);
    // Provider rates per route conversion
    var pr = [];
    m.results.forEach(function (r) {
      r.route.legs.filter(function (L) { return L.t === "convert"; }).forEach(function (L) {
        pr.push('<tr class="' + (r.ok ? "" : "dim") + '"><td><span class="fam fam-' + r.route.family + '">' + r.route.family + '</span></td><td>' + esc(L.provider) + " <span class=\"src-sub\">" + L.from + "→" + L.to + '</span></td><td class="num">' + FX.fmtRate(L.rate) + '</td><td class="num">' + (isFinite(L.markupBps) ? (+L.markupBps).toFixed(2) + " bps" : "—") + "</td><td>" + (L.how === "quote" ? '<span class="tag">typed quote</span>' : '<span class="tag plain">mid − margin</span>') + "</td></tr>");
      });
    });
    $("sheetRates").innerHTML = pr.join("") || '<tr><td colspan="5">No conversions.</td></tr>';
    // Fees table
    var F = C.fees, rows = [];
    m.results.forEach(function (r) {
      if (!r.route.legs.length) return;
      var items = [], step = 0;
      r.route.legs.forEach(function (L) {
        if (L.t === "transfer") {
          items.push([++step, "Sender TT fee", feeInput("sender", F.sender, "Sender TT fee"), m.src, (F.code === "BEN" ? "Deducted (BEN)" : "Paid on top") + ". " + L.where + ", " + L.days + " day(s)."]);
          items.push([++step, "Intermediary / agent bank fee", feeInput("inter", F.inter, "Intermediary fee"), m.src, (F.code === "OUR" ? "Paid on top (OUR)" : "Deducted on the way") + ". May vary."]);
          if (r.route.family === "D") items.push([++step, "USD correspondent fee", feeInput("usdCorrFeeUsd", F.usdCorrFeeUsd, "USD correspondent fee"), "USD", "Via-USD routes only. Illustrative."]);
          items.push([++step, "Receiving bank landing fee", feeInput("landing", F.landing, "Landing fee"), m.src, "Deducted on arrival"]);
        } else {
          items.push([++step, "FX conversion spread (" + L.provider + ")", "Included in rate", "—", "Margin " + (isFinite(L.markupBps) ? (+L.markupBps).toFixed(2) + " bps" : "n/a") + " vs mid, rate " + FX.fmtRate(L.rate)]);
          if (+L.feePct || +L.feeFixed) items.push([++step, L.provider + " fee", (+L.feePct ? L.feePct + "%" : "") + (+L.feePct && +L.feeFixed ? " + " : "") + (+L.feeFixed ? FX.fmtMoney(+L.feeFixed) : ""), m.src, "From provider settings"]);
        }
      });
      items.forEach(function (it, i) {
        rows.push('<tr class="bg-' + r.route.family + (i === 0 ? " grp-start" : "") + '">' + (i === 0 ? '<td class="scn-cell" rowspan="' + items.length + '"><span class="fam fam-' + r.route.family + '">' + r.route.family + "</span>" + esc(r.route.short) + "</td>" : "") +
          "<td>" + it[0] + "</td><td>" + esc(it[1]) + '</td><td class="num">' + (String(it[2]).indexOf("<input") === 0 ? it[2] : esc(it[2])) + "</td><td>" + esc(it[3]) + '</td><td class="hint">' + esc(it[4]) + "</td></tr>");
      });
    });
    $("sheetFees").innerHTML = rows.join("");
    $("shCode").value = F.code;
    if (document.activeElement !== $("shDays")) $("shDays").value = F.ttDays;
    $("shCodeHelp").textContent = CODE_HELP[F.code] + " Days in transit applies to every TT leg; the rate can move while money is unconverted.";
    $("sheetBars").innerHTML = barsHtml(m, false);
    var c = m.cmp;
    $("sheetSummary").innerHTML = c.best ? '<p style="margin:0"><b>Result:</b> ' + esc(c.best.route.title) + " gives " + money(m.tgt, c.best.net, 0) + (c.runner ? ", " + money(m.tgt, c.edgeVsRunner, 0) + " (" + FX.fmtBps(c.edgeVsRunnerBps) + ") ahead of " + esc(c.runner.route.short) : "") + ".</p>" + (c.withinNoise ? '<p class="hint">Close call: within one day of normal market movement.</p>' : "") : "";
    $("sheetRes").innerHTML = c.sorted.map(function (r) {
      return '<tr class="' + (r === c.best ? "bestrow" : "") + '"><td>' + r.rank + '</td><td><span class="fam fam-' + r.route.family + '">' + r.route.family + "</span> " + esc(r.route.short) + '</td><td class="num">' + money(m.src, r.sourceSpent) + '</td><td class="num">' + money(m.tgt, r.net) + '</td><td class="num">' + FX.fmtRate(r.effRate) + '</td><td class="num">' + FX.fmtBps(r.costBps) + '</td><td class="num">' + (r === c.best ? "—" : FX.fmtSigned(r.edgeVsBest, 0)) + '</td><td class="num">' + (r.totalDays || 0) + "</td></tr>";
    }).join("");
  }
  function exportCsv() {
    var m = state.model; if (!m || !m.ok) return;
    var q = function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [["FX Comparison", m.src + "->" + m.tgt, "amount", m.amount, "mid", m.midInfo.mid, "mid basis", midHow(m.midInfo), "generated", new Date().toISOString()].map(q).join(","), "",
      ["rank", "route", "you_pay_" + m.src, "they_receive_" + m.tgt, "effective_rate", "cost_bps", "vs_best_" + m.tgt, "days"].join(",")];
    m.cmp.sorted.forEach(function (r) { lines.push([r.rank, r.route.title, r.sourceSpent.toFixed(2), r.net.toFixed(2), r.effRate.toFixed(6), r.costBps.toFixed(2), r.edgeVsBest.toFixed(2), r.totalDays].map(q).join(",")); });
    m.unavailable.forEach(function (r) { lines.push(["", r.route.title, "", "", "", "", "", "not available: " + r.err].map(q).join(",")); });
    var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "fx-comparison-" + m.src + m.tgt + "-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast("CSV downloaded.");
  }

  /* ---------- Sources ---------- */
  function midRows(m) {
    if (state.mode === "example") return '<tr><td colspan="5">Sheet example: fixed mid ' + FX.fmtRate(m.midInfo.mid) + " " + m.tgt + " per " + m.src + " (from the fallback rates).</td></tr>";
    var c = m.cons;
    var rows = c.rows.map(function (r) {
      var s = FX.SOURCES.filter(function (x) { return x.id === r.src; })[0];
      var st = r.used ? '<span class="tag good">used</span>' : r.rejected ? '<span class="tag bad">outlier</span>' : '<span class="tag warn">stale</span>';
      return '<tr class="' + (r.used ? "" : "dim") + '"><td><div class="src-name">' + esc(s.label) + '</div><div class="src-sub">' + esc(FX.TYPE_LABEL[s.type]) + (r.cross ? " · " + r.cross : "") + '</div></td><td class="num">' + FX.fmtRate(r.rate) + '</td><td class="num">' + (isFinite(r.dev) ? FX.fmtSigned(r.dev, 1) + " bps" : "—") + "</td><td>" + fmtAsOf(r.date) + "</td><td>" + st + "</td></tr>";
    });
    rows.push('<tr class="bestrow"><td><div class="src-name">Mid used</div><div class="src-sub">' + esc(midHow(m.midInfo)) + '</div></td><td class="num"><b>' + FX.fmtRate(m.midInfo.mid) + '</b></td><td class="num">' + (isFinite(c.disp) ? "spread " + c.disp.toFixed(1) + " bps" : "") + "</td><td>" + (c.rows.length > 1 ? "gap " + FX.timeGapHours(c.rows).toFixed(1) + " h" : "") + "</td><td></td></tr>");
    return rows.join("");
  }
  function renderSources(m) {
    $("srcPair").textContent = m.ok ? m.src + "/" + m.tgt : "";
    $("midBody").innerHTML = m.ok ? midRows(m) : "";
    $("healthBody").innerHTML = FX.SOURCES.map(function (s) {
      var h = state.health[s.id];
      var st = !h ? '<span class="tag plain">not checked</span>' : h.ok ? (h.partial && h.partial.length ? '<span class="tag warn">up, missing ' + esc(h.partial.join(", ")) + "</span>" : '<span class="tag good">up' + (h.cached ? " · cached" : "") + "</span>") : '<span class="tag bad">down: ' + esc(h.err) + "</span>";
      return '<tr><td><div class="src-name"><a href="' + esc(s.url) + '" rel="noopener" target="_blank">' + esc(s.label) + '</a></div><div class="src-sub">' + esc(s.sub) + "</div></td><td>" + esc(FX.TYPE_LABEL[s.type]) + "</td><td>" + st + '</td><td class="num">' + (h && h.ms != null ? h.ms + " ms" : "—") + "</td><td>" + (h && h.newest ? fmtAsOf(new Date(h.newest)) : "—") + '</td><td class="hint">' + esc(s.cadence) + "</td></tr>";
    }).join("");
  }

  /* ---------- Markets ---------- */
  function renderMarkets(m) {
    renderCards(m, "cards2");
    var UNIT = { JPY: 100, IDR: 100 };
    $("moreBody").innerHTML = FX.EXTRA.map(function (cc) {
      var c = FX.consensus(perUsd(), cc, "MYR", m.now, true), u = UNIT[cc] || 1;
      return "<tr><td><b>" + cc + "</b>" + (u > 1 ? ' <span class="src-sub">per ' + u + "</span>" : "") + '</td><td class="num">' + (isFinite(c.mid) ? FX.fmtRate(c.mid * u) : "—") + '</td><td class="num">' + (isFinite(c.disp) ? c.disp.toFixed(1) + " bps" : "—") + '</td><td class="num">' + c.used + "/" + FX.SOURCES.length + "</td></tr>";
    }).join("");
    document.querySelectorAll("#rangeSeg button").forEach(function (b) { b.setAttribute("aria-pressed", String(+b.getAttribute("data-days") === state.histDays)); });
    if (!m.ok) { $("histChart").innerHTML = ""; return; }
    $("histTitle").textContent = m.src + "/" + m.tgt + " history";
    if (state.mode === "example") { $("histChart").innerHTML = '<p class="hint">History is shown with Today\'s rates.</p>'; $("histStats").innerHTML = ""; return; }
    var h = getHist(m.src, m.tgt, state.histDays);
    if (!h || h.loading) { $("histChart").innerHTML = '<p class="hint">Loading history…</p>'; $("histStats").innerHTML = ""; return; }
    if (h.err) { $("histChart").innerHTML = '<p class="hint">History unavailable: ' + esc(h.err) + ". It retries automatically.</p>"; $("histStats").innerHTML = ""; return; }
    lineChart($("histChart"), h.rows, m.midInfo.mid);
    var st = FX.histStats(h.rows);
    $("histStats").innerHTML = '<div><div class="k">Change over range</div><div class="v ' + (st.chgPct >= 0 ? "up" : "down") + '">' + (st.chgPct >= 0 ? "+" : "") + st.chgPct.toFixed(2) + '%</div></div><div><div class="k">Range low / high</div><div class="v">' + FX.fmtRate(st.lo) + " / " + FX.fmtRate(st.hi) +
      '</div></div><div><div class="k">Latest in range</div><div class="v">' + st.pctile.toFixed(0) + '% of the way up</div></div><div><div class="k">Realised volatility</div><div class="v">' + st.annVolPct.toFixed(1) + "% / yr</div></div>";
  }

  /* ---------- Status, banners ---------- */
  function upCount() { return FX.SOURCES.filter(function (s) { return state.health[s.id] && state.health[s.id].ok; }).length; }
  function nextText() {
    if (state.busy) return "checking now";
    if (state.paused) return "paused";
    if (document.hidden || !state.nextAt) return "resumes when visible";
    var s = Math.max(0, Math.ceil((state.nextAt - Date.now()) / 1000));
    return "next in " + (s >= 60 ? Math.round(s / 60) + " min" : s + " s");
  }
  function renderStatus() {
    var dot = $("statusDot"), txt = $("statusText");
    if (state.mode === "example") { dot.className = "dot"; txt.innerHTML = "<strong>Example</strong> · fixed rates"; return; }
    if (!state.lastCheck) { dot.className = "dot"; txt.innerHTML = "<strong>Checking…</strong>"; return; }
    var up = upCount(), all = FX.SOURCES.length, lvl = up === all ? "live" : up > 0 ? "warn" : "bad";
    var label = state.paused ? "Paused" : lvl === "live" ? "Live" : lvl === "warn" ? "Partial " + up + "/" + all : (state.cachedAt ? "Offline, saved" : "Offline");
    dot.className = "dot" + (state.paused ? "" : " " + lvl);
    dot.title = label; txt.textContent = "Last updated " + FX.hhmm(state.lastCheck);
  }
  function renderBanners(m) {
    var b = $("banner"), up = upCount();
    if (state.mode === "example") { b.className = "banner show info"; b.innerHTML = '<span>Sheet example: fixed mid and quotes from the worked example (SGD 1,000,000, mid 25.80, UOB SG 25.65, Thai bank 25.72). Edits here are not saved.</span><button type="button" class="btn small x" data-mode-switch="live">Back to today\'s rates</button>'; }
    else if (!state.lastCheck) b.className = "banner";
    else if (up === 0) { b.className = "banner show bad"; b.textContent = "No rate source answered. " + (state.cachedAt ? "Using rates saved at " + FX.hhmm(state.cachedAt) + " " + FX.dayMon(state.cachedAt) + ". " : "Using illustrative fallback rates. ") + "Your network may block these sites; see Sources & health."; }
    else if (up < FX.SOURCES.length) { b.className = "banner show warn"; b.textContent = FX.SOURCES.filter(function (s) { return !(state.health[s.id] && state.health[s.id].ok); }).map(function (s) { return s.label; }).join(", ") + " did not answer. The mid uses the remaining sources."; }
    else b.className = "banner";
    var g = $("gapBanner");
    if (state.mode === "live" && m.ok && m.cons && !state.gapDismissed) {
      var used = m.cons.rows.filter(function (r) { return r.used; }), gap = FX.timeGapHours(m.cons.rows);
      if (gap > 36) {
        var o = used.reduce(function (a, r) { return r.date < a.date ? r : a; }), n = used.reduce(function (a, r) { return r.date > a.date ? r : a; });
        g.className = "banner warn show";
        g.innerHTML = "<span>⚠ Rates in the consensus are up to " + gap.toFixed(0) + " h apart (" + esc(srcLabel(o.src)) + " " + fmtAsOf(o.date) + ", " + esc(srcLabel(n.src)) + " " + fmtAsOf(n.date) + "). Mixed times can give a false winner; confirm with a firm quote.</span><button type=\"button\" class=\"btn small x\" id=\"gapX\" aria-label=\"Dismiss\">Dismiss</button>";
        return;
      }
    }
    g.className = "banner warn";
  }

  /* ---------- Render orchestration ---------- */
  function renderView() {
    var m = state.model || computeModel();
    var v = state.view;
    if (v === "overview") renderOverview(m);
    else if (v === "rates") renderRates(m);
    else if (v === "compare") renderCompare(m);
    else if (v === "quote") renderQuote(m);
    else if (v === "checklist") renderChecklist(m);
    else if (v === "sheet") renderSheet(m);
    else if (v === "markets") renderMarkets(m);
    else if (v === "sources") renderSources(m);
    else if (v === "help") renderHelp();
  }
  function renderAll() {
    syncInputs();
    var m = computeModel();
    state.model = m;
    $("amtErr").textContent = m.ok ? "" : m.msg;
    $("midline").innerHTML = m.ok ? "<span>Mid <b>1 " + m.src + " = " + FX.fmtRate(m.midInfo.mid) + " " + m.tgt + "</b></span><span>" + esc(midHow(m.midInfo)) + (m.midInfo.used ? " · " + m.midInfo.used + " sources · spread " + FX.fmtBps(m.midInfo.disp) : "") + "</span>" : "";
    renderStatus(); renderBanners(m); renderView();
  }
  function renderHelp() {
    var r = FX.selfCheck(), pass = r.filter(function (x) { return x.pass; }).length;
    $("scSummary").innerHTML = '<span class="tag ' + (pass === r.length ? "good" : "bad") + '">' + pass + " of " + r.length + " checks passed</span> The engine reproduces the methodology's worked examples. Full table on <a href=\"fx-inputs.html#selfcheck\">Rates &amp; assumptions</a>.";
  }

  /* ---------- Router ---------- */
  function route() {
    var v = (location.hash.replace(/^#\/?/, "") || "overview").split("?")[0];
    if (!VIEWS[v]) v = "overview";
    state.view = v;
    Object.keys(VIEWS).forEach(function (k) { $("v-" + k).hidden = k !== v; });
    $("scnWrap").hidden = v === "help";
    document.querySelectorAll(".nav a[data-view]").forEach(function (a) { if (a.getAttribute("data-view") === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    $("pageTitle").textContent = VIEWS[v];
    document.title = VIEWS[v] + " · FX Comparison";
    closeNav();
    renderAll();
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }

  /* ---------- Refresh cycle ---------- */
  function check(force) {
    if (state.busy) return;
    state.busy = true; clearTimeout(timer);
    $("refreshBtn").disabled = true;
    renderStatus();
    FX.fetchAll(!!force).then(function (res) {
      var now = new Date();
      state.health = res.health; state.lastCheck = now;
      if (Object.keys(res.perUsd).length) {
        Object.keys(res.perUsd).forEach(function (k) { state.perUsd[k] = res.perUsd[k]; });
        state.lastGood = now; state.cachedAt = now;
        FX.saveSnapshot(state.perUsd, state.health, now);
      }
      state.busy = false; $("refreshBtn").disabled = false;
      if (state.mode === "live") renderAll(); else renderStatus();
      var up = upCount();
      $("announce").textContent = (up === FX.SOURCES.length ? "Rates checked, all sources up." : up ? "Rates checked, " + up + " of " + FX.SOURCES.length + " sources up." : "Rate check failed.") + " " + FX.hhmm(now);
      schedule();
    });
  }
  function schedule() {
    clearTimeout(timer);
    if (state.paused || document.hidden) { state.nextAt = null; renderStatus(); return; }
    state.nextAt = Date.now() + REFRESH_MS;
    timer = setTimeout(function () { check(false); }, REFRESH_MS);
    renderStatus();
  }

  /* ---------- Guide (coach marks) ---------- */
  var GUIDE = [
    { sel: "#scnWrap", view: "overview", h: "1. Set your scenario", p: "Amount, from and to. It applies to every page. Press / to jump here." },
    { sel: "#statusPill", h: "2. Is the data live?", p: "Green = all sources answered. Amber = some. It refreshes every minute; Pause stops it." },
    { sel: "#modeSeg", h: "3. Learn with the sheet example", p: "Switch to fixed worked-example numbers. Switch back any time." },
    { sel: "#verdict", view: "overview", h: "4. The answer first", p: "The recommended route, how much more it pays, and any reason to be careful." },
    { sel: '[data-guide="rates"]', h: "5. Bank rates", p: "Every provider ranked for this pair, with its margin over the mid." },
    { sel: '[data-guide="compare"]', h: "6. Compare routes", p: "Rate and fees combined. Select a route to see the fee breakdown and SWIFT codes." },
    { sel: '[data-guide="quote"]', h: "7. Check a real quote", p: "Type the rate your bank gives you. See its hidden margin and save it." },
    { sel: '[data-guide="sheet"]', h: "8. Full sheet", p: "A printable report with editable fees, ready to share or save as PDF." },
    { sel: '[data-guide="settings"]', h: "9. Your assumptions", p: "Providers, margins, fees and risk settings live here. Changes save in this browser." }
  ];
  var gi = -1;
  function guideShow(i) {
    if (i < 0 || i >= GUIDE.length) return guideEnd();
    gi = i;
    var st = GUIDE[i];
    if (st.view && state.view !== st.view) location.hash = "#/" + st.view;
    var el = document.querySelector(st.sel), side = el && el.closest(".side");
    if (side && window.innerWidth <= 960) openNav();
    else if (window.innerWidth <= 960) closeNav();
    setTimeout(function () {
      var g = $("guide"), ring = $("guideRing");
      $("guideH").textContent = st.h; $("guideP").textContent = st.p; $("guideN").textContent = (i + 1) + " / " + GUIDE.length;
      $("guidePrev").disabled = i === 0; $("guideNext").textContent = i === GUIDE.length - 1 ? "Done" : "Next";
      g.hidden = false;
      if (el) el.scrollIntoView({ block: "nearest" });
      var r = el ? el.getBoundingClientRect() : null;
      if (r && r.width) {
        ring.hidden = false; ring.style.left = (r.left - 4) + "px"; ring.style.top = (r.top - 4) + "px"; ring.style.width = (r.width + 8) + "px"; ring.style.height = (r.height + 8) + "px";
        var gw = g.offsetWidth, gh = g.offsetHeight, top = r.bottom + 12, left = Math.min(Math.max(8, r.left), window.innerWidth - gw - 8);
        if (top + gh > window.innerHeight - 8) top = Math.max(8, r.top - gh - 12);
        if (r.right + gw + 16 < window.innerWidth && r.left < 260) { left = r.right + 14; top = Math.min(Math.max(8, r.top), window.innerHeight - gh - 8); }
        g.style.left = left + "px"; g.style.top = top + "px";
      } else { ring.hidden = true; g.style.left = "50%"; g.style.top = "30%"; g.style.transform = "translateX(-50%)"; }
      if (r && r.width) g.style.transform = "";
      $("guideNext").focus();
    }, 60);
  }
  function guideEnd() { gi = -1; $("guide").hidden = true; $("guideRing").hidden = true; try { localStorage.setItem(GUIDED_KEY, "1"); } catch (e) {} closeNav(); }

  /* ---------- Nav, theme ---------- */
  function openNav() { $("fxapp").classList.add("nav-open"); $("menuBtn").setAttribute("aria-expanded", "true"); }
  function closeNav() { $("fxapp").classList.remove("nav-open"); $("menuBtn").setAttribute("aria-expanded", "false"); }
  function applyThemeLabel() {
    var t = document.documentElement.getAttribute("data-theme") || "light";
    $("themeBtn").setAttribute("aria-label", "Theme: " + (t === "system" ? "follow system" : t) + ". Click to change.");
    $("themeBtn").title = "Theme: " + (t === "system" ? "system" : t);
  }

  /* ---------- Events ---------- */
  function setScenario(fn) { fn(cfg().scenario); persist(); renderAll(); }
  $("refreshBtn").addEventListener("click", function () { check(true); });
  $("pauseBtn").addEventListener("click", function () {
    state.paused = !state.paused;
    this.setAttribute("aria-pressed", String(state.paused)); this.textContent = state.paused ? "Resume" : "Pause";
    if (state.paused) { clearTimeout(timer); state.nextAt = null; renderStatus(); } else check(false);
  });
  $("modeSeg").addEventListener("click", function (e) { var b = e.target.closest("[data-mode]"); if (b) setMode(b.getAttribute("data-mode")); });
  $("banner").addEventListener("click", function (e) { var b = e.target.closest("[data-mode-switch]"); if (b) setMode(b.getAttribute("data-mode-switch")); });
  $("gapBanner").addEventListener("click", function (e) { if (e.target.id === "gapX") { state.gapDismissed = true; $("gapBanner").className = "banner warn"; } });
  function setMode(md) {
    if (md === state.mode) return;
    state.mode = md; state.selected = null;
    if (md === "example") EX = makeExample();
    toast(md === "example" ? "Showing the sheet example. Edits are not saved." : "Showing today's rates.");
    renderAll();
  }
  $("themeBtn").addEventListener("click", function () {
    var t = document.documentElement.getAttribute("data-theme") || "light", next = t === "light" ? "dark" : "light";
    if (next) document.documentElement.setAttribute("data-theme", next); else document.documentElement.removeAttribute("data-theme");
    try { if (next) localStorage.setItem(THEME_KEY, next); else localStorage.removeItem(THEME_KEY); } catch (e) {}
    applyThemeLabel(); renderView();
  });
  $("menuBtn").addEventListener("click", function () { if ($("fxapp").classList.contains("nav-open")) closeNav(); else openNav(); });
  $("scrim").addEventListener("click", closeNav);
  $("guideBtn").addEventListener("click", function () { guideShow(0); });
  $("guideBtn2").addEventListener("click", function () { guideShow(0); });
  $("guideNext").addEventListener("click", function () { guideShow(gi + 1); });
  $("guidePrev").addEventListener("click", function () { guideShow(gi - 1); });
  $("guideSkip").addEventListener("click", guideEnd);

  $("scnForm").addEventListener("submit", function (e) { e.preventDefault(); });
  $("amt").addEventListener("input", function () {
    var p = FX.parseAmount(this.value);
    this.setAttribute("aria-invalid", String(!p.ok));
    if (!p.ok) { $("amtErr").textContent = p.msg; return; }
    $("amtErr").textContent = "";
    var v = p.value; setScenario(function (sc) { sc.amount = v; });
  });
  $("amt").addEventListener("blur", function () { var p = FX.parseAmount(this.value); if (p.ok) this.value = FX.fmtMoney(p.value, p.value % 1 ? 2 : 0); });
  $("fromCcy").addEventListener("change", function () { var v = this.value; setScenario(function (sc) { if (v === sc.to) sc.to = sc.from; sc.from = v; }); });
  $("toCcy").addEventListener("change", function () { var v = this.value; setScenario(function (sc) { if (v === sc.from) sc.from = sc.to; sc.to = v; }); });
  $("swapBtn").addEventListener("click", function () { setScenario(function (sc) { var f = sc.from; sc.from = sc.to; sc.to = f; }); });
  $("holdAbroad").addEventListener("change", function () { var c = this.checked; setScenario(function (sc) { sc.holdAbroad = c; }); });
  $("presets").addEventListener("click", function (e) {
    var b = e.target.closest("[data-preset]"); if (!b) return;
    var p = b.getAttribute("data-preset").split(",");
    setScenario(function (sc) { sc.from = p[0]; sc.to = p[1]; sc.amount = +p[2]; });
  });
  function selectRoute(e) {
    var b = e.target.closest("[data-sel]") || e.target.closest(".route[data-id]");
    if (!b) return;
    state.selected = b.getAttribute("data-sel") || b.getAttribute("data-id");
    renderView();
  }
  $("routeList").addEventListener("click", selectRoute);
  $("flows").addEventListener("click", selectRoute);
  $("codeSeg").addEventListener("click", function (e) { var b = e.target.closest("[data-code]"); if (!b) return; cfg().fees.code = b.getAttribute("data-code"); persist(); renderAll(); });
  function pickPair(e) {
    var c = e.target.closest("[data-pair]"); if (!c) return;
    var p = c.getAttribute("data-pair").split("/");
    setScenario(function (sc) { sc.from = p[0]; sc.to = p[1]; });
    toast("Scenario set to " + p[0] + " → " + p[1] + ".");
  }
  $("cards").addEventListener("click", pickPair);
  $("cards2").addEventListener("click", pickPair);
  $("rangeSeg").addEventListener("click", function (e) { var b = e.target.closest("[data-days]"); if (!b) return; state.histDays = +b.getAttribute("data-days"); renderView(); });
  // Quote form
  ["qVal", "qFee"].forEach(function (id) { $(id).addEventListener("input", function () { renderQuote(state.model); }); });
  ["qProv", "qBasis", "qUnit"].forEach(function (id) { $(id).addEventListener("change", function () { renderQuote(state.model); }); });
  $("qForm").addEventListener("submit", function (e) { e.preventDefault(); });
  $("qClear").addEventListener("click", function () { $("qVal").value = ""; $("qFee").value = "0"; renderQuote(state.model); $("qVal").focus(); });
  $("qSave").addEventListener("click", function () {
    var m = state.model, q = quoteCalc(m), id = $("qProv").value;
    if (!m.ok || q.empty || q.err || !q.sane || !id) return;
    var C = cfg(), p = C.providers.filter(function (x) { return x.id === id; })[0]; if (!p) return;
    var before = FX.clone(p);
    p.mode = "quote"; p.quotePair = m.src + "/" + m.tgt; p.quoteBasis = q.p.quoteBasis; p.quoteUnit = q.p.quoteUnit; p.quoteValue = q.p.quoteValue;
    p.feeFixed = q.fee; p.note = "Typed quote " + new Date().toLocaleString("en-MY") + ".";
    persist(); renderAll();
    qUndo = { id: id, before: before };
    toast("Quote saved for " + p.name + ".", "Undo", function () {
      var cur = cfg().providers.filter(function (x) { return x.id === qUndo.id; })[0];
      if (cur) Object.keys(qUndo.before).forEach(function (k) { cur[k] = qUndo.before[k]; });
      persist(); renderAll(); toast("Quote removed.");
    });
  });
  // Checklist
  $("todo").addEventListener("change", function (e) {
    var i = e.target.getAttribute("data-todo"); if (i == null) return;
    var d = loadTodo(); d[i] = e.target.checked; try { localStorage.setItem(TODO_KEY, JSON.stringify(d)); } catch (x) {}
    todoProgress();
  });
  $("todoReset").addEventListener("click", function () { try { localStorage.removeItem(TODO_KEY); } catch (x) {} renderView(); });
  // Sheet fees (commit on change so typing is not interrupted)
  $("sheetFees").addEventListener("change", function (e) {
    var el = e.target, k = el.getAttribute("data-fk"); if (!k) return;
    var raw = String(el.value).replace(/[,\s]/g, ""), v = Number(raw);
    if (raw === "" || !/^\d*\.?\d+$/.test(raw) || v > 100000) { el.setAttribute("aria-invalid", "true"); toast("Fee must be a number from 0 to 100,000."); return; }
    cfg().fees[k] = v; persist(); renderAll();
    var again = document.querySelector('#sheetFees [data-fk="' + k + '"]'); if (again) again.focus();
  });
  $("shCode").addEventListener("change", function () { cfg().fees.code = this.value; persist(); renderAll(); });
  $("shDays").addEventListener("change", function () {
    var v = Number(this.value);
    if (!/^\d+$/.test(String(this.value).trim()) || v > 30) { this.setAttribute("aria-invalid", "true"); toast("Days must be a whole number from 0 to 30."); return; }
    this.removeAttribute("aria-invalid"); cfg().fees.ttDays = v; persist(); renderAll();
  });
  $("printBtn").addEventListener("click", function () { window.print(); });
  $("csvBtn").addEventListener("click", exportCsv);

  // Keyboard shortcuts (ignored while typing)
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { if (gi >= 0) guideEnd(); closeNav(); return; }
    if (gi >= 0 && (e.key === "ArrowRight" || e.key === "ArrowLeft") && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { guideShow(gi + (e.key === "ArrowRight" ? 1 : -1)); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    var map = { "0": "overview", "1": "rates", "2": "compare", "3": "quote", "4": "checklist", s: "sheet", S: "sheet" };
    if (map[e.key]) { location.hash = "#/" + map[e.key]; e.preventDefault(); }
    else if (e.key === "/") { e.preventDefault(); if (state.view === "help") location.hash = "#/overview"; setTimeout(function () { $("amt").focus(); $("amt").select(); }, 0); }
    else if (e.key === "r" || e.key === "R") check(true);
    else if (e.key === "x" || e.key === "X") $("swapBtn").click();
    else if (e.key === "?") guideShow(0);
  });
  window.addEventListener("hashchange", route);
  window.addEventListener("storage", function (e) {
    if (e.key === FX.STORE_KEY) { S = FX.loadSettings(); if (state.mode === "live") renderAll(); }
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { clearTimeout(timer); state.nextAt = null; renderStatus(); }
    else if (!state.paused) { if (!state.lastCheck || Date.now() - state.lastCheck.getTime() >= REFRESH_MS) check(false); else schedule(); }
  });
  var rz = null;
  window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(function () { if (state.view === "markets") renderView(); if (gi >= 0) guideShow(gi); }, 200); });
  setInterval(function () { if (state.lastCheck) renderStatus(); }, 1000);

  fillSelects();
  applyThemeLabel();
  route();
  check(false);
  try { if (!localStorage.getItem(GUIDED_KEY)) setTimeout(function () { guideShow(0); }, 800); } catch (e) {}
})();
