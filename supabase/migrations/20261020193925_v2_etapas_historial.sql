-- Aplicar solo después de registrar/verificar el baseline de V1.
-- Esta migración NO limpia duplicados ni recalcula resultados históricos.
BEGIN;

LOCK TABLE public.sociedades, public.sesiones, public.participantes,
  public.preguntas, public.respuestas, public.eventos_sesion IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sesiones WHERE estado IS DISTINCT FROM 'finalizado') THEN
    RAISE EXCEPTION 'Hay sesiones sin finalizar. No se puede archivar Hebreos todavía.';
  END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app_private TO authenticated;

CREATE FUNCTION app_private.es_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
    AND coalesce(auth.jwt() -> 'app_metadata' ->> 'role' = 'admin', false);
$$;
REVOKE ALL ON FUNCTION app_private.es_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.es_admin() TO authenticated;

CREATE TABLE public.etapas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE CHECK (length(btrim(codigo)) > 0),
  nombre text NOT NULL CHECK (length(btrim(nombre)) > 0),
  libro text NOT NULL CHECK (length(btrim(libro)) > 0),
  anio integer NOT NULL CHECK (anio >= 2000),
  numero integer NOT NULL CHECK (numero > 0),
  estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'activa', 'cerrada')),
  tiempo_limite integer NOT NULL DEFAULT 60 CHECK (tiempo_limite BETWEEN 1 AND 240),
  cantidad_preguntas integer NOT NULL DEFAULT 45 CHECK (cantidad_preguntas BETWEEN 1 AND 200),
  reglas jsonb NOT NULL DEFAULT '{"version":2}'::jsonb CHECK (jsonb_typeof(reglas) = 'object'),
  historica boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  cerrado_at timestamptz,
  UNIQUE (anio, numero),
  CHECK ((estado = 'cerrada') = (cerrado_at IS NOT NULL)),
  CHECK (NOT historica OR estado = 'cerrada')
);
CREATE UNIQUE INDEX etapas_una_activa_por_anio ON public.etapas (anio) WHERE estado = 'activa';

INSERT INTO public.etapas
  (codigo, nombre, libro, anio, numero, estado, reglas, historica, created_at, cerrado_at)
VALUES (
  '2026-01-hebreos', 'Primera etapa', 'Hebreos', 2026, 1, 'cerrada',
  '{"version":1,"preservar_resultados_originales":true}'::jsonb, true,
  coalesce((SELECT min(created_at) FROM public.sesiones), now()),
  coalesce((SELECT max(finalizado_at) FROM public.sesiones), now())
), (
  '2026-02-efesios', 'Segunda etapa', 'Efesios', 2026, 2, 'borrador',
  '{"version":2}'::jsonb, false, now(), NULL
);

CREATE TABLE public.archivos_etapa (
  etapa_id uuid PRIMARY KEY REFERENCES public.etapas(id) ON DELETE RESTRICT,
  capturado_at timestamptz NOT NULL DEFAULT now(),
  version_formato integer NOT NULL DEFAULT 1,
  contenido jsonb NOT NULL CHECK (jsonb_typeof(contenido) = 'object')
);

-- Capturar los valores originales ANTES de añadir columnas de V2.
INSERT INTO public.archivos_etapa (etapa_id, contenido)
SELECT e.id, jsonb_build_object(
  'etapa', to_jsonb(e), 'origen', 'v1_sin_recalcular',
  'datos', jsonb_build_object(
    'sociedades', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM public.sociedades t),
    'sesiones', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM public.sesiones t),
    'participantes', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM public.participantes t),
    'preguntas', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM public.preguntas t),
    'respuestas', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM public.respuestas t),
    'eventos_sesion', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM public.eventos_sesion t)
  )
) FROM public.etapas e WHERE e.codigo = '2026-01-hebreos';

