# Radar BadBen23

Radar privado de licitaciones de **suministro** para Grupo BadBen23:

- Descarga cada 3 horas **todas** las licitaciones de la Plataforma de Contratación del Estado y de las plataformas autonómicas agregadas (Cataluña, Madrid, Euskadi, Andalucía, Galicia, Navarra, La Rioja…). Solo usa datos abiertos oficiales.
- Puntúa cada una de 0 a 100 según tu modelo (producto, simplificado, no armonizado, peso del precio, importe, plazo…) y explica por qué.
- La **IA gratuita** (Google Gemini y, si falla, Groq) lee los pliegos de las mejores y te dice: qué se compra, solvencia, si admite empresa nueva (art. 89.1 LCSP), ROLECE, muestras, plazos, riesgos, qué socio usar y si presentarse.
- **Histórico completo** (24 meses de TODAS las adjudicaciones de suministros y obras de España): búsqueda por palabras clave (con frases entre comillas y exclusiones con -palabra) y por CPV, filtros por comunidad, organismo, empresa e importe, y descarga a Excel (CSV).
- **Precio para ganar**: baja ganadora típica, reparto de bajas, ofertas por lote y % de contratos con un solo licitador para cualquier búsqueda.
- **Simulador de baja** en cada licitación abierta: con X% de baja, en cuántos contratos parecidos habrías ganado y a qué precio.
- **Fichas de competidores y organismos**: dónde gana cada empresa y con qué baja; a quién compra cada organismo, si hay un ganador habitual y qué contratos le vencen.
- **Próximas renovaciones**: contratos que terminan en los próximos meses y se volverán a licitar (para preparar la oferta antes de que salgan).
- **Tu tablero** (Me interesa → Pidiendo precios → Preparando → Presentada → Ganada/Perdida), notas, calendario de cierres y botón para copiar la petición de precios en inglés para proveedores.
- **Calculadora de oferta** en cada licitación: costes de proveedor, flete, arancel y entrega + tu margen → precio, baja, beneficio y probabilidad de ganar según el histórico, y qué precio necesitas para ganar.
- **Checklist para presentar** cada licitación y **Mi trabajo** en Inicio con tus plazos.
- **Excel** de la lista filtrada, **búsquedas guardadas** en el histórico y botón **Compartir** (WhatsApp/correo).
- **Pedir precios a proveedores**: la IA saca del pliego la lista de artículos (cantidad, especificación en inglés, certificados). Botones para descargar el **Excel en inglés** para fábricas, copiar o abrir el **correo en inglés**, apuntar los precios que te den (USD o EUR) y **pasarlos a la calculadora** (por lote).
- **Borradores en Word** de la **declaración responsable** y la **oferta económica**, rellenados con los datos de la empresa y de la licitación (revisar siempre; si el pliego trae su modelo, usar ese).
- **La nota aprende de ti**: cuando marcas «Me interesa», «Descartada»…, la nota de las parecidas sube o baja (hasta ±15).
- **Ganada / Perdida automáticas**: cuando se publica la adjudicación de una «Presentada», el tablero la cambia solo y enseña quién ganó y por cuánto.
- **Sincronización móvil ↔ ordenador** (opcional): el tablero, notas, calculadoras, checklists y precios se guardan cifrados en tu repositorio (rama `datos-usuario`). Se activa en «Mi tablero» con un token de GitHub.
- **Contratos menores** en el histórico (compras directas sin concurso): quién vende qué a cada organismo.
- **Aviso por Telegram** (y/o correo) cuando entra una licitación A.
- Web con contraseña, funciona en móvil (se puede instalar como app) y ordenador.

Coste: **0 €** (GitHub gratis + IA gratis).

---

## Puesta en marcha (una sola vez, ~20 minutos)

### 1. Repositorio
Ya creado: https://github.com/adambkk11/radar-badben23 (público: los datos van cifrados con tu contraseña y los socios no se publican). Si algún día lo rehaces: sube todo el contenido de esta carpeta **excepto** `config.privada.json` y `data/`.

### 2. Claves gratuitas
- **Gemini (IA principal):** https://aistudio.google.com/apikey → *Create API key*. Copia la clave.
- **Groq (IA de respaldo, opcional):** https://console.groq.com/keys → *Create API Key*.
- **Telegram (avisos, opcional):**
  1. En Telegram habla con **@BotFather** → `/newbot` → ponle nombre → te da el *token*.
  2. Escribe cualquier cosa a tu bot nuevo.
  3. Abre `https://api.telegram.org/bot<TOKEN>/getUpdates` y copia el número de `"chat":{"id": ...}`.

