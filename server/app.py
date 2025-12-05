from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from datetime import datetime
from functools import wraps
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from google.cloud import firestore
from google.cloud import storage
from google.oauth2 import service_account
import json
import os
import socket
from dotenv import load_dotenv

load_dotenv()

# Forcing IPv4
_original_getaddrinfo = socket.getaddrinfo
def force_ipv4_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    return _original_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)
socket.getaddrinfo = force_ipv4_getaddrinfo

app = Flask(__name__)
CORS(app)

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "YOUR_GOOGLE_CLIENT_ID")
FIREBASE_SERVICE_ACCOUNT = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
PROJECT_ID = os.environ.get("PROJECT_ID")
STORAGE_BUCKET = os.environ.get("STORAGE_BUCKET")

def get_firestore_client():
    """Return Firestore client using service account JSON from env."""
    if not FIREBASE_SERVICE_ACCOUNT or not PROJECT_ID:
        raise RuntimeError("FIREBASE_SERVICE_ACCOUNT or PROJECT_ID env var not set")

    credentials = service_account.Credentials.from_service_account_info(
        json.loads(FIREBASE_SERVICE_ACCOUNT)
    )
    return firestore.Client(credentials=credentials, project=PROJECT_ID, database='ats-db')

def get_storage_client():
    """Return Firebase Storage client using service account JSON from env."""
    if not FIREBASE_SERVICE_ACCOUNT or not STORAGE_BUCKET:
        raise RuntimeError("FIREBASE_SERVICE_ACCOUNT or STORAGE_BUCKET env var not set")
    
    credentials = service_account.Credentials.from_service_account_info(
        json.loads(FIREBASE_SERVICE_ACCOUNT)
    )
    client = storage.Client(credentials=credentials, project=PROJECT_ID)
    
    # Log service account email for debugging
    service_account_email = credentials.service_account_email
    print(f"[STORAGE] Initialized storage client with service account: {service_account_email}")
    print(f"[STORAGE] Project ID: {PROJECT_ID}, Bucket: {STORAGE_BUCKET}")
    
    return client

