"""Lectura de los feeds ATOM/CODICE de la Plataforma de Contratación del Sector Público."""
from __future__ import annotations

import re
from lxml import etree

from .nuts import ubicar

NS = {
    "a": "http://www.w3.org/2005/Atom",
    "cbc": "urn:dgpe:names:draft:codice:schema:xsd:CommonBasicComponents-2",
    "cac": "urn:dgpe:names:draft:codice:schema:xsd:CommonAggregateComponents-2",
    "cacx": "urn:dgpe:names:draft:codice-place-ext:schema:xsd:CommonAggregateComponents-2",
    "cbcx": "urn:dgpe:names:draft:codice-place-ext:schema:xsd:CommonBasicComponents-2",
    "at": "http://purl.org/atompub/tombstones/1.0",
}

ESTADOS = {
    "PRE": "Anuncio previo", "PUB": "En plazo", "EV": "Pendiente de adjudicación",
    "EV_PRE": "Evaluación previa", "ADJ": "Adjudicada", "ADJ_PAR": "Parcialmente adjudicada",
    "RES": "Resuelta", "RES_PAR": "Parcialmente resuelta", "ANUL": "Anulada",
    "DES": "Desistida", "CERR": "Cerrada", "CREA": "Creada",
}
TIPOS = {"1": "Suministros", "2": "Servicios", "3": "Obras", "21": "Gestión de servicios públicos",
         "22": "Concesión de servicios", "31": "Concesión de obras públicas", "32": "Concesión de obras",
         "7": "Administrativo especial", "8": "Privado", "40": "Colaboración público-privada", "50": "Patrimonial"}
PROCEDIMIENTOS = {"1": "Abierto", "2": "Restringido", "3": "Negociado sin publicidad",
                  "4": "Negociado con publicidad", "5": "Diálogo competitivo", "6": "Contrato menor",
                  "7": "Derivado de acuerdo marco", "8": "Concurso de proyectos", "9": "Abierto simplificado",
                  "10": "Asociación para la innovación", "11": "Derivado de asociación para la innovación",
                  "12": "Basado en sistema dinámico", "13": "Licitación con negociación",
                  "100": "Normas internas", "999": "Otros"}
SISTEMAS = {"0": "No aplica", "1": "Acuerdo marco", "2": "Sistema dinámico de adquisición",
            "3": "Acuerdo marco y sistema dinámico"}
URGENCIA = {"1": "Ordinaria", "2": "Urgente", "3": "Emergencia"}


def _t(el, path: str) -> str:
    """Texto del primer nodo que cumple el xpath (relativo), o ''."""
    if el is None:
        return ""
    r = el.xpath(path, namespaces=NS)
    if not r:
        return ""
    v = r[0]
    if isinstance(v, str):
        return v.strip()
    return (v.text or "").strip()


def _f(el, path: str) -> float | None:
    s = _t(el, path)
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _criterios(el) -> list[dict]:
    out = []
    for c in el.xpath("./cac:TenderingTerms/cac:AwardingTerms/cac:AwardingCriteria", namespaces=NS):
        out.append({
            "tipo": _t(c, "./cbc:AwardingCriteriaTypeCode"),         # OBJ / SUBJ
            "subtipo": _t(c, "./cbc:AwardingCriteriaSubTypeCode"),   # 1 = precio
            "descripcion": _t(c, "./cbc:Description"),
            "peso": _f(c, "./cbc:WeightNumeric"),
        })
    return out


def peso_precio(criterios: list[dict]) -> float | None:
    """Peso (0-100) del criterio precio, si se puede deducir."""
    if not criterios:
        return None
    total = sum(c["peso"] or 0 for c in criterios)
    precio = 0.0
    for c in criterios:
        d = (c["descripcion"] or "").lower()
        if c["subtipo"] == "1" or re.search(r"precio|econ[oó]mic|preu|oferta econ|baja", d):
            precio += c["peso"] or 0
    if total <= 0:
        return None
    return round(100 * precio / total, 1)


