import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { Tarea } from '../types'
import { comentario } from './logica'

// Angel sigue las sesiones desde la app de Claude en el celular, que no dibuja el panel (#4). Dos caminos para que el
// avance llegue igual: las lineas del chat tambien cuando hay un celular conectado (aunque el panel se vea en otra
// pantalla, como la web), y un comentario en el issue de la tarea que se edita solo, que se ve desde cualquier celular.

const base: Tarea = {
  numero: 112,
  titulo: 'Adjuntos que el comprador agrega después',
  repo: 'LordMordelon/licitaciones-vremia',
  criterios: ['Se baja al día siguiente', 'Una vez al día'],
  criteriosEstado: { 0: 'hecho' },
  pasos: { rama: 'ok', plan: 'ok', pruebas: 'falla' },
  incidentes: [],
  reporte: null,
}

test('comentario: el avance en markdown, con los pasos, los criterios y lo que sigue', () => {
  const texto = comentario(base)
  expect(texto).toContain('### Avance de la tarea #112')
  expect(texto).toContain('2/8 · sigue: Pruebas en verde')
  expect(texto).toContain('✅ Rama de la tarea')
  expect(texto).toContain('❌ Pruebas en verde')
  expect(texto).toContain('⬜ Commit')
  expect(texto).toContain('**Terminado cuando** (1/2)')
  expect(texto).toContain('✅ 1. Se baja al día siguiente')
  expect(texto).toContain('⬜ 2. Una vez al día')
  expect(texto).not.toContain('incidente')
  expect(texto).toContain('tarea-progreso')
})

test('comentario: los incidentes con su reporte y el cierre completo', () => {
  const lista = {
    ...base,
    pasos: { rama: 'ok', plan: 'ok', pruebas: 'ok', commit: 'ok', pr: 'ok', consumo: 'ok', ci: 'ok', union: 'ok' } as Tarea['pasos'],
    incidentes: [{ cuando: 'hoy', esperado: 'x', paso: 'x', detalle: '', propuesta: 'x' }],
    reporte: 'storage/reporte-claude-tarea-112.md',
  }
  const texto = comentario(lista)
  expect(texto).toContain('8/8 · 🏁 cierre completo')
  expect(texto).toContain('⚠️ 1 incidente: `storage/reporte-claude-tarea-112.md`')
})

