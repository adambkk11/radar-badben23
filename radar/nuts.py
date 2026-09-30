"""Códigos NUTS de España -> comunidad autónoma y provincia."""

CCAA = {
    "ES11": "Galicia", "ES12": "Asturias", "ES13": "Cantabria", "ES21": "País Vasco",
    "ES22": "Navarra", "ES23": "La Rioja", "ES24": "Aragón", "ES30": "Madrid",
    "ES41": "Castilla y León", "ES42": "Castilla-La Mancha", "ES43": "Extremadura",
    "ES51": "Cataluña", "ES52": "C. Valenciana", "ES53": "Illes Balears",
    "ES61": "Andalucía", "ES62": "Murcia", "ES63": "Ceuta", "ES64": "Melilla",
    "ES70": "Canarias",
}

PROVINCIAS = {
    "ES111": "A Coruña", "ES112": "Lugo", "ES113": "Ourense", "ES114": "Pontevedra",
    "ES120": "Asturias", "ES130": "Cantabria",
    "ES211": "Álava", "ES212": "Gipuzkoa", "ES213": "Bizkaia",
    "ES220": "Navarra", "ES230": "La Rioja",
    "ES241": "Huesca", "ES242": "Teruel", "ES243": "Zaragoza",
    "ES300": "Madrid",
    "ES411": "Ávila", "ES412": "Burgos", "ES413": "León", "ES414": "Palencia",
    "ES415": "Salamanca", "ES416": "Segovia", "ES417": "Soria", "ES418": "Valladolid",
    "ES419": "Zamora",
    "ES421": "Albacete", "ES422": "Ciudad Real", "ES423": "Cuenca", "ES424": "Guadalajara",
    "ES425": "Toledo",
    "ES431": "Badajoz", "ES432": "Cáceres",
    "ES511": "Barcelona", "ES512": "Girona", "ES513": "Lleida", "ES514": "Tarragona",
    "ES521": "Alicante", "ES522": "Castellón", "ES523": "Valencia",
    "ES531": "Eivissa y Formentera", "ES532": "Mallorca", "ES533": "Menorca",
    "ES611": "Almería", "ES612": "Cádiz", "ES613": "Córdoba", "ES614": "Granada",
    "ES615": "Huelva", "ES616": "Jaén", "ES617": "Málaga", "ES618": "Sevilla",
    "ES620": "Murcia", "ES630": "Ceuta", "ES640": "Melilla",
    "ES703": "El Hierro", "ES704": "Fuerteventura", "ES705": "Gran Canaria",
    "ES706": "La Gomera", "ES707": "La Palma", "ES708": "Lanzarote", "ES709": "Tenerife",
}

# Nombres que aparecen en la jerarquía del órgano -> CCAA (para cuando no hay NUTS)
NOMBRES_CCAA = {
    "andaluc": "Andalucía", "aragón": "Aragón", "aragon": "Aragón", "asturias": "Asturias",
    "balears": "Illes Balears", "baleares": "Illes Balears", "canarias": "Canarias",
    "cantabria": "Cantabria", "castilla y león": "Castilla y León", "castilla-la mancha": "Castilla-La Mancha",
    "castilla la mancha": "Castilla-La Mancha", "catalu": "Cataluña", "generalitat de catalunya": "Cataluña",
    "valencia": "C. Valenciana", "extremadura": "Extremadura", "galicia": "Galicia",
    "madrid": "Madrid", "murcia": "Murcia", "navarra": "Navarra", "país vasco": "País Vasco",
    "euskadi": "País Vasco", "rioja": "La Rioja", "ceuta": "Ceuta", "melilla": "Melilla",
}


def ubicar(nuts: str, jerarquia: list[str]) -> tuple[str, str]:
    """Devuelve (ccaa, provincia) a partir del código NUTS o de la jerarquía del órgano."""
    nuts = (nuts or "").strip().upper()
    prov = PROVINCIAS.get(nuts[:5], "")
    ccaa = CCAA.get(nuts[:4], "")
    if not ccaa:
        texto = " ".join(jerarquia).lower()
        for clave, nombre in NOMBRES_CCAA.items():
            if clave in texto:
                ccaa = nombre
                break
    if not ccaa and nuts.startswith("ES") and len(nuts) == 2:
        ccaa = "Estatal"
    return ccaa, prov