def _docs(cf) -> list[dict]:
    out = []
    for tag, tipo in (("cac:LegalDocumentReference", "PCAP"), ("cac:TechnicalDocumentReference", "PPT"),
                      ("cac:AdditionalDocumentReference", "Otro")):
        for d in cf.xpath(f"./{tag}", namespaces=NS):
            url = _t(d, "./cac:Attachment/cac:ExternalReference/cbc:URI")
            if url:
                out.append({"tipo": tipo, "nombre": _t(d, "./cbc:ID"), "url": url})
    return out


def _cpvs(el) -> list[str]:
    return [x.text.strip() for x in el.xpath("./cac:RequiredCommodityClassification/cbc:ItemClassificationCode",
                                              namespaces=NS) if x.text]


def _resultados(cf) -> list[dict]:
    out = []
    for r in cf.xpath("./cac:TenderResult", namespaces=NS):
        out.append({
            "lote": _t(r, "./cac:AwardedTenderedProject/cbc:ProcurementProjectLotID") or _t(r, "./cbc:ProcurementProjectLotID"),
            "codigo": _t(r, "./cbc:ResultCode"),
            "fecha": _t(r, "./cbc:AwardDate"),
            "ofertas": _f(r, "./cbc:ReceivedTenderQuantity"),
            "ofertas_pyme": _f(r, "./cbc:SMEsReceivedTenderQuantity"),
            "ganador": _t(r, "./cac:WinningParty/cac:PartyName/cbc:Name"),
            "ganador_nif": _t(r, "./cac:WinningParty/cac:PartyIdentification/cbc:ID"),
            "importe": _f(r, "./cac:AwardedTenderedProject/cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount"),
            "importe_iva": _f(r, "./cac:AwardedTenderedProject/cac:LegalMonetaryTotal/cbc:PayableAmount"),
            "baja_max": _f(r, "./cbc:HigherTenderAmount"),
            "baja_min": _f(r, "./cbc:LowerTenderAmount"),
        })
    return out


def _requisitos(cf) -> dict:
    q = cf.xpath("./cac:TenderingTerms/cac:TendererQualificationRequest", namespaces=NS)
    if not q:
        return {"tecnica": [], "economica": [], "otros": []}
    q = q[0]
    return {
        "tecnica": [x.text.strip() for x in q.xpath("./cac:TechnicalEvaluationCriteria/cbc:Description", namespaces=NS) if x.text],
        "economica": [x.text.strip() for x in q.xpath("./cac:FinancialEvaluationCriteria/cbc:Description", namespaces=NS) if x.text],
        "otros": [x.text.strip() for x in q.xpath("./cac:SpecificTendererRequirement/cbc:Description", namespaces=NS) if x.text],
    }


