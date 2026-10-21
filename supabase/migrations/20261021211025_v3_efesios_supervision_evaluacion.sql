-- Efesios: distribución fija, supervisión y rúbricas. Aplicar de forma coordinada con la interfaz.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.etapas e WHERE e.codigo='2026-02-efesios' AND (e.estado<>'borrador' OR EXISTS(SELECT 1 FROM public.intentos i WHERE i.etapa_id=e.id))) THEN
 RAISE EXCEPTION 'Efesios ya tiene actividad o intentos. Revisa el despliegue antes de cambiar sus reglas.'; END IF;
END; $$;
UPDATE public.etapas SET cantidad_preguntas=45, reglas=reglas||'{"version":3,"distribucion":{"multiple":27,"abierta":10,"contexto":8},"puntos":{"multiple":2,"abierta":3,"contexto":4},"autorizacion_inicial":true}'::jsonb
WHERE codigo='2026-02-efesios' AND estado='borrador'
AND NOT EXISTS(SELECT 1 FROM public.intentos i WHERE i.etapa_id=etapas.id);

ALTER TABLE public.respuestas ADD COLUMN revision_calificacion integer NOT NULL DEFAULT 0;
CREATE INDEX preguntas_activas_tipo_idx ON public.preguntas(etapa_id,tipo) WHERE activa;
ALTER TABLE public.preguntas ADD COLUMN rubrica jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.intento_preguntas ADD COLUMN rubrica jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE app_private.control_intentos(
 intento_id uuid PRIMARY KEY REFERENCES public.intentos(id) ON DELETE RESTRICT,
 instancia uuid, solicitante uuid, ultimo_contacto timestamptz, oculto_desde timestamptz,
 requiere_aprobacion boolean NOT NULL DEFAULT true, solicitado_at timestamptz,
 motivo text NOT NULL DEFAULT 'Registro pendiente de autorización',
 justificacion text NOT NULL DEFAULT ''
);
ALTER TABLE app_private.control_intentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.control_intentos FROM PUBLIC,anon,authenticated;
CREATE TABLE public.incidencias_examen(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), intento_id uuid NOT NULL REFERENCES public.intentos(id),
 sesion_id uuid NOT NULL REFERENCES public.sesiones(id), actor_id uuid NOT NULL,
 tipo text NOT NULL CHECK(tipo IN('solicitud','autorizacion','salida','justificacion','traslado','calificacion')),
 detalle text NOT NULL CHECK(length(detalle) BETWEEN 1 AND 2000), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX incidencias_examen_sesion_idx ON public.incidencias_examen(sesion_id,created_at DESC);
CREATE INDEX incidencias_examen_intento_idx ON public.incidencias_examen(intento_id,created_at DESC);
ALTER TABLE public.incidencias_examen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.incidencias_examen FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.incidencias_examen TO authenticated;
CREATE POLICY admin_lectura ON public.incidencias_examen FOR SELECT TO authenticated USING((SELECT app_private.es_admin()));
CREATE TRIGGER incidencia_inmutable BEFORE UPDATE OR DELETE ON public.incidencias_examen FOR EACH ROW EXECUTE FUNCTION app_private.archivo_inmutable();

CREATE FUNCTION app_private.instancia_examen() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v text;
BEGIN
 v:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-examen-instancia';
 IF v IS NULL OR v !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Abre el examen desde una sola pantalla.' USING ERRCODE='42501'; END IF;
 RETURN v::uuid;
