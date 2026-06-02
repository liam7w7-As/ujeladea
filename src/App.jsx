import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ExamenProvider } from './context/ExamenContext'
import RutaProtegida from './components/RutaProtegida'

// Admin pages
import Login from './pages/admin/Login'
import Dashboard from './pages/admin/Dashboard'
import CrearSesion from './pages/admin/CrearSesion'
import SalaEspera from './pages/admin/SalaEspera'
import Resultados from './pages/admin/Resultados'
import BancoPreguntas from './pages/admin/BancoPreguntas'
import FormPregunta from './pages/admin/FormPregunta'
import CalificarSesion from './pages/admin/CalificarSesion'
import Ranking from './pages/admin/Ranking'

// Joven pages
import Registro from './pages/joven/Registro'
import Espera from './pages/joven/Espera'
import Examen from './pages/joven/Examen'
import Finalizado from './pages/joven/Finalizado'

export default function App() {
  return (
    <BrowserRouter>
      <ExamenProvider>
        <Routes>
          {/* ── Ruta raíz ── */}
          <Route path="/" element={<Navigate to="/admin/login" replace />} />

          {/* ── Rutas Admin (protegidas) ── */}
          <Route path="/admin/login" element={<Login />} />
          <Route
            path="/admin/dashboard"
            element={
              <RutaProtegida>
                <Dashboard />
              </RutaProtegida>
            }
          />
          <Route
            path="/admin/sesion/nueva"
            element={
              <RutaProtegida>
                <CrearSesion />
              </RutaProtegida>
            }
          />
          <Route
            path="/admin/sesion/:id/espera"
            element={
              <RutaProtegida>
                <SalaEspera />
              </RutaProtegida>
            }
          />
          <Route
            path="/admin/sesion/:id/resultados"
            element={
              <RutaProtegida>
                <Resultados />
              </RutaProtegida>
            }
          />
          <Route
            path="/admin/sesion/:id/calificar"
            element={
              <RutaProtegida>
                <CalificarSesion />
              </RutaProtegida>
            }
          />
          <Route
            path="/admin/preguntas"
            element={
              <RutaProtegida>
                <BancoPreguntas />
              </RutaProtegida>
            }
          />
          <Route
            path="/admin/preguntas/nueva"
            element={
              <RutaProtegida>
                <FormPregunta />
              </RutaProtegida>
            }
          />
          <Route
            path="/admin/preguntas/:id/editar"
            element={
              <RutaProtegida>
                <FormPregunta />
              </RutaProtegida>
            }
          />

          <Route
            path="/admin/ranking"
            element={
              <RutaProtegida>
                <Ranking />
              </RutaProtegida>
            }
          />
          <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />

          {/* ── Rutas Joven (públicas) ── */}
          <Route path="/examen/:sesionId" element={<Registro />} />
          <Route path="/examen/:sesionId/espera" element={<Espera />} />
          <Route path="/examen/:sesionId/preguntas" element={<Examen />} />
          <Route path="/examen/:sesionId/finalizado" element={<Finalizado />} />
        </Routes>
      </ExamenProvider>
    </BrowserRouter>
  )
}
