#!/usr/bin/env node
'use strict';

require('dotenv').config(); // Load environment variables

// ==============================================
// Configuration Section
// ==============================================
const CONFIG = {
  HOST: 'www.maishapay.net',
  PORT: 443,
  BASE_URL: 'https://www.maishapay.net',
  TIMEOUT: 15000, // Increased timeout
  OUTPUT_DIR: './maishapay-test-results',
  MAX_RETRIES: 2,
  RETRY_DELAY: 1000,
  
  // Endpoints to test
  ENDPOINTS: [
    { 
      name: 'Health Check', 
      path: '/health',
      expectedStatus: 200
    },
    { 
      name: 'API Root', 
      path: '/merchant/api/v1',
      expectedStatus: 200,
      headers: {
        'X-Public-Key': process.env.MAISHAPAY_PUBLIC_KEY,
        'X-Secret-Key': process.env.MAISHAPAY_SECRET_KEY
      }
    },
    { 
      name: 'API Docs', 
      path: '/api_docs/en/',
      expectedStatus: 200,
      contentType: 'text/html'
    }
  ],

  // TLS versions to test (updated methods)
  TLS_VERSIONS: [
    { version: 'TLSv1.2', method: 'TLSv1_2_method' },
    { version: 'TLSv1.1', method: 'TLSv1_1_method' }
  ],

  // Headers to include in all requests
  DEFAULT_HEADERS: {
    'User-Agent': 'MaishaPayTester/2.0',
    'Accept': 'application/json, text/html',
    'Accept-Language': 'en-US,en;q=0.9'
  }
};

// ==============================================
// Dependencies
// ==============================================
const https = require('https');
const axios = require('axios');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

// Promisify fs methods
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

// ==============================================
// Utility Functions
// ==============================================

async function ensureOutputDir() {
  try {
    await mkdir(CONFIG.OUTPUT_DIR, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ==============================================
// Test Functions
// ==============================================

async function testTlsConnection(tlsVersion) {
  const options = {
    host: CONFIG.HOST,
    port: CONFIG.PORT,
    secureProtocol: tlsVersion.method,
    rejectUnauthorized: true,
    servername: CONFIG.HOST,
    timeout: CONFIG.TIMEOUT
  };

  return new Promise((resolve, reject) => {
    const socket = tls.connect(options, () => {
      const result = {
        connected: socket.authorized,
        authorized: socket.authorized,
        cipher: socket.getCipher(),
        protocol: socket.getProtocol(),
        certificate: socket.getCertificate(),
        peerCertificate: socket.getPeerCertificate(),
        timestamp: new Date().toISOString()
      };
      socket.end();
      resolve(result);
    });

    socket.on('error', error => {
      reject(error);
    });

    socket.on('timeout', () => {
      socket.destroy(new Error('TLS connection timeout'));
    });
  });
}

async function makeRequest(url, options, retries = CONFIG.MAX_RETRIES) {
  let lastError;
  
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await axios({
        ...options,
        url,
        timeout: CONFIG.TIMEOUT,
        httpsAgent: options.httpsAgent,
        headers: {
          ...CONFIG.DEFAULT_HEADERS,
          ...(options.headers || {})
        },
        validateStatus: () => true
      });
      return response;
    } catch (error) {
      lastError = error;
      if (i < retries) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
      }
    }
  }
  
  throw lastError;
}

async function testEndpoint(endpoint, tlsVersion) {
  const url = `${CONFIG.BASE_URL}${endpoint.path}`;
  const options = {
    method: endpoint.method || 'GET',
    httpsAgent: new https.Agent({
      secureProtocol: tlsVersion.method,
      rejectUnauthorized: true,
      timeout: CONFIG.TIMEOUT
    }),
    headers: endpoint.headers || {}
  };

  try {
    const startTime = Date.now();
    const response = await makeRequest(url, options);
    const duration = Date.now() - startTime;

    return {
      url,
      status: response.status,
      statusText: response.statusText,
      duration,
      headers: response.headers,
      data: response.data,
      tlsVersion: tlsVersion.version,
      timestamp: new Date().toISOString(),
      success: true
    };
  } catch (error) {
    return {
      url,
      error: {
        message: error.message,
        code: error.code,
        stack: error.stack,
        response: error.response ? {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data
        } : null
      },
      tlsVersion: tlsVersion.version,
      timestamp: new Date().toISOString(),
      success: false
    };
  }
}

