-- Cada sesión conserva su propia duración, cantidad y distribución.
-- Eliminar la sesión la retira de la evaluación; se conserva la trazabilidad sin recalificar datos.
BEGIN;
ALTER TABLE public.sesiones ADD COLUMN distribucion jsonb;
ALTER TABLE public.sesiones ADD COLUMN eliminada_at timestamptz;
ALTER TABLE public.sesiones ALTER COLUMN tiempo_limite DROP DEFAULT;
ALTER TABLE public.sesiones ALTER COLUMN cantidad_preguntas DROP DEFAULT;

CREATE FUNCTION app_private.distribucion_examen(p_total integer) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE pesos integer[]:=ARRAY[27,10,8]; cantidades integer[]:=ARRAY[0,0,0]; k integer; elegido integer; suma integer:=0;
BEGIN
 IF p_total IS NULL OR p_total NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Elige entre 1 y 200 preguntas.'; END IF;
 FOR k IN 1..3 LOOP cantidades[k]:=greatest(CASE WHEN p_total>=3 THEN 1 ELSE 0 END,floor(p_total*pesos[k]/45.0)::int);suma:=suma+cantidades[k];END LOOP;
 WHILE suma<p_total LOOP
  SELECT i INTO elegido FROM generate_series(1,3) i ORDER BY p_total*pesos[i]/45.0-cantidades[i] DESC,i LIMIT 1;
  cantidades[elegido]:=cantidades[elegido]+1;suma:=suma+1;
 END LOOP;
 RETURN jsonb_build_object('multiple',cantidades[1],'abierta',cantidades[2],'contexto',cantidades[3]);
