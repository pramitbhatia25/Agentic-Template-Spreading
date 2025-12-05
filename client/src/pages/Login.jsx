import React from 'react';
import { GoogleLogin } from '@react-oauth/google';

function Login({ onLoginSuccess = () => {} }) {
  const handleGoogleSuccess = ({ credential }) => {
    if (!credential) {
      console.error('No ID token (credential) from Google.');
      return;
    }
    let payload = {};
    try {
      payload = JSON.parse(atob(credential.split('.')[1]));
    } catch {
      console.error('Failed to parse token');
      return;
    }
    onLoginSuccess({
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      token: credential
    });
  };

  const handleGoogleError = () => {
    console.error('Google login failed');
  };

  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center">
          PDF Extraction Tool
        </h1>
        <p className="text-sm text-gray-600 mb-6 text-center">
          Sign in to upload and extract data from PDFs
        </p>
        <div className="flex justify-center">
          <GoogleLogin
            onSuccess={handleGoogleSuccess}
            onError={handleGoogleError}
          />
        </div>
      </div>
    </div>
  );
}

export default Login;
