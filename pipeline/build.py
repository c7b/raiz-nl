"""Pipeline v0 de Raíz NL: escribe web/data/ según el contrato de datos del README.

Agua (reto 1): celdas de ~2 km con historia de incendios (CONAGUA 2005-2023 y detecciones
satelitales VIIRS 2024-2025), dentro de la cuenca oficial de una presa de abastecimiento
(«Río San Juan 1», hasta El Cuchillo; «Río Pablillo 1 y 2», hasta Cerro Prieto) o sobre un
acuífero que surte a la zona metropolitana. Se queda una lista corta de 8 zonas separadas.

Aire (reto 3): colonias de Monterrey con más partículas finas, menos copa arbórea, más calor y
más gente (MIDE Monterrey 2022), más los municipios señalados en el reto alrededor de su
estación del SIMA.

Uso: python pipeline/build.py   (descarga a pipeline/raw/ lo que falte)
"""
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from shapely.geometry import Point, box, mapping, shape
from shapely.ops import unary_union

REPO = Path(__file__).resolve().parents[1]
RAW = REPO / "pipeline" / "raw"
FUENTES = REPO / "investigacion" / "fuentes"
SALIDA = REPO / "web" / "data"
RAW.mkdir(exist_ok=True)
SALIDA.mkdir(exist_ok=True)

WFS = ("https://geosinav30.conagua.gob.mx:8080/geoserver/Sina/ows?service=WFS&version=2.0.0"
       "&request=GetFeature&outputFormat=application/json")
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/126 Safari/537.36"}
HOY = datetime.now(timezone.utc).strftime("%Y-%m-%d")

CELDA = 0.02                      # ~2.2 km
CAJA = (24.3, 26.0, -100.95, -99.35)   # lat_min, lat_max, lon_min, lon_max
VIDA_MEDIA_ANIOS = 5              # peso de un incendio: la mitad cada 5 años (cicatriz reciente)
PENDIENTE_MAX = 35                # grados; tope operativo de plantación (Contexto_Arbol.md)
# Fuera de la sierra: valle metropolitano debajo de 800 m, o cualquier sitio debajo de 500 m
CAJA_METRO = (25.55, 25.85, -100.60, -100.00)


def fuera_de_sierra(c):
    la, lo = c["centro"]
    en_metro = CAJA_METRO[0] <= la <= CAJA_METRO[1] and CAJA_METRO[2] <= lo <= CAJA_METRO[3]
    return c["elev"] < 500 or (en_metro and c["elev"] < 800)
SEPARACION_KM = 8                 # distancia mínima entre zonas de la lista corta
N_AGUA, N_AIRE_COLONIAS = 8, 3
CUENCAS_PRESA = {"2433": "El Cuchillo", "2531": "Cerro Prieto", "2532": "Cerro Prieto"}
ACUIFEROS_ZMM = {"1906", "1907", "1908", "1909", "1910", "1911"}   # campos de pozos que surten a la ZMM
ESTACIONES_RETO3 = ["Pesqueria", "Cadereyta", "Juárez", "Santa Catarina", "García"]
LUGARES = {
    "Santiago": (25.42, -100.15), "Laguna de Sánchez": (25.35, -100.28), "Ciénega de González": (25.38, -100.22),
    "Allende": (25.28, -100.02), "Montemorelos": (25.19, -99.83), "Rayones": (25.02, -100.08),
    "Galeana": (24.83, -100.07), "Iturbide": (24.73, -99.90), "Linares": (24.86, -99.57),
    "Santa Catarina": (25.67, -100.46), "San Pedro Garza García": (25.66, -100.40), "Monterrey": (25.67, -100.31),
    "Guadalupe": (25.68, -100.26), "Juárez": (25.65, -100.10), "Cadereyta": (25.59, -99.98),
    "Hualahuises": (24.88, -99.67), "General Terán": (25.26, -99.68), "Arteaga": (25.45, -100.85),
}
MUNICIPIO_DE = {"Laguna de Sánchez": "Santiago", "Ciénega de González": "Santiago", "Arteaga": "Arteaga, Coah."}


