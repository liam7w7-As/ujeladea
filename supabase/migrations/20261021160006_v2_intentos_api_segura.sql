-- V2: intentos autenticados, preguntas congeladas, borradores e idempotencia.
-- Solo local/staging. No aplica ninguna corrección a los registros históricos de V1.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.respuestas r JOIN public.participantes p ON p.id=r.participante_id JOIN public.sesiones s ON s.id=p.sesion_id JOIN public.etapas e ON e.id=s.etapa_id WHERE NOT e.historica)
    OR EXISTS (SELECT 1 FROM public.sesiones s JOIN public.etapas e ON e.id=s.etapa_id WHERE NOT e.historica AND s.estado<>'esperando') THEN
    RAISE EXCEPTION 'Hay exámenes V2 previos: revisa sus datos antes de incorporar los intentos.';
  END IF;
END; $$;

CREATE TABLE public.intentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participante_id uuid NOT NULL UNIQUE REFERENCES public.participantes(id) ON DELETE RESTRICT,
  usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  sesion_id uuid NOT NULL REFERENCES public.sesiones(id) ON DELETE RESTRICT,
  etapa_id uuid NOT NULL REFERENCES public.etapas(id) ON DELETE RESTRICT,
  estado text NOT NULL DEFAULT 'registrado' CHECK (estado IN ('registrado','en_curso','finalizado')),
  cantidad_preguntas integer NOT NULL CHECK (cantidad_preguntas BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  iniciado_at timestamptz,
  vence_at timestamptz,
  finalizado_at timestamptz,
  motivo_cierre text CHECK (motivo_cierre IN ('completado','entrega','tiempo','cierre_sesion')),
  UNIQUE (sesion_id, usuario_id),
  CHECK ((estado = 'finalizado') = (finalizado_at IS NOT NULL)),
  CHECK (estado <> 'en_curso' OR (iniciado_at IS NOT NULL AND vence_at IS NOT NULL))
);
CREATE INDEX intentos_usuario_id_idx ON public.intentos(usuario_id);
CREATE INDEX intentos_etapa_id_idx ON public.intentos(etapa_id);

CREATE TABLE public.intento_preguntas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intento_id uuid NOT NULL REFERENCES public.intentos(id) ON DELETE RESTRICT,
  pregunta_id uuid NOT NULL REFERENCES public.preguntas(id) ON DELETE RESTRICT,
  posicion integer NOT NULL CHECK (posicion BETWEEN 1 AND 200),
  tipo text NOT NULL CHECK (tipo IN ('multiple','abierta','contexto')),
  texto text NOT NULL,
  opciones jsonb,
  respuesta_correcta text NOT NULL,
  puntaje integer NOT NULL CHECK (puntaje > 0),
  borrador text NOT NULL DEFAULT '' CHECK (length(borrador) <= 2000),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  borrador_at timestamptz,
  UNIQUE (intento_id,posicion),
  UNIQUE (intento_id,pregunta_id)
);
CREATE INDEX intento_preguntas_pregunta_id_idx ON public.intento_preguntas(pregunta_id);

ALTER TABLE public.respuestas
  ADD COLUMN intento_id uuid REFERENCES public.intentos(id) ON DELETE RESTRICT,
  ADD COLUMN intento_pregunta_id uuid REFERENCES public.intento_preguntas(id) ON DELETE RESTRICT,
  ADD COLUMN solicitud_id uuid,
  ADD CONSTRAINT respuesta_v2_completa CHECK (
    (intento_id IS NULL AND intento_pregunta_id IS NULL AND solicitud_id IS NULL)
    OR (intento_id IS NOT NULL AND intento_pregunta_id IS NOT NULL AND solicitud_id IS NOT NULL)
  );
CREATE UNIQUE INDEX respuesta_v2_unica ON public.respuestas(intento_pregunta_id) WHERE intento_pregunta_id IS NOT NULL;
CREATE UNIQUE INDEX respuesta_v2_solicitud_unica ON public.respuestas(intento_id,solicitud_id) WHERE intento_id IS NOT NULL;
CREATE INDEX respuestas_intento_id_idx ON public.respuestas(intento_id);

ALTER TABLE public.eventos_sesion
  ADD COLUMN intento_id uuid REFERENCES public.intentos(id) ON DELETE RESTRICT,
  ADD COLUMN solicitud_id uuid;
CREATE UNIQUE INDEX evento_v2_solicitud_unica ON public.eventos_sesion(intento_id,solicitud_id) WHERE intento_id IS NOT NULL;
CREATE INDEX eventos_v2_tipo_fecha_idx ON public.eventos_sesion(intento_id,tipo,ultimo_at DESC);

CREATE TABLE app_private.codigos_reanudacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intento_id uuid NOT NULL UNIQUE REFERENCES public.intentos(id) ON DELETE RESTRICT,
  codigo_hash text NOT NULL UNIQUE,
  vence_at timestamptz NOT NULL,
  usado_at timestamptz
);
ALTER TABLE app_private.codigos_reanudacion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.codigos_reanudacion FROM PUBLIC,anon,authenticated;

-- Se mantiene lectura administrativa; participantes no reciben SELECT ni escritura directa.
ALTER TABLE public.intentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intento_preguntas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intentos,public.intento_preguntas FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.intentos,public.intento_preguntas TO authenticated;
CREATE POLICY admin_lectura ON public.intentos FOR SELECT TO authenticated USING ((SELECT app_private.es_admin()));
CREATE POLICY admin_lectura ON public.intento_preguntas FOR SELECT TO authenticated USING ((SELECT app_private.es_admin()));
REVOKE INSERT,UPDATE,DELETE ON public.respuestas FROM authenticated;

