import { createAppError } from '../../errors';
import { requestOpenAIBrokerResponse } from '../openaiBroker';
import { getCharacterContract } from '../characterContracts';
import type { OpenAIResponsesRequestBody } from '../openaiContract';
import type { ResponseGenerationRequest, ResponseProvider } from './base';
import {
  buildContactInstruction,
  buildContactUserPrompt,
  normalizeContactReplyText,
  simulateProgressiveDelivery,
} from './contactReplyUtils';

const MAX_OUTPUT_TOKENS = 120;

function asAbortError() {
  return new DOMException('The OpenAI response job was aborted.', 'AbortError');
}

function buildOpenAIRequestBody(request: ResponseGenerationRequest): OpenAIResponsesRequestBody {
  return {
    model: 'gpt-5-mini',
    instructions: buildContactInstruction(request.contact),
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: buildContactUserPrompt({
            transcript: request.transcript,
            currentUserTurnId: request.userTurn.id,
            responseJobId: request.jobId,
            userText: request.userTurn.text,
          }),
        }],
      },
    ],
    max_output_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0.7,
    store: false,
    text: {
      format: {
        type: 'text',
      },
    },
    reasoning: {
      effort: 'minimal',
    },
    metadata: {
      app: 'what-even',
      provider_role: 'fallback',
    },
  };
}

export class OpenAIResponseProvider implements ResponseProvider {
  async generate(
    request: ResponseGenerationRequest,
    callbacks: Parameters<ResponseProvider['generate']>[1],
    signal: AbortSignal,
  ) {
    const contract = getCharacterContract(request.contact);
    const speaker = request.contact.name.toUpperCase();
    const emitPartial = (text: string) => {
      const normalized = normalizeContactReplyText(text, {
        speaker,
        signoff: request.contact.signoff,
        contract,
      });
      if (!normalized) {
        return;
      }

      callbacks.onPartial({
        role: 'contact',
        speaker,
        text: normalized,
        emotion: contract.fallbackStyle.defaultEmotion,
      });
    };

    const result = await requestOpenAIBrokerResponse(
      {
        jobId: request.jobId,
        request: buildOpenAIRequestBody(request),
      },
      {
        onPartial: (event) => {
          emitPartial(event.text);
        },
      },
      signal,
    );

    if (signal.aborted) {
      throw asAbortError();
    }

    const finalText = normalizeContactReplyText(result.text, {
      speaker,
      signoff: request.contact.signoff,
      contract,
    });
    if (!finalText) {
      throw createAppError({
        category: 'state_error',
        code: 'openai_empty_response',
        userMessage: 'OpenAI returned an empty response.',
      });
    }

    if (result.deliveryMode !== 'native_stream') {
      await simulateProgressiveDelivery(finalText, emitPartial, signal);
    }

    callbacks.onFinal({
      turns: [
        {
          role: 'contact',
          speaker,
          text: finalText,
          emotion: contract.fallbackStyle.defaultEmotion,
        },
        {
          role: 'system',
          speaker: 'SYSTEM',
          text: request.contact.signoff,
        },
      ],
    });
  }
}
