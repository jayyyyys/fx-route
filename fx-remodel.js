(function () {
  var G = { "Cost vs mid": "Total cost against the market mid rate, in basis points.", "Margin vs mid": "How far the provider's rate sits from the market mid rate.", "Market mid": "Midpoint between buy and sell prices: the fair reference rate.",
    "FX margin": "The spread a provider keeps between the mid rate and the rate it gives you.", "Effective rate": "Amount received divided by amount sent, with all fees included.", "bps": "Basis points. 100 bps = 1%.",
    "SWIFT": "Bank-to-bank messaging network used for cross-border transfers.", "OUR": "OUR: sender pays all charges; beneficiary receives the full amount.", "SHA": "SHA: charges shared. Sender pays own bank, beneficiary pays the rest.",
    "BEN": "BEN: beneficiary pays all charges.", "TT": "Telegraphic transfer: a bank wire.", "RFQ": "Request for quote: asking a dealer for a tailored rate.", "BIC": "Bank Identifier Code: a bank's SWIFT address.",
    "1-sigma": "One standard deviation of expected price movement.", "cut-off": "Latest time a bank accepts instructions for same-day processing." };
  var RE = /\b(Cost vs mid|Margin vs mid|Market mid|FX margin|Effective rate|bps|SWIFT|OUR|SHA|BEN|TT|RFQ|BIC|1-sigma|cut-off)\b/g, SKIP = /^(INPUT|SELECT|TEXTAREA|SCRIPT|STYLE|ABBR|OPTION)$/;
  var content = document.getElementById("content"), seen = new WeakMap();
  function tipify() {
    var w = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, { acceptNode: function (n) { return n.parentNode && !SKIP.test(n.parentNode.nodeName) && !n.parentNode.closest("[hidden],abbr") && RE.test(n.nodeValue) ? 1 : 3; } }), nodes = [], n;
    while ((n = w.nextNode())) nodes.push(n);
    nodes.forEach(function (t) {
      var box = t.parentNode.closest(".panel,.route,.tile,.kpi,section") || content, got = seen.get(box) || {}; seen.set(box, got);
      RE.lastIndex = 0; var s = t.nodeValue, out = document.createDocumentFragment(), i = 0, m, hit = false;
      while ((m = RE.exec(s))) { if (got[m[1]] && !got.fresh) continue; got[m[1]] = 1; hit = true; out.appendChild(document.createTextNode(s.slice(i, m.index)));
        var a = document.createElement("abbr"); a.className = "tip"; a.tabIndex = 0; a.setAttribute("data-tip", G[m[1]]); a.textContent = m[1]; out.appendChild(a); i = m.index + m[1].length; }
      if (hit) { out.appendChild(document.createTextNode(s.slice(i))); t.parentNode.replaceChild(out, t); }
    });
  }
  var mo = new MutationObserver(function () { cancelAnimationFrame(mo.f); mo.f = requestAnimationFrame(function () { mo.disconnect(); seen = new WeakMap(); tipify(); mo.observe(content, { childList: true, subtree: true, characterData: true }); }); });
  mo.observe(content, { childList: true, subtree: true, characterData: true }); tipify();
  var tip = document.createElement("div"); tip.className = "tipbox"; document.body.appendChild(tip);
  function show(e) { var t = e.target.closest && e.target.closest(".tip"); if (!t) return; tip.textContent = t.getAttribute("data-tip"); tip.classList.add("on"); var r = t.getBoundingClientRect(); tip.style.left = Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, r.left)) + "px"; tip.style.top = (r.top - tip.offsetHeight - 8 < 8 ? r.bottom + 8 : r.top - tip.offsetHeight - 8) + "px"; }
  function hide(e) { if (e.target.closest && e.target.closest(".tip")) tip.classList.remove("on"); }
  ["mouseover", "focusin"].forEach(function (k) { document.addEventListener(k, show); }); ["mouseout", "focusout"].forEach(function (k) { document.addEventListener(k, hide); });
  /* route swap: the chosen tile grows into the hero, the old hero shrinks back into a tile */
  var last = null, list = document.getElementById("routeList");
  document.addEventListener("click", function (e) { var t = e.target.closest("#flows .tile"); if (!t) return; var h = list.querySelector(".hero"); last = { id: t.getAttribute("data-sel"), from: t.getBoundingClientRect(), hero: h && h.getBoundingClientRect(), old: h && h.getAttribute("data-id") }; }, true);
  function fly(el, from) { if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; var to = el.getBoundingClientRect();
    el.animate([{ transformOrigin: "0 0", transform: "translate(" + (from.left - to.left) + "px," + (from.top - to.top) + "px) scale(" + from.width / to.width + "," + from.height / to.height + ")", opacity: .55 }, { transformOrigin: "0 0", transform: "none", opacity: 1 }], { duration: 440, easing: "cubic-bezier(.2,.8,.2,1)" }); }
  new MutationObserver(function () { if (!last) return; var l = last, h = list.querySelector(".hero"); last = null; if (h && h.getAttribute("data-id") === l.id) fly(h, l.from);
    var b = l.old && document.querySelector('#flows .tile[data-sel="' + l.old + '"]'); if (b && l.hero) fly(b, l.hero); }).observe(list, { childList: true });
})();
