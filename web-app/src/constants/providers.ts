export const openAIProviderSettings = [
  {
    key: 'api-key',
    title: 'API Key',
    description:
      "The API key for your OpenAI-compatible endpoint.",
    controller_type: 'input',
    controller_props: {
      placeholder: 'Insert API Key',
      value: '',
      type: 'password',
      input_actions: ['unobscure', 'copy'],
    },
  },
  {
    key: 'base-url',
    title: 'Base URL',
    description:
      'The base endpoint of your OpenAI-compatible API (serving /chat/completions).',
    controller_type: 'input',
    controller_props: {
      placeholder: 'https://api.openai.com/v1',
      value: 'https://api.openai.com/v1',
    },
  },
]
