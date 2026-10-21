import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ejemploEfesios } from './lib/ejemplo-efesios.mjs'
import { prepararInformeEtapa } from '../src/lib/informe-etapa.js'
import { crearDocumentoInformeEtapa } from '../src/lib/pdf-etapa.js'

const dir=path.resolve(process.argv[2] || '.local-db/efesios-pdf')
await mkdir(dir,{recursive:true})
for (const [nombre,cantidad] of [['informe-efesios-ejemplo',2],['informe-efesios-paginado',32]]) {
  const f=ejemploEfesios({sociedades:cantidad})
  if(cantidad>2) {
    f.etapa.nombre='Segunda etapa con un nombre extenso para comprobar la presentación del informe'
    for (const s of f.datos.sociedades) s.nombre+=' con un nombre extenso de varios renglones para verificar las tablas'
    for (const p of f.datos.participantes) p.nombre+=' con apellidos de ejemplo para revisar los saltos de línea'
  }
  const informe=prepararInformeEtapa({...f,ejemplo:true})
  const doc=crearDocumentoInformeEtapa(informe)
  const bytes=Buffer.from(doc.output('arraybuffer'))
  const archivo=path.join(dir,nombre+'.pdf')
  await writeFile(archivo,bytes)
  console.log(JSON.stringify({archivo,paginas:doc.internal.getNumberOfPages(),bytes:bytes.length,provisional:informe.provisional,datos:'exclusivamente ficticios'}))
}
