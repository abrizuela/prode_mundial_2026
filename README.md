# PRODE Mundial 2026

Aplicación web para administrar torneos de PRODE del Mundial 2026.

Incluye:
- Panel admin con autenticación por clave.
- Gestión global de partidos (grupos y fase final) para todos los torneos.
- Definición global de cruces de 16vos y habilitación de fase final.
- Gestión de torneos y participantes (alta, baja, edición, desbloqueo).
- Link único de jugador con carga separada por etapa (grupos y final).
- Tabla pública por torneo y tabla de posiciones en vivo.
- Notificaciones push automáticas y notificaciones custom desde admin.

## Stack

- Node.js (ESM)
- TypeScript (ejecución con `--experimental-strip-types`)
- Express
- Persistencia JSON en `data/store.json`
- Frontend estático en `public/`

## Estructura

- `src/`: backend y lógica de dominio
- `public/html/`: vistas HTML
- `public/js/`: scripts frontend y service worker
- `public/css/`: estilos
- `public/assets/`: assets estáticos
- `data/`: almacenamiento local JSON

## Requisitos

- Node.js `>=22.6.0`
- npm

## Configuración local

1. Instalar dependencias:

```bash
npm ci
```

1. Configurar clave admin (opcional, hay default):

```bash
cp .env.example .env
```

Variables disponibles:
- `ADMIN_KEY`
- `PORT` (default: `3000`)

## Ejecutar

Modo normal:

```bash
npm start
```

Modo desarrollo (watch):

```bash
npm run dev
```

App disponible en:
- `http://localhost:3000/admin`

## Códigos y rondas

- Resultado de grupos:
  - `L`: gana local
  - `E`: empate
  - `V`: gana visitante
- Resultado fase final:
  - `L`: gana local
  - `V`: gana visitante
- Orden de rondas: `R16`, `OCT`, `QF`, `SF`, `THIRD`, `FINAL`
- Puntos por acierto fase final:
  - `R16=1`, `OCT=2`, `QF=4`, `SF=8`, `THIRD=16`, `FINAL=24`

Notas de scoring:
- Grupos: `+1` por partido acertado.
- Fase final: el acierto de una ronda depende también de haber acertado el partido previo que alimenta ese cruce.
- Bonus final automático (derivado de resultados reales):
  - Campeón `+8`, Subcampeón `+6`, Tercero `+4`, Cuarto `+2`.

## Flujo principal

- Admin crea torneo y participantes.
- Cada participante tiene un link principal ` /p/:token ` (los links por etapa siguen disponibles por compatibilidad y redirigen al principal).
- El participante guarda pronósticos de grupos y bonus.
- Admin define 16vos globales y habilita la fase final cuando corresponde.
- El participante guarda pronósticos de fase final.
- Admin carga resultados reales globales.
- El ranking se recalcula automáticamente.

Reglas de edición:
- La edición se cierra 1 hora antes del primer kickoff de la etapa.
- Admin puede desbloquear carga de grupos o fase final por participante.

## Pantallas

- ` /admin `: panel principal (torneos, grupos, fase final, 16vos, notificaciones).
- ` /admin/:id `: panel admin de torneo (participantes, ranking, WhatsApp, notificaciones).
- ` /p/:token `: panel del participante.
- ` /t/:id `: tabla pública del torneo.

## Notificaciones push

- El jugador puede activar/desactivar notificaciones.
- El service worker se sirve en `/sw.js`.
- El backend envía avisos automáticos de partidos de grupos cuando faltan menos de 5 minutos.
- Al habilitar fase final desde admin, se puede notificar automáticamente a participantes elegibles.
- Desde admin se pueden enviar notificaciones custom filtrando por torneo o participante.

## API (resumen)

Admin:
- `GET /api/admin/session`
- `GET/PATCH /api/admin/group-schedule`
- `GET /api/admin/knockout`
- `PATCH /api/admin/knockout/r16`
- `PATCH /api/admin/knockout/kickoff`
- `PATCH /api/admin/knockout/results`
- `PATCH /api/admin/knockout/final-stage-enabled`
- `POST /api/admin/notifications/custom`
- `GET/POST /api/tournaments`
- `GET/PATCH/DELETE /api/tournaments/:id`

Jugador / público:
- `GET /api/p/:token`
- `POST /api/p/:token/submit-group`
- `POST /api/p/:token/submit-final`
- `POST/DELETE /api/p/:token/push-subscription`
- `GET /api/push/public-key`
- `GET /api/public/tournaments/:id`
- `GET /api/tournaments/:id/leaderboard`

## CI

Se incluye workflow de GitHub Actions (`.github/workflows/smoke.yml`) con smoke checks básicos:
- Levanta el servidor.
- Verifica endpoint admin.
- Verifica archivos estáticos críticos (`/css/styles.css`, `/js/admin.js`, `/sw.js`).

## Scripts

- `npm run dev`
- `npm run start`
- `npm run build` (placeholder)