### 3. Secretos del repositorio
En el repositorio: **Settings → Secrets and variables → Actions → New repository secret**. Crea:

| Nombre | Valor |
|---|---|
| `SITE_PASSWORD` | La contraseña que usarás para entrar a la web (larga, que no uses en otro sitio). **Obligatorio.** |
| `CONFIG_PRIVADA` | Copia y pega **todo** el contenido del archivo `config.privada.json` (tus socios). |
| `GEMINI_API_KEY` | Clave de Gemini |
| `GROQ_API_KEY` | Clave de Groq (opcional) |
| `TELEGRAM_TOKEN` | Token del bot (opcional) |
| `TELEGRAM_CHAT_ID` | Tu chat id (opcional) |

Aviso por correo (opcional): pon `"email": true` en `config.json` y crea `SMTP_USER` (tu Gmail), `SMTP_PASSWORD` (una *contraseña de aplicación* de Google) y `ALERT_EMAIL`.

### 4. Activar la web
**Settings → Pages → Build and deployment → Source: GitHub Actions.**

### 5. Primera ejecución
1. Pestaña **Actions** → si lo pide, *I understand my workflows, go ahead and enable them*.
2. **Radar de licitaciones → Run workflow** → orden `historico`, meses `12` → **Run**. Carga 12 meses de adjudicaciones (tarda 1-3 horas). Si te lo saltas, la primera ejecución automática carga sola los últimos 3 meses.
3. Cuando acabe, **Run workflow** otra vez con `todo`.
4. Tu web: **https://adambkk11.github.io/radar-badben23/** → entra con tu `SITE_PASSWORD`.

A partir de ahí se actualiza sola cada 3 horas (7:17 a 23:17).

---

## Uso diario
- **Inicio:** las mejores (A), las que cierran pronto y cuántas hay por producto.
- **Licitaciones:** buscador + filtros (producto, comunidad, importe, días, simplificado, sin armonizar, peso del precio, recomendación IA). Pulsa una para ver la ficha completa.
- En la ficha: *Abrir en la plataforma oficial*, pliegos, análisis IA, por qué tiene esa nota, competencia y adjudicaciones parecidas, *Seguimiento*, notas y *Copiar petición de precios*.
- **Histórico:** escribe palabras (`uniformes policía -bomberos "ropa de trabajo"`) o CPV (`1811 18143 3913`). Pestañas: precios, competidores, organismos y próximas renovaciones. Pulsa una empresa u organismo para ver su ficha.
- **Mi tablero:** arrastra las tarjetas entre columnas. Se guarda en ese navegador: usa *Exportar/Importar* para pasarlo al móvil.
- En el móvil: menú del navegador → *Añadir a pantalla de inicio*.

## Comprobar que todo funciona
Se comprueba sola cada lunes (si falla, GitHub te manda un correo). También a mano: pestaña **Actions → Prueba completa → Run workflow**: ejecuta el radar con datos reales sin publicar nada, prueba la descarga de pliegos y abre la web en un navegador automático (móvil y ordenador). Si sale en verde, todo funciona.

## Si algo falla
- La fecha de «Actualizado» sale en **rojo** si los datos tienen más de 12 horas: mira **Actions** en GitHub.
- Una ejecución en rojo no pierde lo avanzado: guarda la base de datos y publica la web igualmente; el error aparece en el resumen de la ejecución.
- El tablero, las notas, la calculadora y el checklist se guardan en cada dispositivo: usa **Exportar/Importar** del tablero para pasarlos del PC al móvil.

## Ajustes
Todo lo que decide la nota está en `config.json` (familias de producto, CPV, palabras, penalizaciones, umbrales, cuántas analiza la IA por pasada). Edítalo en GitHub (icono del lápiz) y guarda: se aplica en la siguiente ejecución.

## Importante
- La IA puede equivocarse: antes de presentar nada, **lee el pliego oficial**. La web siempre enlaza a la plataforma oficial.
- Si una plataforma autonómica no está agregada o pide registro/captcha, el radar no la salta: aparece solo el enlace oficial.
- Límite gratuito de Gemini: el radar analiza como máximo 25 por pasada con pausas para no pasarse.

## Si GitHub no pudiera descargar de la Plataforma
Ejecuta en tu PC `run_local.bat` (necesita Python 3 instalado desde python.org). Hace lo mismo y deja la web en la carpeta `site`.