END; $$;
REVOKE ALL ON FUNCTION app_private.distribucion_examen(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.distribucion_examen(integer) TO authenticated;


CREATE OR REPLACE FUNCTION app_private.validar_modelo() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t text; n integer; puntos integer; criterios jsonb;
BEGIN
 IF coalesce((NEW.reglas->>'version')::int,2)<3 THEN RETURN NEW; END IF;
 IF NEW.reglas->'distribucion' IS DISTINCT FROM app_private.distribucion_examen(NEW.cantidad_preguntas)
 OR NEW.reglas->'puntos' IS DISTINCT FROM '{"multiple":2,"abierta":3,"contexto":4}'::jsonb
 THEN RAISE EXCEPTION 'La distribución debe coincidir con la cantidad de preguntas; los valores siguen siendo 2, 3 y 4.'; END IF;
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
      NEW.iniciado_at:=clock_timestamp();
    ELSIF NEW.iniciado_at IS DISTINCT FROM OLD.iniciado_at THEN RAISE EXCEPTION 'No se puede cambiar el inicio del examen.';
    END IF;
    IF NEW.estado='finalizado' THEN NEW.finalizado_at:=clock_timestamp(); END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION app_private.admin_examen_crear_sesion(p_etapa uuid,p_sociedad uuid,p_participantes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE sesion uuid; p jsonb; e public.etapas;
BEGIN
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
  SELECT * INTO e FROM public.etapas WHERE id=p_etapa AND estado<>'cerrada' AND NOT historica FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La etapa no admite nuevas sesiones.'; END IF;
  IF jsonb_typeof(p_participantes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_participantes) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Agrega de 1 a 500 participantes.'; END IF;
  INSERT INTO public.sesiones(etapa_id,sociedad_id,estado,tiempo_limite,cantidad_preguntas) VALUES(p_etapa,p_sociedad,'esperando',e.tiempo_limite,e.cantidad_preguntas) RETURNING id INTO sesion;
  FOR p IN SELECT value FROM jsonb_array_elements(p_participantes) LOOP
    IF jsonb_typeof(p->'nombre') IS DISTINCT FROM 'string' OR length(btrim(p->>'nombre')) NOT BETWEEN 1 AND 150
      OR (p ? 'del_censo' AND jsonb_typeof(p->'del_censo') IS DISTINCT FROM 'boolean') THEN RAISE EXCEPTION 'Revisa los datos del participante.'; END IF;
    INSERT INTO public.participantes(sesion_id,nombre,del_censo,registrado_at)
      VALUES(sesion,btrim(p->>'nombre'),coalesce((p->>'del_censo')::boolean,false),NULL);
  END LOOP;
  RETURN jsonb_build_object('sesion_id',sesion);
END; $$;

CREATE OR REPLACE FUNCTION app_private.admin_sesion_crear(p_etapa uuid,p_sociedad uuid,p_participantes jsonb,p_minutos integer,p_cantidad integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE sesion uuid; p jsonb; e public.etapas;
BEGIN
  IF p_minutos IS NULL OR p_cantidad IS NULL THEN RAISE EXCEPTION 'Indica los minutos y las preguntas de la sesión.'; END IF;
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
  SELECT * INTO e FROM public.etapas WHERE id=p_etapa AND estado<>'cerrada' AND NOT historica FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La etapa no admite nuevas sesiones.'; END IF;
  IF jsonb_typeof(p_participantes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_participantes) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Agrega de 1 a 500 participantes.'; END IF;
  INSERT INTO public.sesiones(etapa_id,sociedad_id,estado,tiempo_limite,cantidad_preguntas) VALUES(p_etapa,p_sociedad,'esperando',p_minutos,p_cantidad) RETURNING id INTO sesion;
  FOR p IN SELECT value FROM jsonb_array_elements(p_participantes) LOOP
    IF jsonb_typeof(p->'nombre') IS DISTINCT FROM 'string' OR length(btrim(p->>'nombre')) NOT BETWEEN 1 AND 150
      OR (p ? 'del_censo' AND jsonb_typeof(p->'del_censo') IS DISTINCT FROM 'boolean') THEN RAISE EXCEPTION 'Revisa los datos del participante.'; END IF;
    INSERT INTO public.participantes(sesion_id,nombre,del_censo,registrado_at)
      VALUES(sesion,btrim(p->>'nombre'),coalesce((p->>'del_censo')::boolean,false),NULL);
  END LOOP;
  RETURN jsonb_build_object('sesion_id',sesion);
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
   n:=(coalesce(s.distribucion,e.reglas->'distribucion')->>t)::int;
   SELECT array_agg(q.id) INTO parte FROM (SELECT id FROM public.preguntas WHERE etapa_id=e.id AND activa AND tipo=t AND puntaje=(e.reglas->'puntos'->>t)::int ORDER BY random() LIMIT n) q;
   IF coalesce(cardinality(parte),0)<>n THEN RAISE EXCEPTION 'Faltan preguntas del tipo %. Avisa al moderador.',t; END IF;
   elegidas:=elegidas||coalesce(parte,ARRAY[]::uuid[]);
  END LOOP;
 ELSE
  SELECT array_agg(q.id) INTO elegidas FROM(SELECT id FROM public.preguntas WHERE etapa_id=e.id AND activa ORDER BY random() LIMIT i.cantidad_preguntas) q;
  IF coalesce(cardinality(elegidas),0)<>i.cantidad_preguntas THEN RAISE EXCEPTION 'El banco no tiene suficientes preguntas. Avisa al encargado.'; END IF;
 END IF;
 INSERT INTO public.intento_preguntas(intento_id,pregunta_id,posicion,tipo,texto,opciones,respuesta_correcta,puntaje,rubrica)
 SELECT i.id,q.id,row_number() OVER(ORDER BY random())::int,q.tipo,q.texto,q.opciones,q.respuesta_correcta,q.puntaje,q.rubrica FROM public.preguntas q WHERE q.id=ANY(elegidas);
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
  abierta:=e.estado='activa' AND (s.estado='esperando' OR (s.estado='activo' AND clock_timestamp()<s.iniciado_at+make_interval(mins=>s.tiempo_limite)));
  RETURN jsonb_build_object('servidor_at',clock_timestamp(),'sesion',jsonb_build_object('id',s.id,'estado',s.estado,
    'tiempo_limite',s.tiempo_limite,'iniciado_at',s.iniciado_at,'vence_at',s.iniciado_at+make_interval(mins=>s.tiempo_limite),'sociedad',(SELECT nombre FROM public.sociedades WHERE id=s.sociedad_id)),
    'etapa',jsonb_build_object('libro',e.libro,'nombre',e.nombre,'anio',e.anio,'cantidad_preguntas',s.cantidad_preguntas,'distribucion',coalesce(s.distribucion,e.reglas->'distribucion')),
    'disponible',abierta,'intento_id',propio,
    'participantes',CASE WHEN abierta AND propio IS NULL THEN
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre) ORDER BY p.nombre),'[]'::jsonb)
        FROM public.participantes p WHERE p.sesion_id=s.id AND NOT p.examen_finalizado
        AND NOT EXISTS (SELECT 1 FROM public.intentos i WHERE i.participante_id=p.id))
      ELSE '[]'::jsonb END);
