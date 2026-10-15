/* BríoDesk — página Ingresar: lleva al subdominio de la empresa o permite solicitar uno. */
(function () {
  "use strict";

  var VALIDO = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  var VALIDO_INGRESO = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.demo)?$/; // también acepta demos prestados

  // Acepta «acme», «acme.briodesk.cl» o «https://acme.briodesk.cl/...».
  function normalizar(texto) {
    var v = String(texto || "").trim().toLowerCase();
    v = v.replace(/^[a-z]+:\/\//, "").split(/[\/?#]/)[0];
    v = v.replace(/\.briodesk\.cl\.?$/, "");
    return v;
  }

  var correoValido = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var cargada = Date.now(); // para descartar envíos instantáneos (bots)

  /* ---------- Ir al subdominio ---------- */

  var form = document.getElementById("form-ingresar");
  if (form) {
    var input = form.elements.subdominio;
    var error = document.getElementById("sub-error");
    var boton = form.querySelector('button[type="submit"]');

    var fallar = function (texto, ofrecerSolicitud) {
      input.setAttribute("aria-invalid", "true");
      error.innerHTML = texto + (ofrecerSolicitud ? ' <a href="#solicitar">Solicítala aquí.</a>' : "");
      boton.disabled = false;
      boton.textContent = "Ingresar";
      input.focus();
    };

    input.addEventListener("input", function () {
      input.removeAttribute("aria-invalid");
      error.textContent = "";
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var sub = normalizar(input.value);
      if (!sub) return fallar("Escribe la dirección de tu empresa.");
      if (!VALIDO_INGRESO.test(sub)) return fallar("Usa solo letras, números y guiones, sin espacios.");
      boton.disabled = true;
      boton.textContent = "Buscando…";
      var destino = "https://" + sub + ".briodesk.cl/";
      fetch("/api/subdominio/" + encodeURIComponent(sub), { headers: { Accept: "application/json" } })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (res) {
          if (res.existe !== false) window.location.href = destino;
          else fallar("No encontramos <b>" + sub + ".briodesk.cl</b>. Revisa cómo se escribe o, si tu empresa aún no tiene dirección,", true);
        })
        .catch(function () {
          // Sin verificación disponible, se intenta igual: el navegador mostrará si no existe.
          window.location.href = destino;
        });
    });
  }

  /* ---------- Solicitar un subdominio ---------- */

  var sol = document.getElementById("form-subdominio");
  if (sol) {
    var msj = sol.querySelector(".error-claro");
    var btn = sol.querySelector('button[type="submit"]');
    var campoSub = sol.elements.subdominio;

    // Si viene desde un intento fallido, se propone la misma dirección.
    document.addEventListener("click", function (e) {
      if (e.target.closest('a[href="#solicitar"]') && form) {
        var v = normalizar(form.elements.subdominio.value);
        if (v && !campoSub.value) campoSub.value = v;
      }
    });

    sol.addEventListener("submit", function (e) {
      e.preventDefault();
      var problemas = [];
      var primero = null;
      var revisar = function (campo, ok, texto) {
        campo.setAttribute("aria-invalid", ok ? "false" : "true");
        if (!ok) { problemas.push(texto); primero = primero || campo; }
      };
      revisar(sol.elements.empresa, !!sol.elements.empresa.value.trim(), "Escribe el nombre de tu empresa.");
      revisar(sol.elements.nombre, !!sol.elements.nombre.value.trim(), "Escribe tu nombre.");
      revisar(sol.elements.correo, correoValido.test(sol.elements.correo.value.trim()), "Revisa el correo.");
      var sub = normalizar(campoSub.value);
      revisar(campoSub, VALIDO.test(sub), "La dirección solo puede tener letras, números y guiones.");
      msj.textContent = problemas.join(" ");
      if (primero) { primero.focus(); return; }

      btn.disabled = true;
      btn.textContent = "Enviando…";
      var datos = {};
      new FormData(sol).forEach(function (v, k) { datos[k] = String(v).trim(); });
      datos.subdominio = sub;
      datos.espera = Date.now() - cargada;
      fetch(sol.action, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(datos)
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (res) {
          if (!r.ok) { var err = new Error(res.error || "HTTP " + r.status); err.servidor = res; throw err; }
          sol.hidden = true;
          var ok = document.getElementById("subdominio-ok");
          ok.hidden = false;
          ok.focus();
        });
      }).catch(function (err) {
        var res = err.servidor || {};
        if (res.campo && sol.elements[res.campo]) {
          sol.elements[res.campo].setAttribute("aria-invalid", "true");
          sol.elements[res.campo].focus();
        }
        msj.innerHTML = res.error ? res.error.replace(/[<>&]/g, "")
          : 'No pudimos enviar la solicitud. Inténtalo de nuevo o escríbenos a <a href="mailto:ventas@briodesk.cl">ventas@briodesk.cl</a>.';
        btn.disabled = false;
        btn.textContent = "Solicitar dirección";
      });
    });
  }
})();