END; $$;
CREATE FUNCTION app_private.supervision_v3(p_intento uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce((e.reglas->>'version')::int>=3,false) FROM public.intentos i JOIN public.etapas e ON e.id=i.etapa_id WHERE i.id=$1
$$;
CREATE FUNCTION app_private.validar_acceso(p_intento uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c app_private.control_intentos;
BEGIN
 IF NOT coalesce(app_private.supervision_v3(p_intento),false) THEN RETURN; END IF;
 SELECT * INTO c FROM app_private.control_intentos WHERE intento_id=p_intento;
 IF c.instancia IS DISTINCT FROM app_private.instancia_examen() OR c.requiere_aprobacion OR c.ultimo_contacto IS NULL
 OR c.ultimo_contacto<clock_timestamp()-interval '60 seconds'
 OR c.oculto_desde<clock_timestamp()-interval '15 seconds'
 THEN RAISE EXCEPTION 'Solicita al moderador autorización para continuar. Tu progreso se conserva.' USING ERRCODE='P0003'; END IF;
END; $$;

CREATE FUNCTION app_private.validar_modelo() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t text; n integer; puntos integer; criterios jsonb;
BEGIN
 IF coalesce((NEW.reglas->>'version')::int,2)<3 THEN RETURN NEW; END IF;
 IF NEW.reglas->'distribucion' IS DISTINCT FROM '{"multiple":27,"abierta":10,"contexto":8}'::jsonb OR NEW.cantidad_preguntas<>45
 OR NEW.reglas->'puntos' IS DISTINCT FROM '{"multiple":2,"abierta":3,"contexto":4}'::jsonb
 THEN RAISE EXCEPTION 'Efesios requiere 27 múltiples, 10 abiertas y 8 de contexto; valores 2, 3 y 4.'; END IF;
 IF TG_OP='UPDATE' AND OLD.estado='borrador' AND NEW.estado='activa' THEN
  FOREACH t IN ARRAY ARRAY['multiple','abierta','contexto'] LOOP
   n:=(NEW.reglas->'distribucion'->>t)::int; puntos:=(NEW.reglas->'puntos'->>t)::int;
   IF (SELECT count(*) FROM public.preguntas q WHERE q.etapa_id=NEW.id AND q.activa AND q.tipo=t AND q.puntaje=puntos)<n THEN
    RAISE EXCEPTION 'Faltan preguntas revisadas de tipo %: se requieren % con valor %.',t,n,puntos;
   END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER validar_modelo_v3 BEFORE INSERT OR UPDATE ON public.etapas FOR EACH ROW EXECUTE FUNCTION app_private.validar_modelo();
CREATE FUNCTION app_private.validar_banco_v3() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE e public.etapas; total integer;
BEGIN
 SELECT * INTO e FROM public.etapas WHERE id=coalesce(NEW.etapa_id,OLD.etapa_id) FOR SHARE;
 IF coalesce((e.reglas->>'version')::int,2)<3 THEN IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
 IF e.estado<>'borrador' THEN RAISE EXCEPTION 'El banco y las rúbricas quedan fijos al activar la etapa.'; END IF;
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
CREATE TRIGGER validar_banco_v3 BEFORE INSERT OR UPDATE OR DELETE ON public.preguntas FOR EACH ROW EXECUTE FUNCTION app_private.validar_banco_v3();
CREATE FUNCTION app_private.proteger_rubrica() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN IF NEW.rubrica IS DISTINCT FROM OLD.rubrica THEN RAISE EXCEPTION 'La rúbrica asignada es inmutable.'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER proteger_rubrica BEFORE UPDATE ON public.intento_preguntas FOR EACH ROW EXECUTE FUNCTION app_private.proteger_rubrica();

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
   n:=(e.reglas->'distribucion'->>t)::int;
   SELECT array_agg(q.id) INTO parte FROM (SELECT id FROM public.preguntas WHERE etapa_id=e.id AND activa AND tipo=t AND puntaje=(e.reglas->'puntos'->>t)::int ORDER BY random() LIMIT n) q;
   IF coalesce(cardinality(parte),0)<>n THEN RAISE EXCEPTION 'Faltan preguntas del tipo %. Avisa al moderador.',t; END IF;
   elegidas:=elegidas||parte;
  END LOOP;
 ELSE
  SELECT array_agg(q.id) INTO elegidas FROM(SELECT id FROM public.preguntas WHERE etapa_id=e.id AND activa ORDER BY random() LIMIT i.cantidad_preguntas) q;
  IF coalesce(cardinality(elegidas),0)<>i.cantidad_preguntas THEN RAISE EXCEPTION 'El banco no tiene suficientes preguntas. Avisa al encargado.'; END IF;
 END IF;
 INSERT INTO public.intento_preguntas(intento_id,pregunta_id,posicion,tipo,texto,opciones,respuesta_correcta,puntaje,rubrica)
 SELECT i.id,q.id,row_number() OVER(ORDER BY random())::int,q.tipo,q.texto,q.opciones,q.respuesta_correcta,q.puntaje,q.rubrica FROM public.preguntas q WHERE q.id=ANY(elegidas);
 UPDATE public.intentos SET estado='en_curso',iniciado_at=s.iniciado_at,vence_at=s.iniciado_at+make_interval(mins=>s.tiempo_limite) WHERE id=i.id;
END; $$;

CREATE FUNCTION app_private.examen_contacto(p_intento uuid,p_accion text DEFAULT 'pulso',p_visible boolean DEFAULT true,p_motivo text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.intentos; c app_private.control_intentos; instancia uuid;
BEGIN
 i:=app_private.examen_bloquear(p_intento);
 IF NOT coalesce(app_private.supervision_v3(i.id),false) OR i.estado='finalizado' THEN RETURN app_private.examen_payload(i.id); END IF;
 instancia:=app_private.instancia_examen();
 INSERT INTO app_private.control_intentos(intento_id) VALUES(i.id) ON CONFLICT DO NOTHING;
 SELECT * INTO c FROM app_private.control_intentos WHERE intento_id=i.id FOR UPDATE;
 IF p_accion IS NULL OR p_accion NOT IN('pulso','salida','solicitar') OR length(p_motivo)>500 THEN RAISE EXCEPTION 'Acción de acceso inválida.'; END IF;
 IF p_accion='solicitar' THEN
  IF c.solicitado_at IS NULL OR c.solicitado_at<clock_timestamp()-interval '30 seconds' THEN
   INSERT INTO public.incidencias_examen(intento_id,sesion_id,actor_id,tipo,detalle) VALUES(i.id,i.sesion_id,auth.uid(),'solicitud',coalesce(nullif(btrim(p_motivo),''),'Solicita continuar la evaluación'));
  END IF;
  UPDATE app_private.control_intentos SET requiere_aprobacion=true,solicitante=app_private.instancia_examen(),solicitado_at=clock_timestamp(),motivo=coalesce(nullif(btrim(p_motivo),''),'Solicita autorización') WHERE intento_id=i.id;
 ELSIF p_accion='salida' AND c.instancia=instancia THEN
  UPDATE app_private.control_intentos SET requiere_aprobacion=true,motivo='Salida de la página; requiere autorización' WHERE intento_id=i.id;
  INSERT INTO public.incidencias_examen(intento_id,sesion_id,actor_id,tipo,detalle) VALUES(i.id,i.sesion_id,auth.uid(),'salida','El navegador notificó una salida. La causa requiere revisión.');
 ELSIF c.instancia IS NULL OR c.instancia=instancia THEN
  UPDATE app_private.control_intentos SET instancia=app_private.instancia_examen(),solicitante=coalesce(solicitante,app_private.instancia_examen()),
   requiere_aprobacion=requiere_aprobacion OR (ultimo_contacto IS NOT NULL AND ultimo_contacto<clock_timestamp()-interval '60 seconds') OR (oculto_desde IS NOT NULL AND oculto_desde<clock_timestamp()-interval '15 seconds'),
   motivo=CASE WHEN ultimo_contacto<clock_timestamp()-interval '60 seconds' THEN 'Sin comunicación durante más de un minuto' WHEN oculto_desde<clock_timestamp()-interval '15 seconds' THEN 'Regreso tras una interrupción; requiere revisión' ELSE motivo END,
   ultimo_contacto=clock_timestamp(),oculto_desde=CASE WHEN p_visible THEN NULL ELSE coalesce(oculto_desde,clock_timestamp()) END
  WHERE intento_id=i.id;
 END IF;
 RETURN app_private.examen_payload(i.id);
END; $$;

CREATE FUNCTION app_private.admin_examen_autorizar(p_intento uuid,p_justificacion text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.intentos; c app_private.control_intentos;
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
 IF length(btrim(p_justificacion)) NOT BETWEEN 5 AND 500 OR p_justificacion IS NULL THEN RAISE EXCEPTION 'Indica el motivo de la autorización.'; END IF;
 SELECT * INTO i FROM public.intentos WHERE id=p_intento;
 PERFORM 1 FROM public.etapas WHERE id=i.etapa_id AND estado='activa' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'La etapa no está activa.'; END IF;
 PERFORM 1 FROM public.sesiones WHERE id=i.sesion_id AND (estado='esperando' OR (estado='activo' AND clock_timestamp()<iniciado_at+make_interval(mins=>tiempo_limite))) FOR SHARE;
 IF NOT FOUND OR i.estado='finalizado' OR i.vence_at<=clock_timestamp() THEN RAISE EXCEPTION 'La evaluación ya finalizó.'; END IF;
 SELECT * INTO c FROM app_private.control_intentos WHERE intento_id=i.id FOR UPDATE;
 IF c.solicitante IS NULL THEN RAISE EXCEPTION 'El joven debe abrir el examen y solicitar acceso.'; END IF;
 UPDATE app_private.control_intentos SET instancia=solicitante,requiere_aprobacion=false,ultimo_contacto=clock_timestamp(),oculto_desde=NULL,justificacion=p_justificacion WHERE intento_id=i.id;
 PERFORM app_private.examen_iniciar(i.id);
 INSERT INTO public.incidencias_examen(intento_id,sesion_id,actor_id,tipo,detalle) VALUES(i.id,i.sesion_id,auth.uid(),'autorizacion',p_justificacion);
 RETURN jsonb_build_object('autorizado',true);
END; $$;

CREATE FUNCTION app_private.admin_examen_agregar(p_sesion uuid,p_nombre text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.sesiones; pid uuid;
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
 IF p_nombre IS NULL OR length(btrim(p_nombre)) NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'Revisa el nombre del participante.'; END IF;
 SELECT * INTO s FROM public.sesiones WHERE id=p_sesion;
 PERFORM 1 FROM public.etapas WHERE id=s.etapa_id AND estado='activa' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'La etapa no está activa.'; END IF;
 SELECT * INTO s FROM public.sesiones WHERE id=p_sesion FOR UPDATE;
 IF s.estado NOT IN('esperando','activo') OR (s.estado='activo' AND clock_timestamp()>=s.iniciado_at+make_interval(mins=>s.tiempo_limite)) THEN RAISE EXCEPTION 'La sesión ya terminó.'; END IF;
 IF EXISTS(SELECT 1 FROM public.participantes WHERE sesion_id=s.id AND lower(btrim(nombre))=lower(btrim(p_nombre))) THEN RAISE EXCEPTION 'Ya existe ese nombre en esta sesión.'; END IF;
 INSERT INTO public.participantes(sesion_id,nombre,del_censo) VALUES(s.id,btrim(p_nombre),false) RETURNING id INTO pid;
 RETURN jsonb_build_object('participante_id',pid,'vence_at',s.iniciado_at+make_interval(mins=>s.tiempo_limite));
END; $$;

CREATE OR REPLACE FUNCTION app_private.examen_payload(p_intento uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE i public.intentos; s public.sesiones; e public.etapas; p public.participantes; q public.intento_preguntas; c app_private.control_intentos; acceso jsonb; permitido boolean;
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
  IF coalesce(app_private.supervision_v3(i.id),false) AND i.estado<>'finalizado' THEN
    SELECT * INTO c FROM app_private.control_intentos WHERE intento_id=i.id;
    permitido:=coalesce(c.instancia=app_private.instancia_examen() AND NOT c.requiere_aprobacion AND c.ultimo_contacto>=clock_timestamp()-interval '60 seconds' AND (c.oculto_desde IS NULL OR c.oculto_desde>=clock_timestamp()-interval '15 seconds'),false);
    acceso:=jsonb_build_object('pendiente',NOT permitido,'motivo',coalesce(c.motivo,'Solicita autorización al moderador'),'otra_pantalla',coalesce(c.instancia<>app_private.instancia_examen(),false),'solicitado',coalesce(c.solicitante=app_private.instancia_examen(),false));
    IF NOT permitido THEN q:=NULL; END IF;
  END IF;
  RETURN jsonb_build_object('acceso',acceso,'version',2,'servidor_at',clock_timestamp(),
    'etapa',jsonb_build_object('id',e.id,'nombre',e.nombre,'libro',e.libro,'anio',e.anio),
    'sesion',jsonb_build_object('id',s.id,'estado',s.estado,'sociedad',(SELECT nombre FROM public.sociedades WHERE id=s.sociedad_id)),
    'participante',jsonb_build_object('id',p.id,'nombre',p.nombre),
    'intento',jsonb_build_object('id',i.id,'estado',i.estado,'total',i.cantidad_preguntas,
      'respondidas',(SELECT count(*) FROM public.respuestas WHERE intento_id=i.id),'vence_at',i.vence_at,'motivo_cierre',i.motivo_cierre),
    'pregunta',CASE WHEN q.id IS NULL THEN NULL ELSE jsonb_build_object('id',q.id,'posicion',q.posicion,'tipo',q.tipo,
      'texto',q.texto,'opciones',q.opciones,'puntaje',q.puntaje,'borrador',q.borrador,'revision',q.revision) END);
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
  IF s.id IS NULL OR e.historica OR e.estado<>'activa' OR s.estado NOT IN ('esperando','activo') THEN
    RAISE EXCEPTION 'La sesión no está disponible para registrarte.';
  END IF;
  IF s.estado='activo' AND clock_timestamp()>=s.iniciado_at+make_interval(mins=>s.tiempo_limite) THEN RAISE EXCEPTION 'El tiempo de la sesión terminó.'; END IF;
  IF coalesce((e.reglas->>'version')::int,2)>=3 THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(e.id::text||auth.uid()::text,0));
    IF EXISTS(SELECT 1 FROM public.intentos x WHERE x.etapa_id=e.id AND x.usuario_id=auth.uid() AND x.participante_id<>p_participante) THEN RAISE EXCEPTION 'Ya tienes una evaluación en esta etapa. Solicita ayuda al moderador.'; END IF;
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
CREATE OR REPLACE FUNCTION app_private.examen_borrador(p_intento uuid,p_pregunta uuid,p_texto text,p_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE i public.intentos; q public.intento_preguntas; actual uuid; recibido timestamptz;
BEGIN
  i:=app_private.examen_bloquear(p_intento);
  IF i.estado<>'finalizado' THEN PERFORM app_private.validar_acceso(i.id); END IF;
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
CREATE OR REPLACE FUNCTION app_private.examen_responder(p_intento uuid,p_pregunta uuid,p_texto text,p_solicitud uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE i public.intentos; q public.intento_preguntas; anterior public.respuestas; actual uuid;
BEGIN
  i:=app_private.examen_bloquear(p_intento);
  IF i.estado<>'finalizado' THEN PERFORM app_private.validar_acceso(i.id); END IF;
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
CREATE OR REPLACE FUNCTION app_private.examen_finalizar(p_intento uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE i public.intentos;
BEGIN
  i:=app_private.examen_bloquear(p_intento);
  IF i.estado<>'finalizado' THEN PERFORM app_private.validar_acceso(i.id); END IF;
  IF i.estado='registrado' THEN RAISE EXCEPTION 'El examen todavía no ha comenzado.'; END IF;
  IF i.estado<>'finalizado' THEN PERFORM app_private.examen_cerrar(i.id,'entrega'); END IF;
  RETURN app_private.examen_payload(i.id);
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
  PERFORM 1 FROM public.etapas WHERE id=i.etapa_id AND estado='activa' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Código inválido o vencido.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.sesiones WHERE id=i.sesion_id FOR SHARE;
  SELECT * INTO i FROM public.intentos WHERE id=i.id FOR UPDATE;
  SELECT * INTO c FROM app_private.codigos_reanudacion WHERE id=c.id FOR UPDATE;
  IF c.usado_at IS NOT NULL OR c.vence_at<=clock_timestamp() OR i.estado='finalizado' THEN RAISE EXCEPTION 'Código inválido o vencido.' USING ERRCODE='42501'; END IF;
  IF coalesce(app_private.supervision_v3(i.id),false) AND EXISTS(SELECT 1 FROM public.intentos x WHERE x.etapa_id=i.etapa_id AND x.usuario_id=auth.uid() AND x.id<>i.id) THEN RAISE EXCEPTION 'Este dispositivo ya tiene otra evaluación en la etapa.' USING ERRCODE='42501'; END IF;
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
CREATE OR REPLACE FUNCTION app_private.admin_examen_contexto(p_respuesta uuid) RETURNS jsonb
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
    'respuesta',r.respuesta_dada,'rubrica',q.rubrica,'pendiente',r.calificado_por='pendiente_ia');
END; $$;
CREATE OR REPLACE FUNCTION app_private.admin_examen_calificar(p_respuesta uuid,p_puntaje integer,p_metodo text) RETURNS jsonb
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
  IF coalesce(app_private.supervision_v3(i.id),false) AND current_setting('app.rubrica_validada',true) IS DISTINCT FROM r.id::text THEN RAISE EXCEPTION 'Califica mediante los criterios de la rúbrica.'; END IF;
  UPDATE public.respuestas SET puntaje_obtenido=p_puntaje,es_correcta=p_puntaje>0,calificado_por=p_metodo WHERE id=r.id;
  UPDATE public.participantes SET puntaje_total=(SELECT coalesce(sum(puntaje_obtenido),0) FROM public.respuestas WHERE intento_id=i.id)
    WHERE id=i.participante_id;
  RETURN jsonb_build_object('id',r.id,'puntaje',p_puntaje);
END; $$;

CREATE FUNCTION app_private.admin_examen_calificar_rubrica(p_respuesta uuid,p_puntos jsonb,p_comentario text DEFAULT '',p_revision integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.respuestas; q public.intento_preguntas; i public.intentos; x jsonb; n integer:=0; total integer:=0; maximo integer; resultado jsonb;
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.respuestas WHERE id=p_respuesta;
 SELECT * INTO q FROM public.intento_preguntas WHERE id=r.intento_pregunta_id;
 SELECT * INTO i FROM public.intentos WHERE id=r.intento_id;
 IF q.id IS NULL OR jsonb_typeof(p_puntos) IS DISTINCT FROM 'array' OR jsonb_array_length(q.rubrica)=0 OR jsonb_array_length(p_puntos)<>jsonb_array_length(q.rubrica) OR length(p_comentario)>1500 THEN RAISE EXCEPTION 'Revisa los criterios de la rúbrica.'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_puntos) LOOP
  maximo:=(q.rubrica->n->>'puntos')::int;
  IF x::text !~ '^[0-9]+$' OR (x::text)::int>maximo THEN RAISE EXCEPTION 'Puntaje fuera del criterio %.',n+1; END IF;
  total:=total+(x::text)::int;n:=n+1;
 END LOOP;
 PERFORM 1 FROM public.etapas WHERE id=i.etapa_id AND estado<>'cerrada' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'La etapa está cerrada.'; END IF;
 PERFORM 1 FROM public.participantes WHERE id=i.participante_id FOR UPDATE;
 SELECT * INTO r FROM public.respuestas WHERE id=p_respuesta FOR UPDATE;
 IF p_revision IS NULL OR r.revision_calificacion<>p_revision THEN RAISE EXCEPTION 'Otra revisión cambió esta nota. Recarga antes de calificar.' USING ERRCODE='40001'; END IF;
 PERFORM set_config('app.rubrica_validada',r.id::text,true);
 resultado:=app_private.admin_examen_calificar(r.id,total,'manual');
 UPDATE public.respuestas SET revision_calificacion=revision_calificacion+1 WHERE id=r.id;
 PERFORM set_config('app.rubrica_validada','',true);
 INSERT INTO public.incidencias_examen(intento_id,sesion_id,actor_id,tipo,detalle) VALUES(i.id,i.sesion_id,auth.uid(),'calificacion',jsonb_build_object('respuesta',r.id,'criterios',p_puntos,'total',total,'revision',r.revision_calificacion+1,'comentario',p_comentario)::text);
 RETURN resultado;
END; $$;

CREATE FUNCTION app_private.validar_nombre_etapa() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s public.sesiones;
BEGIN
 SELECT * INTO s FROM public.sesiones WHERE id=NEW.sesion_id;
 IF NOT EXISTS(SELECT 1 FROM public.etapas WHERE id=s.etapa_id AND (reglas->>'version')::int>=3) THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(s.etapa_id::text||s.sociedad_id::text,0));
 IF EXISTS(SELECT 1 FROM public.participantes p JOIN public.sesiones t ON t.id=p.sesion_id WHERE t.etapa_id=s.etapa_id AND t.sociedad_id=s.sociedad_id AND p.id<>NEW.id AND lower(regexp_replace(btrim(p.nombre),'\s+',' ','g'))=lower(regexp_replace(btrim(NEW.nombre),'\s+',' ','g'))) THEN RAISE EXCEPTION 'Este nombre ya está inscrito en la sociedad para esta etapa. En caso de homónimo, añade un identificador acordado con el moderador.'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER validar_nombre_etapa BEFORE INSERT OR UPDATE OF nombre ON public.participantes FOR EACH ROW EXECUTE FUNCTION app_private.validar_nombre_etapa();

CREATE OR REPLACE FUNCTION app_private.admin_examen_sala(p_sesion uuid,p_etapa uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE resultado jsonb;
BEGIN
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object(
    'servidor_at',clock_timestamp(),
    'sesion',to_jsonb(s)||jsonb_build_object('sociedades',jsonb_build_object('nombre',soc.nombre,'total_censo',soc.total_censo)),
    'participantes',(SELECT coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object(
      'respondidas',(SELECT count(*) FROM public.respuestas r WHERE r.intento_id=i.id),
      'total',i.cantidad_preguntas,'intento_id',i.id,'requiere_aprobacion',c.requiere_aprobacion,'ultimo_contacto',c.ultimo_contacto,'motivo_acceso',c.motivo,'justificacion_acceso',c.justificacion,'solicitante',c.solicitante IS NOT NULL,'sin_comunicacion',c.ultimo_contacto<clock_timestamp()-interval '60 seconds') ORDER BY p.nombre,p.id),'[]'::jsonb)
      FROM public.participantes p LEFT JOIN public.intentos i ON i.participante_id=p.id LEFT JOIN app_private.control_intentos c ON c.intento_id=i.id WHERE p.sesion_id=s.id),
    'alertas',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'participante_id',a.participante_id,'total_eventos',a.total,
      'detalle',(SELECT jsonb_agg(jsonb_build_object('tipo',d.tipo,'cantidad',d.cantidad,'ultimo_at',d.ultimo_at) ORDER BY d.tipo)
        FROM (SELECT tipo,sum(cantidad) cantidad,max(ultimo_at) ultimo_at FROM public.eventos_sesion
          WHERE sesion_id=s.id AND participante_id=a.participante_id GROUP BY tipo) d)
      ) ORDER BY a.participante_id),'[]'::jsonb)
      FROM (SELECT participante_id,count(*) total FROM public.eventos_sesion WHERE sesion_id=s.id GROUP BY participante_id) a)
  ) INTO resultado FROM public.sesiones s LEFT JOIN public.sociedades soc ON soc.id=s.sociedad_id
    WHERE s.id=p_sesion AND s.etapa_id=p_etapa;
  IF resultado IS NULL THEN RAISE EXCEPTION 'Esta sesión no pertenece a la etapa seleccionada.' USING ERRCODE='42501'; END IF;
  RETURN resultado;
END; $$;
CREATE OR REPLACE FUNCTION app_private.examen_sala(p_sesion uuid) RETURNS jsonb
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
  RETURN jsonb_build_object('servidor_at',clock_timestamp(),'sesion',jsonb_build_object('id',s.id,'estado',s.estado,
    'iniciado_at',s.iniciado_at,'vence_at',s.iniciado_at+make_interval(mins=>s.tiempo_limite),'sociedad',(SELECT nombre FROM public.sociedades WHERE id=s.sociedad_id)),
    'etapa',jsonb_build_object('libro',e.libro,'nombre',e.nombre,'anio',e.anio),
    'disponible',abierta,'intento_id',propio,
    'participantes',CASE WHEN abierta AND propio IS NULL THEN
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre) ORDER BY p.nombre),'[]'::jsonb)
        FROM public.participantes p WHERE p.sesion_id=s.id AND NOT p.examen_finalizado
        AND NOT EXISTS (SELECT 1 FROM public.intentos i WHERE i.participante_id=p.id))
      ELSE '[]'::jsonb END);
