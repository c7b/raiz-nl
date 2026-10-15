// node web/tests/chat.test.js
const assert = require('assert'), fs = require('fs'), path = require('path');
const C = require('../chat.js');
const z = C.prepararZonas(JSON.parse(fs.readFileSync(path.join(__dirname, '../data/zonas.geojson'), 'utf8')));
assert(z.agua.every(x => /El Cuchillo|La Boca|Cerro Prieto/.test(x.razones.join(' '))));
const ci = z.agua.findIndex(x => /· Ciénega de González$/.test(x.nombre)) + 1; assert(ci > 0); assert(z.agua.length >= 5 && z.agua.length <= 8 && z.aire.length >= 5);
['más agua', 'llenar la presa', 'limpiar el aire', '5 litros', '3 m³', 'µg/m³ reducidos', 'suministro', 'x #Otro', 'a'.repeat(281)]
  .forEach(b => assert(C.validar(b).length, b));
const run = (msgs, show) => { const f = C.crearFlujo(z), s = f.nuevo(); let r; for (const m of msgs) { r = f.step(s, m); if (show) console.log('Tú: ' + m + '\nRaíz NL: ' + r.texto + (r.link ? '\n[Publicar en X] ' + r.link : '') + '\n'); } return r; };
let r = run(['Quiero donar', '💧 agua', `la ${ci}, dos árboles`, '@ana_mty', 'Sí, publícalo'], true);
assert(r.link.startsWith('https://x.com/intent/post?text=') && decodeURIComponent(r.link).includes('vía @ana_mty'));
assert(/^Donaron 2 árboles para restaurar Ciénega de González, cuenca que aporta a (La Boca|El Cuchillo)\. 🌳💧 #RaízNL vía @ana_mty$/.test(decodeURIComponent(r.link.split('text=')[1])));
r = run(['Quiero donar', 'agua', '1', '1', 'No me etiquetes', 'sí']); assert(!decodeURIComponent(r.link).includes('@'));
r = run(['Quiero donar', 'agua', '1', '1', 'no', 'mejor no']); assert(!r.link);
r = run(['Quiero donar', 'agua', '1', '1', 'mmm']); assert(!r.link && /Escribe tu @/.test(r.texto));
const ai = z.aire.findIndex(x => x.municipio === 'Pesquería') + 1; assert(ai > 0);
r = run(['Quiero donar', 'aire', String(ai), '3', 'no', 'va']); assert(decodeURIComponent(r.link).includes('Pesquería'));
assert(/no sube la presa/.test(run(['¿con esto ya hay agua?']).texto));
console.log('OK: todas las pruebas del chat pasaron');
