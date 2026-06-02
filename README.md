# Torneo Bíblico UJELADEA

Plataforma de evaluación interactiva para competencias bíblicas de jóvenes, diseñada para la Iglesia de los Amigos (Quakers) en Bolivia.

## Características
- Autenticación segura (Directiva/Admin)
- Creación de sesiones de exámenes con salas de espera en tiempo real (Supabase Realtime)
- Panel de control de administradores
- Evaluación de preguntas abiertas apoyado por IA (Groq - Llama 3)
- Ranking automático y escalable en base al censo de las sociedades
- Banco de preguntas reutilizable

## Variables de Entorno Requeridas

Para correr este proyecto necesitas un archivo `.env` o `.env.local` en la raíz con lo siguiente:

```env
VITE_SUPABASE_URL="tu_url_de_supabase"
VITE_SUPABASE_ANON_KEY="tu_anon_key_de_supabase"
VITE_GROQ_API_KEY="tu_api_key_de_groq"
```

## Guía de Despliegue en Vercel

1. Sube tu código a GitHub.
2. Inicia sesión en [Vercel](https://vercel.com).
3. Haz clic en "Add New..." > "Project".
4. Conecta tu repositorio de GitHub.
5. En "Environment Variables", agrega las 3 claves mencionadas arriba.
6. Haz clic en "Deploy".
*Nota: El archivo `vercel.json` incluido en el repositorio asegurará que las rutas funcionen correctamente sin arrojar errores 404 al recargar.*

## Configuración en Supabase

### 1. Crear el usuario Admin
En tu panel de Supabase:
- Ve a **Authentication** > **Users**.
- Haz clic en **Add user** > **Create new user**.
- Ingresa el correo y contraseña para el administrador. (Esto se usará para entrar al panel).

### 2. Cargar el Banco de Preguntas
Una vez logueado en la plataforma como admin, navega a **Banco de Preguntas** en el menú superior y podrás crear/editar tus preguntas manualmente, seleccionando puntajes y respuestas de referencia para la IA.

¡Bendiciones en el torneo!
