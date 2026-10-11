import { expect, test } from 'claude-code/testing'

import type { Tarea } from '../types'
import { avance, barra, criterios, esBloqueo, incidentePaso, leerComando, ramaDeTarea, reporte, repositorio } from './logica'

const tarea = (pasos: Tarea['pasos'] = {}): Tarea => ({
  numero: 125, titulo: 'Cron fuera de la hora punta', repo: 'LordMordelon/licitaciones-vremia', criterios: ['a', 'b'],
  criteriosEstado: {}, pasos, incidentes: [], reporte: null,
})

test('la rama tarea/N-... empieza a seguir la tarea N y marca la rama', () => {
  const l = leerComando('git worktree add -q ../x-125 -b tarea/125-cron-fuera origin/main', '', false)
  expect(l).toEqual([{ tipo: 'inicio', numero: 125 }, { tipo: 'paso', paso: 'rama', ok: true, detalle: '' }])
  expect(leerComando('git switch -c tarea/22-correos', '', false)[0]).toEqual({ tipo: 'inicio', numero: 22 })
})

test('marcar la tarea en curso tambien la empieza; quitar la etiqueta no', () => {
  expect(leerComando("gh api $R/issues/121/labels -f 'labels[]=en-curso'", '', false)[0]).toEqual({ tipo: 'inicio', numero: 121 })
  expect(leerComando('gh api -X DELETE $R/issues/121/labels/en-curso', '', false)).toEqual([{ tipo: 'nada' }])
})

test('la rama de la tarea: la propia tarea/N-… o, en la nube, la que trae la sesion (claude/…)', () => {
  expect(ramaDeTarea('tarea/110-ficha-orden', 110)).toBe(true)
  expect(ramaDeTarea('claude/beautiful-wright-fxclpi\n', 110)).toBe(true)
  expect(ramaDeTarea('tarea/22-correos', 110)).toBe(false)
  expect(ramaDeTarea('main', 110)).toBe(false)
  expect(ramaDeTarea('', 110)).toBe(false)
})

test('pruebas: verde, fallidas y errores de sintaxis', () => {
  const verde = leerComando('php tests/run.php', 'Sintaxis: 128 archivos, 0 con errores (PHP 8.2.34)\nPruebas: 487 bien, 0 fallidas', false)
  expect(verde).toEqual([{ tipo: 'paso', paso: 'pruebas', ok: true, detalle: 'Pruebas: 487 bien, 0 fallidas' }])
  const rojo = leerComando('php tests/run.php', 'Pruebas: 469 bien, 3 fallidas', true)
  expect(rojo[0]).toEqual(expect.objectContaining({ paso: 'pruebas', ok: false }))
  const sintaxis = leerComando('php tests/run.php', 'Sintaxis: 128 archivos, 2 con errores', false)
  expect(sintaxis[0]).toEqual(expect.objectContaining({ paso: 'pruebas', ok: false }))
})

test('PR, consumo, pruebas de GitHub y union', () => {
  expect(leerComando('gh api $R/pulls -f title="X" -f head=t -f base=main --jq .number', '128', false)[0])
    .toEqual(expect.objectContaining({ paso: 'pr', ok: true }))
  expect(leerComando('python .claude/skills/reporte-consumo/consumo.py --tarea 1', 'Guardado en docs', false)[0])
    .toEqual(expect.objectContaining({ paso: 'consumo', ok: true }))
  expect(leerComando('gh api $R/commits/abc/check-runs', 'Pruebas completed success\nCambios completed success', false)[0])
    .toEqual(expect.objectContaining({ paso: 'ci', ok: true }))
  expect(leerComando('gh api $R/commits/abc/check-runs', 'Pruebas completed failure\nCambios completed success', false)[0])
    .toEqual(expect.objectContaining({ paso: 'ci', ok: false }))
  expect(leerComando('gh api $R/commits/abc/check-runs', 'Pruebas in_progress null\nCambios completed success', false)).toEqual([{ tipo: 'nada' }])
  expect(leerComando('gh api -X PUT $R/pulls/128/merge -f merge_method=squash', 'true', false)[0])
    .toEqual(expect.objectContaining({ paso: 'union', ok: true }))
})

test('pruebas parciales que fallan no son incidente (pruebas primero); la corrida completa si', () => {
  const salida = 'Pruebas: 66 bien, 1 fallidas'
  expect(leerComando('php tests/run.php Lector 2>&1 | tail -15', salida, false)).toEqual([{ tipo: 'nada' }])
  expect(leerComando('php tests/run.php Lector', 'Pruebas: 67 bien, 0 fallidas', false)[0])
    .toEqual(expect.objectContaining({ paso: 'pruebas', ok: true }))
  expect(leerComando('php tests/run.php 2>&1 | tail -3', salida, false)[0])
    .toEqual(expect.objectContaining({ paso: 'pruebas', ok: false }))
  expect(leerComando('php tests/run.php Lector', 'Sintaxis: 130 archivos, 1 con errores', false)[0])
    .toEqual(expect.objectContaining({ paso: 'pruebas', ok: false }))
})

