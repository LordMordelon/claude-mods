// tarea-progreso: la barra de avance de la tarea en curso (issue de GitHub) sobre el prompt, y un reporte para corregir
// CLAUDE.md cuando una accion que se esperaba no se logra. Sigue el flujo de las skills `tarea` y `cerrar-tarea`.

import type { EngineInterface, Register } from 'claude-code'

import type { Incidente, Tarea } from '../types'
import { PASOS, avance, barra, corto, criterios, esBloqueo, incidentePaso, leerComando, reporte, repositorio } from './logica'

const HERRAMIENTA = 'mcp__tarea-progreso__progreso'

/** El panel: lo dibujan todas las superficies, tambien el chat de VS Code (la banda sobre el prompt no). */
const PANEL = 'tarea-progreso'

/**
 * La tarea en curso. Vive en el modulo porque este build no deja leer $.state mientras se dibuja (y el kit de pruebas
 * no lo tiene); se copia en $.state cuando se puede, para reponerla si el modulo se recarga.
 */
let vista: Tarea | null = null

/** Guarda la tarea y redibuja el panel. */
async function guardar($: EngineInterface, tarea: Tarea): Promise<void> {
  vista = tarea
  $.ui.invalidate('ui.render')
  try {
    await $.state.set({ plugin: 'tarea-progreso', key: 'tarea' }, tarea)
  } catch {
    // Sin $.state, la copia del modulo basta para esta sesion.
  }
  // Entre conversaciones: un chat nuevo sigue mostrando la tarea en curso.
  await $.store.set('tarea', tarea).catch(() => undefined)
}

/** La tarea N recien empezada: su titulo y sus criterios, del issue. Sin gh o sin red, solo los pasos del cierre. */
async function cargarTarea($: EngineInterface, numero: number): Promise<Tarea> {
  let titulo = ''
  let lista: string[] = []
  let repo: string | null = null
  try {
    repo = repositorio((await $.process.run(['git', 'remote', 'get-url', 'origin'])).stdout)
    if (repo !== null) {
      const r = await $.process.run(['gh', 'api', `repos/${repo}/issues/${numero}`, '--jq', '{title, body}'], { timeoutMs: 20000 })
      const issue = JSON.parse(r.stdout) as { title?: string; body?: string }
      titulo = issue.title ?? ''
      lista = criterios(issue.body ?? '')
    }
  } catch {
    // La barra sigue igual, sin los criterios.
  }
  $.ui.toast(`Siguiendo la tarea #${numero}${lista.length > 0 ? ` (${lista.length} criterios)` : ''}`)
  return { numero, titulo, repo, criterios: lista, criteriosEstado: {}, pasos: {}, incidentes: [], reporte: null }
}

/** Escribe el reporte en storage/ (storage/* no se sube al repositorio). Devuelve la ruta, o null si no se pudo. */
async function escribirReporte($: EngineInterface, tarea: Tarea, ultimo: Incidente): Promise<string | null> {
  const nombre = `storage/reporte-claude-tarea-${tarea.numero}.md`
  try {
    await $.fs.write(`${await $.session.root()}/${nombre}`, reporte(tarea))
    $.ui.toast(`Incidente anotado: ${ultimo.esperado}. Reporte en ${nombre}`)
    return nombre
  } catch {
    $.ui.toast(`Incidente anotado: ${ultimo.esperado} (no se pudo escribir el reporte)`)
    return null
  }
}

/** La tarea de muestra de «/progreso demo». */
const EJEMPLO: Tarea = {
  numero: 0,
  titulo: 'Ejemplo: Correos de aviso',
  repo: null,
  criterios: ['Llega el aviso inmediato a Angel en modo de prueba', 'Resumen diario a las 8:00', 'Captura del correo revisada'],
  criteriosEstado: { 0: 'hecho', 1: 'no_se_pudo' },
  pasos: { rama: 'ok', plan: 'ok', pruebas: 'ok', commit: 'falla' },
  incidentes: [{
    cuando: 'ejemplo',
    esperado: 'Commit',
    paso: 'El paso «Commit» no se logró.',
    detalle: 'error: ejemplo',
    propuesta: 'Revisar qué impidió el commit (hook, identidad de git, archivos sin agregar).',
  }],
  reporte: 'storage/reporte-claude-tarea-0.md (ejemplo, no se escribe)',
}

/** Abre (o trae al frente) el panel de la tarea. Una superficie que no lo dibuja no es un error. */
function abrirPanel($: EngineInterface, numero: number | null): void {
  $.ui.open({ id: PANEL, title: numero === null ? 'Progreso de la tarea' : `Tarea #${numero}` }).catch(() => undefined)
}

