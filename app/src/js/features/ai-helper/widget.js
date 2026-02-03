/**
 * AI Helper Chat Widget
 * Provides AI assistance for the application
 */

import { getById } from '../../utils/dom.js';
import { appState } from '../../state/app-state.js';

// Module state
let isOpen = false;

// DOM elements (will be initialized)
let widget, toggle, windowEl, close, messages, input, send, status;

/**
 * Simple markdown to HTML converter
 */
function parseMarkdown(text) {
  return text
    // Headers
    .replace(/^### (.*$)/gim, '<h3 class="font-bold text-base mt-3 mb-1">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 class="font-bold text-lg mt-3 mb-1">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 class="font-bold text-xl mt-3 mb-1">$1</h1>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold">$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
    // Code blocks
    .replace(/```([\s\S]*?)```/g, '<pre class="bg-gray-100 rounded p-2 my-2 overflow-x-auto"><code>$1</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-1 rounded text-sm">$1</code>')
    // Numbered lists
    .replace(/^\d+\.\s+(.*)$/gim, '<li class="ml-4">$1</li>')
    // Bullet lists
    .replace(/^[\-\*]\s+(.*)$/gim, '<li class="ml-4">• $1</li>')
    // Line breaks
    .replace(/\n/g, '<br>');
}

/**
 * Add message to chat
 */
function addMessage(text, isUser = false) {
  if (!messages) return;
  
  const msg = document.createElement('div');
  msg.className = `text-sm rounded-lg p-3 shadow-sm ${isUser ? 'bg-blue-600 text-white ml-auto' : 'bg-white text-gray-800'} max-w-[85%]`;
  
  if (isUser) {
    msg.textContent = text;
  } else {
    msg.innerHTML = parseMarkdown(text);
  }
  
  messages.appendChild(msg);
  messages.scrollTop = messages.scrollHeight;
}

/**
 * Send message to AI
 */
async function sendMessage() {
  if (!input) return;
  
  const message = input.value.trim();
  if (!message) return;
  
  addMessage(message, true);
  input.value = '';
  
  // Show typing indicator
  if (status) {
    status.textContent = 'AI is thinking...';
    status.classList.remove('hidden');
  }
  if (send) send.disabled = true;
  
  try {
    const token = appState.getAuthToken();
    const reviewer = appState.getReviewer();
    
    console.log('[AI Helper] Sending request to /api/ai-helper/chat');
    console.log('[AI Helper] Reviewer:', reviewer);
    
    const response = await fetch('/api/ai-helper/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ 
        message,
        userRole: reviewer?.role || 'user',
        userName: reviewer?.name || 'Guest'
      })
    });
    
    console.log('[AI Helper] Response status:', response.status);
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      console.error('[AI Helper] Error response:', error);
      if (response.status === 503) {
        addMessage('⚠️ AI Helper is not enabled. Please contact your administrator to enable this feature.');
      } else {
        addMessage(`Error: ${error.message || 'Failed to get response'}`);
      }
      return;
    }
    
    const data = await response.json();
    console.log('[AI Helper] Success! Reply received');
    addMessage(data.reply);
    
  } catch (error) {
    console.error('[AI Helper] Network/Parse error:', error);
    console.error('[AI Helper] Error type:', error.constructor.name);
    console.error('[AI Helper] Error message:', error.message);
    addMessage('❌ Failed to connect to AI Helper. Please try again.');
  } finally {
    if (status) status.classList.add('hidden');
    if (send) send.disabled = false;
    if (input) input.focus();
  }
}

/**
 * Initialize AI Helper module
 */
export function initAiHelper(elements = {}) {
  widget = elements.widget || getById('ai-helper-widget');
  toggle = elements.toggle || getById('ai-helper-toggle');
  windowEl = elements.window || getById('ai-helper-window');
  close = elements.close || getById('ai-helper-close');
  messages = elements.messages || getById('ai-helper-messages');
  input = elements.input || getById('ai-helper-input');
  send = elements.send || getById('ai-helper-send');
  status = elements.status || getById('ai-helper-status');
  
  if (!widget || !toggle || !windowEl || !messages || !input || !send) {
    console.warn('AI Helper: Some required DOM elements not found');
    return;
  }
  
  isOpen = false;
  
  // Toggle chat window
  toggle?.addEventListener('click', () => {
    isOpen = !isOpen;
    windowEl?.classList.toggle('hidden', !isOpen);
    if (isOpen) input?.focus();
  });
  
  close?.addEventListener('click', () => {
    isOpen = false;
    windowEl?.classList.add('hidden');
  });
  
  // Event listeners
  send?.addEventListener('click', sendMessage);
  input?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
}

