import React, { useState, useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { Messages } from '../../imports/api/messages.js';

export default function App() {
  const [inputText, setInputText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingUpload, setPendingUpload] = useState(null);
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const uploadButtonRef = useRef(null);
  const toolsMenuRef = useRef(null);

  const { messages, isLoading } = useTracker(() => {
    const handle = Meteor.subscribe('messages');
    return {
      messages: Messages.find({}, { sort: { createdAt: 1 } }).fetch(),
      isLoading: !handle.ready(),
    };
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(event.target) && 
          event.target !== document.getElementById('toolsButton')) {
        setIsToolsMenuOpen(false);
      }
    }
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!inputText.trim() && !pendingUpload) return;
    
    let messageText = inputText.trim();
    let fileUploadInfo = null;
    
    if (pendingUpload) {
      fileUploadInfo = {
        name: pendingUpload.name,
        type: pendingUpload.type,
        size: pendingUpload.size,
        data: pendingUpload.data
      };
      
      if (!messageText) {
        messageText = `Analyze this document: ${pendingUpload.name}`;
      }
    }
    
    setInputText('');
    
    Meteor.call('messages.send', messageText, fileUploadInfo, (error) => {
      if (error) {
        console.error('Error sending message:', error);
      } else {
        if (pendingUpload) {
          setPendingUpload(null);
          setSelectedFile(null);
          setFileContent(null);
        }
      }
    });
  };

  const handleFileSelect = () => {
    fileInputRef.current.click();
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file);
      setIsUploading(true);
      
      const reader = new FileReader();
      reader.onload = (e) => {
        const fileData = e.target.result.split(',')[1];
        
        setFileContent(e.target.result);
        setPendingUpload({
          name: file.name,
          type: file.type,
          size: file.size,
          data: fileData
        });
        
        setIsUploading(false);
        
        setTimeout(() => {
          const inputField = document.getElementById('messageInput');
          if (inputField) {
            inputField.focus();
            inputField.placeholder = `Ask about ${file.name}...`;
          }
        }, 300);
      };
      
      reader.onerror = (e) => {
        console.error("FileReader error: ", e);
        alert("Error reading file.");
        setSelectedFile(null);
        setFileContent(null);
        setPendingUpload(null);
        setIsUploading(false);
      };
      
      reader.readAsDataURL(file); 
    }
  };

  const handleCancelUpload = () => {
    setPendingUpload(null);
    setSelectedFile(null);
    setFileContent(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = null;
    }
    
    const inputField = document.getElementById('messageInput');
    if (inputField) {
      inputField.placeholder = "Ask Claude anything...";
    }
  };

  const handleClearChat = () => {
    setIsToolsMenuOpen(false);
    
    if (confirm('Clear all messages?')) {
      Meteor.call('messages.clear', (error) => {
        if (error) {
          console.error('Error clearing messages:', error);
        }
      });
    }
  };

  // Format message text for better display
  const formatMessageText = (text, type) => {
    if (type === 'mcp-response' && text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text);
        return (
          <pre style={{
            whiteSpace: 'pre-wrap', 
            overflow: 'auto',
            maxHeight: '300px',
            background: '#f5f5f5',
            padding: '10px',
            borderRadius: '5px',
            fontSize: '0.9em'
          }}>
            {JSON.stringify(parsed, null, 2)}
          </pre>
        );
      } catch (e) {
        return <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>;
      }
    }
    
    return <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>;
  };

  return (
    <div className="chat-container">
      <h1>{Meteor.settings.public?.appName || 'Claude MCP Chat'}</h1>
      
      <div className="messages-list">
        {isLoading && <p>Loading messages...</p>}
        
        {messages.length === 0 && !isLoading && (
          <div style={{ textAlign: 'center', color: '#666', padding: '20px' }}>
            <h3>Welcome to Claude MCP Chat</h3>
            <p>Claude has access to MCP tools for databases, search, and healthcare data.</p>
            <p>Start a conversation or upload a document for analysis.</p>
          </div>
        )}
        
        {messages.map((msg) => (
          <div 
            key={msg._id} 
            className={`message ${msg.type || 'default'} owner-${msg.owner?.replace(/\s+/g, '-').toLowerCase()}`}
          >
            <div className="message-owner">
              {msg.owner}
              {msg.createdAt && (
                <span style={{ fontSize: '0.8em', opacity: 0.7, marginLeft: '8px' }}>
                  {new Date(msg.createdAt).toLocaleTimeString()}
                </span>
              )}
            </div>
            <div className="message-text">
              {formatMessageText(msg.text, msg.type)}
            </div>
          </div>
        ))}
        
        <div ref={messagesEndRef} />
      </div>
      
      <form className="input-area" onSubmit={handleSendMessage}>
        {pendingUpload && (
          <div className="pending-file">
            <span className="pending-file-name" title={pendingUpload.name}>
              {pendingUpload.name.length > 25 
                ? pendingUpload.name.substring(0, 22) + '...' 
                : pendingUpload.name}
            </span>
            <button type="button" className="pending-file-cancel" onClick={handleCancelUpload}>
              ×
            </button>
          </div>
        )}
        
        <input
          id="messageInput"
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={pendingUpload ? `Ask about ${pendingUpload.name}...` : "Ask Claude anything..."}
          disabled={isUploading}
        />
        <button type="submit" disabled={isUploading || (!inputText.trim() && !pendingUpload)}>
          {isUploading ? 'Processing...' : 'Send'}
        </button>
      </form>
      
      <div className="action-buttons">
        {/* Upload button */}
        <button 
          ref={uploadButtonRef}
          className="action-button upload-button" 
          onClick={handleFileSelect}
          disabled={isUploading || pendingUpload !== null}
          title="Upload Document"
        >
          {isUploading ? (
            <span className="loading-spinner"></span>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          )}
        </button>
        
        {/* Hidden file input */}
        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          onChange={handleFileChange}
          accept=".pdf,.docx,.doc,.txt,.json,.csv,.html,.htm"
        />
        
        {/* Tools button */}
        <button 
          id="toolsButton"
          className="action-button tools-button" 
          onClick={() => setIsToolsMenuOpen(!isToolsMenuOpen)}
          title="Options"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M12 1v6m0 6v6m11-7h-6m-6 0H1"></path>
          </svg>
        </button>
        
        {/* Tools dropdown menu */}
        {isToolsMenuOpen && (
          <div className="tools-menu" ref={toolsMenuRef}>
            <button onClick={handleClearChat}>
              Clear Chat
            </button>
          </div>
        )}
      </div>
    </div>
  );
}