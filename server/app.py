from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from datetime import datetime
from functools import wraps
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from google.cloud import firestore
from google.cloud import storage
from google.cloud import run_v2
from google.cloud.run_v2.types import RunJobRequest, EnvVar
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
CLOUD_RUN_JOB_ID = os.environ.get("CLOUD_RUN_JOB_ID", "agentic-template-spreading-agent")
CLOUD_RUN_LOCATION = os.environ.get("CLOUD_RUN_LOCATION", "us-central1")

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
    import time
    start_time = time.time()
    request_timestamp = datetime.utcnow().isoformat()
    
    try:
        email = request.user_email
        user_info = request.user_info
        remote_addr = request.remote_addr
        user_agent = request.headers.get('User-Agent', 'Unknown')
        content_type = request.headers.get('Content-Type', 'Unknown')
        
        print(f"[POST /api/extract] ========== EXTRACT REQUEST START ==========")
        print(f"[POST /api/extract] Timestamp: {request_timestamp}")
        print(f"[POST /api/extract] User email: {email}")
        print(f"[POST /api/extract] User name: {user_info.get('name', 'N/A')}")
        print(f"[POST /api/extract] Remote address: {remote_addr}")
        print(f"[POST /api/extract] User-Agent: {user_agent}")
        print(f"[POST /api/extract] Content-Type: {content_type}")
        print(f"[POST /api/extract] Request method: {request.method}")
        print(f"[POST /api/extract] Request URL: {request.url}")
        
        # Log all form fields (excluding file data)
        print(f"[POST /api/extract] Form fields present: {list(request.form.keys())}")
        for key in request.form.keys():
            print(f"[POST /api/extract] Form field '{key}': {request.form[key]}")
        
        # Check if files are present
        print(f"[POST /api/extract] Checking for template file in request...")
        if 'template' not in request.files:
            print(f"[POST /api/extract] ERROR: Template file missing from request")
            print(f"[POST /api/extract] Available files in request: {list(request.files.keys())}")
            return jsonify({"error": "Template file is required"}), 400
        
        template_file = request.files['template']
        print(f"[POST /api/extract] Template file received: filename='{template_file.filename}', content_type='{template_file.content_type}'")
        
        if template_file.filename == '':
            print(f"[POST /api/extract] ERROR: Template filename is empty")
            return jsonify({"error": "Template file is required"}), 400
        
        # Get file size for template
        template_file.seek(0, 2)  # Seek to end
        template_size = template_file.tell()
        template_file.seek(0)  # Reset to beginning
        print(f"[POST /api/extract] Template file size: {template_size} bytes ({template_size / 1024:.2f} KB)")
        
        # Check file extension for template (should be Excel)
        template_ext = template_file.filename.lower().split('.')[-1] if '.' in template_file.filename else ''
        print(f"[POST /api/extract] Template file extension: '{template_ext}'")
        if not template_file.filename.lower().endswith(('.xlsx', '.xls')):
            print(f"[POST /api/extract] ERROR: Invalid template file extension '{template_ext}'")
            return jsonify({"error": "Template must be an Excel file (.xlsx or .xls)"}), 400
        
        # Get PDF files
        print(f"[POST /api/extract] Retrieving PDF files from request...")
        pdf_files = request.files.getlist('pdfs')
        print(f"[POST /api/extract] Number of PDF files received: {len(pdf_files) if pdf_files else 0}")
        
        if not pdf_files or len(pdf_files) == 0:
            print(f"[POST /api/extract] ERROR: No PDF files found in request")
            return jsonify({"error": "At least one PDF file is required"}), 400
        
        # Check all PDFs have valid filenames and log details
        total_pdf_size = 0
        for idx, pdf in enumerate(pdf_files):
            pdf.seek(0, 2)  # Seek to end
            pdf_size = pdf.tell()
            pdf.seek(0)  # Reset to beginning
            total_pdf_size += pdf_size
            print(f"[POST /api/extract] PDF {idx + 1}: filename='{pdf.filename}', size={pdf_size} bytes ({pdf_size / 1024:.2f} KB), content_type='{pdf.content_type}'")
            
            if pdf.filename == '':
                print(f"[POST /api/extract] ERROR: PDF {idx + 1} has empty filename")
                return jsonify({"error": "All PDF files must have valid filenames"}), 400
            if not pdf.filename.lower().endswith('.pdf'):
                print(f"[POST /api/extract] ERROR: PDF {idx + 1} has invalid extension: '{pdf.filename}'")
                return jsonify({"error": "All files must be PDFs"}), 400
        
        print(f"[POST /api/extract] Total PDF files size: {total_pdf_size} bytes ({total_pdf_size / 1024:.2f} KB)")
        print(f"[POST /api/extract] Total upload size: {template_size + total_pdf_size} bytes ({(template_size + total_pdf_size) / 1024:.2f} KB)")
        
        # Initialize Firestore client
        print(f"[POST /api/extract] Initializing Firestore client...")
        firestore_start = time.time()
        client = get_firestore_client()
        firestore_init_time = time.time() - firestore_start
        print(f"[POST /api/extract] Firestore client initialized in {firestore_init_time:.3f}s")
        print(f"[POST /api/extract] Firestore project: {PROJECT_ID}, database: ats-db")
        
        requests_ref = client.collection('extraction_requests')
        print(f"[POST /api/extract] Using Firestore collection: extraction_requests")
        
        # Create document - Firestore will auto-generate ID
        created_at = datetime.utcnow()
        request_doc = {
            'user_email': email,
            'status': 'pending',
            'created_at': created_at,
            'updated_at': created_at,
            'template_filename': template_file.filename,
            'pdf_filenames': [pdf.filename for pdf in pdf_files],
            'pdf_count': len(pdf_files)
        }
        print(f"[POST /api/extract] Creating Firestore document with data:")
        print(f"[POST /api/extract]   - user_email: {request_doc['user_email']}")
        print(f"[POST /api/extract]   - status: {request_doc['status']}")
        print(f"[POST /api/extract]   - created_at: {request_doc['created_at']}")
        print(f"[POST /api/extract]   - template_filename: {request_doc['template_filename']}")
        print(f"[POST /api/extract]   - pdf_count: {request_doc['pdf_count']}")
        print(f"[POST /api/extract]   - pdf_filenames: {request_doc['pdf_filenames']}")
        
        # Add document and get its ID
        firestore_write_start = time.time()
        _, doc_ref = requests_ref.add(request_doc)
        firestore_write_time = time.time() - firestore_write_start
        request_id = doc_ref.id
        print(f"[POST /api/extract] Firestore document created with ID: {request_id} in {firestore_write_time:.3f}s")
        print(f"[POST /api/extract] Document path: {doc_ref.path}")
        
        # Upload files to Firebase Storage
        print(f"[POST /api/extract] ========== STORAGE UPLOAD START ==========")
        print(f"[POST /api/extract] Storage bucket from env: {STORAGE_BUCKET}")
        
        storage_init_start = time.time()
        storage_client = get_storage_client()
        storage_init_time = time.time() - storage_init_start
        print(f"[POST /api/extract] Storage client initialized in {storage_init_time:.3f}s")
        
        # Ensure bucket name doesn't have gs:// prefix
        bucket_name = STORAGE_BUCKET.replace('gs://', '').strip()
        print(f"[POST /api/extract] Normalized bucket name: {bucket_name}")
        
        bucket_access_start = time.time()
        bucket = storage_client.bucket(bucket_name)
        bucket_access_time = time.time() - bucket_access_start
        print(f"[POST /api/extract] Bucket object retrieved in {bucket_access_time:.3f}s")
        print(f"[POST /api/extract] Bucket name: {bucket.name}")
        
        # Upload template file
        template_ext = template_file.filename.split('.')[-1]
        template_blob_name = f"{request_id}/template.{template_ext}"
        print(f"[POST /api/extract] Uploading template file...")
        print(f"[POST /api/extract]   - Source filename: {template_file.filename}")
        print(f"[POST /api/extract]   - Blob path: {template_blob_name}")
        print(f"[POST /api/extract]   - File size: {template_size} bytes")
        print(f"[POST /api/extract]   - Content type: {template_file.content_type or 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}")
        
        template_blob = bucket.blob(template_blob_name)
        
        # Reset file pointer to beginning
        template_file.seek(0)
        template_upload_start = time.time()
        template_blob.upload_from_file(
            template_file, 
            content_type=template_file.content_type or 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        template_upload_time = time.time() - template_upload_start
        template_blob.reload()
        print(f"[POST /api/extract] Template uploaded successfully in {template_upload_time:.3f}s")
        print(f"[POST /api/extract]   - Blob size: {template_blob.size} bytes")
        print(f"[POST /api/extract]   - Blob content type: {template_blob.content_type}")
        print(f"[POST /api/extract]   - Blob created: {template_blob.time_created}")
        
        # Upload PDF files
        print(f"[POST /api/extract] Uploading {len(pdf_files)} PDF file(s)...")
        pdf_blob_names = []
        total_pdf_upload_time = 0
        
        for idx, pdf_file in enumerate(pdf_files):
            pdf_file.seek(0, 2)
            pdf_size = pdf_file.tell()
            pdf_file.seek(0)
            
            pdf_blob_name = f"{request_id}/pdf_{idx + 1}_{pdf_file.filename}"
            print(f"[POST /api/extract] Uploading PDF {idx + 1}/{len(pdf_files)}...")
            print(f"[POST /api/extract]   - Source filename: {pdf_file.filename}")
            print(f"[POST /api/extract]   - Blob path: {pdf_blob_name}")
            print(f"[POST /api/extract]   - File size: {pdf_size} bytes ({pdf_size / 1024:.2f} KB)")
            
            pdf_blob = bucket.blob(pdf_blob_name)
            
            # Reset file pointer to beginning
            pdf_file.seek(0)
            pdf_upload_start = time.time()
            pdf_blob.upload_from_file(pdf_file, content_type='application/pdf')
            pdf_upload_time = time.time() - pdf_upload_start
            total_pdf_upload_time += pdf_upload_time
            pdf_blob.reload()
            
            pdf_blob_names.append(pdf_blob_name)
            print(f"[POST /api/extract] PDF {idx + 1} uploaded successfully in {pdf_upload_time:.3f}s")
            print(f"[POST /api/extract]   - Blob size: {pdf_blob.size} bytes")
            print(f"[POST /api/extract]   - Blob content type: {pdf_blob.content_type}")
            print(f"[POST /api/extract]   - Blob created: {pdf_blob.time_created}")
        
        print(f"[POST /api/extract] All PDFs uploaded in {total_pdf_upload_time:.3f}s (avg: {total_pdf_upload_time / len(pdf_files):.3f}s per file)")
        print(f"[POST /api/extract] ========== STORAGE UPLOAD COMPLETE ==========")
        
        # Update Firestore document with blob paths
        print(f"[POST /api/extract] Updating Firestore document with blob paths...")
        update_data = {
            'template_blob_path': template_blob_name,
            'pdf_blob_paths': pdf_blob_names,
            'updated_at': datetime.utcnow()
        }
        print(f"[POST /api/extract] Update data:")
        print(f"[POST /api/extract]   - template_blob_path: {update_data['template_blob_path']}")
        print(f"[POST /api/extract]   - pdf_blob_paths: {update_data['pdf_blob_paths']}")
        print(f"[POST /api/extract]   - updated_at: {update_data['updated_at']}")
        
        firestore_update_start = time.time()
        doc_ref.update(update_data)
        firestore_update_time = time.time() - firestore_update_start
        print(f"[POST /api/extract] Firestore document updated in {firestore_update_time:.3f}s")
        
        total_time = time.time() - start_time
        print(f"[POST /api/extract] ========== EXTRACT REQUEST SUCCESS ==========")
        print(f"[POST /api/extract] Request ID: {request_id}")
        print(f"[POST /api/extract] Total processing time: {total_time:.3f}s")
        print(f"[POST /api/extract]   - Firestore init: {firestore_init_time:.3f}s")
        print(f"[POST /api/extract]   - Firestore write: {firestore_write_time:.3f}s")
        print(f"[POST /api/extract]   - Storage init: {storage_init_time:.3f}s")
        print(f"[POST /api/extract]   - Template upload: {template_upload_time:.3f}s")
        print(f"[POST /api/extract]   - PDF uploads: {total_pdf_upload_time:.3f}s")
        print(f"[POST /api/extract]   - Firestore update: {firestore_update_time:.3f}s")
        print(f"[POST /api/extract] ============================================")
        
        return jsonify({
            "requestId": request_id,
            "message": "Request created successfully",
            "status": "pending"
        }), 201
        
    except Exception as e:
        error_str = str(e)
        error_type = type(e).__name__
        total_time = time.time() - start_time
        
        print(f"[POST /api/extract] ========== EXTRACT REQUEST ERROR ==========")
        print(f"[POST /api/extract] Error type: {error_type}")
        print(f"[POST /api/extract] Error message: {error_str}")
        print(f"[POST /api/extract] Request failed after {total_time:.3f}s")
        print(f"[POST /api/extract] User: {email if 'email' in locals() else 'Unknown'}")
        print(f"[POST /api/extract] Request ID: {request_id if 'request_id' in locals() else 'Not created'}")
        import traceback
        print(f"[POST /api/extract] Traceback:")
        traceback.print_exc()
        print(f"[POST /api/extract] ===========================================")
        
        # Check for specific permission errors
        if "403" in error_str or "Forbidden" in error_str or "permission" in error_str.lower():
            print(f"[POST /api/extract] Detected permission error - returning 403 response")
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
    import time
    start_time = time.time()
    request_timestamp = datetime.utcnow().isoformat()
    
    try:
        email = request.user_email
        user_info = request.user_info
        remote_addr = request.remote_addr
        user_agent = request.headers.get('User-Agent', 'Unknown')
        
        print(f"[GET /api/requests] ========== GET REQUESTS START ==========")
        print(f"[GET /api/requests] Timestamp: {request_timestamp}")
        print(f"[GET /api/requests] User email: {email}")
        print(f"[GET /api/requests] User name: {user_info.get('name', 'N/A')}")
        print(f"[GET /api/requests] Remote address: {remote_addr}")
        print(f"[GET /api/requests] User-Agent: {user_agent}")
        print(f"[GET /api/requests] Request method: {request.method}")
        print(f"[GET /api/requests] Request URL: {request.url}")
        print(f"[GET /api/requests] Query parameters: {dict(request.args)}")

        # Initialize Firestore client
        print(f"[GET /api/requests] Initializing Firestore client...")
        firestore_start = time.time()
        client = get_firestore_client()
        firestore_init_time = time.time() - firestore_start
        print(f"[GET /api/requests] Firestore client initialized in {firestore_init_time:.3f}s")
        print(f"[GET /api/requests] Firestore project: {PROJECT_ID}, database: ats-db")
        
        requests_ref = client.collection('extraction_requests')
        print(f"[GET /api/requests] Using Firestore collection: extraction_requests")
        
        # Query requests for this user (without order_by to avoid index requirement)
        # We'll sort in Python instead
        print(f"[GET /api/requests] Querying requests for user: {email}")
        query_start = time.time()
        query = requests_ref.where('user_email', '==', email)
        print(f"[GET /api/requests] Firestore query: collection('extraction_requests').where('user_email', '==', '{email}')")
        docs = query.stream()
        query_time = time.time() - query_start
        print(f"[GET /api/requests] Query executed in {query_time:.3f}s")
        
        # Check storage for solution files (only for completed requests)
        print(f"[GET /api/requests] Initializing storage client for solution file checks...")
        storage_client = None
        bucket = None
        storage_init_time = 0
        try:
            storage_init_start = time.time()
            storage_client = get_storage_client()
            bucket_name = STORAGE_BUCKET.replace('gs://', '').strip()
            bucket = storage_client.bucket(bucket_name)
            storage_init_time = time.time() - storage_init_start
            print(f"[GET /api/requests] Storage client initialized in {storage_init_time:.3f}s")
            print(f"[GET /api/requests] Storage bucket: {bucket_name}")
        except Exception as e:
            print(f"[GET /api/requests] WARNING: Could not initialize storage client: {e}")
            print(f"[GET /api/requests] Solution file existence checks will be skipped")
            import traceback
            traceback.print_exc()
        
        requests = []
        doc_count = 0
        completed_count = 0
        pending_count = 0
        error_count = 0
        solution_check_count = 0
        solution_found_count = 0
        
        print(f"[GET /api/requests] Processing documents from query...")
        processing_start = time.time()
        
        for doc in docs:
            doc_count += 1
            doc_id = doc.id
            data = doc.to_dict()
            
            print(f"[GET /api/requests] Processing document {doc_count}: {doc_id}")
            print(f"[GET /api/requests]   - Document path: {doc.reference.path}")
            print(f"[GET /api/requests]   - Document exists: {doc.exists}")
            
            created_at = data.get('created_at')
            updated_at = data.get('updated_at')
            status = data.get('status', 'unknown')
            template_filename = data.get('template_filename', 'N/A')
            pdf_count = data.get('pdf_count', 0)
            pdf_filenames = data.get('pdf_filenames', [])
            
            print(f"[GET /api/requests]   - Status: {status}")
            print(f"[GET /api/requests]   - Created at: {created_at}")
            print(f"[GET /api/requests]   - Updated at: {updated_at}")
            print(f"[GET /api/requests]   - Template filename: {template_filename}")
            print(f"[GET /api/requests]   - PDF count: {pdf_count}")
            if pdf_filenames:
                print(f"[GET /api/requests]   - PDF filenames: {pdf_filenames[:3]}{'...' if len(pdf_filenames) > 3 else ''}")
            
            # Count by status
            status_lower = status.lower()
            if status_lower in ('complete', 'completed'):
                completed_count += 1
            elif status_lower == 'pending':
                pending_count += 1
            elif status_lower in ('error', 'failed'):
                error_count += 1
            
            # Store timestamp for sorting
            created_at_ts = created_at if created_at else datetime.min.replace(tzinfo=None)
            
            # Check if solution file exists in storage for completed requests
            has_output = False
            if status_lower in ('complete', 'completed') and bucket:
                solution_check_count += 1
                try:
                    blob_path = f"{doc_id}/solution.xlsx"
                    print(f"[GET /api/requests]   - Checking for solution file at path: {blob_path}")
                    
                    solution_check_start = time.time()
                    solution_blob = bucket.blob(blob_path)
                    has_output = solution_blob.exists()
                    solution_check_time = time.time() - solution_check_start
                    
                    print(f"[GET /api/requests]   - Solution file check completed in {solution_check_time:.3f}s")
                    print(f"[GET /api/requests]   - Solution file exists: {has_output}")
                    
                    if has_output:
                        solution_found_count += 1
                        solution_blob.reload()
                        print(f"[GET /api/requests]   - Solution file size: {solution_blob.size} bytes ({solution_blob.size / 1024:.2f} KB)")
                        print(f"[GET /api/requests]   - Solution file created: {solution_blob.time_created}")
                        print(f"[GET /api/requests]   - Solution file updated: {solution_blob.updated}")
                    
                    # If not found, try listing blobs in the folder to see what's there
                    if not has_output:
                        print(f"[GET /api/requests]   - Solution file not found, listing blobs in folder: {doc_id}/")
                        try:
                            list_start = time.time()
                            blobs = list(bucket.list_blobs(prefix=f"{doc_id}/"))
                            list_time = time.time() - list_start
                            blob_names = [blob.name for blob in blobs]
                            blob_sizes = {blob.name: blob.size for blob in blobs}
                            print(f"[GET /api/requests]   - Blob listing completed in {list_time:.3f}s")
                            print(f"[GET /api/requests]   - Found {len(blob_names)} blob(s) in folder:")
                            for blob_name in blob_names[:10]:  # Limit to first 10
                                size = blob_sizes.get(blob_name, 0)
                                print(f"[GET /api/requests]     * {blob_name} ({size} bytes)")
                            if len(blob_names) > 10:
                                print(f"[GET /api/requests]     ... and {len(blob_names) - 10} more blob(s)")
                        except Exception as list_err:
                            print(f"[GET /api/requests]   - ERROR listing blobs: {list_err}")
                            import traceback
                            traceback.print_exc()
                except Exception as e:
                    print(f"[GET /api/requests]   - ERROR checking solution file: {e}")
                    import traceback
                    traceback.print_exc()
                    has_output = False
            elif status_lower not in ('complete', 'completed'):
                print(f"[GET /api/requests]   - Skipping solution check (status is '{status}', not completed)")
            
            request_data = {
                'requestId': doc_id,
                'status': status,
                'created_at': created_at.isoformat() if created_at else None,
                'updated_at': updated_at.isoformat() if updated_at else None,
                'template_filename': template_filename,
                'pdf_count': pdf_count,
                'has_output': has_output,
                '_sort_key': created_at_ts  # Temporary field for sorting
            }
            requests.append(request_data)
            print(f"[GET /api/requests]   - Added to results: requestId={doc_id}, status={status}, has_output={has_output}")
        
        processing_time = time.time() - processing_start
        print(f"[GET /api/requests] Processed {doc_count} document(s) in {processing_time:.3f}s")
        print(f"[GET /api/requests] Status breakdown:")
        print(f"[GET /api/requests]   - Completed: {completed_count}")
        print(f"[GET /api/requests]   - Pending: {pending_count}")
        print(f"[GET /api/requests]   - Error/Failed: {error_count}")
        print(f"[GET /api/requests]   - Other/Unknown: {doc_count - completed_count - pending_count - error_count}")
        print(f"[GET /api/requests] Solution file checks: {solution_check_count} checked, {solution_found_count} found")
        
        # Sort by created_at descending in Python
        print(f"[GET /api/requests] Sorting requests by created_at (descending)...")
        sort_start = time.time()
        requests.sort(key=lambda x: x['_sort_key'], reverse=True)
        sort_time = time.time() - sort_start
        print(f"[GET /api/requests] Sorting completed in {sort_time:.3f}s")
        
        # Remove the temporary sort key field
        for req in requests:
            req.pop('_sort_key', None)
        
        total_time = time.time() - start_time
        print(f"[GET /api/requests] ========== GET REQUESTS SUCCESS ==========")
        print(f"[GET /api/requests] Total requests found: {len(requests)}")
        print(f"[GET /api/requests] Total processing time: {total_time:.3f}s")
        print(f"[GET /api/requests]   - Firestore init: {firestore_init_time:.3f}s")
        print(f"[GET /api/requests]   - Query execution: {query_time:.3f}s")
        print(f"[GET /api/requests]   - Storage init: {storage_init_time:.3f}s")
        print(f"[GET /api/requests]   - Document processing: {processing_time:.3f}s")
        print(f"[GET /api/requests]   - Sorting: {sort_time:.3f}s")
        print(f"[GET /api/requests] ===========================================")
        
        return jsonify({"requests": requests}), 200
        
    except Exception as e:
        error_str = str(e)
        error_type = type(e).__name__
        total_time = time.time() - start_time
        
        print(f"[GET /api/requests] ========== GET REQUESTS ERROR ==========")
        print(f"[GET /api/requests] Error type: {error_type}")
        print(f"[GET /api/requests] Error message: {error_str}")
        print(f"[GET /api/requests] Request failed after {total_time:.3f}s")
        print(f"[GET /api/requests] User: {email if 'email' in locals() else 'Unknown'}")
        import traceback
        print(f"[GET /api/requests] Traceback:")
        traceback.print_exc()
        print(f"[GET /api/requests] ========================================")
        
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

@app.route('/api/requests/<request_id>/trigger', methods=['POST'])
@require_token
def trigger_cloud_run_job(request_id):
    """Trigger the Cloud Run job for a specific request."""
    try:
        email = request.user_email
        print(f"[POST /api/requests/<request_id>/trigger] Request from user: {email}, request_id: {request_id}")
        
        # Verify the request exists and belongs to this user
        client = get_firestore_client()
        doc_ref = client.collection('extraction_requests').document(request_id)
        doc = doc_ref.get()
        
        if not doc.exists:
            return jsonify({"error": "Request not found"}), 404
        
        data = doc.to_dict()
        
        # Verify the request belongs to this user
        if data.get('user_email') != email:
            return jsonify({"error": "Unauthorized"}), 403
        
        # Trigger Cloud Run job
        try:
            # Create environment variable override for REQUEST_ID
            env_var_override = EnvVar(name="REQUEST_ID", value=request_id)
            
            # Create the container override with the environment variable
            container_override = RunJobRequest.Overrides.ContainerOverride(
                env=[env_var_override]
            )
            
            # Create the overrides object
            overrides = RunJobRequest.Overrides(
                container_overrides=[container_override]
            )
            
            # Create the RunJobRequest
            job_name = f"projects/{PROJECT_ID}/locations/{CLOUD_RUN_LOCATION}/jobs/{CLOUD_RUN_JOB_ID}"
            run_job_request = RunJobRequest(
                name=job_name,
                overrides=overrides
            )
            
            # Initialize the Run client using service account
            run_client = run_v2.JobsClient.from_service_account_info(
                json.loads(FIREBASE_SERVICE_ACCOUNT)
            )
            
            # Run the job
            print(f"[POST /api/requests/<request_id>/trigger] Triggering Cloud Run job: {job_name}")
            print(f"[POST /api/requests/<request_id>/trigger] REQUEST_ID override: {request_id}")
            operation = run_client.run_job(request=run_job_request)
            print(f"[POST /api/requests/<request_id>/trigger] Cloud Run job triggered successfully")
            
            return jsonify({
                "message": "Cloud Run job triggered successfully",
                "requestId": request_id,
                "operation": operation.name if hasattr(operation, 'name') else None
            }), 200
            
        except Exception as job_error:
            error_str = str(job_error)
            print(f"[POST /api/requests/<request_id>/trigger] ERROR triggering Cloud Run job: {error_str}")
            import traceback
            traceback.print_exc()
            return jsonify({
                "error": "Failed to trigger Cloud Run job",
                "details": error_str
            }), 500
        
    except Exception as e:
        print(f"[POST /api/requests/<request_id>/trigger] ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to trigger Cloud Run job"}), 500

if __name__ == '__main__':
    print(f"[APP] Starting Flask server on host=0.0.0.0, port=5000, debug=True")
    app.run(debug=True, host='0.0.0.0', port=5000)
