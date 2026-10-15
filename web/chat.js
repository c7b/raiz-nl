/* Raíz NL — chat "Dona un árbol" (sin backend, sin llaves). Misma lógica que el bot de X:
   propósito → zona → número → texto → visto bueno + etiqueta → enlace x.com/intent. */
(function (root) {
  'use strict';
  var PRESAS = ['El Cuchillo', 'La Boca', 'Cerro Prieto'];
  var PROHIBIDO = ['más agua', 'mas agua', 'llenar la presa', 'limpiar el aire', 'litros', 'm³', 'm3', 'µg/m³', 'ug/m3',
    'suministro', 'refinería', 'refineria', 'bajar la contaminación', 'plantados', '17,000', 'las indias'];
  var SI = ['sí', 'si', 'publícalo', 'publicalo', 'va', 'dale', 'sí, publícalo'];
  var NO = ['no', 'nel', 'cancelar', 'cancela'];
  var NUMS = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };

  function presaDe(z) {
    var rs = z.razones || [];
    for (var i = 0; i < rs.length; i++) for (var j = 0; j < PRESAS.length; j++)
      if (/presa/i.test(rs[i]) && rs[i].toLowerCase().indexOf(PRESAS[j].toLowerCase()) >= 0) return PRESAS[j];
    return null;
  }
  function estacionDe(z) {
    var m = ((z.razones || []).join(' ') + ' ' + (z.nombre || '') + ')').match(/estación ([A-ZÁÉÍÓÚ0-9 ]+?)\)/);
    return m ? m[1].trim() : null;
  }
  function prepararZonas(geo) {
    var out = { agua: [], aire: [] };
    (geo.features || []).forEach(function (f) {
      var z = Object.assign({}, f.properties);
      if (z.objetivo === 'agua') { z.presa = presaDe(z); if (!z.presa) return; } // fuera de cuenca, fuera del mapa
      else if (z.objetivo === 'aire') z.estacion = estacionDe(z);
      else return;
      out[z.objetivo].push(z);
    });
    ['agua', 'aire'].forEach(function (k) { out[k] = out[k].sort(function (a, b) { return (a.rank || 99) - (b.rank || 99); }).slice(0, 8); });
    return out;
  }
  function lugar(z) { var p = z.nombre.split('·'); return p[p.length - 1].trim(); }
  function razon(z) {
    var rs = z.razones || [];
    if (z.objetivo === 'agua') {
      var r = rs.filter(function (x) { return /incendio|fuego/i.test(x); })[0] || rs[0] || '';
      return 'ladera con fuego (' + r.split('(')[0].trim() + ') que escurre a la presa';
    }
    return rs.some(function (x) { return /copa/i.test(x); }) ? 'poca copa y calor en la colonia (dato de ejemplo)'
      : 'municipio señalado en el reto 3 por mala calidad del aire';
  }
  function ficha(i, z) {
    var ref = z.objetivo === 'agua' ? 'presa ' + z.presa : 'estación SIMA ' + (z.estacion || 'por confirmar');
    return i + ') ' + lugar(z) + ', ' + z.municipio + ': ' + razon(z) + '. ' + ref + '. ' + (z.operador || 'operador por confirmar') + '.';
  }
  function validar(t) {
    var e = [], low = t.toLowerCase();
    if ([...t].length > 280) e.push('más de 280 caracteres');
    PROHIBIDO.forEach(function (f) { if (low.indexOf(f) >= 0) e.push('frase prohibida: ' + f); });
    (t.match(/#[\wÁÉÍÓÚáéíóúñÑ]+/g) || []).forEach(function (h) { if (h !== '#RaízNL') e.push('hashtag no permitido'); });
    return e;
  }
  function redactar(z, n, usuario, obra) {
    var arb = n === 1 ? 'un árbol' : n + ' árboles', via = usuario ? ' vía @' + usuario : '', t;
    if (obra) t = 'Donaron ' + (n === 1 ? 'una obra de suelo' : n + ' obras de suelo') + ' para frenar la erosión en ' + lugar(z) + ', cuenca que aporta a ' + z.presa + '. 💧 #RaízNL' + via;
    else if (z.objetivo === 'agua') t = 'Donaron ' + arb + ' para restaurar ' + lugar(z) + ', cuenca que aporta a ' + z.presa + '. 🌳💧 #RaízNL' + via;
    else t = 'Donaron ' + arb + ' para arbolado en ' + lugar(z) + ', en ' + z.municipio + ', con poca sombra y mala calidad del aire. 🌳🌬️ #RaízNL' + via;
    var e = validar(t); if (e.length) throw new Error(e.join('; '));
    return t;
  }
  function intent(t) { return 'https://x.com/intent/post?text=' + encodeURIComponent(t); }
  function numeros(t) {
    var v = (t.match(/\d+/g) || []).map(Number);
    (t.toLowerCase().match(/[a-záéíóú]+/g) || []).forEach(function (w) { if (NUMS[w]) v.push(NUMS[w]); });
    return v;
  }
  function limpiaHandle(t) { var m = t.trim().match(/^@?([A-Za-z0-9_]{1,15})$/); return m ? m[1] : null; }

  /* Máquina de estados. step(state, texto) -> { texto, opciones?, link? } */
  function crearFlujo(zonas) {
    function step(s, t) {
      t = (t || '').trim(); var low = t.replace(/@\w+/g, '').toLowerCase().trim();
      if (/(ya hay agua|llena la presa|más agua|limpia el aire)/.test(low))
        return { texto: 'Ojalá, pero no: el árbol de sierra sujeta suelo, baja el azolve y frena el escurrimiento; protege la cuenca, no sube la presa. El urbano da sombra y baja el calor muy localmente.' };
      if (NO.indexOf(low) >= 0 && s.paso !== 'etiqueta' && s.paso !== 'inicio') { reset(s); return { texto: 'Va, lo dejamos. Aquí andamos cuando quieras 🌳', opciones: ['Quiero donar'] }; }
      switch (s.paso) {
        case 'inicio': case 'fin':
          reset(s); s.paso = 'proposito';
          if (/agua|aire/.test(low)) return step(s, t);
          return { texto: 'Va 🌳 ¿Para qué lo quieres: 💧 agua (restaurar sierra quemada que escurre a las presas) o 🌬️ aire (sombra y copa donde se respira peor)?', opciones: ['💧 agua', '🌬️ aire'] };
        case 'proposito':
          var p = /agua/.test(low) ? 'agua' : /aire/.test(low) ? 'aire' : null;
          if (!p) return { texto: '¿💧 agua o 🌬️ aire?', opciones: ['💧 agua', '🌬️ aire'] };
          s.paso = 'zona'; s.proposito = p;
          return { texto: 'Estas son las zonas:\n' + zonas[p].map(function (z, i) { return ficha(i + 1, z); }).join('\n') + '\n¿Cuál eliges y cuántos árboles?',
            opciones: zonas[p].map(function (z, i) { return String(i + 1); }) };
        case 'zona':
          var ns = numeros(low), zs = zonas[s.proposito];
          if (!ns.length || ns[0] < 1 || ns[0] > zs.length) return { texto: 'Dime el número de zona (1 a ' + zs.length + ').' };
          s.zona = ns[0] - 1; s.obra = /obra/.test(low) && s.proposito === 'agua';
          if (ns.length > 1) return cantidad(s, ns[1]);
          s.paso = 'numero'; return { texto: '¿Cuántos árboles?', opciones: ['1', '2', '5'] };
        case 'numero':
          var n2 = numeros(low); if (!n2.length) return { texto: '¿Cuántos árboles? (un número)' };
          return cantidad(s, n2[0]);
        case 'etiqueta':
          var h = limpiaHandle(t);
          if (NO.indexOf(low) >= 0 || /sin etiqueta|no me etiquetes|omitir|saltar/.test(low)) s.usuario = null;
          else if (t.trim().charAt(0) === '@' && h) s.usuario = h;
          else return { texto: 'Escribe tu @ (por ejemplo @tu_usuario) o "no" para publicar sin etiquetarte.', opciones: ['No me etiquetes'] };
          s.texto = redactar(zonas[s.proposito][s.zona], s.n, s.usuario, s.obra); s.paso = 'confirmar';
          return { texto: 'Así quedaría, texto final exacto:\n"' + s.texto + '"\n' + (s.usuario ? 'Te etiqueto como @' + s.usuario + '. ' : 'Sin etiqueta. ') + '¿Lo publico así?', opciones: ['Sí, publícalo', 'No'] };
        case 'confirmar':
          if (SI.indexOf(low) >= 0 || /^s[ií]\b/.test(low)) {
            if (validar(s.texto).length) throw new Error('texto inválido');
            s.paso = 'fin';
            return { texto: 'Listo 🌳 Como es demo, lo publicas tú desde tu cuenta con este botón:', link: intent(s.texto) };
          }
          reset(s); return { texto: 'Va, no se publica nada. Tu donación queda registrada 🌳', opciones: ['Quiero donar'] };
      }
      return { texto: '¿En qué te ayudo?' };
    }
    function cantidad(s, n) {
      if (n < 1 || n > 100) return { texto: 'Dime entre 1 y 100 árboles.' };
      var z = zonas[s.proposito][s.zona]; s.n = n; s.paso = 'etiqueta';
      var que = s.obra ? (n === 1 ? 'obra de suelo' : 'obras de suelo') : (n === 1 ? 'árbol' : 'árboles');
      return { texto: 'Quedan apartados ' + n + ' ' + que + ' en ' + lugar(z) + ' (donados; los planta ' + (z.operador || 'el operador (por confirmar)') +
        ' y te avisamos cuando estén plantados). Este sería el post:\n"' + redactar(z, n, null, s.obra) + '"\n¿Te etiqueto? Escribe tu @ o "no".', opciones: ['No me etiquetes'] };
    }
    function reset(s) { Object.keys(s).forEach(function (k) { delete s[k]; }); s.paso = 'inicio'; }
    return { step: step, nuevo: function () { return { paso: 'inicio' }; } };
  }

  var API = { prepararZonas: prepararZonas, crearFlujo: crearFlujo, validar: validar, redactar: redactar, intent: intent, ficha: ficha };
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; return; }

  /* ---------- UI ---------- */
  var KEY = 'raiznl-chat';
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  async function cargar() {
    for (var u of ['data/zonas.geojson', 'data/mock/zonas.geojson']) {
      try { var r = await fetch(u, { cache: 'no-cache' }); if (r.ok) return prepararZonas(await r.json()); } catch (e) { /* sigue */ }
    }
    return { agua: [], aire: [] };
  }
  function init() {
    var btn = el('button', 'rchat-fab', 'Dona un árbol 🌳'); btn.type = 'button'; btn.setAttribute('aria-expanded', 'false');
    var panel = el('section', 'rchat-panel'); panel.hidden = true; panel.setAttribute('aria-label', 'Chat de donación Raíz NL');
    var head = el('header', 'rchat-head'); head.appendChild(el('b', null, 'Raíz NL'));
    var reini = el('button', 'rchat-x', 'Reiniciar'); var cerrar = el('button', 'rchat-x', '✕'); cerrar.setAttribute('aria-label', 'Cerrar');
    head.appendChild(reini); head.appendChild(cerrar);
    var log = el('div', 'rchat-log'); log.setAttribute('aria-live', 'polite');
    var ops = el('div', 'rchat-ops');
    var form = el('form', 'rchat-form'); var inp = el('input'); inp.placeholder = 'Escribe aquí…'; inp.setAttribute('aria-label', 'Mensaje');
    var send = el('button', 'rchat-send', 'Enviar'); form.appendChild(inp); form.appendChild(send);
    [head, log, ops, form].forEach(function (x) { panel.appendChild(x); });
    document.body.appendChild(btn); document.body.appendChild(panel);

    var flujo, st;
    function burbuja(quien, r) {
      var b = el('div', 'rchat-msg rchat-' + quien, r.texto);
      if (r.link) { var a = el('a', 'rchat-pub', 'Publicar en X'); a.href = r.link; a.target = '_blank'; a.rel = 'noopener'; b.appendChild(a); }
      log.appendChild(b); log.scrollTop = log.scrollHeight;
      ops.innerHTML = '';
      (r.opciones || []).forEach(function (o) { var c = el('button', 'rchat-op', o); c.type = 'button'; c.onclick = function () { decir(o); }; ops.appendChild(c); });
    }
    function decir(t) {
      if (!t.trim()) return; burbuja('yo', { texto: t });
      var r; try { r = flujo.step(st, t); } catch (e) { r = { texto: 'Algo salió mal con el texto; empecemos de nuevo.' }; st = flujo.nuevo(); }
      burbuja('bot', r); try { sessionStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {}
    }
    function empezar() { st = flujo.nuevo(); log.innerHTML = ''; burbuja('bot', flujo.step(st, '')); }
    form.onsubmit = function (e) { e.preventDefault(); var t = inp.value; inp.value = ''; decir(t); };
    reini.onclick = empezar;
    function toggle(open) { panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) inp.focus(); }
    btn.onclick = function () { toggle(panel.hidden); };
    cerrar.onclick = function () { toggle(false); };
    cargar().then(function (z) { flujo = crearFlujo(z); empezar(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(this);
