import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { ArrowLeft, Save, AlertCircle } from 'lucide-react'

export default function FormPregunta() {
  const { id } = useParams()
  const navigate = useNavigate()
  
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  // Form State
  const [tipo, setTipo] = useState('multiple')
  const [texto, setTexto] = useState('')
  const [puntaje, setPuntaje] = useState(10)
  const [respuestaCorrecta, setRespuestaCorrecta] = useState('')
  const [activa, setActiva] = useState(true)
  
  // Opciones para múltiple
  const [opciones, setOpciones] = useState([
    { letra: 'A', texto: '' },
    { letra: 'B', texto: '' },
    { letra: 'C', texto: '' },
    { letra: 'D', texto: '' }
  ])

  useEffect(() => {
    if (id) {
      cargarPregunta()
    }
  }, [id])

  const cargarPregunta = async () => {
    try {
      setCargando(true)
      const { data, error } = await supabase
        .from('preguntas')
        .select('*')
        .eq('id', id)
        .single()

      if (error) throw error

      setTipo(data.tipo)
      setTexto(data.texto)
      setPuntaje(data.puntaje)
      setActiva(data.activa)

      let resCorrecta = data.respuesta_correcta || ''

      if (data.tipo === 'multiple' && data.opciones) {
        let opcs = typeof data.opciones === 'string' ? JSON.parse(data.opciones) : data.opciones
        if (Array.isArray(opcs)) {
          let mapped = []
          if (typeof opcs[0] === 'string') {
            mapped = opcs.map((o, i) => ({ letra: String.fromCharCode(65 + i), texto: o }))
          } else if (opcs[0]?.texto) {
            mapped = opcs
          }
          setOpciones(mapped)

          // Si respuesta_correcta era una letra (ej: 'B'), resolver al texto correspondiente
          const letterMatch = resCorrecta.trim().match(/^([A-Za-z])[\)\.\:\-]?$/)
          if (letterMatch) {
            const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65
            if (idx >= 0 && idx < mapped.length && mapped[idx]?.texto) {
              resCorrecta = mapped[idx].texto
            }
          }
        }
      }

      setRespuestaCorrecta(resCorrecta)
    } catch (err) {
      setError('Error al cargar la pregunta: ' + err.message)
    } finally {
      setCargando(false)
    }
  }

  const handleOpcionChange = (index, nuevoTexto) => {
    const textoAntiguo = opciones[index].texto
    const nuevas = [...opciones]
    nuevas[index].texto = nuevoTexto
    setOpciones(nuevas)

    // Si la opción que se modificó era la respuesta correcta, actualizar también respuestaCorrecta
    if (respuestaCorrecta === textoAntiguo) {
      setRespuestaCorrecta(nuevoTexto)
    }
  }

  const handleGuardar = async (e) => {
    e.preventDefault()
    setError('')
    setExito('')
    setCargando(true)

    // Validaciones
    if (!texto.trim() || !respuestaCorrecta.trim()) {
      setError('El texto de la pregunta y la respuesta correcta son obligatorios.')
      setCargando(false)
      return
    }

    let opcionesFinales = null
    let respuestaFinal = respuestaCorrecta.trim()

    if (tipo === 'multiple') {
      const opcionesValidas = opciones.filter(o => o.texto.trim() !== '')
      if (opcionesValidas.length < 2) {
        setError('Debes ingresar al menos 2 opciones para una pregunta múltiple.')
        setCargando(false)
        return
      }
      opcionesFinales = opcionesValidas.map(o => o.texto.trim())

      // Verificar si respuestaFinal es una letra y resolverla
      const letterMatch = respuestaFinal.match(/^([A-Za-z])[\)\.\:\-]?$/)
      if (letterMatch) {
        const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65
        if (idx >= 0 && idx < opcionesFinales.length) {
          respuestaFinal = opcionesFinales[idx]
        }
      }
    }

    try {
      const payload = {
        tipo,
        texto: texto.trim(),
        puntaje: parseInt(puntaje),
        respuesta_correcta: respuestaFinal,
        activa,
        opciones: opcionesFinales
      }

      if (id) {
        // Update
        const { error: errUpdate } = await supabase
          .from('preguntas')
          .update(payload)
          .eq('id', id)
        if (errUpdate) throw errUpdate
        setExito('Pregunta actualizada correctamente')
      } else {
        // Insert
        const { error: errInsert } = await supabase
          .from('preguntas')
          .insert([payload])
        if (errInsert) throw errInsert
        setExito('Pregunta creada correctamente')
        
        // Limpiar form si es nueva
        setTimeout(() => {
          navigate('/admin/preguntas')
        }, 1500)
      }

    } catch (err) {
      setError('Error al guardar: ' + err.message)
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="page-wrapper" style={{ padding: 'var(--space-md)' }}>
      <div className="page-content animate-in" style={{ maxWidth: '700px', width: '100%' }}>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
          <button onClick={() => navigate('/admin/preguntas')} className="btn btn-secondary" style={{ padding: '0.5rem', minWidth: 'auto' }}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="brand-title" style={{ fontSize: '1.5rem', marginBottom: 0 }}>
              {id ? 'Editar Pregunta' : 'Nueva Pregunta'}
            </h1>
          </div>
        </div>

        {error && <div className="alert alert-error"><AlertCircle size={16} /><span>{error}</span></div>}
        {exito && <div className="alert alert-success"><span>{exito}</span></div>}

        <form onSubmit={handleGuardar} className="card">
          <div style={{ display: 'flex', gap: 'var(--space-lg)', marginBottom: 'var(--space-lg)', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: 2, minWidth: '200px', marginBottom: 0 }}>
              <label className="form-label">Tipo de Pregunta</label>
              <select className="form-input" value={tipo} onChange={e => setTipo(e.target.value)}>
                <option value="multiple">Opción Múltiple</option>
                <option value="abierta">Respuesta Abierta</option>
                <option value="contexto">Contexto Bíblico (Historia)</option>
              </select>
            </div>
            
            <div className="form-group" style={{ flex: 1, minWidth: '100px', marginBottom: 0 }}>
              <label className="form-label">Puntaje</label>
              <input type="number" min="1" className="form-input" value={puntaje} onChange={e => setPuntaje(e.target.value)} required />
            </div>

            <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 0 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', background: 'var(--color-bg-base)', padding: '10px 16px', borderRadius: 'var(--radius-md)', border: `1px solid ${activa ? 'var(--color-success)' : 'var(--color-border)'}` }}>
                <input type="checkbox" checked={activa} onChange={e => setActiva(e.target.checked)} />
                <span style={{ fontSize: '0.9rem', color: activa ? 'var(--color-success)' : 'var(--color-text-muted)' }}>Activa</span>
              </label>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Texto de la Pregunta</label>
            <textarea 
              className="form-input" 
              value={texto} 
              onChange={e => setTexto(e.target.value)} 
              rows={4}
              placeholder="Escribe la pregunta detalladamente..."
              required
            />
          </div>

          {tipo === 'multiple' && (
            <div style={{ background: 'var(--color-bg-base)', padding: 'var(--space-lg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-lg)' }}>
              <label className="form-label" style={{ marginBottom: 'var(--space-md)' }}>Opciones de Respuesta</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                {opciones.map((opc, index) => (
                  <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                    <div style={{ width: '30px', textAlign: 'center', fontWeight: 600, color: 'var(--color-accent)' }}>{opc.letra})</div>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={opc.texto} 
                      onChange={e => handleOpcionChange(index, e.target.value)} 
                      placeholder={`Opción ${opc.letra}`}
                    />
                  </div>
                ))}
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: 'var(--space-md)' }}>
                Escribe las opciones arriba y luego marca cuál de ellas es la correcta abajo.
              </p>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Respuesta Correcta / Referencia</label>
            {tipo === 'multiple' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {opciones.filter(o => o.texto.trim() !== '').length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', background: 'var(--color-bg-base)', padding: '12px', borderRadius: 'var(--radius-sm)' }}>
                    Ingresa al menos 2 opciones arriba para seleccionar cuál es la correcta.
                  </p>
                ) : (
                  opciones.filter(o => o.texto.trim() !== '').map((opc, index) => {
                    const isSelected = respuestaCorrecta.trim().toLowerCase() === opc.texto.trim().toLowerCase()
                    return (
                      <label
                        key={index}
                        onClick={() => setRespuestaCorrecta(opc.texto.trim())}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '12px 16px',
                          borderRadius: 'var(--radius-md)',
                          border: `2px solid ${isSelected ? 'var(--color-accent)' : 'var(--color-border)'}`,
                          background: isSelected ? 'var(--color-primary-glow)' : 'var(--color-bg-base)',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <input
                          type="radio"
                          name="opcion_correcta"
                          checked={isSelected}
                          onChange={() => setRespuestaCorrecta(opc.texto.trim())}
                        />
                        <span style={{ fontWeight: 700, color: 'var(--color-accent)' }}>Opción {opc.letra}:</span>
                        <span style={{ flex: 1, fontSize: '0.95rem', color: 'var(--color-text-primary)' }}>{opc.texto}</span>
                        {isSelected && (
                          <span style={{ fontSize: '0.8rem', color: 'var(--color-success)', fontWeight: 600 }}>
                            ✓ Correcta
                          </span>
                        )}
                      </label>
                    )
                  })
                )}
              </div>
            ) : (
              <>
                <textarea 
                  className="form-input" 
                  value={respuestaCorrecta} 
                  onChange={e => setRespuestaCorrecta(e.target.value)} 
                  rows={6}
                  placeholder="Escribe la respuesta ideal o los puntos clave que debe contener la respuesta del joven. Esta referencia se usará por la Inteligencia Artificial para calificar."
                  required
                />
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                  Sé detallado. El sistema usará esto como base para comparar con la respuesta del joven.
                </p>
              </>
            )}
          </div>

          <div className="divider" />

          <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
            <button type="button" onClick={() => navigate('/admin/preguntas')} className="btn btn-secondary" style={{ flex: 1 }}>Cancelar</button>
            <button type="submit" disabled={cargando} className="btn btn-primary" style={{ flex: 2 }}>
              {cargando ? <span className="spinner" /> : <Save size={18} />}
              {cargando ? 'Guardando...' : 'Guardar Pregunta'}
            </button>
          </div>
        </form>

      </div>
    </div>
  )
}