# Token verification decorator
def require_token(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        
        if not auth_header or not auth_header.startswith('Bearer '):
            print(f"[AUTH] Missing or invalid Authorization header from {request.remote_addr}")
            return jsonify({"error": "Missing or invalid token"}), 401
        
        token = auth_header.split(' ')[1]
        
        try:
            idinfo = id_token.verify_oauth2_token(
                token,
                google_requests.Request(),
                GOOGLE_CLIENT_ID,
                clock_skew_in_seconds=10
            )
            request.user_email = idinfo.get('email')
            request.user_info = {
                "email": idinfo.get('email'),
                "name": idinfo.get('name'),
                "avatar": idinfo.get('picture')
            }
            print(f"[AUTH] Token verified successfully for user: {request.user_email}")
            return f(*args, **kwargs)
        except Exception as e:
            print(f"[AUTH] Token verification failed: {e}")
            return jsonify({"error": "Invalid token"}), 401
    
    return decorated_function

# Health check route
@app.route('/api/health', methods=['GET'])
def health_check():
    print(f"[GET /api/health] Health check request")
    return jsonify({'status': 'healthy'})

# PDF Extraction to Template endpoint
@app.route('/api/extract', methods=['POST'])
@require_token
def create_extraction_request():
    """Create a request in Firestore and upload files to Firebase Storage."""
    try:
        email = request.user_email
        print(f"[POST /api/extract] Request from user: {email}")
        
        # Check if files are present
        if 'template' not in request.files:
            return jsonify({"error": "Template file is required"}), 400
        
        template_file = request.files['template']
        if template_file.filename == '':
            return jsonify({"error": "Template file is required"}), 400
        
        # Check file extension for template (should be Excel)
        if not template_file.filename.lower().endswith(('.xlsx', '.xls')):
            return jsonify({"error": "Template must be an Excel file (.xlsx or .xls)"}), 400
        
        # Get PDF files
        pdf_files = request.files.getlist('pdfs')
        if not pdf_files or len(pdf_files) == 0:
            return jsonify({"error": "At least one PDF file is required"}), 400
        
        # Check all PDFs have valid filenames
        for pdf in pdf_files:
            if pdf.filename == '':
                return jsonify({"error": "All PDF files must have valid filenames"}), 400
            if not pdf.filename.lower().endswith('.pdf'):
                return jsonify({"error": "All files must be PDFs"}), 400
        
        # Create Firestore request document
        client = get_firestore_client()
        requests_ref = client.collection('extraction_requests')
        
        # Create document - Firestore will auto-generate ID
        request_doc = {
            'user_email': email,
            'status': 'pending',
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow(),
            'template_filename': template_file.filename,
            'pdf_filenames': [pdf.filename for pdf in pdf_files],
            'pdf_count': len(pdf_files)
        }
        
        # Add document and get its ID
        # Firestore add() returns (write_result, document_reference)
        _, doc_ref = requests_ref.add(request_doc)
        request_id = doc_ref.id
        print(f"[POST /api/extract] Created request with ID: {request_id}")
        
        # Upload files to Firebase Storage
        print(f"[POST /api/extract] Attempting to access bucket: {STORAGE_BUCKET}")
        storage_client = get_storage_client()
        
        # Ensure bucket name doesn't have gs:// prefix
        bucket_name = STORAGE_BUCKET.replace('gs://', '').strip()
        bucket = storage_client.bucket(bucket_name)
        print(f"[POST /api/extract] Using bucket name: {bucket_name}")
        
        # Upload template file
        template_blob_name = f"{request_id}/template.{template_file.filename.split('.')[-1]}"
        template_blob = bucket.blob(template_blob_name)
        
        # Reset file pointer to beginning
        template_file.seek(0)
        template_blob.upload_from_file(
            template_file, 
            content_type=template_file.content_type or 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        print(f"[POST /api/extract] Uploaded template: {template_blob_name}")
        
        # Upload PDF files
        pdf_blob_names = []
        for idx, pdf_file in enumerate(pdf_files):
            pdf_blob_name = f"{request_id}/pdf_{idx + 1}_{pdf_file.filename}"
            pdf_blob = bucket.blob(pdf_blob_name)
            
            # Reset file pointer to beginning
            pdf_file.seek(0)
            pdf_blob.upload_from_file(pdf_file, content_type='application/pdf')
            pdf_blob_names.append(pdf_blob_name)
            print(f"[POST /api/extract] Uploaded PDF {idx + 1}: {pdf_blob_name}")
        
        # Update Firestore document with blob paths
        doc_ref.update({
            'template_blob_path': template_blob_name,
            'pdf_blob_paths': pdf_blob_names,
            'updated_at': datetime.utcnow()
        })
        
        print(f"[POST /api/extract] Successfully created request {request_id} for user: {email}")
        return jsonify({
            "requestId": request_id,
            "message": "Request created successfully",
            "status": "pending"
        }), 201
        
    except Exception as e:
        error_str = str(e)
        print(f"[POST /api/extract] ERROR: {error_str}")
        import traceback
        traceback.print_exc()
        
        # Check for specific permission errors
        if "403" in error_str or "Forbidden" in error_str or "permission" in error_str.lower():
            return jsonify({
                "error": "Storage permission denied",
                "message": (
                    f"The service account does not have permission to write to bucket '{STORAGE_BUCKET}'. "
                    "Please ensure the service account has 'Storage Admin' or 'Storage Object Creator' role "
                    "at the BUCKET level (not just project level). "
                    f"Service account: ats-prod@agentic-template-spreading.iam.gserviceaccount.com"
                ),
                "details": "Go to Cloud Console > Cloud Storage > Buckets > agentic-template-spreading > Permissions and add the service account with Storage Admin role."
            }), 403
        
        return jsonify({"error": "Failed to create extraction request", "details": error_str}), 500

@app.route('/api/requests', methods=['GET'])
@require_token
def get_user_requests():
    """Get all extraction requests for the current user."""
    try:
        email = request.user_email
        print(f"[GET /api/requests] Request from user: {email}")

        client = get_firestore_client()
        requests_ref = client.collection('extraction_requests')
        
        # Query requests for this user (without order_by to avoid index requirement)
        # We'll sort in Python instead
        query = requests_ref.where('user_email', '==', email)
        docs = query.stream()
        
        # Check storage for solution files (only for completed requests)
        storage_client = None
        bucket = None
        try:
            storage_client = get_storage_client()
            bucket_name = STORAGE_BUCKET.replace('gs://', '').strip()
            bucket = storage_client.bucket(bucket_name)
        except Exception as e:
            print(f"[GET /api/requests] Warning: Could not initialize storage client: {e}")
        
        requests = []
        for doc in docs:
            data = doc.to_dict()
            created_at = data.get('created_at')
            # Store timestamp for sorting
            created_at_ts = created_at if created_at else datetime.min.replace(tzinfo=None)
            
            # Check if solution file exists in storage for completed requests
            has_output = False
            status = data.get('status', '').lower()
            if status in ('complete', 'completed') and bucket:
                try:
                    blob_path = f"{doc.id}/solution.xlsx"
                    solution_blob = bucket.blob(blob_path)
                    print(f"[GET /api/requests] Checking for solution file at path: {blob_path}")
                    has_output = solution_blob.exists()
                    print(f"[GET /api/requests] Request {doc.id}: status={status}, solution.xlsx exists={has_output}")
                    
                    # If not found, try listing blobs in the folder to see what's there
                    if not has_output:
                        print(f"[GET /api/requests] File not found, listing blobs in folder: {doc.id}/")
                        try:
                            blobs = list(bucket.list_blobs(prefix=f"{doc.id}/"))
                            blob_names = [blob.name for blob in blobs]
                            print(f"[GET /api/requests] Found blobs in folder: {blob_names}")
                        except Exception as list_err:
                            print(f"[GET /api/requests] Error listing blobs: {list_err}")
                except Exception as e:
                    print(f"[GET /api/requests] Error checking solution file for {doc.id}: {e}")
                    import traceback
                    traceback.print_exc()
                    has_output = False
            
            requests.append({
                'requestId': doc.id,
                'status': data.get('status', 'unknown'),
                'created_at': created_at.isoformat() if created_at else None,
                'updated_at': data.get('updated_at').isoformat() if data.get('updated_at') else None,
                'template_filename': data.get('template_filename'),
                'pdf_count': data.get('pdf_count', 0),
                'has_output': has_output,
                '_sort_key': created_at_ts  # Temporary field for sorting
            })
        
        # Sort by created_at descending in Python
        requests.sort(key=lambda x: x['_sort_key'], reverse=True)
        
        # Remove the temporary sort key field
        for req in requests:
            req.pop('_sort_key', None)
        
        print(f"[GET /api/requests] Found {len(requests)} requests for user: {email}")
        return jsonify({"requests": requests}), 200
        
    except Exception as e:
        print(f"[GET /api/requests] ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to fetch requests"}), 500

@app.route('/api/requests/<request_id>', methods=['GET'])
@require_token
def get_request_status(request_id):
    """Get status and details of a specific request."""
    try:
        email = request.user_email
        print(f"[GET /api/requests/<request_id>] Request from user: {email}, request_id: {request_id}")
        
        client = get_firestore_client()
        doc_ref = client.collection('extraction_requests').document(request_id)
        doc = doc_ref.get()
        
        if not doc.exists:
            return jsonify({"error": "Request not found"}), 404
        
        data = doc.to_dict()
        
        # Verify the request belongs to this user
        if data.get('user_email') != email:
            return jsonify({"error": "Unauthorized"}), 403
        
        # Check if solution file exists in storage
        has_output = False
        status = data.get('status', '').lower()
        if status in ('complete', 'completed'):
            try:
                storage_client = get_storage_client()
                bucket_name = STORAGE_BUCKET.replace('gs://', '').strip()
                bucket = storage_client.bucket(bucket_name)
                blob_path = f"{request_id}/solution.xlsx"
                solution_blob = bucket.blob(blob_path)
                print(f"[GET /api/requests/<request_id>] Checking for solution file at path: {blob_path}")
                has_output = solution_blob.exists()
                print(f"[GET /api/requests/<request_id>] solution.xlsx exists={has_output}")
                
                # If not found, try listing blobs in the folder to see what's there
                if not has_output:
                    print(f"[GET /api/requests/<request_id>] File not found, listing blobs in folder: {request_id}/")
                    try:
                        blobs = list(bucket.list_blobs(prefix=f"{request_id}/"))
                        blob_names = [blob.name for blob in blobs]
                        print(f"[GET /api/requests/<request_id>] Found blobs in folder: {blob_names}")
                    except Exception as list_err:
                        print(f"[GET /api/requests/<request_id>] Error listing blobs: {list_err}")
            except Exception as e:
                print(f"[GET /api/requests/<request_id>] Error checking solution file: {e}")
                import traceback
                traceback.print_exc()
                has_output = False
        
        response_data = {
            'requestId': request_id,
            'status': data.get('status', 'unknown'),
            'created_at': data.get('created_at').isoformat() if data.get('created_at') else None,
            'updated_at': data.get('updated_at').isoformat() if data.get('updated_at') else None,
            'template_filename': data.get('template_filename'),
            'pdf_count': data.get('pdf_count', 0),
            'pdf_filenames': data.get('pdf_filenames', []),
            'has_output': has_output
        }
        
        print(f"[GET /api/requests/<request_id>] Request status: {response_data['status']}, has_output: {has_output}")
        return jsonify(response_data), 200
        
    except Exception as e:
        print(f"[GET /api/requests/<request_id>] ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to fetch request status"}), 500

