// Same 350ms of work, split into ~10ms slices that yield to the main thread,
// so input can be handled between slices (good for INP / TBT).
(function () {
  var left = 350;
  var x = 0;
  function slice() {
    var end = performance.now() + Math.min(10, left);
    while (performance.now() < end) x += Math.sqrt(x + 1);
    left -= 10;
    if (left > 0) setTimeout(slice, 0);
    else window.__widget = x;
  }
  slice();
})();