CREATE FUNCTION app_private.examen_uid() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Inicia una sesión de participante.' USING ERRCODE='42501'; END IF;
  RETURN auth.uid();
END; $$;

CREATE FUNCTION app_private.examen_validar_pregunta() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
BEGIN
  IF (SELECT historica FROM public.etapas WHERE id=NEW.etapa_id) THEN RETURN NEW; END IF;
  IF NEW.tipo NOT IN ('multiple','abierta','contexto') OR length(btrim(NEW.texto))=0
    OR length(btrim(NEW.respuesta_correcta))=0 OR NEW.puntaje IS NULL OR NEW.puntaje<1 THEN
    RAISE EXCEPTION 'Revisa el tipo, texto, referencia y puntaje de la pregunta.';
  END IF;
  IF NEW.tipo='multiple' THEN
    IF jsonb_typeof(NEW.opciones) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Las opciones deben ser una lista.'; END IF;
    IF jsonb_array_length(NEW.opciones) NOT BETWEEN 2 AND 10
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.opciones) o WHERE jsonb_typeof(o)<>'string' OR length(btrim(o #>> '{}'))=0)
      OR (SELECT count(DISTINCT lower(btrim(o))) FROM jsonb_array_elements_text(NEW.opciones) o) <> jsonb_array_length(NEW.opciones)
      OR NOT NEW.opciones @> jsonb_build_array(NEW.respuesta_correcta) THEN
      RAISE EXCEPTION 'Ingresa de 2 a 10 opciones distintas e indica una de ellas como respuesta correcta.';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER validar_pregunta_v2 BEFORE INSERT OR UPDATE ON public.preguntas
  FOR EACH ROW EXECUTE FUNCTION app_private.examen_validar_pregunta();

CREATE FUNCTION app_private.examen_proteger_filas() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE etapa uuid;
BEGIN
  IF TG_TABLE_NAME='intentos' THEN
    etapa:=coalesce(NEW.etapa_id,OLD.etapa_id);
    IF TG_OP='UPDATE' AND (NEW.id,NEW.participante_id,NEW.sesion_id,NEW.etapa_id,NEW.cantidad_preguntas,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.participante_id,OLD.sesion_id,OLD.etapa_id,OLD.cantidad_preguntas,OLD.created_at) THEN
      RAISE EXCEPTION 'La identidad y configuración del intento son inmutables.';
    END IF;
    IF TG_OP='UPDATE' AND OLD.estado='finalizado' THEN RAISE EXCEPTION 'El intento ya está finalizado.'; END IF;
  ELSE
    SELECT etapa_id INTO etapa FROM public.intentos WHERE id=coalesce(NEW.intento_id,OLD.intento_id);
    IF TG_OP='UPDATE' AND (NEW.id,NEW.intento_id,NEW.pregunta_id,NEW.posicion,NEW.tipo,NEW.texto,NEW.opciones,NEW.respuesta_correcta,NEW.puntaje)
      IS DISTINCT FROM (OLD.id,OLD.intento_id,OLD.pregunta_id,OLD.posicion,OLD.tipo,OLD.texto,OLD.opciones,OLD.respuesta_correcta,OLD.puntaje) THEN
      RAISE EXCEPTION 'Las preguntas asignadas no se pueden cambiar.';
    END IF;
  END IF;
  IF (SELECT estado FROM public.etapas WHERE id=etapa)='cerrada' THEN RAISE EXCEPTION 'La etapa está cerrada; sus datos son de solo lectura.'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Los intentos y sus preguntas se conservan para auditoría.'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER proteger_intento BEFORE INSERT OR UPDATE OR DELETE ON public.intentos FOR EACH ROW EXECUTE FUNCTION app_private.examen_proteger_filas();
CREATE TRIGGER proteger_asignacion BEFORE INSERT OR UPDATE OR DELETE ON public.intento_preguntas FOR EACH ROW EXECUTE FUNCTION app_private.examen_proteger_filas();

CREATE FUNCTION app_private.examen_validar_respuesta() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE i public.intentos; q public.intento_preguntas; historica boolean;
BEGIN
  SELECT e.historica INTO historica FROM public.participantes p JOIN public.sesiones s ON s.id=p.sesion_id
    JOIN public.etapas e ON e.id=s.etapa_id WHERE p.id=NEW.participante_id;
  IF historica THEN RETURN NEW; END IF;
  IF NEW.intento_id IS NULL OR NEW.intento_pregunta_id IS NULL THEN RAISE EXCEPTION 'V2 requiere una pregunta asignada en servidor.'; END IF;
  SELECT * INTO i FROM public.intentos WHERE id=NEW.intento_id;
  SELECT * INTO q FROM public.intento_preguntas WHERE id=NEW.intento_pregunta_id;
  IF i.id IS NULL OR q.id IS NULL OR q.intento_id<>i.id OR i.participante_id<>NEW.participante_id OR q.pregunta_id<>NEW.pregunta_id THEN
    RAISE EXCEPTION 'La respuesta no pertenece a este intento.';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.respuesta_dada,NEW.intento_id,NEW.intento_pregunta_id,NEW.solicitud_id)
    IS DISTINCT FROM (OLD.respuesta_dada,OLD.intento_id,OLD.intento_pregunta_id,OLD.solicitud_id) THEN
    RAISE EXCEPTION 'Una respuesta confirmada no se puede reemplazar.';
  END IF;
  IF NEW.puntaje_obtenido IS NOT NULL AND (NEW.puntaje_obtenido<0 OR NEW.puntaje_obtenido>q.puntaje) THEN
    RAISE EXCEPTION 'El puntaje excede el valor asignado.';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER validar_respuesta_v2 BEFORE INSERT OR UPDATE ON public.respuestas FOR EACH ROW EXECUTE FUNCTION app_private.examen_validar_respuesta();

CREATE FUNCTION app_private.examen_iniciar(p_intento uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE i public.intentos; s public.sesiones;
BEGIN
  PERFORM app_private.examen_uid();
  SELECT * INTO i FROM public.intentos WHERE id=p_intento FOR UPDATE;
  IF i.estado<>'registrado' THEN RETURN; END IF;
  SELECT * INTO s FROM public.sesiones WHERE id=i.sesion_id;
  IF s.estado<>'activo' THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.preguntas WHERE etapa_id=i.etapa_id AND activa) < i.cantidad_preguntas THEN
    RAISE EXCEPTION 'El banco no tiene suficientes preguntas. Avisa al encargado.';
  END IF;
  INSERT INTO public.intento_preguntas(intento_id,pregunta_id,posicion,tipo,texto,opciones,respuesta_correcta,puntaje)
    SELECT i.id,q.id,row_number() OVER ()::int,q.tipo,q.texto,q.opciones,q.respuesta_correcta,q.puntaje
    FROM (SELECT * FROM public.preguntas WHERE etapa_id=i.etapa_id AND activa ORDER BY random() LIMIT i.cantidad_preguntas) q;
  UPDATE public.intentos SET estado='en_curso',iniciado_at=s.iniciado_at,
    vence_at=s.iniciado_at+make_interval(mins=>s.tiempo_limite) WHERE id=i.id;
END; $$;

CREATE FUNCTION app_private.examen_insertar_respuesta(p_q public.intento_preguntas,p_texto text,p_solicitud uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE i public.intentos; puntos integer; correcta boolean;
BEGIN
  PERFORM app_private.examen_uid();
  SELECT * INTO i FROM public.intentos WHERE id=p_q.intento_id;
  IF p_q.tipo='multiple' THEN
    IF NOT p_q.opciones @> jsonb_build_array(p_texto) THEN RAISE EXCEPTION 'Selecciona una opción válida.'; END IF;
    correcta:=p_texto=p_q.respuesta_correcta;
    puntos:=CASE WHEN correcta THEN p_q.puntaje ELSE 0 END;
  END IF;
  INSERT INTO public.respuestas(participante_id,pregunta_id,intento_id,intento_pregunta_id,solicitud_id,
    respuesta_dada,es_correcta,puntaje_obtenido,calificado_por)
  VALUES (i.participante_id,p_q.pregunta_id,i.id,p_q.id,p_solicitud,p_texto,correcta,puntos,
    CASE WHEN p_q.tipo='multiple' THEN 'sistema' ELSE 'pendiente_ia' END)
  ON CONFLICT (intento_pregunta_id) WHERE intento_pregunta_id IS NOT NULL DO NOTHING;
  UPDATE public.participantes SET puntaje_total=(SELECT coalesce(sum(puntaje_obtenido),0) FROM public.respuestas WHERE intento_id=i.id)
    WHERE id=i.participante_id;
END; $$;

CREATE FUNCTION app_private.examen_cerrar(p_intento uuid,p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE i public.intentos; q public.intento_preguntas;
BEGIN
  PERFORM app_private.examen_uid();
  SELECT * INTO i FROM public.intentos WHERE id=p_intento FOR UPDATE;
  IF i.estado='finalizado' THEN RETURN; END IF;
  -- Al vencer/cerrar se conserva solo un borrador que llegó al servidor dentro del tiempo.
  IF p_motivo IN ('tiempo','cierre_sesion','entrega') THEN
    SELECT a.* INTO q FROM public.intento_preguntas a
      WHERE a.intento_id=i.id AND length(btrim(a.borrador))>0 AND a.borrador_at<=i.vence_at
      AND NOT EXISTS (SELECT 1 FROM public.respuestas r WHERE r.intento_pregunta_id=a.id)
      ORDER BY a.posicion LIMIT 1;
    IF FOUND THEN PERFORM app_private.examen_insertar_respuesta(q,q.borrador,gen_random_uuid()); END IF;
  END IF;
  UPDATE public.intentos SET estado='finalizado',finalizado_at=clock_timestamp(),motivo_cierre=p_motivo WHERE id=i.id;
  UPDATE public.participantes SET examen_finalizado=true,
    puntaje_total=(SELECT coalesce(sum(puntaje_obtenido),0) FROM public.respuestas WHERE intento_id=i.id)
    WHERE id=i.participante_id;
END; $$;

CREATE FUNCTION app_private.examen_bloquear(p_intento uuid) RETURNS public.intentos
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE i public.intentos; s public.sesiones; estado_etapa text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.intentos WHERE id=p_intento AND usuario_id=app_private.examen_uid()) THEN
    RAISE EXCEPTION 'No tienes acceso a este intento.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO i FROM public.intentos WHERE id=p_intento;
  SELECT estado INTO estado_etapa FROM public.etapas WHERE id=i.etapa_id FOR SHARE;
  SELECT * INTO s FROM public.sesiones WHERE id=i.sesion_id FOR SHARE;
  SELECT * INTO i FROM public.intentos WHERE id=p_intento FOR UPDATE;
  -- Revalidar tras el bloqueo: una recuperación puede cambiar el propietario mientras se espera.
  IF i.usuario_id<>app_private.examen_uid() THEN RAISE EXCEPTION 'El intento se reanudó en otro dispositivo.' USING ERRCODE='42501'; END IF;
  IF i.estado<>'finalizado' AND estado_etapa='cerrada' THEN RAISE EXCEPTION 'La etapa está cerrada.'; END IF;
  IF i.estado<>'finalizado' AND s.estado='finalizado' THEN PERFORM app_private.examen_cerrar(i.id,'cierre_sesion');
  ELSIF i.estado='registrado' AND s.estado='activo' THEN PERFORM app_private.examen_iniciar(i.id);
  END IF;
  SELECT * INTO i FROM public.intentos WHERE id=p_intento;
  IF i.estado='en_curso' AND clock_timestamp()>=i.vence_at THEN
    PERFORM app_private.examen_cerrar(i.id,'tiempo');
    SELECT * INTO i FROM public.intentos WHERE id=p_intento;
  END IF;
  RETURN i;
END; $$;

CREATE FUNCTION app_private.examen_payload(p_intento uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE i public.intentos; s public.sesiones; e public.etapas; p public.participantes; q public.intento_preguntas;
BEGIN
  SELECT * INTO i FROM public.intentos WHERE id=p_intento AND usuario_id=app_private.examen_uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'No tienes acceso a este intento.' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM public.sesiones WHERE id=i.sesion_id;
  SELECT * INTO e FROM public.etapas WHERE id=i.etapa_id;
  SELECT * INTO p FROM public.participantes WHERE id=i.participante_id;
  IF i.estado='en_curso' THEN
    SELECT a.* INTO q FROM public.intento_preguntas a WHERE a.intento_id=i.id
      AND NOT EXISTS (SELECT 1 FROM public.respuestas r WHERE r.intento_pregunta_id=a.id) ORDER BY a.posicion LIMIT 1;
  END IF;
  RETURN jsonb_build_object('version',2,'servidor_at',clock_timestamp(),
    'etapa',jsonb_build_object('id',e.id,'nombre',e.nombre,'libro',e.libro,'anio',e.anio),
    'sesion',jsonb_build_object('id',s.id,'estado',s.estado,'sociedad',(SELECT nombre FROM public.sociedades WHERE id=s.sociedad_id)),
    'participante',jsonb_build_object('id',p.id,'nombre',p.nombre),
    'intento',jsonb_build_object('id',i.id,'estado',i.estado,'total',i.cantidad_preguntas,
      'respondidas',(SELECT count(*) FROM public.respuestas WHERE intento_id=i.id),'vence_at',i.vence_at,'motivo_cierre',i.motivo_cierre),
    'pregunta',CASE WHEN q.id IS NULL THEN NULL ELSE jsonb_build_object('id',q.id,'posicion',q.posicion,'tipo',q.tipo,
      'texto',q.texto,'opciones',q.opciones,'puntaje',q.puntaje,'borrador',q.borrador,'revision',q.revision) END);
END; $$;

-- Puntos de entrada privados: todos verifican identidad; solo los wrappers públicos son RPC.
CREATE FUNCTION app_private.examen_sala(p_sesion uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE s public.sesiones; e public.etapas; propio uuid; abierta boolean;
BEGIN
  PERFORM app_private.examen_uid();
  SELECT * INTO s FROM public.sesiones WHERE id=p_sesion;
  SELECT * INTO e FROM public.etapas WHERE id=s.etapa_id AND NOT historica;
  IF s.id IS NULL OR e.id IS NULL THEN RAISE EXCEPTION 'La sesión no está disponible.'; END IF;
  SELECT id INTO propio FROM public.intentos WHERE sesion_id=s.id AND usuario_id=auth.uid();
  abierta:=e.estado='activa' AND (s.estado='esperando' OR (s.estado='activo' AND clock_timestamp()<s.iniciado_at+make_interval(mins=>s.tiempo_limite)));
  RETURN jsonb_build_object('sesion',jsonb_build_object('id',s.id,'estado',s.estado,
    'sociedad',(SELECT nombre FROM public.sociedades WHERE id=s.sociedad_id)),
    'etapa',jsonb_build_object('libro',e.libro,'nombre',e.nombre,'anio',e.anio),
    'disponible',abierta,'intento_id',propio,
    'participantes',CASE WHEN abierta AND propio IS NULL THEN
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre) ORDER BY p.nombre),'[]'::jsonb)
        FROM public.participantes p WHERE p.sesion_id=s.id AND NOT p.examen_finalizado
        AND NOT EXISTS (SELECT 1 FROM public.intentos i WHERE i.participante_id=p.id))
      ELSE '[]'::jsonb END);
