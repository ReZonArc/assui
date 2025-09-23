// Main devtools script
// This script is loaded when devtools are opened

// Check if the current page has Assistant UI
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]?.id) {
    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_ASSISTANT_UI_STATUS' }, (response) => {
      if (chrome.runtime.lastError) {
        // Content script might not be loaded yet
        return;
      }

      if (response?.hasAssistantUI) {
        // Create the Assistant UI DevTools panel
        chrome.devtools.panels.create(
          'Assistant UI',
          'icon32.png', // Icon for the panel tab
          'devtools-panel.html', // HTML file for the panel
          (panel) => {
            // Panel created successfully
            console.log('Assistant UI DevTools panel created');
          }
        );
      }
    });
  }
});

// Also listen for runtime messages about Assistant UI detection
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'ASSISTANT_UI_DETECTED' && message.data.hasAssistantUI) {
    // Create the panel if not already created
    chrome.devtools.panels.create(
      'Assistant UI',
      'icon32.png',
      'devtools-panel.html',
      (panel) => {
        console.log('Assistant UI DevTools panel created (from runtime message)');
      }
    );
  }
});