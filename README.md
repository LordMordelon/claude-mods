# claude-mods

Mods de Claude Code para los proyectos de Angel (Vremia).

## tarea-progreso

Un panel en el chat con el avance de la tarea en curso: los 8 pasos del cierre (rama, plan, pruebas, commit, PR,
reporte de consumo, pruebas de GitHub, unión) y los criterios de «Terminado cuando» del issue. Empieza solo al crear
la rama `tarea/N-…` o al marcar la tarea `en-curso`; en la nube, donde la sesión trae su propia rama (`claude/…`), esa
cuenta como la rama de la tarea. Si una acción esperada no se logra (pruebas rojas, PR que no se crea, un permiso negado, un
criterio que no se pudo), escribe `storage/reporte-claude-tarea-N.md` con una propuesta para corregir CLAUDE.md.

- **Siempre encendido, con interruptor:** `/progreso apagar` (o el botón «Apagar seguimiento» del panel o de la
  tarjeta) lo apaga: no sigue nada, no escribe reportes y cierra el panel. `/progreso encender` (o el botón) lo vuelve a
  encender. Se recuerda entre conversaciones.
- **El panel, a la vista en el chat de VS Code:** el chat es angosto y un panel que el mod abre solo espera una
  pantalla ancha; por eso cada mensaje de la persona lo trae a la vista (abierto en respuesta a ella, se dibuja a
  cualquier ancho). Si se cierra a mano, no vuelve solo hasta la próxima tarea («tarea N») o `/progreso`.
- **`/progreso` como tarjeta**, no como texto: el avance con colores y marcas, y los botones «Ver panel» y
  «Apagar seguimiento». `/progreso demo`: un ejemplo. `/progreso limpiar`: lo vacía.
- **Donde no hay panel** (la app y la web de Claude): una línea en el chat por cada avance, como «✅ Tarea #112 ·
  Criterio 2 de 4: Una vez al día · criterios 2/4», y «🏁 cierre completo» al final. Sale mientras el panel no se ve
  en ninguna pantalla y también **mientras haya un celular conectado**, que no dibuja el panel aunque la web o el
  escritorio sí lo tengan. Si el panel no se ve, la tarjeta de `/progreso` dice por qué, con el motivo que da Claude Code.
- **El avance en la tarea de GitHub:** un solo comentario en el issue, «Avance de la tarea #N», con los pasos del
  cierre y los criterios; se crea al empezar y después se edita solo (editar no manda avisos). Se ve desde cualquier
  celular, con o sin la app de Claude. Necesita `gh` con permiso para comentar; si no lo tiene, todo lo demás sigue
  igual. Apagado el seguimiento, no se escribe.

### Activarlo en un proyecto

En el `.claude/settings.json` del proyecto:

```json
{
  "extraKnownMarketplaces": {
    "claude-mods": { "source": { "source": "github", "repo": "LordMordelon/claude-mods" } }
  },
  "enabledPlugins": { "tarea-progreso@claude-mods": true }
}
```

### Revisarlo

```sh
claude plugin validate tarea-progreso
claude plugin test tarea-progreso
```
