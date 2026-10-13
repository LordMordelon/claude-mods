import { expect, test } from 'claude-code/testing'

import type { Tarea } from '../types'
import { cambios } from './logica'

// Angel sigue las sesiones en la app y la web de Claude, que no dibujan el panel: el avance tiene que llegar al chat
// como lineas propias (las de $.ui.log se ven en todas las pantallas), una por cada cosa que cambia.

const base: Tarea = {
  numero: 112,
  titulo: 'Adjuntos que el comprador agrega después',
  repo: 'LordMordelon/licitaciones-vremia',
  criterios: ['Se baja al día siguiente', 'Una vez al día', 'Respeta el tope', 'La ficha lo muestra'],
  criteriosEstado: {},
  pasos: {},
  incidentes: [],
  reporte: null,
}

test('cambios: al empezar una tarea, una linea con su numero, titulo y cuantos criterios tiene', () => {
  expect(cambios(null, base)).toEqual(['📋 Tarea #112 · Adjuntos que el comprador agrega después · 4 criterios y 8 pasos de cierre'])
})

test('cambios: un criterio cumplido o que no se pudo, con su numero y el avance', () => {
  const uno = { ...base, criteriosEstado: { 1: 'hecho' as const } }
  expect(cambios(base, uno)).toEqual(['✅ Tarea #112 · Criterio 2 de 4: Una vez al día · criterios 1/4'])
  const otro = { ...uno, criteriosEstado: { ...uno.criteriosEstado, 2: 'no_se_pudo' as const } }
  expect(cambios(uno, otro)).toEqual(['❌ Tarea #112 · Criterio 3 de 4 no se pudo: Respeta el tope · criterios 1/4'])
})

test('cambios: un paso del cierre, bien o con falla; nada si no cambio', () => {
  const rama = { ...base, pasos: { rama: 'ok' as const } }
  expect(cambios(base, rama)).toEqual(['✅ Tarea #112 · Rama de la tarea · cierre 1/8'])
  expect(cambios(rama, rama)).toEqual([])
  const commit = { ...rama, pasos: { ...rama.pasos, commit: 'falla' as const } }
  expect(cambios(rama, commit)).toEqual(['❌ Tarea #112 · Commit: no se logró · cierre 1/8'])
})

test('cambios: el ultimo paso avisa que el cierre esta completo', () => {
  const casi = { ...base, pasos: { rama: 'ok', plan: 'ok', pruebas: 'ok', commit: 'ok', pr: 'ok', consumo: 'ok', ci: 'ok' } as Tarea['pasos'] }
  const listo = { ...casi, pasos: { ...casi.pasos, union: 'ok' as const } }
  expect(cambios(casi, listo)).toEqual([
    '✅ Tarea #112 · Unido o pedido de aprobación · cierre 8/8',
    '🏁 Tarea #112: cierre completo',
  ])
})

test('el avance llega al chat como lineas propias mientras se trabaja', async ($, on) => {
  const lineas: string[] = []
  on('ui.log', (_$, e) => {
    lineas.push(e.text)
    return { value: undefined } as never
  })
  on('tool.call', { tool: 'Bash' }, (_$, e) => ({
    result: { stdout: '', stderr: '', interrupted: false } as never,
    text: e.command.includes('run.php') ? 'Sintaxis: 3 archivos, 0 con errores\nPruebas: 5 bien, 0 fallidas' : '',
  }))
  await $.tool.call({ tool: 'Bash', command: 'git switch -c tarea/22-correos' })
  await $.tool.call({ tool: 'Bash', command: 'php tests/run.php' })
  expect(lineas.some(l => l.startsWith('📋 Tarea #22'))).toBe(true)
  expect(lineas).toContain('✅ Tarea #22 · Rama de la tarea · cierre 1/8')
  expect(lineas).toContain('✅ Tarea #22 · Pruebas en verde · cierre 2/8')
})

test('al escribir «tarea N» se abre el panel: es un pedido de la persona y se dibuja a cualquier ancho', async ($, on) => {
  const abiertos: string[] = []
  on('ui.open', (_$, e) => {
    abiertos.push((e as { id: string }).id)
    return { value: { isPlaced: true } } as never
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await $.prompt.submit({ text: 'tarea 112' } as never)
  expect(abiertos).toContain('tarea-progreso')
})

// El chat de VS Code es angosto: un panel que el mod abre solo espera una pantalla ancha. Cada mensaje de la persona lo
// trae a la vista (asi se dibuja a cualquier ancho), salvo que ya se vea o que ella lo haya cerrado a mano.
test('cada mensaje trae el panel a la vista si no se ve, y no lo reabre si ya se ve', async ($, on) => {
  const abiertos: string[] = []
  let seVe = false
  on('ui.open', (_$, e) => {
    abiertos.push((e as { id: string }).id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.panes', () => ({ value: seVe ? [{ id: 'tarea-progreso', isPlaced: true }] : [] }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }))

  await $.prompt.submit({ text: 'hola, ¿cómo va?' } as never)
  expect(abiertos).toEqual(['tarea-progreso'])

  seVe = true
  await $.prompt.submit({ text: 'sigue' } as never)
  expect(abiertos).toEqual(['tarea-progreso'])
})
