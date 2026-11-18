// Stand-in for a heavy third-party tag (chat widget, A/B testing, analytics).
// It does ~350ms of synchronous work while the page is still parsing.
(function () {
  var end = performance.now() + 350;
  var x = 0;
  while (performance.now() < end) x += Math.sqrt(x + 1);
  window.__widget = x;
})();
