-- Esquema V1 sin datos personales. Solo para bases vacías.

-- En una base existente, verificar y registrar esta versión como baseline antes de migrar.

BEGIN;

CREATE TABLE public."sociedades" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "nombre" text NOT NULL,
  "iglesia" text NOT NULL,
  "total_censo" integer,
  "created_at" timestamp with time zone DEFAULT now(),
  "activa" boolean DEFAULT true NOT NULL
);

CREATE TABLE public."preguntas" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tipo" text NOT NULL,
  "texto" text NOT NULL,
  "opciones" jsonb,
  "respuesta_correcta" text NOT NULL,
  "puntaje" integer DEFAULT 10,
  "activa" boolean DEFAULT true
);

CREATE TABLE public."sesiones" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "sociedad_id" uuid,
  "estado" text DEFAULT 'esperando'::text,
  "tiempo_limite" integer DEFAULT 45,
  "iniciado_at" timestamp with time zone,
  "finalizado_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "cantidad_preguntas" integer DEFAULT 15
);

CREATE TABLE public."participantes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "sesion_id" uuid,
  "nombre" text NOT NULL,
  "del_censo" boolean DEFAULT true,
  "registrado_at" timestamp with time zone DEFAULT now(),
  "examen_finalizado" boolean DEFAULT false,
  "puntaje_total" integer DEFAULT 0,
  "seed" text
);

CREATE TABLE public."respuestas" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "participante_id" uuid,
  "pregunta_id" uuid,
  "respuesta_dada" text,
  "es_correcta" boolean,
  "puntaje_obtenido" integer DEFAULT 0,
  "calificado_por" text DEFAULT 'automatico'::text,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE public."eventos_sesion" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "participante_id" uuid,
  "sesion_id" uuid,
  "tipo" text NOT NULL,
  "cantidad" integer DEFAULT 1,
  "ultimo_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE public."eventos_sesion" ADD CONSTRAINT "eventos_sesion_pkey" PRIMARY KEY (id);

ALTER TABLE public."participantes" ADD CONSTRAINT "participantes_pkey" PRIMARY KEY (id);

ALTER TABLE public."preguntas" ADD CONSTRAINT "preguntas_pkey" PRIMARY KEY (id);

ALTER TABLE public."respuestas" ADD CONSTRAINT "respuestas_pkey" PRIMARY KEY (id);

ALTER TABLE public."sesiones" ADD CONSTRAINT "sesiones_pkey" PRIMARY KEY (id);

ALTER TABLE public."sociedades" ADD CONSTRAINT "sociedades_pkey" PRIMARY KEY (id);

ALTER TABLE public."eventos_sesion" ADD CONSTRAINT "eventos_sesion_participante_id_fkey" FOREIGN KEY (participante_id) REFERENCES participantes(id);

ALTER TABLE public."eventos_sesion" ADD CONSTRAINT "eventos_sesion_sesion_id_fkey" FOREIGN KEY (sesion_id) REFERENCES sesiones(id);

ALTER TABLE public."participantes" ADD CONSTRAINT "participantes_sesion_id_fkey" FOREIGN KEY (sesion_id) REFERENCES sesiones(id);

ALTER TABLE public."respuestas" ADD CONSTRAINT "respuestas_participante_id_fkey" FOREIGN KEY (participante_id) REFERENCES participantes(id);

ALTER TABLE public."respuestas" ADD CONSTRAINT "respuestas_pregunta_id_fkey" FOREIGN KEY (pregunta_id) REFERENCES preguntas(id);

ALTER TABLE public."sesiones" ADD CONSTRAINT "sesiones_sociedad_id_fkey" FOREIGN KEY (sociedad_id) REFERENCES sociedades(id);

CREATE VIEW public."resumen_alertas" AS  SELECT p.id AS participante_id,
    p.nombre,
    p.sesion_id,
    count(e.id) AS total_eventos,
    max(e.ultimo_at) AS ultima_alerta,
    json_agg(json_build_object('tipo', e.tipo, 'cantidad', e.cantidad, 'ultimo_at', e.ultimo_at)) AS detalle
   FROM participantes p
     LEFT JOIN eventos_sesion e ON e.participante_id = p.id
  GROUP BY p.id, p.nombre, p.sesion_id;

COMMIT;
