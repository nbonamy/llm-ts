
import { Model } from '../../src/types/index.d'
import { vi, expect, test } from 'vitest'
import { loadOpenAIModels } from '../../src/llm'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import OpenAI from '../../src/providers/openai'
import Ollama from '../../src/providers/ollama'
import MistralAI from '../../src/providers/mistralai'
import Anthropic from '../../src/providers/anthropic'
import Google from '../../src/providers/google'
import XAI from '../../src/providers/xai'
import Groq from '../../src/providers/groq'
import Cerebras from '../../src/providers/cerebras'

const model = [{ id: 'llava:latest', name: 'llava:latest', meta: {} }]

vi.mock('openai', async() => {
  const OpenAI = vi.fn()
  OpenAI.prototype.apiKey = '123'
  OpenAI.prototype.models = {
    list: vi.fn(() => {
      return { data: [
        { id: 'gpt-model2', name: 'model2' },
        { id: 'gpt-model1', name: 'model1' },
        { id: 'dall-e-model2', name: 'model2' },
        { id: 'dall-e-model1', name: 'model1' },
      ] }
    })
  }
  return { default: OpenAI }
})

test('Default Configuration', () => {
  expect(OpenAI.isConfigured({})).toBe(false)
  expect(Ollama.isConfigured({})).toBe(true)
  expect(Anthropic.isConfigured({})).toBe(false)
  expect(Google.isConfigured({})).toBe(false)
  expect(XAI.isConfigured({})).toBe(false)
  expect(Groq.isConfigured({})).toBe(false)
  expect(Cerebras.isConfigured({})).toBe(false)
})

test('Valid Configuration', () => {
  expect(OpenAI.isConfigured({ apiKey: '123' })).toBe(true)
  expect(Ollama.isConfigured({})).toBe(true)
  expect(Anthropic.isConfigured({ apiKey: '123' })).toBe(true)
  expect(Google.isConfigured({ apiKey: '123' })).toBe(true)
  expect(XAI.isConfigured({ apiKey: '123' })).toBe(true)
  expect(Groq.isConfigured({ apiKey: '123' })).toBe(true)
  expect(Cerebras.isConfigured({ apiKey: '123' })).toBe(true)
})

test('Get Chat Models', async () => {
  const config = { apiKey: '123' }
  await loadOpenAIModels(config)
  const openai = new OpenAI(config)
  expect(openai.getChatModel()).toBe('gpt-model1')
  expect(openai.getChatModels().map((m: Model) => { return { id: m.id, name: m.name }})).toStrictEqual([
    { id: 'gpt-model1', name: 'gpt-model1' },
    { id: 'gpt-model2', name: 'gpt-model2' },
  ])
})

test('Find Models', async () => {
  const models = [
    { id: 'gpt-model1', name: 'gpt-model1', meta: {} },
    { id: 'gpt-model2', name: 'gpt-model2', meta: {} },
  ]
  const openai = new OpenAI({ apiKey: '123' })
  expect(openai.findModel(models, ['gpt-model'])).toBeNull()
  expect(openai.findModel(models, ['gpt-vision*'])).toBeNull()
  expect(openai.findModel(models, ['*']).id).toBe('gpt-model1')
  expect(openai.findModel(models, ['gpt-model2']).id).toBe('gpt-model2')
  expect(openai.findModel(models, ['gpt-model*']).id).toBe('gpt-model1')
  expect(openai.findModel(models, ['gpt-vision', '*gpt*2*']).id).toBe('gpt-model2')
})

test('Build payload no attachment', async () => {
  const openai = new OpenAI({ apiKey: '123' })
  expect(openai.buildPayload([], 'gpt-model1')).toStrictEqual([]) 
  expect(openai.buildPayload('content', 'gpt-model1')).toStrictEqual([{ role: 'user', content: 'content' }])
  expect(openai.buildPayload([
    new Message('system', { role: 'system', type: 'text', content: 'instructions' }),
    new Message('user', { role: 'user', type: 'text', content: 'prompt1' }),
    new Message('assistant', { role: 'assistant', type: 'image', content: 'response1' }), 
    new Message('user', { role: 'user', type: 'text', content: 'prompt2' }),
    new Message('assistant', { role: 'assistant', type: 'text', content: 'response2' }), 
  ], 'gpt-model1')).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: 'prompt1' },
    { role: 'user', content: 'prompt2' },
    { role: 'assistant', content: 'response2'}
  ])
})

test('Build payload with text attachment', async () => {
  const openai = new OpenAI({ apiKey: '123' })
  const messages = [
    new Message('system', { role: 'system', type: 'text', content: 'instructions' }),
    new Message('user', { role: 'user', type: 'text', content: 'prompt1' }),
  ]
  messages[1].attachFile(new Attachment('', 'text/plain', 'attachment', true))
  expect(openai.buildPayload(messages, 'gpt-model1')).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: 'prompt1\n\nattachment' },
  ])
})

test('Build payload with image attachment', async () => {
  const openai = new OpenAI({ apiKey: '123' })
  const messages = [
    new Message('system', { role: 'system', type: 'text', content: 'instructions' }),
    new Message('user', { role: 'user', type: 'text', content: 'prompt1' }),
  ]
  messages[1].attachFile(new Attachment('', 'image/png', 'attachment', true))
  expect(openai.buildPayload(messages, 'gpt-model1')).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: 'prompt1' },
  ])
  expect(openai.buildPayload(messages, 'gpt-4-vision')).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: [
      { type: 'text', text: 'prompt1' },
      { 'type': 'image_url', 'image_url': { 'url': 'data:image/png;base64,attachment' } },
    ]},
  ])
})
