---
name: demo
description: Shows what a skill receives from skill-args. Echoes its arguments and does nothing else.
arguments: [tone, topic]
argument-hint: "!tone <topic>"
disable-model-invocation: true
metadata:
  args:
    tone:
      question: Which tone?
      options:
        friendly: 😊 Warm and casual
        formal: 🎩 Polite and precise
    topic:
      question: What is it about?
---

Reply with exactly these three lines and do nothing else:

`tone=$tone topic=$topic`
`$0 | $1`
`$ARGUMENTS`
