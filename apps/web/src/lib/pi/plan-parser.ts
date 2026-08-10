export type TodoItem = {
  step: number
  text: string
  completed: boolean
}

export function cleanStepText(text: string) {
  let cleaned = text
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(
      /^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
      ""
    )
    .replace(/\s+/g, " ")
    .trim()

  if (cleaned.length > 0) {
    cleaned = `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`
  }
  return cleaned.length > 50 ? `${cleaned.slice(0, 47)}...` : cleaned
}

export function extractTodoItems(message: string) {
  const items: Array<TodoItem> = []
  const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i)
  if (!headerMatch) return items

  const planSection = message.slice(
    message.indexOf(headerMatch[0]) + headerMatch[0].length
  )
  const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm

  for (const match of planSection.matchAll(numberedPattern)) {
    const text = match[2]
      .trim()
      .replace(/\*{1,2}$/, "")
      .trim()
    if (
      text.length > 5 &&
      !text.startsWith("`") &&
      !text.startsWith("/") &&
      !text.startsWith("-")
    ) {
      const cleaned = cleanStepText(text)
      if (cleaned.length > 3) {
        items.push({ step: items.length + 1, text: cleaned, completed: false })
      }
    }
  }
  return items
}

export function extractDoneSteps(message: string) {
  const steps: Array<number> = []
  for (const match of message.matchAll(/\[DONE:(\d+)\]/gi)) {
    const step = Number(match[1])
    if (Number.isFinite(step)) steps.push(step)
  }
  return steps
}

export function markCompletedSteps(text: string, items: Array<TodoItem>) {
  let changed = 0
  for (const step of extractDoneSteps(text)) {
    const item = items.find((todo) => todo.step === step)
    if (item && !item.completed) {
      item.completed = true
      changed += 1
    }
  }
  return changed
}