# ---------------- utilidades ----------------
def wfs(capa, cql=None):
    archivo = RAW / f"{capa}.json"
    if archivo.exists():
        return json.loads(archivo.read_text())
    url = f"{WFS}&typeNames=Sina:{capa}" + (f"&CQL_FILTER={requests.utils.quote(cql)}" if cql else "")
    r = requests.get(url, headers=UA, timeout=180)
    r.raise_for_status()
    archivo.write_text(r.text)
    return r.json()


def a_wgs(x, y):
    """EPSG:3857 → lon, lat."""
    return x / 6378137 * 180 / math.pi, (2 * math.atan(math.exp(y / 6378137)) - math.pi / 2) * 180 / math.pi


def geom_wgs(g):
    def conv(c):
        return [a_wgs(*c[:2])] if isinstance(c[0], (int, float)) else [conv(x) for x in c]
    def conv_anillo(c):
        return [a_wgs(*p[:2]) for p in c]
    if g["type"] == "Polygon":
        coords = [conv_anillo(a) for a in g["coordinates"]]
    elif g["type"] == "MultiPolygon":
        coords = [[conv_anillo(a) for a in p] for p in g["coordinates"]]
    else:
        coords = a_wgs(*g["coordinates"][:2])
    return shape({"type": g["type"], "coordinates": coords})


def texto(s):
    """Corrige la doble codificación UTF-8 de SINA (JesÃºs → Jesús)."""
    if not s:
        return s
    try:
        return s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def titulo(s):
    """Nombre de paraje legible: sin «P.P.» (pequeña propiedad) y con artículos en minúscula."""
    import re
    s = re.sub(r"^\s*(P\.\s*P\.?|PP)\s+", "", s.strip(), flags=re.I)
    menores = {"de", "del", "la", "las", "los", "el", "y"}
    palabras = s.lower().split()
    return " ".join(w if (k and w in menores) else w[:1].upper() + w[1:] for k, w in enumerate(palabras))


def km(a, b):
    (la1, lo1), (la2, lo2) = a, b
    return math.hypot((la1 - la2) * 111, (lo1 - lo2) * 111 * math.cos(math.radians(la1)))


def cercano(lat, lon):
    return min(LUGARES, key=lambda n: km((lat, lon), LUGARES[n]))


def celda_de(lat, lon):
    return (int((lat - CAJA[0]) // CELDA), int((lon - CAJA[2]) // CELDA))


def caja_celda(i, j):
    la, lo = CAJA[0] + i * CELDA, CAJA[2] + j * CELDA
    return box(lo, la, lo + CELDA, la + CELDA)


def lista_corta(candidatos, n, sep_km):
    elegidos = []
    for c in sorted(candidatos, key=lambda c: -c["score_raw"]):
        if all(km(c["centro"], e["centro"]) >= sep_km for e in elegidos):
            elegidos.append(c)
        if len(elegidos) == n:
            break
    return elegidos


def pendiente_grados(puntos):
    """Pendiente local con el modelo de elevación Copernicus (Open-Meteo): 4 vecinos a 500 m."""
    d = 0.0045
    lats, lons = [], []
    for la, lo in puntos:
        for dla, dlo in [(0, 0), (d, 0), (-d, 0), (0, d), (0, -d)]:
            lats.append(la + dla)
            lons.append(lo + dlo)
    elev = []
    for k in range(0, len(lats), 100):
        r = requests.get("https://api.open-meteo.com/v1/elevation", timeout=60,
                         params={"latitude": ",".join(f"{x:.5f}" for x in lats[k:k + 100]),
                                 "longitude": ",".join(f"{x:.5f}" for x in lons[k:k + 100])})
        r.raise_for_status()
        elev += r.json()["elevation"]
        time.sleep(0.5)
    salida = []
    for k, (la, lo) in enumerate(puntos):
        e0, en, es, ee, eo = elev[5 * k:5 * k + 5]
        dy = 2 * d * 111000
        dx = 2 * d * 111000 * math.cos(math.radians(la))
        g = math.hypot((en - es) / dy, (ee - eo) / dx)
        salida.append((e0, math.degrees(math.atan(g))))
    return salida


def fc(features):
    return {"type": "FeatureCollection", "features": features}


def escribe(nombre, datos):
    (SALIDA / nombre).write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":")))
    print(f"  web/data/{nombre}")


