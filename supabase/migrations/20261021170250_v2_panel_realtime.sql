-- Panel V2: lectura consistente y Realtime explícito. Preparado solo en local.
BEGIN;
DO $$
DECLARE tabla text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH tabla IN ARRAY ARRAY['sesiones','participantes','eventos_sesion'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime' AND puballtables)
      AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=tabla) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',tabla);
    END IF;
  END LOOP;
END; $$;

CREATE FUNCTION app_private.admin_examen_sala(p_sesion uuid,p_etapa uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE resultado jsonb;
BEGIN
  IF NOT app_private.es_admin() THEN RAISE EXCEPTION 'Solo administradores.' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object(
    'servidor_at',clock_timestamp(),
    'sesion',to_jsonb(s)||jsonb_build_object('sociedades',jsonb_build_object('nombre',soc.nombre,'total_censo',soc.total_censo)),
    'participantes',(SELECT coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object(
      'respondidas',(SELECT count(*) FROM public.respuestas r WHERE r.intento_id=i.id),
      'total',i.cantidad_preguntas) ORDER BY p.nombre,p.id),'[]'::jsonb)
      FROM public.participantes p LEFT JOIN public.intentos i ON i.participante_id=p.id WHERE p.sesion_id=s.id),
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
REVOKE ALL ON FUNCTION app_private.admin_examen_sala(uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.admin_examen_sala(p_sesion uuid,p_etapa uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT app_private.admin_examen_sala($1,$2) $$;
REVOKE ALL ON FUNCTION public.admin_examen_sala(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_examen_sala(uuid,uuid),app_private.admin_examen_sala(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
