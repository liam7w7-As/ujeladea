-- Flujo por sesión para V3: registro directo y banco privado fijado al iniciar.
-- No recalifica ni modifica filas históricas. V2 conserva sus comprobaciones anteriores.
BEGIN;
-- Evita que una sesión arranque con las funciones antiguas durante la actualización.
LOCK TABLE public.sesiones IN SHARE ROW EXCLUSIVE MODE;
CREATE FUNCTION app_private.etapa_admite_examen(p_etapa uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce((SELECT NOT historica AND estado<>'cerrada' AND (estado='activa' OR coalesce((reglas->>'version')::int,2)>=3) FROM public.etapas WHERE id=p_etapa),false)
$$;
REVOKE ALL ON FUNCTION app_private.etapa_admite_examen(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.etapa_admite_examen(uuid) TO authenticated;

CREATE TABLE app_private.banco_sesion (
 sesion_id uuid NOT NULL REFERENCES public.sesiones(id) ON DELETE RESTRICT,
 pregunta_id uuid NOT NULL REFERENCES public.preguntas(id) ON DELETE RESTRICT,
 tipo text NOT NULL CHECK(tipo IN('multiple','abierta','contexto')),
 texto text NOT NULL, opciones jsonb, respuesta_correcta text NOT NULL,
 puntaje integer NOT NULL CHECK(puntaje>0), rubrica jsonb NOT NULL,
 PRIMARY KEY(sesion_id,pregunta_id)
);
CREATE INDEX banco_sesion_pregunta_idx ON app_private.banco_sesion(pregunta_id);
ALTER TABLE app_private.banco_sesion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_private.banco_sesion FROM PUBLIC,anon,authenticated;
CREATE TRIGGER banco_sesion_inmutable BEFORE UPDATE OR DELETE ON app_private.banco_sesion
 FOR EACH ROW EXECUTE FUNCTION app_private.archivo_inmutable();

CREATE FUNCTION app_private.preparar_banco_sesion(p_sesion uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.sesiones; e public.etapas; t text; n integer;
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.sesiones WHERE id=p_sesion AND eliminada_at IS NULL;
 SELECT * INTO e FROM public.etapas WHERE id=s.etapa_id;
 IF s.id IS NULL OR s.estado<>'esperando' OR NOT app_private.etapa_admite_examen(e.id) THEN RAISE EXCEPTION 'Esta sesión no admite iniciar el examen.'; END IF;
 IF EXISTS(SELECT 1 FROM app_private.banco_sesion WHERE sesion_id=s.id) THEN RAISE EXCEPTION 'El banco de esta sesión ya fue preparado.'; END IF;
 -- Una sola lectura obtiene una versión coherente del banco. Los que llegan tarde usan esta misma copia.
 INSERT INTO app_private.banco_sesion(sesion_id,pregunta_id,tipo,texto,opciones,respuesta_correcta,puntaje,rubrica)
 SELECT s.id,q.id,q.tipo,q.texto,q.opciones,q.respuesta_correcta,q.puntaje,q.rubrica
 FROM public.preguntas q WHERE q.etapa_id=e.id AND q.activa AND q.puntaje=(e.reglas->'puntos'->>q.tipo)::int;
 FOREACH t IN ARRAY ARRAY['multiple','abierta','contexto'] LOOP
  n:=(coalesce(s.distribucion,app_private.distribucion_examen(s.cantidad_preguntas))->>t)::int;
  IF n IS NULL OR (SELECT count(*) FROM app_private.banco_sesion WHERE sesion_id=s.id AND tipo=t)<n THEN
   RAISE EXCEPTION 'Faltan preguntas revisadas de tipo % para esta sesión: se requieren %.',t,n;
  END IF;
 END LOOP;
END; $$;
REVOKE ALL ON FUNCTION app_private.preparar_banco_sesion(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.preparar_banco_sesion(uuid) TO authenticated;

-- Compatibilidad con sesiones V3 que ya estuvieran corriendo al desplegar.
INSERT INTO app_private.banco_sesion(sesion_id,pregunta_id,tipo,texto,opciones,respuesta_correcta,puntaje,rubrica)
SELECT s.id,q.id,q.tipo,q.texto,q.opciones,q.respuesta_correcta,q.puntaje,q.rubrica
FROM public.sesiones s JOIN public.etapas e ON e.id=s.etapa_id JOIN public.preguntas q ON q.etapa_id=e.id
WHERE s.estado='activo' AND s.eliminada_at IS NULL AND NOT e.historica AND e.estado<>'cerrada'
 AND coalesce((e.reglas->>'version')::int,2)>=3 AND q.activa AND q.puntaje=(e.reglas->'puntos'->>q.tipo)::int;


CREATE OR REPLACE FUNCTION app_private.proteger_datos_etapa() RETURNS trigger
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
    IF TG_TABLE_NAME = 'sesiones' AND fila ->> 'estado' = 'activo' AND NOT app_private.etapa_admite_examen(etapa) THEN
      RAISE EXCEPTION 'Esta etapa no admite iniciar un examen.';
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

CREATE OR REPLACE FUNCTION app_private.examen_configurar_sesion() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE e public.etapas;
BEGIN
  SELECT * INTO e FROM public.etapas WHERE id=NEW.etapa_id;
  IF e.historica THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.eliminada_at IS NOT NULL THEN RAISE EXCEPTION 'Esta sesión fue eliminada.'; END IF;
    IF NEW.eliminada_at IS NOT NULL THEN
      IF (to_jsonb(NEW)-'eliminada_at') IS DISTINCT FROM (to_jsonb(OLD)-'eliminada_at') THEN RAISE EXCEPTION 'La eliminación no permite cambiar otros datos.'; END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.estado<>'esperando' THEN RAISE EXCEPTION 'Crea la sesión en espera.'; END IF;
    IF coalesce((e.reglas->>'version')::int,2)<3 THEN NEW.cantidad_preguntas:=e.cantidad_preguntas; NEW.tiempo_limite:=e.tiempo_limite; END IF; NEW.cantidad_preguntas:=coalesce(NEW.cantidad_preguntas,e.cantidad_preguntas); NEW.tiempo_limite:=coalesce(NEW.tiempo_limite,e.tiempo_limite);
    IF NEW.cantidad_preguntas NOT BETWEEN 1 AND 200 OR NEW.tiempo_limite NOT BETWEEN 1 AND 240 OR NEW.eliminada_at IS NOT NULL THEN RAISE EXCEPTION 'Elige entre 1 y 240 minutos y entre 1 y 200 preguntas.'; END IF;
    NEW.distribucion:=CASE WHEN coalesce((e.reglas->>'version')::int,2)>=3 THEN app_private.distribucion_examen(NEW.cantidad_preguntas) ELSE NULL END;

    NEW.iniciado_at:=NULL; NEW.finalizado_at:=NULL;
  ELSE
    IF OLD.estado='finalizado' THEN RAISE EXCEPTION 'Una sesión finalizada no se puede reabrir.'; END IF;
    IF (NEW.cantidad_preguntas,NEW.tiempo_limite,NEW.sociedad_id,NEW.distribucion) IS DISTINCT FROM (OLD.cantidad_preguntas,OLD.tiempo_limite,OLD.sociedad_id,OLD.distribucion) THEN RAISE EXCEPTION 'La configuración de la sesión es fija.'; END IF;
    IF OLD.estado='activo' AND NEW.estado NOT IN ('activo','finalizado') THEN RAISE EXCEPTION 'No se puede reiniciar el examen.'; END IF;
    IF OLD.estado='esperando' AND NEW.estado='activo' THEN
      IF coalesce((e.reglas->>'version')::int,2)>=3 THEN PERFORM app_private.preparar_banco_sesion(NEW.id); END IF;
      NEW.iniciado_at:=clock_timestamp();
    ELSIF NEW.iniciado_at IS DISTINCT FROM OLD.iniciado_at THEN RAISE EXCEPTION 'No se puede cambiar el inicio del examen.';
    END IF;
    IF NEW.estado='finalizado' THEN NEW.finalizado_at:=clock_timestamp(); END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION app_private.validar_etapa() RETURNS trigger
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
  IF OLD.estado = 'activa' AND coalesce((OLD.reglas->>'version')::int,2)<3 AND (NEW.libro, NEW.anio, NEW.numero, NEW.cantidad_preguntas, NEW.tiempo_limite, NEW.reglas)
    IS DISTINCT FROM (OLD.libro, OLD.anio, OLD.numero, OLD.cantidad_preguntas, OLD.tiempo_limite, OLD.reglas) THEN
    RAISE EXCEPTION 'La configuración del examen queda fija al activar la etapa.';
  END IF;
  IF coalesce((OLD.reglas->>'version')::int,2)>=3
    AND (NEW.libro,NEW.anio,NEW.numero,NEW.reglas-'distribucion') IS DISTINCT FROM (OLD.libro,OLD.anio,OLD.numero,OLD.reglas-'distribucion')
    AND EXISTS(SELECT 1 FROM public.sesiones WHERE etapa_id=OLD.id AND iniciado_at IS NOT NULL) THEN
    RAISE EXCEPTION 'La identidad y los criterios de la etapa quedan fijos tras iniciar una sesión.';
  END IF;
  IF OLD.estado = 'activa' AND NEW.estado = 'borrador' THEN
    RAISE EXCEPTION 'Una etapa activa no puede volver a borrador.';
  END IF;
  IF OLD.estado = 'borrador' AND NEW.estado = 'cerrada' AND coalesce((OLD.reglas->>'version')::int,2)<3 THEN
    RAISE EXCEPTION 'La etapa debe estar activa antes de cerrarla.';
  END IF;
  IF NEW.estado = 'activa' AND OLD.estado <> 'activa' THEN
    IF (SELECT count(*) FROM public.preguntas WHERE etapa_id = NEW.id AND activa) < NEW.cantidad_preguntas THEN
      RAISE EXCEPTION 'Faltan preguntas activas para iniciar esta etapa.';
    END IF;
  END IF;
  IF NEW.estado = 'cerrada' AND OLD.estado <> 'cerrada' THEN
    IF EXISTS (SELECT 1 FROM public.sesiones WHERE etapa_id = NEW.id AND eliminada_at IS NULL AND estado IS DISTINCT FROM 'finalizado') THEN
      RAISE EXCEPTION 'Finaliza todas las sesiones antes de cerrar la etapa.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.respuestas r JOIN public.participantes p ON p.id = r.participante_id
      JOIN public.sesiones s ON s.id = p.sesion_id WHERE s.etapa_id = NEW.id AND s.eliminada_at IS NULL
      AND (r.calificado_por = 'pendiente_ia' OR r.puntaje_obtenido IS NULL)) THEN
      RAISE EXCEPTION 'Hay respuestas pendientes de calificación.';
    END IF;
    NEW.cerrado_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.validar_banco_v3() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE e public.etapas; total integer;
BEGIN
 SELECT * INTO e FROM public.etapas WHERE id=coalesce(NEW.etapa_id,OLD.etapa_id) FOR SHARE;
 IF coalesce((e.reglas->>'version')::int,2)<3 THEN IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
 IF e.historica OR e.estado='cerrada' THEN RAISE EXCEPTION 'El banco de esta etapa está cerrado.'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.puntaje IS DISTINCT FROM (e.reglas->'puntos'->>NEW.tipo)::int THEN RAISE EXCEPTION 'El puntaje de este tipo lo fija la etapa.'; END IF;
 IF jsonb_typeof(NEW.rubrica)<>'array' OR jsonb_array_length(NEW.rubrica)>10 THEN RAISE EXCEPTION 'La rúbrica debe contener hasta 10 criterios.'; END IF;
 IF NEW.tipo<>'multiple' AND NEW.activa THEN
  IF jsonb_array_length(NEW.rubrica)=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.rubrica) x WHERE
    jsonb_typeof(x->'criterio') IS DISTINCT FROM 'string' OR length(btrim(x->>'criterio')) NOT BETWEEN 1 AND 500
    OR coalesce(x->>'puntos','') !~ '^[1-9][0-9]*$') THEN RAISE EXCEPTION 'Cada pregunta escrita activa necesita criterios y puntos.'; END IF;
  SELECT sum((x->>'puntos')::int) INTO total FROM jsonb_array_elements(NEW.rubrica) x;
  IF total<>NEW.puntaje THEN RAISE EXCEPTION 'La suma de la rúbrica debe coincidir con el valor de la pregunta.'; END IF;
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION app_private.examen_iniciar(p_intento uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i public.intentos; s public.sesiones; e public.etapas; elegidas uuid[]:='{}'; t text; n integer; parte uuid[];
BEGIN
 PERFORM app_private.examen_uid();
 SELECT * INTO i FROM public.intentos WHERE id=p_intento FOR UPDATE;
 IF i.estado<>'registrado' THEN RETURN; END IF;
 SELECT * INTO s FROM public.sesiones WHERE id=i.sesion_id;
 IF s.estado<>'activo' THEN RETURN; END IF;
 SELECT * INTO e FROM public.etapas WHERE id=i.etapa_id;
 IF coalesce((e.reglas->>'version')::int,2)>=3 THEN
  IF NOT EXISTS(SELECT 1 FROM app_private.control_intentos WHERE intento_id=i.id AND NOT requiere_aprobacion) THEN RETURN; END IF;
  FOREACH t IN ARRAY ARRAY['multiple','abierta','contexto'] LOOP
   n:=(coalesce(s.distribucion,app_private.distribucion_examen(s.cantidad_preguntas))->>t)::int;
   SELECT array_agg(q.id) INTO parte FROM (SELECT pregunta_id AS id FROM app_private.banco_sesion WHERE sesion_id=s.id AND tipo=t ORDER BY random() LIMIT n) q;
   IF coalesce(cardinality(parte),0)<>n THEN RAISE EXCEPTION 'Faltan preguntas del tipo %. Avisa al moderador.',t; END IF;
   elegidas:=elegidas||coalesce(parte,ARRAY[]::uuid[]);
  END LOOP;
 ELSE
  SELECT array_agg(q.id) INTO elegidas FROM(SELECT id FROM public.preguntas WHERE etapa_id=e.id AND activa ORDER BY random() LIMIT i.cantidad_preguntas) q;
  IF coalesce(cardinality(elegidas),0)<>i.cantidad_preguntas THEN RAISE EXCEPTION 'El banco no tiene suficientes preguntas. Avisa al encargado.'; END IF;
 END IF;
 IF coalesce((e.reglas->>'version')::int,2)>=3 THEN
  INSERT INTO public.intento_preguntas(intento_id,pregunta_id,posicion,tipo,texto,opciones,respuesta_correcta,puntaje,rubrica)
  SELECT i.id,q.pregunta_id,row_number() OVER(ORDER BY random())::int,q.tipo,q.texto,q.opciones,q.respuesta_correcta,q.puntaje,q.rubrica FROM app_private.banco_sesion q WHERE q.sesion_id=s.id AND q.pregunta_id=ANY(elegidas);
 ELSE
  INSERT INTO public.intento_preguntas(intento_id,pregunta_id,posicion,tipo,texto,opciones,respuesta_correcta,puntaje,rubrica)
 SELECT i.id,q.id,row_number() OVER(ORDER BY random())::int,q.tipo,q.texto,q.opciones,q.respuesta_correcta,q.puntaje,q.rubrica FROM public.preguntas q WHERE q.id=ANY(elegidas);
 END IF;
 UPDATE public.intentos SET estado='en_curso',iniciado_at=s.iniciado_at,vence_at=s.iniciado_at+make_interval(mins=>s.tiempo_limite) WHERE id=i.id;
END; $$;

CREATE OR REPLACE FUNCTION app_private.examen_sala(p_sesion uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE s public.sesiones; e public.etapas; propio uuid; abierta boolean;
BEGIN
  PERFORM app_private.examen_uid();
  SELECT * INTO s FROM public.sesiones WHERE id=p_sesion AND eliminada_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esta sesión no está disponible.' USING ERRCODE='42501'; END IF;
  SELECT * INTO e FROM public.etapas WHERE id=s.etapa_id AND NOT historica;
  IF s.id IS NULL OR e.id IS NULL THEN RAISE EXCEPTION 'La sesión no está disponible.'; END IF;
  SELECT id INTO propio FROM public.intentos WHERE sesion_id=s.id AND usuario_id=auth.uid();
  abierta:=app_private.etapa_admite_examen(e.id) AND (s.estado='esperando' OR (s.estado='activo' AND clock_timestamp()<s.iniciado_at+make_interval(mins=>s.tiempo_limite)));
  RETURN jsonb_build_object('servidor_at',clock_timestamp(),'sesion',jsonb_build_object('id',s.id,'estado',s.estado,
    'tiempo_limite',s.tiempo_limite,'iniciado_at',s.iniciado_at,'vence_at',s.iniciado_at+make_interval(mins=>s.tiempo_limite),'sociedad',(SELECT nombre FROM public.sociedades WHERE id=s.sociedad_id)),
    'etapa',jsonb_build_object('estado',e.estado,'libro',e.libro,'nombre',e.nombre,'anio',e.anio,'cantidad_preguntas',s.cantidad_preguntas,'distribucion',coalesce(s.distribucion,e.reglas->'distribucion')),
    'disponible',abierta,'motivo_no_disponible',CASE WHEN abierta THEN NULL
      WHEN e.estado='borrador' AND coalesce((e.reglas->>'version')::int,2)<3 THEN 'etapa_en_preparacion'
      WHEN e.estado='cerrada' THEN 'etapa_cerrada'
      WHEN s.estado='finalizado' THEN 'sesion_finalizada'
      WHEN s.estado='activo' THEN 'tiempo_finalizado'
      ELSE 'sesion_no_disponible' END,'intento_id',propio,
    'participantes',CASE WHEN abierta AND propio IS NULL THEN
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre) ORDER BY p.nombre),'[]'::jsonb)
        FROM public.participantes p WHERE p.sesion_id=s.id AND NOT p.examen_finalizado
        AND NOT EXISTS (SELECT 1 FROM public.intentos i WHERE i.participante_id=p.id))
      ELSE '[]'::jsonb END);
