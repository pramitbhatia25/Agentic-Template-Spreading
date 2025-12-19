import React, { useState, useEffect, useRef } from 'react';
import { Upload as UploadIcon, File, X, CheckCircle, RefreshCw, Download, Clock, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, Code, Brain, Terminal, Database } from 'lucide-react';

function Upload({ user }) {
  const [templateFile, setTemplateFile] = useState(null);
  const [pdfFiles, setPdfFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [requestId, setRequestId] = useState(null);
  const [error, setError] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [refreshingIds, setRefreshingIds] = useState(new Set());
  const [downloadingIds, setDownloadingIds] = useState(new Set());
  const [agentType, setAgentType] = useState('agent');
  const [agentPrompt, setAgentPrompt] = useState('');
  const [logPanelRequestId, setLogPanelRequestId] = useState(null);
  const [logMessagesByRequest, setLogMessagesByRequest] = useState({});
  const [logErrors, setLogErrors] = useState({});
  const [logLoading, setLogLoading] = useState(false);
  const [expandedOutputs, setExpandedOutputs] = useState(new Set());
  const logContainerRef = useRef(null);
  const requestsRef = useRef(requests);
  const lastMessageTimestampRef = useRef({});
  const isUserScrolledUpRef = useRef(false);
  const previousMessageCountRef = useRef({});

  const VITE_APP_API_URL = import.meta.env.VITE_APP_API_URL;

  // Keep requestsRef in sync with requests state
  useEffect(() => {
    requestsRef.current = requests;
  }, [requests]);

  // Track scroll position to determine if user is at bottom
  useEffect(() => {
    const container = logContainerRef.current;
    if (!container || !logPanelRequestId) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100; // 100px threshold
      isUserScrolledUpRef.current = !isNearBottom;
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [logPanelRequestId]);

  // Load requests on mount and after successful upload
  useEffect(() => {
    if (user) {
      loadRequests();
    }
  }, [user, requestId]);

  // Polling: Refresh requests every 30 seconds
  useEffect(() => {
    if (!user) return;

    const intervalId = setInterval(() => {
      loadRequests();
    }, 30000); // 30 seconds

    // Cleanup interval on unmount
    return () => clearInterval(intervalId);
  }, [user]);

  useEffect(() => {
    if (!logPanelRequestId || !user) {
      return;
    }

    let isActive = true;
    const controller = new AbortController();

    const fetchLogs = async () => {
      if (!isActive) {
        return;
      }

      setLogLoading(true);
      try {
        const response = await fetch(`${VITE_APP_API_URL}/api/requests/${logPanelRequestId}/logs`, {
          headers: {
            'Authorization': `Bearer ${user.token}`
          },
          signal: controller.signal
        });

        if (!isActive) {
          return;
        }

        if (response.status === 404) {
          const errorData = await response.json().catch(() => ({}));
          // Don't clear existing messages on 404, just set error
          setLogErrors(prev => ({
            ...prev,
            [logPanelRequestId]: errorData.message || 'Logs not yet ready'
          }));
          return;
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || errorData.error || 'Failed to load logs');
        }

        const data = await response.json();
        console.log('[LOGS] Received log data:', data);
        const allMessages = Array.isArray(data.messages) ? data.messages : [];
        console.log('[LOGS] Extracted messages:', allMessages.length);

        if (allMessages.length > 0) {
          // Sort messages by timestamp to ensure correct chronological order
          // The API should return messages in order, but we sort as a safety measure
          const sortedMessages = [...allMessages].sort((a, b) => {
            const tsA = a.timestamp || a.created_at || '';
            const tsB = b.timestamp || b.created_at || '';
            
            if (!tsA && !tsB) return 0;
            if (!tsA) return 1;
            if (!tsB) return -1;
            
            const dateA = new Date(tsA).getTime();
            const dateB = new Date(tsB).getTime();
            
            if (dateA === dateB) {
              // For same timestamp, maintain original API order (don't reorder)
              return 0;
            }
            
            return dateA - dateB;
          });

          // Update last timestamp
          const latestTimestamp = Math.max(
            ...sortedMessages.map(msg => {
              const ts = msg.timestamp || msg.created_at;
              return ts ? new Date(ts).getTime() : 0;
            }),
            lastMessageTimestampRef.current[logPanelRequestId] || 0
          );
          lastMessageTimestampRef.current[logPanelRequestId] = latestTimestamp;

          // Replace entire array with sorted messages from API
          // This ensures we always have the correct order and no duplicates
          setLogMessagesByRequest(prev => ({
            ...prev,
            [logPanelRequestId]: sortedMessages
          }));
        }

        setLogErrors(prev => ({
          ...prev,
          [logPanelRequestId]: null
        }));
      } catch (err) {
        if (!isActive) {
          return;
        }
        if (err.name !== 'AbortError') {
          setLogErrors(prev => ({
            ...prev,
            [logPanelRequestId]: err.message || 'Failed to load logs'
          }));
        }
      } finally {
        if (isActive) {
          setLogLoading(false);
        }
      }
    };

    const pollLogs = async () => {
      while (isActive) {
        await fetchLogs();

        if (!isActive) {
          break;
        }

        // Check if request is completed by looking at current requests state
        // Use ref to get the latest requests state
        const currentRequest = requestsRef.current.find(req => req.requestId === logPanelRequestId);
        const requestCompleted = currentRequest && ['complete', 'completed'].includes((currentRequest.status || '').toLowerCase());

        if (requestCompleted || !isActive) {
          break;
        }

        // If not completed, continue to next fetch (no fixed delay - just fetch again)
      }
    };

    // Start polling
    pollLogs();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [logPanelRequestId, user]);

  // Reset timestamp tracking when opening a new log panel
  useEffect(() => {
    if (logPanelRequestId) {
      lastMessageTimestampRef.current[logPanelRequestId] = 0;
      isUserScrolledUpRef.current = false;
      previousMessageCountRef.current[logPanelRequestId] = 0;
      setExpandedOutputs(new Set()); // Reset expanded outputs

      // Scroll to bottom when first opening the panel
      setTimeout(() => {
        if (logContainerRef.current) {
          logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
      }, 100);
    }
  }, [logPanelRequestId]);

  // Track previous message count to identify new messages
  useEffect(() => {
    if (logPanelRequestId) {
      const messages = logMessagesByRequest[logPanelRequestId] || [];
      if (messages.length > 0) {
        const currentCount = messages.length;
        const previousCount = previousMessageCountRef.current[logPanelRequestId] || 0;

        // Only update if count increased (new messages added)
        if (currentCount > previousCount) {
          // Use setTimeout to update after render, so new messages get animated
          setTimeout(() => {
            previousMessageCountRef.current[logPanelRequestId] = currentCount;
          }, 600); // After animation completes
        }
      }
    }
  }, [logPanelRequestId, logMessagesByRequest]);

  useEffect(() => {
    if (logContainerRef.current && logPanelRequestId) {
      const container = logContainerRef.current;
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;

      // Only auto-scroll if user is already at/near the bottom
      if (isNearBottom || !isUserScrolledUpRef.current) {
        // Use smooth scrolling
        container.scrollTo({
          top: scrollHeight,
          behavior: 'smooth'
        });
      }
    }
  }, [logMessagesByRequest, logPanelRequestId]);

  const loadRequests = async () => {
    setLoadingRequests(true);
    try {
      const response = await fetch(`${VITE_APP_API_URL}/api/requests`, {
        headers: {
          'Authorization': `Bearer ${user.token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setRequests(data.requests || []);
      }
    } catch (err) {
      console.error('Failed to load requests:', err);
    } finally {
      setLoadingRequests(false);
    }
  };

  const refreshRequest = async (requestId) => {
    setRefreshingIds(prev => new Set(prev).add(requestId));
    try {
      const response = await fetch(`${VITE_APP_API_URL}/api/requests/${requestId}`, {
        headers: {
          'Authorization': `Bearer ${user.token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        // Update the request in the list
        setRequests(prev => prev.map(req =>
          req.requestId === requestId ? { ...req, ...data } : req
        ));
      }
    } catch (err) {
      console.error('Failed to refresh request:', err);
    } finally {
      setRefreshingIds(prev => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  };

  const downloadOutput = async (requestId) => {
    setDownloadingIds(prev => new Set(prev).add(requestId));
    setError(null);
    try {
      const response = await fetch(`${VITE_APP_API_URL}/api/requests/${requestId}/download`, {
        headers: {
          'Authorization': `Bearer ${user.token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.details || 'Failed to download file');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `solution_${requestId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError(err.message || 'Failed to download file');
    } finally {
      setDownloadingIds(prev => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  };

  const handleTemplateChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.xlsx') && !file.name.toLowerCase().endsWith('.xls')) {
        setError('Template must be an Excel file (.xlsx or .xls)');
        // Reset the input so selecting the same invalid file again will still trigger onChange
        e.target.value = '';
        return;
      }
      setTemplateFile(file);
      setError(null);
    }
    // Clear the input value so the user can select the same file again for a new request
    e.target.value = '';
  };

  const handlePdfChange = (e) => {
    const files = Array.from(e.target.files);
    const pdfs = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length !== files.length) {
      setError('All files must be PDFs');
      // Reset the input so selecting the same invalid files again will still trigger onChange
      e.target.value = '';
      return;
    }
    setPdfFiles(prev => [...prev, ...pdfs]);
    setError(null);
    // Clear the input value so the user can select the same files again for a new request
    e.target.value = '';
  };

  const removePdf = (index) => {
    setPdfFiles(prev => prev.filter((_, i) => i !== index));
  };

  const removeTemplate = () => {
    setTemplateFile(null);
  };

  const handleExtract = async () => {
    if (!templateFile) {
      setError('Please upload a template file');
      return;
    }
    if (pdfFiles.length === 0) {
      setError('Please upload at least one PDF file');
      return;
    }

    setIsUploading(true);
    setError(null);
    setRequestId(null);

    try {
      const formData = new FormData();
      formData.append('template', templateFile);
      pdfFiles.forEach(pdf => {
        formData.append('pdfs', pdf);
      });
      formData.append('agent_type', agentType);
      formData.append('agent_prompt', agentPrompt || '');

      const response = await fetch(`${VITE_APP_API_URL}/api/extract`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.token}`
        },
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create extraction request');
      }

      setRequestId(data.requestId);

      // Trigger Cloud Run job
      try {
        const triggerResponse = await fetch(`${VITE_APP_API_URL}/api/requests/${data.requestId}/trigger`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${user.token}`
          }
        });

        if (!triggerResponse.ok) {
          const triggerError = await triggerResponse.json().catch(() => ({}));
          console.error('Failed to trigger Cloud Run job:', triggerError);
          // Don't fail the whole request, just log the error
        } else {
          console.log('Cloud Run job triggered successfully');
        }
      } catch (triggerErr) {
        console.error('Error triggering Cloud Run job:', triggerErr);
        // Don't fail the whole request, just log the error
      }

      // Reset form after successful request creation
      setTemplateFile(null);
      setPdfFiles([]);
      setAgentPrompt('');
      setAgentType('agent'); // Reset to default
      // Reload requests to show the new one
      await loadRequests();
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setIsUploading(false);
    }
  };

  const getStatusIcon = (status) => {
    const statusLower = (status || '').toLowerCase();
    switch (statusLower) {
      case 'complete':
      case 'completed':
        return <CheckCircle2 className="w-5 h-5 text-green-600" />;
      case 'pending':
      case 'processing':
        return <Clock className="w-5 h-5 text-yellow-600" />;
      case 'failed':
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      default:
        return <Clock className="w-5 h-5 text-gray-600" />;
    }
  };

  const getStatusColor = (status) => {
    const statusLower = (status || '').toLowerCase();
    switch (statusLower) {
      case 'complete':
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'pending':
      case 'processing':
        return 'bg-yellow-100 text-yellow-800';
      case 'failed':
      case 'error':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch {
      return dateString;
    }
  };

  const calculateTimeToCompletion = (createdAt, updatedAt) => {
    if (!createdAt || !updatedAt) return null;
    try {
      const created = new Date(createdAt);
      const updated = new Date(updatedAt);
      const diffMs = updated - created;

      if (diffMs < 0) return null;

      const seconds = Math.floor(diffMs / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) {
        return `${days}d ${hours % 24}h ${minutes % 60}m`;
      } else if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
      } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
      } else {
        return `${seconds}s`;
      }
    } catch {
      return null;
    }
  };

  const formatLogSnippet = (msg) => {
    if (msg.item?.text) {
      return msg.item.text;
    }
    if (msg.item?.aggregated_output) {
      return null; // Handled separately in render
    }
    if (msg.command) {
      return null; // Handled separately in render
    }
    if (msg.message) {
      return msg.message;
    }
    // For simple event types, don't show JSON
    if (['thread.started', 'turn.started', 'turn.completed', 'item.started', 'item.completed'].includes(msg.type)) {
      return null;
    }
    // Only show JSON for complex messages that need it
    return null;
  };

  const formatLogTimestamp = (msg) => {
    const timestamp = msg.timestamp || msg.created_at;
    if (!timestamp) {
      return null;
    }
    const parsed = new Date(timestamp);
    if (isNaN(parsed)) {
      return null;
    }
    return parsed.toLocaleTimeString();
  };

  const currentLogMessages = logPanelRequestId ? (logMessagesByRequest[logPanelRequestId] || []) : [];
  const currentLogError = logPanelRequestId ? logErrors[logPanelRequestId] : null;

  // Calculate analytics from messages
  const calculateAnalytics = (messages) => {
    let totalItems = 0;
    const codeExecutionIds = new Set();
    const successfulCodeExecutionIds = new Set();
    let reasoningCount = 0;
    let commandExecutions = 0;

    messages.forEach(msg => {
      if (msg.item) {
        totalItems++;
        
        if (msg.item.type === 'command_execution' && msg.item.id) {
          // Track unique command executions by ID (they appear as started/completed pairs)
          codeExecutionIds.add(msg.item.id);
          
          // Only count as successful if status is "completed" and exit_code is 0
          if (msg.item.status === 'completed' && msg.item.exit_code === 0) {
            successfulCodeExecutionIds.add(msg.item.id);
          }
        }
        
        if (msg.item.type === 'reasoning') {
          reasoningCount++;
        }
      }
      
      if (msg.command) {
        commandExecutions++;
      }
    });

    return {
      totalItems,
      codeExecutions: codeExecutionIds.size,
      successfulCodeExecutions: successfulCodeExecutionIds.size,
      reasoningCount,
      commandExecutions
    };
  };

  const analytics = currentLogMessages.length > 0 ? calculateAnalytics(currentLogMessages) : {
    totalItems: 0,
    codeExecutions: 0,
    successfulCodeExecutions: 0,
    reasoningCount: 0,
    commandExecutions: 0
  };

  // Extract usage information from last message if it's turn.completed
  const lastMessage = currentLogMessages.length > 0 ? currentLogMessages[currentLogMessages.length - 1] : null;
  const usage = lastMessage && lastMessage.type === 'turn.completed' && lastMessage.usage ? lastMessage.usage : null;

  // Format numbers with commas
  const formatNumber = (num) => {
    if (num == null) return '0';
    return num.toLocaleString();
  };

  // Toggle expanded output
  const toggleOutput = (messageKey) => {
    setExpandedOutputs(prev => {
      const next = new Set(prev);
      if (next.has(messageKey)) {
        next.delete(messageKey);
      } else {
        next.add(messageKey);
      }
      return next;
    });
  };

  // Debug logging
  if (logPanelRequestId) {
    console.log('[LOGS RENDER] Request ID:', logPanelRequestId);
    console.log('[LOGS RENDER] Messages count:', currentLogMessages.length);
    console.log('[LOGS RENDER] Messages:', currentLogMessages);
    console.log('[LOGS RENDER] Error:', currentLogError);
    console.log('[LOGS RENDER] All log messages by request:', logMessagesByRequest);
  }
  return (
    <>
      <style>{`
        @keyframes fadeInSlide {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
      <div className="w-full h-full overflow-auto bg-gray-50">
        <div className="max-w-6xl mx-auto px-6 py-8">
          {/* Upload Form */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 mb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">PDF Extraction to Template</h1>
            <p className="text-sm text-gray-600 mb-6">
              Upload a template Excel file and PDF files to extract data
            </p>

            {/* Template Upload */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Template Excel File <span className="text-red-500">*</span>
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-green-500 transition-colors">
                {templateFile ? (
                  <div className="flex items-center justify-between bg-gray-50 p-3 rounded">
                    <div className="flex items-center gap-3">
                      <File className="w-5 h-5 text-green-600" />
                      <span className="text-sm text-gray-700">{templateFile.name}</span>
                    </div>
                    <button
                      onClick={removeTemplate}
                      className="text-gray-400 hover:text-red-500"
                      type="button"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                ) : (
                  <label className="cursor-pointer">
                    <UploadIcon className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-600 mb-1">
                      Click to upload or drag and drop
                    </p>
                    <p className="text-xs text-gray-500">Excel files only (.xlsx, .xls)</p>
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleTemplateChange}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>

            {/* PDF Upload */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                PDF Files <span className="text-red-500">*</span>
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-green-500 transition-colors">
                <label className="cursor-pointer">
                  <UploadIcon className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600 mb-1">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-xs text-gray-500">PDF files only</p>
                  <input
                    type="file"
                    accept=".pdf"
                    multiple
                    onChange={handlePdfChange}
                    className="hidden"
                  />
                </label>
              </div>

              {/* PDF File List */}
              {pdfFiles.length > 0 && (
                <div className="mt-4 space-y-2">
                  {pdfFiles.map((pdf, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between bg-gray-50 p-3 rounded"
                    >
                      <div className="flex items-center gap-3">
                        <File className="w-5 h-5 text-red-600" />
                        <span className="text-sm text-gray-700">{pdf.name}</span>
                      </div>
                      <button
                        onClick={() => removePdf(index)}
                        className="text-gray-400 hover:text-red-500"
                        type="button"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Agent Configuration */}
            <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Agent Type
                </label>
                <select
                  value={agentType}
                  onChange={(e) => setAgentType(e.target.value)}
                  className="block w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm shadow-sm focus:border-green-500 focus:ring-1 focus:ring-green-500"
                >
                  <option value="agent">Agent</option>
                  <option value="codex_agent">Codex Agent</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Agent Prompt (optional)
                </label>
                <textarea
                  value={agentPrompt}
                  onChange={(e) => setAgentPrompt(e.target.value)}
                  rows={3}
                  placeholder="Enter a custom prompt for this request..."
                  className="block w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm shadow-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 resize-none"
                />
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Extract Button */}
            <button
              onClick={handleExtract}
              disabled={isUploading || !templateFile || pdfFiles.length === 0}
              className="w-full bg-green-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              title={
                isUploading
                  ? 'Creating extraction request...'
                  : !templateFile
                    ? 'Please upload a template file'
                    : pdfFiles.length === 0
                      ? 'Please upload at least one PDF file'
                      : 'Click to extract data from PDFs'
              }
            >
              {isUploading ? (
                <span className="flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Creating Request...
                </span>
              ) : !templateFile || pdfFiles.length === 0 ? (
                'Extract (Upload files first)'
              ) : (
                'Extract'
              )}
            </button>

            {/* Success Message - Dismissible */}
            {requestId && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <div>
                    <h3 className="font-semibold text-green-900">Request Created Successfully!</h3>
                    <p className="text-sm text-green-700">
                      Request ID: <span className="font-mono font-semibold">{requestId}</span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setRequestId(null)}
                  className="text-green-600 hover:text-green-800 transition-colors p-1 rounded hover:bg-green-100 cursor-pointer"
                  title="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>

          {/* Requests List */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">Your Requests</h2>
              <button
                onClick={loadRequests}
                disabled={loadingRequests}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 cursor-pointer ${loadingRequests ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {loadingRequests && requests.length === 0 ? (
              <div className="text-center py-8 text-gray-500">Loading requests...</div>
            ) : requests.length === 0 ? (
              <div className="text-center py-8 text-gray-500">No requests yet. Create one above!</div>
            ) : (
              <div className="space-y-4">
                {requests.map((req) => (
                  <div
                    key={req.requestId}
                    className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          {getStatusIcon(req.status)}
                          <span className="font-mono text-sm text-gray-600">{req.requestId}</span>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(req.status)}`}>
                            {req.status}
                          </span>
                          {(req.status === 'complete' || req.status === 'completed') && (
                            <button
                              onClick={() => downloadOutput(req.requestId)}
                              disabled={downloadingIds.has(req.requestId)}
                              className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-800 hover:bg-green-200 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {downloadingIds.has(req.requestId) ? (
                                <>
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  Downloading...
                                </>
                              ) : (
                                <>
                                  <Download className="w-3.5 h-3.5 cursor-pointer" />
                                  Download
                                </>
                              )}
                            </button>
                          )}
                        </div>
                        <div className="text-sm text-gray-600 space-y-1">
                          <p>Template: {req.template_filename || 'N/A'}</p>
                          <p>PDFs: {req.pdf_count || 0}</p>
                          <p>Agent: {req.agent_type || 'agent'}</p>
                          {req.agent_prompt && (
                            <p>Prompt: <span className="italic">{req.agent_prompt}</span></p>
                          )}
                          <p>Created: {formatDate(req.created_at)}</p>
                          {(req.status === 'complete' || req.status === 'completed') && req.created_at && req.updated_at && (
                            <p className="text-green-700 font-medium">
                              Completed in: {calculateTimeToCompletion(req.created_at, req.updated_at) || 'N/A'}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => refreshRequest(req.requestId)}
                          disabled={refreshingIds.has(req.requestId)}
                          className="p-2 text-gray-600 hover:text-green-600 hover:bg-gray-100 rounded transition-colors disabled:opacity-50 cursor-pointer"
                          title="Refresh status"
                        >
                          <RefreshCw className={`w-4 h-4 cursor-pointer ${refreshingIds.has(req.requestId) ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          onClick={() => setLogPanelRequestId(req.requestId)}
                          className={`px-3 py-1 cursor-pointer text-xs font-semibold rounded transition ${logPanelRequestId === req.requestId ? 'bg-green-600 text-white' : 'border border-gray-300 text-gray-700 hover:border-gray-400 hover:text-gray-900'}`}
                          title="View execution logs"
                        >
                          {logPanelRequestId === req.requestId ? 'Viewing Logs' : 'View Logs'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Logs Modal Popup */}
          {logPanelRequestId && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
              onClick={(e) => {
                // Close modal when clicking outside
                if (e.target === e.currentTarget) {
                  setLogPanelRequestId(null);
                }
              }}
            >
              <div className="bg-white rounded-lg border border-gray-200 w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl">
                {/* Header */}
                <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-900">Streaming Execution Logs</p>
                    <p className="font-mono text-xs text-gray-600 mt-1">{logPanelRequestId}</p>
                    <p className="text-[11px] uppercase tracking-widest text-gray-500 mt-1">
                      {logLoading ? (
                        <span className="flex items-center gap-2">
                          <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                          Updating in real-time • fetching continuously
                        </span>
                      ) : (
                        'Fetching continuously until completed'
                      )}
                    </p>
                    <div className="mt-5 space-y-3">
                      <div className="text-gray-600 text-[12px] flex items-center gap-5">
                        <span>
                          Showing {currentLogMessages.length} message{currentLogMessages.length !== 1 ? 's' : ''}
                        </span>
                        {logLoading && (
                          <span className="flex items-center gap-1 text-green-600">
                            <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                            Live
                          </span>
                        )}
                      </div>
                      {/* Analytics Cards */}
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-sm">
                            <div className="flex items-center gap-1.5 mb-1">
                              <File className="w-3.5 h-3.5 text-gray-500" />
                              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Items</span>
                            </div>
                            <p className="text-lg font-bold text-gray-900">{analytics.totalItems}</p>
                          </div>
                          <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-sm">
                            <div className="flex items-center gap-1.5 mb-1">
                              <Code className="w-3.5 h-3.5 text-blue-500" />
                              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Code Exec</span>
                            </div>
                            <p className="text-lg font-bold text-gray-900">{analytics.codeExecutions}</p>
                          </div>
                          <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-sm">
                            <div className="flex items-center gap-1.5 mb-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Success</span>
                            </div>
                            <p className="text-lg font-bold text-green-600">{analytics.successfulCodeExecutions}</p>
                          </div>
                          <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-sm">
                            <div className="flex items-center gap-1.5 mb-1">
                              <Brain className="w-3.5 h-3.5 text-purple-500" />
                              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Reasoning</span>
                            </div>
                            <p className="text-lg font-bold text-gray-900">{analytics.reasoningCount}</p>
                          </div>
                        </div>
                        {/* Usage Cards - Only show if turn.completed with usage */}
                        {usage && (
                          <div className="grid grid-cols-3 gap-2">
                            <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-sm">
                              <div className="flex items-center gap-1.5 mb-1">
                                <Database className="w-3.5 h-3.5 text-indigo-500" />
                                <span className="text-[10px] text-gray-500 uppercase tracking-wide">Input Tokens</span>
                              </div>
                              <p className="text-lg font-bold text-gray-900">{formatNumber(usage.input_tokens)}</p>
                            </div>
                            <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-sm">
                              <div className="flex items-center gap-1.5 mb-1">
                                <Database className="w-3.5 h-3.5 text-cyan-500" />
                                <span className="text-[10px] text-gray-500 uppercase tracking-wide">Cached Input</span>
                              </div>
                              <p className="text-lg font-bold text-gray-900">{formatNumber(usage.cached_input_tokens)}</p>
                            </div>
                            <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-sm">
                              <div className="flex items-center gap-1.5 mb-1">
                                <Database className="w-3.5 h-3.5 text-teal-500" />
                                <span className="text-[10px] text-gray-500 uppercase tracking-wide">Output Tokens</span>
                              </div>
                              <p className="text-lg font-bold text-gray-900">{formatNumber(usage.output_tokens)}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLogPanelRequestId(null)}
                    className="text-gray-500 hover:text-gray-700 transition-colors p-2 hover:bg-gray-100 rounded cursor-pointer"
                    title="Close logs"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Error Message */}
                {currentLogError && (
                  <div className="mx-4 mt-4 rounded bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
                    {currentLogError}
                  </div>
                )}

                {/* Scrollable Log Content */}
                <div
                  ref={logContainerRef}
                  className="flex-1 overflow-y-auto bg-gray-50 border-t border-gray-200 p-4 text-xs font-mono text-gray-700 space-y-3"
                >
                  {currentLogMessages.length === 0 ? (
                    <div className="text-gray-500 text-center py-8">
                      <p className="text-base">Waiting for log output...</p>
                      {logLoading && (
                        <p className="text-gray-400 text-sm mt-2 flex items-center justify-center gap-2">
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Loading logs...
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      {currentLogMessages.map((msg, idx) => {
                        const previousCount = previousMessageCountRef.current[logPanelRequestId] || 0;
                        const isNewMessage = idx >= previousCount;

                        return (
                          <div
                            key={`${msg.type}-${msg.timestamp || msg.created_at || ''}-${msg.item?.id || ''}-${msg.thread_id || ''}-${idx}`}
                            className={`border-l-2 border-gray-300 pl-3 py-2 hover:bg-gray-100 rounded transition-colors ${isNewMessage
                                ? 'bg-green-50/50'
                                : 'bg-white'
                              }`}
                            style={isNewMessage ? {
                              animation: 'fadeInSlide 0.5s ease-out forwards'
                            } : {}}
                          >
                            <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-gray-500 mb-1">
                              <span className="font-semibold">{msg.type}</span>
                              <span>{formatLogTimestamp(msg) || '—'}</span>
                            </div>
                            {(msg.item?.id || msg.thread_id) && (
                              <p className="text-sm text-gray-900 font-semibold mb-1">
                                {msg.item?.id ? `${msg.item.id} • ${msg.item?.type || 'item'}` : msg.thread_id}
                              </p>
                            )}
                            {formatLogSnippet(msg) && (
                              <p className="text-[12px] text-gray-700 leading-relaxed whitespace-pre-wrap break-words">
                                {formatLogSnippet(msg)}
                              </p>
                            )}
                            {msg.command && (
                              <div className="mt-1">
                                <p className="text-[11px] text-blue-600 font-mono">
                                  $ {msg.command}
                                </p>
                                {msg.item?.exit_code !== null && msg.item?.exit_code !== undefined && (
                                  <p className="text-[10px] text-gray-500 mt-1">
                                    Exit code: <span className={msg.item.exit_code === 0 ? 'text-green-600' : 'text-red-600'}>{msg.item.exit_code}</span>
                                  </p>
                                )}
                              </div>
                            )}
                            {msg.item?.aggregated_output && (() => {
                              const messageKey = `${msg.type}-${msg.timestamp || msg.created_at || ''}-${msg.item?.id || ''}-${idx}`;
                              const isExpanded = expandedOutputs.has(messageKey);
                              const outputLength = msg.item.aggregated_output.length;
                              const shouldTruncate = outputLength > 200;
                              
                              return (
                                <div className="mt-2 bg-gray-100 rounded border border-gray-200">
                                  <button
                                    onClick={() => toggleOutput(messageKey)}
                                    className="w-full flex items-center justify-between p-2 hover:bg-gray-200 transition-colors rounded-t"
                                  >
                                    <p className="text-[11px] text-gray-600 font-medium">Output:</p>
                                    {shouldTruncate && (
                                      <div className="flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer">
                                        <span>{isExpanded ? 'Collapse' : 'Expand'}</span>
                                        {isExpanded ? (
                                          <ChevronUp className="w-3.5 h-3.5" />
                                        ) : (
                                          <ChevronDown className="w-3.5 h-3.5" />
                                        )}
                                      </div>
                                    )}
                                  </button>
                                  {(isExpanded || !shouldTruncate) && (
                                    <div className="p-2 pt-0">
                                      <pre className="text-[11px] text-gray-800 whitespace-pre-wrap break-words">
                                        {msg.item.aggregated_output}
                                      </pre>
                                    </div>
                                  )}
                                  {!isExpanded && shouldTruncate && (
                                    <div className="p-2 pt-0">
                                      <pre className="text-[11px] text-gray-800 whitespace-pre-wrap break-words">
                                        {msg.item.aggregated_output.substring(0, 200)}...
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}

export default Upload;
