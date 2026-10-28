# AIPEX DIGITAL · Estudio de reels para Instagram

App web para crear y publicar contenido de Instagram con IA, con tu marca y bajo tu control: nada se publica sin tu aprobación.

## Qué hace

| Función | Cómo funciona |
| --- | --- |
| **Cerebro de marca** | Lee tu web (y tus captions de Instagram si lo conectas) y saca oferta, audiencia, tono, reglas de voz, colores, pilares, términos de búsqueda y qué se puede o no afirmar. Editable. |
| **Auditoría** | Con Instagram conectado, calcula por publicación el *outlier* (visualizaciones / mediana de la cuenta) y envíos por alcance, compara lo mejor con lo peor y da hallazgos con evidencia, qué hacer más, qué dejar, reescritura de nombre y bio y los primeros reels. |
| **Plan semanal** | Le cuentas qué ha pasado esta semana y planifica reels, carruseles y stories con tipos mezclados (prueba, enseña, opinión, historia, oferta), fórmula de gancho y hora sugerida. Crea los borradores. |
| **Borradores** | Reels con 3 ganchos de fórmulas distintas, guion plano a plano, rótulos y caption. Carruseles diapositiva a diapositiva. Stories fotograma a fotograma con stickers. |
| **Control de calidad** | Sin IA, en cada borrador: limpia rayas largas y caracteres invisibles, puntúa el gancho, estima la duración, revisa el caption (primera línea visible, enlaces, una sola petición, máx. 5 hashtags) y señala frases de plantilla y datos pendientes `{{así}}`. |
| **Cola de aprobación** | Apruebas, o pides cambios en lenguaje normal y se rehace. |
| **Publicación programada** | Los reels aprobados con vídeo se publican solos a la hora elegida (si activas la publicación automática). |
| **Comentarios** | Lee los comentarios sin responder, los clasifica por valor y propone respuestas con tu voz. Tú pulsas «Responder». |
| **Comentario → DM** | Quien comenta una palabra clave recibe tu enlace por mensaje privado. Solo responde a quien comenta. |

No incluye (por ahora): generación de vídeo, avatares ni clonación de voz. Grabas o editas el vídeo, lo subes a un sitio con URL pública (por ejemplo Cloudinary, Bunny o un bucket S3) y pegas la URL en el borrador.

## Publicar en Render

1. En [Render](https://dashboard.render.com): **New → Blueprint**, conecta GitHub y elige este repositorio. Render lee `render.yaml` y crea la web y la base de datos.
2. Te pedirá estas variables:
   - `APP_PASSWORD`: la contraseña para entrar en la app.
   - `ANTHROPIC_API_KEY`: tu clave de [console.anthropic.com](https://console.anthropic.com).
   - `INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET`: de tu app de Meta (siguiente apartado). Puedes dejarlas vacías al principio y rellenarlas después en *Environment*.
3. Al terminar, la app estará en `https://aipex-digital.onrender.com` (o el nombre que te asigne Render).

**Planes.** El blueprint usa los planes gratuitos para que puedas probar. Para uso real:
- Web en **Starter**: el plan gratuito se duerme tras 15 minutos sin visitas, así que no publica a la hora programada ni responde a comentarios mientras duerme.
- Base de datos en **Basic**: la gratuita de Render caduca a los 30 días.

## Conectar Instagram (app de Meta)

Hace falta una cuenta de Instagram **profesional** (empresa o creador).

1. En [developers.facebook.com](https://developers.facebook.com/apps) crea una app de tipo **Empresa** y añade el producto **Instagram → API con inicio de sesión de Instagram**.
2. Copia el **ID** y la **clave secreta de la app de Instagram** a `INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET` en Render.
3. En *Configurar el inicio de sesión de empresa*, añade como URI de redirección:
   `https://TU-APP.onrender.com/api/instagram/callback`
4. En *Webhooks*:
   - URL de devolución: `https://TU-APP.onrender.com/webhooks/instagram`
   - Token de verificación: el valor de `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` (Render lo genera; lo ves en *Environment*).
   - Suscríbete al campo **comments**.
5. Mientras la app está en modo desarrollo, solo funciona con cuentas añadidas como probadoras en *Roles de la app*. Para usarla con cualquier cuenta, solicita en *Revisión de la app* los permisos: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_messages` e `instagram_business_manage_insights`. Meta pide un vídeo mostrando el uso y puede tardar varios días.
6. En la app: abre tu marca → **Instagram y ajustes → Conectar Instagram**.

## Desarrollo local

```bash
cp .env.example .env   # rellena los valores
npm install
npm run dev            # http://localhost:3000
```

Necesitas PostgreSQL. Las tablas se crean solas al arrancar.

## Estructura

```
src/server.js     API, sesión y webhook de Instagram
src/ai.js         prompts y esquemas de la IA
src/quality.js    control de calidad local (gancho, duración, caption, frases de plantilla)
src/instagram.js  Instagram API: OAuth, publicación, insights, comentarios y DMs
src/scheduler.js  publicación programada y renovación de tokens (cada minuto)
src/website.js    lectura de la web de la marca
src/db.js         PostgreSQL y migraciones
public/           interfaz (HTML, CSS y JS sin dependencias)
```

## Seguridad

- Una sola contraseña (`APP_PASSWORD`) protege la app; usa una larga.
- Los tokens de Instagram se guardan en tu base de datos y se renuevan solos antes de caducar.
- Los webhooks se verifican con la firma de Meta.
