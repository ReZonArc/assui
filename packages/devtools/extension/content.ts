// Content script for Assistant UI DevTools
// This script runs on all pages and detects if Assistant UI is present

(function() {
  console.log('[Assistant UI Extension] Content script loaded');

  // Store the last known status
  let lastStatus = { hasAssistantUI: false, apis: 0 };

  // Inject a script into the page context to check for the hook
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  script.onload = function() {
    script.remove();
  };
  (document.head || document.documentElement).appendChild(script);

  // Listen for messages from the injected script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data.source !== 'assistant-ui-detector') return;

    if (event.data.type === 'ASSISTANT_UI_STATUS') {
      console.log('[Assistant UI Extension] Received status from page:', event.data);

      lastStatus = {
        hasAssistantUI: event.data.hasAssistantUI,
        apis: event.data.apis
      };

      // Send message to extension about Assistant UI presence
      if (event.data.hasAssistantUI) {
        chrome.runtime.sendMessage({
          type: 'ASSISTANT_UI_DETECTED',
          data: lastStatus
        }).catch((err) => {
          console.log('[Assistant UI Extension] Failed to send message to background:', err);
        });
      }
    }
  });

  // Listen for messages from devtools/popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Assistant UI Extension] Received message from extension:', message);

    if (message.type === 'GET_ASSISTANT_UI_STATUS') {
      console.log('[Assistant UI Extension] Responding with status:', lastStatus);
      sendResponse(lastStatus);
    }
    return true; // Keep the message channel open for async response
  });
})();