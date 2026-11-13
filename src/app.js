(() => {
  "use strict";
  const SETS = {
    upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    lower: "abcdefghijklmnopqrstuvwxyz",
    digit: "0123456789",
    sym:   "!@#$%^&*()-_=+[]{};:,.?~"
  };
  const AMBIGUOUS = /[Il1O0|]/g;
  const $ = id => document.getElementById(id);
  const pw = $("pw"), len = $("len"), amb = $("amb");
  const boxes = [...document.querySelectorAll("#sets input")];

  // Unbiased random integer in [0, max) using rejection sampling on crypto randomness
  function randInt(max) {
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / max) * max;
    do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % max;
  }
  function shuffle(a) { // Fisher-Yates with crypto randomness
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function activeSets() {
    return boxes.filter(b => b.checked).map(b => {
      let s = SETS[b.dataset.set];
      if (amb.checked) s = s.replace(AMBIGUOUS, "");
      return s;
    });
  }
  function generate() {
    const sets = activeSets();
    const n = +len.value;
    const pool = sets.join("");
    // Guarantee at least one character from every selected set, fill the rest from the full pool
    const out = sets.map(s => s[randInt(s.length)]);
    while (out.length < n) out.push(pool[randInt(pool.length)]);
    return { text: shuffle(out).join(""), poolSize: pool.length };
  }

  const LEVELS = [
    { min: 0,  label: "Weak",        color: "var(--weak)",    bars: 1 },
    { min: 50, label: "Fair",        color: "var(--fair)",    bars: 2 },
    { min: 70, label: "Strong",      color: "var(--strong)",  bars: 3 },
    { min: 90, label: "Very strong", color: "var(--vstrong)", bars: 4 }
  ];
  function render() {
    const { text, poolSize } = generate();
    pw.value = text;
    const bits = text.length * Math.log2(poolSize);
    const lvl = [...LEVELS].reverse().find(l => bits >= l.min);
    $("badge").textContent = lvl.label;
    $("badge").style.background = lvl.color;
    document.querySelectorAll(".meter i").forEach((el, i) => el.style.background = i < lvl.bars ? lvl.color : "");
    $("info").textContent = `About ${Math.floor(bits)} bits of randomness`;
    $("lenv").textContent = len.value;
  }

  let t;
  function toast(msg) {
    const el = $("toast"); el.textContent = msg; el.classList.add("on");
    clearTimeout(t); t = setTimeout(() => el.classList.remove("on"), 1800);
  }
  async function copy() {
    const v = pw.value;
    try { await navigator.clipboard.writeText(v); }
    catch { pw.select(); document.execCommand("copy"); pw.setSelectionRange(0, 0); }
    toast("Password copied");
  }
  function setLen(v) { len.value = Math.min(64, Math.max(8, v)); render(); }

  boxes.forEach(b => b.addEventListener("change", () => {
    if (!boxes.some(x => x.checked)) { b.checked = true; toast("Keep at least one character type"); return; }
    render();
  }));
  amb.addEventListener("change", render);
  len.addEventListener("input", render);
  $("minus").addEventListener("click", () => setLen(+len.value - 1));
  $("plus").addEventListener("click", () => setLen(+len.value + 1));
  $("copy").addEventListener("click", copy);
  $("shuffle").addEventListener("click", e => {
    const b = e.currentTarget; b.classList.remove("spin"); void b.offsetWidth; b.classList.add("spin"); render();
  });

  if (!window.crypto || !crypto.getRandomValues) {
    pw.value = "Unsupported browser";
    toast("Your browser can't generate secure passwords");
  } else render();
})();
