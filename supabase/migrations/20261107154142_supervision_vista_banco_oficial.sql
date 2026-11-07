-- Señales de vista agrupadas. No califican ni alteran preguntas o plazos.
BEGIN;
CREATE TABLE app_private.episodios_supervision(
 intento_id uuid NOT NULL REFERENCES public.intentos(id) ON DELETE RESTRICT,
 episodio uuid NOT NULL, sesion_id uuid NOT NULL REFERENCES public.sesiones(id) ON DELETE RESTRICT,
 desde timestamptz NOT NULL DEFAULT clock_timestamp(), ultimo_at timestamptz NOT NULL DEFAULT clock_timestamp(), hasta timestamptz,
 senales jsonb NOT NULL, activas jsonb NOT NULL, fuerte_desde timestamptz,
 duracion_ms integer NOT NULL DEFAULT 0 CHECK(duracion_ms BETWEEN 0 AND 86400000),
 ausencia_ms integer NOT NULL DEFAULT 0 CHECK(ausencia_ms BETWEEN 0 AND 86400000),
 requiere_revision boolean NOT NULL DEFAULT false,
 PRIMARY KEY(intento_id,episodio)
);
CREATE INDEX episodios_supervision_sesion_idx ON app_private.episodios_supervision(sesion_id,desde DESC);
ALTER TABLE app_private.episodios_supervision ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.episodios_supervision FROM PUBLIC,anon,authenticated;
CREATE FUNCTION app_private.supervision_pendiente(p_intento uuid) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM app_private.episodios_supervision WHERE intento_id=p_intento AND hasta IS NULL AND fuerte_desde<clock_timestamp()-interval '15 seconds')
$$;
REVOKE ALL ON FUNCTION app_private.supervision_pendiente(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.supervision_pendiente(uuid) TO authenticated;

CREATE FUNCTION app_private.examen_supervisar(p_intento uuid,p_episodio uuid,p_fase text,p_senales jsonb,p_observadas jsonb,p_duracion integer,p_ausencia integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.intentos; c app_private.control_intentos; e app_private.episodios_supervision; fuerte boolean; revision boolean;
BEGIN
 i:=app_private.examen_bloquear(p_intento);
 IF i.estado<>'en_curso' OR NOT coalesce(app_private.supervision_v3(i.id),false) THEN RETURN app_private.examen_payload(i.id); END IF;
 IF p_episodio IS NULL OR p_fase IS NULL OR p_fase NOT IN('inicio','pulso','fin') OR p_duracion IS NULL OR p_duracion NOT BETWEEN 0 AND 86400000 OR p_ausencia IS NULL OR p_ausencia NOT BETWEEN 0 AND p_duracion
 OR jsonb_typeof(p_senales) IS DISTINCT FROM 'array' OR jsonb_typeof(p_observadas) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Señal de supervisión inválida.'; END IF;
 IF jsonb_array_length(p_senales)>5 OR jsonb_array_length(p_observadas)>5 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_senales||p_observadas) v WHERE v NOT IN('"oculta"'::jsonb,'"sin_foco"'::jsonb,'"vista_reducida"'::jsonb,'"salio_fullscreen"'::jsonb,'"pantalla_completa_no_disponible"'::jsonb))
 OR NOT p_observadas @> p_senales THEN RAISE EXCEPTION 'Tipo de señal inválido.'; END IF;
 SELECT * INTO c FROM app_private.control_intentos WHERE intento_id=i.id FOR UPDATE;
 IF c.instancia IS DISTINCT FROM app_private.instancia_examen() THEN RAISE EXCEPTION 'Esta pantalla no está autorizada.' USING ERRCODE='42501'; END IF;
 -- La falta de soporte es informativa y se registra una vez por intento.
 IF p_observadas='["pantalla_completa_no_disponible"]'::jsonb AND EXISTS(SELECT 1 FROM app_private.episodios_supervision WHERE intento_id=i.id AND senales @> p_observadas) THEN RETURN app_private.examen_payload(i.id); END IF;
 SELECT * INTO e FROM app_private.episodios_supervision WHERE intento_id=i.id AND episodio=p_episodio FOR UPDATE;
 IF e.hasta IS NOT NULL THEN RETURN app_private.examen_payload(i.id); END IF;
 fuerte:=p_senales ?| ARRAY['oculta','sin_foco','salio_fullscreen'];
 IF e.intento_id IS NULL THEN
  INSERT INTO app_private.episodios_supervision(intento_id,episodio,sesion_id,senales,activas,fuerte_desde)
  VALUES(i.id,p_episodio,i.sesion_id,p_observadas,p_senales,CASE WHEN fuerte THEN clock_timestamp() ELSE NULL END) RETURNING * INTO e;
 END IF;
 revision:=(p_observadas ?| ARRAY['oculta','sin_foco','salio_fullscreen']) AND (p_ausencia>=15000 OR (e.fuerte_desde IS NOT NULL AND clock_timestamp()-e.fuerte_desde>=interval '15 seconds'));
 -- La duración del cliente es un indicio para revisión, nunca una prueba ni una penalización.
 UPDATE app_private.episodios_supervision SET
  ultimo_at=clock_timestamp(),hasta=CASE WHEN p_fase='fin' THEN clock_timestamp() ELSE NULL END,
  senales=(SELECT coalesce(jsonb_agg(DISTINCT v),'[]'::jsonb) FROM jsonb_array_elements(senales||p_observadas) v),
  activas=CASE WHEN p_fase='fin' THEN '[]'::jsonb ELSE p_senales END,
  fuerte_desde=CASE WHEN p_fase='fin' OR NOT fuerte THEN NULL ELSE coalesce(fuerte_desde,clock_timestamp()) END,
  duracion_ms=greatest(duracion_ms,p_duracion),ausencia_ms=greatest(ausencia_ms,p_ausencia),requiere_revision=requiere_revision OR revision
 WHERE intento_id=i.id AND episodio=p_episodio;
 IF revision THEN UPDATE app_private.control_intentos SET requiere_aprobacion=true,motivo='Interrupción sostenida de la vista del examen; el moderador debe revisar la causa.' WHERE intento_id=i.id; END IF;
 RETURN app_private.examen_payload(i.id);