/** Los comandos que el mod corre, y gh que responde con el id del comentario al crearlo. */
const procesos = (on: On, corridos: string[][]) => {
  on('process.run', (_$, e) => {
    const argv = [...(e as { argv: readonly string[] }).argv]
    corridos.push(argv)
    const issue = argv[0] === 'gh' && argv.includes('repos/LordMordelon/licitaciones-vremia/issues/22')
    const crea = argv[0] === 'gh' && argv.some(a => a.endsWith('/issues/22/comments'))
    const stdout = argv[0] === 'git' && argv[1] === 'remote' ? 'https://github.com/LordMordelon/licitaciones-vremia.git\n'
      : issue ? JSON.stringify({ title: 'Correos', body: '## Terminado cuando\n- Llega el aviso\n- Sale el resumen\n' })
      : crea ? '9876\n'
      : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
}
const bash = (on: On) => {
  on('tool.call', { tool: 'Bash' }, (_$, e) => ({
    result: { stdout: '', stderr: '', interrupted: false } as never,
    text: e.command.includes('run.php') ? 'Sintaxis: 3 archivos, 0 con errores\nPruebas: 5 bien, 0 fallidas' : '',
  }))
}

test('con un celular conectado, el avance va al chat aunque el panel se vea en otra pantalla', async ($, on) => {
  const lineas: string[] = []
  on('ui.log', (_$, e) => {
    lineas.push(e.text)
    return { value: undefined } as never
  })
  on('ui.panes', () => ({ value: [{ id: 'tarea-progreso', isPlaced: true }] }) as never)
  on('session.surfaces', () => ({ value: ['desktop', 'mobile'] }) as never)
  procesos(on, [])
  bash(on)
  await $.tool.call({ tool: 'Bash', command: 'git switch -c tarea/22-correos' })
  await $.tool.call({ tool: 'Bash', command: 'php tests/run.php' })
  expect(lineas).toContain('✅ Tarea #22 · Pruebas en verde · cierre 2/8')
})

// Probado el 13-10-2026 en una sesion de la nube seguida desde el celular: ninguna pantalla conectada y, aun asi, el
// panel figuraba como dibujado. El mod creia que se veia y nunca escribia las lineas.
test('en la nube sin pantallas conectadas, el panel no cuenta como visto: el avance va al chat', async ($, on) => {
  const lineas: string[] = []
  on('ui.log', (_$, e) => {
    lineas.push(e.text)
    return { value: undefined } as never
  })
  on('ui.panes', () => ({ value: [{ id: 'tarea-progreso', isPlaced: true }] }) as never)
  on('session.surfaces', () => ({ value: [] }) as never)
  procesos(on, [])
  bash(on)
  await $.tool.call({ tool: 'Bash', command: 'git switch -c tarea/22-correos' })
  await $.tool.call({ tool: 'Bash', command: 'php tests/run.php' })
  expect(lineas).toContain('✅ Tarea #22 · Pruebas en verde · cierre 2/8')
})

test('sin celular y con el panel a la vista, el avance no se repite en el chat', async ($, on) => {
  const lineas: string[] = []
  on('ui.log', (_$, e) => {
    lineas.push(e.text)
    return { value: undefined } as never
  })
  on('ui.panes', () => ({ value: [{ id: 'tarea-progreso', isPlaced: true }] }) as never)
  on('session.surfaces', () => ({ value: ['terminal'] }) as never)
  procesos(on, [])
  bash(on)
  await $.tool.call({ tool: 'Bash', command: 'git switch -c tarea/22-correos' })
  await $.tool.call({ tool: 'Bash', command: 'php tests/run.php' })
  expect(lineas).toEqual([])
})

test('el avance queda en un solo comentario del issue: se crea una vez y despues se edita', async ($, on) => {
  const corridos: string[][] = []
  procesos(on, corridos)
  bash(on)
  await $.tool.call({ tool: 'Bash', command: 'git switch -c tarea/22-correos' })
  await $.tool.call({ tool: 'Bash', command: 'php tests/run.php' })
  await $.tool.call({ tool: 'mcp__tarea-progreso__progreso', criterio: 1, estado: 'hecho' } as never)

  const gh = corridos.filter(a => a[0] === 'gh' && a.some(x => x.includes('comments')))
  const creados = gh.filter(a => a.some(x => x.endsWith('/issues/22/comments')))
  const editados = gh.filter(a => a.includes('repos/LordMordelon/licitaciones-vremia/issues/comments/9876'))
  expect(creados.length).toBe(1)
  expect(editados.length).toBeGreaterThan(0)
  expect(editados.every(a => a.includes('PATCH'))).toBe(true)
  const ultimo = editados[editados.length - 1]!.find(x => x.startsWith('body='))!
  expect(ultimo).toContain('✅ Pruebas en verde')
  expect(ultimo).toContain('✅ 1. Llega el aviso')
})

test('apagado, no se escribe en GitHub', async ($, on) => {
  const corridos: string[][] = []
  procesos(on, corridos)
  bash(on)
  on('command.run', (_$, e) => ({ text: String((e as { args: string }).args) }) as never)
  await $.command.run({ command: 'progreso', args: 'apagar' } as never)
  await $.tool.call({ tool: 'Bash', command: 'git switch -c tarea/22-correos' })
  expect(corridos.some(a => a[0] === 'gh' && a.some(x => x.includes('comments')))).toBe(false)
  await $.command.run({ command: 'progreso', args: 'encender' } as never)
})
