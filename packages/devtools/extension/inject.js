// This script is injected into the page context to detect Assistant UI
(function() {
  console.log('[Assistant UI Extension] Page script injected, checking for hook...');

  // Check if Assistant UI devtools hook is available
  const checkForAssistantUI = () => {
    const hook = window.__ASSISTANT_UI_DEVTOOLS_HOOK__;
    const hasAssistantUI = !!hook;

    console.log('[Assistant UI Extension] Hook status:', hasAssistantUI, 'APIs:', hook?.apis?.size || 0);

    // Send message to content script via custom event
    window.postMessage({
      source: 'assistant-ui-detector',
      type: 'ASSISTANT_UI_STATUS',
      hasAssistantUI: hasAssistantUI,
      apis: hook?.apis?.size || 0
    }, '*');
  };

  // Check immediately
  checkForAssistantUI();

  // Check when DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkForAssistantUI);
  }

  // Check periodically for late-loading apps
  let attempts = 0;
  const maxAttempts = 20;
  const checkInterval = setInterval(() => {
    attempts++;
    checkForAssistantUI();

    if (attempts >= maxAttempts || window.__ASSISTANT_UI_DEVTOOLS_HOOK__) {
      clearInterval(checkInterval);
    }
  }, 500);
})();