async function hora($: EngineInterface): Promise<string> {
  return new Date(await $.clock.now()).toLocaleString('es-CL', { timeZone: 'America/Santiago' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.tool.register({
      name: 'progreso',
      description:
        'Marca un criterio de «Terminado cuando» de la tarea en curso (la barra de progreso de Angel). Llamarla al ' +
        'cumplir cada criterio, y con estado "no_se_pudo" y una nota cuando uno no se puede lograr: queda en el reporte ' +
        'para corregir CLAUDE.md. Los criterios van numerados desde 1, en el orden del issue.',
      inputSchema: {
        type: 'object',
        properties: {
          criterio: { type: 'integer', minimum: 1, description: 'Número del criterio, desde 1.' },
          estado: { type: 'string', enum: ['hecho', 'no_se_pudo'] },
          nota: { type: 'string', description: 'Por qué no se pudo (obligatoria con no_se_pudo).' },
        },
        required: ['criterio', 'estado'],
      },
      isDeferred: false,
    })
    await $.command.register({ name: 'progreso', description: 'Avance de la tarea en curso y su reporte', argumentHint: '[demo | limpiar]' })
    try {
      vista ??= (await $.state.get({ plugin: 'tarea-progreso', key: 'tarea' })).value ?? null
    } catch {
      // Sin $.state: se empieza sin tarea.
    }
    if (vista === null) {
      try {
        vista = ((await $.store.get('tarea')) as Tarea | undefined) ?? null
      } catch {
        // Sin store: se empieza sin tarea.
      }
    }
    // Siempre a la vista: el panel se abre en cada conversacion, con la tarea en curso o esperando una.
    abrirPanel($, vista?.numero ?? null)
    return r
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    try {
      const texto = ran.text ?? ran.deny ?? ''
      const conError = ran.deny !== undefined || ran.isError === true
      const nuevos: Incidente[] = []
      for (const l of leerComando(e.command, texto, conError)) {
        if (l.tipo === 'inicio') {
          const actual = vista
          if (actual === null || actual.numero !== l.numero) {
            const tarea = await cargarTarea($, l.numero)
            await guardar($, tarea)
            abrirPanel($, tarea.numero)
          }
        } else if (l.tipo === 'paso') {
          // Un paso que ya salio bien no vuelve a falla por un intento posterior (correr un grupo de pruebas, por ej.).
          const t = vista
          if (t !== null) {
            await guardar($, { ...t, pasos: { ...t.pasos, [l.paso]: l.ok || t.pasos[l.paso] === 'ok' ? 'ok' : 'falla' } })
          }
          if (!l.ok) {
            nuevos.push(incidentePaso(l.paso, l.detalle, await hora($)))
          }
        }
      }
      // Lo que la persona o un permiso no dejo hacer, durante una tarea, tambien va al reporte.
      if (conError && esBloqueo(texto)) {
        nuevos.push({
          cuando: await hora($),
          esperado: 'Comando permitido',
          paso: `No se dejó ejecutar: \`${corto(e.command).slice(0, 160)}\``,
          detalle: corto(texto),
          propuesta: 'Si la acción no debía pedirse, la tabla de Permisos de CLAUDE.md o `.claude/settings.json` debería decirlo.',
        })
      }
      const tarea = vista
      if (nuevos.length > 0 && tarea !== null) {
        const conIncidentes: Tarea = { ...tarea, incidentes: [...tarea.incidentes, ...nuevos] }
        const ruta = await escribirReporte($, conIncidentes, nuevos[nuevos.length - 1]!)
        await guardar($, { ...conIncidentes, reporte: ruta })
      }
    } catch {
      // El seguimiento nunca puede romper el comando: el resultado sale igual.
    }
    return ran
  })

  on('tool.call', { tool: HERRAMIENTA }, async ($, e) => {
    const entrada = e as unknown as { criterio?: number; estado?: string; nota?: string }
    const tarea = vista
    if (tarea === null) {
      return { result: 'No hay una tarea en curso: la barra empieza al crear la rama tarea/<N>-… o marcar la tarea en curso.' }
    }
    const i = (entrada.criterio ?? 0) - 1
    if (i < 0 || i >= tarea.criterios.length) {
      return { result: `La tarea #${tarea.numero} tiene ${tarea.criterios.length} criterios; el ${entrada.criterio} no existe.` }
    }
    const estado = entrada.estado === 'no_se_pudo' ? 'no_se_pudo' : 'hecho'
    let nueva: Tarea = { ...tarea, criteriosEstado: { ...tarea.criteriosEstado, [i]: estado } }
    if (estado === 'no_se_pudo') {
      const inc: Incidente = {
        cuando: await hora($),
        esperado: `Criterio ${i + 1}: ${tarea.criterios[i]}`,
        paso: entrada.nota !== undefined && entrada.nota !== '' ? entrada.nota : 'No se pudo cumplir (sin nota).',
        detalle: '',
        propuesta: 'Si el criterio no se puede cumplir así, cambiar la plantilla de tareas o la regla de «Terminado significa» en CLAUDE.md.',
      }
      nueva = { ...nueva, incidentes: [...nueva.incidentes, inc] }
      nueva = { ...nueva, reporte: await escribirReporte($, nueva, inc) }
    }
    await guardar($, nueva)
    const hechos = Object.values(nueva.criteriosEstado).filter(x => x === 'hecho').length
    return { result: `Criterio ${i + 1} marcado como ${estado}. Van ${hechos} de ${tarea.criterios.length}.` }
  })

  on('command.run', { command: 'progreso' }, async ($, e) => {
    const pedido = e.args.trim()
    // Para ver el panel sin empezar una tarea: datos de ejemplo, sin ramas ni GitHub. Una tarea real los reemplaza.
    if (pedido === 'demo') {
      await guardar($, EJEMPLO)
      abrirPanel($, EJEMPLO.numero)
      return { text: 'Panel de ejemplo abierto (tarea #0). «/progreso limpiar» lo quita; una tarea real lo reemplaza.' }
    }
    if (pedido === 'limpiar') {
      vista = null
      $.ui.invalidate('ui.render')
      await $.store.delete('tarea').catch(() => undefined)
      return { text: 'Sin tarea en curso.' }
    }
    const tarea = vista
    abrirPanel($, tarea?.numero ?? null)
    if (tarea === null) {
      return { text: 'No hay una tarea en curso. La barra empieza sola al crear la rama tarea/<N>-… (skill tarea).' }
    }
    const a = avance(tarea)
    const lineas = [
      `Tarea #${tarea.numero}${tarea.titulo !== '' ? ` · ${tarea.titulo}` : ''}`,
      `Cierre ${barra(a.hechos, a.total)} ${a.hechos}/${a.total}`,
      ...PASOS.map(p => `  ${tarea.pasos[p.id] === 'ok' ? '✓' : tarea.pasos[p.id] === 'falla' ? '✗' : '·'} ${p.nombre}`),
    ]
    if (tarea.criterios.length > 0) {
      lineas.push('Terminado cuando:')
      tarea.criterios.forEach((c, i) => {
        const s = tarea.criteriosEstado[i]
        lineas.push(`  ${s === 'hecho' ? '✓' : s === 'no_se_pudo' ? '✗' : '·'} ${i + 1}. ${c}`)
      })
    }
    lineas.push(tarea.incidentes.length === 0 ? 'Sin incidentes.' : `${tarea.incidentes.length} incidente(s): ${tarea.reporte ?? 'reporte sin escribir'}`)
    return { text: lineas.join('\n') }
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const tarea = vista
    if (tarea === null) {
      return <Text dimColor wrap="wrap">Sin tarea en curso. Empieza sola con «tarea N» (al crear la rama tarea/N-…). «/progreso demo» muestra un ejemplo.</Text>
    }
    const a = avance(tarea)
    const hechosCrit = Object.values(tarea.criteriosEstado).filter(x => x === 'hecho').length
    const marca = (s: string | undefined): string => (s === 'ok' || s === 'hecho' ? '✓' : s === 'falla' || s === 'no_se_pudo' ? '✗' : '·')
    const color = (s: string | undefined): string | undefined =>
      s === 'ok' || s === 'hecho' ? 'success' : s === 'falla' || s === 'no_se_pudo' ? 'error' : undefined
    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate">Tarea #{tarea.numero}{tarea.titulo !== '' ? ` · ${tarea.titulo}` : ''}</Text>
        <Text>
          <Text color={a.hechos === a.total ? 'success' : undefined}>{barra(a.hechos, a.total)}</Text>
          <Text dimColor> {a.hechos}/{a.total}{a.siguiente !== null ? ` · sigue: ${a.siguiente}` : ' · cierre completo'}</Text>
        </Text>
        {PASOS.map(p => (
          <Text key={p.id} color={color(tarea.pasos[p.id])} dimColor={tarea.pasos[p.id] === undefined}>
            {marca(tarea.pasos[p.id])} {p.nombre}
          </Text>
        ))}
        {tarea.criterios.length > 0 ? <Text bold>Terminado cuando ({hechosCrit}/{tarea.criterios.length})</Text> : null}
        {tarea.criterios.map((c, i) => (
          <Text key={`c${i}`} color={color(tarea.criteriosEstado[i])} dimColor={tarea.criteriosEstado[i] === undefined} wrap="wrap">
            {marca(tarea.criteriosEstado[i])} {i + 1}. {c}
          </Text>
        ))}
        {tarea.incidentes.length > 0 ? (
          <Text color="warning" wrap="wrap">
            ⚠ {tarea.incidentes.length} incidente{tarea.incidentes.length === 1 ? '' : 's'}: {tarea.reporte ?? 'reporte sin escribir'}
          </Text>
        ) : null}
      </Box>
    )
  })
}
