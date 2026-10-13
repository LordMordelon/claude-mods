// tarea-progreso: el avance de la tarea en curso (issue de GitHub) en un panel del chat, y un reporte para corregir
// CLAUDE.md cuando una accion que se esperaba no se logra. Sigue el flujo de las skills `tarea` y `cerrar-tarea`.
// Esta siempre encendido; «/progreso apagar» (o el boton del panel) lo apaga hasta «/progreso encender».

import type { EngineInterface, Register } from 'claude-code'

import type { Incidente, Tarea } from '../types'
import { PASOS, avance, barra, cambios, comentario, corto, criterios, esBloqueo, incidentePaso, leerComando, ramaDeTarea, reporte, repositorio } from './logica'

const HERRAMIENTA = 'mcp__tarea-progreso__progreso'

/** El panel: lo dibujan todas las superficies, tambien el chat de VS Code (la banda sobre el prompt no). */
const PANEL = 'tarea-progreso'

/**
 * La tarea en curso. Vive en el modulo porque este build no deja leer $.state mientras se dibuja (y el kit de pruebas
 * no lo tiene); se copia en $.state cuando se puede, para reponerla si el modulo se recarga.
 */
let vista: Tarea | null = null

/** El interruptor: encendido salvo que la persona lo apague. Se recuerda entre conversaciones ($.store). */
let activo = true

/** La persona cerro el panel a mano: no se vuelve a abrir solo hasta la proxima tarea o «/progreso». */
let cerradoAMano = false

/** Por que el panel no se vio la ultima vez que «/progreso» lo pidio (null: se vio). Lo muestra la tarjeta. */
let motivoPanel: string | null = null

/** Si el panel se ve ahora. Mientras se ve, el avance va en el panel y no como lineas sueltas en el chat. */
async function panelVisible($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(p => p.id === PANEL && p.isPlaced)
  } catch {
    return false
  }
}

/**
 * Si el avance va tambien como lineas en el chat: cuando el panel no se ve en ninguna pantalla, y cuando hay un celular
 * conectado (#4), que no dibuja el panel aunque otra pantalla (la web, el escritorio) si lo tenga a la vista.
 */
async function avisarEnChat($: EngineInterface): Promise<boolean> {
  if (!(await panelVisible($))) {
    return true
  }
  try {
    return (await $.session.surfaces()).includes('mobile')
  } catch {
    return false
  }
}

/** Guarda la tarea en el estado de la sesion y entre conversaciones, sin redibujar ni avisar. */
async function persistir($: EngineInterface, tarea: Tarea): Promise<void> {
  try {
    await $.state.set({ plugin: 'tarea-progreso', key: 'tarea' }, tarea)
  } catch {
    // Sin $.state, la copia del modulo basta para esta sesion.
  }
  // Entre conversaciones: un chat nuevo sigue mostrando la tarea en curso.
  await $.store.set('tarea', tarea).catch(() => undefined)
}

/**
 * Guarda la tarea y redibuja. Donde el panel no se ve (la app de Claude en el celular, la web) deja en el chat una
 * linea por cada cosa que cambio, y deja el avance al dia en el comentario del issue, para que no se pierda.
 */
async function guardar($: EngineInterface, tarea: Tarea): Promise<void> {
  const antes = vista
  vista = tarea
  $.ui.invalidate('ui.render')
  if (await avisarEnChat($)) {
    for (const linea of cambios(antes, tarea)) {
      $.ui.log(linea)
    }
  }
  await persistir($, tarea)
  await publicar($)
}

/** Lo que se esta escribiendo en GitHub: un comentario a la vez, para no crear dos si el avance llega seguido. */
let publicando: Promise<void> = Promise.resolve()

/**
 * Deja el avance de la tarea en curso en un solo comentario de su issue (#4): lo crea la primera vez y despues lo edita
 * (editar no manda avisos). Sin gh, sin red o sin permiso, sigue todo igual: el comentario es una ayuda, no un paso.
 */