# ---------------- agua ----------------
def agua():
    print("Agua: cuencas, acuíferos e incendios")
    cuencas = wfs("m00_cuencas", "clvrh IN ('RH024','RH025')")
    cuencas_presa = {}
    for f in cuencas["features"]:
        clave = f["properties"]["clvcuenca"]
        if clave in CUENCAS_PRESA:
            cuencas_presa.setdefault(CUENCAS_PRESA[clave], []).append(
                (geom_wgs(f["geometry"]), texto(f["properties"]["cuenca"])))
    cuencas_presa = {p: (unary_union([g for g, _ in v]), " y ".join(n for _, n in v)) for p, v in cuencas_presa.items()}

    acu = wfs("m06_acuiferos_disponibilidad", "clvacuifero LIKE '19%'")
    ultimo = {}
    for f in acu["features"]:
        p = f["properties"]
        if p["clvacuifero"] not in ultimo or (p["fechapub"] or "") > (ultimo[p["clvacuifero"]]["properties"]["fechapub"] or ""):
            ultimo[p["clvacuifero"]] = f
    acuiferos = []
    for clave, f in ultimo.items():
        p = f["properties"]
        deficit = p.get("situacion") == "Sin Disponibilidad"
        acuiferos.append(dict(clave=clave, nombre=texto(p["acuifero"]), deficit=deficit, zmm=clave in ACUIFEROS_ZMM,
                              geom=geom_wgs(f["geometry"]), fecha=p["fechapub"]))
    n_def = sum(a["deficit"] for a in acuiferos)
    print(f"  {len(acuiferos)} acuíferos de NL, {n_def} en déficit (publicación más reciente de cada uno)")

    sina = json.loads((FUENTES / "sina" / "incendios_nl.json").read_text())["features"]
    incendios = []
    for f in sina:
        p = f["properties"]
        incendios.append(dict(lat=float(p["x"]), lon=float(p["y"]), anio=int(p["anio"]), fecha=p["fechainic"],
                              municipio=texto(p["municipio"]), ha=float(p["totalha"] or 0),
                              tipoveget=texto(p["tipoveget"]), paraje=texto(p["prediopar"]), causa=texto(p["causa"]),
                              fuente="CONAGUA"))
    # Satélite 2024-2025: episodios por celda (detecciones con menos de 3 días de separación)
    import csv
    det = list(csv.DictReader(open(FUENTES / "firms" / "viirs_vegetacion_2024_2025.csv")))
    det.sort(key=lambda r: (celda_de(float(r["latitude"]), float(r["longitude"])), r["acq_date"]))
    episodios, previo = [], None
    for r in det:
        c, fecha = celda_de(float(r["latitude"]), float(r["longitude"])), r["acq_date"]
        if previo and previo["celda"] == c and (datetime.fromisoformat(fecha) - datetime.fromisoformat(previo["fin"])).days <= 3:
            previo["n"] += 1
            previo["fin"] = fecha
            previo["pts"].append((float(r["latitude"]), float(r["longitude"])))
        else:
            previo = dict(celda=c, inicio=fecha, fin=fecha, n=1, pts=[(float(r["latitude"]), float(r["longitude"]))])
            episodios.append(previo)
    for e in episodios:
        la = sum(p[0] for p in e["pts"]) / e["n"]
        lo = sum(p[1] for p in e["pts"]) / e["n"]
        e.update(lat=la, lon=lo)
    sat = [e for e in episodios if e["n"] >= 3]
    print(f"  {len(incendios)} incendios CONAGUA 2005-2023; {len(sat)} episodios satelitales 2024-2025 (3+ detecciones)")

    # Celdas
    celdas = {}
    def celda(lat, lon):
        c = celda_de(lat, lon)
        return celdas.setdefault(c, dict(ij=c, ha_w=0.0, ha=0.0, n=0, det=0, parajes={}, municipios={}, anios=[]))
    for i in incendios:
        if not (CAJA[0] <= i["lat"] < CAJA[1] and CAJA[2] <= i["lon"] < CAJA[3]):
            continue
        c = celda(i["lat"], i["lon"])
        c["ha_w"] += i["ha"] * 0.5 ** ((2025 - i["anio"]) / VIDA_MEDIA_ANIOS)
        c["ha"] += i["ha"]
        c["n"] += 1
        c["anios"].append(i["anio"])
        if i["paraje"]:
            c["parajes"][i["paraje"]] = c["parajes"].get(i["paraje"], 0) + i["ha"]
        c["municipios"][i["municipio"]] = c["municipios"].get(i["municipio"], 0) + 1
    for e in sat:
        if CAJA[0] <= e["lat"] < CAJA[1] and CAJA[2] <= e["lon"] < CAJA[3]:
            celda(e["lat"], e["lon"])["det"] += e["n"]

    max_h = max(math.log1p(c["ha_w"]) for c in celdas.values()) or 1
    max_d = max(math.log1p(c["det"]) for c in celdas.values()) or 1
    candidatos, descartados = [], []
    for c in celdas.values():
        g = caja_celda(*c["ij"])
        centro = (g.centroid.y, g.centroid.x)
        pt = Point(centro[1], centro[0])
        presa = next(((p, n) for p, (geom, n) in cuencas_presa.items() if geom.contains(pt)), None)
        acuifero = next((a for a in acuiferos if a["geom"].contains(pt)), None)
        c["score_raw"] = 0.6 * math.log1p(c["ha_w"]) / max_h + 0.4 * math.log1p(c["det"]) / max_d
        if presa and acuifero and acuifero["deficit"]:
            c["score_raw"] += 0.1
        c.update(centro=centro, geom=g, presa=presa, acuifero=acuifero)
        destino_zmm = presa or (acuifero and acuifero["zmm"])
        (candidatos if destino_zmm else descartados).append(c)
    print(f"  {len(celdas)} celdas con incendios: {len(candidatos)} drenan a una presa o recargan un acuífero de la ZMM")

    previos = lista_corta(candidatos, N_AGUA * 3, SEPARACION_KM)
    pend = pendiente_grados([c["centro"] for c in previos])
    for c, (elev, pdeg) in zip(previos, pend):
        c["elev"], c["pendiente"] = elev, pdeg
    plantables = [c for c in previos if c["pendiente"] <= PENDIENTE_MAX and not fuera_de_sierra(c)]
    elegidos = lista_corta(plantables, N_AGUA, SEPARACION_KM)
    top = max(c["score_raw"] for c in elegidos)

    zonas = []
    for k, c in enumerate(elegidos, 1):
        lat, lon = c["centro"]
        ref = cercano(lat, lon)
        municipio = (max(c["municipios"], key=c["municipios"].get) if c["municipios"]
                     else MUNICIPIO_DE.get(ref, ref))
        paraje = titulo(max(c["parajes"], key=c["parajes"].get)) if c["parajes"] else None
        lugar = paraje or (f"una ladera quemada en {municipio}" if ref == municipio
                           else f"una ladera quemada cerca de {ref}")
        razones = []
        if c["n"]:
            a0, a1 = min(c["anios"]), max(c["anios"])
            cuando = f"en {a0}" if a0 == a1 else f"entre {a0} y {a1}"
            razones.append(f"{c['n']} {'incendio' if c['n'] == 1 else 'incendios'} {cuando} "
                           f"({c['ha']:,.0f} ha, CONAGUA)")
        if c["det"]:
            razones.append(f"{c['det']} detecciones de fuego por satélite en 2024-2025")
        if c["presa"]:
            razones.append(f"Drena hacia la presa {c['presa'][0]} (cuenca {c['presa'][1]}, DOF)")
        if c["acuifero"]:
            a = c["acuifero"]
            razones.append(f"Sobre el acuífero en déficit: {a['nombre']}" if a["deficit"] else f"Sobre el acuífero {a['nombre']}")
        razones.append(f"Pendiente media {c['pendiente']:.0f}°, plantable")
        zonas.append(dict(type="Feature", geometry=mapping(c["geom"]), properties=dict(
            id=f"AG-{k:02d}", objetivo="agua", rank=k, score=round(100 * c["score_raw"] / top, 1),
            nombre=f"{municipio} · {lugar}", municipio=municipio, razones=razones,
            metricas=dict(incendios=c["n"], ha_quemadas=round(c["ha"], 1), detecciones_2024_2025=c["det"],
                          pendiente_grados=round(c["pendiente"], 1), elevacion_m=round(c["elev"])),
            centro=[round(lat, 5), round(lon, 5)])))

    # Sitios con fuego que no entran: lo que pide la fase 1 del Contexto
    descartados.sort(key=lambda c: -c["score_raw"])
    lineas = ["# Sitios descartados (agua)", "",
              f"Generado por `pipeline/build.py` el {HOY}. Celdas de ~2 km con más historia de incendios que **no** drenan "
              "a una presa de abastecimiento (El Cuchillo, Cerro Prieto) ni recargan un acuífero que surte a la zona "
              "metropolitana. Más las que sí drenan pero tienen pendiente mayor a 35°.", "",
              "| Municipio | Centro | Incendios 2005-2023 (ha) | Detecciones 2024-2025 | Motivo |", "|---|---|---|---|---|"]
    for c in descartados[:12]:
        mun = max(c["municipios"], key=c["municipios"].get) if c["municipios"] else cercano(*c["centro"])
        lineas.append(f"| {mun} | {c['centro'][0]:.3f}, {c['centro'][1]:.3f} | {c['n']} ({c['ha']:.0f}) | {c['det']} | "
                      "Fuera de la cuenca de una presa de abastecimiento y de los acuíferos de la ZMM |")
    for c in previos:
        if fuera_de_sierra(c) and c["pendiente"] <= PENDIENTE_MAX:
            mun = max(c["municipios"], key=c["municipios"].get) if c["municipios"] else cercano(*c["centro"])
            lineas.append(f"| {mun} | {c['centro'][0]:.3f}, {c['centro'][1]:.3f} | {c['n']} ({c['ha']:.0f}) | {c['det']} | "
                          f"Elevación {c['elev']:.0f} m: valle o pie de monte, fuera de la sierra |")
        if c["pendiente"] > PENDIENTE_MAX:
            mun = max(c["municipios"], key=c["municipios"].get) if c["municipios"] else cercano(*c["centro"])
            lineas.append(f"| {mun} | {c['centro'][0]:.3f}, {c['centro'][1]:.3f} | {c['n']} ({c['ha']:.0f}) | {c['det']} | "
                          f"Pendiente media {c['pendiente']:.0f}°, mayor al tope de {PENDIENTE_MAX}° |")
    (REPO / "docs" / "sitios_descartados.md").write_text("\n".join(lineas) + "\n")

    inc_geo = [dict(type="Feature", geometry=dict(type="Point", coordinates=[round(i["lon"], 5), round(i["lat"], 5)]),
                    properties=dict(anio=i["anio"], fecha=i["fecha"], municipio=i["municipio"], ha=i["ha"],
                                    tipoveget=i["tipoveget"], fuente="CONAGUA")) for i in incendios]
    inc_geo += [dict(type="Feature", geometry=dict(type="Point", coordinates=[round(e["lon"], 5), round(e["lat"], 5)]),
                     properties=dict(anio=int(e["inicio"][:4]), fecha=e["inicio"], municipio=cercano(e["lat"], e["lon"]),
                                     ha=None, tipoveget="Detección satelital VIIRS", detecciones=e["n"],
                                     fuente="NASA FIRMS")) for e in sat]
    cuencas_geo = [dict(type="Feature", geometry=mapping(g.simplify(0.003)), properties=dict(cuenca=n, presa_destino=p))
                   for p, (g, n) in cuencas_presa.items()]
    resumen = dict(incendios=len(incendios), ha=sum(i["ha"] for i in incendios), satelite=len(sat), n_def=n_def,
                   n_acu=len(acuiferos))
    return zonas, inc_geo, cuencas_geo, resumen


