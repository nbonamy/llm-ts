
import { EngineConfig } from 'types/index.d'
import { LLmCompletionPayload, LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmToolCall } from 'types/llm.d'
import Attachment from '../models/attachment'
import Message from '../models/message'
import LlmEngine from '../engine'

import { Content, EnhancedGenerateContentResponse, GenerativeModel, GoogleGenerativeAI, ModelParams, Part, FunctionResponsePart, SchemaType, FunctionDeclarationSchemaProperty, FunctionCallingMode } from '@google/generative-ai'
import type { FunctionDeclaration } from '@google/generative-ai/dist/types'

export default class extends LlmEngine {

  client: GoogleGenerativeAI
  currentModel: GenerativeModel
  currentContent: Content[]
  toolCalls: LlmToolCall[]

  constructor(config: EngineConfig) {
    super(config)
    this.client = new GoogleGenerativeAI(
      config.apiKey,
    )
  }

  getName(): string {
    return 'google'
  }

  getVisionModels(): string[] {
    return ['gemini-1.5-flash-latest', 'models/gemini-1.5-pro-latest', 'models/gemini-pro-vision', '*vision*']
  }

  async getModels(): Promise<any[]> {

    // need an api key
    if (!this.client.apiKey) {
      return null
    }

    // do it
    return [
      { id: 'models/gemini-1.5-pro-latest', name: 'Gemini 1.5 Pro' },
      { id: 'gemini-1.5-flash-latest', name: 'Gemini  1.5 Flash' },
      { id: 'models/gemini-pro', name: 'Gemini 1.0 Pro' },
      //{ id: 'models/gemini-pro-vision', name: 'Gemini Pro Vision' },
    ]
  }


  async complete(thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // call
    const modelName = opts?.model || this.config.model.chat
    console.log(`[google] prompting model ${modelName}`)
    const model = await this.getModel(modelName, thread[0].content)
    const response = await model.generateContent({
      contents: this.threadToHistory(thread, modelName),
    })

    // done
    return {
      type: 'text',
      content: response.response.text()
    }
  }

