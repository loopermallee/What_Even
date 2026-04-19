import { generateDeterministicResponse } from '../../responseEngine';
import type { ResponseGenerationRequest, ResponseProvider } from './base';

function asAbortError() {
  return new DOMException('The response job was aborted.', 'AbortError');
}

export class DeterministicResponseProvider implements ResponseProvider {
  async generate(
    request: ResponseGenerationRequest,
    callbacks: Parameters<ResponseProvider['generate']>[1],
    signal: AbortSignal
  ) {
    if (signal.aborted) {
      throw asAbortError();
    }

    const turns = generateDeterministicResponse(request.contact, request.userTurn.text);

    if (signal.aborted) {
      throw asAbortError();
    }

    callbacks.onFinal({ turns });
  }
}