async function runTestsForTlsVersion(tlsVersion) {
  const results = {
    tlsVersion: tlsVersion.version,
    timestamp: new Date().toISOString(),
    endpoints: []
  };

  try {
    results.tlsConnection = await testTlsConnection(tlsVersion);
    console.log(`✅ [${tlsVersion.version}] TLS connection successful`);
  } catch (error) {
    results.tlsConnection = { error: error.message };
    console.error(`❌ [${tlsVersion.version}] TLS connection failed: ${error.message}`);
  }

  for (const endpoint of CONFIG.ENDPOINTS) {
    const result = await testEndpoint(endpoint, tlsVersion);
    results.endpoints.push(result);

    if (result.success) {
      console.log(`✅ [${tlsVersion.version}] ${endpoint.name}: ${result.status}`);
    } else {
      console.error(`❌ [${tlsVersion.version}] ${endpoint.name} failed: ${result.error.message}`);
    }
  }

  const filename = path.join(CONFIG.OUTPUT_DIR, `results-${sanitizeFilename(tlsVersion.version)}.json`);
  await writeFile(filename, JSON.stringify(results, null, 2));

  return results;
}

async function runTestsWithDefaultTls() {
  const results = {
    tlsVersion: 'default',
    timestamp: new Date().toISOString(),
    endpoints: []
  };

  for (const endpoint of CONFIG.ENDPOINTS) {
    const url = `${CONFIG.BASE_URL}${endpoint.path}`;
    const options = {
      method: endpoint.method || 'GET',
      headers: endpoint.headers || {},
      timeout: CONFIG.TIMEOUT
    };

    try {
      const startTime = Date.now();
      const response = await axios(url, options);
      const duration = Date.now() - startTime;

      results.endpoints.push({
        url,
        status: response.status,
        statusText: response.statusText,
        duration,
        headers: response.headers,
        data: response.data,
        tlsVersion: 'default',
        timestamp: new Date().toISOString(),
        success: true
      });
      console.log(`✅ [default] ${endpoint.name}: ${response.status}`);
    } catch (error) {
      results.endpoints.push({
        url,
        error: {
          message: error.message,
          code: error.code,
          stack: error.stack,
          response: error.response ? {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data
          } : null
        },
        tlsVersion: 'default',
        timestamp: new Date().toISOString(),
        success: false
      });
      console.error(`❌ [default] ${endpoint.name} failed: ${error.message}`);
    }
  }

  const filename = path.join(CONFIG.OUTPUT_DIR, 'results-default.json');
  await writeFile(filename, JSON.stringify(results, null, 2));

  return results;
}

async function generateSummaryReport(allResults) {
  const summary = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    host: CONFIG.HOST,
    results: {}
  };

  for (const result of allResults) {
    summary.results[result.tlsVersion] = {
      tlsConnection: result.tlsConnection?.error ? 'failed' : 'success',
      endpoints: {}
    };

    for (const endpoint of result.endpoints || []) {
      const endpointName = CONFIG.ENDPOINTS.find(e => 
        `${CONFIG.BASE_URL}${e.path}` === endpoint.url)?.name || endpoint.url;
      
      summary.results[result.tlsVersion].endpoints[endpointName] = {
        status: endpoint.error ? 'failed' : 'success',
        statusCode: endpoint.error ? 
          (endpoint.error.response?.status || 'N/A') : 
          endpoint.status,
        duration: endpoint.duration ? formatDuration(endpoint.duration) : 'N/A'
      };
    }
  }

  await writeFile(
    path.join(CONFIG.OUTPUT_DIR, 'summary-report.json'),
    JSON.stringify(summary, null, 2)
  );

  console.log('\n=== Test Summary ===');
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

// ==============================================
// Main Execution
// ==============================================
async function main() {
  try {
    console.log('Starting MaishaPay API connection tests...');
    console.log(`Node.js ${process.version} on ${process.platform}`);
    console.log(`Testing host: ${CONFIG.HOST}`);
    console.log(`Results will be saved to: ${path.resolve(CONFIG.OUTPUT_DIR)}`);

    await ensureOutputDir();

    const allResults = [];
    
    // Run tests for each TLS version
    for (const tlsVersion of CONFIG.TLS_VERSIONS) {
      console.log(`\n=== Testing with ${tlsVersion.version} ===`);
      const results = await runTestsForTlsVersion(tlsVersion);
      allResults.push(results);
    }

    // Run tests with default TLS settings
    console.log('\n=== Testing with default TLS settings ===');
    const defaultResults = await runTestsWithDefaultTls();
    allResults.push(defaultResults);

    // Generate summary report
    await generateSummaryReport(allResults);

    console.log('\nAll tests completed!');
    console.log(`Check results in: ${path.resolve(CONFIG.OUTPUT_DIR)}`);
  } catch (error) {
    console.error('\nTest suite failed:', error);
    process.exit(1);
  }
}

main();



