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
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

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
        messageText = `I'm uploading a document named "${pendingUpload.name}" for processing.`;
      }
    }
    
    setInputText('');
    
    Meteor.call('messages.send', messageText, fileUploadInfo, (error) => {
      if (error) {
        console.error('Error sending message:', error);
        alert('Error sending message: ' + (error.reason || error.message));
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
        
        setTimeout(() => {
          const inputField = document.getElementById('messageInput');
          if (inputField) {
            inputField.focus();
            inputField.placeholder = `Add context about ${file.name}...`;
          }
        }, 300);
      };
      reader.onerror = (e) => {
        console.error("FileReader error: ", e);
        alert("Error reading file.");
        setSelectedFile(null);
        setFileContent(null);
        setPendingUpload(null);
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
      inputField.placeholder = "Type your message...";
    }
  };

  return (
    <div className="chat-container">
      <h1>{Meteor.settings.public?.appName || 'Ozwell MCP Chat'}</h1>
      
      <div className="messages-list">
        {isLoading && <p>Loading messages...</p>}
        
        {messages.map((msg) => (
          <div 
            key={msg._id} 
            className={`message ${msg.type || 'default'} owner-${msg.owner?.replace(/\s+/g, '-').toLowerCase()}`}
          >
            <div className="message-owner">{msg.owner}</div>
            <div className="message-text">
              {/* Format the message text based on its type */}
              {msg.type === 'mcp-response' && msg.text.startsWith('{') ? (
                <pre style={{
                  whiteSpace: 'pre-wrap', 
                  overflow: 'auto',
                  maxHeight: '300px',
                  background: '#f5f5f5',
                  padding: '10px',
                  borderRadius: '5px'
                }}>
                  {msg.text}
                </pre>
              ) : (
                msg.text
              )}
            </div>
          </div>
        ))}
        
        <div ref={messagesEndRef} />
      </div>
      
      <form className="input-area" onSubmit={handleSendMessage}>
        {pendingUpload && (
          <div className="pending-file">
            <span className="pending-file-name" title={pendingUpload.name}>
              {pendingUpload.name.length > 20 
                ? pendingUpload.name.substring(0, 17) + '...' 
                : pendingUpload.name}
            </span>
            <button type="button" className="pending-file-cancel" onClick={handleCancelUpload}>
              ✕
            </button>
          </div>
        )}
        
        <input
          id="messageInput"
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={pendingUpload ? `Add context about ${pendingUpload.name}...` : "Type your message..."}
        />
        <button type="submit">Send</button>
      </form>
      
      <div className="action-buttons">
        {/* Upload button (plus icon) */}
        <button 
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
        />
      </div>
    </div>
  );
}