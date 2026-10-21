import { randomUUID, createHmac, randomBytes } from 'node:crypto'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { adminClaims, applyMigrations, createTestDatabase, ident } from './lib/local-database.mjs'

// Vista interactiva aislada. No carga .env ni usa una URL, clave o dato remoto.
const PORT=5173, ORIGIN='http://127.0.0.1:'+PORT
const EMAIL='admin@demo.local', PASSWORD='DemoLocal2026!'
const db=await createTestDatabase()
await applyMigrations(db,{through:'20261020193851'})
const sociedadH=randomUUID(), sesionH=randomUUID(), jovenH=randomUUID(), preguntaH=randomUUID()
await db.query("INSERT INTO public.sociedades(id,nombre,iglesia,total_censo) VALUES($1,'Sociedad histórica de muestra','Iglesia de demostración',5)",[sociedadH])
await db.query("INSERT INTO public.sesiones(id,sociedad_id,estado) VALUES($1,$2,'finalizado')",[sesionH,sociedadH])
await db.query("INSERT INTO public.participantes(id,sesion_id,nombre,puntaje_total,examen_finalizado) VALUES($1,$2,'Participante histórico ficticio',10,true)",[jovenH,sesionH])
await db.query("INSERT INTO public.preguntas(id,tipo,texto,opciones,respuesta_correcta,puntaje) VALUES($1,'multiple','Pregunta histórica de demostración',$2::jsonb,'Opción de muestra A',10)",[preguntaH,JSON.stringify(['Opción de muestra A','Opción de muestra B'])])
await db.query("INSERT INTO public.respuestas(participante_id,pregunta_id,respuesta_dada,puntaje_obtenido,calificado_por) VALUES($1,$2,'Opción de muestra A',10,'sistema')",[jovenH,preguntaH])
await applyMigrations(db,{existingV1:true})
await db.query('INSERT INTO auth.users(id) VALUES($1)',[adminClaims.sub])
const alumno=randomUUID(), otroAlumno=randomUUID()
await db.query('INSERT INTO auth.users(id) VALUES($1),($2)',[alumno,otroAlumno])
const claimsAlumno={sub:alumno,is_anonymous:true,role:'authenticated',app_metadata:{}}