ALTER TABLE public.sesiones ADD COLUMN etapa_id uuid REFERENCES public.etapas(id);
ALTER TABLE public.preguntas ADD COLUMN etapa_id uuid REFERENCES public.etapas(id);
UPDATE public.sesiones SET etapa_id = (SELECT id FROM public.etapas WHERE codigo = '2026-01-hebreos');
UPDATE public.preguntas SET etapa_id = (SELECT id FROM public.etapas WHERE codigo = '2026-01-hebreos');
ALTER TABLE public.sesiones ALTER COLUMN etapa_id SET NOT NULL;
ALTER TABLE public.preguntas ALTER COLUMN etapa_id SET NOT NULL;

CREATE INDEX sesiones_sociedad_id_idx ON public.sesiones (sociedad_id);
CREATE INDEX sesiones_etapa_id_idx ON public.sesiones (etapa_id);
CREATE INDEX preguntas_etapa_id_idx ON public.preguntas (etapa_id);
CREATE INDEX participantes_sesion_id_idx ON public.participantes (sesion_id);
CREATE INDEX respuestas_participante_id_idx ON public.respuestas (participante_id);
CREATE INDEX respuestas_pregunta_id_idx ON public.respuestas (pregunta_id);
CREATE INDEX eventos_sesion_participante_id_idx ON public.eventos_sesion (participante_id);
CREATE INDEX eventos_sesion_sesion_id_idx ON public.eventos_sesion (sesion_id);

