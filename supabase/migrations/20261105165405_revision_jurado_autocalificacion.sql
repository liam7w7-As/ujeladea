-- Puesto de corrección por sesión/sociedad. No recalifica datos existentes.
BEGIN;
CREATE TABLE app_private.revision_jurado (
 respuesta_id uuid PRIMARY KEY REFERENCES public.respuestas(id) ON DELETE RESTRICT,
 actor uuid, instancia uuid, reserva_hasta timestamptz,
 puntos jsonb, comentario text NOT NULL DEFAULT '', base_revision integer NOT NULL DEFAULT 0,
 consulta boolean NOT NULL DEFAULT false, motivo_consulta text NOT NULL DEFAULT '',
 ultima_solicitud uuid, ultima_huella text, ultimo_resultado jsonb, ultimo_actor uuid,
 actualizado_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE app_private.revision_jurado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.revision_jurado FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_private.revision_sesion(p_sesion uuid,p_etapa uuid) RETURNS public.sesiones
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.sesiones;
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
 SELECT x.* INTO s FROM public.sesiones x JOIN public.etapas e ON e.id=x.etapa_id
 WHERE x.id=p_sesion AND e.id=p_etapa AND NOT e.historica AND e.estado<>'cerrada';
 IF NOT FOUND THEN RAISE EXCEPTION 'Esta sesión no admite corrección en la etapa seleccionada.' USING ERRCODE='42501'; END IF;
 RETURN s;
END; $$;
CREATE FUNCTION app_private.revision_grupo(q public.intento_preguntas) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT md5(jsonb_build_array(q.pregunta_id,q.texto,q.respuesta_correcta,q.rubrica,q.puntaje,q.tipo)::text)
$$;
CREATE FUNCTION app_private.revision_puntos(q public.intento_preguntas,p_puntos jsonb,p_parcial boolean) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n integer:=0; x jsonb; maximo integer; cantidad integer;
BEGIN
 cantidad:=greatest(1,jsonb_array_length(q.rubrica));
 IF jsonb_typeof(p_puntos) IS DISTINCT FROM 'array' OR jsonb_array_length(p_puntos)<>cantidad THEN RAISE EXCEPTION 'Completa los criterios de esta pregunta.'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_puntos) LOOP
  maximo:=CASE WHEN jsonb_array_length(q.rubrica)=0 THEN q.puntaje ELSE (q.rubrica->n->>'puntos')::int END;
  IF x='null'::jsonb AND p_parcial THEN n:=n+1; CONTINUE; END IF;
  IF x::text !~ '^[0-9]+$' OR (x::text)::numeric>maximo THEN RAISE EXCEPTION 'Puntaje fuera del criterio %.',n+1; END IF;
  n:=n+1;
 END LOOP;
