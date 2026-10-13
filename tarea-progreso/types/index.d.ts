export type PasoId = 'rama' | 'plan' | 'pruebas' | 'commit' | 'pr' | 'consumo' | 'ci' | 'union'

/** Una accion que se esperaba y no se logro, con la propuesta para corregir CLAUDE.md. */
export type Incidente = {
  cuando: string
  esperado: string
  paso: string
  detalle: string
  propuesta: string
}

/** La tarea en curso: el issue de GitHub, sus criterios de «Terminado cuando» y los pasos del cierre. */
export type Tarea = {
  numero: number
  titulo: string
  repo: string | null
  criterios: string[]
  /** Por criterio (indice): 'hecho' o 'no_se_pudo'; los que faltan, pendientes. */
  criteriosEstado: Record<number, 'hecho' | 'no_se_pudo'>
  pasos: Partial<Record<PasoId, 'ok' | 'falla'>>
  incidentes: Incidente[]
  /** Donde quedo el reporte, cuando hay incidentes. */
  reporte: string | null
  /** El comentario del issue con el avance (#4), una vez creado; las tareas guardadas antes no lo traen. */
  comentario?: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'tarea-progreso': { tarea: Tarea | null }
  }
}
