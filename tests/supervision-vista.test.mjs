import test from 'node:test'
import assert from 'node:assert/strict'
import {SupervisionVista,vistaReducida} from '../src/lib/supervision-vista.js'
function fixture(t,{fallar=false}={}){
 let tiempo=0,foco=true,editar=false,n=0;const enviados=[],avisos=[],mem=new Map()
 const documento=Object.assign(new EventTarget(),{hidden:false,fullscreenEnabled:true,fullscreenElement:{},hasFocus:()=>foco,activeElement:{matches:()=>editar}})
 const ventana=Object.assign(new EventTarget(),{innerWidth:390,innerHeight:800,screen:{width:390,orientation:{angle:0}},navigator:{userAgent:'Android'},visualViewport:Object.assign(new EventTarget(),{scale:1})})
 const storage={getItem:k=>mem.get(k),setItem:(k,v)=>mem.set(k,v)}
 const reportar=async e=>{if(fallar)throw Error('Sin red');enviados.push(structuredClone(e))}
 const s=new SupervisionVista({intento:'i',storage,ventana,documento,ahora:()=>tiempo,uuid:()=>String(++n),reportar,advertir:e=>avisos.push(e)})
 s.iniciar();t.after(()=>s.destruir())
 return{s,documento,ventana,enviados,avisos,storage,reportar,avanzar:n=>{tiempo+=n;s.comprobar()},foco:v=>{foco=v;s.comprobar()},editar:v=>{editar=v;s.comprobar()},red:v=>{fallar=!v}}
}
test('vista reducida excluye teclado, zoom, barras y cambios de orientación',()=>{
 const base={ancho:390,alto:800,orientacion:0,zoom:1},actual={...base,editando:false}
 assert.equal(vistaReducida(base,{...actual,alto:350,editando:true}),false)
 assert.equal(vistaReducida(base,{...actual,alto:700}),false)
 assert.equal(vistaReducida(base,{...actual,alto:300,zoom:2}),false)
 assert.equal(vistaReducida(base,{...actual,ancho:800,alto:390,orientacion:90}),false)
 assert.equal(vistaReducida(base,{...actual,ancho:220}),true)
 assert.equal(vistaReducida(base,{...actual,alto:350}),true)
 assert.equal(vistaReducida({...base,ancho:220},{...actual,movil:true,pantallaAncho:390,ancho:220}),true)
})
test('una pérdida breve de foco no produce incidentes',async t=>{
 const f=fixture(t);f.foco(false);f.avanzar(900);f.foco(true);await f.s.enviar();assert.equal(f.enviados.length,0);assert.equal(f.avisos.length,0)
})
test('foco, ocultamiento y tamaño se agrupan en un episodio con duración de ausencia',async t=>{
 const f=fixture(t);f.foco(false);f.avanzar(2500);await f.s.enviar();f.documento.hidden=true;f.avanzar(8500);await f.s.enviar();f.documento.hidden=false;f.foco(true);await f.s.enviar()
 assert.equal(new Set(f.enviados.map(e=>e.episodio)).size,1);const fin=f.enviados.at(-1)
 assert.equal(fin.fase,'fin');assert.equal(fin.ausencia,11000);assert.deepEqual(fin.senales,[]);assert.deepEqual(new Set(fin.observadas),new Set(['sin_foco','oculta']));assert.equal(f.avisos.length,1)
})
test('reducir la vista mientras se escribe no genera una señal por el teclado',async t=>{
 const f=fixture(t);f.editar(true);f.ventana.innerHeight=300;f.avanzar(2500);await f.s.enviar();assert.equal(f.enviados.length,0)
 f.ventana.innerHeight=800;f.editar(false);f.avanzar(2000);assert.equal(f.enviados.length,0)
})
test('una vista reducida sin perder foco se registra sin atribuir tiempo de ausencia',async t=>{
 const f=fixture(t);f.ventana.innerWidth=200;f.avanzar(1);f.avanzar(20000);await f.s.enviar();assert.deepEqual(f.enviados.at(-1).senales,['vista_reducida']);assert.equal(f.enviados.at(-1).ausencia,0)
})
test('un fallo de red conserva el cierre y su duración sin multiplicar episodios',async t=>{
 const f=fixture(t,{fallar:true});f.foco(false);f.avanzar(2500);await f.s.enviar();f.avanzar(18000);f.foco(true);await f.s.enviar()
 const guardado=JSON.parse(f.storage.getItem(f.s.key));assert.equal(guardado.length,1);assert.equal(guardado[0].fase,'fin');assert.equal(guardado[0].ausencia,20500)
 f.red(true);await f.s.enviar();assert.equal(f.enviados.length,1);assert.deepEqual(JSON.parse(f.storage.getItem(f.s.key)),[])
})
test('una salida breve seguida de una vista reducida no suma esa vista a la ausencia',async t=>{
 const f=fixture(t);f.foco(false);f.avanzar(2500);f.ventana.innerWidth=200;f.foco(true);f.avanzar(30000);await f.s.enviar();assert.equal(f.enviados.at(-1).ausencia,2500)
})
