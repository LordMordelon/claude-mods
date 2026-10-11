import { expect, test } from 'claude-code/testing'

/** El texto que se ve en un dibujo, por linea (cada Text de primer nivel es una linea). */
const texto = (nodo: unknown): string => {
  if (typeof nodo === 'string' || typeof nodo === 'number') {
    return String(nodo)
  }
  const n = nodo as { type?: string; children?: unknown[] } | null
  const hijos = (n?.children ?? []).map(texto).join('')
  return n?.type === 'Box' ? (n.children ?? []).map(texto).join('\n') : hijos
}

// El panel tiene que verse en el chat de VS Code (y en la terminal y el escritorio): la banda sobre el prompt no se
// dibuja en VS Code, el panel si.
for (const surface of ['vscode', 'terminal', 'desktop'] as const) {
  test(`el panel muestra la tarea y su avance (${surface})`, async ($, on) => {
    on('tool.call', { tool: 'Bash' }, (_$, e) => ({
      result: { stdout: '', stderr: '', interrupted: false } as never,
      text: e.command.includes('run.php') ? 'Sintaxis: 3 archivos, 0 con errores\nPruebas: 5 bien, 0 fallidas' : '',
    }))
    await $.tool.call({ tool: 'Bash', command: 'git switch -c tarea/22-correos' })
    await $.tool.call({ tool: 'Bash', command: 'php tests/run.php' })

    const panel = await $.ui.mount({
      plugin: 'tarea-progreso',
      surface,
      component: 'Pane',
      requestId: 'tarea-progreso',
      props: { title: 'Tarea #22', isFocused: false, bodyColumns: 80, placement: 'inline', scroll: {} as never, view: {} as never },
    })
    const dibujo = texto(await panel.drawn())
    expect(dibujo).toContain('Tarea #22')
    expect(dibujo).toContain('2/8')
    expect(dibujo).toContain('✓ Rama de la tarea')
    expect(dibujo).toContain('✓ Pruebas en verde')
    expect(dibujo).toContain('· Commit')
    expect(dibujo).toContain('sigue: Plan en la tarea')
  })
}

test('/progreso demo abre el panel con la tarea de ejemplo, sin tocar nada', async $ => {
  const r = await $.command.run({ command: 'progreso', args: 'demo' } as never)
  expect(String((r as { text?: string }).text)).toContain('ejemplo')
  const panel = await $.ui.mount({
    plugin: 'tarea-progreso', surface: 'vscode', component: 'Pane', requestId: 'tarea-progreso',
    props: { title: 'Tarea #0', isFocused: false, bodyColumns: 80, placement: 'inline', scroll: {} as never, view: {} as never },
  })
  const dibujo = texto(await panel.drawn())
  expect(dibujo).toContain('Tarea #0')
  expect(dibujo).toContain('✗ Commit')
  expect(dibujo).toContain('⚠ 1 incidente')
})

test('en la nube, marcar la tarea en curso en la rama de la sesion (claude/…) marca la rama', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } as never, text: '' }))
  on('process.run', (_$, e) => ({
    value: { exitCode: 0, stderr: '', stdout: e.argv.join(' ').includes('branch') ? 'claude/beautiful-wright-fxclpi\n' : '' },
  }) as never)
  on('ui.open', { id: 'tarea-progreso' }, () => ({ value: { isPlaced: true } }) as never)
  await $.tool.call({ tool: 'Bash', command: "gh api $R/issues/110/labels -f 'labels[]=en-curso'" })
  const r = await $.command.run({ command: 'progreso', args: '' } as never)
  expect(String((r as { text?: string }).text)).toContain('✓ Rama de la tarea')
})

test('/progreso dice por que el panel no se ve cuando la pantalla no lo dibuja', async ($, on) => {
  on('ui.open', { id: 'tarea-progreso' }, () => ({ value: { isPlaced: false, reason: 'la pantalla conectada no dibuja paneles' } }) as never)
  const r = await $.command.run({ command: 'progreso', args: 'demo' } as never)
  const t = String((r as { text?: string }).text)
  expect(t).toContain('Panel: no se ve en esta pantalla')
  expect(t).toContain('la pantalla conectada no dibuja paneles')
})
