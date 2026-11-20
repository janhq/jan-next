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
        'waiting.title': 'Jan needs your input',
        'waiting.body': '{name} is waiting for you.',
        untitled: 'Untitled chat',
        'toast.failed': '{name} stopped with an error.',
        'toast.open': 'Open',
        'settings.title': 'Desktop notifications',
        'settings.description': 'Notify you when Jan is in the background or the chat is not open.',
        'settings.finished': 'Task finished',
        'settings.failed': 'Task failed',
        'settings.waiting': 'Waiting for you',
        'settings.waitingDescription': 'Approvals, plan reviews and questions.',
        'settings.error': 'The setting could not be saved.',
      },
    } }
  },
})
