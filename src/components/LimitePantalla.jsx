import { Component } from 'react'

export default class LimitePantalla extends Component {
  state = { fallo: false }
  static getDerivedStateFromError() { return { fallo: true } }
  render() {
    if (this.state.fallo) return <div className="page-wrapper"><section className="card joven-estado" role="alert"><h1>No se pudo cargar esta pantalla</h1><p>Comprueba la conexión y vuelve a cargar. Las respuestas confirmadas se conservan en el servidor.</p><button className="btn btn-primary" onClick={() => window.location.reload()}>Volver a cargar</button></section></div>
    return this.props.children
  }
}
