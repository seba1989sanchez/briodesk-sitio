/* BríoDesk — identidad «Impulso + Territorio».
 * Curvas de nivel animadas en la portada, trazo de impulso que baja con el
 * scroll, tarjetas de producto que se inclinan y cifras que se completan cada
 * vez que vuelven a la pantalla. Con prefers-reduced-motion todo queda quieto. */
(function () {
  "use strict";
  var quieto = false;
  try { quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  /* ---------- Curvas de nivel (marching squares sobre ruido suave) ---------- */
  var cv = document.querySelector(".topo");
  if (cv && cv.getContext) {
    var cx = cv.getContext("2d");
    var P = new Uint8Array(512);
    (function () {
      var p = [], i, s = 7;
      for (i = 0; i < 256; i++) p[i] = i;
      for (i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; var j = s % (i + 1), t = p[i]; p[i] = p[j]; p[j] = t; }
      for (i = 0; i < 512; i++) P[i] = p[i & 255];
    })();
    var fade = function (t) { return t * t * (3 - 2 * t); };
    var lerp = function (a, b, t) { return a + (b - a) * t; };
    var h = function (x, y) { return P[P[x & 255] + (y & 255)] / 255; };
    var ruido = function (x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), u = fade(x - xi), v = fade(y - yi);
      return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
    };
    var campo = function (x, y, t) {
      return ruido(x * 0.9 + t * 0.035, y * 0.9) * 0.62 + ruido(x * 2.1 - t * 0.021, y * 2.1 + 5) * 0.28 + ruido(x * 4.3, y * 4.3 - t * 0.028) * 0.1;
    };
    var W = 0, H = 0;
    var medir = function () {
      var r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    var niveles = [0.26, 0.32, 0.38, 0.44, 0.5, 0.56, 0.62, 0.68, 0.74];
    var dibujar = function (t) {
      cx.clearRect(0, 0, W, H);
      var paso = W < 600 ? 16 : 13, cols = Math.ceil(W / paso) + 1, filas = Math.ceil(H / paso) + 1, esc = 1 / 260;
      var v = new Float32Array(cols * filas), i, j;
      for (j = 0; j < filas; j++) for (i = 0; i < cols; i++) v[j * cols + i] = campo(i * paso * esc, j * paso * esc, t);
      niveles.forEach(function (nv, k) {
        var fuerte = k === 4;
        cx.strokeStyle = fuerte ? "rgba(240,138,62,.38)" : "rgba(143,169,172," + (0.10 + (k % 2) * 0.05) + ")";
        cx.lineWidth = fuerte ? 1.4 : 1;
        cx.beginPath();
        var seg = function (p, q) { cx.moveTo(p[0], p[1]); cx.lineTo(q[0], q[1]); };
        for (j = 0; j < filas - 1; j++) for (i = 0; i < cols - 1; i++) {
          var a = v[j * cols + i], b = v[j * cols + i + 1], c = v[(j + 1) * cols + i + 1], d = v[(j + 1) * cols + i];
          var idx = (a > nv) | ((b > nv) << 1) | ((c > nv) << 2) | ((d > nv) << 3);
          if (idx === 0 || idx === 15) continue;
          var x = i * paso, y = j * paso;
          var T = [x + paso * (nv - a) / (b - a), y], R = [x + paso, y + paso * (nv - b) / (c - b)];
          var B = [x + paso * (nv - d) / (c - d), y + paso], L = [x, y + paso * (nv - a) / (d - a)];
          switch (idx) {
            case 1: case 14: seg(L, T); break; case 2: case 13: seg(T, R); break; case 3: case 12: seg(L, R); break;
            case 4: case 11: seg(R, B); break; case 5: seg(L, T); seg(R, B); break; case 6: case 9: seg(T, B); break;
            case 7: case 8: seg(L, B); break; case 10: seg(T, R); seg(L, B); break;
          }
        }
        cx.stroke();
      });
    };
    medir(); dibujar(0);
    window.addEventListener("resize", function () { medir(); dibujar(performance.now() / 1000); });
    if (!quieto) {
      // Solo se anima mientras la portada se ve.
      var visible = true, ult = 0;
      if ("IntersectionObserver" in window) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }).observe(cv);
      var bucle = function (ms) { if (visible && ms - ult > 50) { dibujar(ms / 1000); ult = ms; } requestAnimationFrame(bucle); };
      requestAnimationFrame(bucle);
    }
  }

  /* ---------- Trazo de impulso con el scroll ---------- */
  var riel = document.querySelector(".riel span");
  if (riel) {
    var avance = function () {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      riel.style.height = (max > 0 ? (window.scrollY / max) * 100 : 0) + "%";
    };
    window.addEventListener("scroll", avance, { passive: true }); avance();
  }

  /* ---------- Tarjetas de territorio que se inclinan ---------- */
  var conMouse = false;
  try { conMouse = window.matchMedia("(hover: hover)").matches; } catch (e) {}
  if (!quieto && conMouse) Array.prototype.forEach.call(document.querySelectorAll(".terr"), function (el) {
    el.addEventListener("pointermove", function (ev) {
      var r = el.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width - 0.5, y = (ev.clientY - r.top) / r.height - 0.5;
      el.style.setProperty("--ry", (x * 8).toFixed(2) + "deg"); el.style.setProperty("--rx", (-y * 8).toFixed(2) + "deg");
    });
    el.addEventListener("pointerleave", function () { el.style.setProperty("--rx", "0deg"); el.style.setProperty("--ry", "0deg"); });
  });

  /* ---------- Cifras que se completan al volver a la pantalla ---------- */
  var cifras = document.querySelectorAll("[data-cifra]");
  if (!quieto && cifras.length && "IntersectionObserver" in window) {
    var marcos = new WeakMap();
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        var el = en.target, fin = Number(el.getAttribute("data-fin") || el.textContent.replace(/\D/g, ""));
        el.setAttribute("data-fin", fin);
        cancelAnimationFrame(marcos.get(el));
        if (!en.isIntersecting) { el.textContent = "0"; return; }
        var t0 = performance.now();
        var paso = function (ms) {
          var k = Math.min(1, (ms - t0) / 1200);
          el.textContent = String(Math.round(fin * (1 - Math.pow(1 - k, 3))));
          if (k < 1) marcos.set(el, requestAnimationFrame(paso));
        };
        marcos.set(el, requestAnimationFrame(paso));
      });
    }, { threshold: 0.5 });
    Array.prototype.forEach.call(cifras, function (n) { io.observe(n); });
  }
})();