async function como(claims, fn) {
  return db.transaction(async tx=>{
    await tx.exec('SET LOCAL ROLE '+(claims.sub?'authenticated':'anon'))
    await tx.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)])
    return fn(tx)
  })
}
const rpcs=new Set(['examen_sala','examen_registrar','examen_estado','examen_borrador','examen_responder','examen_finalizar','examen_eventos','examen_recuperar','admin_examen_sala','admin_examen_crear_sesion','admin_examen_cerrar_vencida','admin_examen_contexto','admin_examen_calificar','admin_examen_recuperacion'])
async function rpc(nombre,args,claims) {
  if(!rpcs.has(nombre))throw new Error('RPC no disponible en la demo')
  const keys=Object.keys(args)
  return como(claims,async tx=>(await tx.query('SELECT public.'+ident(nombre)+'('+keys.map((k,i)=>ident(k)+' => $'+(i+1)).join(',')+') AS dato',keys.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]))).rows[0].dato)
}
const etapa=(await db.query("SELECT * FROM public.etapas WHERE libro='Efesios'")).rows[0]
const sociedades=[randomUUID(),randomUUID(),randomUUID()]
await como(adminClaims,async tx=>{
  for(let k=0;k<3;k++)await tx.query("INSERT INTO public.sociedades(id,nombre,iglesia,total_censo) VALUES($1,$2,'Iglesia de demostración',5)",[sociedades[k],['Sala de registro · Demo','Examen en curso · Demo','Resultados · Demo'][k]])
  for(let k=0;k<45;k++) {
    const tipo=k%3===0?'multiple':k%3===1?'abierta':'contexto'
    const texto=tipo==='multiple'?'Pregunta de demostración '+(k+1)+'. Selecciona una opción para revisar el diseño.':tipo==='abierta'?'Pregunta de demostración '+(k+1)+'. Escribe un texto de muestra para comprobar el guardado automático.':'Pregunta de demostración '+(k+1)+'. Aquí irá el pasaje y la consulta de contexto preparados por los pastores.'
    await tx.query('INSERT INTO public.preguntas(etapa_id,tipo,texto,opciones,respuesta_correcta,puntaje) VALUES($1,$2,$3,$4::jsonb,$5,10)',[etapa.id,tipo,texto,tipo==='multiple'?JSON.stringify(['Opción de muestra A','Opción de muestra B','Opción de muestra C','Opción de muestra D']):null,tipo==='multiple'?'Opción de muestra A':'Referencia de demostración. El contenido y la rúbrica oficiales se incorporarán después.'])
  }
  await tx.query("UPDATE public.etapas SET estado='activa' WHERE id=$1",[etapa.id])
})
async function nuevaSala(sociedad,nombres) {
  return (await rpc('admin_examen_crear_sesion',{p_etapa:etapa.id,p_sociedad:sociedad,p_participantes:nombres.map(nombre=>({nombre,del_censo:true}))},adminClaims)).sesion_id
}
const espera=await nuevaSala(sociedades[0],['Joven de demostración 1','Joven de demostración 2','Joven de demostración 3'])
const curso=await nuevaSala(sociedades[1],['Joven en pregunta 20','Invitado de demostración'])
const final=await nuevaSala(sociedades[2],['Joven con examen finalizado','Joven para revisar calificación'])
async function registrarPrimero(sesion,claims) {
  const sala=await rpc('examen_sala',{p_sesion:sesion},claims)
  return rpc('examen_registrar',{p_sesion:sesion,p_participante:sala.participantes[0].id},claims)
}
const intentoCurso=await registrarPrimero(curso,claimsAlumno)
const intentoFinal=await registrarPrimero(final,claimsAlumno)
const intentoOtro=await registrarPrimero(final,{sub:otroAlumno,is_anonymous:true})
await como(adminClaims,async tx=>{
  for(const sesion of [curso,final])await tx.query("UPDATE public.sesiones SET estado='activo' WHERE id=$1",[sesion])
})
async function avanzar(intento,claims,cantidad) {
  let estado=await rpc('examen_estado',{p_intento:intento},claims)
  for(let n=0;n<cantidad&&estado.pregunta;n++) {
    const q=estado.pregunta
    estado=await rpc('examen_responder',{p_intento:intento,p_pregunta:q.id,p_texto:q.tipo==='multiple'?q.opciones[0]:'Respuesta ficticia para revisar la experiencia del examen.',p_solicitud:randomUUID()},claims)
  }
  return estado
}
let estadoCurso=await avanzar(intentoCurso.intento.id,claimsAlumno,19)
await rpc('examen_borrador',{p_intento:estadoCurso.intento.id,p_pregunta:estadoCurso.pregunta.id,p_texto:estadoCurso.pregunta.tipo==='multiple'?estadoCurso.pregunta.opciones[1]:'Este borrador de demostración se conserva al recargar.',p_revision:0},claimsAlumno)
await avanzar(intentoFinal.intento.id,claimsAlumno,45)
await avanzar(intentoOtro.intento.id,{sub:otroAlumno,is_anonymous:true},45)
await como(adminClaims,tx=>tx.query("UPDATE public.sesiones SET estado='finalizado' WHERE id=$1",[final]))
const calificables=(await db.query("SELECT id FROM public.respuestas WHERE calificado_por='pendiente_ia' AND intento_id=$1",[intentoFinal.intento.id])).rows
for(const respuesta of calificables)await rpc('admin_examen_calificar',{p_respuesta:respuesta.id,p_puntaje:8,p_metodo:'manual'},adminClaims)

