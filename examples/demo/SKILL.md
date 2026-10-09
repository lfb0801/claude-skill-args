---
name: demo
description: Test fixture for the skill-args mod. Echoes its arguments and does nothing else.
arguments: [intensity, focus, target]
argument-hint: "!intensity [!focus] <target>"
disable-model-invocation: true
metadata:
  args:
    intensity:
      question: How hard should it push?
      options:
        gentle: 🌱 Explore without much pressure
        balanced: 🧭 Challenge important assumptions
        ruthless: 🔥 Aggressively challenge every weakness
    focus:
      question: What should it focus on?
      optional: true
      open: true
      options:
        scope: 🎯 Question what is in and what is out
        risks: 🚨 Hunt for what could go wrong
        alternatives: 🔀 Look for simpler ways to get there
    target:
      question: What should be grilled?
---

Reply with exactly this one line and do nothing else:

`demo: intensity="$intensity" focus="$focus" target="$target"`
