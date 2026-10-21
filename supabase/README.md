# Base de datos V2: Hebreos y Efesios

V2 y su panel por etapas se publicaron el 21 de octubre de 2026, por autorización del usuario. Las cuatro versiones de migraciones están registradas en `torneo-inela` y la interfaz V2 está en Vercel. El flujo público heredado de V1 no es compatible con los nuevos permisos: cualquier reversión debe coordinar también la base de datos.

## Despliegue del 21 de octubre de 2026

- Código de V2: `bc0888b8043f21f4ae394cdf9ef7c8f45b7a5d28`, publicado mediante `main`; Vercel confirmó el despliegue de producción.
- Antes de migrar se restauró el respaldo privado y se ensayaron las cuatro migraciones. Se compararon en producción las 43 columnas y 12 restricciones del baseline, su vista y los SHA-256 de los seis conjuntos originales.
- El baseline se registró mediante una migración de verificación, sin recrear tablas. Las tres migraciones V2 se aplicaron con MCP y el historial se alineó con las versiones de los archivos de este repositorio. No se ejecutó un reset remoto.
- Después de migrar, los seis conjuntos originales y el archivo histórico coinciden exactamente con el respaldo: 27 sociedades, 19 sesiones finalizadas, 184 participantes, 116 preguntas, 7.139 respuestas y 442 eventos. No se corrigieron ni recalcularon respuestas heredadas.
- Hebreos está cerrado y Efesios en borrador, con cero preguntas. No se subieron las preguntas de demostración.
- Se conservó el acceso de la única cuenta administrativa heredada asignando el rol en `app_metadata`. Las sesiones previas necesitan volver a iniciar sesión para recibir ese rol en su token. El usuario habilitó el acceso anónimo y se confirmó mediante la API de Auth.
- Todas las tablas públicas tienen RLS. Las consultas REST sin autenticar a preguntas, respuestas, etapas y archivos se rechazan. No hay funciones `SECURITY DEFINER` en `public`.
- La página de ingreso en vivo se comprobó en Edge, escritorio y móvil: sin errores JavaScript, solicitudes fallidas ni desbordamiento horizontal; las rutas administrativas redirigen al ingreso cuando no hay sesión.
- La integración completa del examen, Realtime y la carga entre dispositivos siguen pendientes. No se crearon sesiones ni intentos de prueba en producción. La función de sugerencias de IA aún no está desplegada/configurada; la revisión manual no depende de ella.

