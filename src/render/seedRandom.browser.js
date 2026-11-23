/* Init script: deterministic Math.random (mulberry32). The seed placeholder below is replaced before injection. */
(function () {
  var a = __SEED__ >>> 0;
  Math.random = function () {
    a = (a + 0x6d2b79f5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();
