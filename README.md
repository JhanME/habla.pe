# Hablape - Calentamiento de entrevistas

MVP para practicar entrevistas personalizadas con vacante + CV. El frontend vive en `src/` y el backend local expone endpoints para generar preguntas y feedback con Gemini.

## Ejecutar

Desde esta carpeta:

```powershell
cd C:\Users\mocai\Documents\Hablape
npm.cmd start
```

Luego abre:

```txt
http://127.0.0.1:5173
```

Si PowerShell ya permite scripts, tambien puedes usar `npm start`.

## Gemini

Configura la API key solo en el backend, nunca en el navegador. Copia `.env.example` como `.env` y reemplaza el placeholder:

```env
GEMINI_API_KEY=REEMPLAZA_CON_TU_API_KEY_DE_GEMINI
GEMINI_MODEL=gemini-2.5-flash
```

Despues ejecuta `npm.cmd start`.

Endpoints locales:

- `POST /api/interview/questions`: genera preguntas desde vacante + CV.
- `POST /api/interview/feedback`: evalua una respuesta y puede incluir metricas visuales.

Si `GEMINI_API_KEY` no esta configurada o Gemini falla, el servidor usa un fallback local para que la app siga funcionando.

## Archivos

- `src/index.html`: interfaz principal.
- `src/styles.css`: estilos de la app y estados visuales de camara.
- `src/app.js`: flujo de entrevista, llamadas al backend, camara, encuadre y mirada.
- `server.mjs`: servidor local, archivos estaticos y API Gemini.
- `package.json`: scripts para ejecutar el proyecto.

## Estado actual

Incluye:

- Input de link/texto de vacante.
- Input de CV por texto o archivo TXT/MD.
- Generacion de preguntas con Gemini via backend.
- Flujo de entrevista pregunta por pregunta.
- Feedback por respuesta con Gemini via backend.
- Reporte final.
- Camara con overlay de encuadre en verde/rojo.
- Tracking de mirada con MediaPipe Face Landmarker cuando esta disponible.
- Fallback local sin Gemini y fallback visual con FaceDetector si MediaPipe no carga.

## Siguiente fase

Persistir sesiones y reportes para comparar progreso entre entrevistas.
