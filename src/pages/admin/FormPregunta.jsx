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
      setRespuestaCorrecta(data.respuesta_correcta)
      setActiva(data.activa)

      if (data.tipo === 'multiple' && data.opciones) {
        let opcs = typeof data.opciones === 'string' ? JSON.parse(data.opciones) : data.opciones
        // Asegurarnos de que las opciones se mapeen correctamente a los inputs
        if (Array.isArray(opcs)) {
          // A veces pueden guardar strings directamente ["...", "..."], ajustamos el formato
          if (typeof opcs[0] === 'string') {
            setOpciones(opcs.map((o, i) => ({ letra: String.fromCharCode(65 + i), texto: o })))
          } else if (opcs[0]?.texto) {
            setOpciones(opcs)
          }
        }
      }
    } catch (err) {
      setError('Error al cargar la pregunta: ' + err.message)
    } finally {
      setCargando(false)
    }
  }

  const handleOpcionChange = (index, nuevoTexto) => {
    const nuevas = [...opciones]
    nuevas[index].texto = nuevoTexto
    setOpciones(nuevas)
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
    if (tipo === 'multiple') {
      const opcionesValidas = opciones.filter(o => o.texto.trim() !== '')
      if (opcionesValidas.length < 2) {
        setError('Debes ingresar al menos 2 opciones para una pregunta múltiple.')
        setCargando(false)
        return
      }
      // Guardaremos solo el array de strings para las opciones como JSONB
      opcionesFinales = opcionesValidas.map(o => o.texto.trim())
    }

    try {
      const payload = {
        tipo,
        texto: texto.trim(),
        puntaje: parseInt(puntaje),
        respuesta_correcta: respuestaCorrecta.trim(),
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
          <div style={{ display: 'flex', gap: 'var(--space-lg)', marginBottom: 'var(--space-lg)' }}>
            <div className="form-group" style={{ flex: 2, marginBottom: 0 }}>
              <label className="form-label">Tipo de Pregunta</label>
              <select className="form-input" value={tipo} onChange={e => setTipo(e.target.value)}>
                <option value="multiple">Opción Múltiple</option>
                <option value="abierta">Respuesta Abierta</option>
                <option value="contexto">Contexto Bíblico (Historia)</option>
              </select>
            </div>
            
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
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
                Deja en blanco las opciones que no necesites (mínimo 2).
              </p>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Respuesta Correcta / Referencia</label>
            {tipo === 'multiple' ? (
              <>
                <input 
                  type="text" 
                  className="form-input" 
                  value={respuestaCorrecta} 
                  onChange={e => setRespuestaCorrecta(e.target.value)} 
                  placeholder="Escribe exactamente el texto de la opción correcta"
                  required
                />
                <p style={{ fontSize: '0.8rem', color: 'var(--color-warning)', marginTop: '4px' }}>
                  Debe coincidir exactamente con el texto de la opción correcta (sin la letra).
                </p>
              </>
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