END; $$;
CREATE FUNCTION app_private.revision_dto(p_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('id',r.id,'texto',r.respuesta_dada,'revision',r.revision_calificacion,
  'pendiente',r.calificado_por='pendiente_ia' OR r.puntaje_obtenido IS NULL,'puntaje_anterior',r.puntaje_obtenido,
  'borrador',CASE WHEN m.base_revision=r.revision_calificacion AND m.puntos IS NOT NULL THEN jsonb_build_object('puntos',m.puntos,'comentario',m.comentario) ELSE NULL END,
  'consulta',coalesce(m.consulta,false),'motivo_consulta',m.motivo_consulta,'reserva_hasta',m.reserva_hasta)
 FROM public.respuestas r LEFT JOIN app_private.revision_jurado m ON m.respuesta_id=r.id WHERE r.id=p_id
$$;
CREATE FUNCTION app_private.admin_revision_resumen(p_sesion uuid,p_etapa uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.sesiones; resultado jsonb;
BEGIN
 s:=app_private.revision_sesion(p_sesion,p_etapa);
 SELECT jsonb_build_object('sesion_id',s.id,'etapa_id',s.etapa_id,'sociedad',(SELECT nombre FROM public.sociedades WHERE id=s.sociedad_id),
  'preguntas',coalesce(jsonb_agg(g ORDER BY g.texto,g.clave),'[]'::jsonb)) INTO resultado FROM (
   SELECT app_private.revision_grupo(q) clave,q.texto,q.respuesta_correcta referencia,q.rubrica,q.puntaje maximo,q.tipo,
    count(*) total,count(*) FILTER(WHERE r.calificado_por='pendiente_ia' OR r.puntaje_obtenido IS NULL) pendientes,
    count(*) FILTER(WHERE (r.calificado_por='pendiente_ia' OR r.puntaje_obtenido IS NULL) AND coalesce(m.consulta,false)) consultas,
    count(*) FILTER(WHERE r.calificado_por<>'pendiente_ia' AND r.puntaje_obtenido IS NOT NULL) revisadas
   FROM public.respuestas r JOIN public.intentos i ON i.id=r.intento_id JOIN public.intento_preguntas q ON q.id=r.intento_pregunta_id
   LEFT JOIN app_private.revision_jurado m ON m.respuesta_id=r.id
   WHERE i.sesion_id=s.id AND i.etapa_id=p_etapa AND q.tipo<>'multiple'
   GROUP BY app_private.revision_grupo(q),q.texto,q.respuesta_correcta,q.rubrica,q.puntaje,q.tipo
  ) g;
 RETURN resultado;
END; $$;
CREATE FUNCTION app_private.admin_revision_siguiente(p_sesion uuid,p_etapa uuid,p_grupo text,p_instancia uuid,p_modo text DEFAULT 'pendientes',p_excluir jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.sesiones; candidato record; r public.respuestas; m app_private.revision_jurado; pendiente boolean;
BEGIN
 s:=app_private.revision_sesion(p_sesion,p_etapa);
 IF p_instancia IS NULL OR p_grupo IS NULL OR p_modo IS NULL OR p_modo NOT IN('pendientes','consulta','revisadas') OR jsonb_typeof(p_excluir) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Selecciona una pregunta y un modo de revisión.'; END IF;
 FOR candidato IN SELECT r0.id FROM public.respuestas r0 JOIN public.intentos i ON i.id=r0.intento_id JOIN public.intento_preguntas q ON q.id=r0.intento_pregunta_id
  LEFT JOIN app_private.revision_jurado m0 ON m0.respuesta_id=r0.id
  WHERE i.sesion_id=s.id AND i.etapa_id=p_etapa AND q.tipo<>'multiple' AND app_private.revision_grupo(q)=p_grupo AND NOT p_excluir ? r0.id::text
   AND CASE p_modo WHEN 'revisadas' THEN r0.calificado_por<>'pendiente_ia' AND r0.puntaje_obtenido IS NOT NULL
    WHEN 'consulta' THEN (r0.calificado_por='pendiente_ia' OR r0.puntaje_obtenido IS NULL) AND coalesce(m0.consulta,false)
    ELSE (r0.calificado_por='pendiente_ia' OR r0.puntaje_obtenido IS NULL) AND NOT coalesce(m0.consulta,false) END
   AND (m0.actor IS NULL OR m0.reserva_hasta<clock_timestamp() OR (m0.actor=auth.uid() AND m0.instancia=p_instancia))
  ORDER BY (m0.actor=auth.uid() AND m0.instancia=p_instancia) DESC NULLS LAST,r0.created_at,r0.id
 LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('revision:'||candidato.id::text,0)) THEN CONTINUE; END IF;
  SELECT * INTO r FROM public.respuestas WHERE id=candidato.id;
  SELECT * INTO m FROM app_private.revision_jurado WHERE respuesta_id=r.id;
  IF m.actor IS NOT NULL AND m.reserva_hasta>=clock_timestamp() AND (m.actor<>auth.uid() OR m.instancia<>p_instancia) THEN CONTINUE; END IF;
  pendiente:=r.calificado_por='pendiente_ia' OR r.puntaje_obtenido IS NULL;
  IF (p_modo='revisadas' AND pendiente) OR (p_modo<>'revisadas' AND NOT pendiente) THEN CONTINUE; END IF;
  IF (p_modo='consulta' AND NOT coalesce(m.consulta,false)) OR (p_modo='pendientes' AND coalesce(m.consulta,false)) THEN CONTINUE; END IF;
  INSERT INTO app_private.revision_jurado(respuesta_id,actor,instancia,reserva_hasta,base_revision)
   VALUES(r.id,auth.uid(),p_instancia,clock_timestamp()+interval '90 seconds',r.revision_calificacion)
  ON CONFLICT(respuesta_id) DO UPDATE SET actor=auth.uid(),instancia=p_instancia,reserva_hasta=clock_timestamp()+interval '90 seconds';
  RETURN app_private.revision_dto(r.id);
 END LOOP;
 RETURN NULL;
END; $$;
CREATE FUNCTION app_private.admin_revision_borrador(p_sesion uuid,p_etapa uuid,p_respuesta uuid,p_instancia uuid,p_revision integer,p_puntos jsonb,p_comentario text DEFAULT '',p_accion text DEFAULT 'guardar',p_motivo text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.respuestas; q public.intento_preguntas; m app_private.revision_jurado;
BEGIN
 PERFORM app_private.revision_sesion(p_sesion,p_etapa);
 PERFORM pg_advisory_xact_lock(hashtextextended('revision:'||p_respuesta::text,0));
 SELECT x.* INTO r FROM public.respuestas x JOIN public.intentos i ON i.id=x.intento_id WHERE x.id=p_respuesta AND i.sesion_id=p_sesion AND i.etapa_id=p_etapa;
 IF NOT FOUND THEN RAISE EXCEPTION 'La respuesta no pertenece a esta sesión.' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM app_private.revision_jurado WHERE respuesta_id=r.id;
 IF p_instancia IS NULL OR m.actor IS DISTINCT FROM auth.uid() OR m.instancia IS DISTINCT FROM p_instancia THEN RAISE EXCEPTION 'Otra pantalla tiene reservada esta respuesta. Tus cambios locales se conservan.' USING ERRCODE='55P03'; END IF;
 IF p_revision IS NULL OR p_revision<>r.revision_calificacion THEN RAISE EXCEPTION 'La calificación cambió. Recarga antes de continuar.' USING ERRCODE='40001'; END IF;
 IF p_accion IS NULL OR p_accion NOT IN('guardar','pulso','liberar','consulta') OR p_comentario IS NULL OR length(p_comentario)>1500 OR p_motivo IS NULL OR length(p_motivo)>500 THEN RAISE EXCEPTION 'Revisa la solicitud de corrección.'; END IF;
 IF p_accion<>'pulso' THEN
  SELECT * INTO q FROM public.intento_preguntas WHERE id=r.intento_pregunta_id;
  IF q.tipo='multiple' THEN RAISE EXCEPTION 'Esta pregunta tiene corrección automática.'; END IF;
  PERFORM app_private.revision_puntos(q,p_puntos,true);
 END IF;
 IF p_accion='consulta' AND r.calificado_por<>'pendiente_ia' AND r.puntaje_obtenido IS NOT NULL THEN RAISE EXCEPTION 'Una nota guardada se modifica mediante segunda revisión.'; END IF;
 UPDATE app_private.revision_jurado SET
  puntos=CASE WHEN p_accion='pulso' THEN puntos ELSE p_puntos END,
  comentario=CASE WHEN p_accion='pulso' THEN comentario ELSE p_comentario END,base_revision=r.revision_calificacion,
  consulta=CASE WHEN p_accion='consulta' THEN true ELSE consulta END,
  motivo_consulta=CASE WHEN p_accion='pulso' THEN motivo_consulta ELSE p_motivo END,
  actor=CASE WHEN p_accion IN('consulta','liberar') THEN NULL ELSE actor END,
  instancia=CASE WHEN p_accion IN('consulta','liberar') THEN NULL ELSE instancia END,
  reserva_hasta=CASE WHEN p_accion IN('consulta','liberar') THEN NULL ELSE clock_timestamp()+interval '90 seconds' END,
  actualizado_at=clock_timestamp() WHERE respuesta_id=r.id;
 RETURN jsonb_build_object('guardado',true);
END; $$;
CREATE FUNCTION app_private.admin_revision_guardar(p_sesion uuid,p_etapa uuid,p_respuesta uuid,p_instancia uuid,p_revision integer,p_puntos jsonb,p_comentario text,p_solicitud uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.respuestas; q public.intento_preguntas; m app_private.revision_jurado; resultado jsonb; huella text;
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('revision:'||p_respuesta::text,0));
 SELECT x.* INTO r FROM public.respuestas x JOIN public.intentos i ON i.id=x.intento_id WHERE x.id=p_respuesta AND i.sesion_id=p_sesion AND i.etapa_id=p_etapa;
 IF NOT FOUND THEN RAISE EXCEPTION 'La respuesta no pertenece a esta sesión.' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM app_private.revision_jurado WHERE respuesta_id=r.id;
 huella:=md5(jsonb_build_array(p_puntos,p_comentario,p_revision,p_instancia)::text);
 IF p_solicitud IS NOT NULL AND m.ultima_solicitud=p_solicitud AND m.ultimo_actor=auth.uid() THEN
  IF m.ultima_huella<>huella THEN RAISE EXCEPTION 'El envío ya registrado contiene otra revisión.'; END IF;
  RETURN m.ultimo_resultado;
 END IF;
 PERFORM app_private.revision_sesion(p_sesion,p_etapa);
 IF p_instancia IS NULL OR m.actor IS DISTINCT FROM auth.uid() OR m.instancia IS DISTINCT FROM p_instancia THEN RAISE EXCEPTION 'Otra pantalla tiene reservada esta respuesta.' USING ERRCODE='55P03'; END IF;
 IF p_solicitud IS NULL OR p_comentario IS NULL OR length(p_comentario)>1500 THEN RAISE EXCEPTION 'Revisa la confirmación de la calificación.'; END IF;
 SELECT * INTO q FROM public.intento_preguntas WHERE id=r.intento_pregunta_id;
 IF q.tipo='multiple' THEN RAISE EXCEPTION 'Esta pregunta tiene corrección automática.'; END IF;
 PERFORM app_private.revision_puntos(q,p_puntos,false);
 IF jsonb_array_length(q.rubrica)>0 THEN
  resultado:=app_private.admin_examen_calificar_rubrica(r.id,p_puntos,p_comentario,p_revision);
 ELSE
  IF p_revision IS NULL OR p_revision<>r.revision_calificacion THEN RAISE EXCEPTION 'Otra revisión cambió esta nota.' USING ERRCODE='40001'; END IF;
  resultado:=app_private.admin_examen_calificar(r.id,(p_puntos->>0)::int,'manual');
  UPDATE public.respuestas SET revision_calificacion=revision_calificacion+1 WHERE id=r.id;
 END IF;
 resultado:=resultado||jsonb_build_object('revision',r.revision_calificacion+1,'respuesta_id',r.id);
 UPDATE app_private.revision_jurado SET actor=NULL,instancia=NULL,reserva_hasta=NULL,puntos=NULL,comentario='',consulta=false,motivo_consulta='',
  ultima_solicitud=p_solicitud,ultima_huella=huella,ultimo_resultado=resultado,ultimo_actor=auth.uid(),actualizado_at=clock_timestamp() WHERE respuesta_id=r.id;
 RETURN resultado;
END; $$;

CREATE FUNCTION public.admin_revision_resumen(p_sesion uuid,p_etapa uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_revision_resumen($1,$2) $$;
CREATE FUNCTION public.admin_revision_siguiente(p_sesion uuid,p_etapa uuid,p_grupo text,p_instancia uuid,p_modo text DEFAULT 'pendientes',p_excluir jsonb DEFAULT '[]') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_revision_siguiente($1,$2,$3,$4,$5,$6) $$;
CREATE FUNCTION public.admin_revision_borrador(p_sesion uuid,p_etapa uuid,p_respuesta uuid,p_instancia uuid,p_revision integer,p_puntos jsonb,p_comentario text DEFAULT '',p_accion text DEFAULT 'guardar',p_motivo text DEFAULT '') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_revision_borrador($1,$2,$3,$4,$5,$6,$7,$8,$9) $$;
CREATE FUNCTION public.admin_revision_guardar(p_sesion uuid,p_etapa uuid,p_respuesta uuid,p_instancia uuid,p_revision integer,p_puntos jsonb,p_comentario text,p_solicitud uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_revision_guardar($1,$2,$3,$4,$5,$6,$7,$8) $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure firma,p.proname,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='app_private' AND p.proname IN('revision_sesion','revision_grupo','revision_puntos','revision_dto')) OR (n.nspname IN('app_private','public') AND p.proname IN('admin_revision_resumen','admin_revision_siguiente','admin_revision_borrador','admin_revision_guardar')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.firma);
  IF f.proname LIKE 'admin_revision_%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.firma); END IF;
 END LOOP;
END; $$;
-- Presupuesto vitalicio de Efesios. El navegador nunca puede reservar ni liberar gasto.
CREATE TABLE app_private.ia_presupuestos (
 etapa_id uuid PRIMARY KEY REFERENCES public.etapas(id) ON DELETE RESTRICT,
 limite numeric(12,8) NOT NULL CHECK(limite>0 AND limite<=5),
 gastado numeric(12,8) NOT NULL DEFAULT 0 CHECK(gastado>=0),
 reservado numeric(12,8) NOT NULL DEFAULT 0 CHECK(reservado>=0)
);
INSERT INTO app_private.ia_presupuestos(etapa_id,limite) SELECT id,5 FROM public.etapas WHERE codigo='2026-02-efesios' AND NOT historica;
CREATE TABLE app_private.ia_sugerencias (
 respuesta_id uuid NOT NULL REFERENCES public.respuestas(id) ON DELETE RESTRICT,
 revision integer NOT NULL, version text NOT NULL, etapa_id uuid NOT NULL REFERENCES public.etapas(id) ON DELETE RESTRICT,
 token uuid NOT NULL, estado text NOT NULL CHECK(estado IN('pendiente','lista','fallida')),
 reserva numeric(12,8) NOT NULL, costo numeric(12,8), estimado boolean NOT NULL DEFAULT false,
 resultado jsonb, modelo text, vence_at timestamptz NOT NULL, creado_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(respuesta_id,revision,version)
);
CREATE INDEX ia_sugerencias_etapa_idx ON app_private.ia_sugerencias(etapa_id);
ALTER TABLE app_private.ia_presupuestos ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.ia_sugerencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.ia_presupuestos,app_private.ia_sugerencias FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA app_private TO service_role;

CREATE OR REPLACE FUNCTION app_private.admin_examen_contexto(p_respuesta uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.respuestas; q public.intento_preguntas; i public.intentos;
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.respuestas WHERE id=p_respuesta;
 SELECT * INTO q FROM public.intento_preguntas WHERE id=r.intento_pregunta_id;
 SELECT * INTO i FROM public.intentos WHERE id=r.intento_id;
 PERFORM app_private.revision_sesion(i.sesion_id,i.etapa_id);
 IF q.id IS NULL THEN RAISE EXCEPTION 'Esta respuesta no admite calificación en V2.'; END IF;
 RETURN jsonb_build_object('id',r.id,'texto',q.texto,'tipo',q.tipo,'referencia',q.respuesta_correcta,'maximo',q.puntaje,
  'respuesta',r.respuesta_dada,'rubrica',q.rubrica,'pendiente',r.calificado_por='pendiente_ia' OR r.puntaje_obtenido IS NULL,
  'revision',r.revision_calificacion,'etapa_id',i.etapa_id,'sesion_id',i.sesion_id);
END; $$;

CREATE FUNCTION app_private.servicio_ia_reservar(p_respuesta uuid,p_revision integer,p_version text,p_reserva numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid; b app_private.ia_presupuestos; j app_private.ia_sugerencias; nuevo uuid:=gen_random_uuid();
BEGIN
 SELECT i.etapa_id INTO e FROM public.respuestas r JOIN public.intentos i ON i.id=r.intento_id
  JOIN public.intento_preguntas q ON q.id=r.intento_pregunta_id JOIN public.etapas t ON t.id=i.etapa_id
 WHERE r.id=p_respuesta AND r.revision_calificacion=p_revision AND (r.calificado_por='pendiente_ia' OR r.puntaje_obtenido IS NULL)
  AND q.tipo<>'multiple' AND NOT t.historica AND t.estado<>'cerrada';
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
CREATE FUNCTION app_private.servicio_ia_finalizar(p_respuesta uuid,p_revision integer,p_version text,p_token uuid,p_costo numeric,p_resultado jsonb,p_modelo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j app_private.ia_sugerencias; b app_private.ia_presupuestos; valor numeric;
BEGIN
 SELECT * INTO j FROM app_private.ia_sugerencias WHERE respuesta_id=p_respuesta AND revision=p_revision AND version=p_version;
 IF NOT FOUND OR p_token IS DISTINCT FROM j.token THEN RAISE EXCEPTION 'Reserva de IA no válida.' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM app_private.ia_presupuestos WHERE etapa_id=j.etapa_id FOR UPDATE;
 SELECT * INTO j FROM app_private.ia_sugerencias WHERE respuesta_id=p_respuesta AND revision=p_revision AND version=p_version;
 IF p_token IS DISTINCT FROM j.token THEN RAISE EXCEPTION 'La reserva de IA cambió.' USING ERRCODE='40001'; END IF;
 IF j.estado<>'pendiente' THEN RETURN jsonb_build_object('disponible',greatest(0,b.limite-b.gastado-b.reservado)); END IF;
 IF p_costo IS NOT NULL AND (p_costo<0 OR p_costo>5) THEN RAISE EXCEPTION 'Coste inválido.'; END IF;
 valor:=coalesce(p_costo,j.reserva);
 UPDATE app_private.ia_presupuestos SET reservado=reservado-j.reserva,gastado=gastado+valor WHERE etapa_id=j.etapa_id RETURNING * INTO b;
 UPDATE app_private.ia_sugerencias SET estado=CASE WHEN p_resultado IS NULL THEN 'fallida' ELSE 'lista' END,
  costo=valor,estimado=p_costo IS NULL,resultado=p_resultado,modelo=p_modelo WHERE respuesta_id=p_respuesta AND revision=p_revision AND version=p_version;
 RETURN jsonb_build_object('disponible',greatest(0,b.limite-b.gastado-b.reservado));
END; $$;
CREATE FUNCTION public.servicio_ia_reservar(p_respuesta uuid,p_revision integer,p_version text,p_reserva numeric) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.servicio_ia_reservar($1,$2,$3,$4) $$;
CREATE FUNCTION public.servicio_ia_finalizar(p_respuesta uuid,p_revision integer,p_version text,p_token uuid,p_costo numeric,p_resultado jsonb,p_modelo text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.servicio_ia_finalizar($1,$2,$3,$4,$5,$6,$7) $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure firma FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('app_private','public') AND p.proname IN('servicio_ia_reservar','servicio_ia_finalizar') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.firma);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.firma);
 END LOOP;
END; $$;
COMMIT;