END; $$;
CREATE FUNCTION public.examen_contacto(p_intento uuid,p_accion text DEFAULT 'pulso',p_visible boolean DEFAULT true,p_motivo text DEFAULT '') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.examen_contacto($1,$2,$3,$4) $$;
REVOKE ALL ON FUNCTION public.examen_contacto(uuid,text,boolean,text),app_private.examen_contacto(uuid,text,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.examen_contacto(uuid,text,boolean,text),app_private.examen_contacto(uuid,text,boolean,text) TO authenticated;
CREATE FUNCTION public.admin_examen_autorizar(p_intento uuid,p_justificacion text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_examen_autorizar($1,$2) $$;
REVOKE ALL ON FUNCTION public.admin_examen_autorizar(uuid,text),app_private.admin_examen_autorizar(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_examen_autorizar(uuid,text),app_private.admin_examen_autorizar(uuid,text) TO authenticated;
CREATE FUNCTION public.admin_examen_agregar(p_sesion uuid,p_nombre text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_examen_agregar($1,$2) $$;
REVOKE ALL ON FUNCTION public.admin_examen_agregar(uuid,text),app_private.admin_examen_agregar(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_examen_agregar(uuid,text),app_private.admin_examen_agregar(uuid,text) TO authenticated;
CREATE FUNCTION public.admin_examen_calificar_rubrica(p_respuesta uuid,p_puntos jsonb,p_comentario text DEFAULT '',p_revision integer DEFAULT 0) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_examen_calificar_rubrica($1,$2,$3,$4) $$;
REVOKE ALL ON FUNCTION public.admin_examen_calificar_rubrica(uuid,jsonb,text,integer),app_private.admin_examen_calificar_rubrica(uuid,jsonb,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_examen_calificar_rubrica(uuid,jsonb,text,integer),app_private.admin_examen_calificar_rubrica(uuid,jsonb,text,integer) TO authenticated;
DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure firma FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app_private' AND p.proname IN('instancia_examen','supervision_v3','validar_acceso','validar_modelo','validar_banco_v3','proteger_rubrica','validar_nombre_etapa') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.firma); END LOOP; END; $$;
CREATE OR REPLACE FUNCTION app_private.admin_examen_crear_sesion(p_etapa uuid,p_sociedad uuid,p_participantes jsonb) RETURNS jsonb
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
      OR (p ? 'del_censo' AND jsonb_typeof(p->'del_censo') IS DISTINCT FROM 'boolean') THEN RAISE EXCEPTION 'Revisa los datos del participante.'; END IF;
    INSERT INTO public.participantes(sesion_id,nombre,del_censo,registrado_at)
      VALUES(sesion,btrim(p->>'nombre'),coalesce((p->>'del_censo')::boolean,false),NULL);
  END LOOP;
  RETURN jsonb_build_object('sesion_id',sesion);
END; $$;
CREATE OR REPLACE FUNCTION app_private.admin_examen_recuperacion(p_intento uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE i public.intentos; codigo text:=upper(replace(gen_random_uuid()::text,'-','')); caduca timestamptz;
BEGIN
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM public.intentos WHERE id=p_intento;
  PERFORM 1 FROM public.etapas WHERE id=i.etapa_id AND estado='activa' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La etapa no está activa.'; END IF;
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
    'incidencias_examen',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at,x.id),'[]'::jsonb) FROM public.incidencias_examen x JOIN public.intentos z ON z.id=x.intento_id WHERE z.etapa_id=NEW.id),'intentos',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.intentos t WHERE t.etapa_id=NEW.id),
    'intento_preguntas',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.intento_preguntas t JOIN public.intentos i ON i.id=t.intento_id WHERE i.etapa_id=NEW.id)
  ));
  RETURN NEW;