CREATE FUNCTION app_private.proteger_datos_etapa() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  anterior jsonb;
  siguiente jsonb;
  fila jsonb;
  etapa uuid;
  estado_etapa text;
  etapa_pregunta uuid;
  etapa_participante uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN anterior := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN siguiente := to_jsonb(NEW); END IF;

  -- La identidad y las asociaciones son estables durante todo el examen.
  IF TG_OP = 'UPDATE' AND (
    anterior -> 'id' IS DISTINCT FROM siguiente -> 'id'
    OR (TG_TABLE_NAME IN ('sesiones', 'preguntas') AND anterior -> 'etapa_id' IS DISTINCT FROM siguiente -> 'etapa_id')
    OR (TG_TABLE_NAME IN ('participantes', 'eventos_sesion') AND anterior -> 'sesion_id' IS DISTINCT FROM siguiente -> 'sesion_id')
    OR (TG_TABLE_NAME IN ('respuestas', 'eventos_sesion') AND anterior -> 'participante_id' IS DISTINCT FROM siguiente -> 'participante_id')
    OR (TG_TABLE_NAME = 'respuestas' AND anterior -> 'pregunta_id' IS DISTINCT FROM siguiente -> 'pregunta_id')
  ) THEN
    RAISE EXCEPTION 'No se puede cambiar la identidad o etapa de un registro existente.';
  END IF;

  FOR fila IN SELECT value FROM jsonb_array_elements(jsonb_build_array(anterior, siguiente))
    WHERE value <> 'null'::jsonb
  LOOP
    IF TG_TABLE_NAME IN ('sesiones', 'preguntas') THEN
      etapa := (fila ->> 'etapa_id')::uuid;
    ELSIF TG_TABLE_NAME IN ('participantes', 'eventos_sesion') THEN
      SELECT s.etapa_id INTO etapa FROM public.sesiones s WHERE s.id = (fila ->> 'sesion_id')::uuid;
    ELSE
      SELECT s.etapa_id INTO etapa FROM public.participantes p
        JOIN public.sesiones s ON s.id = p.sesion_id WHERE p.id = (fila ->> 'participante_id')::uuid;
    END IF;

    -- El bloqueo coordina las escrituras con el cierre de la etapa.
    SELECT e.estado INTO estado_etapa FROM public.etapas e WHERE e.id = etapa FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El registro debe pertenecer a una etapa existente.'; END IF;
    IF estado_etapa = 'cerrada' THEN RAISE EXCEPTION 'La etapa está cerrada; sus datos son de solo lectura.'; END IF;
    IF TG_TABLE_NAME = 'sesiones' AND fila ->> 'estado' = 'activo' AND estado_etapa <> 'activa' THEN
      RAISE EXCEPTION 'Activa la etapa antes de iniciar un examen.';
    END IF;
  END LOOP;

  IF TG_OP <> 'DELETE' AND TG_TABLE_NAME = 'respuestas' THEN
    SELECT q.etapa_id INTO etapa_pregunta FROM public.preguntas q WHERE q.id = NEW.pregunta_id;
    SELECT s.etapa_id INTO etapa_participante FROM public.participantes p
      JOIN public.sesiones s ON s.id = p.sesion_id WHERE p.id = NEW.participante_id;
    IF etapa_pregunta IS DISTINCT FROM etapa_participante THEN
      RAISE EXCEPTION 'La pregunta y el participante pertenecen a etapas diferentes.';
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' AND TG_TABLE_NAME = 'eventos_sesion' AND siguiente ->> 'participante_id' IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.participantes p WHERE p.id = NEW.participante_id AND p.sesion_id = NEW.sesion_id) THEN
      RAISE EXCEPTION 'El evento no pertenece a la sesión del participante.';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.proteger_datos_etapa() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION app_private.validar_etapa() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'borrador' OR NEW.historica THEN
      RAISE EXCEPTION 'Las nuevas etapas deben crearse en borrador.';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.estado = 'cerrada' THEN RAISE EXCEPTION 'Una etapa cerrada no se puede modificar ni reabrir.'; END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.estado <> 'borrador' THEN RAISE EXCEPTION 'Solo se puede eliminar una etapa en borrador.'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.historica IS DISTINCT FROM OLD.historica THEN
    RAISE EXCEPTION 'No se puede modificar la identidad o procedencia de una etapa.';
  END IF;
  IF OLD.estado = 'activa' AND (NEW.libro, NEW.anio, NEW.numero, NEW.cantidad_preguntas, NEW.tiempo_limite, NEW.reglas)
    IS DISTINCT FROM (OLD.libro, OLD.anio, OLD.numero, OLD.cantidad_preguntas, OLD.tiempo_limite, OLD.reglas) THEN
    RAISE EXCEPTION 'La configuración del examen queda fija al activar la etapa.';
  END IF;
  IF OLD.estado = 'activa' AND NEW.estado = 'borrador' THEN
    RAISE EXCEPTION 'Una etapa activa no puede volver a borrador.';
  END IF;
  IF OLD.estado = 'borrador' AND NEW.estado = 'cerrada' THEN
    RAISE EXCEPTION 'La etapa debe estar activa antes de cerrarla.';
  END IF;
  IF NEW.estado = 'activa' AND OLD.estado <> 'activa' THEN
    IF (SELECT count(*) FROM public.preguntas WHERE etapa_id = NEW.id AND activa) < NEW.cantidad_preguntas THEN
      RAISE EXCEPTION 'Faltan preguntas activas para iniciar esta etapa.';
    END IF;
  END IF;
  IF NEW.estado = 'cerrada' AND OLD.estado <> 'cerrada' THEN
    IF EXISTS (SELECT 1 FROM public.sesiones WHERE etapa_id = NEW.id AND estado IS DISTINCT FROM 'finalizado') THEN
      RAISE EXCEPTION 'Finaliza todas las sesiones antes de cerrar la etapa.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.respuestas r JOIN public.participantes p ON p.id = r.participante_id
      JOIN public.sesiones s ON s.id = p.sesion_id WHERE s.etapa_id = NEW.id
      AND (r.calificado_por = 'pendiente_ia' OR r.puntaje_obtenido IS NULL)) THEN
      RAISE EXCEPTION 'Hay respuestas pendientes de calificación.';
    END IF;
    NEW.cerrado_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.validar_etapa() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION app_private.archivo_inmutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$ BEGIN RAISE EXCEPTION 'El archivo histórico es inmutable.'; END; $$;
