import React, { useState, useEffect } from 'react';
import { Upload as UploadIcon, File, X, CheckCircle, RefreshCw, Download, Clock, CheckCircle2, AlertCircle } from 'lucide-react';

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

  const VITE_APP_API_URL = import.meta.env.VITE_APP_API_URL;

  // Load requests on mount and after successful upload
  useEffect(() => {
    if (user) {
      loadRequests();
    }
  }, [user, requestId]);

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
        return;
      }
      setTemplateFile(file);
      setError(null);
    }
  };

  const handlePdfChange = (e) => {
    const files = Array.from(e.target.files);
    const pdfs = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length !== files.length) {
      setError('All files must be PDFs');
      return;
    }
    setPdfFiles(prev => [...prev, ...pdfs]);
    setError(null);
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
      // Reset form
      setTemplateFile(null);
      setPdfFiles([]);
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

  return (
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

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Success Message */}
          {requestId && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <h3 className="font-semibold text-green-900">Request Created Successfully!</h3>
              </div>
              <p className="text-sm text-green-700">
                Request ID: <span className="font-mono font-semibold">{requestId}</span>
              </p>
            </div>
          )}

          {/* Extract Button */}
          <button
            onClick={handleExtract}
            disabled={isUploading || !templateFile || pdfFiles.length === 0}
            className="w-full bg-green-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isUploading ? 'Creating Request...' : 'Extract'}
          </button>
        </div>

        {/* Requests List */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">Your Requests</h2>
            <button
              onClick={loadRequests}
              disabled={loadingRequests}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loadingRequests ? 'animate-spin' : ''}`} />
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
                                <Download className="w-3.5 h-3.5" />
                                Download
                              </>
                            )}
                          </button>
                        )}
                      </div>
                      <div className="text-sm text-gray-600 space-y-1">
                        <p>Template: {req.template_filename || 'N/A'}</p>
                        <p>PDFs: {req.pdf_count || 0}</p>
                        <p>Created: {formatDate(req.created_at)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => refreshRequest(req.requestId)}
                        disabled={refreshingIds.has(req.requestId)}
                        className="p-2 text-gray-600 hover:text-green-600 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
                        title="Refresh status"
                      >
                        <RefreshCw className={`w-4 h-4 ${refreshingIds.has(req.requestId) ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Upload;