test('union: GitHub dice que se unio aunque un comando encadenado falle (tarea #122)', () => {
  const salida = 'Exit code 1\ntrue\nPull Request successfully merged\nerror: unable to delete \'tarea/122-x\': remote ref does not exist'
  expect(leerComando('gh api -X PUT $R/pulls/135/merge -f merge_method=squash && git push origin --delete tarea/122-x', salida, true)[0])
    .toEqual(expect.objectContaining({ paso: 'union', ok: true }))
  expect(leerComando('gh api -X PUT $R/pulls/135/merge', 'Pull Request is not mergeable', true)[0])
    .toEqual(expect.objectContaining({ paso: 'union', ok: false }))
})

test('union: confirmarla despues con el estado del PR', () => {
  expect(leerComando("gh api $R/pulls/135 --jq '\"unido: \\(.merged)\"'", 'unido: true', false)[0])
    .toEqual(expect.objectContaining({ paso: 'union', ok: true }))
  // Todavia sin unir no es una falla: solo no dice nada.
  expect(leerComando('gh api $R/pulls/135 --jq .merged', 'false', false)).toEqual([{ tipo: 'nada' }])
})

test('pruebas de otros proyectos: el resultado lo da la salida del comando (#139)', () => {
  // Corrida completa: verde sin error, roja con error.
  expect(leerComando('python -m unittest discover -s analisis/pruebas', 'Ran 12 tests in 0.3s\n\nOK', false)[0])
    .toEqual(expect.objectContaining({ paso: 'pruebas', ok: true }))
  expect(leerComando('npm test', 'Tests: 1 failed, 20 passed', true)[0])
    .toEqual(expect.objectContaining({ paso: 'pruebas', ok: false }))
  expect(leerComando('vendor/bin/phpunit 2>&1 | tail -5', 'OK (40 tests, 90 assertions)', false)[0])
    .toEqual(expect.objectContaining({ paso: 'pruebas', ok: true }))
  expect(leerComando('pytest -q', '3 passed', false)[0]).toEqual(expect.objectContaining({ paso: 'pruebas', ok: true }))
  // Un grupo: verde cuenta; rojo no es incidente (pruebas primero).
  expect(leerComando('pytest tests/test_precio.py', '1 failed', true)).toEqual([{ tipo: 'nada' }])
  expect(leerComando('vendor/bin/phpunit --filter Precio', 'OK (3 tests)', false)[0])
    .toEqual(expect.objectContaining({ paso: 'pruebas', ok: true }))
  expect(leerComando('npm test -- precio', 'Tests: 1 failed', true)).toEqual([{ tipo: 'nada' }])
})

test('un comando cualquiera no dice nada', () => {
  expect(leerComando('ls -la', 'total 0', false)).toEqual([{ tipo: 'nada' }])
})

test('bloqueos: permiso negado', () => {
  expect(esBloqueo('Permission to use Bash with command rm -rf x has been denied.')).toBe(true)
  expect(esBloqueo('Pruebas: 3 bien, 0 fallidas')).toBe(false)
})

test('criterios de «Terminado cuando» del issue', () => {
  const cuerpo = '## Qué\nAlgo\n\n## Terminado cuando\n- Primero\n- [ ] Segundo\n* Tercero\n\n## Modelo sugerido\nOpus'
  expect(criterios(cuerpo)).toEqual(['Primero', 'Segundo', 'Tercero'])
  expect(criterios('sin seccion')).toEqual([])
})

test('repositorio desde origin', () => {
  expect(repositorio('https://github.com/LordMordelon/licitaciones-vremia.git\n')).toBe('LordMordelon/licitaciones-vremia')
  expect(repositorio('git@github.com:LordMordelon/plan.git')).toBe('LordMordelon/plan')
  expect(repositorio('https://gitlab.com/a/b.git')).toBe(null)
})

test('avance y barra', () => {
  const a = avance(tarea({ rama: 'ok', plan: 'ok', pruebas: 'falla' }))
  expect(a).toEqual({ hechos: 2, total: 8, siguiente: 'Pruebas en verde' })
  expect(barra(2, 8)).toBe('▰▰▱▱▱▱▱▱')
})

test('el reporte trae lo esperado, lo que paso y la propuesta para CLAUDE.md', () => {
  const t = { ...tarea(), incidentes: [incidentePaso('pruebas', 'Pruebas: 1 bien, 2 fallidas', '10-10-2026 15:00')] }
  const texto = reporte(t)
  expect(texto).toContain('# Reporte de la tarea #125')
  expect(texto).toContain('Pruebas en verde')
  expect(texto).toContain('Pruebas: 1 bien, 2 fallidas')
  expect(texto).toContain('Propuesta para CLAUDE.md')
})
