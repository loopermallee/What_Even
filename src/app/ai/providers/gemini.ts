import { createAppError } from '../../errors';
import { requestGeminiBrokerResponse } from '../geminiBroker';
import type { GeminiGenerateRequestBody } from '../geminiContract';
import type { ResponseGenerationRequest, ResponseProvider } from './base';
import {
  buildContactInstruction,
  buildContactUserPrompt,
  normalizeContactReplyText,
  simulateProgressiveDelivery,
} from './contactReplyUtils';

const MAX_OUTPUT_TOKENS = 120;

function asAbortError() {
  return new DOMException('The Gemini response job was aborted.', 'AbortError');
}

function buildGeminiRequestBody(request: ResponseGenerationRequest): GeminiGenerateRequestBody {
  return {
    systemInstruction: {
      parts: [{ text: buildContactInstruction(request.contact) }],
    },
    contents: [
      {
        role: 'user',
        parts: [{
          text: buildContactUserPrompt({
            transcript: request.transcript,
            currentUserTurnId: request.userTurn.id,
            responseJobId: request.jobId,
            userText: request.userTurn.text,
          }),
        }],
      },
    ],
    generationConfig: {
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.7,
      topP: 0.9,
    },
  };
}

export class GeminiResponseProvider implements ResponseProvider {
  async generate(
    request: ResponseGenerationRequest,
    callbacks: Parameters<ResponseProvider['generate']>[1],
    signal: AbortSignal,
  ) {
    const speaker = request.contact.name.toUpperCase();
    const emitPartial = (text: string) => {
      const normalized = normalizeContactReplyText(text, {
        speaker,
        signoff: request.contact.signoff,
      });
      if (!normalized) {
        return;
      }

      callbacks.onPartial({
        role: 'contact',
        speaker,
        text: normalized,
        emotion: 'stern',
      });
    };

    const result = await requestGeminiBrokerResponse(
      {
        jobId: request.jobId,
        request: buildGeminiRequestBody(request),
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
    });
    if (!finalText) {
      throw createAppError({
        category: 'state_error',
        code: 'gemini_empty_response',
        userMessage: 'Gemini returned an empty response.',
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
          emotion: 'stern',
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
