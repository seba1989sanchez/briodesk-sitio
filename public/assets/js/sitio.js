/* BríoDesk — interacción del sitio público. JavaScript sin dependencias.
 *
 * Rotadores ([data-rotador]): un tablist con sus paneles que avanza solo cada
 * data-intervalo ms. La rotación corre solo si la sección está visible, se
 * pausa con el mouse encima o con foco de teclado dentro, y se detiene cuando
 * el visitante elige una pestaña. Con prefers-reduced-motion no rota.
 */
(function () {
  "use strict";

  var reducido = false;
  try { reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  var $$ = function (sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); };

  /* ---------- Visibilidad de secciones ---------- */

  var visibles = new WeakMap();
  var observador = "IntersectionObserver" in window
    ? new IntersectionObserver(function (entradas) {
        entradas.forEach(function (e) { visibles.set(e.target, e.isIntersecting); });
      }, { threshold: 0.15 })
    : null;

  function observar(el) {
    if (observador) observador.observe(el); else visibles.set(el, true);
  }
  function estaVisible(el) {
    var zona = el.closest("[data-observa]");
    return !zona || visibles.get(zona) === true;
  }
  $$("[data-observa]").forEach(observar);

  /* ---------- Menú móvil ---------- */

  var toggle = document.querySelector(".nav-toggle");
  var menu = document.getElementById("nav-menu");
  if (toggle && menu) {
    var cerrarMenu = function () { toggle.setAttribute("aria-expanded", "false"); menu.classList.remove("abierto"); };
    toggle.addEventListener("click", function () {
      var abierto = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!abierto));
      menu.classList.toggle("abierto", !abierto);
    });
    menu.addEventListener("click", function (e) { if (e.target.closest("a")) cerrarMenu(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") { cerrarMenu(); toggle.focus(); }
    });
  }

  /* ---------- Tablist accesible ---------- */

  function tablist(lista, alElegir) {
    var tabs = $$('[role="tab"]', lista);
    lista.addEventListener("click", function (e) {
      var tab = e.target.closest('[role="tab"]');
      if (tab && tabs.indexOf(tab) >= 0) alElegir(tabs.indexOf(tab), true);
    });
    lista.addEventListener("keydown", function (e) {
      var i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      var n = tabs.length, j = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % n;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + n) % n;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = n - 1;
      if (j === null) return;
      e.preventDefault();
      alElegir(j, true);
      tabs[j].focus();
    });
    return tabs;
  }

  function marcar(tabs, i) {
    tabs.forEach(function (t, k) {
      var activo = k === i;
      t.setAttribute("aria-selected", String(activo));
      t.tabIndex = activo ? 0 : -1;
    });
  }

  /* ---------- Rotadores ---------- */

  var PASO = 100; // ms entre actualizaciones del reloj de cada rotador

  function rotador(raiz) {
    var lista = raiz.querySelector('[role="tablist"]');
    if (!lista) return;
    var intervalo = parseInt(raiz.getAttribute("data-intervalo"), 10) || 6000;
    var acumula = raiz.hasAttribute("data-acumula");
    var playBtn = raiz.querySelector("[data-play]");
    var barras = $$("[data-progreso] > span", raiz);
    var paneles, tabs;
    var actual = 0, transcurrido = 0;
    var reproduciendo = !reducido;
    var reproduccionExplicita = false; // el visitante apretó «Reproducir»
    var sobre = false, focoTeclado = false;

    tabs = tablist(lista, function (i, porUsuario) {
      if (porUsuario) detener();
      ir(i);
    });
    paneles = tabs.map(function (t) { return document.getElementById(t.getAttribute("aria-controls")); });

    function ir(i) {
      var cambia = i !== actual;
      actual = i;
      transcurrido = 0;
      marcar(tabs, i);
      paneles.forEach(function (p, k) { if (p) p.hidden = k !== i; });
      var tab = tabs[i];

      // Elementos con un hijo por pestaña (palabra del título, ficha del ticket…)
      $$("[data-por-indice]", raiz).forEach(function (c) {
        Array.prototype.forEach.call(c.children, function (h, k) { h.hidden = k !== i; });
      });
      // Textos que vienen de la pestaña activa (data-titulo, data-url, data-texto…)
      $$("[data-texto-tab]", raiz).forEach(function (el) {
        var v = tab.getAttribute("data-" + el.getAttribute("data-texto-tab"));
        if (v !== null) el.textContent = v;
      });
      // Menú lateral de la vista web
      var menuLateral = raiz.querySelector("[data-menu-lateral]");
      if (menuLateral) {
        var m = parseInt(tab.getAttribute("data-menu"), 10);
        $$("span", menuLateral).forEach(function (s, k) { s.classList.toggle("activo", k === m); });
      }
      // Línea de tiempo del recorrido
      if (acumula) {
        var pct = (i / (tabs.length - 1)) * 100 + "%";
        tabs.forEach(function (t, k) { t.classList.toggle("hecho", k <= i); });
        var avance = raiz.querySelector("[data-avance]");
        var chip = raiz.querySelector("[data-chip]");
        if (avance) avance.style.width = pct;
        if (chip) chip.style.left = pct;
      }
      if (cambia) refrescarVivos(raiz);
      pintarProgreso();
    }

    function detener() {
      reproduciendo = false;
      reproduccionExplicita = false;
      actualizarPlay();
      pintarProgreso();
    }

    function actualizarPlay() {
      if (!playBtn) return;
      playBtn.setAttribute("aria-pressed", String(reproduciendo));
      playBtn.querySelector("span").textContent = reproduciendo ? "Pausar recorrido" : "Reproducir recorrido";
    }

    function pintarProgreso() {
      var ancho = reproduciendo ? Math.min(100, (transcurrido / intervalo) * 100) : 100;
      barras.forEach(function (b) { b.style.width = ancho + "%"; });
    }

    if (playBtn) {
      playBtn.addEventListener("click", function () {
        reproduciendo = !reproduciendo;
        reproduccionExplicita = reproduciendo;
        transcurrido = 0;
        actualizarPlay();
        pintarProgreso();
      });
    }
    var anterior = raiz.querySelector("[data-anterior]");
    var siguiente = raiz.querySelector("[data-siguiente]");
    if (anterior) anterior.addEventListener("click", function () { detener(); ir(Math.max(0, actual - 1)); });
    if (siguiente) siguiente.addEventListener("click", function () { detener(); ir(actual >= tabs.length - 1 ? 0 : actual + 1); });

    // Pausa temporal: mouse encima o foco de teclado dentro del bloque.
    raiz.addEventListener("mouseenter", function () { sobre = true; });
    raiz.addEventListener("mouseleave", function () { sobre = false; });
    raiz.addEventListener("focusin", function (e) {
      var porTeclado = true;
      try { porTeclado = e.target.matches(":focus-visible"); } catch (err) {}
      focoTeclado = porTeclado;
    });
    raiz.addEventListener("focusout", function (e) {
      if (!raiz.contains(e.relatedTarget)) focoTeclado = false;
    });

    actualizarPlay();
    ir(0);

    setInterval(function () {
      if (!reproduciendo || document.hidden || !estaVisible(raiz)) return;
      if (focoTeclado || (sobre && !reproduccionExplicita)) return;
      transcurrido += PASO;
      if (transcurrido >= intervalo) ir((actual + 1) % tabs.length);
      else pintarProgreso();
    }, PASO);
  }

  $$("[data-rotador]").forEach(rotador);

  /* ---------- Planes: mensual / anual ---------- */

  $$("[data-planes]").forEach(function (seccion) {
    var lista = seccion.querySelector('[role="tablist"]');
    var tabs = tablist(lista, function (i) {
      marcar(tabs, i);
      var periodo = tabs[i].getAttribute("data-periodo");
      $$("[data-mensual]", seccion).forEach(function (el) {
        el.textContent = el.getAttribute("data-" + periodo);
        // Destello breve del monto que cambió.
        el.classList.remove("destello"); void el.offsetWidth; el.classList.add("destello");
      });
    });
  });

  /* ---------- Elementos «en vivo» (datos de ejemplo que se mueven) ---------- */

  var t = 0;
  var pad = function (n) { return String(n).padStart(2, "0"); };
  var nuevos = [
    { titulo: "Cambio de clave de correo", mesa: "Portal · Mesa Accesos" },
    { titulo: "Pantalla parpadea en caja 3", mesa: "App móvil · Mesa Soporte" },
    { titulo: "Solicitud de licencia de software", mesa: "Portal · Mesa Licencias" },
    { titulo: "Sin conexión a internet en bodega", mesa: "App móvil · Mesa Redes" }
  ];
  var avisos = [
    "Nuevo ticket asignado: caja 3",
    "Activo NB-0158 registrado",
    "Tarea completada: Instalar cajas",
    "SLA en riesgo: impresora Centro"
  ];

  function reanimar(el, clase) {
    el.classList.remove(clase);
    void el.offsetWidth; // fuerza el reinicio de la animación
    el.classList.add(clase);
  }

  function refrescarVivos(raiz) {
    $$("[data-vivo]", raiz).forEach(function (el) { pintarVivo(el, false); });
  }

  function pintarVivo(el, avanza) {
    var tipo = el.getAttribute("data-vivo");
    if (tipo === "abiertos") el.textContent = [42, 43, 43, 41, 42, 44][t % 6];
    else if (tipo === "sin-asignar") el.textContent = [6, 7, 6, 5, 6, 7][t % 6];
    else if (tipo === "sla") {
      var resta = 3540 - (t % 3540);
      el.textContent = "en " + pad(Math.floor(resta / 3600)) + ":" + pad(Math.floor((resta % 3600) / 60)) + ":" + pad(resta % 60);
    } else if (tipo === "avance") el.style.width = (40 + (t % 30) * 2) + "%";
    else if (tipo === "nuevo" && avanza && t % 3 === 0) {
      var n = nuevos[Math.floor(t / 3) % nuevos.length];
      el.querySelector('[data-campo="titulo"]').textContent = n.titulo;
      el.querySelector('[data-campo="mesa"]').textContent = n.mesa;
      reanimar(el, "in");
    } else if (tipo === "aviso" && avanza && t % 4 === 0) {
      el.querySelector("b").textContent = avisos[Math.floor(t / 4) % avisos.length];
      reanimar(el, "mostrar");
    }
  }

  if (!reducido) {
    var vivos = $$("[data-vivo]");
    setInterval(function () {
      if (document.hidden) return;
      t += 1;
      vivos.forEach(function (el) {
        if (el.offsetParent === null && el.getAttribute("data-vivo") !== "aviso") return; // oculto
        if (estaVisible(el)) pintarVivo(el, true);
      });
    }, 1000);
  }

  /* ---------- Formulario de demo ---------- */

  var cargada = Date.now(); // para descartar envíos instantáneos (bots)
  var form = document.getElementById("form-demo");
  if (form) {
    var correoValido = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    var mensaje = form.querySelector(".mensaje-form");
    var boton = form.querySelector('button[type="submit"]');

    // Los botones de los planes preseleccionan el interés.
    $$("a[data-interes]").forEach(function (a) {
      a.addEventListener("click", function () { form.elements.interes.value = a.getAttribute("data-interes"); });
    });

    var marcarError = function (campo, texto) {
      var err = document.getElementById("e-" + campo.name);
      campo.setAttribute("aria-invalid", texto ? "true" : "false");
      if (err) err.textContent = texto || "";
    };

    var validar = function () {
      var ok = true, primero = null;
      [["nombre", "Escribe tu nombre."], ["empresa", "Escribe el nombre de tu empresa."]].forEach(function (par) {
        var c = form.elements[par[0]];
        var vacio = !c.value.trim();
        marcarError(c, vacio ? par[1] : "");
        if (vacio) { ok = false; primero = primero || c; }
      });
      var correo = form.elements.correo;
      var v = correo.value.trim();
      var textoCorreo = !v ? "Escribe tu correo." : !correoValido.test(v) ? "Revisa el correo: parece incompleto." : "";
      marcarError(correo, textoCorreo);
      if (textoCorreo) { ok = false; primero = primero || correo; }
      if (primero) primero.focus();
      return ok;
    };

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      mensaje.textContent = "";
      mensaje.classList.remove("mal");
      if (!validar()) return;
      boton.disabled = true;
      boton.textContent = "Enviando…";
      var datos = {};
      new FormData(form).forEach(function (v, k) { datos[k] = String(v).trim(); });
      datos.espera = Date.now() - cargada;
      fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(datos)
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (res) {
          if (!r.ok) { var err = new Error(res.error || "HTTP " + r.status); err.servidor = res; throw err; }
          form.hidden = true;
          var ok = document.getElementById("demo-ok");
          ok.hidden = false;
          ok.focus();
        });
      }).catch(function (err) {
        var res = err.servidor || {};
        if (res.campo && form.elements[res.campo]) {
          marcarError(form.elements[res.campo], res.error);
          form.elements[res.campo].focus();
        } else {
          mensaje.classList.add("mal");
          mensaje.innerHTML = (res.error ? res.error.replace(/[<>&]/g, "") + " " : "No pudimos enviar la solicitud. ") +
            'Si el problema sigue, escríbenos a <a href="mailto:ventas@briodesk.cl" style="color:#fff">ventas@briodesk.cl</a>.';
        }
        boton.disabled = false;
        boton.textContent = "Solicitar demostración";
      });
    });

    ["nombre", "empresa", "correo"].forEach(function (n) {
      form.elements[n].addEventListener("input", function () {
        if (this.getAttribute("aria-invalid") === "true") marcarError(this, "");
      });
    });
  }
})();
