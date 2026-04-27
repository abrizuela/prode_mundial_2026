# PRODE Mundial 2026

Aplicación web para administrar torneos de PRODE del Mundial 2026.

Incluye:
- Panel admin con autenticación por clave.
- Gestión global de partidos (grupos y fase final).
- Gestión de torneos y participantes.
- Links de jugador separados por etapa (`grupos` y `fase final`).
- Tabla de posiciones con scoring.
- Notificaciones push para inicio de partidos.

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

- Node.js 25+
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

Variable principal:
- `ADMIN_KEY` (default actual en desarrollo: `ert.2026`)

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

## Flujo principal

- Admin crea torneo y participantes.
- Cada participante recibe 2 links:
  - Fase de grupos
  - Fase final
- Los resultados reales se cargan globalmente desde admin.
- El ranking se calcula automáticamente.

## Notificaciones push

- El jugador puede activar/desactivar notificaciones.
- El service worker se sirve en `/sw.js`.
- El backend envía avisos antes de partidos de grupos.

## CI

Se incluye workflow de GitHub Actions (`.github/workflows/smoke.yml`) con smoke checks básicos:
- Levanta el servidor.
- Verifica endpoint admin.
- Verifica archivos estáticos críticos (`/css/styles.css`, `/js/admin.js`, `/sw.js`).

## Scripts

- `npm run dev`
- `npm run start`
- `npm run build` (placeholder)
