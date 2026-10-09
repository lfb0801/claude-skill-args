# claude-skill-args

A Claude Code mod that gives user-invoked skills enumerated argument values.

A skill that sets `disable-model-invocation: true` and declares `metadata.args` in its SKILL.md frontmatter gets:

- `!value` arguments, written anywhere after the command. Plain words are the free-text argument.
- Autocomplete or clickable cards for the allowed values.
- A prompt for any required value you left out, before the skill runs.

The skill receives quoted positional arguments that match its native `arguments:` frontmatter, so it reads `$intensity`, `$focus` and `$target` as usual.

```
/demo !ruthless !scope the onboarding redesign
```

## Install

```
/plugin install skill-args --marketplace lfb0801/claude-skill-args
```

Answer `y` to add the marketplace, then choose a scope. Run this in a terminal session: the desktop Code tab does not offer `/plugin`, but a user-scope install also loads there.

## Authoring a skill

```yaml
arguments: [intensity, focus, target]
disable-model-invocation: true
metadata:
  args:
    intensity:
      question: How hard should it push?
      options:
        gentle: 🌱 Explore without much pressure
        ruthless: 🔥 Aggressively challenge every weakness
    focus:
      optional: true
      open: true
      options:
        scope: 🎯 Question what is in and what is out
    target:
      question: What should be grilled?
```

A full example is in [examples/demo/SKILL.md](examples/demo/SKILL.md). It is not installed as a command. To try it, copy it to `~/.claude/skills/demo/SKILL.md`.

Rules:

- At most one argument has no `options`. It holds the free text.
- Every argument is required unless it sets `optional: true`.
- `open: true` accepts values outside the list.
- An unknown `!value` fills the first empty open argument. If there is none, it counts as an invalid value for the first empty strict argument, which is then asked again. Otherwise it stays in the free text.
- A leading emoji in a description is shown only on desktop cards. Prefer single-codepoint emoji.
- Skills without `metadata.args` behave exactly as before.

Where skill files are found:

- Namespaced `plugin:name`: through the plugin's own root, or its `installPath` in `~/.claude/plugins/installed_plugins.json`.
- Plain names: through Claude's command list, then `.claude/skills/<name>/SKILL.md`, then `~/.claude/skills/<name>/SKILL.md`.

If the hook fails before it has read a skill's definition, the command runs untouched. If it fails after that, it refuses to run the command.

## Behaviour

| | Terminal | Desktop app (Code tab) |
|---|---|---|
| Suggestions while typing | Native autocomplete rows for `!values`, after the command and after each completed value. A compact clickable list appears above the prompt when the native menu has nothing to show. | No native autocomplete exists there. A band of clickable cards (emoji, value, description) follows what you type, including Tab completion. |
| Missing required value on submit | Asked through Claude's own question dialog. An invalid answer is asked again. Esc cancels and puts your text back in the prompt. | Picked from cards. |
| Missing free text on submit | Your text is put back in the prompt box. | Your text is put back in the prompt box. |

## Requirements

- Verified on Claude Code 2.1.293.
- Function hooks (`modules` in `hooks/hooks.json`) are early access and may change. Older CLIs ignore the module.

## Limitations

- The desktop app never calls the autocomplete hook, so the desktop uses cards instead.
- A band cannot take keyboard focus without ctrl+x tab, so keyboard selection goes through native autocomplete or the question dialog.
- Plugin skills are located through `~/.claude/plugins/installed_plugins.json`, an internal file whose format may change.
- On the desktop the prompt is read once every 500ms, which is how Tab completion is noticed.
- Install only one copy of this feature. A plugin that bundles its own copy, installed alongside this mod, would handle the same skill twice.

## Development

```
claude --plugin-dir .
claude plugin validate .
claude plugin test .
tsc -p .
```

`tsc` needs `.claude-plugin/types/`, which Claude Code generates when it loads the mod. It is gitignored.