END; $$;

CREATE FUNCTION app_private.admin_examen_justificar(p_intento uuid,p_justificacion text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.intentos;
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
 IF p_justificacion IS NULL OR length(btrim(p_justificacion)) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'Describe el incidente verificado.'; END IF;
 SELECT * INTO i FROM public.intentos WHERE id=p_intento;
 PERFORM 1 FROM public.etapas WHERE id=i.etapa_id AND estado='activa' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'La etapa no admite revisar incidentes.'; END IF;
 UPDATE app_private.control_intentos SET justificacion=p_justificacion WHERE intento_id=i.id;
 INSERT INTO public.incidencias_examen(intento_id,sesion_id,actor_id,tipo,detalle) VALUES(i.id,i.sesion_id,auth.uid(),'justificacion',p_justificacion);
 RETURN jsonb_build_object('justificado',true);
END; $$;
REVOKE ALL ON FUNCTION app_private.admin_examen_justificar(uuid,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.admin_examen_justificar(p_intento uuid,p_justificacion text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_examen_justificar($1,$2) $$;
REVOKE ALL ON FUNCTION public.admin_examen_justificar(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_examen_justificar(uuid,text),app_private.admin_examen_justificar(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.examen_bloquear(p_intento uuid) RETURNS public.intentos
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
  ELSIF i.estado='registrado' AND s.estado='activo' AND clock_timestamp()>=s.iniciado_at+make_interval(mins=>s.tiempo_limite) THEN PERFORM app_private.examen_cerrar(i.id,'tiempo');
  ELSIF i.estado='registrado' AND s.estado='activo' THEN PERFORM app_private.examen_iniciar(i.id);
  END IF;
  SELECT * INTO i FROM public.intentos WHERE id=p_intento;
  IF i.estado='en_curso' AND clock_timestamp()>=i.vence_at THEN
    PERFORM app_private.examen_cerrar(i.id,'tiempo');
    SELECT * INTO i FROM public.intentos WHERE id=p_intento;
  END IF;
  RETURN i;
END; $$;

-- El archivo de Hebreos se conserva para el propietario de la base, pero no se abre desde la aplicación.
DROP POLICY admin_lectura ON public.archivos_etapa;
CREATE POLICY admin_lectura ON public.archivos_etapa FOR SELECT TO authenticated
 USING((SELECT app_private.es_admin()) AND EXISTS(SELECT 1 FROM public.etapas e WHERE e.id=etapa_id AND NOT e.historica));
DROP POLICY admin_gestion ON public.sesiones;
CREATE POLICY admin_gestion ON public.sesiones FOR ALL TO authenticated
 USING((SELECT app_private.es_admin()) AND EXISTS(SELECT 1 FROM public.etapas e WHERE e.id=etapa_id AND NOT e.historica))
 WITH CHECK((SELECT app_private.es_admin()) AND EXISTS(SELECT 1 FROM public.etapas e WHERE e.id=etapa_id AND NOT e.historica));
DROP POLICY admin_gestion ON public.preguntas;
CREATE POLICY admin_gestion ON public.preguntas FOR ALL TO authenticated
 USING((SELECT app_private.es_admin()) AND EXISTS(SELECT 1 FROM public.etapas e WHERE e.id=etapa_id AND NOT e.historica))
 WITH CHECK((SELECT app_private.es_admin()) AND EXISTS(SELECT 1 FROM public.etapas e WHERE e.id=etapa_id AND NOT e.historica));
DROP POLICY admin_gestion ON public.participantes;
CREATE POLICY admin_gestion ON public.participantes FOR ALL TO authenticated
 USING((SELECT app_private.es_admin()) AND EXISTS(SELECT 1 FROM public.sesiones s WHERE s.id=sesion_id))
 WITH CHECK((SELECT app_private.es_admin()) AND EXISTS(SELECT 1 FROM public.sesiones s WHERE s.id=sesion_id));
DROP POLICY admin_gestion ON public.respuestas;
CREATE POLICY admin_gestion ON public.respuestas FOR ALL TO authenticated
 USING((SELECT app_private.es_admin()) AND EXISTS(SELECT 1 FROM public.participantes p WHERE p.id=participante_id))
 WITH CHECK((SELECT app_private.es_admin()) AND EXISTS(SELECT 1 FROM public.participantes p WHERE p.id=participante_id));
DROP POLICY admin_gestion ON public.eventos_sesion;
CREATE POLICY admin_gestion ON public.eventos_sesion FOR ALL TO authenticated
 USING((SELECT app_private.es_admin()) AND EXISTS(SELECT 1 FROM public.sesiones s WHERE s.id=sesion_id))
 WITH CHECK((SELECT app_private.es_admin()) AND EXISTS(SELECT 1 FROM public.sesiones s WHERE s.id=sesion_id));

NOTIFY pgrst,'reload schema';
COMMIT;