END; $$;

CREATE OR REPLACE FUNCTION app_private.examen_registrar(p_sesion uuid,p_participante uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE s public.sesiones; e public.etapas; p public.participantes; intento uuid;
BEGIN
  PERFORM app_private.examen_uid();
  SELECT * INTO s FROM public.sesiones WHERE id=p_sesion;
  SELECT * INTO e FROM public.etapas WHERE id=s.etapa_id FOR SHARE;
  SELECT * INTO s FROM public.sesiones WHERE id=p_sesion FOR SHARE;
  IF s.id IS NULL OR s.eliminada_at IS NOT NULL OR NOT app_private.etapa_admite_examen(e.id) OR s.estado NOT IN ('esperando','activo') THEN
    RAISE EXCEPTION 'La sesión no está disponible para registrarte.';
  END IF;
  IF s.estado='activo' AND clock_timestamp()>=s.iniciado_at+make_interval(mins=>s.tiempo_limite) THEN RAISE EXCEPTION 'El tiempo de la sesión terminó.'; END IF;
  IF coalesce((e.reglas->>'version')::int,2)>=3 THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(e.id::text||auth.uid()::text,0));
    IF EXISTS(SELECT 1 FROM public.intentos x JOIN public.sesiones z ON z.id=x.sesion_id WHERE z.eliminada_at IS NULL AND x.etapa_id=e.id AND x.usuario_id=auth.uid() AND x.participante_id<>p_participante) THEN RAISE EXCEPTION 'Ya tienes una evaluación en esta etapa. Solicita ayuda al moderador.'; END IF;
  END IF;
  SELECT * INTO p FROM public.participantes WHERE id=p_participante AND sesion_id=p_sesion FOR UPDATE;
  IF NOT FOUND OR p.examen_finalizado THEN RAISE EXCEPTION 'Este participante no está disponible.'; END IF;
  SELECT id INTO intento FROM public.intentos WHERE participante_id=p.id AND usuario_id=auth.uid();
  IF intento IS NOT NULL THEN RETURN app_private.examen_payload(intento); END IF;
  IF EXISTS (SELECT 1 FROM public.intentos WHERE participante_id=p.id) THEN RAISE EXCEPTION 'Ese nombre ya está registrado en otro dispositivo.' USING ERRCODE='23505'; END IF;
  IF EXISTS (SELECT 1 FROM public.intentos WHERE sesion_id=s.id AND usuario_id=auth.uid()) THEN RAISE EXCEPTION 'Este dispositivo ya tiene un participante en la sesión.' USING ERRCODE='23505'; END IF;
  INSERT INTO public.intentos(participante_id,usuario_id,sesion_id,etapa_id,cantidad_preguntas)
    VALUES(p.id,auth.uid(),s.id,e.id,s.cantidad_preguntas) RETURNING id INTO intento;
  UPDATE public.participantes SET registrado_at=clock_timestamp(),seed=intento::text WHERE id=p.id;
  IF coalesce((e.reglas->>'version')::int,2)>=3 THEN
    INSERT INTO app_private.control_intentos(intento_id,instancia,solicitante,ultimo_contacto,solicitado_at)
    VALUES(intento,app_private.instancia_examen(),app_private.instancia_examen(),clock_timestamp(),clock_timestamp());
  END IF;
  PERFORM app_private.examen_iniciar(intento);
  RETURN app_private.examen_payload(intento);