END; $$;

CREATE OR REPLACE FUNCTION app_private.examen_payload(p_intento uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE i public.intentos; s public.sesiones; e public.etapas; p public.participantes; q public.intento_preguntas; c app_private.control_intentos; acceso jsonb; permitido boolean;
BEGIN
  SELECT * INTO i FROM public.intentos WHERE id=p_intento AND usuario_id=app_private.examen_uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'No tienes acceso a este intento.' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM public.sesiones WHERE id=i.sesion_id AND eliminada_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esta sesión no está disponible.' USING ERRCODE='42501'; END IF;
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
    'etapa',jsonb_build_object('id',e.id,'nombre',e.nombre,'libro',e.libro,'anio',e.anio,'cantidad_preguntas',s.cantidad_preguntas,'distribucion',coalesce(s.distribucion,e.reglas->'distribucion')),
    'sesion',jsonb_build_object('id',s.id,'estado',s.estado,'tiempo_limite',s.tiempo_limite,'vence_at',s.iniciado_at+make_interval(mins=>s.tiempo_limite),'sociedad',(SELECT nombre FROM public.sociedades WHERE id=s.sociedad_id)),
    'participante',jsonb_build_object('id',p.id,'nombre',p.nombre),
    'intento',jsonb_build_object('id',i.id,'estado',i.estado,'total',i.cantidad_preguntas,
      'respondidas',(SELECT count(*) FROM public.respuestas WHERE intento_id=i.id),'vence_at',i.vence_at,'motivo_cierre',i.motivo_cierre,'finalizado_at',i.finalizado_at),
    'ayuda',(SELECT jsonb_build_object('id',a.id,'created_at',a.created_at,
      'atendida_at',(SELECT min(x.created_at) FROM public.incidencias_examen x WHERE x.intento_id=i.id AND x.tipo='ayuda_atendida' AND x.detalle=a.id::text))
      FROM public.incidencias_examen a WHERE a.intento_id=i.id AND a.tipo='ayuda' ORDER BY a.created_at DESC,a.id DESC LIMIT 1),
    'pregunta',CASE WHEN q.id IS NULL THEN NULL ELSE jsonb_build_object('id',q.id,'posicion',q.posicion,'tipo',q.tipo,
      'texto',q.texto,'opciones',q.opciones,'puntaje',q.puntaje,'borrador',q.borrador,'revision',q.revision) END);
END; $$;

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
  IF s.eliminada_at IS NOT NULL THEN RAISE EXCEPTION 'Esta sesión fue eliminada.' USING ERRCODE='42501'; END IF;
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

CREATE OR REPLACE FUNCTION app_private.examen_registrar(p_sesion uuid,p_participante uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE s public.sesiones; e public.etapas; p public.participantes; intento uuid;
BEGIN
  PERFORM app_private.examen_uid();
  SELECT * INTO s FROM public.sesiones WHERE id=p_sesion;
  SELECT * INTO e FROM public.etapas WHERE id=s.etapa_id FOR SHARE;
  SELECT * INTO s FROM public.sesiones WHERE id=p_sesion FOR SHARE;
  IF s.id IS NULL OR s.eliminada_at IS NOT NULL OR e.historica OR e.estado<>'activa' OR s.estado NOT IN ('esperando','activo') THEN
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
  PERFORM 1 FROM public.etapas WHERE id=i.etapa_id AND estado='activa' FOR SHARE;
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

CREATE OR REPLACE FUNCTION app_private.validar_nombre_etapa() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s public.sesiones;
BEGIN
 SELECT * INTO s FROM public.sesiones WHERE id=NEW.sesion_id;
 IF NOT EXISTS(SELECT 1 FROM public.etapas WHERE id=s.etapa_id AND (reglas->>'version')::int>=3) THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(s.etapa_id::text||s.sociedad_id::text,0));
 IF EXISTS(SELECT 1 FROM public.participantes p JOIN public.sesiones t ON t.id=p.sesion_id WHERE t.etapa_id=s.etapa_id AND t.sociedad_id=s.sociedad_id AND t.eliminada_at IS NULL AND p.id<>NEW.id AND lower(regexp_replace(btrim(p.nombre),'\s+',' ','g'))=lower(regexp_replace(btrim(NEW.nombre),'\s+',' ','g'))) THEN RAISE EXCEPTION 'Este nombre ya está inscrito en la sociedad para esta etapa. En caso de homónimo, añade un identificador acordado con el moderador.'; END IF;
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