@app.route('/api/requests/<request_id>/download', methods=['GET'])
@require_token
def download_output(request_id):
    """Download the solution.xlsx file for a completed request."""
    try:
        email = request.user_email
        print(f"[GET /api/requests/<request_id>/download] Request from user: {email}, request_id: {request_id}")
        
        client = get_firestore_client()
        doc_ref = client.collection('extraction_requests').document(request_id)
        doc = doc_ref.get()
        
        if not doc.exists:
            return jsonify({"error": "Request not found"}), 404
        
        data = doc.to_dict()
        
        # Verify the request belongs to this user
        if data.get('user_email') != email:
            return jsonify({"error": "Unauthorized"}), 403
        
        # Check if request is complete
        status = data.get('status', '').lower()
        if status not in ('complete', 'completed'):
            return jsonify({"error": "Request is not complete yet"}), 400
        
        # Get the solution file from storage
        storage_client = get_storage_client()
        bucket_name = STORAGE_BUCKET.replace('gs://', '').strip()
        bucket = storage_client.bucket(bucket_name)
        
        # First, list all blobs in the folder to see what's there
        blob_names = []
        print(f"[GET /api/requests/<request_id>/download] Listing blobs in folder: {request_id}/")
        try:
            blobs = list(bucket.list_blobs(prefix=f"{request_id}/"))
            blob_names = [blob.name for blob in blobs]
            print(f"[GET /api/requests/<request_id>/download] Found blobs: {blob_names}")
        except Exception as list_err:
            print(f"[GET /api/requests/<request_id>/download] Error listing blobs: {list_err}")
        
        # Try to find solution.xlsx
        blob_path = f"{request_id}/solution.xlsx"
        print(f"[GET /api/requests/<request_id>/download] Checking for file at: {blob_path}")
        solution_blob = bucket.blob(blob_path)
        
        if not solution_blob.exists():
            # Try alternative paths
            alt_paths = [
                f"{request_id}/solution.xlsx",
                f"{request_id}solution.xlsx",
                f"solution.xlsx",
            ]
            found = False
            for alt_path in alt_paths:
                alt_blob = bucket.blob(alt_path)
                if alt_blob.exists():
                    print(f"[GET /api/requests/<request_id>/download] Found file at alternative path: {alt_path}")
                    solution_blob = alt_blob
                    found = True
                    break
            
            if not found:
                return jsonify({
                    "error": "Solution file not found",
                    "details": f"Checked path: {blob_path}. Available files in folder: {blob_names if blob_names else 'unknown'}"
                }), 404
        
        # Download the file content
        file_content = solution_blob.download_as_bytes()
        
        print(f"[GET /api/requests/<request_id>/download] Successfully downloaded solution for request: {request_id}")
        
        # Return file as download
        return Response(
            file_content,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            headers={
                'Content-Disposition': f'attachment; filename=solution_{request_id}.xlsx'
            }
        )
        
    except Exception as e:
        print(f"[GET /api/requests/<request_id>/download] ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to download solution file"}), 500

if __name__ == '__main__':
    print(f"[APP] Starting Flask server on host=0.0.0.0, port=5000, debug=True")
    app.run(debug=True, host='0.0.0.0', port=5000)
