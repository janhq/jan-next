// Uses DSH's shared React and public slots; no client build step is required.
window.__ModuleLoader__.load({
  id: '@open-waifu/dsh-llamacpp',
  factory(require) {
    const React = require('react')
    const { Button, Input, Modal, RiskConfirmation, IconDownloadOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const PANEL_ID = 'ow-models'
    const emptyImport = { id: '', modelPath: '', mmprojPath: '', specDraftPath: '', specDraftKind: '' }
    const CSS = `
.ow-models{height:100%;min-height:0;overflow:auto;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-family:var(--dsh-font-family-text);font-size:14px}
.ow-models-inner{max-width:960px;margin:0 auto;padding:24px;display:flex;flex-direction:column;gap:20px}
.ow-models h1,.ow-models h2,.ow-models h3{margin:0;text-wrap:balance;font-weight:600}.ow-models h1{font-size:24px}.ow-models h2{font-size:18px}.ow-models h3{font-size:15px}
.ow-models p{margin:0;text-wrap:pretty}.ow-models .ow-muted,.ow-model-form .ow-muted{color:var(--dsw-alias-label-secondary);font-size:13px;overflow-wrap:anywhere}
.ow-models-header,.ow-models-row,.ow-models-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.ow-models-header{justify-content:space-between}.ow-models-actions{gap:8px}
.ow-models-nav{display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:12px}
.ow-models-list{list-style:none;padding:0;margin:0;display:grid;gap:12px}.ow-models-card{padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;display:grid;gap:12px;background:var(--dsw-alias-bg-layer-1)}
.ow-models-name{flex:1;min-width:0;display:grid;gap:4px;overflow-wrap:anywhere}.ow-models-stat{font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.ow-model-form{display:grid;gap:18px}.ow-model-field{display:grid;gap:6px;min-width:0}.ow-model-field>label,.ow-model-field>span:first-child{font-weight:500}.ow-model-field select{width:100%;box-sizing:border-box;min-height:36px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);font:inherit}
.ow-model-field input[type=range]{width:100%;accent-color:var(--dsw-alias-state-business-primary)}.ow-model-check{display:flex;align-items:center;gap:8px}.ow-model-check input{accent-color:var(--dsw-alias-state-business-primary)}
.ow-models-error{padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);overflow-wrap:anywhere}
.ow-models-empty{padding:24px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;display:grid;gap:12px;justify-items:start}.ow-models-files{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:12px}.ow-models-files li{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}.ow-models-files span{overflow-wrap:anywhere;min-width:0;flex:1}
.ow-models details summary{cursor:pointer;font-weight:500;overflow-wrap:anywhere}.ow-models details summary:focus-visible,.ow-model-field select:focus-visible,.ow-model-check input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:3px}.ow-models-note{padding:12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);display:grid;gap:6px}.ow-models dl{margin:0;display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 16px}.ow-models dd{margin:0;overflow-wrap:anywhere}
@media(max-width:600px){.ow-models-inner{padding:16px}.ow-models dl{grid-template-columns:1fr}.ow-models-row{align-items:flex-start}.ow-models-name{flex-basis:100%}}
`

    function errorText(error) {
      if (error instanceof Error) return error.message
      if (typeof error === 'string') return error
      if (error && typeof error.message === 'string') return error.message
      return JSON.stringify(error) || 'The request failed.'
    }

    async function api(method, params = {}) {
      const response = await fetch('/ow-api/llamacpp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params }),
      })
      let data
      try { data = await response.json() } catch { throw new Error(`The model service returned HTTP ${response.status} without a JSON response.`) }
      if (!response.ok || data.error != null) throw new Error(data.error != null ? errorText(data.error) : `HTTP ${response.status}`)
      return data.result
    }

    const ErrorNotice = ({ error, id }) => error ? h('p', { id, className: 'ow-models-error', role: 'alert' }, error) : null
    const Notice = ({ children }) => children ? h('p', { role: 'status', className: 'ow-muted' }, children) : null

    function Field({ label, name, value, onChange, hint, required = false, type = 'text', disabled = false }) {
      const id = React.useId()
      return h('div', { className: 'ow-model-field' },
        h('label', { htmlFor: id }, label),
        h(Input, { id, name, value, type, required, disabled, onChange: e => onChange(e.target.value), 'aria-describedby': hint ? `${id}-hint` : undefined }),
        hint ? h('p', { id: `${id}-hint`, className: 'ow-muted' }, hint) : null)
    }

    function SchemaField({ setting, value, onChange, disabled }) {
      const id = React.useId()
      const props = setting.controllerProps || {}
      const described = `${id}-description`
      const common = { id, disabled, 'aria-describedby': described }
      const description = [setting.description, setting.requireModelReload ? 'Reload the model for this change to take effect.' : ''].filter(Boolean).join(' ')
      let control
      if (setting.controllerType === 'checkbox') {
        control = h('label', { className: 'ow-model-check', htmlFor: id },
          h('input', { ...common, type: 'checkbox', checked: Boolean(value), onChange: e => onChange(e.target.checked) }), setting.title || setting.key)
      } else if (setting.controllerType === 'dropdown') {
        const options = props.options || []
        control = h('select', { ...common, value: value ?? '', onChange: e => onChange(e.target.value) },
          !options.some(option => String(option.value) === String(value ?? '')) ? h('option', { value: value ?? '' }, String(value ?? 'Default')) : null,
          options.map(option => h('option', { key: option.value, value: option.value }, option.name)))
      } else if (setting.controllerType === 'slider') {
        control = h('div', null,
          h('input', { ...common, type: 'range', min: props.min, max: props.max, step: props.step, value: value ?? props.min, onChange: e => onChange(Number(e.target.value)) }),
          h('output', { htmlFor: id, className: 'ow-models-stat' }, String(value ?? props.min)))
      } else {
        const array = Array.isArray(props.value)
        const numeric = props.type === 'number' || typeof props.value === 'number'
        control = h(Input, {
          ...common, type: numeric ? 'number' : props.type === 'password' ? 'password' : 'text',
          step: numeric ? 'any' : undefined, placeholder: props.placeholder,
          value: array ? (Array.isArray(value) ? value.join(', ') : value ?? '') : value ?? '',
          onChange: e => onChange(array ? e.target.value.split(',').map(item => item.trim()).filter(Boolean) : numeric && e.target.value !== '' ? Number(e.target.value) : e.target.value)
        })
      }
      return h('div', { className: 'ow-model-field' },
        setting.controllerType !== 'checkbox' ? h('label', { htmlFor: id }, setting.title || setting.key) : null,
        control, h('p', { id: described, className: 'ow-muted' }, description))
    }

    function SettingsForm({ modelId }) {
      const [schema, setSchema] = React.useState(null)
      const [values, setValues] = React.useState({})
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      const errorId = React.useId()
      React.useEffect(() => {
        let active = true
        setSchema(null)
        setError('')
        api(modelId ? 'modelSettings' : 'settings', modelId ? { id: modelId } : {}).then(result => {
          if (!active) return
          const fields = modelId ? result.settings : result
          if (!Array.isArray(fields)) throw new Error('The model service returned an invalid settings schema.')
          setSchema(fields)
          setValues(Object.fromEntries(fields.map(setting => [setting.key, setting.controllerProps?.value])))
        }).catch(error => { if (active) setError(errorText(error)) })
        return () => { active = false }
      }, [modelId])
      async function save(event) {
        event.preventDefault()
        setBusy(true)
        setError('')
        setNotice('')
        try {
          if (modelId) await api('updateModelSettings', { id: modelId, settings: values })
          else await api('saveSettings', { settings: schema.map(setting => ({ ...setting, controllerProps: { ...setting.controllerProps, value: values[setting.key] } })) })
          setNotice(modelId ? 'Model settings saved. Reload the model if a changed setting requires it.' : 'Engine settings saved.')
        } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
      }
      return h('form', { className: 'ow-model-form', onSubmit: save, 'aria-busy': busy || (!schema && !error), 'aria-describedby': error ? errorId : undefined },
        h(ErrorNotice, { error, id: errorId }),
        !schema && !error ? h(Notice, null, 'Loading settings…') : null,
        schema?.map(setting => h(SchemaField, { key: setting.key, setting, value: values[setting.key], disabled: busy, onChange: value => setValues(previous => ({ ...previous, [setting.key]: value })) })),
        schema?.length === 0 ? h('p', { className: 'ow-muted' }, 'No settings are available for this model.') : null,
        schema?.length ? h('div', { className: 'ow-models-actions' }, h(Button, { type: 'submit', variant: 'primary', disabled: busy }, busy ? 'Saving…' : 'Save settings')) : null,
        h(Notice, null, notice))
    }

    function ImportForm({ draft, setDraft, onStarted }) {
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [task, setTask] = React.useState('')
      const errorId = React.useId()
      const kindId = React.useId()
      async function pickFile(key) {
        setBusy(true)
        setError('')
        try {
          const result = await api('pickFile')
          const path = Array.isArray(result) ? result[0] : result
          if (typeof path === 'string' && path) {
            setDraft(previous => ({ ...previous, [key]: path }))
            setTask('')
          }
        } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
      }
      const field = (key, label, hint, required = false) => h('div', { key, className: 'ow-model-form' },
        h(Field, { label, name: key, hint, required, disabled: busy, value: draft[key], onChange: value => { setDraft(previous => ({ ...previous, [key]: value })); setTask('') } }),
        key !== 'id' ? h('div', { className: 'ow-models-actions' }, h(Button, { variant: 'outline', disabled: busy, onClick: () => pickFile(key) }, `Choose local ${key === 'modelPath' ? 'model' : key === 'mmprojPath' ? 'projector' : 'draft'} file`)) : null)
      async function submit(event) {
        event.preventDefault()
        setBusy(true)
        setError('')
        setTask('')
        try {
          const params = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value !== ''))
          const result = await api('import', params)
          const taskId = typeof result === 'string' ? result : result?.taskId || result?.id
          if (!taskId) throw new Error('The import service did not return a task id. Refresh installed models before retrying.')
          setTask(String(taskId))
          onStarted()
        } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
      }
      return h('form', { className: 'ow-model-form', onSubmit: submit, 'aria-busy': busy, 'aria-describedby': error ? errorId : undefined },
        h('h2', null, 'Import a GGUF model'),
        h('p', { className: 'ow-muted' }, 'Use a direct download URL or a local path on the computer running open-waifu. Imports run in the background.'),
        field('id', 'Model ID', 'A unique identifier for the installed model.', true),
        field('modelPath', 'Model URL or local path', 'For Hugging Face, use the file’s resolve/main URL. Local paths refer to the host computer.', true),
        field('mmprojPath', 'Vision projector URL or path (optional)', 'Use a projector compatible with the selected model.'),
        field('specDraftPath', 'Speculative draft URL or path (optional)', 'Use a draft compatible with the selected model.'),
        h('div', { className: 'ow-model-field' }, h('label', { htmlFor: kindId }, 'Speculative draft kind (optional)'),
          h('select', { id: kindId, value: draft.specDraftKind, disabled: busy, onChange: e => setDraft(previous => ({ ...previous, specDraftKind: e.target.value })) },
            h('option', { value: '' }, 'Detect from model'), h('option', { value: 'mtp' }, 'MTP'), h('option', { value: 'eagle3' }, 'EAGLE3'), h('option', { value: 'dflash' }, 'DFlash'), h('option', { value: 'dspark' }, 'DSpark'))),
        h(ErrorNotice, { error, id: errorId }),
        h('div', { className: 'ow-models-actions' }, h(Button, { type: 'submit', variant: 'primary', disabled: busy }, busy ? 'Starting import…' : 'Start import')),
        task ? h('div', { className: 'ow-models-note', role: 'status' }, h('p', null, 'Import started.'), h('p', { className: 'ow-muted ow-models-stat' }, `Task: ${task}`), h('p', { className: 'ow-muted' }, 'Refresh installed models to check whether the import has completed.')) : null)
    }

    function Catalog({ onImport }) {
      const [models, setModels] = React.useState(null)
      const [error, setError] = React.useState('')
      const [query, setQuery] = React.useState('')
      const [repoId, setRepoId] = React.useState('')
      const [repo, setRepo] = React.useState(null)
      const [repoBusy, setRepoBusy] = React.useState(false)
      const [repoError, setRepoError] = React.useState('')
      const [attempt, setAttempt] = React.useState(0)
      React.useEffect(() => {
        let active = true
        setError('')
        api('catalog').then(result => {
          if (!Array.isArray(result)) throw new Error('The model service returned an invalid catalog.')
          if (active) setModels(result)
        }).catch(error => { if (active) setError(errorText(error)) })
        return () => { active = false }
      }, [attempt])
      async function lookup(event) {
        event.preventDefault()
        setRepoBusy(true)
        setRepoError('')
        setRepo(null)
        try {
          const result = await api('hfRepo', { repoId: repoId.trim() })
          if (!result) throw new Error('Repository not found or unavailable.')
          setRepo(result)
        } catch (error) { setRepoError(errorText(error)) } finally { setRepoBusy(false) }
      }
      const files = (repo?.siblings || []).filter(file => /\.gguf$/i.test(file.rfilename))
      const downloadable = React.useMemo(() => (models || []).map(model => ({
        ...model,
        quants: (model.quants || []).filter(quant => typeof quant.model_id === 'string' && quant.model_id.trim() && typeof quant.path === 'string' && /^https?:\/\/.+\.gguf(?:[?#].*)?$/i.test(quant.path)),
      })).filter(model => model.quants.length > 0), [models])
      const filtered = downloadable.filter(model => `${model.display_name || ''} ${model.model_name} ${model.developer || ''}`.toLowerCase().includes(query.toLowerCase()))
      return h('div', { className: 'ow-model-form' },
        h('h2', null, 'Browse models'),
        h('form', { className: 'ow-models-card', onSubmit: lookup, 'aria-busy': repoBusy },
          h(Field, { label: 'Hugging Face repository', name: 'repoId', value: repoId, onChange: setRepoId, required: true, hint: 'Enter an owner/repository ID.' }),
          h('div', { className: 'ow-models-actions' }, h(Button, { type: 'submit', variant: 'outline', disabled: repoBusy }, repoBusy ? 'Looking up…' : 'Find GGUF files')),
          h(ErrorNotice, { error: repoError }),
          repo ? h('div', null, h('h3', null, repo.modelId || repo.id),
            repo.gated ? h('p', { className: 'ow-muted' }, 'This repository has access restrictions. Downloads may require access granted by Hugging Face.') : null,
            files.length ? h('ul', { className: 'ow-models-files' }, files.map(file => h('li', { key: file.rfilename },
              h('span', null, file.rfilename), h(Button, { variant: 'outline', size: 'sm', onClick: () => onImport({ id: `${repo.modelId || repo.id}/${file.rfilename.replace(/\.gguf$/i, '').replace(/[^a-zA-Z0-9._/-]/g, '-')}`, modelPath: `https://huggingface.co/${repo.modelId || repo.id}/resolve/main/${file.rfilename.split('/').map(encodeURIComponent).join('/')}` }) }, 'Import file')))) : h('p', { className: 'ow-muted' }, 'No GGUF files were found in this repository.')) : null),
        h(Field, { label: 'Filter catalog', name: 'catalogQuery', type: 'search', value: query, onChange: setQuery }),
        h(ErrorNotice, { error }),
        error ? h('div', null, h(Button, { variant: 'outline', onClick: () => setAttempt(value => value + 1) }, 'Retry catalog')) : null,
        !models && !error ? h(Notice, null, 'Loading catalog…') : null,
        models ? h('p', { className: 'ow-muted ow-models-stat', role: 'status' }, `${filtered.length} models`) : null,
        h('ul', { className: 'ow-models-list' }, filtered.map(model => h('li', { key: model.model_name, className: 'ow-models-card' },
          h('h3', null, model.display_name || model.model_name),
          h('p', { className: 'ow-muted' }, model.description),
          h('details', null, h('summary', null, `Available downloads (${model.quants.length})`),
            h('ul', { className: 'ow-models-files' }, model.quants.map(quant => h('li', { key: quant.path },
              h('span', null, quant.model_id, quant.file_size ? h('span', { className: 'ow-muted ow-models-stat' }, ` (${quant.file_size})`) : null),
              h(Button, { variant: 'outline', size: 'sm', onClick: () => onImport({ id: quant.model_id, modelPath: quant.path }) }, 'Download')))))))))
    }

    function ModelPanel() {
      const [tab, setTab] = React.useState('installed')
      const [models, setModels] = React.useState([])
      const [status, setStatus] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [deleting, setDeleting] = React.useState(null)
      const [acknowledged, setAcknowledged] = React.useState(false)
      const [editing, setEditing] = React.useState(null)
      const [draft, setDraft] = React.useState(emptyImport)
      const generation = React.useRef(0)
      const refresh = React.useCallback(async () => {
        const current = ++generation.current
        setLoading(true)
        setError('')
        try {
          const [list, info] = await Promise.all([api('list'), api('status')])
          if (!Array.isArray(list)) throw new Error('The model service returned an invalid installed model list.')
          if (generation.current !== current) return
          setModels(list)
          setStatus(info)
        } catch (error) { if (generation.current === current) setError(errorText(error)) }
        finally { if (generation.current === current) setLoading(false) }
      }, [])
      React.useEffect(() => { void refresh(); return () => { generation.current++ } }, [refresh])
      async function action(method, model) {
        setBusy(`${method}:${model.id}`)
        setError('')
        setNotice('')
        try {
          await api(method, { id: model.id })
          if (method === 'remove') setDeleting(null)
          setNotice(`${model.name || model.id}: ${method === 'load' ? 'loaded' : method === 'unload' ? 'unloaded' : 'deleted'}.`)
          await refresh()
        } catch (error) { setError(errorText(error)) } finally { setBusy('') }
      }
      const version = status?.version
      const versionText = typeof version === 'string' ? version : [version?.version, version?.tag].filter(Boolean).join(' ')
      const devices = status?.devices
      const deviceText = Array.isArray(devices) ? devices.map(device => typeof device === 'string' ? device : device.name || device.id).join(', ') : null
      function selectImport(values) { setDraft({ ...emptyImport, ...values }); setTab('import') }
      return h('section', { className: 'ow-models', 'aria-label': 'Local models' },
        h('div', { className: 'ow-models-inner' },
          h('header', { className: 'ow-models-header' }, h('div', { className: 'ow-models-name' }, h('h1', null, 'Local models'), h('p', { className: 'ow-muted' }, 'Manage GGUF models and the bundled llama.cpp engine.')),
            h(Button, { variant: 'outline', disabled: loading || Boolean(busy), onClick: refresh }, loading ? 'Refreshing…' : 'Refresh')),
          h('div', { className: 'ow-models-note' },
            h('p', { className: 'ow-models-stat' }, status ? (status.engine ? 'Engine available' : 'Engine stopped') : loading ? 'Checking engine…' : 'Engine status unavailable'),
            versionText ? h('p', { className: 'ow-muted ow-models-stat' }, `llama.cpp ${versionText}`) : null,
            deviceText ? h('p', { className: 'ow-muted' }, `Devices: ${deviceText}`) : null),
          h('nav', { className: 'ow-models-nav', 'aria-label': 'Model management sections' },
            [['installed', 'Installed'], ['import', 'Import model'], ['catalog', 'Catalog'], ['settings', 'Engine settings']].map(([key, label]) => h(Button, { key, variant: tab === key ? 'primary' : 'ghost', 'aria-current': tab === key ? 'page' : undefined, onClick: () => setTab(key) }, label))),
          h(ErrorNotice, { error }), h(Notice, null, notice),
          tab === 'installed' ? h('div', { className: 'ow-model-form', 'aria-busy': loading || Boolean(busy) },
            h('h2', null, 'Installed models'),
            loading ? h(Notice, null, 'Loading installed models…') : null,
            !loading && !error && models.length === 0 ? h('div', { className: 'ow-models-empty' }, h('p', null, 'No local models are installed.'), h(Button, { variant: 'primary', onClick: () => setTab('import') }, 'Import a model')) : null,
            h('ul', { className: 'ow-models-list' }, models.map(model => {
              const loaded = model.loaded === true
              return h('li', { key: model.id, className: 'ow-models-card' },
                h('div', { className: 'ow-models-row' }, h('div', { className: 'ow-models-name' }, h('h3', null, model.name || model.id), h('p', { className: 'ow-muted' }, model.id)),
                  h('span', { className: 'ow-muted' }, loaded ? 'Loaded' : 'Not loaded')),
                h('div', { className: 'ow-models-actions' },
                  h(Button, { variant: loaded ? 'outline' : 'primary', disabled: Boolean(busy) || loading, onClick: () => action(loaded ? 'unload' : 'load', model) }, busy === `load:${model.id}` ? 'Loading…' : busy === `unload:${model.id}` ? 'Unloading…' : loaded ? 'Unload' : 'Load'),
                  h(Button, { variant: 'outline', disabled: Boolean(busy), onClick: () => setEditing(model) }, 'Model settings'),
                  h(Button, { variant: 'ghost', disabled: Boolean(busy), onClick: () => { setDeleting(model); setAcknowledged(false) } }, 'Delete')))
            }))) : null,
          tab === 'import' ? h(ImportForm, { draft, setDraft, onStarted: () => { void refresh() } }) : null,
          tab === 'catalog' ? h(Catalog, { onImport: selectImport }) : null,
          tab === 'settings' ? h('div', { className: 'ow-model-form' }, h('h2', null, 'Engine settings'), h(SettingsForm, null)) : null),
        h(Modal, { open: Boolean(editing), onClose: () => setEditing(null), title: `Settings: ${editing?.name || editing?.id || ''}`, closeLabel: 'Close model settings' }, editing ? h(SettingsForm, { key: editing.id, modelId: editing.id }) : null),
        h(RiskConfirmation, {
          open: Boolean(deleting), title: 'Delete local model?',
          description: `Delete ${deleting?.name || deleting?.id || 'this model'} and its local model files? This cannot be undone.${error ? ` Error: ${error}` : ''}`,
          acknowledgeLabel: 'I understand that the local model files will be deleted.', cancelLabel: 'Cancel', closeLabel: 'Cancel deletion', confirmLabel: busy ? 'Deleting…' : 'Delete model',
          acknowledged, disabled: Boolean(busy), onAcknowledgedChange: setAcknowledged,
          onCancel: () => { if (!busy) setDeleting(null) }, onConfirm: () => { if (deleting) void action('remove', deleting) }
        }))
    }

    return {
      name: 'ow-llamacpp',
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.dataset.plugin = '@open-waifu/dsh-llamacpp'
        style.textContent = CSS
        document.head.append(style)
        ctx.effect(() => () => style.remove(), 'ow-llamacpp: styles')
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, ModelPanel))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 10, label: () => 'Local models' }, ({ size }) => h(IconDownloadOutlineRegular, { size, 'aria-hidden': true })))
      },
    }
  },
})
