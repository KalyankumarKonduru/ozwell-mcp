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

  const handleMongoDbQuery = () => {
    setIsToolsMenuOpen(false);
    
    Meteor.call('messages.send', "I would like to query the MongoDB database. Can you assist me with that?", null, (error) => {
      if (error) {
        alert('Error sending message: ' + (error.reason || error.message));
      } else {
        const toolName = prompt("Enter MongoDB Tool Name (e.g., find_documents):", "find_documents");
        if (!toolName) return;
        
        const paramsString = prompt("Enter Parameters as JSON (e.g., {\"collection\": \"your_collection\", \"query\": {\"name\":\"test\"}})", "{\"collection\": \"messages\", \"query\": {}}");
        if (!paramsString) return;
        
        try {
          const params = JSON.parse(paramsString);
          Meteor.call('mcp.callMongoSdk', toolName, params, (mongoError, result) => {
            if (mongoError) {
              alert('Error calling MongoDB: ' + (mongoError.reason || mongoError.message));
            } else {
              console.log('MongoDB Result:', result);
            }
          });
        } catch (e) {
          alert("Invalid JSON for parameters: " + e.message);
        }
      }
    });
  };

  const handleElasticsearchQuery = () => {
    setIsToolsMenuOpen(false);
    
    Meteor.call('messages.send', "I would like to search the Elasticsearch database. Can you help me with that?", null, (error) => {
      if (error) {
        alert('Error sending message: ' + (error.reason || error.message));
      } else {
        const toolName = prompt("Enter Elasticsearch Tool Name (e.g., search_documents):", "search_documents");
        if (!toolName) return;
        
        const paramsString = prompt("Enter Parameters as JSON (e.g., {\"index\": \"ozwell_documents\", \"query_body\": {\"query\":{\"match_all\":{}}}})", `{"index": "${Meteor.settings.public?.RAG_ELASTICSEARCH_INDEX || 'ozwell_documents'}", "query_body": {"query":{"match_all":{}}}}`);
        if (!paramsString) return;
        
        try {
          const params = JSON.parse(paramsString);
          Meteor.call('mcp.callElasticsearchSdk', toolName, params, (esError, result) => {
            if (esError) {
              alert('Error calling Elasticsearch: ' + (esError.reason || esError.message));
            } else {
              console.log('Elasticsearch Result:', result);
            }
          });
        } catch (e) {
          alert("Invalid JSON for parameters: " + e.message);
        }
      }
    });
  };

  const handleFhirQuery = () => {
    setIsToolsMenuOpen(false);
    
    Meteor.call('messages.send', "I would like to search the FHIR EHR system. Can you help me find patient information?", null, (error) => {
      if (error) {
        alert('Error sending message: ' + (error.reason || error.message));
      } else {
        // Prompt for search type
        const searchType = prompt("Enter search type:\n1. patients - Search for patients\n2. observations - Get patient lab results/vitals\n3. conditions - Get patient diagnoses\n4. medications - Get patient medications\n5. encounters - Get patient visits", "patients");
        if (!searchType) return;
        
        if (searchType === "patients" || searchType === "1") {
          const familyName = prompt("Enter patient family name to search:", "Smith");
          if (!familyName) return;
          
          Meteor.call('mcp.callFhirSdk', 'search_patients', {
            family: familyName,
            _count: 10
          }, (fhirError, result) => {
            if (fhirError) {
              alert('Error calling FHIR: ' + (fhirError.reason || fhirError.message));
            } else {
              console.log('FHIR Result:', result);
            }
          });
        } else if (searchType === "observations" || searchType === "2") {
          const patientId = prompt("Enter Patient ID for observations:", "");
          if (!patientId) return;
          
          const category = prompt("Enter observation category (optional):\n- vital-signs\n- laboratory\n- imaging\n- survey\n- exam\n- therapy", "vital-signs");
          
          const params = { patient_id: patientId, _count: 20 };
          if (category) params.category = category;
          
          Meteor.call('mcp.callFhirSdk', 'get_patient_observations', params, (fhirError, result) => {
            if (fhirError) {
              alert('Error calling FHIR: ' + (fhirError.reason || fhirError.message));
            } else {
              console.log('FHIR Result:', result);
            }
          });
        } else if (searchType === "conditions" || searchType === "3") {
          const patientId = prompt("Enter Patient ID for conditions:", "");
          if (!patientId) return;
          
          Meteor.call('mcp.callFhirSdk', 'get_patient_conditions', {
            patient_id: patientId,
            _count: 20
          }, (fhirError, result) => {
            if (fhirError) {
              alert('Error calling FHIR: ' + (fhirError.reason || fhirError.message));
            } else {
              console.log('FHIR Result:', result);
            }
          });
        } else if (searchType === "medications" || searchType === "4") {
          const patientId = prompt("Enter Patient ID for medications:", "");
          if (!patientId) return;
          
          Meteor.call('mcp.callFhirSdk', 'get_patient_medications', {
            patient_id: patientId,
            _count: 20
          }, (fhirError, result) => {
            if (fhirError) {
              alert('Error calling FHIR: ' + (fhirError.reason || fhirError.message));
            } else {
              console.log('FHIR Result:', result);
            }
          });
        } else if (searchType === "encounters" || searchType === "5") {
          const patientId = prompt("Enter Patient ID for encounters:", "");
          if (!patientId) return;
          
          Meteor.call('mcp.callFhirSdk', 'get_patient_encounters', {
            patient_id: patientId,
            _count: 20
          }, (fhirError, result) => {
            if (fhirError) {
              alert('Error calling FHIR: ' + (fhirError.reason || fhirError.message));
            } else {
              console.log('FHIR Result:', result);
            }
          });
        } else {
          alert("Invalid search type. Please enter 'patients', 'observations', 'conditions', 'medications', or 'encounters'");
        }
      }
    });
  };

  const handleHealthCheck = () => {
    setIsToolsMenuOpen(false);
    
    Meteor.call('mcp.checkSdkHealth', (error, result) => {
      if (error) {
        alert('Error checking health: ' + (error.reason || error.message));
      } else {
        console.log('Health Check Result:', result);
      }
    });
  };

  const handleTestSearch = () => {
    setIsToolsMenuOpen(false);
    
    const searchTerm = prompt("Enter search term to test:", "heart");
    if (!searchTerm) return;
    
    Meteor.call('mcp.testSdkSearch', searchTerm, (error, result) => {
      if (error) {
        alert('Error testing search: ' + (error.reason || error.message));
      } else {
        console.log('Test Search Result:', result);
      }
    });
  };

  const handleFhirCapability = () => {
    setIsToolsMenuOpen(false);
    
    Meteor.call('mcp.callFhirSdk', 'get_fhir_capability', {}, (error, result) => {
      if (error) {
        alert('Error getting FHIR capability: ' + (error.reason || error.message));
      } else {
        console.log('FHIR Capability:', result);
      }
    });
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
        />
        
        {/* Tools button (hammer icon) */}
        <button 
          id="toolsButton"
          className="action-button tools-button" 
          onClick={() => setIsToolsMenuOpen(!isToolsMenuOpen)}
          title="Database & EHR Tools"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
          </svg>
        </button>
        
        {/* Tools dropdown menu */}
        {isToolsMenuOpen && (
          <div className="tools-menu" ref={toolsMenuRef}>
            <button onClick={handleMongoDbQuery}>
              📄 Query MongoDB
            </button>
            <button onClick={handleElasticsearchQuery}>
              🔍 Search Elasticsearch
            </button>
            <button onClick={handleFhirQuery}>
              🏥 Search FHIR EHR
            </button>
            <button onClick={handleFhirCapability}>
              📋 FHIR Capabilities
            </button>
            <button onClick={handleHealthCheck}>
              🏥 Health Check
            </button>
            <button onClick={handleTestSearch}>
              🧪 Test Search
            </button>
          </div>
        )}
      </div>
    </div>
  );
}