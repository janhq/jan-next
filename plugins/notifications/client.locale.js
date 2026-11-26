window.__ModuleLoader__.load({
  id: '@janhq/jan-notifications',
  chunk: 'client.locale.js',
  factory() {
    return { dictionaries: {
      en: {
        'finished.title': 'Jan finished the task',
        'finished.body': '{name} is ready.',
        'failed.title': 'Jan task failed',
        'failed.body': '{name} stopped with an error.',
        'waiting.title': 'Jan needs your action',
        'waiting.body': '{name} is waiting for your decision.',
        'input.title': 'Jan has a question',
        'input.body': '{name} is waiting for your answer.',
        untitled: 'Untitled chat',
        'toast.failed': '{name} stopped with an error.',
        'toast.open': 'Open',
        'settings.title': 'Desktop notifications',
        'settings.description': 'Notify you when Jan is in the background or the chat is not open.',
        'settings.finished': 'Task finished',
        'settings.failed': 'Task failed',
        'settings.waiting': 'Needs your action',
        'settings.waitingDescription': 'Approvals and plan reviews.',
        'settings.input': 'Needs your input',
        'settings.inputDescription': 'Questions the agent asks you.',
        'settings.error': 'The setting could not be saved.',
      },
    } }
  },
})