# ---------------- aire ----------------
def aire():
    print("Aire: colonias de Monterrey y estaciones del SIMA")
    uesi = json.loads((FUENTES / "mide" / "uesi_mty2022.geojson").read_text())["features"]
    col = [f for f in uesi if f["properties"].get("pm25") and f["properties"].get("population")]
    def norm(v, vals):
        lo, hi = min(vals), max(vals)
        return (v - lo) / (hi - lo) if hi > lo else 0
    pm = [f["properties"]["pm25"] for f in col]
    copa = [f["properties"]["treeprop"] or 0 for f in col]
    calor = [f["properties"]["uhi"] or 0 for f in col]
    pob = [math.log1p(f["properties"]["population"]) for f in col]
    candidatos = []
    for f in col:
        p = f["properties"]
        s = (0.35 * norm(p["pm25"], pm) + 0.30 * (1 - norm(p["treeprop"] or 0, copa)) +
             0.20 * norm(p["uhi"] or 0, calor) + 0.15 * norm(math.log1p(p["population"]), pob))
        g = shape(f["geometry"])
        candidatos.append(dict(f=f, score_raw=s, centro=(g.centroid.y, g.centroid.x), geom=g))
    colonias = lista_corta(candidatos, N_AIRE_COLONIAS, 1.5)

    estaciones = []
    import csv
    for r in csv.DictReader(open(REPO / "pipeline" / "sima_estaciones.csv")):
        estaciones.append(dict(estacion=r["estacion"], municipio=r["municipio"], lat=float(r["lat"]), lon=float(r["lon"])))

    zonas, k = [], 0
    top = max(c["score_raw"] for c in colonias)
    for c in colonias:
        k += 1
        p = c["f"]["properties"]
        zonas.append(dict(type="Feature", geometry=mapping(c["geom"]), properties=dict(
            id=f"AI-{k:02d}", objetivo="aire", rank=k, score=round(100 * c["score_raw"] / top, 1),
            nombre=f"Monterrey · {p['nbhd_name']}", municipio="Monterrey",
            razones=[f"PM2.5 estimado {p['pm25']:.1f} µg/m³, arriba de la guía de la OMS (5 µg/m³)",
                     f"Copa arbórea {100 * (p['treeprop'] or 0):.0f} % de la colonia",
                     f"Isla de calor de {p['uhi']:.1f} °C", f"{int(p['population']):,} habitantes (MIDE Monterrey 2022)"],
            metricas=dict(pm25=p["pm25"], no2=p["no2"], copa_pct=round(100 * (p["treeprop"] or 0), 1),
                          isla_calor_c=p["uhi"], poblacion=int(p["population"])),
            centro=[round(c["centro"][0], 5), round(c["centro"][1], 5)])))
    for mun in ESTACIONES_RETO3:
        e = next(x for x in estaciones if x["municipio"] == mun)
        k += 1
        nombre_mun = "Pesquería" if mun == "Pesqueria" else mun
        razones = [f"Municipio señalado en el reto 3 por mala calidad del aire (estación {e['estacion']})",
                   "Prioridad por señalamiento: el SIMA no ofrece hoy datos descargables para ordenar estas zonas"]
        if mun == "García":
            razones.insert(1, "Los niveles más altos de PM10 y PM2.5 de la zona metropolitana se miden en García "
                              "(Centro Mario Molina, 2018)")
        zonas.append(dict(type="Feature", geometry=mapping(Point(e["lon"], e["lat"]).buffer(0.01, cap_style=3)),
                          properties=dict(id=f"AI-{k:02d}", objetivo="aire", rank=k, score=None,
                                          nombre=f"{nombre_mun} · alrededor de estación {e['estacion']}",
                                          municipio=nombre_mun, razones=razones, metricas={},
                                          centro=[e["lat"], e["lon"]])))
    est_geo = [dict(type="Feature", geometry=dict(type="Point", coordinates=[e["lon"], e["lat"]]),
                    properties=dict(estacion=e["estacion"], municipio=e["municipio"], pm10=None, pm25=None,
                                    periodo="sin datos públicos descargables (14-oct-2026)")) for e in estaciones]
    return zonas, est_geo


