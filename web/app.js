/* Raíz NL — dona un árbol donde más ayuda (agua o aire). Sin build: Leaflet global + este archivo. */
(function () {
  'use strict';

  const ARCHIVOS = {
    zonas: 'zonas.geojson',
    incendios: 'incendios.geojson',
    presas: 'presas.geojson',
    estaciones: 'estaciones.geojson',
    cuencas: 'cuencas.geojson',
    resumen: 'resumen.json'
  };
  const STORAGE_KEY = 'raiznl.compromisos.v1';
  // API de donaciones (backend/). ?api=URL la fuerza; en localhost se busca en el puerto 8001.
  // Sin API, el portal sigue funcionando con compromisos guardados en el navegador.
  const API_BASE = (() => {
    // ?api=URL solo en desarrollo local: en el sitio publicado, un enlace con ?api= hacía que la
    // página leyera zonas, contadores y el texto a publicar desde el servidor que el enlace dijera.
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    const q = local ? new URLSearchParams(location.search).get('api') : null;
    if (q) return q.replace(/\/$/, '');
    if (window.RAIZ_API) return window.RAIZ_API;
    return ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://127.0.0.1:8001' : null;
  })();
  const PALETAS = {
    agua: ['#dbe9f8', '#a9cbef', '#6fa5de', '#3779c2', '#164f94'],
    aire: ['#fdecc8', '#f9cd86', '#f2a24b', '#d9731f', '#a24a0c']
  };
  const ACENTO = { agua: '#164f94', aire: '#a24a0c' };
  const NOTAS = {
    agua: 'Zonas de la sierra con cicatrices de incendio que escurren hacia las presas o recargan acuíferos en déficit. Los árboles tardan años; también financiamos obras de suelo (barreras de piedra y material vegetal) que ayudan a infiltrar desde el primer día.',
    aire: 'Zonas de la metrópoli donde se respira peor y hay poca copa arbórea. Un árbol no limpia el aire de toda la ciudad: ayuda donde la gente respira peor y no hay sombra.'
  };
  const ETIQUETAS = {
    incendios: 'incendios',
    ha_quemadas: 'ha quemadas',
    pm10: 'PM10 µg/m³',
    pm25: 'PM2.5 µg/m³',
    no2: 'NO₂',
    copa_pct: '% copa arbórea',
    pendiente_pct: '% pendiente',
    poblacion: 'habitantes'
  };

  const state = {
    datos: {},
    usoMock: false,
    objetivo: null,
    zonaSel: null,
    capaZonas: null,
    capasPorId: new Map(),
    contexto: {},
    memoria: [],
    apiOk: false,
    fichas: new Map(),
    arboles: 20
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }
  function fmt(n, dec) {
    const x = Number(n);
    if (!isFinite(x)) return '—';
    return x.toLocaleString('es-MX', { maximumFractionDigits: dec == null ? 0 : dec });
  }
  function colorScore(objetivo, score) {
    const pal = PALETAS[objetivo] || PALETAS.agua;
    const i = Math.max(0, Math.min(pal.length - 1, Math.floor((Number(score) || 0) / 20)));
    return pal[i];
  }
  function mezclar(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = (sh) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
    return '#' + [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('');
  }

  /* ---------- Datos: data/ si existe zonas.geojson; si no, todo desde data/mock/ ---------- */
  async function traer(url) {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      return r.ok ? await r.json() : null;
    } catch (e) {
      return null;
    }
  }
  async function cargarDatos() {
    const zonasReales = await traer('data/' + ARCHIVOS.zonas);
    const base = zonasReales ? 'data/' : 'data/mock/';
    state.usoMock = !zonasReales;
    const claves = Object.keys(ARCHIVOS).filter((k) => !(k === 'zonas' && zonasReales));
    const valores = await Promise.all(claves.map((k) => traer(base + ARCHIVOS[k])));
    claves.forEach((k, i) => { state.datos[k] = valores[i]; });
    if (zonasReales) state.datos.zonas = zonasReales;
    $('#mock-badge').hidden = !state.usoMock;
  }
  async function api(ruta, opciones) {
    const r = await fetch(API_BASE + '/api' + ruta,
      Object.assign({ headers: { 'Content-Type': 'application/json' } }, opciones || {}));
    const cuerpo = await r.json().catch(() => ({}));
    if (!r.ok) {
      const d = cuerpo.detail;
      const err = new Error(typeof d === 'string' ? d : (d && d.error) || r.statusText);
      err.status = r.status;
      throw err;
    }
    return cuerpo;
  }
  async function cargarFichas() {
    if (!API_BASE) return;
    try {
      const fichas = await api('/zonas');
      state.fichas = new Map(fichas.map((z) => [z.id, z]));
      state.apiOk = true;
    } catch (e) {
      state.apiOk = false;
    }
  }
  function zonasDe(objetivo) {
    const fs = (state.datos.zonas && state.datos.zonas.features) || [];
    // Con API, sólo se listan las zonas que la API acepta (las descartadas por cuenca no salen)
    return fs.filter((f) => f.properties && f.properties.objetivo === objetivo &&
      (!state.apiOk || state.fichas.has(f.properties.id)))
      .sort((a, b) => (a.properties.rank || 999) - (b.properties.rank || 999));
  }

  /* ---------- Compromisos (localStorage opcional) ---------- */
  function leerCompromisos() {
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      const lista = v ? JSON.parse(v) : [];
      return Array.isArray(lista) ? lista : state.memoria;
    } catch (e) {
      return state.memoria;
    }
  }
  function guardarCompromiso(c) {
    const lista = leerCompromisos().concat([c]);
    state.memoria = lista;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lista)); } catch (e) { /* sin storage: queda en memoria */ }
    document.dispatchEvent(new CustomEvent('raiznl:compromiso', { detail: lista }));
  }
  function arbolesDe(c) {
    const n = parseInt(c && c.arboles, 10);
    return n > 0 ? n : 1;
  }
  function normArboles(v) {
    const n = parseInt(v, 10);
    return n > 0 ? Math.min(n, 10000) : 1;
  }
  function textoArboles(n) {
    return n === 1 ? 'un árbol' : `${fmt(n)} árboles`;
  }

  /* ---------- Mapa ---------- */
  const map = L.map('map', { zoomControl: true }).setView([25.55, -100.15], 9);
  const bases = window.raizBases(L);
  bases['Mapa'].addTo(map);
  L.control.layers(bases, null, { position: 'topright' }).addTo(map);
  map.createPane('cuencasPane').style.zIndex = 350;
  map.createPane('puntosPane').style.zIndex = 450;

  function estiloZona(f, activa) {
    const p = f.properties;
    return {
      color: activa ? '#111' : ACENTO[p.objetivo] || '#333',
      weight: activa ? 3 : 1,
      fillColor: colorScore(p.objetivo, p.score),
      fillOpacity: activa ? 0.85 : 0.65
    };
  }

  function pintarZonas(objetivo) {
    if (state.capaZonas) map.removeLayer(state.capaZonas);
    state.capasPorId.clear();
    const fs = zonasDe(objetivo);
    state.capaZonas = L.geoJSON({ type: 'FeatureCollection', features: fs }, {
      style: (f) => estiloZona(f, false),
      onEachFeature: (f, layer) => {
        const p = f.properties;
        state.capasPorId.set(p.id, layer);
        layer.bindTooltip(`<b>#${esc(p.rank)} · ${esc(p.nombre)}</b><br>Prioridad ${fmt(p.score)}/100`, { sticky: true });
        layer.on('click', () => seleccionarZona(p.id, 'mapa'));
      }
    }).addTo(map);
    if (fs.length) map.fitBounds(state.capaZonas.getBounds(), { padding: [30, 30], maxZoom: 12 });
  }

  /* ---------- Capas de contexto ---------- */
  function crearContexto() {
    const d = state.datos;
    const incendios = (d.incendios && d.incendios.features) || [];
    const anios = incendios.map((f) => Number(f.properties.anio)).filter(isFinite);
    const aMin = Math.min.apply(null, anios.concat([2015])), aMax = Math.max.apply(null, anios.concat([2025]));
    state.contexto.incendios = L.geoJSON(d.incendios || null, {
      pane: 'puntosPane',
      pointToLayer: (f, ll) => {
        const p = f.properties;
        const t = aMax > aMin ? (Number(p.anio) - aMin) / (aMax - aMin) : 1;
        return L.circleMarker(ll, {
          pane: 'puntosPane', radius: Math.max(3, Math.min(9, Math.sqrt(Number(p.ha) || 1))),
          color: '#5a1a0a', weight: 0.5, fillColor: mezclar('#f2c2a0', '#b3200e', t), fillOpacity: 0.85
        }).bindTooltip(`Incendio ${esc(p.fecha || p.anio)} · ${esc(p.municipio)}<br>${fmt(p.ha, 1)} ha · ${esc(p.tipoveget || '')}`);
      }
    });
    state.contexto.presas = L.geoJSON(d.presas || null, {
      pane: 'puntosPane',
      pointToLayer: (f, ll) => {
        const p = f.properties;
        return L.circleMarker(ll, {
          pane: 'puntosPane', radius: 10, color: '#0d3b70', weight: 2,
          fillColor: mezclar('#dbe9f8', '#164f94', Math.min(1, (Number(p.llenado_pct) || 0) / 100)), fillOpacity: 0.95
        }).bindTooltip(`Presa ${esc(p.nombre)}: <b>${fmt(p.llenado_pct, 1)}%</b><br>${fmt(p.almacenamiento_mm3, 1)} Mm³ · ${esc(p.fecha)}`);
      }
    });
    state.contexto.estaciones = L.geoJSON(d.estaciones || null, {
      pane: 'puntosPane',
      pointToLayer: (f, ll) => {
        const p = f.properties;
        const t = Math.max(0, Math.min(1, ((Number(p.pm10) || 0) - 30) / 40));
        return L.circleMarker(ll, {
          pane: 'puntosPane', radius: 7, color: '#4a2a05', weight: 1.5,
          fillColor: mezclar('#fdecc8', '#a24a0c', t), fillOpacity: 0.95
        }).bindTooltip(`Estación ${esc(p.estacion)} (${esc(p.municipio)})<br>PM10 ${fmt(p.pm10, 1)} · PM2.5 ${fmt(p.pm25, 1)} µg/m³<br>${esc(p.periodo || '')}`);
      }
    });
    state.contexto.cuencas = L.geoJSON(d.cuencas || null, {
      pane: 'cuencasPane',
      style: { color: '#2f6b3f', weight: 1.5, dashArray: '5 4', fillColor: '#2f6b3f', fillOpacity: 0.06 },
      onEachFeature: (f, layer) => {
        const p = f.properties;
        layer.bindTooltip(`Cuenca ${esc(p.cuenca)}${p.presa_destino ? ' → presa ' + esc(p.presa_destino) : ''}`, { sticky: true });
      }
    });
    $$('.capas input[data-capa]').forEach((chk) => {
      if (chk.checked) state.contexto[chk.dataset.capa].addTo(map);
      chk.addEventListener('change', () => {
        const capa = state.contexto[chk.dataset.capa];
        if (chk.checked) capa.addTo(map); else map.removeLayer(capa);
      });
    });
  }

  /* ---------- Panel: objetivo, lista y tarjeta ---------- */
  function seleccionarObjetivo(objetivo) {
    state.objetivo = objetivo;
    state.zonaSel = null;
    document.body.classList.toggle('agua-mode', objetivo === 'agua');
    document.body.classList.toggle('aire-mode', objetivo === 'aire');
    $('#hero').hidden = true;
    $('#objetivo-switch').hidden = false;
    $$('#objetivo-switch .seg').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.objetivo === objetivo)));
    $('#vista-intro').hidden = true;
    mostrarTab('donar');
    pintarZonas(objetivo);
    pintarLista();
  }

  function pintarLista() {
    const fs = zonasDe(state.objetivo);
    $('#lista-nota').textContent = NOTAS[state.objetivo];
    const ol = $('#lista-zonas');
    if (!fs.length) {
      ol.innerHTML = '<li class="nota">Todavía no hay zonas para este objetivo.</li>';
    } else {
      ol.innerHTML = fs.map((f) => {
        const p = f.properties;
        const razon = (p.razones && p.razones[0]) || '';
        return `<li><button class="zona-item" data-id="${esc(p.id)}">
          <span class="zona-rank">${esc(p.rank)}</span>
          <span class="zona-nombre">${esc(p.nombre)}</span>
          <span class="score"><span class="score-bar"><span style="width:${Math.max(0, Math.min(100, Number(p.score) || 0))}%"></span></span>${fmt(p.score)}</span>
          <span class="zona-razon">${esc(razon)}</span>
        </button></li>`;
      }).join('');
      $$('#lista-zonas .zona-item').forEach((b) => b.addEventListener('click', () => seleccionarZona(b.dataset.id, 'lista')));
    }
    $('#vista-lista').hidden = false;
    $('#vista-zona').hidden = true;
  }

  function buscarZona(id) {
    const fs = (state.datos.zonas && state.datos.zonas.features) || [];
    return fs.find((f) => f.properties.id === id) || null;
  }

  function seleccionarZona(id, origen) {
    const f = buscarZona(id);
    if (!f) return;
    if (state.zonaSel && state.capasPorId.has(state.zonaSel)) {
      const prev = state.capasPorId.get(state.zonaSel);
      prev.setStyle(estiloZona(prev.feature, false));
    }
    state.zonaSel = id;
    const layer = state.capasPorId.get(id);
    if (layer) {
      layer.setStyle(estiloZona(f, true));
      layer.bringToFront();
      map.fitBounds(layer.getBounds(), { padding: [60, 60], maxZoom: 13 });
    }
    $$('#lista-zonas .zona-item').forEach((b) => b.setAttribute('aria-current', String(b.dataset.id === id)));
    pintarTarjeta(f);
    if (origen === 'mapa' && window.innerWidth < 900) $('.panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function pintarTarjeta(f) {
    const p = f.properties;
    const metricas = Object.entries(p.metricas || {}).map(([k, v]) =>
      `<div class="metrica"><b>${fmt(v, 1)}</b><span>${esc(ETIQUETAS[k] || k.replace(/_/g, ' '))}</span></div>`).join('');
    const razones = (p.razones || []).map((r) => `<li>${esc(r)}</li>`).join('');
    $('#zona-card').innerHTML = `
      <div class="score"><span class="score-bar"><span style="width:${Math.max(0, Math.min(100, Number(p.score) || 0))}%"></span></span>Prioridad ${fmt(p.score)}/100</div>
      <h2>#${esc(p.rank)} · ${esc(p.nombre)}</h2>
      <div class="meta">${esc(p.municipio)} · ${p.objetivo === 'agua' ? '💧 Agua' : '🌬️ Aire'} · ${esc(p.id)}</div>
      ${metricas ? `<div class="metricas">${metricas}</div>` : ''}
      ${bloqueFicha(p.id)}
      <h3>¿Por qué aquí?</h3>
      <ul>${razones}</ul>
      <p class="aviso">${esc(NOTAS[p.objetivo])}</p>
      <button class="btn-pri btn-ancho" id="btn-donar">🌳 Donar un árbol aquí</button>`;
    const z = state.apiOk ? state.fichas.get(p.id) : null;
    if (z && z.arboles_disponibles <= 0) {
      $('#btn-donar').disabled = true;
      $('#btn-donar').textContent = 'Esta zona ya completó su cupo';
    }
    $('#btn-donar').addEventListener('click', () => abrirDonacion(f));
    $('#vista-lista').hidden = true;
    $('#vista-zona').hidden = false;
  }

  function bloqueFicha(id) {
    const z = state.apiOk ? state.fichas.get(id) : null;
    if (!z) return '';
    const destino = z.presa_destino ? `Aporta a la presa ${esc(z.presa_destino)}`
      : z.acuifero_destino ? `Recarga del acuífero ${esc(z.acuifero_destino)}`
      : z.estacion_sima ? `Estación del SIMA más cercana: ${esc(z.estacion_sima)}` : '';
    return `<div class="metricas">
        <div class="metrica"><b>${fmt(z.arboles_disponibles)}</b><span>lugares disponibles de ${fmt(z.arboles_caben)}</span></div>
        <div class="metrica"><b>${fmt(z.arboles_donados)}</b><span>árboles donados</span></div>
        ${z.arboles_plantados ? `<div class="metrica"><b>${fmt(z.arboles_plantados)}</b><span>plantados</span></div>` : ''}
      </div>
      <p class="meta">${destino}${destino ? ' · ' : ''}Planta: ${esc(z.operador)}</p>`;
  }

  /* ---------- Donación + publicación en X ---------- */
  function limpiarUsuario(v) {
    const u = String(v || '').trim().replace(/^@+/, '');
    return /^[A-Za-z0-9_]{1,15}$/.test(u) ? u : '';
  }

  // Plantillas de Contexto_Arbol.md. Con API, el texto lo arma el backend (backend/app/textos.py).
  function textoLocal(p, n) {
    const donaron = 'Donaron ' + textoArboles(n || 1);
    const corto = String(p.nombre).split('·').pop().split('→')[0].trim();
    const todo = [p.nombre].concat(p.razones || []).join(' ; ');
    if (p.objetivo === 'agua') {
      const presa = (todo.match(/presa\s+(El Cuchillo|La Boca|Cerro Prieto)/i) || [])[1];
      const acuifero = (todo.match(/acuífero en déficit:\s*([^;.,]+)/i) || [])[1];
      if (presa) return `${donaron} para restaurar ${corto}, cuenca que aporta a ${presa}.`;
      if (acuifero) return `${donaron} para restaurar ${corto}, zona de recarga del acuífero ${acuifero.trim()}.`;
      return `${donaron} para restaurar ${corto}.`;
    }
    const est = (todo.match(/estación\s+([A-ZÁÉÍÓÚÑ0-9 ]+?)(?:\)|$|\s*·|,)/) || [])[1];
    const lugar = est
      ? `los alrededores de la estación ${est.trim().toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())} del SIMA`
      : corto;
    return `${donaron} para arbolado en ${lugar}, una zona de ${p.municipio} con poca sombra y mala calidad del aire.`;
  }
  function textoX(f, usuario, etiquetar, n) {
    const z = state.apiOk ? state.fichas.get(f.properties.id) : null;
    const base = (z && (n || 1) === 1 && z.texto_ejemplo) || textoLocal(f.properties, n);
    return base + (etiquetar && usuario ? ' @' + usuario : '');
  }

  const dlg = $('#dlg-donar');
  const form = $('#form-donar');
  let zonaDonacion = null;

  function abrirDonacion(f) {
    zonaDonacion = f;
    form.reset();
    const ficha = state.apiOk ? state.fichas.get(f.properties.id) : null;
    form.arboles.value = ficha && ficha.arboles_disponibles > 0 ? Math.min(state.arboles, ficha.arboles_disponibles) : state.arboles;
    form.etiquetar.disabled = true;
    try { form.equipo.value = window.localStorage.getItem('raiznl.equipo.v1') || ''; } catch (e) { /* sin storage */ }
    form.hidden = false;
    $('#dlg-gracias').hidden = true;
    $('#dlg-zona').textContent = `${f.properties.nombre} (${f.properties.objetivo === 'agua' ? '💧 Agua' : '🌬️ Aire'})`;
    $('#dlg-error').hidden = true;
    $('#btn-confirmar').disabled = false;
    $('#campo-publicar').hidden = !state.apiOk;
    if (window.RaizCheckout) window.RaizCheckout.abrir(f);
    actualizarVistaPrevia();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    form.nombre.focus();
  }
  function cerrarDialogo() {
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
  }

  function actualizarVistaPrevia() {
    if (!zonaDonacion) return;
    const usuario = limpiarUsuario(form.usuario.value);
    $('#dlg-titulo').textContent = 'Donar ' + textoArboles(normArboles(form.arboles.value));
    $('#dlg-texto').textContent = textoX(zonaDonacion, usuario, !!usuario && form.etiquetar.checked, normArboles(form.arboles.value));
  }
  form.usuario.addEventListener('input', () => {
    const valido = !!limpiarUsuario(form.usuario.value);
    form.etiquetar.disabled = !valido;
    if (!valido) form.etiquetar.checked = false;
    actualizarVistaPrevia();
  });
  form.etiquetar.addEventListener('change', actualizarVistaPrevia);
  form.arboles.addEventListener('input', actualizarVistaPrevia);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!zonaDonacion) return;
    const p = zonaDonacion.properties;
    const usuario = limpiarUsuario(form.usuario.value);
    const etiquetar = !!usuario && form.etiquetar.checked;
    const publicar = state.apiOk && form.publicar.checked;
    const arboles = normArboles(form.arboles.value);
    let texto = textoX(zonaDonacion, usuario, etiquetar, arboles);
    let estadoPost = '';
    $('#btn-confirmar').disabled = true;
    if (window.RaizCheckout) await window.RaizCheckout.pagar();
    if (state.apiOk) {
      $('#btn-confirmar').disabled = true;
      try {
        const cuerpo = { zona_id: p.id, n_arboles: arboles, publicar, etiquetar, handle_x: etiquetar ? usuario : null };
        const d = await api('/donaciones', { method: 'POST', body: JSON.stringify(cuerpo) });
        texto = d.texto_propuesto;
        const c = await api(`/donaciones/${d.id}/confirmar`, { method: 'POST',
          body: JSON.stringify({ texto_confirmado: d.texto_propuesto, publicar, etiquetar, handle_x: etiquetar ? usuario : null }) });
        if (c.publicacion && c.publicacion.ok) estadoPost = 'Ya se publicó en la cuenta de Raíz NL.';
        else if (c.publicacion && c.publicacion.pendiente) estadoPost = 'Tu texto quedó en la cola para publicarse en la cuenta de Raíz NL.';
        else if (c.publicacion) estadoPost = 'No se pudo publicar en este momento; tu donación sí quedó registrada.';
        await cargarFichas();
      } catch (err) {
        $('#dlg-error').textContent = err.status === 409 ? 'Esta zona ya completó su cupo. Elige otra zona.'
          : 'No se pudo registrar la donación: ' + err.message;
        $('#dlg-error').hidden = false;
        $('#btn-confirmar').disabled = false;
        if (window.RaizCheckout) window.RaizCheckout.cancelarPago();
        return;
      }
    }
    const idCompromiso = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    guardarCompromiso({
      id: idCompromiso,
      zona: p.id, objetivo: p.objetivo, municipio: p.municipio,
      fecha: new Date().toISOString(),
      nombre: form.nombre.value.trim() || null,
      mensaje: form.mensaje.value.trim() || null,
      arboles, zona_nombre: p.nombre,
      usuario: usuario || null, etiquetar,
      equipo: form.equipo.value.trim() || null,
      municipio_donador: form.municipio_donador.value || null
    });
    $('#btn-x').href = 'https://x.com/intent/post?text=' + encodeURIComponent(texto);
    const quien = form.nombre.value.trim();
    const plural = arboles > 1;
    const gracias = `${quien ? quien + ', ' : ''}${plural ? 'tus ' + textoArboles(arboles) + ' quedaron registrados' : 'tu árbol quedó registrado'} en ${p.nombre}. ` +
      (p.objetivo === 'agua'
        ? `${plural ? 'Ayudan' : 'Ayuda'} a sujetar el suelo y a que el agua se infiltre en una ladera que perdió su cobertura.`
        : `${plural ? 'Dan' : 'Da'} sombra y ${plural ? 'bajan' : 'baja'} el calor y el polvo cerca de donde la gente de ${p.municipio} respira peor.`) +
      (estadoPost ? ' ' + estadoPost : '');
    $('#gracias-texto').textContent = gracias.charAt(0).toUpperCase() + gracias.slice(1);
    form.hidden = true;
    $('#dlg-pagando').hidden = true;
    $('#dlg-gracias').hidden = false;
    if (window.RaizCheckout) window.RaizCheckout.diploma(zonaDonacion, { id: idCompromiso, nombre: quien, arboles, equipo: form.equipo.value.trim() || null });
    if (state.zonaSel === p.id) pintarTarjeta(zonaDonacion);
    pintarTablero();
  });
  $('#btn-cancelar').addEventListener('click', cerrarDialogo);
  $('#btn-cerrar').addEventListener('click', cerrarDialogo);

  /* ---------- Tablero ---------- */
  function kpi(valor, etiqueta) {
    return `<div class="kpi"><b>${valor}</b><span>${esc(etiqueta)}</span></div>`;
  }
  function pintarTablero() {
    const r = state.datos.resumen || {};
    const nIncendios = r.incendios_total != null ? r.incendios_total : ((state.datos.incendios && state.datos.incendios.features.length) || 0);
    $('#kpis').innerHTML = [
      kpi(fmt(nIncendios), `incendios forestales${r.periodo_incendios ? ' ' + r.periodo_incendios : ''}`),
      kpi(fmt(r.ha_quemadas_total, 0), 'hectáreas quemadas'),
      kpi(fmt(r.zonas_agua != null ? r.zonas_agua : zonasDe('agua').length), 'zonas priorizadas 💧 agua'),
      kpi(fmt(r.zonas_aire != null ? r.zonas_aire : zonasDe('aire').length), 'zonas priorizadas 🌬️ aire')
    ].join('');
    const c = leerCompromisos();
    if (state.apiOk) {
      api('/resumen').then((res) => {
        const po = res.por_objetivo || {};
        $('#kpis-donaciones').innerHTML = [
          kpi(fmt((po.agua || {}).donados || 0), 'árboles donados 💧 agua'),
          kpi(fmt((po.aire || {}).donados || 0), 'árboles donados 🌬️ aire'),
          kpi(fmt(res.plantados || 0), 'plantados')
        ].concat(res.vivos_12m != null ? [kpi(fmt(res.vivos_12m), 'vivos a 12 meses')] : []).join('');
        $('#titulo-donaciones').textContent = 'Donaciones registradas';
      }).catch(() => {});
    }
    $('#kpis-donaciones').innerHTML = [
      kpi(fmt(c.filter((x) => x.objetivo === 'agua').reduce((s, x) => s + arbolesDe(x), 0)), 'árboles para agua'),
      kpi(fmt(c.filter((x) => x.objetivo === 'aire').reduce((s, x) => s + arbolesDe(x), 0)), 'árboles para aire')
    ].join('');
    $('#fuentes').innerHTML = (r.fuentes || []).map((s) =>
      `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.nombre)}</a>${s.fecha ? ' · ' + esc(s.fecha) : ''}</li>`).join('') ||
      '<li>Sin fuentes registradas.</li>';
    $('#generado').textContent = (r.generado ? `Datos generados: ${r.generado.slice(0, 10)}.` : '') +
      (state.usoMock ? ' Estás viendo datos de ejemplo: corre el pipeline para generar web/data/.' : '');
  }

  function mostrarTab(nombre) {
    ['donar', 'tablero'].forEach((t) => {
      $('#tab-' + t).setAttribute('aria-selected', String(t === nombre));
      $('#panel-' + t).hidden = t !== nombre;
    });
    if (nombre === 'tablero') pintarTablero();
  }

  /* ---------- Arranque ---------- */
  $$('[data-objetivo]').forEach((b) => b.addEventListener('click', () => seleccionarObjetivo(b.dataset.objetivo)));
  $('#btn-volver').addEventListener('click', () => {
    if (state.zonaSel && state.capasPorId.has(state.zonaSel)) {
      const l = state.capasPorId.get(state.zonaSel);
      l.setStyle(estiloZona(l.feature, false));
    }
    state.zonaSel = null;
    pintarLista();
    if (state.capaZonas && state.capaZonas.getLayers().length) map.fitBounds(state.capaZonas.getBounds(), { padding: [30, 30], maxZoom: 12 });
  });
  $('#tab-donar').addEventListener('click', () => mostrarTab('donar'));

  /* Tarjeta "Únete": objetivo y número de árboles, luego al mapa */
  let objetivoCard = 'agua';
  $$('[data-card-objetivo]').forEach((b) => b.addEventListener('click', () => {
    objetivoCard = b.dataset.cardObjetivo;
    $$('[data-card-objetivo]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  $$('.monto').forEach((b) => b.addEventListener('click', () => {
    state.arboles = normArboles(b.dataset.arboles);
    $('#monto-otro').value = '';
    $$('.monto').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  $('#monto-otro').addEventListener('input', (e) => {
    if (!e.target.value) return;
    state.arboles = normArboles(e.target.value);
    $$('.monto').forEach((x) => x.setAttribute('aria-pressed', String(Number(x.dataset.arboles) === state.arboles)));
  });
  // El mapa de «Dónde plantamos» es mapa.html incrustado: le decimos el objetivo y él nos pide abrir la donación
  const iframeMapa = () => document.querySelector('#mapa iframe');
  $('#btn-siguiente').addEventListener('click', () => {
    $('#mapa').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const fr = iframeMapa();
    if (fr && fr.contentWindow) fr.contentWindow.postMessage({ raiz: 'objetivo', objetivo: objetivoCard }, location.origin);
  });
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || e.data.raiz !== 'donar') return;
    const f = buscarZona(e.data.id);
    if (f) abrirDonacion(f);
  });
  $('#tab-tablero').addEventListener('click', () => mostrarTab('tablero'));

  Promise.all([cargarDatos(), cargarFichas()]).then(() => {
    const zonaUrl = new URLSearchParams(location.search).get('zona');
    if (zonaUrl && buscarZona(zonaUrl)) setTimeout(() => abrirDonacion(buscarZona(zonaUrl)), 300);
    crearContexto();
    pintarTablero();
    setTimeout(() => map.invalidateSize(), 0);
  });
})();