REVOKE ALL ON FUNCTION app_private.archivo_inmutable() FROM PUBLIC, anon, authenticated;

-- SECURITY DEFINER se limita a insertar el archivo al cerrar una etapa.
-- El esquema es privado, el llamante debe ser administrador y no hay RPC pública.
CREATE FUNCTION app_private.archivar_cierre() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo un administrador puede cerrar una etapa.'; END IF;
  INSERT INTO public.archivos_etapa (etapa_id, contenido)
  SELECT NEW.id, jsonb_build_object('etapa', to_jsonb(NEW), 'origen', 'cierre_v2', 'datos', jsonb_build_object(
    'sociedades', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.sociedades t WHERE EXISTS (SELECT 1 FROM public.sesiones s WHERE s.sociedad_id = t.id AND s.etapa_id = NEW.id)),
    'sesiones', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.sesiones t WHERE t.etapa_id = NEW.id),
    'participantes', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.participantes t JOIN public.sesiones s ON s.id = t.sesion_id WHERE s.etapa_id = NEW.id),
    'preguntas', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.preguntas t WHERE t.etapa_id = NEW.id),
    'respuestas', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.respuestas t JOIN public.participantes p ON p.id = t.participante_id JOIN public.sesiones s ON s.id = p.sesion_id WHERE s.etapa_id = NEW.id),
    'eventos_sesion', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) FROM public.eventos_sesion t JOIN public.sesiones s ON s.id = t.sesion_id WHERE s.etapa_id = NEW.id)
  ));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.archivar_cierre() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER validar_etapa BEFORE INSERT OR UPDATE OR DELETE ON public.etapas
  FOR EACH ROW EXECUTE FUNCTION app_private.validar_etapa();
CREATE TRIGGER archivar_cierre AFTER UPDATE OF estado ON public.etapas
  FOR EACH ROW WHEN (NEW.estado = 'cerrada' AND OLD.estado <> 'cerrada') EXECUTE FUNCTION app_private.archivar_cierre();
CREATE TRIGGER archivo_inmutable BEFORE UPDATE OR DELETE ON public.archivos_etapa
  FOR EACH ROW EXECUTE FUNCTION app_private.archivo_inmutable();

DO $$
DECLARE nombre text;
BEGIN
  FOREACH nombre IN ARRAY ARRAY['sesiones','preguntas','participantes','respuestas','eventos_sesion'] LOOP
    EXECUTE format('CREATE TRIGGER proteger_etapa BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION app_private.proteger_datos_etapa()', nombre);
  END LOOP;
  FOREACH nombre IN ARRAY ARRAY['sociedades','sesiones','preguntas','participantes','respuestas','eventos_sesion','etapas','archivos_etapa'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', nombre);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', nombre);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', nombre);
    IF nombre = 'archivos_etapa' THEN
      EXECUTE format('CREATE POLICY admin_lectura ON public.%I FOR SELECT TO authenticated USING ((SELECT app_private.es_admin()))', nombre);
    ELSE
      EXECUTE format('GRANT INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', nombre);
      EXECUTE format('CREATE POLICY admin_gestion ON public.%I FOR ALL TO authenticated USING ((SELECT app_private.es_admin())) WITH CHECK ((SELECT app_private.es_admin()))', nombre);
    END IF;
  END LOOP;
END;
$$;

ALTER VIEW public.resumen_alertas SET (security_invoker = true);
REVOKE ALL ON TABLE public.resumen_alertas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.resumen_alertas TO authenticated;

COMMENT ON TABLE public.archivos_etapa IS 'Resultados históricos originales. Solo lectura; incluye duplicados heredados sin recalcular.';
COMMENT ON TABLE public.etapas IS 'La aplicación V2 debe filtrar sesiones, preguntas y rankings por etapa.';

COMMIT;
