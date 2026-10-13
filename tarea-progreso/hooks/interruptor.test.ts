import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

// Angel trabaja en el chat de VS Code: «/progreso» tiene que verse como una tarjeta (no texto de terminal), y el
// seguimiento esta siempre encendido con un interruptor para apagarlo cuando no lo usa.

/** El texto que se ve en un dibujo, por linea (cada Text de primer nivel es una linea). */
const texto = (nodo: unknown): string => {
  if (typeof nodo === 'string' || typeof nodo === 'number') {
    return String(nodo)
  }
  const n = nodo as { type?: string; children?: unknown[] } | null
  const hijos = (n?.children ?? []).map(texto).join('')
  return n?.type === 'Box' ? (n.children ?? []).map(texto).join('\n') : hijos
}

/** Los botones de un dibujo, por su texto. */
const botones = (nodo: unknown): string[] => {
  const n = nodo as { type?: string; props?: { label?: string }; children?: unknown[] } | null
  if (n === null || typeof n !== 'object') {
    return []
  }
  return n.type === 'Button' ? [n.props?.label ?? ''] : (n.children ?? []).flatMap(botones)
}

const salida = (args: string, text: string) => ({
  plugin: 'tarea-progreso',
  surface: 'vscode' as const,
  component: 'CommandOutput' as const,
  requestId: `progreso-${args}`,
  props: { command: 'progreso', args, text, isErrored: false },
})

const bash = (on: On) =>
  on('tool.call', { tool: 'Bash' }, (_$, e) => ({
    result: { stdout: '', stderr: '', interrupted: false } as never,
    text: e.command.includes('run.php') ? 'Sintaxis: 3 archivos, 0 con errores\nPruebas: 5 bien, 0 fallidas' : '',
  }))

test('«/progreso» se dibuja como tarjeta en el chat de VS Code, con el avance y el interruptor', async ($, on) => {
  bash(on)
  await $.tool.call({ tool: 'Bash', command: 'git switch -c tarea/22-correos' })
  const r = await $.command.run({ command: 'progreso', args: '' } as never)

  const tarjeta = await $.ui.mount(salida('', String((r as { text?: string }).text)) as never)
  const dibujo = await tarjeta.drawn()
  expect(texto(dibujo)).toContain('Tarea #22')
  expect(texto(dibujo)).toContain('✓ Rama de la tarea')
  expect(botones(dibujo)).toEqual(['Ver panel', 'Apagar seguimiento'])
})

test('apagado no sigue nada, cierra el panel y la tarjeta ofrece encenderlo; encendido vuelve a seguir', async ($, on) => {
  bash(on)
  const cerrados: string[] = []
  on('ui.close', (_$, e) => {
    cerrados.push(e.id)
    return { value: undefined } as never
  })

  const apagado = await $.command.run({ command: 'progreso', args: 'apagar' } as never)
  expect(String((apagado as { text?: string }).text)).toContain('Seguimiento apagado')
  expect(cerrados).toContain('tarea-progreso')

  await $.tool.call({ tool: 'Bash', command: 'git switch -c tarea/30-otra' })
  const r = await $.command.run({ command: 'progreso', args: '' } as never)
  expect(String((r as { text?: string }).text)).toContain('apagado')
  const marca = await $.tool.call({ tool: 'mcp__tarea-progreso__progreso', criterio: 1, estado: 'hecho' } as never)
  expect(JSON.stringify(marca)).toContain('apagado')

  const tarjeta = await $.ui.mount(salida('', String((r as { text?: string }).text)) as never)
  expect(botones(await tarjeta.drawn())).toEqual(['Encender seguimiento'])

  await $.command.run({ command: 'progreso', args: 'encender' } as never)
  await $.tool.call({ tool: 'Bash', command: 'git switch -c tarea/31-de-nuevo' })
  const otra = await $.command.run({ command: 'progreso', args: '' } as never)
  expect(String((otra as { text?: string }).text)).toContain('Tarea #31')
})

test('apagado, el panel solo ofrece encenderlo y un mensaje no lo abre', async ($, on) => {
  const abiertos: string[] = []
  on('ui.open', (_$, e) => {
    abiertos.push((e as { id: string }).id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', () => ({ value: undefined }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }))

  await $.command.run({ command: 'progreso', args: 'apagar' } as never)
  abiertos.length = 0
  await $.prompt.submit({ text: 'hola' } as never)
  expect(abiertos).toEqual([])

  const panel = await $.ui.mount({
    plugin: 'tarea-progreso', surface: 'vscode', component: 'Pane', requestId: 'tarea-progreso',
    props: { title: 'Progreso', isFocused: false, bodyColumns: 80, placement: 'inline', scroll: {} as never, view: {} as never },
  })
  const dibujo = await panel.drawn()
  expect(texto(dibujo)).toContain('Seguimiento apagado')
  expect(botones(dibujo)).toEqual(['Encender seguimiento'])
  await $.command.run({ command: 'progreso', args: 'encender' } as never)
})


test('el boton «Apagar seguimiento» de la tarjeta apaga, y el de «Encender» enciende', async ($, on) => {
  bash(on)
  on('ui.close', () => ({ value: undefined }) as never)
  await $.tool.call({ tool: 'Bash', command: 'git switch -c tarea/22-correos' })
  const r = await $.command.run({ command: 'progreso', args: '' } as never)

  const tarjeta = await $.ui.mount(salida('', String((r as { text?: string }).text)) as never)
  await tarjeta.press({ key: 'Apagar seguimiento' })
  const apagado = await $.command.run({ command: 'progreso', args: '' } as never)
  expect(String((apagado as { text?: string }).text)).toContain('apagado')
  await tarjeta.unmount()

  const otra = await $.ui.mount(salida('', String((apagado as { text?: string }).text)) as never)
  await otra.press({ key: 'Encender seguimiento' })
  const encendido = await $.command.run({ command: 'progreso', args: '' } as never)
  expect(String((encendido as { text?: string }).text)).toContain('Tarea #22')
})