# ---------------- presas ----------------
def presas():
    cat = wfs("m09_presasprincipales")
    claves = {"CCHNL", "LBCNL", "CPRNL"}
    import csv
    ultimo = {}
    for r in csv.DictReader(open(FUENTES / "build-day" / "presas_san_juan_bravo_2020_2025.csv")):
        if r["clavesih"] in claves and r["fechamonitoreo"] >= ultimo.get(r["clavesih"], {}).get("fechamonitoreo", ""):
            ultimo[r["clavesih"]] = r
    salida = []
    for f in cat["features"]:
        p = f["properties"]
        if p["clavesih"] in claves:
            u = ultimo.get(p["clavesih"], {})
            salida.append(dict(type="Feature", geometry=f["geometry"], properties=dict(
                clavesih=p["clavesih"], nombre=texto(p["nombrecomun"]),
                almacenamiento_mm3=float(u["almacenaactual"]) if u else None,
                llenado_pct=round(100 * float(u["llenano"]), 1) if u else None, fecha=u.get("fechamonitoreo"))))
    return salida


def main():
    zonas_agua, incendios, cuencas, ra = agua()
    zonas_aire, estaciones = aire()
    lista_presas = presas()
    print("Escribiendo")
    escribe("zonas.geojson", fc(zonas_agua + zonas_aire))
    escribe("incendios.geojson", fc(incendios))
    escribe("cuencas.geojson", fc(cuencas))
    escribe("presas.geojson", fc(lista_presas))
    escribe("estaciones.geojson", fc(estaciones))
    escribe("resumen.json", dict(
        generado=datetime.now().astimezone().isoformat(timespec="seconds"),
        incendios_total=ra["incendios"] + ra["satelite"], ha_quemadas_total=round(ra["ha"], 1),
        periodo_incendios="2005–2025", zonas_agua=len(zonas_agua), zonas_aire=len(zonas_aire),
        nota=(f"{ra['incendios']} incendios con superficie de CONAGUA (2005-2023) y {ra['satelite']} episodios "
              "detectados por satélite en 2024-2025 sin superficie; las hectáreas son sólo de CONAGUA."),
        fuentes=[
            dict(nombre="CONAGUA SINA · incendios forestales históricos de NL (2005-2023)",
                 url="https://geosinav30.conagua.gob.mx:8080/geoserver/Sina/ows", fecha=HOY),
            dict(nombre="NASA FIRMS · detecciones VIIRS de vegetación (2024-2025)",
                 url="https://firms.modaps.eosdis.nasa.gov/", fecha=HOY),
            dict(nombre="CONAGUA SINA · cuencas hidrológicas DOF (Río San Juan 1, Río Pablillo 1 y 2)",
                 url="https://geosinav30.conagua.gob.mx:8080/geoserver/Sina/ows", fecha=HOY),
            dict(nombre=f"CONAGUA SINA · disponibilidad de acuíferos de NL ({ra['n_def']} de {ra['n_acu']} en déficit)",
                 url="https://geosinav30.conagua.gob.mx:8080/geoserver/Sina/ows", fecha=HOY),
            dict(nombre="Copernicus DEM vía Open-Meteo · pendiente", url="https://open-meteo.com/en/docs/elevation-api",
                 fecha=HOY),
            dict(nombre="MIDE Monterrey · índice urbano (PM2.5, copa arbórea, calor) por colonia, 2022",
                 url="https://mide.monterrey.gob.mx/", fecha=HOY),
            dict(nombre="SIMA Nuevo León · estaciones de calidad del aire", url="https://aire.nl.gob.mx/", fecha=HOY),
            dict(nombre="CONAGUA · almacenamiento de presas (último dato publicado, abr-2025)",
                 url="https://sinav30.conagua.gob.mx:8080/PresasPG/presas/reporte/", fecha=HOY),
        ]))
    print(f"\n{len(zonas_agua)} zonas de agua y {len(zonas_aire)} de aire")
    for z in zonas_agua + zonas_aire:
        p = z["properties"]
        print(f"  {p['id']} {p['score']} {p['nombre']} | {'; '.join(p['razones'])[:150]}")


if __name__ == "__main__":
    main()
