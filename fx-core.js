/* fx-core.js - shared engine for fx-board.html and fx-inputs.html.
   Plain JavaScript, no libraries. Exposes window.FX.
   Methodology follows the FX Comparison methodology (consensus mid, markup model,
   route legs, OUR/SHA/BEN, cost vs mid, edge, transit band). Demo use only. */
(function (global) {
  "use strict";

  var STORE_KEY = "fxapp.settings.v1";
  var SNAP_KEY = "fxapp.snapshot.v1";

  var FOCUS = ["MYR", "USD", "SGD", "THB"];
  var EXTRA = ["EUR", "GBP", "JPY", "CNY", "HKD", "AUD", "IDR", "PHP"];
  var ALL = FOCUS.concat(EXTRA);
  var ROUTE_CCYS = FOCUS.slice();

  var COUNTRY_OF = { SGD: "SG", THB: "TH", MYR: "MY", USD: "US" };
  var COUNTRY_NAME = {
    SG: "Singapore", TH: "Thailand", MY: "Malaysia", US: "the United States",
    ANY: "Any (platform)", ORIGIN: "Sending country (dealer desk)"
  };
  var KIND_LABEL = { board: "Board rate", dealer: "Dealer RFQ", platform: "FX platform", bankplatform: "Bank FX platform" };

  /* ---------- Defaults (illustrative unless noted) ---------- */
  var DEFAULTS = {
    version: 1,
    scenario: { amount: 1000000, from: "SGD", to: "THB", holdAbroad: false },
    providers: [
      { id: "uob-sg", name: "UOB Singapore", country: "SG", kind: "board", enabled: true, mode: "markup", markupBps: 58.14,
        quotePair: "SGD/THB", quoteBasis: "direct", quoteUnit: 1, quoteValue: 0, feePct: 0, feeFixed: 0, bic: "UOVBSGSG",
        note: "From the sheet example: 25.65 vs mid 25.80 = 58.14 bps." },
      { id: "sg-bank-b", name: "Singapore Bank B", country: "SG", kind: "board", enabled: true, mode: "markup", markupBps: 45,
        quotePair: "SGD/THB", quoteBasis: "direct", quoteUnit: 1, quoteValue: 0, feePct: 0, feeFixed: 0, bic: "",
        note: "Illustrative placeholder. Type a real board or dealer quote." },
      { id: "th-bank-a", name: "Thai Bank A", country: "TH", kind: "board", enabled: true, mode: "markup", markupBps: 31.01,
        quotePair: "SGD/THB", quoteBasis: "direct", quoteUnit: 1, quoteValue: 0, feePct: 0, feeFixed: 0, bic: "",
        note: "From the sheet example: 25.72 vs mid 25.80 = 31.01 bps." },
      { id: "th-bank-b", name: "Thai Bank B", country: "TH", kind: "board", enabled: true, mode: "markup", markupBps: 40,
        quotePair: "SGD/THB", quoteBasis: "direct", quoteUnit: 1, quoteValue: 0, feePct: 0, feeFixed: 0, bic: "",
        note: "Illustrative placeholder." },
      { id: "hsbc-evolve", name: "HSBC Evolve", country: "MY", kind: "bankplatform", enabled: true, mode: "markup", markupBps: 1,
        quotePair: "USD/MYR", quoteBasis: "direct", quoteUnit: 1, quoteValue: 0, feePct: 0, feeFixed: 0, bic: "HBMBMYKL",
        note: "1 bp above live market rate (HSBC Evolve walkthrough, 21 Oct). Malaysia only. Markup here is vs mid, not vs a dealing rate." },
      { id: "hsbc-online", name: "HSBC online banking", country: "MY", kind: "board", enabled: true, mode: "markup", markupBps: 3,
        quotePair: "USD/MYR", quoteBasis: "direct", quoteUnit: 1, quoteValue: 0, feePct: 0, feeFixed: 0, bic: "HBMBMYKL",
        note: "3 bps above live market rate (HSBC walkthrough, 21 Oct)." },
      { id: "ocbc-my", name: "OCBC Malaysia", country: "MY", kind: "board", enabled: true, mode: "markup", markupBps: 8,
        quotePair: "USD/MYR", quoteBasis: "direct", quoteUnit: 1, quoteValue: 0, feePct: 0, feeFixed: 0, bic: "OCBCMYKL",
        note: "8 bps above BNM, as per Finance (21 Oct). Treated as 8 bps vs mid." },
      { id: "my-bank", name: "Malaysian bank (your quote)", country: "MY", kind: "board", enabled: true, mode: "markup", markupBps: 35,
        quotePair: "USD/MYR", quoteBasis: "direct", quoteUnit: 1, quoteValue: 0, feePct: 0, feeFixed: 0, bic: "",
        note: "Illustrative placeholder for Maybank, CIMB or another bank. Type the real quote." },
      { id: "fx-platform", name: "FX platform (Wise / Airwallex type)", country: "ANY", kind: "platform", enabled: true, mode: "markup", markupBps: 40,
        quotePair: "SGD/THB", quoteBasis: "direct", quoteUnit: 1, quoteValue: 0, feePct: 0.1, feeFixed: 0, bic: "",
        note: "Illustrative. Converts and pays out locally, so no SWIFT fees. Check the platform's terms." },
      { id: "dealer-rfq", name: "Dealer quote (RFQ)", country: "ORIGIN", kind: "dealer", enabled: true, mode: "markup", markupBps: 12,
        quotePair: "SGD/THB", quoteBasis: "direct", quoteUnit: 1, quoteValue: 0, feePct: 0, feeFixed: 0, bic: "",
        note: "Illustrative negotiated rate from the sending bank's dealing desk. Ask for a real RFQ." }
    ],
    fees: { sender: 20, inter: 10, landing: 0, code: "SHA", ttDays: 1, usdCorrFeeUsd: 15, usdExtraDays: 1, platformDays: 1 },
    risk: { annualVolPct: 3, rfqThresholdUsd: 100000, cutoff: "15:00" },
    fallback: { "USD/MYR": 4.20, "USD/SGD": 1.30, "USD/THB": 33.54 }
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function mergeDefaults(s) {
    var d = clone(DEFAULTS);
    if (!s || typeof s !== "object" || s.version !== 1) return d;
    ["scenario", "fees", "risk", "fallback"].forEach(function (k) {
      if (s[k] && typeof s[k] === "object") Object.keys(d[k]).forEach(function (f) {
        if (s[k][f] !== undefined && s[k][f] !== null) d[k][f] = s[k][f];
      });
    });
    if (Array.isArray(s.providers)) {
      d.providers = s.providers.map(function (p) {
        var base = clone(DEFAULTS.providers[0]);
        Object.keys(base).forEach(function (f) { if (p[f] !== undefined) base[f] = p[f]; });
        return base;
      });
    }
    return d;
  }

  function loadSettings() {
    try { return mergeDefaults(JSON.parse(localStorage.getItem(STORE_KEY))); }
    catch (e) { return clone(DEFAULTS); }
  }
  function saveSettings(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
  }

  function saveSnapshot(perUsd, health, at) {
    try {
      var p = {};
      Object.keys(perUsd).forEach(function (src) {
        p[src] = {};
        Object.keys(perUsd[src]).forEach(function (c) {
          var v = perUsd[src][c];
          p[src][c] = { rate: v.rate, date: v.date.toISOString() };
        });
      });
      localStorage.setItem(SNAP_KEY, JSON.stringify({ perUsd: p, health: health, at: at.toISOString() }));
    } catch (e) { /* storage full or blocked: ignore */ }
  }
  function loadSnapshot() {
    try {
      var s = JSON.parse(localStorage.getItem(SNAP_KEY));
      if (!s || !s.perUsd) return null;
      Object.keys(s.perUsd).forEach(function (src) {
        Object.keys(s.perUsd[src]).forEach(function (c) { s.perUsd[src][c].date = new Date(s.perUsd[src][c].date); });
      });
      s.at = new Date(s.at);
      return s;
    } catch (e) { return null; }
  }

  /* ---------- Small maths ---------- */
  function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var n = s.length;
    if (!n) return NaN;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function bps(rate, ref) { return (rate - ref) / ref * 10000; }
  function normCdf(x) { // Abramowitz-Stegun 7.1.26
    var z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return 0.5 * (1 + (x >= 0 ? y : -y));
  }
  function businessDaysOld(d, now) {
    var a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    var b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    var n = 0;
    for (var t = a + 864e5; t <= b; t += 864e5) { var wd = new Date(t).getUTCDay(); if (wd !== 0 && wd !== 6) n++; }
    return n;
  }

  /* ---------- Sources (same endpoints and shapes as app/adapters.py) ---------- */
  var FRANKFURTER = "https://api.frankfurter.dev";
  var FAWAZ = [
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json",
    "https://latest.currency-api.pages.dev/v1/currencies/usd.json"
  ];
  var SOURCES = [
    { id: "frankfurter", label: "Frankfurter", sub: "central-bank blend", type: "central_bank_ref", cadence: "Daily" },
    { id: "bnm", label: "Bank Negara Malaysia", sub: "via Frankfurter", type: "central_bank_ref", cadence: "Sessions 09:00, 11:30, 12:00, 17:00 MYT" },
    { id: "fawaz", label: "fawazahmed0", sub: "currency-api, aggregated", type: "aggregator_mid", cadence: "Daily" }
  ];
  var TYPE_LABEL = { central_bank_ref: "Central-bank ref", aggregator_mid: "Aggregator mid" };

  function num(x) { var n = Number(x); if (!isFinite(n) || n <= 0) throw new Error("invalid rate"); return n; }
  function parseDay(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
    if (!m) throw new Error("bad date");
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }
  function getJson(url) {
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, 10000);
    return fetch(url, { signal: ctl.signal, cache: "no-store" }).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }, function (e) {
      clearTimeout(t);
      throw new Error(e && e.name === "AbortError" ? "timed out" : "network error (blocked, offline or CORS)");
    });
  }
  function fetchFrankfurter() {
    var others = ALL.filter(function (c) { return c !== "USD"; });
    return getJson(FRANKFURTER + "/v2/rates?base=USD&quotes=" + others.join(",")).then(function (rows) {
      if (!Array.isArray(rows)) throw new Error("unexpected response shape");
      var out = {}, latest = null;
      rows.forEach(function (row) {
        try {
          var q = String(row.quote).toUpperCase();
          if (others.indexOf(q) < 0 || String(row.base || "USD").toUpperCase() !== "USD") return;
          var d = parseDay(row.date);
          out[q] = { rate: num(row.rate), date: d };
          if (!latest || d > latest) latest = d;
        } catch (e) { /* skip bad row */ }
      });
      if (!latest) throw new Error("no usable rates");
      out.USD = { rate: 1, date: latest };
      return out;
    });
  }
  function fetchBNM() {
    var curs = ALL.filter(function (c) { return c !== "MYR"; });
    return Promise.allSettled(curs.map(function (c) {
      return getJson(FRANKFURTER + "/v2/rate/" + c + "/MYR?providers=BNM").then(function (d) {
        if (String(d.base || c).toUpperCase() !== c || String(d.quote || "MYR").toUpperCase() !== "MYR") throw new Error("pair mismatch");
        return { c: c, myrPer: num(d.rate), date: parseDay(d.date) };
      });
    })).then(function (res) {
      var myr = {}, fails = [];
      res.forEach(function (r, i) { if (r.status === "fulfilled") myr[r.value.c] = r.value; else fails.push(curs[i]); });
      if (!myr.USD) throw new Error("USD/MYR unavailable");
      var usdMyr = myr.USD.myrPer, out = { MYR: { rate: usdMyr, date: myr.USD.date } };
      Object.keys(myr).forEach(function (c) { out[c] = { rate: c === "USD" ? 1 : usdMyr / myr[c].myrPer, date: myr[c].date }; });
      out._partial = fails;
      return out;
    });
  }
  function fetchFawaz() {
    var i = 0, lastErr = null;
    function attempt() {
      if (i >= FAWAZ.length) return Promise.reject(new Error("all mirrors failed: " + (lastErr && lastErr.message)));
      return getJson(FAWAZ[i++]).then(function (data) {
        var d = parseDay(data.date), tbl = data.usd || {}, out = { USD: { rate: 1, date: d } };
        ALL.forEach(function (c) { var v = tbl[c.toLowerCase()]; if (c !== "USD" && v != null) { try { out[c] = { rate: num(v), date: d }; } catch (e) {} } });
        if (Object.keys(out).length < 2) throw new Error("no usable rates");
        return out;
      }).catch(function (e) { lastErr = e; return attempt(); });
    }
    return attempt();
  }
  var FETCHERS = { frankfurter: fetchFrankfurter, bnm: fetchBNM, fawaz: fetchFawaz };

  function fetchAll() {
    var perUsd = {}, health = {};
    return Promise.all(SOURCES.map(function (s) {
      var t0 = performance.now();
      return FETCHERS[s.id]().then(function (data) {
        var partial = data._partial || []; delete data._partial;
        perUsd[s.id] = data;
        var newest = null;
        Object.keys(data).forEach(function (c) { if (!newest || data[c].date > newest) newest = data[c].date; });
        health[s.id] = { ok: true, partial: partial, ms: Math.round(performance.now() - t0), at: new Date().toISOString(), newest: newest && newest.toISOString() };
      }, function (e) {
        health[s.id] = { ok: false, err: e.message, ms: Math.round(performance.now() - t0), at: new Date().toISOString() };
      });
    })).then(function () { return { perUsd: perUsd, health: health }; });
  }

  /* ---------- Consensus mid ---------- */
  function consensusOfRates(rates, outlierBps) {
    outlierBps = outlierBps || 50;
    if (!rates.length) return { mid: NaN, used: 0, disp: NaN, rejected: [] };
    var first = median(rates);
    var used = rates.filter(function (r) { return Math.abs(bps(r, first)) <= outlierBps; });
    var mid = median(used), disp = 0;
    used.forEach(function (r) { disp = Math.max(disp, Math.abs(bps(r, mid))); });
    return { mid: mid, used: used.length, disp: disp, first: first };
  }

  function sourceQuote(perUsd, srcId, b, q) {
    var m = perUsd[srcId];
    if (!m || !m[b] || !m[q]) return null;
    var cross = null;
    if (srcId === "bnm" && b !== "MYR" && q !== "MYR") cross = "cross via MYR";
    else if (srcId !== "bnm" && b !== "USD" && q !== "USD") cross = "cross via USD";
    return { src: srcId, rate: m[q].rate / m[b].rate, date: m[q].date < m[b].date ? m[q].date : m[b].date, cross: cross };
  }

  // allowStale: if no fresh source, fall back to stale ones (labelled).
  function consensus(perUsd, b, q, now, allowStale) {
    var rows = SOURCES.map(function (s) { return sourceQuote(perUsd, s.id, b, q); }).filter(Boolean);
    rows.forEach(function (r) { r.stale = businessDaysOld(r.date, now) > 2; });
    var pool = rows.filter(function (r) { return !r.stale; }), staleUsed = false;
    if (!pool.length && allowStale && rows.length) { pool = rows; staleUsed = true; }
    if (!pool.length) return { rows: rows, mid: NaN, used: 0, disp: NaN, staleUsed: false };
    var c = consensusOfRates(pool.map(function (r) { return r.rate; }));
    pool.forEach(function (r) { r.rejected = Math.abs(bps(r.rate, c.first)) > 50; });
    rows.forEach(function (r) { r.dev = bps(r.rate, c.mid); r.used = pool.indexOf(r) >= 0 && !r.rejected; });
    return { rows: rows, mid: c.mid, used: c.used, disp: c.disp, staleUsed: staleUsed };
  }

  // Builds a mid(a,b) function: live consensus -> stale consensus -> illustrative fallback.
  function makeMid(perUsd, settings, now) {
    var cache = {};
    function fb(a, b) {
      var f = settings.fallback, usd = { USD: 1, MYR: +f["USD/MYR"], SGD: +f["USD/SGD"], THB: +f["USD/THB"] };
      if (!(usd[a] > 0) || !(usd[b] > 0)) return NaN;
      return usd[b] / usd[a];
    }
    function info(a, b) {
      if (a === b) return { mid: 1, how: "same" };
      var k = a + "/" + b;
      if (cache[k]) return cache[k];
      var c = consensus(perUsd || {}, a, b, now, true), r;
      if (isFinite(c.mid)) r = { mid: c.mid, how: c.staleUsed ? "stale" : "live", used: c.used, disp: c.disp };
      else r = { mid: fb(a, b), how: "fallback" };
      cache[k] = r;
      return r;
    }
    var fn = function (a, b) { return info(a, b).mid; };
    fn.info = info;
    return fn;
  }

  /* ---------- Provider rates ---------- */
  function quoteToRate(p) {
    var unit = +p.quoteUnit > 0 ? +p.quoteUnit : 1, v = +p.quoteValue;
    if (!(v > 0)) return NaN;
    return p.quoteBasis === "inverse" ? unit / v : v / unit;
  }
  function sanity(markup) { return markup >= -25 && markup <= 500; }

  // Customer rate for converting a -> b at provider p.
  function providerRate(p, a, b, mid) {
    var m = mid(a, b);
    if (p.mode === "quote" && p.quotePair === a + "/" + b && +p.quoteValue > 0) {
      var rate = quoteToRate(p), mk = (m - rate) / m * 10000;
      if (!sanity(mk)) return { ok: false, rate: rate, markupBps: mk, how: "quote",
        msg: "Typed quote is " + mk.toFixed(1) + " bps from mid, outside the -25 to +500 bps sanity band. Check the unit and direction." };
      return { ok: true, rate: rate, markupBps: mk, how: "quote" };
    }
    var mkb = +p.markupBps;
    if (!isFinite(mkb)) return { ok: false, rate: NaN, markupBps: NaN, how: "markup", msg: "Markup is not a number." };
    return { ok: true, rate: m * (1 - mkb / 10000), markupBps: mkb, how: "markup" };
  }

  /* ---------- Routes ---------- */
  function ttLeg(ccy, fees, days, where, extraInterSrc) {
    return { t: "transfer", ccy: ccy, sender: +fees.sender || 0, inter: (+fees.inter || 0) + (extraInterSrc || 0),
      landing: +fees.landing || 0, code: fees.code, days: days, where: where };
  }
  function cvLeg(from, to, p, pr, where) {
    return { t: "convert", from: from, to: to, rate: pr.rate, markupBps: pr.markupBps, how: pr.how,
      provider: p.name, kind: p.kind, feePct: +p.feePct || 0, feeFixed: +p.feeFixed || 0, where: where };
  }

  function buildRoutes(s, mid) {
    var src = s.scenario.from, tgt = s.scenario.to, fees = s.fees;
    var oc = COUNTRY_OF[src], dc = COUNTRY_OF[tgt];
    var on = s.providers.filter(function (p) { return p.enabled; });
    var routes = [];
    var oName = COUNTRY_NAME[oc] || oc, dName = COUNTRY_NAME[dc] || dc;
    var ttDays = +fees.ttDays || 0;

    function add(r) { routes.push(r); }
    function unavailable(r, reason) { r.available = false; r.reason = reason; return r; }

    // A: convert in sending country, then TT the target currency.
    on.filter(function (p) { return p.country === oc; }).forEach(function (p) {
      var pr = providerRate(p, src, tgt, mid);
      var r = { id: "A-" + p.id, family: "A", title: "Convert in " + oName + " at " + p.name,
        short: "Direct in " + oName + " (" + p.name + ")", providers: [p], notes: [],
        legs: [cvLeg(src, tgt, p, pr, oName), ttLeg(tgt, fees, ttDays, oName + " to " + dName)] };
      if (!pr.ok) unavailable(r, pr.msg); else r.available = true;
      if (tgt === "MYR") r.notes.push("Ringgit is not traded offshore. Offshore banks deliver MYR through onshore partners; confirm the payment is allowed under BNM foreign exchange policy.");
      if (tgt === "THB") r.notes.push("Offshore THB is subject to Bank of Thailand rules on non-resident baht. Confirm with the bank.");
      add(r);
    });

    // B: TT source currency to own account in target country, convert there.
    on.filter(function (p) { return p.country === dc; }).forEach(function (p) {
      var pr = providerRate(p, src, tgt, mid);
      var r = { id: "B-" + p.id, family: "B", title: "Send " + src + " to " + dName + ", convert at " + p.name,
        short: "Send " + src + ", convert at " + p.name, providers: [p], notes: [],
        legs: [ttLeg(src, fees, ttDays, oName + " to " + dName), cvLeg(src, tgt, p, pr, dName)] };
      if (!pr.ok) unavailable(r, pr.msg); else r.available = true;
      r.notes.push("Needs a " + src + " account in your company's name in " + dName + ".");
      add(r);
    });

    // C: convert from source currency already held in target country.
    var cProv = on.filter(function (p) { return p.country === dc; });
    if (cProv.length) {
      if (s.scenario.holdAbroad) {
        cProv.forEach(function (p) {
          var pr = providerRate(p, src, tgt, mid);
          var r = { id: "C-" + p.id, family: "C", title: "Convert " + src + " already held in " + dName + " at " + p.name,
            short: src + " held in " + dName + ", convert at " + p.name, providers: [p], notes: ["Uses an existing " + src + " balance in " + dName + "; no transfer."],
            legs: [cvLeg(src, tgt, p, pr, dName)] };
          if (!pr.ok) unavailable(r, pr.msg); else r.available = true;
          add(r);
        });
      } else {
        add(unavailable({ id: "C-off", family: "C", title: "Convert " + src + " already held in " + dName,
          short: "Held in " + dc, providers: [], notes: [], legs: [] },
          "Turn on \"We already hold " + src + " in " + dName + "\" to include this route."));
      }
    }

    // D: via USD (two conversions, USD correspondent fee).
    if (src !== "USD" && tgt !== "USD") {
      var po = bestProvider(on.filter(function (p) { return p.country === oc; }), src, "USD", mid);
      var pd = bestProvider(on.filter(function (p) { return p.country === dc; }), "USD", tgt, mid);
      var title = "Via USD: convert to USD, send USD, convert in " + dName;
      if (po && pd) {
        var pr1 = providerRate(po, src, "USD", mid), pr2 = providerRate(pd, "USD", tgt, mid);
        var corr = (+fees.usdCorrFeeUsd || 0) * mid("USD", src);
        var r = { id: "D-usd", family: "D", title: title, short: "Via USD, " + po.name + " then " + pd.name,
          providers: [po, pd], notes: ["Two conversions means two margins. Common when the corridor has no direct correspondent bank. Adds a USD correspondent fee and " + (+fees.usdExtraDays || 0) + " extra day(s)."],
          legs: [cvLeg(src, "USD", po, pr1, oName), ttLeg("USD", fees, ttDays + (+fees.usdExtraDays || 0), oName + " to " + dName + " via US correspondent", corr), cvLeg("USD", tgt, pd, pr2, dName)] };
        r.available = pr1.ok && pr2.ok;
        if (!r.available) r.reason = (pr1.ok ? pr2.msg : pr1.msg);
        add(r);
      } else {
        add(unavailable({ id: "D-usd", family: "D", title: title, short: "Via USD", providers: [], notes: [], legs: [] },
          "Needs at least one enabled bank in " + oName + " and one in " + dName + "."));
      }
    }

    // P: FX platform (local payout, no SWIFT).
    on.filter(function (p) { return p.country === "ANY"; }).forEach(function (p) {
      var pr = providerRate(p, src, tgt, mid);
      var r = { id: "P-" + p.id, family: "P", title: "FX platform: " + p.name, short: p.name, providers: [p],
        notes: ["Local pay-in and pay-out, so no SWIFT fees. Usually arrives in about " + (+fees.platformDays || 0) + " day(s). Check limits and KYC for large amounts."],
        legs: [cvLeg(src, tgt, p, pr, "Platform")] };
      if (!pr.ok) unavailable(r, pr.msg); else r.available = true;
      r.platformDays = +fees.platformDays || 0;
      add(r);
    });

    // R: dealer RFQ at sending bank.
    var ticketUsd = (+s.scenario.amount || 0) * mid(src, "USD"), rfqMin = +s.risk.rfqThresholdUsd || 0;
    on.filter(function (p) { return p.country === "ORIGIN"; }).forEach(function (p) {
      var pr = providerRate(p, src, tgt, mid);
      var r = { id: "R-" + p.id, family: "R", title: "Dealer quote (RFQ) at your sending bank, then send " + tgt, short: "Dealer RFQ at your sending bank",
        providers: [p], notes: ["A negotiated rate from the bank's dealing desk. Usually only offered for larger tickets; the rate is valid for minutes."],
        legs: [cvLeg(src, tgt, p, pr, oName + " dealing desk"), ttLeg(tgt, fees, ttDays, oName + " to " + dName)] };
      if (!pr.ok) unavailable(r, pr.msg);
      else if (ticketUsd < rfqMin) unavailable(r, "Dealer desks usually quote tickets above about USD " + rfqMin.toLocaleString("en-MY") + "; this one is about USD " + Math.round(ticketUsd).toLocaleString("en-MY") + ". Change the threshold on Rates and assumptions.");
      else r.available = true;
      add(r);
    });

    return routes;
  }

  function bestProvider(list, a, b, mid) {
    var best = null, bestRate = -Infinity;
    list.forEach(function (p) {
      var pr = providerRate(p, a, b, mid);
      if (pr.ok && pr.rate - (pr.rate * (+p.feePct || 0) / 100) > bestRate) { bestRate = pr.rate * (1 - (+p.feePct || 0) / 100); best = p; }
    });
    return best;
  }

  /* ---------- Route evaluation (flow method) ---------- */
  function evaluate(route, amount, src, tgt, mid) {
    var res = { route: route, ok: true, err: null, feeLines: [], exposureDays: 0, totalDays: 0 };
    if (!route.available) { res.ok = false; res.err = route.reason; return res; }
    var cur = src, bal = amount, onTop = 0, fxMarginT = 0, converted = null;
    for (var i = 0; i < route.legs.length; i++) {
      var L = route.legs[i];
      if (L.t === "transfer") {
        if (L.ccy !== cur) { res.ok = false; res.err = "Transfer leg in " + L.ccy + " but holding " + cur; return res; }
        var toCur = mid(src, cur);
        var sender = L.sender, inter = L.inter, landing = L.landing, top = 0, ded = 0;
        if (L.code === "OUR") { top = sender + inter; ded = landing; }
        else if (L.code === "BEN") { ded = sender + inter + landing; }
        else { top = sender; ded = inter + landing; }
        onTop += top;
        bal -= ded * toCur;
        if (sender) res.feeLines.push({ label: "Sender TT fee", src: sender, how: L.code === "BEN" ? "deducted" : "on top", leg: i });
        if (inter) res.feeLines.push({ label: "Intermediary / correspondent fee", src: inter, how: L.code === "OUR" ? "on top" : "deducted", leg: i });
        if (landing) res.feeLines.push({ label: "Beneficiary bank landing fee", src: landing, how: "deducted", leg: i });
        if (bal <= 0) { res.ok = false; res.err = "Fees are larger than the amount."; return res; }
        res.totalDays += L.days;
        if (cur !== tgt) res.exposureDays += L.days;
      } else if (L.t === "convert") {
        if (L.from !== cur) { res.ok = false; res.err = "Convert leg from " + L.from + " but holding " + cur; return res; }
        if (!(L.rate > 0)) { res.ok = false; res.err = "No rate for " + L.from + "/" + L.to; return res; }
        var fee = bal * L.feePct / 100 + L.feeFixed * mid(src, cur);
        if (fee > 0) {
          res.feeLines.push({ label: L.provider + " fee", src: fee * mid(cur, src), how: "deducted", leg: i });
          bal -= fee;
        }
        if (bal <= 0) { res.ok = false; res.err = "Fees are larger than the amount."; return res; }
        var m = mid(L.from, L.to);
        fxMarginT += bal * (m - L.rate) * mid(L.to, tgt);
        if (converted === null) converted = { amount: bal, ccy: cur };
        bal = bal * L.rate;
        cur = L.to;
      }
    }
    if (cur !== tgt) { res.ok = false; res.err = "Route ends in " + cur + ", not " + tgt; return res; }
    var midST = mid(src, tgt);
    res.net = bal;
    res.sourceSpent = amount + onTop;
    res.onTop = onTop;
    res.effRate = res.net / res.sourceSpent;
    res.netPerAmount = res.effRate * amount;
    res.midValue = res.sourceSpent * midST;
    res.totalCost = res.midValue - res.net;
    res.costBps = res.totalCost / res.midValue * 10000;
    res.fxMargin = fxMarginT;
    res.fees = res.totalCost - fxMarginT;
    res.converted = converted;
    if (route.platformDays) res.totalDays = route.platformDays;
    return res;
  }

  function compare(results, amount, src, tgt, mid, annualVolPct) {
    var dailyVol = (annualVolPct / 100) / Math.sqrt(252);
    var ok = results.filter(function (r) { return r.ok; });
    var midST = mid(src, tgt);
    ok.forEach(function (r) { r.band = r.net * dailyVol * Math.sqrt(r.exposureDays); });
    var sorted = ok.slice().sort(function (a, b) { return b.netPerAmount - a.netPerAmount; });
    var best = sorted[0] || null, runner = sorted[1] || null;
    var baseline = ok.filter(function (r) { return r.route.family === "A"; })[0] || ok[0] || null;
    ok.forEach(function (r) {
      r.edgeVsBest = best ? r.netPerAmount - best.netPerAmount : 0;
      r.edgeVsBaseline = baseline ? r.netPerAmount - baseline.netPerAmount : 0;
      r.edgeVsBaselineBps = r.edgeVsBaseline / (amount * midST) * 10000;
      r.rank = sorted.indexOf(r) + 1;
    });
    var out = { best: best, runner: runner, baseline: baseline, sorted: sorted, dailyVol: dailyVol };
    if (best && runner) {
      out.edgeVsRunner = best.netPerAmount - runner.netPerAmount;
      out.edgeVsRunnerBps = out.edgeVsRunner / (amount * midST) * 10000;
      var band = Math.max(best.band, runner.band);
      out.band = band;
      out.withinNoise = band > 0 && Math.abs(out.edgeVsRunner) < band;
      out.lossProb = band > 0 && out.edgeVsRunner > 0 ? normCdf(-out.edgeVsRunner / band) : null;
    }
    return out;
  }

  /* ---------- Formatting ---------- */
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtRate(v) {
    if (!isFinite(v)) return "\u2014";
    var dp = v >= 100 ? 2 : v >= 1 ? 4 : 6;
    return v.toLocaleString("en-MY", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function fmtMoney(v, dp) {
    if (!isFinite(v)) return "\u2014";
    dp = dp == null ? 2 : dp;
    return v.toLocaleString("en-MY", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function fmtSigned(v, dp) { if (!isFinite(v)) return "\u2014"; return (v > 0 ? "+" : v < 0 ? "\u2212" : "") + fmtMoney(Math.abs(v), dp); }
  function fmtBps(v) { if (!isFinite(v)) return "\u2014"; return v.toFixed(2) + " bps"; }
  function hhmm(d) { return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function dayMon(d) { return d.getDate() + " " + MON[d.getMonth()]; }
  function dayMonUTC(d) { return d.getUTCDate() + " " + MON[d.getUTCMonth()]; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function parseAmount(raw) {
    var s = String(raw || "").replace(/[,\s]/g, "");
    if (s === "") return { ok: false, msg: "Enter an amount." };
    if (!/^\d*\.?\d+$/.test(s)) return { ok: false, msg: "Use numbers only, for example 1,000,000 or 2500.50." };
    var a = Number(s);
    if (!(a > 0)) return { ok: false, msg: "Amount must be more than zero." };
    if (a > 1e12) return { ok: false, msg: "Amount is too large. Use up to 1,000,000,000,000." };
    return { ok: true, value: a };
  }

  /* ---------- Self-check (reproduces the methodology's worked examples) ---------- */
  function selfCheck() {
    var out = [];
    function check(name, got, exp, tol) { out.push({ name: name, got: got, exp: exp, pass: isFinite(got) && Math.abs(got - exp) <= tol }); }
    var constMid = function (v) { var f = function (a, b) { return a === b ? 1 : (a === "SGD" && b === "THB" ? v : 1 / v); }; return f; };
    var mid = constMid(25.80);
    var fees = { sender: 20, inter: 10, landing: 0, code: "SHA" };
    var A = { available: true, family: "A", legs: [{ t: "convert", from: "SGD", to: "THB", rate: 25.65, feePct: 0, feeFixed: 0 }] };
    var B = { available: true, family: "B", legs: [ttLeg("SGD", fees, 1, ""), { t: "convert", from: "SGD", to: "THB", rate: 25.72, feePct: 0, feeFixed: 0 }] };
    var C = { available: true, family: "C", legs: [{ t: "convert", from: "SGD", to: "THB", rate: 25.70, feePct: 0, feeFixed: 0 }] };
    var rs = [A, B, C].map(function (r) { return evaluate(r, 1000000, "SGD", "THB", mid); });
    compare(rs, 1000000, "SGD", "THB", mid, 3);
    check("Route A cost vs mid (bps)", rs[0].costBps, 58.14, 0.005);
    check("Route B net received (THB)", rs[1].net, 25719742.80, 0.01);
    check("Route B source spent (SGD)", rs[1].sourceSpent, 1000020, 0.001);
    check("Route B netPerAmount (THB)", rs[1].netPerAmount, 25719228.42, 0.01);
    check("Route B edge vs A (THB)", rs[1].edgeVsBaseline, 69228.42, 0.01);
    check("Route B edge vs A (bps)", rs[1].edgeVsBaselineBps, 26.83, 0.005);
    check("Route B cost vs mid (bps)", rs[1].costBps, 31.31, 0.005);
    check("Route C edge vs A (THB)", rs[2].edgeVsBaseline, 50000, 0.01);
    var band = rs[1].net * (0.03 / Math.sqrt(252)) * 1;
    check("Transit band, 1 day at 3% vol (THB)", Math.round(band), 48606, 0);
    check("Edge loss probability (%)", normCdf(-rs[1].edgeVsBaseline / band) * 100, 7.7, 0.05);
    ["OUR", "SHA", "BEN"].forEach(function (code, i) {
      var m26 = constMid(26);
      var r = evaluate({ available: true, legs: [ttLeg("SGD", { sender: 20, inter: 10, landing: 0, code: code }, 1, ""), { t: "convert", from: "SGD", to: "THB", rate: 26, feePct: 0, feeFixed: 0 }] }, 1000, "SGD", "THB", m26);
      check("SWIFT " + code + ": spent (SGD)", r.sourceSpent, [1030, 1020, 1000][i], 0.001);
      check("SWIFT " + code + ": net (THB)", r.net, [26000, 25740, 25220][i], 0.001);
      check("SWIFT " + code + ": cost vs mid (THB)", r.totalCost, 780, 0.001);
    });
    var c = consensusOfRates([26.303, 26.2967, 26.3099, 2.6303]);
    check("Consensus: sources used", c.used, 3, 0);
    check("Consensus: mid", c.mid, 26.303, 1e-9);
    check("Consensus: dispersion (bps)", c.disp, 2.62, 0.005);
    var mk = (26.3099 - 26.0938) / 26.3099 * 10000;
    check("Markup model: hsbc-sg markup (bps)", mk, 82.1364, 0.0001);
    check("Markup model: repriced on 26.40", 26.40 * (1 - mk / 10000), 26.183159904, 1e-6);
    check("Unit: SGD 3.9000 per 100 THB to THB per SGD", quoteToRate({ quoteBasis: "inverse", quoteUnit: 100, quoteValue: 3.9 }), 25.6410, 0.00005);
    var bad = (25.8 - 3.8) / 25.8 * 10000;
    out.push({ name: "Sanity band rejects 3.80 read as THB per SGD", got: sanity(bad) ? "accepted" : "rejected", exp: "rejected", pass: !sanity(bad) });
    return out;
  }

  global.FX = {
    STORE_KEY: STORE_KEY, SNAP_KEY: SNAP_KEY, DEFAULTS: DEFAULTS, FOCUS: FOCUS, EXTRA: EXTRA, ALL: ALL, ROUTE_CCYS: ROUTE_CCYS,
    COUNTRY_OF: COUNTRY_OF, COUNTRY_NAME: COUNTRY_NAME, KIND_LABEL: KIND_LABEL, SOURCES: SOURCES, TYPE_LABEL: TYPE_LABEL,
    clone: clone, loadSettings: loadSettings, saveSettings: saveSettings, mergeDefaults: mergeDefaults,
    saveSnapshot: saveSnapshot, loadSnapshot: loadSnapshot, fetchAll: fetchAll,
    consensus: consensus, consensusOfRates: consensusOfRates, makeMid: makeMid, businessDaysOld: businessDaysOld,
    providerRate: providerRate, quoteToRate: quoteToRate, sanity: sanity,
    buildRoutes: buildRoutes, evaluate: evaluate, compare: compare, normCdf: normCdf, bps: bps,
    fmtRate: fmtRate, fmtMoney: fmtMoney, fmtSigned: fmtSigned, fmtBps: fmtBps, hhmm: hhmm, dayMon: dayMon, dayMonUTC: dayMonUTC,
    esc: esc, parseAmount: parseAmount, selfCheck: selfCheck
  };
})(window);