END; $$;

CREATE FUNCTION app_private.examen_registrar(p_sesion uuid,p_participante uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE s public.sesiones; e public.etapas; p public.participantes; intento uuid;
BEGIN
  PERFORM app_private.examen_uid();
  SELECT * INTO s FROM public.sesiones WHERE id=p_sesion;
  SELECT * INTO e FROM public.etapas WHERE id=s.etapa_id FOR SHARE;
  SELECT * INTO s FROM public.sesiones WHERE id=p_sesion FOR SHARE;
  IF s.id IS NULL OR e.historica OR e.estado<>'activa' OR s.estado NOT IN ('esperando','activo') THEN
    RAISE EXCEPTION 'La sesión no está disponible para registrarte.';
  END IF;
  IF s.estado='activo' AND clock_timestamp()>=s.iniciado_at+make_interval(mins=>s.tiempo_limite) THEN RAISE EXCEPTION 'El tiempo de la sesión terminó.'; END IF;
  SELECT * INTO p FROM public.participantes WHERE id=p_participante AND sesion_id=p_sesion FOR UPDATE;
  IF NOT FOUND OR p.examen_finalizado THEN RAISE EXCEPTION 'Este participante no está disponible.'; END IF;
  SELECT id INTO intento FROM public.intentos WHERE participante_id=p.id AND usuario_id=auth.uid();
  IF intento IS NOT NULL THEN RETURN app_private.examen_payload(intento); END IF;
  IF EXISTS (SELECT 1 FROM public.intentos WHERE participante_id=p.id) THEN RAISE EXCEPTION 'Ese nombre ya está registrado en otro dispositivo.' USING ERRCODE='23505'; END IF;
  IF EXISTS (SELECT 1 FROM public.intentos WHERE sesion_id=s.id AND usuario_id=auth.uid()) THEN RAISE EXCEPTION 'Este dispositivo ya tiene un participante en la sesión.' USING ERRCODE='23505'; END IF;
  INSERT INTO public.intentos(participante_id,usuario_id,sesion_id,etapa_id,cantidad_preguntas)
    VALUES(p.id,auth.uid(),s.id,e.id,s.cantidad_preguntas) RETURNING id INTO intento;
  UPDATE public.participantes SET registrado_at=clock_timestamp(),seed=intento::text WHERE id=p.id;
  PERFORM app_private.examen_iniciar(intento);
  RETURN app_private.examen_payload(intento);
END; $$;

CREATE FUNCTION app_private.examen_estado(p_intento uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  PERFORM app_private.examen_bloquear(p_intento);
  RETURN app_private.examen_payload(p_intento);
END; $$;

CREATE FUNCTION app_private.examen_borrador(p_intento uuid,p_pregunta uuid,p_texto text,p_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE i public.intentos; q public.intento_preguntas; actual uuid; recibido timestamptz;
BEGIN
  i:=app_private.examen_bloquear(p_intento);
  IF i.estado='finalizado' THEN RETURN app_private.examen_payload(i.id); END IF;
  recibido:=clock_timestamp();
  IF i.estado='en_curso' AND recibido>=i.vence_at THEN
    PERFORM app_private.examen_cerrar(i.id,'tiempo');
    RETURN app_private.examen_payload(i.id);
  END IF;
  IF i.estado<>'en_curso' OR p_texto IS NULL OR length(p_texto)>2000 OR p_revision IS NULL THEN RAISE EXCEPTION 'Borrador inválido.'; END IF;
  SELECT * INTO q FROM public.intento_preguntas WHERE id=p_pregunta AND intento_id=i.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esta pregunta no pertenece a tu intento.' USING ERRCODE='42501'; END IF;
  SELECT a.id INTO actual FROM public.intento_preguntas a WHERE a.intento_id=i.id
    AND NOT EXISTS (SELECT 1 FROM public.respuestas r WHERE r.intento_pregunta_id=a.id) ORDER BY posicion LIMIT 1;
  IF q.id<>actual THEN RETURN app_private.examen_payload(i.id); END IF;
  IF q.revision<>p_revision AND q.borrador IS DISTINCT FROM p_texto THEN
    RAISE EXCEPTION 'El borrador cambió en otra pestaña. Recarga para revisarlo.' USING ERRCODE='40001';
  END IF;
  IF length(p_texto)>0 AND q.tipo='multiple' AND NOT q.opciones @> jsonb_build_array(p_texto) THEN RAISE EXCEPTION 'Selecciona una opción válida.'; END IF;
  IF q.borrador IS DISTINCT FROM p_texto THEN
    UPDATE public.intento_preguntas SET borrador=p_texto,revision=revision+1,borrador_at=recibido WHERE id=q.id;
  END IF;
  RETURN app_private.examen_payload(i.id);
END; $$;

CREATE FUNCTION app_private.examen_responder(p_intento uuid,p_pregunta uuid,p_texto text,p_solicitud uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE i public.intentos; q public.intento_preguntas; anterior public.respuestas; actual uuid;
BEGIN
  i:=app_private.examen_bloquear(p_intento);
  IF i.estado='finalizado' THEN RETURN app_private.examen_payload(i.id); END IF;
  SELECT * INTO anterior FROM public.respuestas WHERE intento_pregunta_id=p_pregunta AND intento_id=i.id;
  IF FOUND THEN
    IF anterior.respuesta_dada IS DISTINCT FROM p_texto THEN RAISE EXCEPTION 'Esta respuesta ya fue confirmada con otro contenido.'; END IF;
    RETURN app_private.examen_payload(i.id);
  END IF;
  IF i.estado<>'en_curso' OR p_solicitud IS NULL OR p_texto IS NULL OR length(btrim(p_texto))=0 OR length(p_texto)>2000 THEN RAISE EXCEPTION 'Respuesta inválida.'; END IF;
  SELECT a.* INTO q FROM public.intento_preguntas a WHERE a.intento_id=i.id
    AND NOT EXISTS (SELECT 1 FROM public.respuestas r WHERE r.intento_pregunta_id=a.id) ORDER BY a.posicion LIMIT 1 FOR UPDATE;
  actual:=q.id;
  IF actual IS DISTINCT FROM p_pregunta THEN RAISE EXCEPTION 'Confirma la pregunta pendiente de tu intento.' USING ERRCODE='42501'; END IF;
  PERFORM app_private.examen_insertar_respuesta(q,p_texto,p_solicitud);
  IF (SELECT count(*) FROM public.respuestas WHERE intento_id=i.id)>=i.cantidad_preguntas THEN
    PERFORM app_private.examen_cerrar(i.id,'completado');
  END IF;
  RETURN app_private.examen_payload(i.id);
END; $$;

CREATE FUNCTION app_private.examen_finalizar(p_intento uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE i public.intentos;
BEGIN
  i:=app_private.examen_bloquear(p_intento);
  IF i.estado='registrado' THEN RAISE EXCEPTION 'El examen todavía no ha comenzado.'; END IF;
  IF i.estado<>'finalizado' THEN PERFORM app_private.examen_cerrar(i.id,'entrega'); END IF;
  RETURN app_private.examen_payload(i.id);
END; $$;

CREATE FUNCTION app_private.examen_eventos(p_intento uuid,p_eventos jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE i public.intentos; evento jsonb; v_tipo text;
BEGIN
  i:=app_private.examen_bloquear(p_intento);
  IF i.estado<>'en_curso' THEN RETURN jsonb_build_object('aceptados',0); END IF;
  IF jsonb_typeof(p_eventos) IS DISTINCT FROM 'array' OR jsonb_array_length(p_eventos)>20 THEN RAISE EXCEPTION 'Lote de eventos inválido.'; END IF;
  FOR evento IN SELECT value FROM jsonb_array_elements(p_eventos) LOOP
    v_tipo:=evento->>'tipo';
    IF v_tipo IS NULL OR v_tipo NOT IN ('cambio_pestana','salio_fullscreen','desenfoque','intento_copiar','intento_pegar','intento_clic_derecho','devtools_detectado') THEN RAISE EXCEPTION 'Tipo de evento inválido.'; END IF;
    IF evento->>'id' IS NULL THEN RAISE EXCEPTION 'El evento necesita un identificador.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.eventos_sesion WHERE intento_id=i.id AND eventos_sesion.tipo=v_tipo AND ultimo_at>clock_timestamp()-interval '5 seconds') THEN
      INSERT INTO public.eventos_sesion(participante_id,sesion_id,intento_id,solicitud_id,tipo,cantidad,ultimo_at)
        VALUES(i.participante_id,i.sesion_id,i.id,(evento->>'id')::uuid,v_tipo,1,clock_timestamp())
        ON CONFLICT (intento_id,solicitud_id) WHERE intento_id IS NOT NULL DO NOTHING;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('aceptados',(SELECT count(*) FROM public.eventos_sesion WHERE intento_id=i.id));
END; $$;

-- Administración: contexto y calificación acotada, sumas transaccionales, código de traslado de un solo uso.
CREATE FUNCTION app_private.admin_examen_contexto(p_respuesta uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE r public.respuestas; q public.intento_preguntas; i public.intentos;
BEGIN
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.respuestas WHERE id=p_respuesta;
  SELECT * INTO q FROM public.intento_preguntas WHERE id=r.intento_pregunta_id;
  SELECT * INTO i FROM public.intentos WHERE id=r.intento_id;
  IF q.id IS NULL OR (SELECT estado FROM public.etapas WHERE id=i.etapa_id)='cerrada' THEN RAISE EXCEPTION 'Esta respuesta no admite calificación en V2.'; END IF;
  RETURN jsonb_build_object('id',r.id,'texto',q.texto,'tipo',q.tipo,'referencia',q.respuesta_correcta,'maximo',q.puntaje,
    'respuesta',r.respuesta_dada,'pendiente',r.calificado_por='pendiente_ia');
END; $$;

CREATE FUNCTION app_private.admin_examen_calificar(p_respuesta uuid,p_puntaje integer,p_metodo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE r public.respuestas; i public.intentos; q public.intento_preguntas;
BEGIN
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.respuestas WHERE id=p_respuesta;
  SELECT * INTO i FROM public.intentos WHERE id=r.intento_id;
  IF i.id IS NULL THEN RAISE EXCEPTION 'No se recalifican respuestas históricas.'; END IF;
  PERFORM 1 FROM public.etapas WHERE id=i.etapa_id AND estado<>'cerrada' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La etapa está cerrada.'; END IF;
  -- Serializar por participante evita perder sumas al calificar respuestas distintas en paralelo.
  PERFORM 1 FROM public.participantes WHERE id=i.participante_id FOR UPDATE;
  SELECT * INTO r FROM public.respuestas WHERE id=p_respuesta FOR UPDATE;
  SELECT * INTO q FROM public.intento_preguntas WHERE id=r.intento_pregunta_id;
  IF p_puntaje IS NULL OR p_puntaje<0 OR p_puntaje>q.puntaje OR p_metodo NOT IN ('manual','ia') OR p_metodo IS NULL OR q.tipo='multiple' THEN
    RAISE EXCEPTION 'Calificación inválida para esta respuesta.';
  END IF;
  UPDATE public.respuestas SET puntaje_obtenido=p_puntaje,es_correcta=p_puntaje>0,calificado_por=p_metodo WHERE id=r.id;
  UPDATE public.participantes SET puntaje_total=(SELECT coalesce(sum(puntaje_obtenido),0) FROM public.respuestas WHERE intento_id=i.id)
    WHERE id=i.participante_id;
  RETURN jsonb_build_object('id',r.id,'puntaje',p_puntaje);
END; $$;

CREATE FUNCTION app_private.admin_examen_recuperacion(p_intento uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE i public.intentos; codigo text:=upper(replace(gen_random_uuid()::text,'-','')); caduca timestamptz;
BEGIN
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM public.intentos WHERE id=p_intento;
  PERFORM 1 FROM public.etapas WHERE id=i.etapa_id AND estado='activa' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La etapa no está activa.'; END IF;
  PERFORM 1 FROM public.sesiones WHERE id=i.sesion_id FOR SHARE;
  SELECT * INTO i FROM public.intentos WHERE id=p_intento FOR UPDATE;
  IF i.estado='finalizado' OR (i.vence_at IS NOT NULL AND clock_timestamp()>=i.vence_at) THEN RAISE EXCEPTION 'El intento ya terminó.'; END IF;
  caduca:=least(clock_timestamp()+interval '5 minutes',coalesce(i.vence_at,'infinity'::timestamptz));
  INSERT INTO app_private.codigos_reanudacion(intento_id,codigo_hash,vence_at)
    VALUES(i.id,encode(sha256(convert_to(codigo,'UTF8')),'hex'),caduca)
    ON CONFLICT(intento_id) DO UPDATE SET codigo_hash=EXCLUDED.codigo_hash,vence_at=EXCLUDED.vence_at,usado_at=NULL;
  RETURN jsonb_build_object('codigo',codigo,'vence_at',caduca);
END; $$;

CREATE FUNCTION app_private.examen_recuperar(p_sesion uuid,p_codigo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE c app_private.codigos_reanudacion; i public.intentos;
BEGIN
  PERFORM app_private.examen_uid();
  SELECT * INTO c FROM app_private.codigos_reanudacion WHERE codigo_hash=encode(sha256(convert_to(upper(replace(btrim(p_codigo),' ','')),'UTF8')),'hex');
  SELECT * INTO i FROM public.intentos WHERE id=c.intento_id AND sesion_id=p_sesion;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Código inválido o vencido.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.etapas WHERE id=i.etapa_id AND estado='activa' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Código inválido o vencido.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.sesiones WHERE id=i.sesion_id FOR SHARE;
  SELECT * INTO i FROM public.intentos WHERE id=i.id FOR UPDATE;
  SELECT * INTO c FROM app_private.codigos_reanudacion WHERE id=c.id FOR UPDATE;
  IF c.usado_at IS NOT NULL OR c.vence_at<=clock_timestamp() OR i.estado='finalizado' THEN RAISE EXCEPTION 'Código inválido o vencido.' USING ERRCODE='42501'; END IF;
  UPDATE public.intentos SET usuario_id=auth.uid() WHERE id=i.id;
  UPDATE app_private.codigos_reanudacion SET usado_at=clock_timestamp() WHERE id=c.id;
  PERFORM app_private.examen_bloquear(i.id);
  RETURN app_private.examen_payload(i.id);
END; $$;

CREATE FUNCTION app_private.examen_configurar_sesion() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE e public.etapas;
BEGIN
  SELECT * INTO e FROM public.etapas WHERE id=NEW.etapa_id;
  IF e.historica THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.estado<>'esperando' THEN RAISE EXCEPTION 'Crea la sesión en espera.'; END IF;
    NEW.cantidad_preguntas:=e.cantidad_preguntas; NEW.tiempo_limite:=e.tiempo_limite;
    NEW.iniciado_at:=NULL; NEW.finalizado_at:=NULL;
  ELSE
    IF OLD.estado='finalizado' THEN RAISE EXCEPTION 'Una sesión finalizada no se puede reabrir.'; END IF;
    IF (NEW.cantidad_preguntas,NEW.tiempo_limite,NEW.sociedad_id) IS DISTINCT FROM (OLD.cantidad_preguntas,OLD.tiempo_limite,OLD.sociedad_id) THEN RAISE EXCEPTION 'La configuración de la sesión es fija.'; END IF;
    IF OLD.estado='activo' AND NEW.estado NOT IN ('activo','finalizado') THEN RAISE EXCEPTION 'No se puede reiniciar el examen.'; END IF;
    IF OLD.estado='esperando' AND NEW.estado='activo' THEN
      NEW.iniciado_at:=clock_timestamp();
    ELSIF NEW.iniciado_at IS DISTINCT FROM OLD.iniciado_at THEN RAISE EXCEPTION 'No se puede cambiar el inicio del examen.';
    END IF;
    IF NEW.estado='finalizado' THEN NEW.finalizado_at:=clock_timestamp(); END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER configurar_sesion_v2 BEFORE INSERT OR UPDATE ON public.sesiones FOR EACH ROW EXECUTE FUNCTION app_private.examen_configurar_sesion();

CREATE FUNCTION app_private.examen_sincronizar_sesion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE i record;
BEGIN
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
  IF NEW.estado=OLD.estado OR (SELECT historica FROM public.etapas WHERE id=NEW.etapa_id) THEN RETURN NEW; END IF;
  FOR i IN SELECT id FROM public.intentos WHERE sesion_id=NEW.id AND estado<>'finalizado' ORDER BY id LOOP
    IF NEW.estado='activo' THEN PERFORM app_private.examen_iniciar(i.id);
    ELSIF NEW.estado='finalizado' THEN PERFORM app_private.examen_cerrar(i.id,'cierre_sesion'); END IF;
  END LOOP;
  RETURN NEW;
END; $$;
CREATE TRIGGER sincronizar_sesion_v2 AFTER UPDATE OF estado ON public.sesiones FOR EACH ROW EXECUTE FUNCTION app_private.examen_sincronizar_sesion();

-- Los archivos V2 incorporan también intentos y snapshots; Hebreos no se modifica.
CREATE OR REPLACE FUNCTION app_private.archivar_cierre() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo un administrador puede cerrar una etapa.'; END IF;
  INSERT INTO public.archivos_etapa(etapa_id,contenido)
  SELECT NEW.id,jsonb_build_object('etapa',to_jsonb(NEW),'origen','cierre_v2','datos',jsonb_build_object(
    'sociedades',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.sociedades t WHERE EXISTS(SELECT 1 FROM public.sesiones s WHERE s.sociedad_id=t.id AND s.etapa_id=NEW.id)),
    'sesiones',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.sesiones t WHERE t.etapa_id=NEW.id),
    'participantes',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.participantes t JOIN public.sesiones s ON s.id=t.sesion_id WHERE s.etapa_id=NEW.id),
    'preguntas',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.preguntas t WHERE t.etapa_id=NEW.id),
    'respuestas',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.respuestas t JOIN public.intentos i ON i.id=t.intento_id WHERE i.etapa_id=NEW.id),
    'eventos_sesion',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.eventos_sesion t JOIN public.sesiones s ON s.id=t.sesion_id WHERE s.etapa_id=NEW.id),
    'intentos',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.intentos t WHERE t.etapa_id=NEW.id),
    'intento_preguntas',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.intento_preguntas t JOIN public.intentos i ON i.id=t.intento_id WHERE i.etapa_id=NEW.id)
  ));
  RETURN NEW;
END; $$;

-- Wrappers sin privilegios adicionales. app_private no está expuesto por REST.
CREATE FUNCTION public.examen_sala(p_sesion uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.examen_sala($1) $$;
CREATE FUNCTION public.examen_registrar(p_sesion uuid,p_participante uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.examen_registrar($1,$2) $$;
CREATE FUNCTION public.examen_estado(p_intento uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.examen_estado($1) $$;
CREATE FUNCTION public.examen_borrador(p_intento uuid,p_pregunta uuid,p_texto text,p_revision integer) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.examen_borrador($1,$2,$3,$4) $$;
CREATE FUNCTION public.examen_responder(p_intento uuid,p_pregunta uuid,p_texto text,p_solicitud uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.examen_responder($1,$2,$3,$4) $$;
CREATE FUNCTION public.examen_finalizar(p_intento uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.examen_finalizar($1) $$;
CREATE FUNCTION public.examen_eventos(p_intento uuid,p_eventos jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.examen_eventos($1,$2) $$;
CREATE FUNCTION public.examen_recuperar(p_sesion uuid,p_codigo text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.examen_recuperar($1,$2) $$;
CREATE FUNCTION public.admin_examen_contexto(p_respuesta uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_examen_contexto($1) $$;
CREATE FUNCTION public.admin_examen_calificar(p_respuesta uuid,p_puntaje integer,p_metodo text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_examen_calificar($1,$2,$3) $$;
CREATE FUNCTION public.admin_examen_recuperacion(p_intento uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_examen_recuperacion($1) $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS firma,n.nspname,p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','app_private') AND (p.proname LIKE 'examen_%' OR p.proname LIKE 'admin_examen_%')
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.firma); END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.examen_sala(uuid),app_private.examen_sala(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.examen_registrar(uuid,uuid),app_private.examen_registrar(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.examen_estado(uuid),app_private.examen_estado(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.examen_borrador(uuid,uuid,text,integer),app_private.examen_borrador(uuid,uuid,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.examen_responder(uuid,uuid,text,uuid),app_private.examen_responder(uuid,uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.examen_finalizar(uuid),app_private.examen_finalizar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.examen_eventos(uuid,jsonb),app_private.examen_eventos(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.examen_recuperar(uuid,text),app_private.examen_recuperar(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_examen_contexto(uuid),app_private.admin_examen_contexto(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_examen_calificar(uuid,integer,text),app_private.admin_examen_calificar(uuid,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_examen_recuperacion(uuid),app_private.admin_examen_recuperacion(uuid) TO authenticated;

COMMENT ON TABLE public.intentos IS 'Intentos V2 vinculados a Auth; sin acceso directo de participantes.';

CREATE FUNCTION app_private.admin_examen_crear_sesion(p_etapa uuid,p_sociedad uuid,p_participantes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE sesion uuid; p jsonb;
BEGIN
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.etapas WHERE id=p_etapa AND estado<>'cerrada' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La etapa no admite nuevas sesiones.'; END IF;
  IF jsonb_typeof(p_participantes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_participantes) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Agrega de 1 a 500 participantes.'; END IF;
  INSERT INTO public.sesiones(etapa_id,sociedad_id,estado) VALUES(p_etapa,p_sociedad,'esperando') RETURNING id INTO sesion;
  FOR p IN SELECT value FROM jsonb_array_elements(p_participantes) LOOP
    IF jsonb_typeof(p->'nombre') IS DISTINCT FROM 'string' OR length(btrim(p->>'nombre')) NOT BETWEEN 1 AND 150
      OR jsonb_typeof(p->'del_censo') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Revisa los datos del participante.'; END IF;
    INSERT INTO public.participantes(sesion_id,nombre,del_censo,registrado_at)
      VALUES(sesion,btrim(p->>'nombre'),(p->>'del_censo')::boolean,NULL);
  END LOOP;
  RETURN jsonb_build_object('sesion_id',sesion);
END; $$;
CREATE FUNCTION app_private.admin_examen_cerrar_vencida(p_sesion uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE s public.sesiones;
BEGIN
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM public.sesiones WHERE id=p_sesion;
  PERFORM 1 FROM public.etapas WHERE id=s.etapa_id FOR SHARE;
  SELECT * INTO s FROM public.sesiones WHERE id=p_sesion FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión no disponible.'; END IF;
  IF s.estado='finalizado' THEN RETURN jsonb_build_object('cerrada',true); END IF;
  IF s.estado='activo' AND clock_timestamp()>=s.iniciado_at+make_interval(mins=>s.tiempo_limite) THEN
    UPDATE public.sesiones SET estado='finalizado' WHERE id=s.id;
    RETURN jsonb_build_object('cerrada',true);
  END IF;
  RETURN jsonb_build_object('cerrada',false);
END; $$;
CREATE FUNCTION public.admin_examen_crear_sesion(p_etapa uuid,p_sociedad uuid,p_participantes jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_examen_crear_sesion($1,$2,$3) $$;
CREATE FUNCTION public.admin_examen_cerrar_vencida(p_sesion uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_examen_cerrar_vencida($1) $$;
REVOKE ALL ON FUNCTION app_private.admin_examen_crear_sesion(uuid,uuid,jsonb),app_private.admin_examen_cerrar_vencida(uuid),public.admin_examen_crear_sesion(uuid,uuid,jsonb),public.admin_examen_cerrar_vencida(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.admin_examen_crear_sesion(uuid,uuid,jsonb),app_private.admin_examen_cerrar_vencida(uuid),public.admin_examen_crear_sesion(uuid,uuid,jsonb),public.admin_examen_cerrar_vencida(uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
