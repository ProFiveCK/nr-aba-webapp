/**
 * Modal Utility Functions
 * For creating and managing modals
 */

import { getById } from './dom.js';

/**
 * Open a modal with content
 */
export function openModal(content) {
  // Remove any existing modal
  const existingModal = document.getElementById('dynamic-modal');
  if (existingModal) existingModal.remove();
  
  // Create a fresh modal element
  const modal = document.createElement('div');
  modal.id = 'dynamic-modal';
  modal.innerHTML = `
    <div style="
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <div style="
        background: white;
        border-radius: 8px;
        padding: 20px;
        max-width: 400px;
        width: 90%;
        box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        position: relative;
      ">
        <button onclick="document.getElementById('dynamic-modal').remove()" style="
          position: absolute;
          top: 10px;
          right: 15px;
          background: none;
          border: none;
          font-size: 20px;
          cursor: pointer;
          color: #666;
        ">×</button>
        ${content}
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

/**
 * Close modal
 */
export function closeModal() {
  const dynamicModal = getById('dynamic-modal');
  if (dynamicModal) {
    dynamicModal.remove();
    return;
  }
  const backdrop = getById('modal-backdrop');
  if (backdrop) backdrop.remove();
}