function publicar($: EngineInterface): Promise<void> {
  publicando = publicando.then(async () => {
    const t = vista
    if (!activo || t === null || t.repo === null || t.numero <= 0) {
      return
    }
    const cuerpo = comentario(t)
    try {
      if (t.comentario === undefined || t.comentario === null) {
        const r = await $.process.run(
          ['gh', 'api', `repos/${t.repo}/issues/${t.numero}/comments`, '-f', `body=${cuerpo}`, '--jq', '.id'], { timeoutMs: 20000 })
        const id = Number(r.stdout.trim())
        const actual = vista
        if (r.exitCode === 0 && Number.isInteger(id) && id > 0 && actual !== null && actual.numero === t.numero) {
          vista = { ...actual, comentario: id }
          await persistir($, vista)
        }
      } else {
        await $.process.run(
          ['gh', 'api', '-X', 'PATCH', `repos/${t.repo}/issues/comments/${t.comentario}`, '-f', `body=${cuerpo}`], { timeoutMs: 20000 })
      }
    } catch {
      // El comentario es una ayuda: si GitHub no responde, el panel y el chat siguen igual.
    }
  })
  return publicando
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

/**
 * Abre (o trae al frente) el panel de la tarea. El chat de VS Code es angosto: un panel que el mod abre solo espera una
 * pantalla ancha, pero uno abierto en respuesta a la persona (su mensaje, su comando, un boton) se ve a cualquier
 * ancho. Devuelve el motivo del motor cuando el panel queda abierto sin dibujar, o null si se ve.
 */
async function abrirPanel($: EngineInterface, numero: number | null): Promise<string | null> {
  try {
    const r = await $.ui.open({ id: PANEL, title: numero === null ? 'Progreso de la tarea' : `Tarea #${numero}` })
    return r.isPlaced ? null : r.reason
  } catch (error) {
    return `no se pudo abrir (${String(error)})`
  }
}

/** El interruptor. Apagado: se cierra el panel y no se sigue nada; encendido: vuelve el panel. */
async function cambiarActivo($: EngineInterface, valor: boolean): Promise<void> {
  activo = valor
  await $.store.set('activo', valor).catch(() => undefined)
  if (valor) {
    cerradoAMano = false
    void abrirPanel($, vista?.numero ?? null)
  } else {
    await $.ui.close({ id: PANEL }).catch(() => undefined)
  }
  $.ui.invalidate('ui.render')
}

/** La rama en que esta la carpeta, o '' si no se puede saber. */
async function ramaActual($: EngineInterface): Promise<string> {
  try {
    return (await $.process.run(['git', 'branch', '--show-current'])).stdout.trim()
  } catch {
    return ''
  }
}

async function hora($: EngineInterface): Promise<string> {
  return new Date(await $.clock.now()).toLocaleString('es-CL', { timeZone: 'America/Santiago' })
}

/** El texto de «/progreso» (lo que queda guardado en el chat y lee el modelo; la tarjeta se dibuja aparte). */
function resumen(tarea: Tarea): string {
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
  return lineas.join('\n')
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
    await $.command.register({
      name: 'progreso',
      description: 'Avance de la tarea en curso; apagar o encender el seguimiento',
      argumentHint: '[apagar | encender | demo | limpiar]',
    })
    try {
      activo = ((await $.store.get('activo')) as boolean | undefined) ?? true
    } catch {
      // Sin store: encendido.
    }
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
    // Abierto aqui espera una pantalla ancha; el primer mensaje de la persona lo pone a la vista (prompt.submit).
    if (activo) {
      void abrirPanel($, vista?.numero ?? null)
    }
    return r
  })

  // Cada mensaje de la persona trae el panel a la vista: abierto en respuesta a ella, se dibuja tambien en el chat
  // angosto de VS Code. «tarea N» lo abre siempre, aunque lo haya cerrado antes.
  on('prompt.submit', async ($, e, next) => {
    if (activo) {
      const pedido = /^\s*(?:toma (?:la )?)?tarea\s+(\d+)\b/i.exec(e.text)
      if (pedido !== null) {
        cerradoAMano = false
        void abrirPanel($, Number(pedido[1]))
      } else if (!cerradoAMano && !(await panelVisible($))) {
        void abrirPanel($, vista?.numero ?? null)
      }
    }
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANEL && e.origin.kind === 'person') {
      cerradoAMano = true
    }
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (!activo) {
      return ran
    }
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
            cerradoAMano = false
            void abrirPanel($, tarea.numero)
          }
          // En la nube la rama la trae la sesion y no se crea una tarea/N-…: si ya se esta en la rama de la tarea al
          // marcarla en curso, el paso esta hecho.
          const t = vista
          if (t !== null && t.pasos.rama !== 'ok' && ramaDeTarea(await ramaActual($), t.numero)) {
            await guardar($, { ...t, pasos: { ...t.pasos, rama: 'ok' } })
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
    if (!activo) {
      return { result: 'El seguimiento está apagado (Angel lo encendería con «/progreso encender»); no se marcó nada.' }
    }
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

  // El texto que devuelve queda guardado en el chat; en pantalla se dibuja la tarjeta (ui.render de CommandOutput).
  on('command.run', { command: 'progreso' }, async ($, e) => {
    const pedido = e.args.trim()
    if (pedido === 'apagar') {
      await cambiarActivo($, false)
      return { text: 'Seguimiento apagado. «/progreso encender» lo vuelve a encender.' }
    }
    if (pedido === 'encender') {
      await cambiarActivo($, true)
      return { text: 'Seguimiento encendido.' }
    }
    if (pedido === 'limpiar') {
      vista = null
      $.ui.invalidate('ui.render')
      await $.store.delete('tarea').catch(() => undefined)
      return { text: 'Sin tarea en curso.' }
    }
    if (!activo) {
      return { text: 'El seguimiento está apagado. «/progreso encender» lo vuelve a encender.' }
    }
    // Para ver el panel sin empezar una tarea: datos de ejemplo, sin ramas ni GitHub. Una tarea real los reemplaza.
    if (pedido === 'demo') {
      await guardar($, EJEMPLO)
    }
    cerradoAMano = false
    // Si la pantalla no dibuja el panel, se dice con el motivo del motor, para saber que arreglar.
    motivoPanel = await abrirPanel($, vista?.numero ?? null)
    const nota = motivoPanel === null ? '' : `\nPanel: no se ve en esta pantalla. Motivo: ${motivoPanel}`
    const tarea = vista
    if (tarea === null) {
      return { text: `No hay una tarea en curso. El seguimiento empieza solo con «tarea N» (skill tarea).${nota}` }
    }
    return { text: resumen(tarea) + nota }
  })

  // La salida de «/progreso» como tarjeta en el chat (todas las pantallas), con el interruptor a mano.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (e.props.command !== 'progreso' || e.props.isErrored) {
      return next(e)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const interruptor = activo
      ? <Button onPress={() => void cambiarActivo($, false)}>Apagar seguimiento</Button>
      : <Button variant="primary" onPress={() => void cambiarActivo($, true)}>Encender seguimiento</Button>
    const args = e.props.args.trim()
    if (!activo || args === 'apagar' || args === 'encender' || args === 'limpiar' || vista === null) {
      return (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Text>{activo ? '🟢' : '⚪'} {e.props.text}</Text>
          <Box marginTop={1}>{interruptor}</Box>
        </Box>
      )
    }
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        {tarjeta($, e, vista)}
        {motivoPanel !== null ? <Text color="warning" wrap="wrap">El panel no se ve en esta pantalla: {motivoPanel}</Text> : null}
        <Box marginTop={1} gap={1}>
          <Button variant="primary" onPress={() => void abrirPanel($, vista?.numero ?? null)}>Ver panel</Button>
          {interruptor}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    if (!activo) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Seguimiento apagado.</Text>
          <Button variant="primary" onPress={() => void cambiarActivo($, true)}>Encender seguimiento</Button>
        </Box>
      )
    }
    const tarea = vista
    return (
      <Box flexDirection="column">
        {tarea === null
          ? <Text dimColor wrap="wrap">Sin tarea en curso. Empieza sola con «tarea N». «/progreso demo» muestra un ejemplo.</Text>
          : tarjeta($, e, tarea)}
        <Box marginTop={1}>
          <Button onPress={() => void cambiarActivo($, false)}>Apagar seguimiento</Button>
        </Box>
      </Box>
    )
  })
}

/** El avance de la tarea, igual en el panel y en la tarjeta de «/progreso». */
function tarjeta($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], tarea: Tarea) {
  const { Box, Text } = $.ui.resolve(e)
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
}
