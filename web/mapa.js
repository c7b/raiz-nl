/* Mapa e indicadores · Raíz NL. Lee web/data/ (pipeline/build.py) y, si está, la API de donaciones. */
(function () {
  'use strict';

  const COLOR = {
    agua: '#1d5fa8', aire: '#b4580f', fuego: '#8f2d56',
    alerta: '#fab219', alertaBorde: '#b7791f', spruce: '#113259', gris: '#9ca3af', grid: '#e5e7eb', texto: '#5b6470'
  };
  // Copa arbórea por colonia: una sola tinta, claro → oscuro (más copa)
  const VERDES = ['#e5f4e3', '#b7dfb0', '#7cc27a', '#3f9a52', '#196d4a'];
  const CORTES_COPA = [5, 10, 20, 30];
  const BOSQUE = ['bosque', 'pino', 'encino', 'oyamel', 'táscate', 'tascate'];
  const ANIO_MIN = 2005, ANIO_MAX = 2025;
  const API_BASE = (() => {
    const q = new URLSearchParams(location.search).get('api');
    if (q) return q.replace(/\/$/, '');
    if (window.RAIZ_API) return window.RAIZ_API;
    return ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://127.0.0.1:8001' : null;
  })();

  // Incrustado en «Dónde plantamos» (index.html): sin barra superior y los enlaces abren en la página principal
  const EMBEBIDO = new URLSearchParams(location.search).has('embebido');
  if (EMBEBIDO) document.documentElement.classList.add('embebido');
  const $ = (s) => document.querySelector(s);
  const fmt = (n, d) => (n == null || !isFinite(n)) ? '—'
    : Number(n).toLocaleString('es-MX', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const esBosque = (t) => BOSQUE.some((b) => String(t || '').toLowerCase().includes(b));
  const limpiaPresa = (s) => String(s || '').replace(/,\s*N\.L\.?$/, '');

  const state = { datos: {}, capas: {}, desde: ANIO_MIN, hasta: ANIO_MAX, soloBosque: false };

  async function traer(nombre) {
    try {
      const r = await fetch('data/' + nombre, { cache: 'no-cache' });
      return r.ok ? await r.json() : null;
    } catch (e) {
      return null;
    }
  }

  /* ---------- Tooltip compartido de las gráficas ---------- */
  const tip = $('#tooltip');
  function muestraTip(ev, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    const x = Math.min(ev.clientX + 14, window.innerWidth - r.width - 8);
    const y = Math.max(8, ev.clientY - r.height - 10);
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
  function ocultaTip() { tip.hidden = true; }

  /* ---------- Mapa ---------- */
  const map = L.map('mapa', { preferCanvas: true }).setView([25.05, -100.05], 8);
  const bases = window.raizBases(L);
  bases['Mapa'].addTo(map);
  L.control.layers(bases, null, { position: 'bottomleft' }).addTo(map);   // arriba a la derecha va el cuadro de capas
  const conMapTiler = !!(window.RAIZ_CONFIG || {}).maptilerKey;
  map.createPane('fondo').style.zIndex = 350;      // acuíferos, colonias y cuencas debajo de todo
  map.createPane('etiquetas').style.zIndex = 450;
  map.getPane('etiquetas').style.pointerEvents = 'none';
  // MapTiler ya trae etiquetas; con Esri se agregan encima.
  if (!conMapTiler) L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, pane: 'etiquetas' }).addTo(map);
  // Con el mapa alejado, las estaciones se ven como punto y sin número
  const marcaZoom = () => map.getContainer().classList.toggle('zoom-bajo', map.getZoom() < 10);
  map.on('zoomend', marcaZoom);
  marcaZoom();

  function popupZona(p) {
    const razones = (p.razones || []).map((r) => `<li>${esc(r)}</li>`).join('');
    const cuads = ((state.datos.cuadrantes || {}).features || []).filter((c) => c.properties.zona_id === p.id)
      .map((c) => `<li>${esc(c.properties.nombre.replace(/^Cuadrante \d+ · /, ''))}
        <span class="meta">(${c.properties.centro[0].toFixed(4)}, ${c.properties.centro[1].toFixed(4)})</span></li>`).join('');
    const prioridad = p.score != null ? `Prioridad ${fmt(p.score)}/100 · ` : '';
    return `<h3>${esc(p.nombre)}</h3>
      <div class="meta">${prioridad}${p.objetivo === 'agua' ? 'Agua' : 'Aire'} · ${esc(p.id)}</div>
      <ul>${razones}</ul>${cuads ? `<b>Cuadrantes de plantación</b><ol>${cuads}</ol>
      <button type="button" class="btn-ver-cuadrantes" data-zona="${esc(p.id)}">Ver sus cuadrantes en el mapa</button>` : ''}
      <button type="button" class="btn-donar-zona" data-zona="${esc(p.id)}">🌳 Donar un árbol aquí</button>`;
  }

  function capaZonas(objetivo) {
    const fs = state.datos.zonas.features.filter((f) => f.properties.objetivo === objetivo);
    const g = L.layerGroup();
    L.geoJSON({ type: 'FeatureCollection', features: fs }, {
      style: () => ({ color: COLOR[objetivo], weight: 2, fillColor: COLOR[objetivo], fillOpacity: 0.28 }),
      onEachFeature: (f, l) => l.bindPopup(popupZona(f.properties), { maxWidth: 320 })
    }).addTo(g);
    // Un rótulo por zona para que se vea aunque el mapa esté alejado
    fs.forEach((f) => {
      const p = f.properties;
      const icono = L.divIcon({ className: '', html: `<div class="etq-zona ${objetivo}">${p.rank}</div>`, iconSize: [22, 22],
        iconAnchor: [11, 11] });
      L.marker(p.centro, { icon: icono, title: `${p.id} · ${p.nombre}` })
        .bindTooltip(`${esc(p.id)} · ${esc(p.nombre)}`).bindPopup(popupZona(p), { maxWidth: 320 }).addTo(g);
    });
    return g;
  }

  function capaCuadrantes() {
    // Con el mapa alejado, un cuadrante de 250 m mide 1 o 2 píxeles: se dibuja además un punto en su centro
    const puntos = L.layerGroup();
    state.datos.cuadrantes.features.forEach((f) => {
      L.circleMarker(f.properties.centro, { radius: 4, color: '#ffffff', weight: 1.5, fillColor: COLOR[f.properties.objetivo],
        fillOpacity: 1 }).bindTooltip(`${esc(f.properties.id)} · ${esc(f.properties.nombre)}`).addTo(puntos);
    });
    const grupo = L.layerGroup();
    const ajusta = () => {
      if (!map.hasLayer(grupo)) return;
      if (map.getZoom() < 12) puntos.addTo(grupo); else grupo.removeLayer(puntos);
    };
    map.on('zoomend', ajusta);
    grupo.on('add', ajusta);
    cuadros(grupo);
    return grupo;
  }
  function cuadros(grupo) {
    return L.geoJSON(state.datos.cuadrantes, {
      style: (f) => ({ color: COLOR[f.properties.objetivo], weight: 2.5, fillColor: COLOR[f.properties.objetivo], fillOpacity: 0.55 }),
      onEachFeature: (f, l) => {
        const p = f.properties;
        const razones = (p.razones || []).map((r) => `<li>${esc(r)}</li>`).join('');
        l.bindPopup(`<h3>${esc(p.nombre)}</h3>
          <div class="meta">${esc(p.id)} · ${esc(p.municipio)} · ${fmt(p.area_ha, p.area_ha < 10 ? 2 : 0)} ha · prioridad ${fmt(p.score)}/100</div>
          <ul>${razones}</ul><div class="meta">Centro: ${p.centro[0].toFixed(5)}, ${p.centro[1].toFixed(5)}</div>
          <button type="button" class="btn-donar-zona" data-zona="${esc(p.zona_id)}">🌳 Donar un árbol para esta zona</button>`,
          { maxWidth: 320 });
        l.bindTooltip(`${esc(p.id)} · ${esc(p.nombre)}`, { sticky: true });
      }
    }).addTo(grupo);
  }

  // «Ver sus cuadrantes»: acerca el mapa a los cuadrantes de la zona y prende la capa si estaba apagada
  map.on('popupopen', (e) => {
    const btn = e.popup.getElement() && e.popup.getElement().querySelector('.btn-ver-cuadrantes');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const fs = state.datos.cuadrantes.features.filter((c) => c.properties.zona_id === btn.dataset.zona);
      if (!fs.length) return;
      if (!map.hasLayer(state.capas.cuadrantes)) {
        state.capas.cuadrantes.addTo(map);
        const chk = document.querySelector('input[data-capa=cuadrantes]');
        if (chk) chk.checked = true;
      }
      map.closePopup();
      map.fitBounds(L.geoJSON({ type: 'FeatureCollection', features: fs }).getBounds(), { padding: [50, 50], maxZoom: 15 });
    });
  });

  function incendiosFiltrados() {
    return state.datos.incendios.features.filter((f) => {
      const p = f.properties;
      if (p.anio < state.desde || p.anio > state.hasta) return false;
      if (p.fuente === 'CONAGUA' && state.soloBosque && !esBosque(p.tipoveget)) return false;
      return true;
    });
  }

  function pintaIncendios() {
    const g = state.capas.incendios, s = state.capas.satelite;
    g.clearLayers();
    s.clearLayers();
    incendiosFiltrados().forEach((f) => {
      const p = f.properties, [lon, lat] = f.geometry.coordinates;
      if (p.fuente === 'CONAGUA') {
        L.circleMarker([lat, lon], {
          radius: Math.max(3, Math.sqrt(p.ha || 0) / 2.4), color: '#ffffff', weight: 1,
          fillColor: COLOR.fuego, fillOpacity: 0.6
        }).bindPopup(`<h3>Incendio · ${esc(p.municipio)}</h3><div class="meta">${esc(p.fecha)} · CONAGUA</div>
          ${fmt(p.ha, p.ha < 10 ? 1 : 0)} ha · ${esc(p.tipoveget)}`).addTo(g);
      } else {
        L.circleMarker([lat, lon], {
          radius: 3 + Math.sqrt(p.detecciones || 1), color: COLOR.fuego, weight: 2, fill: false
        }).bindPopup(`<h3>Fuego detectado por satélite</h3><div class="meta">${esc(p.fecha)} · NASA FIRMS (VIIRS)</div>
          ${fmt(p.detecciones)} detecciones · cerca de ${esc(p.municipio)}`).addTo(s);
      }
    });
  }

  function capaCuencas() {
    return L.geoJSON(state.datos.cuencas, {
      pane: 'fondo',
      style: () => ({ color: COLOR.spruce, weight: 2, dashArray: '6 5', fillColor: COLOR.spruce, fillOpacity: 0.04 }),
      onEachFeature: (f, l) => l.bindTooltip(`Cuenca que escurre a la presa ${esc(f.properties.presa_destino)}`,
        { sticky: true })
    });
  }

  function capaAcuiferos() {
    return L.geoJSON(state.datos.acuiferos, {
      pane: 'fondo',
      style: (f) => f.properties.situacion === 'Sin Disponibilidad'
        ? { color: COLOR.alertaBorde, weight: 1, fillColor: COLOR.alerta, fillOpacity: 0.16 }
        : { color: COLOR.gris, weight: 1, dashArray: '3 4', fill: false },
      onEachFeature: (f, l) => {
        const p = f.properties;
        const detalle = p.situacion === 'Sin Disponibilidad'
          ? `Sin disponibilidad · déficit ${fmt(p.deficit_hm3, 1)} hm³ al año`
          : `Con disponibilidad · ${fmt(p.disponible_hm3, 1)} hm³ al año`;
        l.bindTooltip(`<b>${esc(p.nombre)}</b><br>${detalle}${p.zmm ? '<br>Surte a la zona metropolitana' : ''}`,
          { sticky: true });
      }
    });
  }

  function capaPresas() {
    const g = L.layerGroup();
    state.datos.presas.features.forEach((f) => {
      const p = f.properties, [lon, lat] = f.geometry.coordinates;
      const icono = L.divIcon({ className: '', html: `<div class="etq-presa">${esc(limpiaPresa(p.nombre))} ${fmt(p.llenado_pct)} %</div>`,
        iconSize: null, iconAnchor: [0, 10] });
      L.marker([lat, lon], { icon: icono }).bindPopup(`<h3>Presa ${esc(limpiaPresa(p.nombre))}</h3>
        <div class="meta">Último dato público de CONAGUA: ${esc(p.fecha)}</div>
        ${fmt(p.llenado_pct, 1)} % de llenado · ${fmt(p.almacenamiento_mm3)} millones de m³`).addTo(g);
    });
    return g;
  }

  function capaEstaciones() {
    const g = L.layerGroup();
    state.datos.estaciones.features.forEach((f) => {
      const p = f.properties, [lon, lat] = f.geometry.coordinates;
      if (p.pm25 == null) return;
      const icono = L.divIcon({ className: '', html: `<div class="etq-est">${fmt(p.pm25, 1)}</div>`, iconSize: null,
        iconAnchor: [14, 10] });
      L.marker([lat, lon], { icon: icono }).bindTooltip(`<b>Estación ${esc(p.estacion)}</b> · ${esc(p.municipio)}<br>
        PM2.5 ${fmt(p.pm25, 1)} µg/m³ · PM10 ${fmt(p.pm10, 1)} µg/m³<br>Promedio ${esc(p.periodo)}`).addTo(g);
    });
    return g;
  }

  function claseCopa(v) {
    let i = 0;
    while (i < CORTES_COPA.length && v >= CORTES_COPA[i]) i++;
    return VERDES[i];
  }
  async function capaColonias() {
    const datos = await traer('colonias_mty.geojson');
    return L.geoJSON(datos, {
      pane: 'fondo',
      style: (f) => ({ color: '#ffffff', weight: 0.5, fillColor: claseCopa(f.properties.copa_pct), fillOpacity: 0.75 }),
      onEachFeature: (f, l) => {
        const p = f.properties;
        l.bindTooltip(`<b>${esc(p.nombre)}</b><br>Copa arbórea ${fmt(p.copa_pct, 1)} % · PM2.5 ${fmt(p.pm25, 1)} µg/m³<br>
          Isla de calor ${fmt(p.isla_calor_c, 1)} °C · ${fmt(p.poblacion)} habitantes`, { sticky: true });
      }
    });
  }

  const CAPAS = [
    { id: 'zonasAgua', nombre: 'Zonas priorizadas: agua', sw: `background:${COLOR.agua}33;border-color:${COLOR.agua}`, on: true },
    { id: 'zonasAire', nombre: 'Zonas priorizadas: aire', sw: `background:${COLOR.aire}33;border-color:${COLOR.aire}`, on: true },
    { id: 'cuadrantes', nombre: 'Cuadrantes de plantación (sierra 250 m, ciudad 500 m)', sw: `background:${COLOR.agua}8c;border-color:${COLOR.agua}`, on: true },
    { id: 'incendios', nombre: 'Incendios CONAGUA (tamaño = hectáreas)', sw: `background:${COLOR.fuego}`, punto: true, on: true },
    { id: 'satelite', nombre: 'Fuego por satélite 2024-2025', sw: `border-color:${COLOR.fuego}`, punto: true, on: true },
    { id: 'cuencas', nombre: 'Cuencas que escurren a las presas', sw: `border:2px dashed ${COLOR.spruce}`, on: true },
    { id: 'presas', nombre: 'Presas (% de llenado)', sw: `border-color:${COLOR.spruce};background:#fff`, on: true },
    { id: 'estaciones', nombre: 'Estaciones del SIMA (PM2.5 µg/m³)', sw: `border-color:${COLOR.aire};background:#fff`, on: true },
    { id: 'acuiferos', nombre: 'Acuíferos sin disponibilidad (DOF 2023)', sw: `background:${COLOR.alerta}55;border-color:${COLOR.alertaBorde}`, on: false },
    { id: 'colonias', nombre: 'Copa arbórea por colonia (Monterrey)', sw: `background:${VERDES[3]}`, on: false, perezosa: true }
  ];

  function pintaControlCapas() {
    const cont = $('#capas');
    cont.open = window.innerWidth > 860;
    cont.innerHTML = '<summary>Capas</summary>' + CAPAS.map((c) => `
      <label><input type="checkbox" data-capa="${c.id}" ${c.on ? 'checked' : ''}>
        <span class="sw${c.punto ? ' punto' : ''}" style="${c.sw}"></span>${esc(c.nombre)}</label>
      ${c.id === 'colonias' ? `<div class="leyenda-escala" aria-hidden="true">${VERDES.map((v) => `<span style="background:${v}"></span>`).join('')}</div>
        <div class="leyenda-texto"><span>0 %</span><span>5</span><span>10</span><span>20</span><span>30 %+</span></div>` : ''}`).join('');
    cont.querySelectorAll('input').forEach((chk) => chk.addEventListener('change', async () => {
      const id = chk.dataset.capa;
      if (!state.capas[id]) state.capas[id] = await capaColonias();
      if (chk.checked) state.capas[id].addTo(map); else map.removeLayer(state.capas[id]);
    }));
  }

  /* ---------- Gráficas (SVG propio: barras finas, extremo redondeado, cuadrícula tenue) ---------- */
  function barra(x, y, w, h, r) {
    if (h <= 0) return '';
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function barraH(x, y, w, h, r) {
    if (w <= 0) return '';
    r = Math.min(r, h / 2, w);
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }
  function redondo(max) {
    const p = Math.pow(10, Math.floor(Math.log10(max || 1)));
    return Math.ceil(max / p) * p;
  }

  function graficaAnios() {
    const porAnio = {};
    for (let a = ANIO_MIN; a <= 2023; a++) porAnio[a] = { ha: 0, n: 0 };
    state.datos.incendios.features.forEach((f) => {
      const p = f.properties;
      if (p.fuente !== 'CONAGUA' || !porAnio[p.anio]) return;
      if (state.soloBosque && !esBosque(p.tipoveget)) return;
      porAnio[p.anio].ha += p.ha || 0;
      porAnio[p.anio].n += 1;
    });
    const filas = Object.entries(porAnio).map(([a, v]) => ({ anio: +a, ...v }));
    const W = 368, H = 150, M = { l: 40, r: 4, t: 8, b: 20 };
    const max = redondo(Math.max(...filas.map((f) => f.ha)));
    const iw = W - M.l - M.r, ih = H - M.t - M.b, paso = iw / filas.length, bw = Math.max(2, paso - 2);
    const y = (v) => M.t + ih - (v / max) * ih;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hectáreas quemadas por año, 2005 a 2023">`;
    [0, max / 2, max].forEach((v) => {
      svg += `<line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}" stroke="${COLOR.grid}"/>
        <text class="eje" x="${M.l - 6}" y="${y(v) + 3}" text-anchor="end">${fmt(v)}</text>`;
    });
    filas.forEach((f, i) => {
      const x = M.l + i * paso + 1, dentro = f.anio >= state.desde && f.anio <= state.hasta;
      svg += `<path class="barra-dato" tabindex="0" data-anio="${f.anio}" data-ha="${f.ha}" data-n="${f.n}"
        d="${barra(x, y(f.ha), bw, M.t + ih - y(f.ha), 4)}" fill="${COLOR.fuego}" opacity="${dentro ? 1 : 0.25}"/>`;
      if (f.anio % 3 === 2) svg += `<text class="eje" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${f.anio}</text>`;
    });
    // Rótulo directo sólo en el máximo
    const pico = filas.reduce((a, b) => (b.ha > a.ha ? b : a));
    const xp = M.l + filas.indexOf(pico) * paso + bw / 2;
    svg += `<text class="valor" x="${Math.min(xp + 6, W - 60)}" y="${y(pico.ha) + 10}">${pico.anio}: ${fmt(pico.ha)} ha</text></svg>`;
    $('#g-anios').innerHTML = svg;
    $('#g-anios').querySelectorAll('.barra-dato').forEach((b) => {
      const html = () => `<b>${b.dataset.anio}</b><br>${fmt(+b.dataset.ha)} ha · ${fmt(+b.dataset.n)} incendios`;
      b.addEventListener('mousemove', (ev) => muestraTip(ev, html()));
      b.addEventListener('mouseleave', ocultaTip);
      b.addEventListener('focus', () => { const r = b.getBoundingClientRect(); muestraTip({ clientX: r.left, clientY: r.top }, html()); });
      b.addEventListener('blur', ocultaTip);
      const elegir = () => { ocultaTip(); fijaAnios(+b.dataset.anio, +b.dataset.anio); };
      b.addEventListener('click', elegir);
      b.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); elegir(); } });
    });
    $('#tabla-anios').innerHTML = `<table><thead><tr><th>Año</th><th class="n">Incendios</th><th class="n">Hectáreas</th></tr></thead><tbody>` +
      filas.map((f) => `<tr><td>${f.anio}</td><td class="n">${fmt(f.n)}</td><td class="n">${fmt(f.ha)}</td></tr>`).join('') + '</tbody></table>';
  }

  function barrasH(sel, filas, opciones) {
    const W = 368, fila = 20, M = { l: opciones.etiqueta || 130, r: 52, t: 4, b: opciones.ref ? 18 : 4 };
    const H = M.t + filas.length * fila + M.b;
    const max = opciones.max || redondo(Math.max(...filas.map((f) => f.valor)));
    const iw = W - M.l - M.r, x = (v) => M.l + (v / max) * iw;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opciones.titulo)}">`;
    filas.forEach((f, i) => {
      const yy = M.t + i * fila;
      svg += `<text class="eje" x="${M.l - 6}" y="${yy + 13}" text-anchor="end">${esc(f.etiqueta)}</text>
        <path class="barra-dato" tabindex="0" data-i="${i}" d="${barraH(M.l, yy + 4, x(f.valor) - M.l, 12, 4)}" fill="${opciones.color}"/>
        <text class="valor" x="${x(f.valor) + 5}" y="${yy + 14}">${opciones.formato(f.valor)}</text>`;
    });
    if (opciones.ref) {
      const xr = x(opciones.ref.valor);
      svg += `<line x1="${xr}" x2="${xr}" y1="${M.t}" y2="${H - M.b + 2}" stroke="${COLOR.spruce}" stroke-dasharray="3 3"/>
        <text class="eje" x="${xr}" y="${H - 4}" text-anchor="middle">${esc(opciones.ref.etiqueta)}</text>`;
    }
    svg += '</svg>';
    const cont = $(sel);
    cont.innerHTML = svg;
    cont.querySelectorAll('.barra-dato').forEach((b) => {
      const html = () => opciones.tooltip(filas[+b.dataset.i]);
      b.addEventListener('mousemove', (ev) => muestraTip(ev, html()));
      b.addEventListener('mouseleave', ocultaTip);
      b.addEventListener('focus', () => { const r = b.getBoundingClientRect(); muestraTip({ clientX: r.right, clientY: r.top }, html()); });
      b.addEventListener('blur', ocultaTip);
    });
  }

  function graficaMunicipios() {
    const acc = {};
    incendiosFiltrados().forEach((f) => {
      const p = f.properties;
      if (p.fuente !== 'CONAGUA') return;
      const m = acc[p.municipio] || (acc[p.municipio] = { ha: 0, n: 0 });
      m.ha += p.ha || 0;
      m.n += 1;
    });
    const filas = Object.entries(acc).map(([m, v]) => ({ etiqueta: m, valor: v.ha, n: v.n }))
      .sort((a, b) => b.valor - a.valor).slice(0, 8);
    if (!filas.length) { $('#g-municipios').innerHTML = '<p class="nota">Sin incendios de CONAGUA en esos años.</p>'; return; }
    barrasH('#g-municipios', filas, {
      titulo: 'Municipios con más hectáreas quemadas', color: COLOR.fuego, etiqueta: 110,
      formato: (v) => fmt(v) + ' ha', tooltip: (f) => `<b>${esc(f.etiqueta)}</b><br>${fmt(f.valor)} ha · ${fmt(f.n)} incendios`
    });
  }

  function graficaPM() {
    const filas = state.datos.estaciones.features.map((f) => f.properties).filter((p) => p.pm25 != null)
      .map((p) => ({ etiqueta: `${p.municipio} · ${p.estacion}`, valor: p.pm25, pm10: p.pm10, periodo: p.periodo }))
      .sort((a, b) => b.valor - a.valor);
    barrasH('#g-pm25', filas, {
      titulo: 'PM2.5 promedio de 12 meses por estación', color: COLOR.aire, etiqueta: 150, max: 25,
      ref: { valor: 5, etiqueta: 'OMS 5' }, formato: (v) => fmt(v, 1),
      tooltip: (f) => `<b>${esc(f.etiqueta)}</b><br>PM2.5 ${fmt(f.valor, 1)} µg/m³ · PM10 ${fmt(f.pm10, 1)} µg/m³<br>${esc(f.periodo)}`
    });
    $('#tabla-pm').innerHTML = `<table><thead><tr><th>Estación</th><th class="n">PM2.5</th><th class="n">PM10</th></tr></thead><tbody>` +
      filas.map((f) => `<tr><td>${esc(f.etiqueta)}</td><td class="n">${fmt(f.valor, 1)}</td><td class="n">${fmt(f.pm10, 1)}</td></tr>`).join('') +
      '</tbody></table>';
  }

  /* ---------- Indicadores ---------- */
  const kpi = (valor, texto, ancho) => `<div class="kpi${ancho ? ' ancho' : ''}"><b>${valor}</b><span>${texto}</span></div>`;

  function pintaKpisFuego() {
    const fs = incendiosFiltrados().map((f) => f.properties);
    const con = fs.filter((p) => p.fuente === 'CONAGUA'), sat = fs.filter((p) => p.fuente !== 'CONAGUA');
    const ha = con.reduce((s, p) => s + (p.ha || 0), 0);
    const haBosque = con.filter((p) => esBosque(p.tipoveget)).reduce((s, p) => s + (p.ha || 0), 0);
    const hastaCon = Math.min(state.hasta, 2023);
    const rango = state.desde <= hastaCon ? (state.desde === hastaCon ? `${state.desde}` : `${state.desde}-${hastaCon}`) : 'fuera de 2005-2023';
    $('#kpis-fuego').innerHTML = [
      kpi(fmt(con.length), `incendios registrados por CONAGUA (${rango})`),
      kpi(fmt(ha), 'hectáreas quemadas'),
      kpi(ha ? fmt(100 * haBosque / ha) + ' %' : '—', 'de esas hectáreas eran bosque'),
      state.hasta < 2024
        ? kpi('—', 'episodios de fuego por satélite: sólo hay datos de 2024 y 2025')
        : kpi(fmt(sat.length), `episodios de fuego detectados por satélite (${Math.max(state.desde, 2024) === state.hasta
          ? state.hasta : Math.max(state.desde, 2024) + '-' + state.hasta}, sin hectáreas)`)
    ].join('');
  }

  function pintaKpisFijos() {
    const ind = state.datos.indicadores;
    const presas = ind.presas.map((p) => `${limpiaPresa(p.nombre)} ${fmt(p.llenado_pct)} %`).join(' · ');
    $('#kpis-agua').innerHTML = [
      kpi(`${ind.acuiferos.sin_disponibilidad} de ${ind.acuiferos.total}`, `acuíferos de Nuevo León sin disponibilidad (DOF, ${ind.acuiferos.publicacion.slice(0, 4)})`),
      kpi(fmt(ind.acuiferos.deficit_total_hm3), 'millones de m³ al año de déficit sumado'),
      kpi(presas, `llenado de presas al ${ind.presas[0].fecha} (último dato público de CONAGUA)`, true),
      kpi(fmt(ind.zonas.agua), 'zonas priorizadas para restaurar la sierra')
    ].join('');
    const a = ind.aire;
    const peor = state.datos.estaciones.features.map((f) => f.properties).find((p) => p.estacion === a.peor_pm25);
    $('#kpis-aire').innerHTML = [
      kpi(`${fmt(a.pm25_promedio, 1)} µg/m³`, `PM2.5 promedio de ${a.estaciones} estaciones: ${fmt(a.pm25_promedio / a.guia_oms_pm25, 1)} veces la guía de la OMS`),
      kpi(`${fmt(a.pm10_promedio, 1)} µg/m³`, `PM10 promedio: ${fmt(a.pm10_promedio / a.guia_oms_pm10, 1)} veces la guía de la OMS`),
      kpi(peor ? `${fmt(peor.pm25, 1)}` : '—', `PM2.5 más alto: estación ${esc(a.peor_pm25)}${peor ? ' (' + esc(peor.municipio) + ')' : ''}`),
      kpi(fmt(ind.zonas.aire), 'zonas priorizadas para arbolado urbano')
    ].join('');
  }

  async function pintaKpisRaiz() {
    const cq = state.datos.cuadrantes.features;
    const kpiCuadrantes = kpi(fmt(cq.length), `cuadrantes de plantación: ${cq.filter((c) => c.properties.objetivo === 'agua').length} en la sierra (250 m) y ${cq.filter((c) => c.properties.objetivo === 'aire').length} en la ciudad (500 m)`);
    let html = kpi(fmt(state.datos.indicadores.zonas.agua + state.datos.indicadores.zonas.aire), 'zonas donde se puede donar') + kpiCuadrantes;
    if (API_BASE) {
      try {
        const r = await fetch(API_BASE + '/api/resumen');
        if (r.ok) {
          const res = await r.json();
          const po = res.por_objetivo || {};
          html = [
            kpi(fmt(res.donados), 'árboles donados'),
            kpi(fmt(res.plantados), 'árboles plantados (verificados por quien planta)'),
            kpi(fmt((po.agua || {}).donados || 0), 'donados para agua'),
            kpi(fmt((po.aire || {}).donados || 0), 'donados para aire')
          ].join('') + kpiCuadrantes;
        }
      } catch (e) { /* sin API: se queda el conteo de zonas */ }
    }
    $('#kpis-raiz').innerHTML = html;
  }

  /* ---------- Filtro de años ---------- */
  function fijaAnios(desde, hasta) {
    if (desde > hasta) [desde, hasta] = [hasta, desde];
    state.desde = desde;
    state.hasta = hasta;
    $('#desde').value = desde;
    $('#hasta').value = hasta;
    actualiza();
  }
  function actualiza() {
    pintaIncendios();
    pintaKpisFuego();
    graficaAnios();
    graficaMunicipios();
  }
  function preparaFiltros() {
    const opciones = [];
    for (let a = ANIO_MIN; a <= ANIO_MAX; a++) opciones.push(`<option value="${a}">${a}</option>`);
    $('#desde').innerHTML = opciones.join('');
    $('#hasta').innerHTML = opciones.join('');
    $('#desde').value = ANIO_MIN;
    $('#hasta').value = ANIO_MAX;
    $('#desde').addEventListener('change', () => fijaAnios(+$('#desde').value, +$('#hasta').value));
    $('#hasta').addEventListener('change', () => fijaAnios(+$('#desde').value, +$('#hasta').value));
    $('#todos').addEventListener('click', () => fijaAnios(ANIO_MIN, ANIO_MAX));
    $('#solo-bosque').addEventListener('change', (e) => { state.soloBosque = e.target.checked; actualiza(); });
  }

  /* ---------- Arranque ---------- */
  /* ---------- Donar desde el mapa ---------- */
  function donarEn(id) {
    if (EMBEBIDO && window.parent !== window) window.parent.postMessage({ raiz: 'donar', id }, location.origin);
    else location.href = 'index.html?zona=' + encodeURIComponent(id) + '#donde';
  }
  map.on('popupopen', (e) => {
    const b = e.popup.getElement() && e.popup.getElement().querySelector('.btn-donar-zona');
    if (b) b.addEventListener('click', () => donarEn(b.dataset.zona));
  });
  function verObjetivo(obj) {
    document.querySelectorAll('.sel-obj button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.obj === obj)));
    const ver = { zonasAgua: obj !== 'aire', zonasAire: obj !== 'agua' };
    Object.keys(ver).forEach((id) => {
      const capa = state.capas[id];
      if (!capa) return;
      if (ver[id]) capa.addTo(map); else map.removeLayer(capa);
      const chk = document.querySelector(`#capas input[data-capa="${id}"]`);
      if (chk) chk.checked = ver[id];
    });
    const fs = state.datos.zonas.features.filter((f) => obj === 'todas' || f.properties.objetivo === obj);
    if (fs.length) map.fitBounds(L.geoJSON({ type: 'FeatureCollection', features: fs }).getBounds(), { padding: [30, 30], maxZoom: 11 });
  }
  document.querySelectorAll('.sel-obj button').forEach((b) => b.addEventListener('click', () => verObjetivo(b.dataset.obj)));
  window.addEventListener('message', (e) => {
    if (e.origin === location.origin && e.data && e.data.raiz === 'objetivo' && state.datos.zonas) verObjetivo(e.data.objetivo);
  });

  Promise.all(['zonas.geojson', 'incendios.geojson', 'cuencas.geojson', 'presas.geojson', 'estaciones.geojson',
    'acuiferos.geojson', 'indicadores.json', 'resumen.json', 'cuadrantes.geojson'].map(traer)).then((v) => {
    const [zonas, incendios, cuencas, presas, estaciones, acuiferos, indicadores, resumen, cuadrantes] = v;
    Object.assign(state.datos, { zonas, incendios, cuencas, presas, estaciones, acuiferos, indicadores, resumen,
      cuadrantes: cuadrantes || { type: 'FeatureCollection', features: [] } });
    state.capas.zonasAgua = capaZonas('agua');
    state.capas.zonasAire = capaZonas('aire');
    state.capas.incendios = L.layerGroup();
    state.capas.satelite = L.layerGroup();
    state.capas.cuencas = capaCuencas();
    state.capas.presas = capaPresas();
    state.capas.estaciones = capaEstaciones();
    state.capas.acuiferos = capaAcuiferos();
    state.capas.cuadrantes = capaCuadrantes();
    ['cuencas', 'incendios', 'satelite', 'zonasAgua', 'zonasAire', 'cuadrantes', 'presas', 'estaciones'].forEach((id) => state.capas[id].addTo(map));
    pintaControlCapas();
    preparaFiltros();
    actualiza();
    pintaKpisFijos();
    graficaPM();
    pintaKpisRaiz();
    $('#fuentes').innerHTML = (resumen.fuentes || []).map((s) =>
      `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.nombre)}</a></li>`).join('');
    $('#generado').textContent = `Datos generados el ${indicadores.generado} con pipeline/build.py. ${resumen.nota || ''}`;
    setTimeout(() => map.invalidateSize(), 0);
  });
})();
