// Popup component for the browser action
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

interface AssistantUIStatus {
  hasAssistantUI: boolean;
  apis: number;
}

const Popup: React.FC = () => {
  const [status, setStatus] = useState<AssistantUIStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get current tab and check for Assistant UI
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { type: 'GET_ASSISTANT_UI_STATUS' },
          (response) => {
            if (chrome.runtime.lastError) {
              setStatus({ hasAssistantUI: false, apis: 0 });
            } else {
              setStatus(response || { hasAssistantUI: false, apis: 0 });
            }
            setLoading(false);
          }
        );
      }
    });
  }, []);

  const openDevTools = () => {
    chrome.devtools.inspectedWindow.eval(
      'inspect(document.body)',
      () => {
        // DevTools should now be open with the Elements panel
        // The Assistant UI panel should be available if Assistant UI is detected
      }
    );
  };

  if (loading) {
    return (
      <div style={{
        width: '300px',
        padding: '16px',
        textAlign: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>
        <div>Checking for Assistant UI...</div>
      </div>
    );
  }

  return (
    <div style={{
      width: '300px',
      padding: '16px',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        marginBottom: '12px'
      }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>
          Assistant UI DevTools
        </h3>
      </div>

      {status?.hasAssistantUI ? (
        <div>
          <div style={{
            color: '#16a34a',
            fontSize: '14px',
            marginBottom: '8px'
          }}>
            ✅ Assistant UI detected
          </div>
          <div style={{
            fontSize: '13px',
            color: '#6b7280',
            marginBottom: '12px'
          }}>
            {status.apis} API{status.apis !== 1 ? 's' : ''} registered
          </div>
          <div style={{ fontSize: '13px', color: '#6b7280' }}>
            Open DevTools (F12) and look for the "Assistant UI" tab to inspect components.
          </div>
        </div>
      ) : (
        <div>
          <div style={{
            color: '#dc2626',
            fontSize: '14px',
            marginBottom: '8px'
          }}>
            ❌ Assistant UI not detected
          </div>
          <div style={{ fontSize: '13px', color: '#6b7280' }}>
            This extension only works on pages that use @assistant-ui/react components.
          </div>
        </div>
      )}
    </div>
  );
};

// Mount the component
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Popup />);
}