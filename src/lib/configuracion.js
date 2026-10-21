export function configuracionPublicaValida(url, key) {
  try {
    const destino = new URL(url)
    if (!['http:', 'https:'].includes(destino.protocol) || !destino.hostname || typeof key !== 'string') return false
    if (key.startsWith('sb_publishable_')) return key.length > 'sb_publishable_'.length
    // Las claves anon heredadas son JWT. Una clave service_role nunca pertenece al navegador.
    const segmento = key.split('.')[1]
    if (!segmento) return false
    const claims = JSON.parse(atob(segmento.replaceAll('-', '+').replaceAll('_', '/')))
    return claims.role === 'anon'
  } catch { return false }
}
