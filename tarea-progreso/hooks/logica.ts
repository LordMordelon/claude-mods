// Lo que el mod entiende de los comandos de una tarea (flujo de las skills `tarea` y `cerrar-tarea`), sin tocar el
// motor: funciones puras, para poder probarlas.

import type { Incidente, PasoId, Tarea } from '../types'

/** Los pasos de «Terminado significa» (CLAUDE.md) en el orden en que la skill cerrar-tarea los hace. */
export const PASOS: readonly { id: PasoId; nombre: string; consejo: string }[] = [
  { id: 'rama', nombre: 'Rama de la tarea', consejo: 'Si la carpeta principal la usa otra sesión, trabajar en un `git worktree` aparte.' },
  { id: 'plan', nombre: 'Plan en la tarea', consejo: 'Dejar el plan como comentario antes del código; si es grande, esperar el «Aprobado».' },
  { id: 'pruebas', nombre: 'Pruebas en verde', consejo: 'Si la falla es del entorno (PHP, vendor/, base) y no del código, anotar en CLAUDE.md cómo prepararlo.' },
  { id: 'commit', nombre: 'Commit', consejo: 'Revisar qué impidió el commit (hook, identidad de git, archivos sin agregar).' },
  { id: 'pr', nombre: 'PR abierto', consejo: 'Revisar la rama subida y los permisos de `gh api`; la regla de GitHub solo por REST está en CLAUDE.md.' },
  { id: 'consumo', nombre: 'Reporte de consumo', consejo: 'Si el script no encuentra la sesión, pasarle la ruta del .jsonl (sesiones en paralelo).' },
  { id: 'ci', nombre: 'Pruebas de GitHub', consejo: 'Si se esperó con Monitor, confirmar al final con `gh api $R/commits/<sha>/check-runs` en Bash (el mod no ve los avisos de Monitor). Si falló, anotar qué prueba y si el flujo local no la detecta.' },
  { id: 'union', nombre: 'Unido o pedido de aprobación', consejo: 'Unir con un comando solo, sin encadenar otros; confirmarlo con `gh api $R/pulls/<PR> --jq .merged`. Si es grande, el mensaje de unión va como comentario del PR y se espera a Angel.' },
]

export type Lectura =
  | { tipo: 'inicio'; numero: number }
  | { tipo: 'paso'; paso: PasoId; ok: boolean; detalle: string }
  | { tipo: 'nada' }

/** Los comandos de pruebas de otros proyectos; `tests/run.php` (licitaciones) tiene su propio formato de salida. */
const PRUEBAS_OTRAS = /\b(python3?\s+-m\s+(unittest|pytest)|pytest|phpunit|artisan\s+test|(npm|pnpm|yarn)\s+(run\s+)?test|composer\s+test)\b/
/** Lo que dicen de una falla unittest, pytest, PHPUnit y Jest. */
const FALLAS = /\b[1-9]\d* (failed|failing)\b|\bFAILED\b|FAILURES!|ERRORS!/

/** Que dice un comando de Bash ya ejecutado sobre la tarea. `salida` es lo que leyo el modelo. */
export function leerComando(comando: string, salida: string, conError: boolean): Lectura[] {
  const lecturas: Lectura[] = []
  const rama = /(?:switch -c|checkout -b|worktree add\b[^\n]*?-b)\s+tarea\/(\d+)-/.exec(comando)
  const enCurso = /issues\/(\d+)\/labels\b[^\n]*en-curso/.exec(comando)
  if (rama !== null || (enCurso !== null && !/-X DELETE/.test(comando))) {
    lecturas.push({ tipo: 'inicio', numero: Number((rama ?? enCurso)![1]) })
  }
  if (rama !== null) {
    lecturas.push({ tipo: 'paso', paso: 'rama', ok: !conError, detalle: corto(salida) })
  }
  if (/issues\/\d+\/comments\b/.test(comando) && /-[fF] body/.test(comando)) {
    lecturas.push({ tipo: 'paso', paso: 'plan', ok: !conError, detalle: corto(salida) })
  }
  if (/tests\/run\.php/.test(comando)) {
    const pruebas = /Pruebas: (\d+) bien, (\d+) fallidas/.exec(salida)
    const sintaxis = /Sintaxis: \d+ archivos, (\d+) con errores/.exec(salida)
    const fallidas = pruebas === null ? null : Number(pruebas[2])
    const malas = sintaxis === null ? 0 : Number(sintaxis[1])
    // Correr solo un grupo (`run.php Algo`) tambien cuenta: el verde final lo confirma la corrida completa. Pero que un
    // grupo falle no es incidente: con «pruebas primero» la prueba nueva falla a proposito antes del codigo (#122).
    // Los errores de sintaxis si, porque se revisan todos los archivos igual.
    const parcial = /tests\/run\.php[ \t]+(?![0-9]?[>|&;])\S/.test(comando)
    const rojoBuscado = parcial && malas === 0 && fallidas !== null && fallidas > 0
    if ((fallidas !== null || malas > 0) && !rojoBuscado) {
      const ok = fallidas === 0 && malas === 0 && !conError
      lecturas.push({ tipo: 'paso', paso: 'pruebas', ok, detalle: ok ? corto(pruebas![0]) : corto(salida) })
    }
  } else if (PRUEBAS_OTRAS.test(comando)) {
    // Otros proyectos (#139): no hay un formato propio, asi que manda el codigo de salida y, como con `| tail` el codigo
    // es el del ultimo comando, tambien lo que la salida diga de fallas. Mismo criterio de grupo que arriba.
    const rojo = conError || FALLAS.test(salida)
    const parcial = /(--filter\b|\s-k\s|\s--\s+[^\s|;&>]|[^\s|;&>]*test[^\s|;&>]*\.(py|php|js|ts)\b|::)/i.test(comando)
    if (!(rojo && parcial)) {
      lecturas.push({ tipo: 'paso', paso: 'pruebas', ok: !rojo, detalle: corto(salida) })
    }
  }
  if (/\bgit\b[^\n|;&]*\bcommit\b/.test(comando)) {
    lecturas.push({ tipo: 'paso', paso: 'commit', ok: !conError, detalle: corto(salida) })
  }
  if (/\/pulls\b[^\n]*-f title=/.test(comando)) {
    lecturas.push({ tipo: 'paso', paso: 'pr', ok: !conError && /\d/.test(salida), detalle: corto(salida) })
  }
  if (/consumo\.py/.test(comando)) {
    lecturas.push({ tipo: 'paso', paso: 'consumo', ok: !conError && !/Traceback|No se encontr/i.test(salida), detalle: corto(salida) })
  }
  if (/check-runs/.test(comando) && /completed/.test(salida)) {
    const malo = /completed (failure|cancelled|timed_out|action_required)/.exec(salida)
    const pendiente = /\b(queued|in_progress)\b/.test(salida)
    if (malo !== null || !pendiente) {
      lecturas.push({ tipo: 'paso', paso: 'ci', ok: malo === null, detalle: corto(salida) })
    }
  }
  if (/pulls\/\d+\/merge/.test(comando)) {
    // Lo que manda es lo que respondio GitHub: si dice que se unio, se unio, aunque otro comando encadenado despues
    // (borrar la rama, que GitHub ya borro) haga terminar la orden con error (#122).
    const unido = /successfully merged/i.test(salida) || (!conError && /\btrue\b/.test(salida))
    lecturas.push({ tipo: 'paso', paso: 'union', ok: unido, detalle: corto(salida) })
  } else if (/pulls\/\d+(?![\d/])/.test(comando) && /\.merged\b/.test(comando) && /\btrue\b/.test(salida)) {
    // Confirmarla despues con el estado del PR; sin unir todavia no dice nada.
    lecturas.push({ tipo: 'paso', paso: 'union', ok: true, detalle: corto(salida) })
  }
  if (/issues\/\d+\/comments\b/.test(comando) && /[Mm]ensaje de uni[oó]n/.test(comando + salida)) {
    lecturas.push({ tipo: 'paso', paso: 'union', ok: !conError, detalle: 'Mensaje de unión dejado en el PR' })
  }
  return lecturas.length === 0 ? [{ tipo: 'nada' }] : lecturas
}