Los informes de restauración, hashes y comprobaciones del despliegue se guardaron fuera de Git en `.local-db/despliegue/`; el respaldo con datos personales permanece fuera del repositorio. El diagnóstico de seguridad solo señaló la [tabla privada de códigos sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) (acceso deliberadamente denegado para clientes) y la [protección de contraseñas filtradas deshabilitada en Auth](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Los índices recién creados aún no tienen estadísticas de uso.

## Migraciones

- `20261020193851_v1_baseline.sql`: reproduce el esquema público original, sin datos personales. Se ejecuta en bases vacías. En una base existente se verifica su equivalencia y se registra como baseline, en lugar de volver a crear las tablas.
- `20261020193925_v2_etapas_historial.sql`: archiva Hebreos sin recalcular, añade `etapa_id` a sesiones y preguntas, crea Efesios en borrador y prepara permisos e índices.
- `20261021160006_v2_intentos_api_segura.sql`: intentos autenticados, snapshots, guardado idempotente, borradores, calificación transaccional y RPC de participantes/jurado.
- `20261021170250_v2_panel_realtime.sql`: publica sesiones, participantes y eventos en Realtime sin sustituir publicaciones existentes, y añade la lectura administrativa consistente `admin_examen_sala`.

El archivo histórico guarda preguntas, sociedades, sesiones, participantes, respuestas y alertas con sus valores originales. Incluye las respuestas repetidas de V1. No agrega una restricción única sobre esas respuestas ni decide cuáles serían válidas: esa revisión requiere un criterio explícito.

Las etapas siguen `borrador → activa → cerrada`. Activar exige disponer de suficientes preguntas. Las reglas del examen quedan fijas durante la etapa activa. Cerrar exige finalizar sus sesiones y resolver calificaciones pendientes, genera un archivo separado y bloquea escrituras posteriores. La base comprueba también que preguntas y participantes pertenezcan a la misma etapa.

## Ensayos locales

```powershell
npm ci
npm test
node scripts/verify-hebreos-backup.mjs --backup-dir "RUTA_PRIVADA_DEL_RESPALDO" --report "RUTA_PRIVADA/informe.json"
```

`npm test` usa PostgreSQL local en memoria mediante PGlite y datos sintéticos. Prueba las migraciones desde una base vacía y desde V1, RLS, permisos, el archivo inmutable y el ciclo de etapas. No se conecta a Supabase.

El verificador de respaldo valida los SHA-256 del manifiesto, restaura el SQL, aplica V2 y compara cada campo original, además del archivo histórico. Los datos reales se leen de una carpeta privada fuera del repositorio. Los informes incluyen recuentos y comprobaciones, sin nombres ni respuestas.

PGlite permite probar SQL y permisos de PostgreSQL, pero no sustituye el ensayo del servicio completo: Auth, PostgREST, Realtime y Edge Functions requieren un entorno Supabase de pruebas. `scripts/lib/local-database.mjs` contiene funciones de Auth simuladas exclusivamente para esos tests; no se despliega.

Para usar la pila local completa, la configuración generada por la CLI está en `supabase/config.toml`, con PostgreSQL 17. Requiere instalar Docker. El proyecto local no está vinculado a una base remota. La semilla está vacía: Efesios necesita su propio banco revisado.

## Autorización y compatibilidad

Las políticas de lectura/gestión directa de tablas exigen un usuario autenticado con `app_metadata.role = "admin"`. El metadato debe asignarse mediante una operación de administración autorizada; no se confía en `user_metadata`. El rol público no recibe acceso directo a respuestas, claves de corrección o puntajes. Las funciones con privilegios se limitan al esquema privado y comprueban el rol del administrador o la propiedad del intento según la operación.

La migración restringe las consultas que hace V1 desde el navegador. El despliegue debe coordinarse con la interfaz V2 y con su API de participantes. Aplicarla sola interrumpiría los flujos públicos actuales.

## Procedimiento para un futuro despliegue

1. Crear un respaldo reciente y ejecutar su ensayo de restauración. Verificar que todas las sesiones antiguas hayan finalizado.
2. Probar en una base Supabase aislada con PostgreSQL 17. El proyecto de producción continúa intacto durante este proceso.
3. Comparar el esquema existente con el baseline. Si coincide, registrar únicamente la versión del baseline como aplicada con la CLI oficial; verificar la ayuda de `supabase migration repair` antes de ejecutar el comando.
4. Comprobar que la interfaz V2, los administradores y la API de participantes estén preparados para los nuevos permisos y campos obligatorios.
5. Revisar el SQL y el informe de integridad; aplicar la migración V2 en una ventana coordinada. La operación transaccional se revierte si falla y bloquea las escrituras concurrentes mientras captura el historial.
6. Verificar datos, archivos históricos y diagnósticos de seguridad/rendimiento. Probar los flujos reales de Auth, REST y Realtime.

El ensayo local no ejecuta `db push`, no usa `db reset --linked` y no borra ni modifica registros remotos. El respaldo original se conserva por separado del informe de restauración.

## Panel administrativo preparado

`/admin/etapas` es la entrada después de iniciar sesión. Hebreos se consulta desde `archivos_etapa`; no se sustituyen archivos ausentes por datos actuales. Las consultas de etapas abiertas se filtran y paginan para no perder respuestas por el límite de REST. Los enlaces a una sesión se validan contra la etapa seleccionada antes de montar controles. Las etapas cerradas bloquean también las rutas directas de edición.

El catálogo de sociedades sigue siendo compartido; cambiarlo no modifica sus nombres ni censos dentro del archivo histórico. Las preguntas se desactivan desde el banco y no hay controles de borrado permanente de sesiones en este panel. Se retira la reevaluación masiva de resultados de esta vista para conservar el historial.

Las exportaciones generales, por sesión y por joven reciben la etapa. El informe formal con metodología de V1 se reserva a Hebreos; V2 calcula el máximo desde sus preguntas asignadas. Efesios dispone de su propio informe para el jurado con estado provisional o archivo cerrado, notas pendientes, avance y metodología del cálculo actual. El logo se redimensiona dentro del PDF para evitar exportaciones de aproximadamente 16 MB.

La prueba de navegador está en `scripts/verify-admin-ui.mjs`: 24 comprobaciones con datos ficticios y Auth/REST simulados, incluyendo móvil, recarga de enlaces, formulario de preguntas, creación de sesiones, selección repetida y PDFs menores de un MB. Las pruebas de PostgreSQL y de proyección de datos se ejecutan con `npm test`. Esto no acredita todavía una integración con la pila completa de Supabase.

## Trabajo siguiente

- Pruebas de la pila Supabase completa y de concurrencia con varios dispositivos.
- Banco y rúbrica de Efesios revisados por los pastores; confirmar versión bíblica, cantidad y duración. La base del banco, las instrucciones y el informe PDF ya están preparados.
- Revisión coordinada de configuración de Auth, administradores, límites y función de IA antes de desplegar.

## Examen V2 y API de participantes

La migración `20261021160006_v2_intentos_api_segura.sql` añade intentos vinculados a `auth.users.id`, snapshots de preguntas, borradores con revisión e índices únicos para respuestas y solicitudes. Los campos nuevos de los registros de Hebreos quedan nulos y su archivo no se reescribe. La migración se detiene si encuentra exámenes V2 anteriores que requieren revisión, en lugar de inventar una asignación retrospectiva.

El navegador del joven usa una sesión de Supabase Auth anónima con almacenamiento separado del administrador. «Anónima» describe el acceso sin correo, no el rol SQL `anon`: después de iniciar sesión tiene un UID y el rol `authenticated`. Ninguna política le concede lectura directa de preguntas, respuestas o intentos. El QR y la selección del nombre siguen siendo un registro supervisado; no verifican por sí solos la identidad real del joven.

Los wrappers RPC públicos son `SECURITY INVOKER`. La elevación de privilegios se limita a funciones de `app_private`, con `search_path = ''`, identidad comprobada y asociación del intento al UID. El esquema privado no se agrega a los esquemas expuestos por REST. Los ayudantes internos no tienen EXECUTE para clientes.

| RPC | Comportamiento |
| --- | --- |
| `examen_sala` | Datos mínimos de una sesión V2 y nombres disponibles; recupera el intento propio. |
| `examen_registrar` | Reclama atómicamente un participante para ese UID. Un nombre y un UID tienen como máximo un intento por sesión. |
| `examen_estado` | Recupera la primera pregunta asignada sin respuesta; revisa el vencimiento en servidor. |
| `examen_borrador` | Guarda hasta 2000 caracteres con revisión optimista. Un conflicto exige elegir qué texto conservar. |
| `examen_responder` | Confirma una sola respuesta por asignación y solicitud. La opción múltiple se corrige con el snapshot privado. |
| `examen_finalizar` | Entrega transaccional e idempotente. |
| `examen_eventos` | Registra solo eventos del intento propio, con IDs únicos y límite por tipo. |
| `examen_recuperar` | Consume un código temporal del jurado, cambia el UID y conserva preguntas, borrador y plazo. |
| `admin_examen_crear_sesion` | Crea la sesión y todos sus participantes en una transacción. |
| `admin_examen_cerrar_vencida` | Cierra automáticamente solo cuando el reloj del servidor confirma el vencimiento. |
| `admin_examen_contexto` | Entrega al administrador la pregunta y referencia congeladas para revisar una respuesta. |
| `admin_examen_calificar` | Valida el máximo y recalcula el total transaccionalmente; repetir una nota no la suma de nuevo. |
| `admin_examen_recuperacion` | Emite un código de un solo uso, de hasta cinco minutos, y anula el anterior. |

El inicio de una sesión asigna preguntas a todos los intentos ya registrados, incluso si su navegador está desconectado. Un registro posterior en una sesión activa recibe el mismo plazo global; recargar, cambiar de dispositivo o repetir una llamada no extiende el tiempo. El estado devuelve únicamente la pregunta pendiente, su borrador y campos públicos; no incluye claves de corrección ni puntajes obtenidos.

Cada pregunta conserva su texto, opciones, respuesta de referencia y valor originales. Editar el banco afecta asignaciones futuras. El denominador V2 incluye todas las preguntas asignadas, también las no respondidas; V1 conserva su cálculo histórico. Las etapas cerradas archivan los intentos y los snapshots junto a los seis conjuntos originales.

El servidor conserva al vencer o al cerrar la sesión el último borrador que recibió dentro del plazo. Un texto que nunca salió del dispositivo no se acepta después del tiempo. La interfaz distingue copia local, borrador remoto y respuesta confirmada, y mantiene el envío pendiente bloqueado para reintentarlo con el mismo identificador. Los cambios simultáneos de pestañas exigen una decisión explícita.

Los códigos de recuperación se almacenan con SHA-256 en una tabla privada con RLS. Tras consumir el código, el dispositivo anterior deja de tener acceso al intento. La recuperación no reabre un intento terminado ni restablece el plazo.

## Sugerencias de IA en servidor

`supabase/functions/sugerir-calificacion` mantiene `verify_jwt = true`, verifica de nuevo al usuario mediante `auth.getUser` y exige `app_metadata.role = "admin"`. Usa el JWT del administrador y la clave pública para consultar la RPC de contexto bajo sus permisos; no necesita service_role.

La función acepta exclusivamente un ID de respuesta, carga texto/referencia/máximo del servidor y solicita una sugerencia al proveedor. No escribe notas. El jurado confirma mediante la RPC de calificación. Los errores, JSON inválidos y notas fuera de rango se rechazan, y no se devuelven credenciales ni errores completos del proveedor.

Las variables de servidor están documentadas en `supabase/functions/.env.example`: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` y `EXAM_ALLOWED_ORIGINS`. No se usa prefijo VITE_. Sin IA configurada la revisión manual sigue funcionando. El código del handler tiene pruebas con Auth/proveedor simulados; el arranque de Edge Functions en Deno/Supabase real todavía debe probarse en el entorno aislado.

## Validación de este bloque y preparación del entorno

- `npm test`: 85 pruebas locales de SQL, privilegios, datos, cliente y handler de IA.
- `scripts/verify-examen-ui.mjs`: 21 comprobaciones en Edge; reproduce pregunta 20, alerta, recarga, borrador sin conexión, confirmación perdida, conflicto de pestañas, móvil, vencimiento y calificación del jurado. Usa las RPC/RLS reales en PostgreSQL 17 PGlite y simula Auth y el transporte REST.
- `scripts/verify-admin-ui.mjs`: 23 comprobaciones del panel con datos ficticios y servicios simulados.
- El respaldo original volvió a restaurarse con todas las migraciones: se conservaron los 7139 registros de respuestas y los demás datos originales de Hebreos.
- Los ensayos PGlite usan una sola conexión. No acreditan contención entre conexiones, capacidad para todos los dispositivos del evento ni funcionamiento real de GoTrue, PostgREST, Realtime o Edge Functions.

Antes del evento queda pendiente probar la pila Supabase completa y la carga simultánea en un entorno aislado. En local, `enable_anonymous_sign_ins` está habilitado y el límite de accesos anónimos se configura en 500 por hora por IP para permitir un ensayo de varios dispositivos en la misma red. Para el evento deben revisarse capacidad, controles de abuso y límites según su red; los límites personalizados de la configuración local no se han aplicado a producción.

El respaldo de Hebreos conserva el alcance original (tablas públicas V1 y código). Los resultados futuros de V2 añaden referencias a Auth: su respaldo/restauración completo debe incluir las identidades de Auth mediante el procedimiento soportado de Supabase; no basta con reutilizar el exportador público de V1. La FK evita borrar una identidad que todavía tiene intentos.

Referencias oficiales: [acceso anónimo](https://supabase.com/docs/guides/auth/auth-anonymous), [autorización de Edge Functions](https://supabase.com/docs/guides/functions/auth-headers), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

La integración remota y la carga simultánea se aplazaron por indicación del usuario. El cupo gratuito impidió crear el proyecto de pruebas; no se creó ninguna instancia ni se tocó el proyecto independiente `ujeladea`. Posteriormente, el usuario autorizó el despliegue en producción descrito al inicio. Realtime y el examen con varios dispositivos siguen pendientes de validación completa antes del evento.

## Estabilidad y rendimiento del panel

La sala de control usa un solo canal con filtros por sesión y una lectura completa mediante `admin_examen_sala(p_sesion,p_etapa)`. Esta RPC administrativa devuelve reloj de servidor, participantes, cantidades respondidas y alertas agrupadas por tipo en una sola petición; no descarga preguntas ni respuestas. El wrapper público y la función privada son invoker; se comprueban el rol y la etapa y las consultas conservan RLS.

Una suscripción nueva o recuperada vuelve a consultar el estado. Los eventos se agrupan durante un segundo, las lecturas se serializan y una consulta cada 15 segundos recupera cambios perdidos. Se consulta también al volver a la pestaña o a la red. Las pestañas ocultas no consultan periódicamente. Los errores conservan el último estado y al salir se limpian canal y temporizadores.

Resultados y calificación consultan solo la sesión elegida; el listado de sesiones omite snapshots. El ranking pide cantidades y metadatos, sin textos de respuestas ni claves de corrección, y utiliza índices en memoria para evitar recorrer todos los datos por cada participante.

En la compilación del 21 de octubre de 2026, el JavaScript inicial estático pasó de aproximadamente 1.062 KB a 457 KB (57% menos), incluyendo los modulepreload. Esta medida excluye pantallas cargadas después, CSS, imágenes y fuentes; no estima tiempos reales de red. Las librerías de PDF se solicitan al exportar y los errores de descarga de pantallas permiten recargar.

Verificaciones: 85 pruebas de Node, 24 comprobaciones del panel y 21 del examen. `scripts/verify-panel-local.mjs` recorre tres contextos aislados de navegador contra la demo HTTP: registra a dos jóvenes, recupera un registro perdido sin red, inicia, confirma una respuesta y finaliza desde el jurado. Usa PostgreSQL PGlite y Auth simulado; no acredita WebSockets ni concurrencia de conexiones PostgreSQL de Supabase real.

Referencias: [Realtime y publicaciones](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes), [carga bajo demanda en React](https://react.dev/reference/react/lazy).

## Modelo de Efesios y supervisión preparado en local

La migración `20261021200037_v3_efesios_supervision_evaluacion.sql` todavía no se ha aplicado a producción. Se detiene antes de cambiar una etapa de Efesios que ya esté activa o tenga intentos; requiere revisar esos datos antes de desplegar. No se modifica una migración publicada ni se reescribe el archivo de Hebreos.

Distribución aprobada: 27 preguntas múltiples de 2 puntos, 10 abiertas de 3 y 8 de contexto de 4. La selección es aleatoria dentro de cada tipo y vuelve a mezclar el orden. Si el banco solo contiene el mínimo por tipo, todos reciben el mismo conjunto con orden distinto; para variar también el contenido hacen falta más preguntas revisadas. Cada asignación conserva enunciado, opciones, referencia, rúbrica y valor. La selección no calibra por sí sola la dificultad: corresponde al banco pastoral mantener preguntas comparables. No se fijó una fecha exacta de noviembre.

El moderador autoriza el registro antes de asignar preguntas. Un registro no autorizado no cuenta como evaluación rendida ni impide comenzar la sala. Durante una sesión activa se pueden añadir nombres sin duplicarlos en la misma sociedad y etapa. La autorización tardía recibe el vencimiento original, sin descuentos adicionales. Se evita otro registro del mismo UID en la etapa; la verificación presencial sigue siendo necesaria para confirmar a la persona.

`app_private.control_intentos` conserva la pantalla autorizada y el último contacto. Las escrituras y las preguntas exigen el encabezado de instancia y autorización vigente. Hay consulta periódica con dispersión temporal; los participantes no dependen de Realtime. Los umbrales actuales (15 segundos oculto y 60 sin contacto) requieren validar dispositivos y red antes del evento. Una salida de página, otra pantalla o una interrupción prolongada exige revisión. Estas señales no identifican de manera fiable la causa humana del incidente.

RPC nuevas: `examen_contacto`, `admin_examen_agregar`, `admin_examen_autorizar`, `admin_examen_justificar` y `admin_examen_calificar_rubrica`. Los wrappers públicos son invoker. Las operaciones con privilegios permanecen en el esquema privado, verifican identidad/rol, usan search_path vacío y limitan sus permisos. Las tablas públicas nuevas tienen RLS y lectura administrativa; los clientes no acceden directamente al control privado.

El QR general solo abre la sala. El QR personal transporta el código del moderador en el fragmento de URL, que la pantalla retira antes de usarlo; caduca como máximo en cinco minutos o al vencer el examen, se consume una vez y cambia el propietario del intento. No amplía el reloj. La aprobación de otra pantalla revoca la anterior para leer preguntas y responder. El encabezado de instancia es una defensa contra uso simultáneo normal; no sustituye Auth ni convierte al navegador en un entorno inviolable.

Las rúbricas escritas deben sumar el valor de su tipo. La nota se guarda por criterio mediante RPC, se vuelve a sumar transaccionalmente y se registra con el actor, revisión y comentario. La revisión optimista rechaza una nota antigua si otro jurado ya la cambió. Se pueden incluir respuestas calificadas para una segunda revisión; no se exige aún un número de revisores independientes por premio. La IA solo recibe contexto y criterios para sugerir, y todavía necesita despliegue/configuración de su función.

El ranking compara notas sobre 100 sin redondear antes de ordenar. Las sociedades consolidan sus sesiones y promedian a cada joven con igual peso. Un intento con preguntas asignadas conserva su resultado aunque no termine todas. No se usan censo, velocidad ni descuentos automáticos por señales del navegador. Las posiciones empatadas se comparten y los informes indican resultados provisionales hasta cerrar y revisar los totales.

El ensayo local del respaldo incluye esta migración y conserva todos los valores originales y los 7.139 registros de respuestas de Hebreos. No se han ensayado 150 dispositivos físicos ni una pila Supabase remota con estas reglas. La menor dependencia de Realtime no demuestra por sí sola la capacidad: quedan por comprobar Auth/altas anónimas por IP, escrituras de borrador, límites REST, conexiones y recuperación de red. Los scripts de navegador usan datos ficticios y los tests de base usan PGlite, que serializa sus consultas.


En esta revisión el bloqueo de Hebreos también se aplica a las políticas RLS de las tablas y del archivo para el rol de la aplicación. Sus metadatos siguen visibles como etapa bloqueada; el propietario de la base conserva el archivo y puede verificar/restaurar sus datos. No se borró el historial.