def parse_entry(e, fuente: str) -> dict | None:
    cf = e.find("cacx:ContractFolderStatus", NS)
    if cf is None:
        return None
    pp = cf.find("cac:ProcurementProject", NS)
    party = cf.find("cacx:LocatedContractingParty", NS)
    tp = cf.find("cac:TenderingProcess", NS)

    jerarquia = [x.text.strip() for x in party.xpath(".//cacx:ParentLocatedParty/cac:PartyName/cbc:Name", namespaces=NS)
                 if x.text] if party is not None else []
    nuts = _t(pp, "./cac:RealizedLocation/cbc:CountrySubentityCode")
    ccaa, provincia = ubicar(nuts, jerarquia)

    nif = ""
    if party is not None:
        for pid in party.xpath("./cac:Party/cac:PartyIdentification/cbc:ID", namespaces=NS):
            if pid.get("schemeName") == "NIF":
                nif = (pid.text or "").strip()

    lotes = []
    for lot in cf.xpath("./cac:ProcurementProjectLot", namespaces=NS):
        lpp = lot.find("cac:ProcurementProject", NS)
        crit = _criterios(lot)
        lotes.append({
            "id": _t(lot, "./cbc:ID"),
            "nombre": _t(lpp, "./cbc:Name"),
            "importe": _f(lpp, "./cac:BudgetAmount/cbc:TaxExclusiveAmount"),
            "cpv": _cpvs(lpp) if lpp is not None else [],
            "criterios": crit,
            "peso_precio": peso_precio(crit),
        })

    criterios = _criterios(cf)
    if not criterios and lotes:
        criterios = lotes[0]["criterios"]

    cpv = _cpvs(pp) if pp is not None else []
    for l in lotes:
        for c in l["cpv"]:
            if c not in cpv:
                cpv.append(c)

    fecha_fin = _t(tp, "./cac:TenderSubmissionDeadlinePeriod/cbc:EndDate")
    hora_fin = _t(tp, "./cac:TenderSubmissionDeadlinePeriod/cbc:EndTime")

    link = ""
    le = e.find("a:link", NS)
    if le is not None:
        link = le.get("href", "")

    estado = _t(cf, "./cbcx:ContractFolderStatusCode")
    return {
        "id": _t(e, "./a:id"),
        "fuente": fuente,
        "actualizado": _t(e, "./a:updated"),
        "enlace": link,
        "titulo": re.sub(r"\s+", " ", _t(e, "./a:title")),
        "expediente": _t(cf, "./cbc:ContractFolderID"),
        "estado": estado,
        "estado_txt": ESTADOS.get(estado, estado),
        "organo": _t(party, "./cac:Party/cac:PartyName/cbc:Name"),
        "organo_nif": nif,
        "perfil": _t(party, "./cbc:BuyerProfileURIID"),
        "jerarquia": jerarquia,
        "tipo": _t(pp, "./cbc:TypeCode"),
        "tipo_txt": TIPOS.get(_t(pp, "./cbc:TypeCode"), ""),
        "mixto": _t(pp, "./cbc:MixContractIndicator") == "true",
        "importe": _f(pp, "./cac:BudgetAmount/cbc:TaxExclusiveAmount"),
        "importe_iva": _f(pp, "./cac:BudgetAmount/cbc:TotalAmount"),
        "valor_estimado": _f(pp, "./cac:BudgetAmount/cbc:EstimatedOverallContractAmount"),
        "cpv": cpv,
        "nuts": nuts,
        "ccaa": ccaa,
        "provincia": provincia,
        "municipio": _t(pp, "./cac:RealizedLocation/cac:Address/cbc:CityName"),
        "duracion": (_t(pp, "./cac:PlannedPeriod/cbc:DurationMeasure") + " " +
                     (pp.xpath("./cac:PlannedPeriod/cbc:DurationMeasure/@unitCode", namespaces=NS) or [""])[0]).strip()
        if pp is not None else "",
        "procedimiento": _t(tp, "./cbc:ProcedureCode"),
        "procedimiento_txt": PROCEDIMIENTOS.get(_t(tp, "./cbc:ProcedureCode"), ""),
        "urgencia": URGENCIA.get(_t(tp, "./cbc:UrgencyCode"), ""),
        "sistema": SISTEMAS.get(_t(tp, "./cbc:ContractingSystemCode"), ""),
        "armonizado": _t(tp, "./cbc:OverThresholdIndicator") == "true",
        "fecha_fin": fecha_fin,
        "hora_fin": hora_fin[:5],
        "criterios": criterios,
        "peso_precio": peso_precio(criterios),
        "requisitos": _requisitos(cf),
        "idiomas": [x.text for x in cf.xpath("./cac:TenderingTerms/cac:Language/cbc:ID", namespaces=NS) if x.text],
        "lotes": lotes,
        "documentos": _docs(cf),
        "resultados": _resultados(cf),
    }


def parse_feed(xml: bytes, fuente: str) -> tuple[list[dict], list[dict], str | None]:
    """Devuelve (licitaciones, borrados, url_siguiente)."""
    root = etree.fromstring(xml, parser=etree.XMLParser(recover=True, huge_tree=True))
    items = []
    for e in root.findall("a:entry", NS):
        try:
            it = parse_entry(e, fuente)
            if it:
                items.append(it)
        except Exception as ex:  # una entrada rara no debe parar todo
            print("  aviso: entrada no leída:", ex)
    borrados = [{"id": d.get("ref"), "cuando": d.get("when")} for d in root.findall("at:deleted-entry", NS)]
    nxt = None
    for l in root.findall("a:link", NS):
        if l.get("rel") == "next":
            nxt = l.get("href")
    return items, borrados, nxt