/** Un bloqueo: la persona o un permiso no dejo hacer algo. */
export function esBloqueo(texto: string): boolean {
  return /permission|denied|doesn't want to proceed|rejected|rechaz|bloque/i.test(texto)
}

/** Los criterios de la seccion «Terminado cuando» del cuerpo de la tarea. */
export function criterios(cuerpo: string): string[] {
  const seccion = /##\s*Terminado cuando\s*\n([\s\S]*?)(?:\n##\s|$)/.exec(cuerpo)
  if (seccion === null) {
    return []
  }
  return (seccion[1] ?? '')
    .split('\n')
    .map(l => /^\s*[-*]\s+(?:\[[ x]\]\s*)?(.+)$/.exec(l)?.[1]?.trim())
    .filter((c): c is string => c !== undefined && c !== '')
}

/** owner/repo desde la direccion de origin (https o ssh); null si no es de GitHub. */
export function repositorio(origen: string): string | null {
  return /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(origen.trim())?.[1] ?? null
}

/** Cuantos pasos van hechos y cual sigue. */
export function avance(tarea: Tarea): { hechos: number; total: number; siguiente: string | null } {
  const hechos = PASOS.filter(p => tarea.pasos[p.id] === 'ok').length
  const siguiente = PASOS.find(p => tarea.pasos[p.id] !== 'ok')?.nombre ?? null
  return { hechos, total: PASOS.length, siguiente }
}

export function barra(hechos: number, total: number): string {
  return '▰'.repeat(hechos) + '▱'.repeat(Math.max(0, total - hechos))
}

/** El reporte para corregir CLAUDE.md: que se esperaba, que paso y que cambiar. Sin claves: solo el texto ya visto. */
export function reporte(tarea: Tarea): string {
  const lineas = [
    `# Reporte de la tarea #${tarea.numero}: ${tarea.titulo}`,
    '',
    'Acciones que se esperaban y no se lograron. Cada una trae una propuesta para corregir CLAUDE.md (o AGENTS.md):',
    'revisarla con Angel antes de cambiar nada.',
    '',
  ]
  tarea.incidentes.forEach((inc, i) => {
    lineas.push(`## ${i + 1}. ${inc.esperado} (${inc.cuando})`, '', `- **Qué pasó:** ${inc.paso}`)
    if (inc.detalle !== '') {
      lineas.push('', '```', inc.detalle, '```')
    }
    lineas.push('', `- **Propuesta para CLAUDE.md:** ${inc.propuesta}`, '')
  })
  return lineas.join('\n')
}

export function incidentePaso(paso: PasoId, detalle: string, cuando: string): Incidente {
  const p = PASOS.find(x => x.id === paso)!
  return { cuando, esperado: p.nombre, paso: `El paso «${p.nombre}» no se logró.`, detalle, propuesta: p.consejo }
}

export function corto(texto: string): string {
  const limpio = texto.replace(/\r/g, '').trim()
  return limpio.length > 600 ? limpio.slice(0, 600) + '…' : limpio
}
