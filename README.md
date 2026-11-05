# Torneo Bíblico UJELADEA

Versión 2 para la segunda etapa, **Efesios**, con historial separado de **Hebreos**. La aplicación usa React, Vite y Supabase. Publicada el 21 de octubre de 2026 en [ujeladea.vercel.app](https://ujeladea.vercel.app/admin/login), con las migraciones V2 aplicadas a `torneo-inela`. Hebreos permanece cerrado y Efesios en borrador, sin preguntas reales todavía.

## Entrega de Efesios y premiación

Las seis migraciones están aplicadas a `torneo-inela`. Esta entrega incorpora `20261021211025_v3_efesios_supervision_evaluacion.sql` y `20261021211034_premiacion_acumulada_historial.sql`; la interfaz se publica mediante `main` y la rama de trabajo se llama `etapa-2`. Los archivos locales usan las versiones asignadas por Supabase, cuyo historial interno se dejó intacto.

- 45 preguntas aleatorias por intento: 27 múltiples (2 puntos), 10 abiertas (3) y 8 de contexto (4). Máximo 116, nota normalizada sobre 100 y orden mezclado persistente por joven.
- El banco se valida por cupo y valor; las preguntas escritas activas necesitan rúbrica. Al activar, banco y criterios quedan fijos. Los pastores aún deben incorporar el contenido real y revisar su dificultad y versión bíblica.
- Inicio compacto, entrada a Efesios, Hebreos bloqueado en la aplicación y por RLS para el rol administrativo de la app, sin selector para cambiar de etapa. Sus datos originales permanecen guardados.
- Registro y reingreso supervisados. El moderador puede añadir nombres durante la sesión, mostrar el QR general, autorizar una pantalla o emitir un QR personal temporal de un uso. Las recuperaciones conservan el cierre común.
- Las autorizaciones, justificaciones y revisiones se auditan. Un incidente puede justificarse sin conceder acceso automáticamente. La corrección oculta la identidad, usa criterios y detecta una revisión desactualizada antes de sobrescribir una nota.
- Ranking de sociedades por promedio de notas individuales, consolidando sesiones; sin censo, descuento por alertas ni desempate por velocidad. Los empates comparten posición. Los resultados son provisionales hasta completar revisión y cierre.

Demo aislada disponible en [127.0.0.1:5178/demo](http://127.0.0.1:5178/demo). Para iniciarla en ese puerto en PowerShell:

```powershell
$env:UJELADEA_DEMO_PORT='5178'
npm run dev:demo
```

`scripts/verify-efesios-v3-ui.mjs` recorre moderación, reingreso, QR, incorporación tardía y rúbrica con cuatro contextos de Edge y PostgreSQL local. No acredita capacidad para 150 dispositivos ni la pila completa de Supabase. Antes del evento quedan pendientes probar Auth, límites por IP (especialmente con WiFi compartido), REST, reconexiones, concurrencia entre conexiones PostgreSQL y dispositivos reales.


## Base V2 ya publicada

- Panel inicial de etapas, con preparación, configuración, activación y cierre con confirmación. Esta revisión simplifica este inicio para entrar directamente a Efesios.
- Sesiones, preguntas, resultados y ranking dentro de la etapa seleccionada.
- Respaldo histórico inmutable con nombres, respuestas y puntajes originales. Esta revisión bloquea el acceso a Hebreos desde la app.
- Formularios de preguntas y sesiones con `etapa_id`; duración y cantidad de preguntas tomadas de la etapa.
- Exportaciones PDF con identificación de la etapa y logo reducido a 320 px.
- Base del banco para incorporar preguntas revisadas por los pastores: opción múltiple, respuesta abierta y contexto bíblico, con referencia y puntaje.
- Instrucciones en la espera y ayuda desplegable durante el examen: confirmación, guardado, tiempo y recuperación.
- Acceso administrativo mediante `app_metadata.role = "admin"`. El rol se asigna desde una operación de administración de Supabase; `user_metadata` no concede acceso.

El bloque del examen está implementado localmente: recuperación desde el servidor, orden de preguntas persistente, borradores en dispositivo y servidor, confirmación idempotente, vencimiento validado y recuperación autorizada por el jurado en otro dispositivo. La opción múltiple se corrige en servidor y la calificación manual es transaccional. El máximo V2 incluye también las preguntas no respondidas. El informe de Efesios para el jurado y la directiva incluye participación, avance, notas pendientes, máximo de todas las asignaciones y el cálculo de los porcentajes. Se identifica como provisional mientras la etapa esté abierta o existan incidencias en los totales; Hebreos conserva su archivo histórico; esta revisión no ofrece entrada a esa etapa.

## Revisar una demo local

```powershell
npm run dev:demo
```

Abre [http://127.0.0.1:5173/demo](http://127.0.0.1:5173/demo). Los recorridos permiten entrar al panel y revisar registro, espera, pregunta 20 y confirmación final. Utiliza únicamente datos ficticios y PostgreSQL PGlite en memoria; al reiniciar se descartan los cambios. Las preguntas de muestra no forman parte del banco pastoral.

Este servidor ignora los archivos `.env`, fija la API al mismo origen local y bloquea conexiones de la app a servicios externos. Auth y REST son adaptadores de demostración; La conexión WebSocket de Realtime y la IA no se reproducen. La sala de control se actualiza por consultas periódicas cada 15 segundos y al volver a la pestaña o recuperar la red. No sustituye la verificación de Supabase real.

Acceso manual de demostración: `admin@demo.local` / `DemoLocal2026!`. Los enlaces del recorrido también permiten entrar directamente.

## Ejecutar localmente

```powershell
npm ci
Copy-Item .env.example .env.local
# Completar la URL y la clave pública de un Supabase de pruebas.
npm run dev
```

Variables: `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Se admite `VITE_SUPABASE_ANON_KEY` para la clave anon heredada. No se deben introducir claves secret o service_role en el frontend.

El entorno de pruebas necesita todas las migraciones aplicadas y un administrador con el rol correspondiente. Sin configuración se muestra una pantalla de preparación; con una base V1 se explica que falta la migración. La documentación de respaldo, restauración, permisos y despliegue coordinado está en [supabase/README.md](supabase/README.md).

Las sugerencias de IA se solicitan mediante una Edge Function exclusiva para administradores. Su clave y modelo se configuran solo en el servidor; el jurado revisa y confirma la nota. Sin IA configurada se puede calificar manualmente. Los participantes usan Supabase Auth anónimo con una sesión independiente de la del administrador.

## Comprobaciones

```powershell
npm test
npm run build
npm run lint
```

Los tests de Node usan PostgreSQL en memoria y datos sintéticos; no consultan producción. Se prueban la inmutabilidad histórica, RLS, ciclo de etapas, recuperación del examen, reintentos, borradores, plazos, calificación y autorización de la IA. El lint global pasa sin errores ni advertencias y la compilación ya no produce el aviso de tamaño de bloques. Las pantallas y los generadores de PDF se cargan bajo demanda.

Las pruebas opcionales de navegador necesitan Playwright y Edge. `scripts/verify-admin-ui.mjs` simula Auth/REST y verifica el panel en el puerto 4173. `scripts/verify-examen-ui.mjs` prueba el examen en el puerto 4174 con PostgreSQL 17 local y las RPC/RLS reales, simulando Auth y el transporte REST. Reproduce la pregunta 20, alertas, recarga, red interrumpida, reintentos, conflictos de pestañas y revisión del jurado. Usan datos ficticios y bloquean solicitudes externas. Guardan sus evidencias en `.local-db/`, fuera de Git. No sustituyen la integración y carga de la pila Supabase completa.

Si Playwright está instalado en otro entorno, se indica su archivo `package.json` mediante `UJELADEA_UI_PACKAGE_JSON`. El runtime de dependencias de Codex incluye Playwright. Puede seleccionarse otro canal con `UJELADEA_UI_BROWSER`.

```powershell
node scripts/verify-admin-ui.mjs
node scripts/verify-examen-ui.mjs
# Con la demo actual ejecutándose en 5178:
node scripts/verify-efesios-v3-ui.mjs
node scripts/verify-panel-local.mjs
node scripts/verify-demo-local.mjs
```

El informe nuevo tiene ejemplos sintéticos reproducibles con `node scripts/verify-informe-efesios.mjs`. Incluyen notas pendientes, preguntas sin responder y tablas con nombres largos y varias páginas. Se guardan en `.local-db/efesios-pdf/`; no se insertan en el banco ni en Supabase.

## Antes de desplegar

Preparar el banco y la rúbrica de Efesios, confirmar las reglas del examen y completar la integración y carga con varios dispositivos antes del evento. La creación del entorno aislado se aplazó por indicación del usuario. El despliegue anterior de V2 conserva los datos de Hebreos. La restricción de lectura histórica está aplicada. El resumen de resultados de Hebreos se consulta exclusivamente desde Premiación. La IA sigue pendiente de configuración y despliegue de su función; la revisión manual está disponible. No ejecutar `db reset --linked` sobre producción.

## Premiación de las dos etapas

`/admin/premiacion` combina el 50 % de Hebreos con el 50 % de Efesios, conservando en columnas separadas sus resultados y métodos. Hebreos tiene un resumen inmutable derivado del archivo V1, con sus puntos, máximos, porcentajes, redondeo y descuentos originales. No se limpian respuestas repetidas ni se recalifican exámenes antiguos.

La coincidencia con el PDF de resultados original requiere una comprobación manual. El administrador selecciona el PDF en su equipo, revisa las tablas y registra la declaración y su SHA-256; el archivo no se sube ni se interpreta automáticamente. El acumulado permanece provisional mientras falte esa comprobación, el cierre/revisión de Efesios o la verificación de identidades. Las personas se vinculan uno a uno manualmente, con revisión y auditoría; una coincidencia de nombre no crea una vinculación. Las ausencias no se transforman en ceros ni reciben posición general. Quienes solo rindieron Efesios conservan su resultado de esa etapa.

Verificación de la entrega de premiación: 106 pruebas de Node, cinco comprobaciones del flujo en Edge y revisión móvil. `scripts/verify-hebreos-results.mjs --backup-dir RUTA_PRIVADA --report RUTA_JSON` ejecuta la función original de V1 que alimentaba el PDF y la contrasta con el resumen nuevo. En el ensayo privado coincidieron las 19 sociedades y los 184 participantes; las 7.139 respuestas y todos los valores originales permanecieron intactos. Posteriormente se contrastó el PDF de resultados entregado por el administrador: 209 comprobaciones sin diferencias. Su validación y SHA-256 se registraron en Premiación el 21 de octubre de 2026, sin alterar notas ni clasificación. Los informes de huellas y producción permanecen en `.local-db/despliegue/`, fuera de Git.

## Experiencia del joven: preparación de noviembre

El ingreso incorpora búsqueda de nombres con o sin tildes, confirmación de identidad y orientación para quien no aparece. El primer acceso muestra la autorización pendiente; la recuperación conserva el progreso y explica que el reloj sigue corriendo. La espera incluye la distribución y duración configuradas en el servidor, además de una práctica sin llamadas de respuesta, sin nota y sin acceso al banco real. La práctica se interrumpe automáticamente al iniciar la sesión.

El examen prioriza pregunta, reloj y avance confirmado. El borrador distingue copia local, sincronización y confirmación definitiva; si no hay almacenamiento local no se promete una copia. Las respuestas escritas tienen más espacio y el pie se libera al escribir en móvil. Los avisos de tiempo aparecen a cinco minutos y un minuto, calculados desde el plazo del servidor. Las preguntas de contexto pueden usar `Pasaje:` y, en otra línea, `Pregunta:` para separar la lectura; un texto sin esa estructura se conserva completo. No se agregaron requisitos de calificación ni contenido pastoral.

La asistencia del botón «Necesito ayuda» queda en incidencias separadas de las señales de seguridad. El moderador la ve en la sala de control y puede marcarla atendida. Los reintentos no duplican una ayuda pendiente y cada solicitud nueva se limita a una cada treinta segundos. La entrega incluye fecha de registro del servidor, cantidad confirmada y referencia del intento; no muestra notas ni claves de corrección.

La migración `20261105135900_experiencia_joven_efesios.sql` agrega metadatos y dos RPC de asistencia, con comprobación de identidad y autorización. No recalifica ni modifica resultados históricos. Está aplicada en producción en `torneo-inela` desde el 5 de noviembre de 2026. Sus funciones son compatibles con la interfaz anterior; la interfaz se publica desde `main`. No ejecutar un reinicio de la base para aplicarla.

Verificación reproducible: `npm test`, `npm run lint`, `npm run build` y, con la demo aislada iniciada, `node scripts/verify-joven-ux.mjs`. La prueba de navegador recorre las 45 preguntas, pérdida de conexión, retorno de confirmación perdido, recuperación en la pregunta 20 y constancia final. Las capturas se guardan en `.local-db/joven-ux/`. El viewport reducido prueba la distribución, pero no sustituye un ensayo en teléfonos físicos ni una prueba de carga de Supabase.

Verificación de publicación del 5 de noviembre de 2026: 116 pruebas de Node, lint y compilación correctos; 41 comprobaciones de navegador entre UX, supervisión y regresión. Las huellas de participantes, respuestas, preguntas, sesiones, eventos, archivo, clasificación preservada y validación del PDF de Hebreos coincidieron antes y después de la migración (184 participantes y 7.139 respuestas). La versión del archivo de migración coincide con la asignada por Supabase MCP. Los informes de producción quedan en `.local-db/despliegue-ux/`, fuera de Git. Sigue pendiente el ensayo en teléfonos físicos y la prueba de carga real.