  async stream(thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStream> {

    // model: switch to vision if needed
    const modelName = this.selectModel(thread, opts?.model || this.getChatModel())

    // call
    this.currentModel = await this.getModel(modelName, thread[0].content)
    this.currentContent = this.threadToHistory(thread, modelName)
    return await this.doStream()

  }

  async doStream(): Promise<LlmStream> {

    // reset
    this.toolCalls = []

    console.log(`[google] prompting model ${this.currentModel.model}`)
    const response = await this.currentModel.generateContentStream({
      contents: this.currentContent
    })

    // done
    return response.stream

  }

  private modelStartsWith(model: string, prefix: string[]): boolean {
    for (const p of prefix) {
      if (model.startsWith(p)) {
        return true
      }
    }
    return false
  }

  private supportsInstructions(model: string): boolean {
    return this.modelStartsWith(model, ['models/gemini-pro']) == false
  }

  private supportsTools(model: string): boolean {
    return this.modelStartsWith(model, ['gemini-1.5-flash']) == false
  }

   
  async getModel(model: string, instructions: string): Promise<GenerativeModel> {

    // model params
    const modelParams: ModelParams = {
      model: model,
    }

    // add instructions
    if (this.supportsInstructions(model)) {
      modelParams.systemInstruction = instructions
    }

    // add tools
    if (this.supportsTools(model)) {

      const tools = await this.getAvailableTools();
      if (tools.length) {
      
        const functionDeclarations: FunctionDeclaration[] = [];

        for (const tool of tools) {

          const googleProps: { [k: string]: FunctionDeclarationSchemaProperty } = {};
          for (const name of Object.keys(tool.function.parameters.properties)) {
            const props = tool.function.parameters.properties[name]
            const type = props.type === 'string' ? SchemaType.STRING : props.type === 'number' ? SchemaType.NUMBER : SchemaType.OBJECT
            googleProps[name] = {
              type: type,
              enum: props.enum,
              description: props.description,
            }
          }

          functionDeclarations.push({
            name: tool.function.name,
            description: tool.function.description,
            parameters: {
              type: SchemaType.OBJECT,
              properties: googleProps,
              required: tool.function.parameters.required,
            }
          })
        }

        // done
        modelParams.toolConfig = { functionCallingConfig: { mode: FunctionCallingMode.AUTO } }
        modelParams.tools = [{ functionDeclarations: functionDeclarations }]

      }
    }

    // call
    return this.client.getGenerativeModel( modelParams, {
      apiVersion: 'v1beta'
    })
  }

  getPrompt(thread: Message[]): Array<string | Part> {
    
    // init
    const prompt = []
    const lastMessage = thread[thread.length-1]

    // content
    prompt.push(lastMessage.content)

    // attachment
    if (lastMessage.attachment) {
      this.addAttachment(prompt, lastMessage.attachment)
    }

    // done
    return prompt
  } 

  threadToHistory(thread: Message[], modelName: string): Content[] {
    const hasInstructions = this.supportsInstructions(modelName)
    const payload = this.buildPayload(thread.slice(hasInstructions ? 1 : 0), modelName).map((p) => {
      if (p.role === 'system') p.role = 'user'
      return p
    })
    return payload.map((message) => this.messageToContent(message))
  }

  messageToContent(payload: LLmCompletionPayload): Content {
    const content: Content = {
      role: payload.role == 'assistant' ? 'model' : payload.role,
      parts: [ { text: payload.content } ]
    }
    for (const index in payload.images) {
      content.parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: payload.images[index],
        }
      })
    }
    return content
  }

  addAttachment(parts: Array<string | Part>, attachment: Attachment) {

    // load if no contents
    if (!attachment.contents) {
      throw new Error('Attachment contents not loaded')
    }
  
    // add inline
    if (attachment.isImage()) {
      parts.push({
        inlineData: {
          mimeType: attachment.mimeType,
          data: attachment.contents,
        }
      })
    } else if (attachment.isText()) {
      parts.push(attachment.contents)
    }

  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async stop(stream: AsyncGenerator<any>) {
    //await stream?.controller?.abort()
  }

   
  async *nativeChunkToLlmChunk(chunk: EnhancedGenerateContentResponse): AsyncGenerator<LlmChunk, void, void> {

    // tool calls
    const toolCalls = chunk.functionCalls()
    if (toolCalls?.length) {

      // save
      this.toolCalls = toolCalls.map((tc) => {
        return {
          id: tc.name,
          message: '',
          function: tc.name,
          args: JSON.stringify(tc.args),
        }
      })

      // results
      const results: FunctionResponsePart[] = []

      // call
      for (const toolCall of this.toolCalls) {

        // first notify
        yield {
          type: 'tool',
          text: this.getToolPreparationDescription(toolCall.function),
          done: false
        }

        // first notify
        yield {
          type: 'tool',
          text: this.getToolRunningDescription(toolCall.function),
          done: false
        }

        // now execute
        const args = JSON.parse(toolCall.args)
        const content = await this.callTool(toolCall.function, args)
        console.log(`[google] tool call ${toolCall.function} with ${JSON.stringify(args)} => ${JSON.stringify(content).substring(0, 128)}`)

        // send
        results.push({ functionResponse: {
          name: toolCall.function,
          response: content
        }})

        // clear
        yield {
          type: 'tool',
          done: true,
        }

      }

      // send
      this.currentContent.push({
        role: 'tool',
        parts: results
      })

      // switch to new stream
      yield {
        type: 'stream',
        stream: await this.doStream(),
      }
      
      // done
      return

    }

    // text chunk
    yield {
      type: 'content',
      text: chunk.text() || '',
      done: chunk.candidates[0].finishReason === 'STOP'
    }
  }

   
  addImageToPayload(message: Message, payload: LLmCompletionPayload) {
    payload.images = [ message.attachment.contents ]
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async image(prompt: string, opts?: LlmCompletionOpts): Promise<LlmResponse> {
    return null    
  }

}