END; $$;

CREATE OR REPLACE FUNCTION app_private.examen_recuperar(p_sesion uuid,p_codigo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE c app_private.codigos_reanudacion; i public.intentos;
BEGIN
  PERFORM app_private.examen_uid();
  SELECT * INTO c FROM app_private.codigos_reanudacion WHERE codigo_hash=encode(sha256(convert_to(upper(replace(btrim(p_codigo),' ','')),'UTF8')),'hex');
  SELECT * INTO i FROM public.intentos WHERE id=c.intento_id AND sesion_id=p_sesion;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Código inválido o vencido.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.etapas WHERE id=i.etapa_id AND app_private.etapa_admite_examen(id) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Código inválido o vencido.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.sesiones WHERE id=i.sesion_id FOR SHARE;
  SELECT * INTO i FROM public.intentos WHERE id=i.id FOR UPDATE;
  SELECT * INTO c FROM app_private.codigos_reanudacion WHERE id=c.id FOR UPDATE;
  IF c.usado_at IS NOT NULL OR c.vence_at<=clock_timestamp() OR i.estado='finalizado' THEN RAISE EXCEPTION 'Código inválido o vencido.' USING ERRCODE='42501'; END IF;
  IF coalesce(app_private.supervision_v3(i.id),false) AND EXISTS(SELECT 1 FROM public.intentos x JOIN public.sesiones z ON z.id=x.sesion_id WHERE z.eliminada_at IS NULL AND x.etapa_id=i.etapa_id AND x.usuario_id=auth.uid() AND x.id<>i.id) THEN RAISE EXCEPTION 'Este dispositivo ya tiene otra evaluación en la etapa.' USING ERRCODE='42501'; END IF;
  UPDATE public.intentos SET usuario_id=auth.uid() WHERE id=i.id;
  UPDATE app_private.codigos_reanudacion SET usado_at=clock_timestamp() WHERE id=c.id;
  IF coalesce(app_private.supervision_v3(i.id),false) THEN
    INSERT INTO app_private.control_intentos(intento_id,instancia,solicitante,ultimo_contacto,requiere_aprobacion,motivo)
    VALUES(i.id,app_private.instancia_examen(),app_private.instancia_examen(),clock_timestamp(),false,'Traslado autorizado')
    ON CONFLICT(intento_id) DO UPDATE SET instancia=EXCLUDED.instancia,solicitante=EXCLUDED.solicitante,ultimo_contacto=EXCLUDED.ultimo_contacto,requiere_aprobacion=false,oculto_desde=NULL,motivo=EXCLUDED.motivo;
    INSERT INTO public.incidencias_examen(intento_id,sesion_id,actor_id,tipo,detalle) VALUES(i.id,i.sesion_id,auth.uid(),'traslado','Código de recuperación del moderador consumido; acceso anterior revocado.');
  END IF;
  PERFORM app_private.examen_bloquear(i.id);
  RETURN app_private.examen_payload(i.id);
END; $$;

CREATE OR REPLACE FUNCTION app_private.admin_examen_recuperacion(p_intento uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE i public.intentos; codigo text:=upper(replace(gen_random_uuid()::text,'-','')); caduca timestamptz;
BEGIN
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM public.intentos WHERE id=p_intento;
  PERFORM 1 FROM public.etapas WHERE id=i.etapa_id AND app_private.etapa_admite_examen(id) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La etapa no admite acceso.'; END IF;
  PERFORM 1 FROM public.sesiones WHERE id=i.sesion_id AND (estado='esperando' OR (estado='activo' AND clock_timestamp()<iniciado_at+make_interval(mins=>tiempo_limite))) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El tiempo de la sesión terminó.'; END IF;
  SELECT * INTO i FROM public.intentos WHERE id=p_intento FOR UPDATE;
  IF i.estado='finalizado' OR (i.vence_at IS NOT NULL AND clock_timestamp()>=i.vence_at) THEN RAISE EXCEPTION 'El intento ya terminó.'; END IF;
  caduca:=least(clock_timestamp()+interval '5 minutes',coalesce(i.vence_at,'infinity'::timestamptz));
  INSERT INTO app_private.codigos_reanudacion(intento_id,codigo_hash,vence_at)
    VALUES(i.id,encode(sha256(convert_to(codigo,'UTF8')),'hex'),caduca)
    ON CONFLICT(intento_id) DO UPDATE SET codigo_hash=EXCLUDED.codigo_hash,vence_at=EXCLUDED.vence_at,usado_at=NULL;
  IF coalesce(app_private.supervision_v3(i.id),false) THEN
    INSERT INTO public.incidencias_examen(intento_id,sesion_id,actor_id,tipo,detalle) VALUES(i.id,i.sesion_id,auth.uid(),'autorizacion','El moderador emitió un código personal de recuperación; vence en un máximo de cinco minutos.');
  END IF;
  RETURN jsonb_build_object('codigo',codigo,'vence_at',caduca);
END; $$;

CREATE OR REPLACE FUNCTION app_private.admin_examen_autorizar(p_intento uuid,p_justificacion text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.intentos; c app_private.control_intentos;
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
 IF length(btrim(p_justificacion)) NOT BETWEEN 5 AND 500 OR p_justificacion IS NULL THEN RAISE EXCEPTION 'Indica el motivo de la autorización.'; END IF;
 SELECT * INTO i FROM public.intentos WHERE id=p_intento;
 PERFORM 1 FROM public.etapas WHERE id=i.etapa_id AND app_private.etapa_admite_examen(id) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'La etapa no admite acceso.'; END IF;
 PERFORM 1 FROM public.sesiones WHERE id=i.sesion_id AND (estado='esperando' OR (estado='activo' AND clock_timestamp()<iniciado_at+make_interval(mins=>tiempo_limite))) FOR SHARE;
 IF NOT FOUND OR i.estado='finalizado' OR i.vence_at<=clock_timestamp() THEN RAISE EXCEPTION 'La evaluación ya finalizó.'; END IF;
 SELECT * INTO c FROM app_private.control_intentos WHERE intento_id=i.id FOR UPDATE;
 IF c.solicitante IS NULL THEN RAISE EXCEPTION 'El joven debe abrir el examen y solicitar acceso.'; END IF;
 UPDATE app_private.control_intentos SET instancia=solicitante,requiere_aprobacion=false,ultimo_contacto=clock_timestamp(),oculto_desde=NULL,justificacion=p_justificacion WHERE intento_id=i.id;
 PERFORM app_private.examen_iniciar(i.id);
 INSERT INTO public.incidencias_examen(intento_id,sesion_id,actor_id,tipo,detalle) VALUES(i.id,i.sesion_id,auth.uid(),'autorizacion',p_justificacion);
 RETURN jsonb_build_object('autorizado',true);
END; $$;

CREATE OR REPLACE FUNCTION app_private.admin_examen_agregar(p_sesion uuid,p_nombre text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.sesiones; pid uuid;
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
 IF p_nombre IS NULL OR length(btrim(p_nombre)) NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'Revisa el nombre del participante.'; END IF;
 SELECT * INTO s FROM public.sesiones WHERE id=p_sesion;
 PERFORM 1 FROM public.etapas WHERE id=s.etapa_id AND app_private.etapa_admite_examen(id) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'La etapa no admite acceso.'; END IF;
 SELECT * INTO s FROM public.sesiones WHERE id=p_sesion FOR UPDATE;
 IF s.estado NOT IN('esperando','activo') OR (s.estado='activo' AND clock_timestamp()>=s.iniciado_at+make_interval(mins=>s.tiempo_limite)) THEN RAISE EXCEPTION 'La sesión ya terminó.'; END IF;
 IF EXISTS(SELECT 1 FROM public.participantes WHERE sesion_id=s.id AND lower(btrim(nombre))=lower(btrim(p_nombre))) THEN RAISE EXCEPTION 'Ya existe ese nombre en esta sesión.'; END IF;
 INSERT INTO public.participantes(sesion_id,nombre,del_censo) VALUES(s.id,btrim(p_nombre),false) RETURNING id INTO pid;
 RETURN jsonb_build_object('participante_id',pid,'vence_at',s.iniciado_at+make_interval(mins=>s.tiempo_limite));
END; $$;

CREATE OR REPLACE FUNCTION app_private.admin_examen_justificar(p_intento uuid,p_justificacion text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.intentos;
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
 IF p_justificacion IS NULL OR length(btrim(p_justificacion)) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'Describe el incidente verificado.'; END IF;
 SELECT * INTO i FROM public.intentos WHERE id=p_intento;
 PERFORM 1 FROM public.etapas WHERE id=i.etapa_id AND app_private.etapa_admite_examen(id) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'La etapa no admite revisar incidentes.'; END IF;
 UPDATE app_private.control_intentos SET justificacion=p_justificacion WHERE intento_id=i.id;
 INSERT INTO public.incidencias_examen(intento_id,sesion_id,actor_id,tipo,detalle) VALUES(i.id,i.sesion_id,auth.uid(),'justificacion',p_justificacion);
 RETURN jsonb_build_object('justificado',true);
END; $$;

COMMIT;
