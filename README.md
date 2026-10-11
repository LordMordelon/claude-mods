# claude-mods

Mods de Claude Code para los proyectos de Angel (Vremia).

## tarea-progreso

Un panel en el chat con el avance de la tarea en curso: los 8 pasos del cierre (rama, plan, pruebas, commit, PR,
reporte de consumo, pruebas de GitHub, unión) y los criterios de «Terminado cuando» del issue. Empieza solo al crear
la rama `tarea/N-…` o al marcar la tarea `en-curso`; en la nube, donde la sesión trae su propia rama (`claude/…`), esa
cuenta como la rama de la tarea. Si una acción esperada no se logra (pruebas rojas, PR que no se crea, un permiso negado, un
criterio que no se pudo), escribe `storage/reporte-claude-tarea-N.md` con una propuesta para corregir CLAUDE.md.

- `/progreso`: abre el panel y escribe el avance en el chat. `/progreso demo`: un ejemplo. `/progreso limpiar`: lo vacía.
- Si la pantalla no dibuja el panel (una ventana angosta, o una app conectada a una sesión en la nube que no dibuja
  paneles), `/progreso` termina con «Panel: no se ve en esta pantalla. Motivo: …», con el motivo que da Claude Code.

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