END; $$;
REVOKE ALL ON FUNCTION app_private.examen_supervisar(uuid,uuid,text,jsonb,jsonb,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.examen_supervisar(uuid,uuid,text,jsonb,jsonb,integer,integer) TO authenticated;
CREATE FUNCTION public.examen_supervisar(p_intento uuid,p_episodio uuid,p_fase text,p_senales jsonb,p_observadas jsonb,p_duracion integer,p_ausencia integer) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.examen_supervisar($1,$2,$3,$4,$5,$6,$7) $$;
REVOKE ALL ON FUNCTION public.examen_supervisar(uuid,uuid,text,jsonb,jsonb,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.examen_supervisar(uuid,uuid,text,jsonb,jsonb,integer,integer) TO authenticated;

CREATE TABLE app_private.importaciones_banco(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),etapa_id uuid NOT NULL REFERENCES public.etapas(id) ON DELETE RESTRICT,
 fuente text NOT NULL,sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),resumen jsonb NOT NULL,
 anterior jsonb NOT NULL,datos jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(etapa_id,sha256)
);
ALTER TABLE app_private.importaciones_banco ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.importaciones_banco FROM PUBLIC,anon,authenticated;
CREATE TRIGGER importacion_banco_inmutable BEFORE UPDATE OR DELETE ON app_private.importaciones_banco FOR EACH ROW EXECUTE FUNCTION app_private.archivo_inmutable();
CREATE FUNCTION app_private.admin_banco_importacion(p_etapa uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.etapas WHERE id=p_etapa AND NOT historica) THEN RAISE EXCEPTION 'Etapa no disponible.' USING ERRCODE='42501'; END IF;
 RETURN(SELECT resumen||jsonb_build_object('fuente',fuente,'created_at',created_at) FROM app_private.importaciones_banco WHERE etapa_id=p_etapa ORDER BY created_at DESC,id DESC LIMIT 1);