CREATE OR REPLACE FUNCTION app_private.archivar_cierre() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo un administrador puede cerrar una etapa.'; END IF;
  INSERT INTO public.archivos_etapa(etapa_id,contenido)
  SELECT NEW.id,jsonb_build_object('etapa',to_jsonb(NEW),'origen','cierre_v2','datos',jsonb_build_object(
    'sociedades',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.sociedades t WHERE EXISTS(SELECT 1 FROM public.sesiones s WHERE s.sociedad_id=t.id AND s.etapa_id=NEW.id AND s.eliminada_at IS NULL)),
    'sesiones',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.sesiones t WHERE t.etapa_id=NEW.id AND t.eliminada_at IS NULL),
    'participantes',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.participantes t JOIN public.sesiones s ON s.id=t.sesion_id WHERE s.etapa_id=NEW.id AND s.eliminada_at IS NULL),
    'preguntas',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.preguntas t WHERE t.etapa_id=NEW.id),
    'respuestas',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.respuestas t JOIN public.intentos i ON i.id=t.intento_id WHERE i.etapa_id=NEW.id AND EXISTS(SELECT 1 FROM public.sesiones s WHERE s.id=i.sesion_id AND s.eliminada_at IS NULL)),
    'eventos_sesion',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.eventos_sesion t JOIN public.sesiones s ON s.id=t.sesion_id WHERE s.etapa_id=NEW.id AND s.eliminada_at IS NULL),
    'incidencias_examen',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at,x.id),'[]'::jsonb) FROM public.incidencias_examen x JOIN public.intentos z ON z.id=x.intento_id WHERE z.etapa_id=NEW.id AND EXISTS(SELECT 1 FROM public.sesiones s WHERE s.id=z.sesion_id AND s.eliminada_at IS NULL)),'intentos',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.intentos t WHERE t.etapa_id=NEW.id AND EXISTS(SELECT 1 FROM public.sesiones s WHERE s.id=t.sesion_id AND s.eliminada_at IS NULL)),
    'intento_preguntas',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.intento_preguntas t JOIN public.intentos i ON i.id=t.intento_id WHERE i.etapa_id=NEW.id AND EXISTS(SELECT 1 FROM public.sesiones s WHERE s.id=i.sesion_id AND s.eliminada_at IS NULL))
  ));
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION app_private.admin_premiacion_vincular(p_efesios uuid,p_hebreos uuid,p_motivo text,p_revision integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE revision_actual integer;
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores' USING ERRCODE='42501'; END IF;
 IF p_motivo IS NULL OR length(btrim(p_motivo)) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'Registra cómo verificaste la identidad'; END IF;
 PERFORM p.id FROM public.participantes p JOIN public.sesiones s ON s.id=p.sesion_id JOIN public.etapas e ON e.id=s.etapa_id
 WHERE p.id=p_efesios AND e.codigo='2026-02-efesios' AND s.eliminada_at IS NULL FOR UPDATE OF p;
 IF NOT FOUND THEN RAISE EXCEPTION 'No corresponde a un participante de Efesios'; END IF;
 IF p_hebreos IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM app_private.resultados_hebreos h,jsonb_array_elements(h.contenido->'participantes') p WHERE p->>'id'=p_hebreos::text
 ) THEN RAISE EXCEPTION 'No corresponde a un participante de Hebreos'; END IF;
 SELECT revision INTO revision_actual FROM app_private.vinculos_premiacion WHERE participante_efesios=p_efesios FOR UPDATE;
 IF coalesce(revision_actual,0) IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Otro administrador cambió esta vinculación; actualiza la pantalla' USING ERRCODE='40001'; END IF;
 INSERT INTO app_private.vinculos_premiacion(participante_efesios,participante_hebreos,revision,motivo,actor)
 VALUES(p_efesios,p_hebreos,coalesce(revision_actual,0)+1,btrim(p_motivo),auth.uid())
 ON CONFLICT(participante_efesios) DO UPDATE SET participante_hebreos=EXCLUDED.participante_hebreos,
 revision=EXCLUDED.revision,motivo=EXCLUDED.motivo,actor=EXCLUDED.actor,updated_at=now();
 INSERT INTO app_private.auditoria_premiacion(actor,tipo,detalle)
 VALUES(auth.uid(),'identidad',jsonb_build_object('efesios',p_efesios,'hebreos',p_hebreos,'motivo',btrim(p_motivo),'revision',coalesce(revision_actual,0)+1));
 RETURN app_private.admin_premiacion_resumen();
