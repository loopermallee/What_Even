import type { AppState } from '../../app/types';

export function renderControlsPanel(state: AppState, showDevDebugToggle: boolean) {
  return `
    <div class="controls-card">
      <div class="controls-row">
        <button id="startEvenBtn">Start on Even</button>
        <button id="prevContactBtn" ${state.screen !== 'contacts' ? 'disabled' : ''}>Prev Contact</button>
        <button id="nextContactBtn" ${state.screen !== 'contacts' ? 'disabled' : ''}>Next Contact</button>
        <button id="openIncomingBtn" ${state.screen !== 'contacts' ? 'disabled' : ''}>Open Incoming</button>
        <button id="listeningContinueBtn" ${state.screen !== 'listening' ? 'disabled' : ''}>Listening Continue</button>
        <button id="listeningEndBtn" ${state.screen !== 'listening' ? 'disabled' : ''}>Listening End</button>
        <button id="activeNextBtn" ${state.screen !== 'active' ? 'disabled' : ''}>Active Next</button>
        <button id="activeEndBtn" ${state.screen !== 'active' ? 'disabled' : ''}>Active End</button>
        ${showDevDebugToggle ? `<button id="toggleDebugBtn">${state.screen === 'debug' ? 'Exit Debug' : 'Open Debug'}</button>` : ''}
        <button id="copyLogBtn">Copy Log</button>
        <button id="clearLogBtn">Clear Log</button>
      </div>
    </div>
  `;
}
