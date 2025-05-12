import React, { useState, useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { Messages } from '../../imports/api/messages.js';

export default function App() {
  const [inputText, setInputText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const messagesEndRef = useRef(null);

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
    if (!inputText.trim()) return;
    Meteor.call('messages.send', inputText, (error) => {
      if (error) {
        alert('Error sending message: ' + (error.reason || error.message));
      }
    });
    setInputText('');
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setFileContent(e.target.result); // This will be a base64 string
      };
      reader.onerror = (e) => {
        console.error("FileReader error: ", e);
        alert("Error reading file.");
        setSelectedFile(null);
        setFileContent(null);
      };
      reader.readAsDataURL(file); // Read as base64 data URL
    }
  };

  const handleFileUpload = () => {
    if (!selectedFile || !fileContent) {
      alert("Please select a file to upload.");
      return;
    }

    const fileInfo = {
      name: selectedFile.name,
      type: selectedFile.type,
      size: selectedFile.size,
      data: fileContent.split(',')[1] // Get the base64 part of the data URL
    };

    Meteor.call('documents.uploadAndProcess', fileInfo, (error, result) => {
      if (error) {
        alert('Error uploading document: ' + (error.reason || error.message));
      } else {
        alert(`Document '${selectedFile.name}' upload process initiated. Result: ${JSON.stringify(result)}`);
        // Optionally clear the file input/state after successful initiation
        setSelectedFile(null);
        setFileContent(null);
        // If you have a ref to the file input, you can reset it:
        // fileInputRef.current.value = null;
      }
    });
  };

  const handleMongoDbQuery = () => {
    const toolName = prompt("Enter MongoDB Tool Name (e.g., find_documents):", "find_documents");
    if (!toolName) return;
    const paramsString = prompt("Enter Parameters as JSON (e.g., {\"collection\": \"your_collection\", \"query\": {\"name\":\"test\"}})", "{\"collection\": \"messages\", \"query\": {}}");
    if (!paramsString) return;
    try {
      const params = JSON.parse(paramsString);
      Meteor.call('mcp.callMongo', toolName, params, (error, result) => {
        if (error) {
          alert('Error calling MongoDB: ' + (error.reason || error.message));
        } else {
          console.log('MongoDB Result:', result);
          alert('MongoDB call successful. Check console for results.');
        }
      });
    } catch (e) {
      alert("Invalid JSON for parameters: " + e.message);
    }
  };

  const handleElasticsearchQuery = () => {
    const toolName = prompt("Enter Elasticsearch Tool Name (e.g., search_documents):", "search_documents");
    if (!toolName) return;
    const paramsString = prompt("Enter Parameters as JSON (e.g., {\"index\": \"ozwell_documents\", \"query_body\": {\"query\":{\"match_all\":{}}}})", `{"index": "${Meteor.settings.private?.RAG_ELASTICSEARCH_INDEX || 'ozwell_documents'}", "query_body": {"query":{"match_all":{}}}}`);    if (!paramsString) return;
    try {
      const params = JSON.parse(paramsString);
      Meteor.call('mcp.callElasticsearch', toolName, params, (error, result) => {
        if (error) {
          alert('Error calling Elasticsearch: ' + (error.reason || error.message));
        } else {
          console.log('Elasticsearch Result:', result);
          alert('Elasticsearch call successful. Check console for results.');
        }
      });
    } catch (e) {
      alert("Invalid JSON for parameters: " + e.message);
    }
  };

  return (
    <div className="chat-container">
      <h1>{Meteor.settings.public.appName || 'Ozwell MCP Chat'}</h1>
      <div className="messages-list">
        {isLoading && <p>Loading messages...</p>}
        {messages.map((msg) => (
          <div key={msg._id} className={`message ${msg.type || 'default'} owner-${msg.owner?.replace(/\s+/g, '-').toLowerCase()}`}>
            <div className="message-owner">{msg.owner}</div>
            <div className="message-text">{msg.text}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form className="input-area" onSubmit={handleSendMessage}>
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Type your message..."
        />
        <button type="submit">Send</button>
      </form>
      <div className="controls-area" style={{ padding: '10px', textAlign: 'center', borderTop: '1px solid #ccc', marginTop: '10px' }}>
        <div style={{ marginBottom: '10px' }}>
          <input type="file" onChange={handleFileChange} style={{ marginRight: '10px' }} />
          <button onClick={handleFileUpload} disabled={!selectedFile}>Upload Document</button>
        </div>
        <div>
          <button onClick={handleMongoDbQuery} style={{ marginRight: '10px' }}>Query MongoDB</button>
          <button onClick={handleElasticsearchQuery}>Search Elasticsearch</button>
        </div>
      </div>
    </div>
  );
}