END;
$$;

CREATE OR REPLACE FUNCTION app_private.revision_sesion(p_sesion uuid,p_etapa uuid) RETURNS public.sesiones
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.sesiones;
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
 SELECT x.* INTO s FROM public.sesiones x JOIN public.etapas e ON e.id=x.etapa_id
 WHERE x.id=p_sesion AND x.eliminada_at IS NULL AND e.id=p_etapa AND NOT e.historica AND e.estado<>'cerrada';
 IF NOT FOUND THEN RAISE EXCEPTION 'Esta sesión no admite corrección en la etapa seleccionada.' USING ERRCODE='42501'; END IF;
 RETURN s;
END; $$;

CREATE OR REPLACE FUNCTION app_private.servicio_ia_reservar(p_respuesta uuid,p_revision integer,p_version text,p_reserva numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid; b app_private.ia_presupuestos; j app_private.ia_sugerencias; nuevo uuid:=gen_random_uuid();
BEGIN
 SELECT i.etapa_id INTO e FROM public.respuestas r JOIN public.intentos i ON i.id=r.intento_id
  JOIN public.intento_preguntas q ON q.id=r.intento_pregunta_id JOIN public.etapas t ON t.id=i.etapa_id
 WHERE r.id=p_respuesta AND r.revision_calificacion=p_revision AND (r.calificado_por='pendiente_ia' OR r.puntaje_obtenido IS NULL)
  AND EXISTS(SELECT 1 FROM public.sesiones s WHERE s.id=i.sesion_id AND s.eliminada_at IS NULL) AND q.tipo<>'multiple' AND NOT t.historica AND t.estado<>'cerrada';
 IF e IS NULL THEN RAISE EXCEPTION 'La respuesta ya no admite sugerencias.' USING ERRCODE='40001'; END IF;
 IF p_version IS NULL OR length(p_version)>100 OR p_reserva IS NULL OR p_reserva<=0 OR p_reserva>0.25 THEN RAISE EXCEPTION 'Reserva de IA inválida.'; END IF;
 SELECT * INTO b FROM app_private.ia_presupuestos WHERE etapa_id=e FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No hay presupuesto autorizado para esta etapa.' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM app_private.ia_sugerencias WHERE respuesta_id=p_respuesta AND revision=p_revision AND version=p_version;
 IF j.estado='lista' THEN RETURN jsonb_build_object('estado','lista','resultado',j.resultado,'modelo',j.modelo,'disponible',greatest(0,b.limite-b.gastado-b.reservado)); END IF;
 IF j.estado='pendiente' THEN
  IF j.vence_at>clock_timestamp() THEN RETURN jsonb_build_object('estado','ocupada'); END IF;
  -- Un proceso interrumpido puede haber consumido: nunca se libera un coste desconocido.
  UPDATE app_private.ia_presupuestos SET reservado=reservado-j.reserva,gastado=gastado+j.reserva WHERE etapa_id=e RETURNING * INTO b;
  UPDATE app_private.ia_sugerencias SET costo=reserva,estimado=true,estado='fallida' WHERE respuesta_id=p_respuesta AND revision=p_revision AND version=p_version;
 END IF;
 p_reserva:=ceil(p_reserva*100000000)/100000000;
 IF b.gastado+b.reservado+p_reserva>b.limite THEN RETURN jsonb_build_object('estado','agotado','disponible',greatest(0,b.limite-b.gastado-b.reservado)); END IF;
 UPDATE app_private.ia_presupuestos SET reservado=reservado+p_reserva WHERE etapa_id=e;
 INSERT INTO app_private.ia_sugerencias(respuesta_id,revision,version,etapa_id,token,estado,reserva,vence_at)
 VALUES(p_respuesta,p_revision,p_version,e,nuevo,'pendiente',p_reserva,clock_timestamp()+interval '3 minutes')
 ON CONFLICT(respuesta_id,revision,version) DO UPDATE SET token=nuevo,estado='pendiente',reserva=p_reserva,costo=NULL,estimado=false,resultado=NULL,modelo=NULL,vence_at=excluded.vence_at;
 RETURN jsonb_build_object('estado','reservada','token',nuevo,'disponible',greatest(0,b.limite-b.gastado-b.reservado-p_reserva));
END; $$;

CREATE FUNCTION app_private.admin_sesion_eliminar(p_sesion uuid,p_etapa uuid,p_confirmacion text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.sesiones;
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
 IF p_confirmacion IS DISTINCT FROM 'ELIMINAR' THEN RAISE EXCEPTION 'Confirma la eliminación de la sesión.'; END IF;
 PERFORM 1 FROM public.etapas WHERE id=p_etapa AND NOT historica AND estado<>'cerrada' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No se eliminan sesiones de una etapa cerrada o histórica.' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.sesiones WHERE id=p_sesion AND etapa_id=p_etapa FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'La sesión no pertenece a esta etapa.' USING ERRCODE='42501'; END IF;
 IF s.eliminada_at IS NULL THEN UPDATE public.sesiones SET eliminada_at=clock_timestamp() WHERE id=s.id; END IF;
 RETURN jsonb_build_object('eliminada',true,'sesion_id',s.id);
END; $$;
CREATE FUNCTION public.admin_sesion_crear(p_etapa uuid,p_sociedad uuid,p_participantes jsonb,p_minutos integer,p_cantidad integer) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_sesion_crear($1,$2,$3,$4,$5) $$;
CREATE FUNCTION public.admin_sesion_eliminar(p_sesion uuid,p_etapa uuid,p_confirmacion text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_sesion_eliminar($1,$2,$3) $$;
REVOKE ALL ON FUNCTION public.admin_sesion_crear(uuid,uuid,jsonb,integer,integer),app_private.admin_sesion_crear(uuid,uuid,jsonb,integer,integer),public.admin_sesion_eliminar(uuid,uuid,text),app_private.admin_sesion_eliminar(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_sesion_crear(uuid,uuid,jsonb,integer,integer),app_private.admin_sesion_crear(uuid,uuid,jsonb,integer,integer),public.admin_sesion_eliminar(uuid,uuid,text),app_private.admin_sesion_eliminar(uuid,uuid,text) TO authenticated;
-- Bloquea escrituras sobre los datos de una sesión eliminada, incluso desde una pestaña antigua.
CREATE FUNCTION app_private.validar_sesion_vigente() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE sid uuid; retirada timestamptz;
BEGIN
 IF TG_TABLE_NAME IN('participantes','eventos_sesion','incidencias_examen','intentos') THEN sid:=NEW.sesion_id;
 ELSIF TG_TABLE_NAME='respuestas' THEN SELECT sesion_id INTO sid FROM public.participantes WHERE id=NEW.participante_id;
 ELSE SELECT sesion_id INTO sid FROM public.intentos WHERE id=NEW.intento_id; END IF;
 SELECT eliminada_at INTO retirada FROM public.sesiones WHERE id=sid FOR SHARE;
 IF retirada IS NOT NULL THEN RAISE EXCEPTION 'Esta sesión fue eliminada.' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app_private.validar_sesion_vigente() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE tabla text; BEGIN
 FOREACH tabla IN ARRAY ARRAY['participantes','respuestas','eventos_sesion','incidencias_examen','intentos','intento_preguntas'] LOOP
  EXECUTE format('CREATE TRIGGER validar_sesion_vigente BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION app_private.validar_sesion_vigente()',tabla);
 END LOOP;
END; $$;
CREATE OR REPLACE FUNCTION app_private.admin_examen_sala(p_sesion uuid,p_etapa uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE resultado jsonb;
BEGIN
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object(
    'servidor_at',clock_timestamp(),
    'ayudas',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'intento_id',a.intento_id,'nombre',p.nombre,'motivo',a.detalle,'created_at',a.created_at) ORDER BY a.created_at,a.id),'[]'::jsonb)
      FROM public.incidencias_examen a JOIN public.intentos i ON i.id=a.intento_id JOIN public.participantes p ON p.id=i.participante_id
      WHERE a.sesion_id=s.id AND a.tipo='ayuda' AND i.estado<>'finalizado'
      AND NOT EXISTS(SELECT 1 FROM public.incidencias_examen x WHERE x.intento_id=i.id AND x.tipo='ayuda_atendida' AND x.detalle=a.id::text)),
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
    WHERE s.id=p_sesion AND s.etapa_id=p_etapa AND s.eliminada_at IS NULL;
  IF resultado IS NULL THEN RAISE EXCEPTION 'Esta sesión no pertenece a la etapa seleccionada.' USING ERRCODE='42501'; END IF;
  RETURN resultado;
END; $$;
COMMIT;