// Identidades ficticias emitidas solo por este proceso. No se aceptan JWT externos.
const sesionesAuth=new Map(), refrescos=new Map(), firma=randomBytes(32)
function authSession(claims) {
  const now=Math.floor(Date.now()/1000)
  const payload={...claims,role:'authenticated',exp:now+3600,iat:now,iss:ORIGIN+'/auth/v1',aud:'authenticated'}
  const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url')
  const base=enc({alg:'HS256',typ:'JWT'})+'.'+enc(payload)
  const token=base+'.'+createHmac('sha256',firma).update(base).digest('base64url')
  const session={access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:now+3600,token_type:'bearer',
    user:{id:claims.sub,aud:'authenticated',role:'authenticated',is_anonymous:!!claims.is_anonymous,email:claims.app_metadata?.role==='admin'?EMAIL:undefined,app_metadata:claims.app_metadata||{},user_metadata:{},created_at:new Date().toISOString()}}
  sesionesAuth.set(token,{session,claims:payload})
  refrescos.set(session.refresh_token,payload)
  return session
}
function identidad(req) {
  const token=req.headers.authorization?.replace(/^Bearer /i,'')
  const entry=sesionesAuth.get(token)
  return entry&&entry.claims.exp>Date.now()/1000?entry:null
}
async function cuerpo(req) {
  const chunks=[];let size=0
  for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw new Error('Solicitud demasiado grande');chunks.push(chunk)}
  const texto=Buffer.concat(chunks).toString()
  return texto?JSON.parse(texto):{}
}
function json(res,data,status=200,headers={}) {
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers})
  res.end(JSON.stringify(data))
}
function html(res,body) {
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'})
  res.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>UJELADEA · Demo local</title>'+body+'</html>')
}
const tablas=new Map(), booleanos=new Set()
for(const row of (await db.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public'")).rows) {
  if(!tablas.has(row.table_name))tablas.set(row.table_name,new Set())
  tablas.get(row.table_name).add(row.column_name)
  if(row.data_type==='boolean')booleanos.add(row.table_name+'.'+row.column_name)
}
function filtrar(url,cols,values,tabla) {
  const condiciones=[]
  for(const [key,value]of url.searchParams) {
    if(['select','order','limit','offset'].includes(key))continue
    if(!cols.has(key))throw new Error('Filtro no disponible en la demo: '+key)
    const campo=ident(key)
    if(value.startsWith('eq.')) {
      const raw=value.slice(3)
      values.push(booleanos.has(tabla+'.'+key)?raw==='true':raw)
      condiciones.push(campo+'=$'+values.length)
    } else if(value.startsWith('in.(')&&value.endsWith(')')) {
      const items=value.slice(4,-1).split(',').map(x=>x.replace(/^"|"$/g,''))
      const params=items.map(x=>{values.push(x);return '$'+values.length})
      condiciones.push(campo+' IN ('+params.join(',')+')')
    } else if(value==='is.null')condiciones.push(campo+' IS NULL')
    else if(value==='not.is.null')condiciones.push(campo+' IS NOT NULL')
    else if(value.startsWith('ilike.')){values.push(value.slice(6));condiciones.push(campo+' ILIKE $'+values.length)}
    else throw new Error('Filtro no implementado en la demo')
  }
  return condiciones.length?' WHERE '+condiciones.join(' AND '):''
}
async function rest(req,res,url) {
  const entry=identidad(req), claims=entry?.claims||{}
  if(url.pathname.startsWith('/rest/v1/rpc/'))return json(res,await rpc(url.pathname.split('/').at(-1),await cuerpo(req),claims))
  const tabla=url.pathname.split('/').at(-1), cols=tablas.get(tabla)
  if(!cols) return json(res,{message:'Tabla no disponible',code:'PGRST205'},404)
  const values=[],where=filtrar(url,cols,values,tabla)
  const result=await como(claims,async tx=>{
    let rows,total
    if(req.method==='GET'||req.method==='HEAD') {
      const count=await tx.query('SELECT count(*)::int n FROM public.'+ident(tabla)+where,values)
      total=count.rows[0].n
      const order=url.searchParams.get('order')?.split(',').map(x=>{
        const [campo,direccion]=x.split('.')
        if(!cols.has(campo))throw new Error('Orden no disponible')
        return ident(campo)+(direccion==='desc'?' DESC':' ASC')
      }).join(',') || ident(cols.has('id')?'id':cols.values().next().value)
      const inicio=Math.max(0,Number(url.searchParams.get('offset')||0))
      const limite=Math.min(5000,Math.max(0,Number(url.searchParams.get('limit')||1000)))
      if(!Number.isInteger(inicio)||!Number.isInteger(limite))throw new Error('Paginación inválida')
      rows=(await tx.query('SELECT * FROM public.'+ident(tabla)+where+' ORDER BY '+order+' OFFSET '+inicio+' LIMIT '+limite,values)).rows
    } else {
      if(req.method==='DELETE') rows=(await tx.query('DELETE FROM public.'+ident(tabla)+where+' RETURNING *',values)).rows
      else {
        const body=await cuerpo(req), records=Array.isArray(body)?body:[body]
        rows=[]
        for(const record of records) {
          const fields=Object.keys(record)
          if(!fields.length||fields.some(k=>!cols.has(k)))throw new Error('Campos no disponibles en la demo')
          const vals=fields.map(k=>record[k]!==null&&typeof record[k]==='object'?JSON.stringify(record[k]):record[k])
          if(req.method==='POST')rows.push(...(await tx.query('INSERT INTO public.'+ident(tabla)+'('+fields.map(ident).join(',')+') VALUES('+fields.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING *',vals)).rows)
          else if(req.method==='PATCH') {
            const combined=[...values,...vals]
            rows.push(...(await tx.query('UPDATE public.'+ident(tabla)+' SET '+fields.map((k,i)=>ident(k)+'=$'+(values.length+i+1)).join(',')+where+' RETURNING *',combined)).rows)
          }else throw new Error('Método no disponible')
        }
      }
      total=rows.length
    }
    if(tabla==='sesiones'&&url.searchParams.get('select')?.includes('sociedades(')) {
      for(const row of rows)row.sociedades=(await tx.query('SELECT nombre,total_censo FROM public.sociedades WHERE id=$1',[row.sociedad_id])).rows[0]||null
    }
    return {rows,total}
  })
  const singular=req.headers.accept?.includes('application/vnd.pgrst.object+json')
  if(singular&&result.rows.length!==1)return json(res,{message:'No se encontró un único registro.',code:'PGRST116'},406)
  const inicio=Number(url.searchParams.get('offset')||0)
  const headers={'content-range':result.total?inicio+'-'+Math.max(inicio,inicio+result.rows.length-1)+'/'+result.total:'*/0'}
  if(req.method==='HEAD'){res.writeHead(200,headers);res.end();return}
  return json(res,singular?result.rows[0]:result.rows,200,headers)
}
const enlaces={panel:'/demo/entrar?vista=panel',registro:'/demo/entrar?vista=registro',examen:'/demo/entrar?vista=examen',finalizado:'/demo/entrar?vista=finalizado'}
const banner='<aside id="demo-local" style="position:relative;z-index:10000;padding:10px 16px;background:#42300d;color:#fff1cb;font:13px system-ui;display:flex;gap:15px;flex-wrap:wrap;align-items:center"><strong>DEMO LOCAL · Datos ficticios</strong><a style="color:inherit" href="/demo">Recorridos</a><a style="color:inherit" href="'+enlaces.panel+'">Panel</a><a style="color:inherit" href="'+enlaces.registro+'">Registro</a><a style="color:inherit" href="'+enlaces.examen+'">Examen</a><small>Los cambios se guardan solo durante esta ejecución.</small></aside>'
const plugin={
  name:'ujeladea-demo-local',
  transformIndexHtml:{order:'post',handler(html){return html.replace('<body>','<body>'+banner)}},
  configureServer(server){
    server.middlewares.use(async(req,res,next)=>{
      const url=new URL(req.url,ORIGIN)
      if(!['/demo','/auth/v1','/rest/v1','/functions/v1'].some(p=>url.pathname===p||url.pathname.startsWith(p+'/')))return next()
      try {
        if(url.pathname==='/demo/estado')return json(res,{tipo:'demostración local, sin Supabase remoto',enlaces,espera,curso,final,etapa:etapa.id})
        if(url.pathname==='/demo/entrar') {
          const vista=url.searchParams.get('vista')
          const admin=vista==='panel'
          const session=authSession(admin?adminClaims:claimsAlumno)
          const destino=admin?'/admin/etapas':'/examen/'+(vista==='registro'?espera:vista==='finalizado'?final:curso)
          const storage=admin?'sb-127-auth-token':'ujeladea_participante_auth_v2'
          return html(res,'<body style="background:#191920;color:white;font:18px system-ui;padding:40px"><p>Abriendo la demo…</p><script>localStorage.setItem('+JSON.stringify(storage)+','+JSON.stringify(JSON.stringify(session))+');'+(admin?'sessionStorage.setItem("ujeladea_etapa_admin_v2",'+JSON.stringify(etapa.id)+');':'')+'location.replace('+JSON.stringify(destino)+');</script></body>')
        }
        if(url.pathname==='/demo')return html(res,'<body style="margin:0;background:#14141c;color:#eee;font:16px system-ui;line-height:1.7"><main style="max-width:780px;margin:60px auto;padding:24px"><p style="color:#e2b74f">UJELADEA · Revisión local de V2</p><h1>Recorre la nueva etapa de Efesios</h1><p>Esta demo utiliza datos ficticios en memoria. Las preguntas son ejemplos de interfaz; el banco pastoral se incorporará después.</p><nav style="display:grid;gap:14px;margin:32px 0">'+[['panel','Panel administrativo'],['registro','Registro y sala de espera del joven'],['examen','Examen en curso · pregunta 20'],['finalizado','Confirmación de examen finalizado']].map(([key,titulo])=>'<a style="color:#ffe3a1;padding:18px;border:1px solid #6b5130;border-radius:12px;text-decoration:none" href="'+enlaces[key]+'">'+titulo+' →</a>').join('')+'</nav><p>Los cambios duran mientras este servidor esté abierto. La sala de control se actualiza automáticamente cada 15 segundos. La demo no reproduce las conexiones Realtime de Supabase.</p><p style="font-size:14px;color:#bbb">Acceso manual al panel: '+EMAIL+' · '+PASSWORD+'. Son credenciales de demostración.</p></main></body>')
        if(url.pathname.startsWith('/functions/v1/'))return json(res,{error:'La IA está desactivada en esta demo. Puedes calificar manualmente.'},503)
        if(url.pathname.startsWith('/rest/v1/'))return await rest(req,res,url)
        const body=req.method==='GET'?{}:await cuerpo(req)
        if(url.pathname.endsWith('/settings'))return json(res,{disable_signup:false,external:{anonymous_users:true},mailer_autoconfirm:true})
        if(url.pathname.endsWith('/user')) {
          const entry=identidad(req)
          return entry?json(res,entry.session.user):json(res,{message:'Sesión local no válida'},401)
        }
        if(url.pathname.endsWith('/logout'))return json(res,{})
        if(url.pathname.endsWith('/signup')) {
          const uid=randomUUID()
          await db.query('INSERT INTO auth.users(id) VALUES($1)',[uid])
          return json(res,authSession({sub:uid,is_anonymous:true,app_metadata:{}}))
        }
        if(url.pathname.endsWith('/token')) {
          if(url.searchParams.get('grant_type')==='refresh_token') {
            const claims=refrescos.get(body.refresh_token)
            return claims?json(res,authSession(claims)):json(res,{message:'Sesión de demo vencida'},400)
          }
          return body.email===EMAIL&&body.password===PASSWORD?json(res,authSession(adminClaims)):json(res,{message:'En esta demo usa '+EMAIL+' y '+PASSWORD},400)
        }
        return json(res,{message:'Servicio no disponible en la demo'},404)
      }catch(error){return json(res,{message:error.message,code:error.code||'DEMO_LOCAL'},error.code==='42501'?403:400)}
    })
  },
}
let server
try {
  server=await createServer({configFile:false,envFile:false,plugins:[react(),plugin],define:{
    'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(ORIGIN),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('sb_publishable_demo_local_only'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify(''),
  },server:{host:'127.0.0.1',port:PORT,strictPort:true,headers:{'Content-Security-Policy':"connect-src 'self' ws://127.0.0.1:"+PORT+"; form-action 'self'; base-uri 'self'"}},logLevel:'error'})
  await server.listen()
  console.log('DEMO LOCAL lista: '+ORIGIN+'/demo')
  console.log('Panel: '+ORIGIN+enlaces.panel)
  console.log('Joven (pregunta 20): '+ORIGIN+enlaces.examen)
  console.log('Datos en memoria; sin producción ni Supabase remoto. Ctrl+C para detener.')
}catch(error){await db.close();throw error}
async function cerrar(){await server.close();await db.close();process.exit(0)}
process.on('SIGINT',cerrar)
process.on('SIGTERM',cerrar)
