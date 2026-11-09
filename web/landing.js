(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var STORAGE_KEY = 'raiznl.compromisos.v1';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var orden = 'recientes';
  var mostrado = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function arboles(c) { var n = parseInt(c && c.arboles, 10); return n > 0 ? n : 1; }
  function leer() {
    try {
      var lista = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(lista) ? lista : [];
    } catch (e) { return []; }
  }

  /* Contador del hero: suma de árboles comprometidos */
  function pintarContador(lista) {
    var total = lista.reduce(function (s, c) { return s + arboles(c); }, 0);
    var el = $('contador');
    var desde = mostrado;
    mostrado = total;
    if (reduce || total === desde) { el.textContent = total.toLocaleString('es-MX'); return; }
    var t0 = performance.now();
    (function paso(t) {
      var p = Math.min((t - t0) / 1200, 1);
      el.textContent = Math.round(desde + (total - desde) * p).toLocaleString('es-MX');
      if (p < 1) requestAnimationFrame(paso);
    })(t0);
  }

  /* Ranking */
  /* Ejemplos para el demo: se muestran en el ranking marcados como «ejemplo» y no cuentan en el contador */
  var EJEMPLOS_RANKING = [
    { nombre: 'Mariana T.', mensaje: '¡Por la sierra que nos da agua!', arboles: 120, objetivo: 'agua', equipo: 'Tec de Monterrey', municipio_donador: 'Monterrey', zona_nombre: 'Santiago · ladera quemada que drena a La Boca', fecha: '2026-10-14T19:05:00Z' },
    { nombre: 'Equipo Tigres Verdes', mensaje: 'Somos UANL 🐯', arboles: 200, objetivo: 'agua', equipo: 'UANL', municipio_donador: 'San Nicolás de los Garza', zona_nombre: 'Montemorelos · una ladera quemada cerca de Rayones', fecha: '2026-10-14T18:40:00Z' },
    { nombre: 'Sofía R.', mensaje: 'Sombra para García', arboles: 50, objetivo: 'aire', equipo: 'UDEM', municipio_donador: 'San Pedro Garza García', zona_nombre: 'García · alrededor de estación NOROESTE 2', fecha: '2026-10-14T18:22:00Z' },
    { nombre: 'Don Chuy', mensaje: 'Para mis nietos', arboles: 20, objetivo: 'aire', municipio_donador: 'Guadalupe', zona_nombre: 'Guadalupe · alrededor de estación SURESTE', fecha: '2026-10-14T17:58:00Z' },
    { nombre: 'Andrea G.', arboles: 75, objetivo: 'agua', equipo: 'Tec de Monterrey', municipio_donador: 'San Pedro Garza García', zona_nombre: 'Galeana · ladera quemada en la Sierra Madre', fecha: '2026-10-14T17:31:00Z' },
    { nombre: 'Luis P.', mensaje: 'Viva Pesquería', arboles: 30, objetivo: 'aire', equipo: 'UANL', municipio_donador: 'Pesquería', zona_nombre: 'Pesquería · alrededor de estación ESTE', fecha: '2026-10-14T17:10:00Z' },
    { nombre: 'Familia Garza', arboles: 100, objetivo: 'agua', equipo: 'UDEM', municipio_donador: 'Monterrey', zona_nombre: 'Linares · ladera que aporta a Cerro Prieto', fecha: '2026-10-14T16:45:00Z' },
    { nombre: 'Karla M.', mensaje: 'Apodaca respira', arboles: 15, objetivo: 'aire', municipio_donador: 'Apodaca', zona_nombre: 'Apodaca · alrededor de estación NORESTE 2', fecha: '2026-10-14T16:20:00Z' },
    { nombre: 'Rodrigo V.', arboles: 40, objetivo: 'agua', equipo: 'Tec de Monterrey', municipio_donador: 'Santa Catarina', zona_nombre: 'Santa Catarina · cañón con cicatriz de incendio', fecha: '2026-10-14T15:55:00Z' },
    { nombre: 'Paty E.', mensaje: 'Por el aire de Juárez', arboles: 25, objetivo: 'aire', equipo: 'UANL', municipio_donador: 'Juárez', zona_nombre: 'Juárez · alrededor de estación SURESTE 2', fecha: '2026-10-14T15:30:00Z' },
    { nombre: 'Memo C.', arboles: 10, objetivo: 'agua', municipio_donador: 'General Escobedo', zona_nombre: 'Santiago · cuenca del río Ramos', fecha: '2026-10-14T15:02:00Z' }
  ].map(function (c) { c.ejemplo = true; return c; });
  function conEjemplos(lista) { return lista.concat(EJEMPLOS_RANKING); }
  function logo(nombre) { return window.raizLogo ? window.raizLogo(nombre) : null; }
  var TAG_EJEMPLO = ' <span class="tag-ejemplo">ejemplo</span>';

  /* Ranking por grupo: municipio de quien dona o equipo */
  function agrupar(lista, clave) {
    var m = {};
    lista.forEach(function (c) {
      var t = String(c[clave] || '').trim();
      if (!t) return;
      var k = t.toLowerCase();
      if (!m[k]) m[k] = { nombre: t, arboles: 0, personas: 0, reales: 0 };
      m[k].arboles += arboles(c);
      m[k].personas += 1;
      if (!c.ejemplo) m[k].reales += 1;
    });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.arboles - a.arboles; });
  }
  function pintarGrupos(lista, clave) {
    var grupos = agrupar(lista, clave).slice(0, 10);
    var ol = $('rank-lista');
    if (!grupos.length) {
      ol.innerHTML = '<li class="rank-vacio">' + (clave === 'equipo'
        ? 'Todavía no hay equipos. <a href="#equipos">Arma el primero</a> con tu escuela, empresa o colonia.'
        : 'Todavía nadie dice de qué municipio es. Al donar, elige el tuyo y pon a tu municipio en el mapa.') + '</li>';
      return;
    }
    var max = grupos[0].arboles;
    ol.innerHTML = grupos.map(function (g, i) {
      var medalla = ['🥇', '🥈', '🥉'][i] || String(i + 1);
      var img = clave === 'equipo' ? logo(g.nombre) : null;
      return '<li class="rank-item rank-grupo">' +
        (img ? '<img class="rank-icono rank-logo" src="' + img + '" alt="">' : '<span class="rank-icono" aria-hidden="true">' + (clave === 'equipo' ? '👥' : '📍') + '</span>') +
        '<div class="rank-texto"><div class="rank-nombre"><span class="rank-medalla">' + medalla + '</span> ' + esc(g.nombre) + (g.reales ? '' : TAG_EJEMPLO) + '</div>' +
        '<span class="rank-barra"><span style="width:' + Math.max(4, Math.round(100 * g.arboles / max)) + '%"></span></span>' +
        '<p class="rank-fecha">' + g.personas + (g.personas === 1 ? ' persona' : ' personas') + '</p></div>' +
        '<span class="rank-arboles">' + g.arboles.toLocaleString('es-MX') + (g.arboles === 1 ? ' árbol' : ' árboles') + '</span></li>';
    }).join('');
  }

  function pintarRanking(lista) {
    lista = conEjemplos(lista);
    if (orden === 'municipios') return pintarGrupos(lista, 'municipio_donador');
    if (orden === 'equipos') return pintarGrupos(lista, 'equipo');
    var items = lista.slice();
    if (orden === 'arboles') items.sort(function (a, b) { return arboles(b) - arboles(a); });
    else items.sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); });
    items = items.slice(0, 10);
    var ol = $('rank-lista');
    if (!items.length) {
      ol.innerHTML = '<li class="rank-vacio">Todavía no hay compromisos. ¡Sé la primera persona en plantar!</li>';
      return;
    }
    ol.innerHTML = items.map(function (c) {
      var n = arboles(c);
      var nombre = c.nombre || (c.usuario ? '@' + c.usuario : 'Anónimo');
      var fecha = c.fecha ? new Date(c.fecha).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '';
      var donde = [c.equipo ? 'Equipo ' + c.equipo : '', c.zona_nombre || c.municipio || ''].filter(Boolean).join(' · ');
      return '<li class="rank-item">' +
        '<span class="rank-icono" aria-hidden="true">' + (c.objetivo === 'aire' ? '🌬️' : '💧') + '</span>' +
        '<div class="rank-texto"><div class="rank-nombre">' + esc(nombre) + (c.ejemplo ? TAG_EJEMPLO : '') + '</div>' +
        (c.mensaje ? '<p class="rank-mensaje">' + esc(c.mensaje) + '</p>' : '') +
        '<p class="rank-fecha">' + esc([donde, fecha].filter(Boolean).join(' · ')) + '</p></div>' +
        '<span class="rank-arboles">' + n.toLocaleString('es-MX') + (n === 1 ? ' árbol' : ' árboles') + '</span></li>';
    }).join('');
  }

  Array.prototype.forEach.call(document.querySelectorAll('.rank-tab'), function (b, _, todos) {
    b.addEventListener('click', function () {
      orden = b.getAttribute('data-orden');
      Array.prototype.forEach.call(todos, function (x) { x.setAttribute('aria-selected', String(x === b)); });
      pintarRanking(leer());
    });
  });

  // Con la API de donaciones (backend/), el contador es el total real de árboles donados
  var api = (function () {
    // ?api=URL solo en desarrollo local (ver app.js).
    var local = ['localhost', '127.0.0.1'].indexOf(location.hostname) !== -1;
    var q = local ? new URLSearchParams(location.search).get('api') : null;
    if (q) return q.replace(/\/$/, '');
    if (window.RAIZ_API) return window.RAIZ_API;
    return ['localhost', '127.0.0.1'].indexOf(location.hostname) >= 0 ? 'http://127.0.0.1:8001' : null;
  })();
  /* Tira deslizante del hero: ejemplos del demo + compromisos reales de este navegador */
  var EJEMPLOS = [
    { foto: 'img/donadores/d1.jpg', pos: 'center 15%', arboles: 250 },
    { foto: 'img/donadores/d2.jpg', pos: 'center 35%', arboles: 100 },
    { foto: 'img/donadores/d3.png', pos: 'center 25%', arboles: 500 },
    { foto: 'img/donadores/d4.png', pos: 'center 40%', arboles: 50 },
    { foto: 'img/donadores/d5.png', pos: '60% 30%', arboles: 150 },
    { foto: 'img/donadores/d6.avif', pos: 'center 30%', arboles: 75 }
  ];
  function iniciales(c) {
    var t = String(c.nombre || c.usuario || '').trim();
    if (!t) return '🌳';
    var p = t.replace(/^@/, '').split(/\s+/);
    return ((p[0] || '')[0] + ((p[1] || '')[0] || '')).toUpperCase();
  }
  function pintarDonadores(lista) {
    var reales = lista.slice().sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); }).slice(0, 12);
    function cuenta(n) { return n.toLocaleString('es-MX') + ' <small>' + (n === 1 ? 'árbol' : 'árboles') + '</small>'; }
    var items = reales.map(function (c) {
      var nombre = c.nombre || (c.usuario ? '@' + c.usuario : 'Anónimo');
      return '<li class="donador donador-real"><span class="donador-foto">' + esc(iniciales(c)) + '</span>' +
        '<span class="donador-arboles"><span class="donador-nombre">' + esc(nombre) + '</span>' + cuenta(arboles(c)) + '</span></li>';
    }).concat(EJEMPLOS.map(function (d) {
      return '<li class="donador"><img class="donador-foto" src="' + d.foto + '" alt="" style="object-position:' + d.pos + '" loading="lazy">' +
        '<span class="donador-arboles">' + cuenta(d.arboles) + '</span></li>';
    }));
    // Se repite la lista para que el loop no tenga hueco (la animación mueve -50%)
    while (items.length < 8) items = items.concat(items);
    var pista = $('donadores-pista');
    pista.innerHTML = items.concat(items.map(function (h) { return h.replace('<li ', '<li aria-hidden="true" '); })).join('');
    pista.style.setProperty('--dur', (items.length * 4) + 's');
  }

  function pintar(lista) {
    pintarDonadores(lista);
    pintarRanking(lista);
    if (!api) { pintarContador(lista); return; }
    fetch(api + '/api/resumen').then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (r) { pintarContador([{ arboles: r.donados }].filter(function () { return r.donados > 0; })); })
      .catch(function () { pintarContador(lista); });
  }
  pintar(leer());
  document.addEventListener('raiznl:compromiso', function (e) { pintar(e.detail || leer()); });

  /* Impacto */
  function carga(url) { return fetch(url).then(function (r) { if (!r.ok) throw 0; return r.json(); }); }
  carga('data/resumen.json').catch(function () { return carga('data/mock/resumen.json'); }).then(function (r) {
    if (r.ha_quemadas_total != null) $('st-ha').textContent = Math.round(r.ha_quemadas_total).toLocaleString('es-MX');
    if (r.incendios_total != null) $('st-incendios').textContent = Number(r.incendios_total).toLocaleString('es-MX');
    if (r.zonas_agua != null) $('st-agua').textContent = r.zonas_agua;
    if (r.zonas_aire != null) $('st-aire').textContent = r.zonas_aire;
  }).catch(function () { /* se quedan los guiones */ });
})();
