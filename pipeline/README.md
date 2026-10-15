# Pipeline

Escribe `web/data/` siguiendo el contrato del README raíz. Un solo script:

```bash
pip install requests shapely
python pipeline/build.py
```

Descarga a `pipeline/raw/` (ignorado por git) las capas de CONAGUA SINA que falten (cuencas, acuíferos y presas;
el GeoServer pide un `User-Agent` de navegador) y usa lo que ya está en `investigacion/fuentes/`:
incendios de CONAGUA 2005-2023, detecciones satelitales VIIRS 2024-2025 (`firms/`), presas y el índice urbano de
MIDE Monterrey. La pendiente sale del modelo de elevación Copernicus vía Open-Meteo.

Después, para que la API use las zonas nuevas: `cd backend && python -m app.seed --reset`.

## Reglas

**Agua (8 zonas).** Celdas de ~2 km.
- Fuego: hectáreas de CONAGUA con peso que se reduce a la mitad cada 5 años, más detecciones satelitales 2024-2025
  (60 % y 40 % del puntaje, en escala logarítmica). +10 % si además está sobre un acuífero sin disponibilidad.
- Entra sólo si drena a una presa de abastecimiento según las cuencas oficiales del DOF («Río San Juan 1», hasta
  El Cuchillo; «Río Pablillo 1 y 2», hasta Cerro Prieto) o si está sobre un acuífero que surte a la zona
  metropolitana (Área Metropolitana, Campo Buenos Aires, Campo Mina, Campo Durazno, Campo Topo Chico,
  Cañón del Huajuco).
- Fuera: pendiente media mayor a 35°, valle metropolitano debajo de 800 m y cualquier sitio debajo de 500 m.
- Zonas separadas al menos 8 km. Lo que no entra y por qué: `docs/sitios_descartados.md`.

**Aire (8 zonas).**
- 3 colonias de Monterrey con más PM2.5, menos copa arbórea, más calor y más gente (MIDE Monterrey 2022;
  35 / 30 / 20 / 15 %).
- 5 municipios señalados en el reto 3 (Pesquería, Cadereyta, Juárez, Santa Catarina, García) alrededor de su
  estación del SIMA. Sin puntaje: el SIMA no ofrece hoy datos descargables (su reporte diario devuelve error de
  base de datos), así que se priorizan por señalamiento, y así lo dice la ficha.

## Pendientes

- La Boca no tiene polígono propio en las cuencas del DOF: sus sitios aparecen como «aporta a El Cuchillo»
  (La Boca está aguas arriba dentro de «Río San Juan 1»).
- El punto de cada incendio de CONAGUA es su registro, no el polígono de la cicatriz: un incendio de 3,000 ha
  cae en una sola celda. Siguiente paso: severidad y regeneración con Sentinel-2.
- Promedios de PM10 y PM2.5 por estación (SINAICA) para ordenar los municipios del reto 3.
- Revisar en campo AG-08 (García, «La Autopista»): entra por el acuífero Campo Durazno, pero el nombre sugiere
  orilla de carretera.
