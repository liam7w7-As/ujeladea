import { lazy, Suspense } from 'react'
import LimitePantalla from './components/LimitePantalla'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ExamenProvider } from './context/ExamenContext'
import EtapaProvider from './context/EtapaProvider'
import RutaProtegida from './components/RutaProtegida'
import RutaEtapa from './components/RutaEtapa'
import ConfiguracionPendiente from './components/ConfiguracionPendiente'
import { supabaseConfigurado } from './lib/supabase'
const Login = lazy(() => import('./pages/admin/Login'))
const Etapas = lazy(() => import('./pages/admin/Etapas'))
const Dashboard = lazy(() => import('./pages/admin/Dashboard'))
const CrearSesion = lazy(() => import('./pages/admin/CrearSesion'))
const SalaEspera = lazy(() => import('./pages/admin/SalaEspera'))
const Resultados = lazy(() => import('./pages/admin/Resultados'))
const BancoPreguntas = lazy(() => import('./pages/admin/BancoPreguntas'))
const FormPregunta = lazy(() => import('./pages/admin/FormPregunta'))
const CalificarSesion = lazy(() => import('./pages/admin/CalificarSesion'))
const Ranking = lazy(() => import('./pages/admin/Ranking'))
const GestionSociedades = lazy(() => import('./pages/admin/GestionSociedades'))
const Registro = lazy(() => import('./pages/joven/Registro'))
const Espera = lazy(() => import('./pages/joven/Espera'))
const Examen = lazy(() => import('./pages/joven/Examen'))
const Finalizado = lazy(() => import('./pages/joven/Finalizado'))

function Protegida({ children, etapa = false, editar = false, sesion = false }) {
  return <RutaProtegida>{etapa ? <RutaEtapa editar={editar} sesion={sesion}>{children}</RutaEtapa> : children}</RutaProtegida>
}
export default function App() {
  if (!supabaseConfigurado) return <ConfiguracionPendiente />
  return <BrowserRouter><ExamenProvider><EtapaProvider><LimitePantalla><Suspense fallback={<div className="page-wrapper"><p role="status">Cargando pantalla…</p></div>}><Routes>
    <Route path="/" element={<Navigate to="/admin/login" replace />} />
    <Route path="/admin/login" element={<Login />} />
    <Route path="/admin/etapas" element={<Protegida><Etapas /></Protegida>} />
    <Route path="/admin/dashboard" element={<Protegida etapa><Dashboard /></Protegida>} />
    <Route path="/admin/sesion/nueva" element={<Protegida etapa editar><CrearSesion /></Protegida>} />
    <Route path="/admin/sesion/:id/espera" element={<Protegida etapa editar sesion><SalaEspera /></Protegida>} />
    <Route path="/admin/sesion/:id/resultados" element={<Protegida etapa sesion><Resultados /></Protegida>} />
    <Route path="/admin/sesion/:id/calificar" element={<Protegida etapa editar sesion><CalificarSesion /></Protegida>} />
    <Route path="/admin/preguntas" element={<Protegida etapa><BancoPreguntas /></Protegida>} />
    <Route path="/admin/preguntas/nueva" element={<Protegida etapa editar><FormPregunta /></Protegida>} />
    <Route path="/admin/preguntas/:id/editar" element={<Protegida etapa editar><FormPregunta /></Protegida>} />
    <Route path="/admin/ranking" element={<Protegida etapa><Ranking /></Protegida>} />
    <Route path="/admin/sociedades" element={<Protegida><GestionSociedades /></Protegida>} />
    <Route path="/admin" element={<Navigate to="/admin/etapas" replace />} />
    <Route path="/examen/:sesionId" element={<Registro />} />
    <Route path="/examen/:sesionId/espera" element={<Espera />} />
    <Route path="/examen/:sesionId/preguntas" element={<Examen />} />
    <Route path="/examen/:sesionId/finalizado" element={<Finalizado />} />
    <Route path="*" element={<Navigate to="/admin/etapas" replace />} />
  </Routes></Suspense></LimitePantalla></EtapaProvider></ExamenProvider></BrowserRouter>
}