END; $$;
REVOKE ALL ON FUNCTION app_private.admin_banco_importacion(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.admin_banco_importacion(uuid) TO authenticated;
CREATE FUNCTION public.admin_banco_importacion(p_etapa uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_banco_importacion($1) $$;
REVOKE ALL ON FUNCTION public.admin_banco_importacion(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_banco_importacion(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION app_private.validar_acceso(p_intento uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c app_private.control_intentos;
BEGIN
 IF NOT coalesce(app_private.supervision_v3(p_intento),false) THEN RETURN; END IF;
 SELECT * INTO c FROM app_private.control_intentos WHERE intento_id=p_intento;
 IF c.instancia IS DISTINCT FROM app_private.instancia_examen() OR c.requiere_aprobacion OR c.ultimo_contacto IS NULL
 OR c.ultimo_contacto<clock_timestamp()-interval '60 seconds'
 OR c.oculto_desde<clock_timestamp()-interval '15 seconds' OR app_private.supervision_pendiente(p_intento)
 THEN RAISE EXCEPTION 'Solicita al moderador autorización para continuar. Tu progreso se conserva.' USING ERRCODE='P0003'; END IF;
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
    permitido:=permitido AND NOT app_private.supervision_pendiente(i.id);
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

CREATE OR REPLACE FUNCTION app_private.examen_contacto(p_intento uuid,p_accion text DEFAULT 'pulso',p_visible boolean DEFAULT true,p_motivo text DEFAULT '') RETURNS jsonb
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
 IF app_private.supervision_pendiente(i.id) THEN UPDATE app_private.control_intentos SET requiere_aprobacion=true,motivo='Interrupción sostenida de la vista del examen; el moderador debe revisar la causa.' WHERE intento_id=i.id; END IF;
 RETURN app_private.examen_payload(i.id);
END; $$;

CREATE OR REPLACE FUNCTION app_private.admin_examen_sala(p_sesion uuid,p_etapa uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE resultado jsonb;
BEGIN
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object(
    'servidor_at',clock_timestamp(),'etapa_estado',(SELECT estado FROM public.etapas WHERE id=s.etapa_id),
    'supervision',(SELECT coalesce(jsonb_agg(to_jsonb(z) ORDER BY z.desde DESC),'[]'::jsonb) FROM
      (SELECT v.episodio,i.participante_id,v.desde,v.hasta,v.senales,v.duracion_ms,v.requiere_revision FROM app_private.episodios_supervision v JOIN public.intentos i ON i.id=v.intento_id WHERE v.sesion_id=s.id ORDER BY v.desde DESC LIMIT 100) z),
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
  SELECT i.id,q.pregunta_id,row_number() OVER(ORDER BY random())::int,q.tipo,q.texto,CASE WHEN q.tipo='multiple' THEN (SELECT jsonb_agg(o.valor ORDER BY random()) FROM jsonb_array_elements(q.opciones) o(valor)) ELSE q.opciones END,q.respuesta_correcta,q.puntaje,q.rubrica FROM app_private.banco_sesion q WHERE q.sesion_id=s.id AND q.pregunta_id=ANY(elegidas);
 ELSE
  INSERT INTO public.intento_preguntas(intento_id,pregunta_id,posicion,tipo,texto,opciones,respuesta_correcta,puntaje,rubrica)
 SELECT i.id,q.id,row_number() OVER(ORDER BY random())::int,q.tipo,q.texto,q.opciones,q.respuesta_correcta,q.puntaje,q.rubrica FROM public.preguntas q WHERE q.id=ANY(elegidas);
 END IF;
 UPDATE public.intentos SET estado='en_curso',iniciado_at=s.iniciado_at,vence_at=s.iniciado_at+make_interval(mins=>s.tiempo_limite) WHERE id=i.id;
END; $$;

COMMIT;
